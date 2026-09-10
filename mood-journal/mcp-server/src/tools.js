import {
  JournalWriter,
  WEEKDAYS,
  assertEntryId,
  escapeFtsQuery,
  formatEntry,
  normalizeTags,
  periodKey,
  round1,
  weekdayName,
} from '@openclaw-mood-journal/shared';
import { clampInt, optionalDate, truncatePayload } from './validate.js';

function textResult(payload) {
  return {
    content: [{ type: 'text', text: truncatePayload(payload) }],
  };
}

function errorResult(message) {
  return {
    isError: true,
    content: [{ type: 'text', text: message }],
  };
}

function present(entry) {
  return formatEntry(entry, entry.tags);
}

function rangeClause(fromMs, toMs) {
  return {
    fromMs,
    toMs,
  };
}

export function createTools(db) {
  const writer = new JournalWriter(db);

  const listBase = `
    SELECT e.*
    FROM entries e
    WHERE e.deleted_at IS NULL
      AND (? IS NULL OR e.recorded_at >= ?)
      AND (? IS NULL OR e.recorded_at <= ?)
      AND (? IS NULL OR e.recorded_at < ?)
      AND (? IS NULL OR e.mood >= ?)
      AND (? IS NULL OR e.mood <= ?)
  `;

  const listStmt = db.prepare(`
    ${listBase}
    ORDER BY e.recorded_at DESC, e.id DESC
    LIMIT ?
  `);

  const searchStmt = db.prepare(`
    SELECT
      e.id,
      e.recorded_at,
      e.mood,
      snippet(entries_fts, 0, '', '', '…', 16) AS snippet
    FROM entries_fts
    JOIN entries e ON e.rowid = entries_fts.rowid
    WHERE entries_fts MATCH ?
      AND e.deleted_at IS NULL
      AND (? IS NULL OR e.recorded_at >= ?)
      AND (? IS NULL OR e.recorded_at <= ?)
    ORDER BY e.recorded_at DESC, e.id DESC
    LIMIT ?
  `);

  const statsStmt = db.prepare(`
    SELECT
      COUNT(*) AS n,
      AVG(mood) AS avg_mood,
      MIN(mood) AS min_mood,
      MAX(mood) AS max_mood,
      AVG(energy) AS avg_energy,
      MIN(energy) AS min_energy,
      MAX(energy) AS max_energy,
      AVG(anxiety) AS avg_anxiety,
      MIN(anxiety) AS min_anxiety,
      MAX(anxiety) AS max_anxiety,
      AVG(sleep_hours) AS avg_sleep_hours,
      AVG(sleep_quality) AS avg_sleep_quality
    FROM entries
    WHERE deleted_at IS NULL
      AND (? IS NULL OR recorded_at >= ?)
      AND (? IS NULL OR recorded_at <= ?)
  `);

  const moodRowsStmt = db.prepare(`
    SELECT recorded_at, mood
    FROM entries
    WHERE deleted_at IS NULL
      AND (? IS NULL OR recorded_at >= ?)
      AND (? IS NULL OR recorded_at <= ?)
  `);

  const topTagsStmt = db.prepare(`
    SELECT t.name, COUNT(*) AS n
    FROM entry_tags et
    JOIN tags t ON t.id = et.tag_id
    JOIN entries e ON e.id = et.entry_id
    WHERE e.deleted_at IS NULL
      AND (? IS NULL OR e.recorded_at >= ?)
      AND (? IS NULL OR e.recorded_at <= ?)
    GROUP BY t.name
    ORDER BY n DESC, t.name ASC
    LIMIT 20
  `);

  const listTagsStmt = db.prepare(`
    SELECT t.name, COUNT(*) AS n
    FROM tags t
    JOIN entry_tags et ON et.tag_id = t.id
    JOIN entries e ON e.id = et.entry_id
    WHERE e.deleted_at IS NULL
    GROUP BY t.name
    ORDER BY n DESC, t.name ASC
  `);

  const taggedAvgStmt = db.prepare(`
    SELECT AVG(e.mood) AS avg_mood, COUNT(*) AS n
    FROM entries e
    WHERE e.deleted_at IS NULL
      AND (? IS NULL OR e.recorded_at >= ?)
      AND (? IS NULL OR e.recorded_at <= ?)
      AND e.id IN (
        SELECT et.entry_id FROM entry_tags et
        JOIN tags t ON t.id = et.tag_id
        WHERE t.name = ?
      )
  `);

  const untaggedAvgStmt = db.prepare(`
    SELECT AVG(e.mood) AS avg_mood, COUNT(*) AS n
    FROM entries e
    WHERE e.deleted_at IS NULL
      AND (? IS NULL OR e.recorded_at >= ?)
      AND (? IS NULL OR e.recorded_at <= ?)
      AND e.id NOT IN (
        SELECT et.entry_id FROM entry_tags et
        JOIN tags t ON t.id = et.tag_id
        WHERE t.name = ?
      )
  `);

  function bindRange(from, to) {
    const fromMs = optionalDate(from, 'start');
    const toMs = optionalDate(to, 'end');
    return rangeClause(fromMs, toMs);
  }

  function rangeArgs(fromMs, toMs) {
    return [fromMs, fromMs, toMs, toMs];
  }

  function filterByAllTags(rows, tags) {
    if (!tags.length) return rows;
    return rows.filter((row) => tags.every((tag) => writer.tagsFor(row.id).includes(tag)));
  }

  return {
    addEntry(args = {}) {
      try {
        const { mood, note, energy, anxiety, sleep_hours, sleep_quality, social, context, tags } = args;
        const entry = writer.addEntry({
          mood,
          note,
          energy,
          anxiety,
          sleep_hours,
          sleep_quality,
          social,
          context,
          tags,
        });
        return textResult({ entry: present(entry) });
      } catch (err) {
        return errorResult(err.message || 'add_entry failed');
      }
    },

    updateEntry(args = {}) {
      try {
        const { id, mood, note, energy, anxiety, sleep_hours, sleep_quality, social, context, tags } = args;
        const entry = writer.updateEntry(id, {
          mood,
          note,
          energy,
          anxiety,
          sleep_hours,
          sleep_quality,
          social,
          context,
          tags,
        });
        return textResult({ entry: present(entry) });
      } catch (err) {
        return errorResult(err.message || 'update_entry failed');
      }
    },

    deleteEntry({ id } = {}) {
      try {
        return textResult(writer.deleteEntry(id));
      } catch (err) {
        return errorResult(err.message || 'delete_entry failed');
      }
    },

    getEntry({ id } = {}) {
      try {
        const entry = writer.getEntry(assertEntryId(id));
        if (!entry) return errorResult('Unknown entry');
        return textResult({ entry: present(entry) });
      } catch (err) {
        return errorResult(err.message || 'get_entry failed');
      }
    },

    listEntries({ from, to, before, mood_min, mood_max, tags, limit } = {}) {
      try {
        const { fromMs, toMs } = bindRange(from, to);
        const beforeMs = optionalDate(before, 'start');
        const moodMin = mood_min == null ? null : Number(mood_min);
        const moodMax = mood_max == null ? null : Number(mood_max);
        const lim = clampInt(limit, 20, 1, 50);
        const wanted = tags == null ? [] : normalizeTags(tags);
        const fetchLimit = wanted.length ? Math.min(500, lim * 20) : lim;
        const rows = listStmt.all(
          fromMs,
          fromMs,
          toMs,
          toMs,
          beforeMs,
          beforeMs,
          moodMin,
          moodMin,
          moodMax,
          moodMax,
          fetchLimit,
        );
        const entries = filterByAllTags(rows, wanted)
          .slice(0, lim)
          .map((row) => present({ ...row, tags: writer.tagsFor(row.id) }));
        return textResult({ entries });
      } catch (err) {
        return errorResult(err.message || 'list_entries failed');
      }
    },

    searchEntries({ query, from, to, limit } = {}) {
      try {
        const match = escapeFtsQuery(query);
        const { fromMs, toMs } = bindRange(from, to);
        const lim = clampInt(limit, 20, 1, 50);
        const rows = searchStmt.all(match, fromMs, fromMs, toMs, toMs, lim).map((row) => ({
          id: row.id,
          display_recorded_at: formatEntry(row).display_recorded_at,
          mood: row.mood,
          snippet: row.snippet,
        }));
        return textResult({ results: rows });
      } catch (err) {
        return errorResult(err.message || 'search_entries failed');
      }
    },

    summarizeRange({ from, to } = {}) {
      try {
        const { fromMs, toMs } = bindRange(from, to);
        const args = rangeArgs(fromMs, toMs);
        const stats = statsStmt.get(...args);
        const weekday = Object.fromEntries(WEEKDAYS.map((name) => [name, { n: 0, avg_mood: null, sum: 0 }]));
        for (const row of moodRowsStmt.all(...args)) {
          const name = weekdayName(row.recorded_at);
          weekday[name].n += 1;
          weekday[name].sum += row.mood;
        }
        for (const name of WEEKDAYS) {
          const bucket = weekday[name];
          bucket.avg_mood = bucket.n ? round1(bucket.sum / bucket.n) : null;
          delete bucket.sum;
        }
        return textResult({
          n: stats.n,
          mood: { avg: round1(stats.avg_mood), min: stats.min_mood, max: stats.max_mood },
          energy: { avg: round1(stats.avg_energy), min: stats.min_energy, max: stats.max_energy },
          anxiety: { avg: round1(stats.avg_anxiety), min: stats.min_anxiety, max: stats.max_anxiety },
          sleep: {
            avg_hours: round1(stats.avg_sleep_hours),
            avg_quality: round1(stats.avg_sleep_quality),
          },
          weekday,
          top_tags: topTagsStmt.all(...args).map((row) => ({ name: row.name, n: row.n })),
        });
      } catch (err) {
        return errorResult(err.message || 'summarize_range failed');
      }
    },

    moodByPeriod({ period = 'day', from, to } = {}) {
      try {
        if (!['day', 'week', 'month'].includes(period)) {
          throw new Error('period must be day, week, or month');
        }
        const { fromMs, toMs } = bindRange(from, to);
        const buckets = new Map();
        for (const row of moodRowsStmt.all(...rangeArgs(fromMs, toMs))) {
          const key = periodKey(row.recorded_at, period);
          const bucket = buckets.get(key) || { period_start: key, n: 0, sum: 0 };
          bucket.n += 1;
          bucket.sum += row.mood;
          buckets.set(key, bucket);
        }
        const series = [...buckets.values()]
          .sort((a, b) => a.period_start.localeCompare(b.period_start))
          .map((bucket) => ({
            period_start: bucket.period_start,
            n: bucket.n,
            avg_mood: round1(bucket.sum / bucket.n),
          }));
        return textResult({ period, buckets: series });
      } catch (err) {
        return errorResult(err.message || 'mood_by_period failed');
      }
    },

    compareTagged({ tag, from, to } = {}) {
      try {
        const names = normalizeTags([tag]);
        if (names.length !== 1) throw new Error('tag is required');
        const name = names[0];
        const { fromMs, toMs } = bindRange(from, to);
        const args = [...rangeArgs(fromMs, toMs), name];
        const withTag = taggedAvgStmt.get(...args);
        const withoutTag = untaggedAvgStmt.get(...args);
        return textResult({
          tag: name,
          with_tag: { n: withTag.n, avg_mood: round1(withTag.avg_mood) },
          without_tag: { n: withoutTag.n, avg_mood: round1(withoutTag.avg_mood) },
        });
      } catch (err) {
        return errorResult(err.message || 'compare_tagged failed');
      }
    },

    listTags() {
      try {
        return textResult({ tags: listTagsStmt.all().map((row) => ({ name: row.name, n: row.n })) });
      } catch (err) {
        return errorResult(err.message || 'list_tags failed');
      }
    },
  };
}
