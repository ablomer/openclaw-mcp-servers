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

/**
 * Resolve a calendar selector for gog.
 * Empty / omitted / the Google alias "primary" become "" so callers can omit
 * --cal and let gog use the account default. gog matches --cal against
 * calendar ids and names from `calendar calendars` and does not accept
 * "primary" as a name.
 */
export function calendarId(value) {
  if (value == null || value === '') return '';
  const id = String(value);
  if (id === 'primary') return '';
  return id;
}
