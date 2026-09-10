import { randomUUID } from 'node:crypto';
import {
  assertContext,
  assertEntryId,
  assertNote,
  assertRating,
  assertSleepHours,
  assertSocial,
  normalizeTags,
} from './fields.js';
import { withTransaction } from './sqlite.js';

export class JournalWriter {
  constructor(db) {
    this.db = db;
    this.insertEntry = db.prepare(`
      INSERT INTO entries (
        id, recorded_at, created_at, updated_at, deleted_at,
        mood, note, energy, anxiety, sleep_hours, sleep_quality, social, context
      ) VALUES (
        @id, @recorded_at, @created_at, @updated_at, NULL,
        @mood, @note, @energy, @anxiety, @sleep_hours, @sleep_quality, @social, @context
      )
    `);
    this.updateSql = db.prepare(`
      UPDATE entries SET
        mood = @mood,
        note = @note,
        energy = @energy,
        anxiety = @anxiety,
        sleep_hours = @sleep_hours,
        sleep_quality = @sleep_quality,
        social = @social,
        context = @context,
        updated_at = @updated_at
      WHERE id = @id AND deleted_at IS NULL
    `);
    this.softDelete = db.prepare(`
      UPDATE entries SET deleted_at = @deleted_at, updated_at = @deleted_at
      WHERE id = @id AND deleted_at IS NULL
    `);
    this.selectEntry = db.prepare('SELECT * FROM entries WHERE id = ?');
    this.insertTag = db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)');
    this.selectTagId = db.prepare('SELECT id FROM tags WHERE name = ?');
    this.clearTags = db.prepare('DELETE FROM entry_tags WHERE entry_id = ?');
    this.insertEntryTag = db.prepare('INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) VALUES (?, ?)');
    this.selectTags = db.prepare(`
      SELECT t.name
      FROM entry_tags et
      JOIN tags t ON t.id = et.tag_id
      WHERE et.entry_id = ?
      ORDER BY t.name
    `);
  }

  addEntry({
    mood,
    note,
    energy = null,
    anxiety = null,
    sleep_hours = null,
    sleep_quality = null,
    social = null,
    context = null,
    tags = [],
    recordedAt = undefined,
  } = {}) {
    const now = Date.now();
    const recorded_at = recordedAt == null ? now : Number(recordedAt);
    const row = {
      id: randomUUID(),
      recorded_at,
      created_at: now,
      updated_at: now,
      mood: assertRating('mood', mood, { required: true }),
      note: assertNote(note),
      energy: assertRating('energy', energy),
      anxiety: assertRating('anxiety', anxiety),
      sleep_hours: assertSleepHours(sleep_hours),
      sleep_quality: assertRating('sleep_quality', sleep_quality),
      social: assertSocial(social),
      context: assertContext(context),
    };
    const names = normalizeTags(tags);
    withTransaction(this.db, () => {
      this.insertEntry.run(row);
      this.replaceTags(row.id, names);
    });
    return this.getEntry(row.id);
  }

  updateEntry(id, patch = {}) {
    const entryId = assertEntryId(id);
    const existing = this.selectEntry.get(entryId);
    if (!existing || existing.deleted_at != null) {
      throw new Error('Unknown entry');
    }
    const next = {
      id: entryId,
      mood: patch.mood === undefined ? existing.mood : assertRating('mood', patch.mood, { required: true }),
      note: patch.note === undefined ? existing.note : assertNote(patch.note),
      energy: patch.energy === undefined ? existing.energy : assertRating('energy', patch.energy),
      anxiety: patch.anxiety === undefined ? existing.anxiety : assertRating('anxiety', patch.anxiety),
      sleep_hours: patch.sleep_hours === undefined ? existing.sleep_hours : assertSleepHours(patch.sleep_hours),
      sleep_quality:
        patch.sleep_quality === undefined ? existing.sleep_quality : assertRating('sleep_quality', patch.sleep_quality),
      social: patch.social === undefined ? existing.social : assertSocial(patch.social),
      context: patch.context === undefined ? existing.context : assertContext(patch.context),
      updated_at: Date.now(),
    };
    withTransaction(this.db, () => {
      const info = this.updateSql.run(next);
      if (info.changes !== 1) throw new Error('Unknown entry');
      if (patch.tags !== undefined) {
        this.replaceTags(entryId, normalizeTags(patch.tags));
      }
    });
    return this.getEntry(entryId);
  }

  deleteEntry(id) {
    const entryId = assertEntryId(id);
    const info = this.softDelete.run({ id: entryId, deleted_at: Date.now() });
    if (info.changes !== 1) throw new Error('Unknown entry');
    return { id: entryId, deleted: true };
  }

  getEntry(id) {
    const entryId = assertEntryId(id);
    const row = this.selectEntry.get(entryId);
    if (!row || row.deleted_at != null) return null;
    return { ...row, tags: this.tagsFor(entryId) };
  }

  tagsFor(entryId) {
    return this.selectTags.all(entryId).map((r) => r.name);
  }

  replaceTags(entryId, names) {
    this.clearTags.run(entryId);
    for (const name of names) {
      this.insertTag.run(name);
      const tag = this.selectTagId.get(name);
      this.insertEntryTag.run(entryId, tag.id);
    }
  }
}
