import { JournalWriter } from './writer.js';
import { zonedLocalToUtcMs } from './time.js';
import { MAX_NOTE } from './fields.js';

export const DAYLIO_MOODS = {
  awful: 1,
  bad: 3,
  meh: 5,
  good: 7,
  rad: 9,
};

const DATE_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const TIME_RE = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)$/i;
const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let i = 0;
  let inQuotes = false;
  const s = String(text).replace(/^\uFEFF/, '');

  const pushRow = () => {
    if (row.some((cell) => cell !== '')) rows.push(row);
    row = [];
  };

  while (i < s.length) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (c === ',') {
      row.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (c === '\n' || c === '\r') {
      row.push(field);
      field = '';
      pushRow();
      if (c === '\r' && s[i + 1] === '\n') i += 2;
      else i += 1;
      continue;
    }
    field += c;
    i += 1;
  }
  row.push(field);
  pushRow();

  if (!rows.length) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((cells) => {
    const obj = {};
    for (let j = 0; j < headers.length; j += 1) {
      obj[headers[j]] = cells[j] ?? '';
    }
    return obj;
  });
}

function stripTags(value) {
  return String(value).replace(/<\/?[^>]+>/g, '');
}

function decodeEntities(value) {
  return String(value).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (full, body) => {
    const key = String(body).toLowerCase();
    if (key.startsWith('#x')) {
      const n = Number.parseInt(key.slice(2), 16);
      return Number.isFinite(n) ? String.fromCodePoint(n) : full;
    }
    if (key.startsWith('#')) {
      const n = Number.parseInt(key.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : full;
    }
    return NAMED_ENTITIES[key] ?? full;
  });
}

export function htmlToMarkdown(html) {
  if (html == null || html === '') return '';
  let s = String(html);

  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<(b|strong)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, _tag, inner) => `**${inner}**`);
  s = s.replace(/<(i|em)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, _tag, inner) => `*${inner}*`);

  s = s.replace(/<ol\b[^>]*>([\s\S]*?)<\/ol>/gi, (_, inner) => {
    let n = 0;
    const items = [];
    String(inner).replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_m, item) => {
      n += 1;
      items.push(`${n}. ${stripTags(item).trim()}`);
      return '';
    });
    return items.length ? `\n${items.join('\n')}\n` : '';
  });

  s = s.replace(/<ul\b[^>]*>([\s\S]*?)<\/ul>/gi, (_, inner) => {
    const items = [];
    String(inner).replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_m, item) => {
      items.push(`- ${stripTags(item).trim()}`);
      return '';
    });
    return items.length ? `\n${items.join('\n')}\n` : '';
  });

  s = s.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_, item) => `\n- ${stripTags(item).trim()}\n`);
  s = stripTags(s);
  s = decodeEntities(s);
  s = s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  s = s.replace(/[^\S\n]+\n/g, '\n');
  s = s.replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

export function mapMood(name) {
  const key = String(name ?? '')
    .trim()
    .toLowerCase();
  const mood = DAYLIO_MOODS[key];
  if (mood == null) throw new Error(`unknown mood: ${name}`);
  return mood;
}

export function parseDaylioDateTime(fullDate, time) {
  const dateMatch = DATE_RE.exec(String(fullDate ?? '').trim());
  if (!dateMatch) throw new Error('invalid date; use M/D/YYYY');
  const timeMatch = TIME_RE.exec(String(time ?? '').trim());
  if (!timeMatch) throw new Error('invalid time; use h:mm AM/PM');

  const month = Number(dateMatch[1]);
  const day = Number(dateMatch[2]);
  const year = Number(dateMatch[3]);
  let hour = Number(timeMatch[1]) % 12;
  if (String(timeMatch[4]).toUpperCase() === 'PM') hour += 12;
  const minute = Number(timeMatch[2]);
  const second = timeMatch[3] == null ? 0 : Number(timeMatch[3]);
  return zonedLocalToUtcMs(year, month, day, hour, minute, second);
}

function splitPipeList(raw) {
  if (raw == null) return [];
  const s = String(raw).trim();
  if (!s) return [];
  return s
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean);
}

export function formatScale(raw) {
  if (raw == null) return '';
  const cleaned = String(raw)
    .replace(/[\u00a0\u202f\u2007]/g, ' ')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\bpoints\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  const match = cleaned.match(/^(.+?):\s*(\d+)\s*\/\s*(\d+)/);
  if (match) return `${match[1].trim()}: ${match[2]}/${match[3]}`;
  return cleaned;
}

function assembleNote(body, activities, scale) {
  const meta = [];
  if (activities.length) meta.push(`Activities: ${activities.join(', ')}`);
  if (scale) meta.push(scale);
  let note;
  if (body && meta.length) note = `${body}\n\n${meta.join('\n')}`;
  else if (body) note = body;
  else if (meta.length) note = meta.join('\n');
  else note = 'Imported from Daylio';
  if (note.length > MAX_NOTE) return note.slice(0, MAX_NOTE);
  return note;
}

export function daylioRowToEntry(row = {}) {
  const mood = mapMood(row.mood);
  const recordedAt = parseDaylioDateTime(row.full_date, row.time);
  const body = htmlToMarkdown(row.note);
  const activities = splitPipeList(row.activities);
  const scale = formatScale(row.scales);
  return {
    mood,
    note: assembleNote(body, activities, scale),
    recordedAt,
    tags: [],
  };
}

export function importDaylioCsv(db, csvText, { dryRun = false } = {}) {
  const writer = dryRun ? null : new JournalWriter(db);
  const existing = db.prepare(`
    SELECT 1 AS ok
    FROM entries
    WHERE deleted_at IS NULL AND recorded_at = ? AND mood = ? AND note = ?
    LIMIT 1
  `);
  const rows = parseCsv(csvText);
  const summary = { imported: 0, skipped: 0, failed: 0, errors: [] };

  for (let i = 0; i < rows.length; i += 1) {
    const line = i + 2;
    try {
      const entry = daylioRowToEntry(rows[i]);
      if (existing.get(entry.recordedAt, entry.mood, entry.note)) {
        summary.skipped += 1;
        continue;
      }
      if (!dryRun) {
        writer.addEntry({
          mood: entry.mood,
          note: entry.note,
          tags: [],
          recordedAt: entry.recordedAt,
        });
      }
      summary.imported += 1;
    } catch (err) {
      summary.failed += 1;
      summary.errors.push({ row: line, message: err.message || String(err) });
    }
  }

  return summary;
}
