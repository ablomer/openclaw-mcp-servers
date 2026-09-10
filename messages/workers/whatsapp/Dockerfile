FROM node:22-bookworm-slim
# Official image already has uid/gid 1000 (node). Compose runs as 1000:65532.
RUN getent group 65532 >/dev/null || groupadd -g 65532 mcp
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY mcp-server/package.json mcp-server/package.json
COPY workers/whatsapp/package.json workers/whatsapp/package.json
COPY workers/instagram/package.json workers/instagram/package.json
RUN npm ci --omit=dev --omit=optional -w @openclaw-messages/whatsapp-worker
COPY packages/shared ./packages/shared
COPY workers/whatsapp ./workers/whatsapp
ENV NODE_ENV=production
ENV MESSAGES_DB_PATH=/data/messages.sqlite
ENV SESSIONS_DIR=/sessions
USER 1000:65532
WORKDIR /app/workers/whatsapp
CMD ["node", "src/index.js"]
