import { parseDateArg, resolveWindow } from '@openclaw-google-health/shared';

export function clampInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

export function optionalDate(value, bound) {
  if (value == null || value === '') return null;
  return parseDateArg(value, { bound });
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

export function resolveToolWindow(args, { defaultDays = 7, maxDays = 90, nowMs } = {}) {
  return resolveWindow(args, { defaultDays, maxDays, nowMs });
}
