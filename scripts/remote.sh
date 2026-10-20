#!/bin/sh
# Operate the VPS deployment from your machine over SSH. Set VPS=user@host (or VPS_HOST in .env.deploy).
#   scripts/remote.sh deploy              rsync code + build + start the full stack
#   scripts/remote.sh env                 edit the server's private .env, then recreate app/worker/postiz
#   scripts/remote.sh check               show which .env items are still missing
#   scripts/remote.sh registration open   let you create the Postiz admin account (close afterwards!)
#   scripts/remote.sh registration close
#   scripts/remote.sh integrations        print Postiz integration IDs (needs POSTIZ_API_KEY)
#   scripts/remote.sh groups              print WhatsApp group IDs (needs a paired WAHA session)
#   scripts/remote.sh user add NAME       give someone their own login to the dashboard and ChatGPT plugin (also: user remove NAME, user list)
#   scripts/remote.sh tunnel              open localhost:3011 (server WAHA) through SSH; 3011 avoids clashing with a local stack
#   scripts/remote.sh ps | logs | backup  status, tail logs, download a backup archive
set -eu
cd "$(dirname "$0")/.."
[ -f .env.deploy ] && . ./.env.deploy
VPS="${VPS:-${VPS_HOST:-}}"; [ -n "$VPS" ] || { echo 'Set VPS=user@host'; exit 1; }
DIR="${VPS_DIR:-/opt/riga-weekend}"
PROFILES='--profile whatsapp --profile production'
remote() { ssh "$VPS" "cd '$DIR' && $*"; }
compose() { remote "docker compose $PROFILES $*"; }
cli() { compose "run --rm --no-deps app node src/cli.js $*"; }
set_env() { remote "sed -i 's/^$1=.*/$1=$2/' .env && grep -q '^$1=' .env || echo '$1=$2' >> .env"; }
case "${1:-}" in
  deploy)
    rsync -az --no-owner --no-group --delete --include '.env.example' --include '.env.deploy.example' --exclude '.env*' --exclude .git --exclude node_modules --exclude data --exclude backups --exclude .DS_Store --exclude 'remotion/out' --exclude 'remotion/build' --exclude tools ./ "$VPS:$DIR/"
    remote "[ -f .env ] || sh scripts/bootstrap.sh"
    compose "up -d --build --remove-orphans"; compose ps
    echo 'Deployed. If this was the first deploy, run: scripts/remote.sh env  and set APP_DOMAIN, POSTIZ_DOMAIN, APP_ORIGIN, POSTIZ_PUBLIC_URL.';;
  env) ssh -t "$VPS" "cd '$DIR' && \${EDITOR:-nano} .env"; compose "up -d app worker postiz";;
  check) cli check;;
  registration)
    case "${2:-}" in
      open) set_env DISABLE_REGISTRATION false; compose "up -d postiz"; echo 'Registration OPEN. Create your account, then run: scripts/remote.sh registration close';;
      close) set_env DISABLE_REGISTRATION true; compose "up -d postiz"; echo 'Registration closed.';;
      *) echo 'registration open|close'; exit 1;;
    esac;;
  integrations) cli integrations;;
  groups) cli groups;;
  user) cli "user ${2:-} ${3:-}";;
  tunnel) echo 'Server WAHA: http://localhost:3011  (Ctrl+C to close)'; ssh -N -L 3011:127.0.0.1:3001 "$VPS";;
  ps) compose ps;;
  logs) compose "logs --tail=${2:-100} -f app worker";;
  backup)
    mkdir -p backups; f="backups/riga-$(date +%Y%m%d-%H%M).tar.gz"
    compose "stop app worker" >/dev/null
    remote "docker run --rm -v riga-weekend_riga-data:/d:ro -v riga-weekend_waha-sessions:/w:ro alpine tar czf - /d /w" > "$f"
    compose "start app worker" >/dev/null; echo "Wrote $f (app data + WhatsApp session). Keep .env backed up separately."; ;;
  *) sed -n '2,13p' "$0"; exit 1;;
esac
