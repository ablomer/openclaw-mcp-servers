FROM node:22-alpine
# Official image already has uid 1000 (node). Compose runs as 1000:65532.
RUN grep -q ':65532:' /etc/group || addgroup -g 65532 -S mcp
WORKDIR /app
COPY scripts/backup.mjs ./backup.mjs
USER 1000:65532
ENV MESSAGES_DB_PATH=/data/messages.sqlite
ENV BACKUP_DIR=/backups
CMD ["node", "backup.mjs"]
