FROM node:22-alpine
RUN grep -q ':65532:' /etc/group || addgroup -g 65532 -S mcp
WORKDIR /app
COPY scripts/backup.mjs ./backup.mjs
USER 65532:65532
ENV MOOD_JOURNAL_DB_PATH=/data/mood-journal.sqlite
ENV BACKUP_DIR=/backups
ENV TZ=America/New_York
CMD ["node", "backup.mjs"]
