FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY mcp-server/package.json mcp-server/package.json
COPY workers/whatsapp/package.json workers/whatsapp/package.json
COPY workers/instagram/package.json workers/instagram/package.json
RUN npm ci --omit=dev --omit=optional -w @openclaw-messages/mcp-server

FROM node:22-alpine
RUN addgroup -g 65532 -S mcp && adduser -u 65532 -S -G mcp mcp
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY packages/shared ./packages/shared
COPY mcp-server ./mcp-server
ENV NODE_ENV=production
ENV MESSAGES_DB_PATH=/data/messages.sqlite
ENV PORT=3000
ENV HOST=0.0.0.0
USER 65532:65532
WORKDIR /app/mcp-server
EXPOSE 3000
CMD ["node", "src/index.js"]
