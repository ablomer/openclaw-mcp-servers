import {
  JournalWriter,
  assertEntryId,
  escapeFtsQuery,
  formatEntry,
  getTzParts,
  parseDateArg,
} from '@openclaw-mood-journal/shared';

const PAGE = 30;

const FIELD_KEYS = [
  'mood',
  'note',
  'energy',
  'anxiety',
  'sleep_hours',
  'sleep_quality',
  'social',
  'context',
  'tags',
];

function pad(n) {
  return String(n).padStart(2, '0');
}

export function formatWhen(ms) {
  const parts = getTzParts(ms);
  return `${String(parts.year).padStart(4, '0')}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

function parseCursor(before) {
  if (before == null || before === '') return null;
  const raw = String(before);
  const idx = raw.indexOf(':');
  if (idx <= 0) throw new Error('invalid cursor');
  const recorded = Number(raw.slice(0, idx));
  if (!Number.isFinite(recorded)) throw new Error('invalid cursor');
  const id = assertEntryId(raw.slice(idx + 1));
  return { recorded, id };
}

function cursorOf(row) {
  return `${row.recorded_at}:${row.id}`;
}

function fieldsFromBody(body, { partial }) {
  if (body == null || typeof body !== 'object' || Array.isArray(body)) {
    throw Object.assign(new Error('invalid body'), { status: 400 });
  }
  const fields = {};
  for (const key of FIELD_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
    if (partial || body[key] !== undefined) fields[key] = body[key];
  }
  if (Object.prototype.hasOwnProperty.call(body, 'when') && body.when != null && body.when !== '') {
    fields.recordedAt = parseDateArg(String(body.when));
  }
  return fields;
}

export function createJournal(db) {
  const writer = new JournalWriter(db);
  const filter = `
    e.deleted_at IS NULL
    AND (? IS NULL OR e.recorded_at >= ?)
    AND (? IS NULL OR e.recorded_at <= ?)
    AND (
      ? IS NULL
      OR e.recorded_at < ?
      OR (e.recorded_at = ? AND e.id < ?)
    )
  `;
  const listStmt = db.prepare(`
    SELECT e.* FROM entries e
    WHERE ${filter}
    ORDER BY e.recorded_at DESC, e.id DESC
    LIMIT ?
  `);
  const searchStmt = db.prepare(`
    SELECT e.*
    FROM entries_fts
    JOIN entries e ON e.rowid = entries_fts.rowid
    WHERE entries_fts MATCH ?
      AND ${filter}
    ORDER BY e.recorded_at DESC, e.id DESC
    LIMIT ?
  `);
  const tagsStmt = db.prepare(`
    SELECT t.name
    FROM tags t
    JOIN entry_tags et ON et.tag_id = t.id
    JOIN entries e ON e.id = et.entry_id
    WHERE e.deleted_at IS NULL
    GROUP BY t.name
    ORDER BY t.name ASC
  `);

  function present(row) {
    const tags = Array.isArray(row.tags) ? row.tags : writer.tagsFor(row.id);
    return {
      ...formatEntry(row, tags),
      when: formatWhen(row.recorded_at),
    };
  }

  function list({ from, to, before, q } = {}) {
    const fromMs = from ? parseDateArg(from, { bound: 'start' }) : null;
    const toMs = to ? parseDateArg(to, { bound: 'end' }) : null;
    const cursor = parseCursor(before);
    const cursorMs = cursor ? cursor.recorded : null;
    const cursorId = cursor ? cursor.id : null;
    const range = [fromMs, fromMs, toMs, toMs, cursorMs, cursorMs, cursorMs, cursorId];
    const query = q == null ? '' : String(q).trim();
    const rows = query
      ? searchStmt.all(escapeFtsQuery(query), ...range, PAGE + 1)
      : listStmt.all(...range, PAGE + 1);
    const page = rows.slice(0, PAGE);
    return {
      entries: page.map((row) => present(row)),
      next_before: rows.length > PAGE ? cursorOf(page[page.length - 1]) : null,
    };
  }

  return {
    list,
    get(id) {
      const entry = writer.getEntry(id);
      return entry ? present(entry) : null;
    },
    create(body) {
      return present(writer.addEntry(fieldsFromBody(body, { partial: false })));
    },
    update(id, body) {
      return present(writer.updateEntry(id, fieldsFromBody(body, { partial: true })));
    },
    remove(id) {
      return writer.deleteEntry(id);
    },
    tags() {
      return tagsStmt.all().map((row) => row.name);
    },
  };
}
