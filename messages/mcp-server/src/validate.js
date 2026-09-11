import { parseEntityId, resolveDayRange, SOURCES } from '@openclaw-messages/shared';

export function clampInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

export function assertChatId(chatId) {
  const parsed = parseEntityId(chatId);
  if (!parsed) {
    throw new Error('invalid chat_id');
  }
  return parsed;
}

export function optionalSource(source) {
  if (source == null || source === '') return null;
  if (!SOURCES.includes(source)) throw new Error('invalid source');
  return source;
}

export function resolveMessageRange(args, { defaultDays = 3, maxDays = 14, nowMs } = {}) {
  return resolveDayRange(args, { defaultDays, maxDays, nowMs });
}

export function truncatePayload(value, maxBytes = 32_768) {
  const json = JSON.stringify(value);
  const bytes = Buffer.byteLength(json, 'utf8');
  if (bytes <= maxBytes) return json;
  return JSON.stringify({
    truncated: true,
    reason: 'payload exceeded 32KiB cap',
    bytes,
  });
}
