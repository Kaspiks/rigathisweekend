FROM node:24-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends fontconfig fonts-dejavu-core ca-certificates ffmpeg && rm -rf /var/lib/apt/lists/*
# COLMAP, for solving where the camera was on each frame (src/track-worker.py). In its own virtualenv so
# it cannot disturb the python Debian ships, and ahead of the app's own files so changing code does not
# rebuild it. Without this the app still runs: make_track reports that tracks cannot be solved here.
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv libgl1 libglib2.0-0 \
 && python3 -m venv /opt/pycolmap \
 && /opt/pycolmap/bin/pip install --no-cache-dir pycolmap==4.2.0 \
 && apt-get purge -y python3-venv && apt-get autoremove -y && rm -rf /var/lib/apt/lists/* /root/.cache
ENV TRACK_PYTHON=/opt/pycolmap/bin/python3 PYTHONDONTWRITEBYTECODE=1
WORKDIR /app
COPY package*.json .npmrc ./
# .npmrc skips onnxruntime's GPU download; the Windows and macOS builds it ships are not needed here either.
RUN npm ci --omit=dev && npm cache clean --force \
 && rm -rf node_modules/onnxruntime-node/bin/napi-v6/win32 node_modules/onnxruntime-node/bin/napi-v6/darwin
COPY src ./src
COPY public ./public
RUN mkdir /app/data && chown node:node /app/data
USER node
ENV HOST=0.0.0.0 DATA_DIR=/app/data PORT=3100
ENV XDG_CACHE_HOME=/tmp/.cache FONTCONFIG_PATH=/etc/fonts
EXPOSE 3100

FROM base AS test
COPY test ./test
# finish.test.js checks the renderer's roll-off curve against the app's: the one remotion file .dockerignore lets in.
COPY remotion/src/edit/filters.tsx ./remotion/src/edit/
CMD ["node","--test"]

FROM base AS runtime
CMD ["node","src/server.js"]
