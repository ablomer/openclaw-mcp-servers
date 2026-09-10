export function clampInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
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
