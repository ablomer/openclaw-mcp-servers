ARG GOGCLI_IMAGE=ghcr.io/openclaw/gogcli:latest

FROM ${GOGCLI_IMAGE} AS gogcli

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY email-mcp/package.json email-mcp/package.json
COPY calendar-mcp/package.json calendar-mcp/package.json
RUN npm ci --omit=dev --omit=optional -w @openclaw-gog/email-mcp

FROM node:22-bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=gogcli /usr/local/bin/gog /usr/local/bin/gog
COPY packages/shared ./packages/shared
COPY email-mcp ./email-mcp
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
ENV TZ=America/New_York
ENV HOME=/home/node
ENV XDG_CACHE_HOME=/tmp
ENV XDG_CONFIG_HOME=/tmp
ENV GOG_BIN=/usr/local/bin/gog
ENV GOG_DATA_DIR=/data
ENV GOG_CONFIG_DIR=/tmp/gog-config
ENV GOG_STATE_DIR=/tmp/gog-state
ENV GOG_CACHE_DIR=/tmp/gog-cache
ENV GOG_GMAIL_NO_SEND=1
USER 1000:1000
WORKDIR /app/email-mcp
EXPOSE 3000
CMD ["node", "src/index.js"]
