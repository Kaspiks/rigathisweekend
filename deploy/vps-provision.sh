#!/bin/sh
# One-time preparation of a fresh x86 Ubuntu 24.04 / Debian 12 VPS. Run as root:
#   ssh root@YOUR-VPS 'sh -s' < deploy/vps-provision.sh
# Installs Docker Engine + Compose plugin, a firewall (22/80/443 only), 4 GB swap,
# unattended security upgrades and the /opt/riga-weekend deploy directory.
set -eu
export DEBIAN_FRONTEND=noninteractive
[ "$(id -u)" = 0 ] || { echo 'Run as root'; exit 1; }
[ "$(uname -m)" = x86_64 ] || echo 'WARNING: WAHA image is x86-only; this VPS is not x86_64.'

apt-get update -q
apt-get install -y -q ca-certificates curl gnupg ufw unattended-upgrades rsync
. /etc/os-release
install -m 0755 -d /etc/apt/keyrings
if [ ! -f /etc/apt/keyrings/docker.asc ]; then
  curl -fsSL "https://download.docker.com/linux/$ID/gpg" -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
fi
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/$ID $VERSION_CODENAME stable" > /etc/apt/sources.list.d/docker.list
apt-get update -q
apt-get install -y -q docker-ce docker-ce-cli containerd.io docker-compose-plugin
systemctl enable --now docker

# Docker publishes ports through its own iptables chains; the stack only binds 80/443 publicly.
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

if [ ! -f /swapfile ]; then
  fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
# Elasticsearch (used by Temporal) refuses to start below this limit.
echo 'vm.max_map_count=262144' > /etc/sysctl.d/90-riga-weekend.conf
sysctl -w vm.max_map_count=262144 >/dev/null
# Keep container logs bounded.
[ -f /etc/docker/daemon.json ] || { printf '{"log-driver":"json-file","log-opts":{"max-size":"20m","max-file":"3"}}\n' > /etc/docker/daemon.json; systemctl restart docker; }
dpkg-reconfigure -f noninteractive unattended-upgrades
mkdir -p /opt/riga-weekend
docker --version; docker compose version; free -h | head -2
echo 'VPS ready. Next: from your machine run  VPS=root@THIS-HOST scripts/remote.sh deploy'
