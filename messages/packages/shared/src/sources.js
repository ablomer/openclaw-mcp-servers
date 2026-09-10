export const SOURCES = Object.freeze(['whatsapp', 'gmessages', 'instagram']);
export const THREAD_TYPES = Object.freeze(['dm', 'group', 'unknown']);
export const DIRECTIONS = Object.freeze(['inbound', 'outbound', 'system']);
export const MESSAGE_TYPES = Object.freeze([
  'text',
  'image',
  'video',
  'audio',
  'document',
  'sticker',
  'reaction',
  'other',
]);

export function isSource(value) {
  return SOURCES.includes(value);
}

export function entityId(source, nativeId) {
  if (!isSource(source)) {
    throw new Error(`invalid source: ${source}`);
  }
  if (nativeId == null || String(nativeId).length === 0) {
    throw new Error('nativeId required');
  }
  return `${source}:${nativeId}`;
}

export function parseEntityId(id) {
  const text = String(id ?? '');
  const idx = text.indexOf(':');
  if (idx <= 0) return null;
  const source = text.slice(0, idx);
  const nativeId = text.slice(idx + 1);
  if (!isSource(source) || nativeId.length === 0) return null;
  return { source, nativeId };
}
