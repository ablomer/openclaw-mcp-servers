export const SOCIAL = ['alone', 'one_on_one', 'group'];
export const CONTEXTS = ['home', 'work', 'travel', 'outdoors', 'other'];
export const PERIODS = ['day', 'week', 'month'];
export const MAX_TAGS = 12;
export const MAX_NOTE = 8000;
export const TAG_RE = /^[\p{L}\p{M}\p{N}_-]{1,32}$/u;

export function assertRating(name, value, { required = false } = {}) {
  if (value == null || value === '') {
    if (required) throw new Error(`${name} is required`);
    return null;
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 10) {
    throw new Error(`${name} must be an integer 1-10`);
  }
  return n;
}

export function assertSleepHours(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 24) {
    throw new Error('sleep_hours must be a number between 0 and 24');
  }
  return n;
}

export function assertNote(value, { required = true } = {}) {
  if (value == null) {
    if (required) throw new Error('note is required');
    return undefined;
  }
  const note = String(value).trim();
  if (!note) throw new Error('note is required');
  if (note.length > MAX_NOTE) throw new Error(`note must be at most ${MAX_NOTE} characters`);
  return note;
}

export function assertSocial(value) {
  if (value == null || value === '') return null;
  if (!SOCIAL.includes(value)) throw new Error('invalid social');
  return value;
}

export function assertContext(value) {
  if (value == null || value === '') return null;
  if (!CONTEXTS.includes(value)) throw new Error('invalid context');
  return value;
}

export function normalizeTags(tags) {
  if (tags == null) return [];
  if (!Array.isArray(tags)) throw new Error('tags must be an array');
  const out = [];
  const seen = new Set();
  for (const raw of tags) {
    const name = String(raw).trim().toLowerCase().normalize('NFC');
    if (!TAG_RE.test(name)) throw new Error(`invalid tag: ${raw}`);
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  if (out.length > MAX_TAGS) throw new Error(`at most ${MAX_TAGS} tags`);
  return out;
}

export function assertEntryId(id) {
  const value = String(id ?? '').trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error('invalid entry id');
  }
  return value;
}
