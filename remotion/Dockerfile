# Remotion renderer: Node + Chrome Headless Shell, kept out of the app image on purpose.
# Serves POST /render for the app (see server.mjs); `docker compose run --rm render npx remotion render …` still works.
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      libnss3 libdbus-1-3 libatk1.0-0 libgbm-dev libasound2 libxrandr2 libxkbcommon-dev libxfixes3 \
      libxcomposite1 libxdamage1 libatk-bridge2.0-0 libpango-1.0-0 libcairo2 libcups2 ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund && npm cache clean --force
RUN npx remotion browser ensure
COPY . .
RUN npx remotion bundle src/index.ts --out-dir build && chown -R node:node /app
USER node
ENV XDG_CACHE_HOME=/tmp/.cache
EXPOSE 3200
CMD ["node", "server.mjs"]
