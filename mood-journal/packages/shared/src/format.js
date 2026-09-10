import { displayRecordedAt } from './time.js';

const HIDDEN = new Set(['recorded_at', 'created_at', 'updated_at', 'deleted_at', 'rowid']);

export function round1(value) {
  if (value == null || Number.isNaN(Number(value))) return null;
  return Math.round(Number(value) * 10) / 10;
}

export function formatEntry(row, tags = []) {
  return {
    id: row.id,
    display_recorded_at: displayRecordedAt(row.recorded_at),
    mood: row.mood,
    note: row.note,
    energy: row.energy,
    anxiety: row.anxiety,
    sleep_hours: row.sleep_hours,
    sleep_quality: row.sleep_quality,
    social: row.social,
    context: row.context,
    tags,
  };
}

export function assertNoRawTimestamps(payload) {
  const json = JSON.stringify(payload);
  for (const key of HIDDEN) {
    if (new RegExp(`"${key}"`).test(json)) {
      throw new Error(`payload leaked ${key}`);
    }
  }
}
