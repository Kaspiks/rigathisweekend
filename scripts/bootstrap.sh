#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
# Only this one-shot setup container mounts the project, to create .env.
# Runtime containers receive code in their images and data in named volumes.
docker run --rm --network none --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --user "$(id -u):$(id -g)" \
  --mount "type=bind,src=$(pwd),dst=/workspace" \
  --workdir /workspace node:24-bookworm-slim node scripts/setup.mjs
