/** Aggregated dump is larger than a single mailbox/search result. */
export const CONTEXT_MAX_BYTES = 262_144;

export function truncatePayload(value, maxBytes = CONTEXT_MAX_BYTES) {
  const json = JSON.stringify(value);
  const bytes = Buffer.byteLength(json, 'utf8');
  if (bytes <= maxBytes) return json;
  return JSON.stringify({
    truncated: true,
    reason: 'payload exceeded 256KiB cap',
    bytes,
  });
}
