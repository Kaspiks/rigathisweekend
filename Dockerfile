FROM node:24-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends fontconfig fonts-dejavu-core ca-certificates ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY public ./public
RUN mkdir /app/data && chown node:node /app/data
USER node
ENV HOST=0.0.0.0 DATA_DIR=/app/data PORT=3100
ENV XDG_CACHE_HOME=/tmp/.cache FONTCONFIG_PATH=/etc/fonts
EXPOSE 3100

FROM base AS test
COPY test ./test
CMD ["node","--test"]

FROM base AS runtime
CMD ["node","src/server.js"]
