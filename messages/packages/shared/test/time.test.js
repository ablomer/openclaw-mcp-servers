import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  civilKey,
  displayTime,
  parseDateArg,
  resolveDayRange,
  zonedLocalToUtcMs,
} from '../src/time.js';

const noon = zonedLocalToUtcMs(2026, 9, 10, 12, 0, 0);

test('displayTime formats America/New_York and round-trips', () => {
  const ms = Date.UTC(2026, 8, 7, 17, 10, 32);
  const display = displayTime(ms);
  assert.match(display, /2026-09-07 1:10:32 PM EDT$/);
  assert.match(display, /^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday), /);
  assert.equal(parseDateArg(display), ms);
});

test('parseDateArg interprets calendar dates in America/New_York', () => {
  const start = parseDateArg('2026-09-07', { bound: 'start' });
  const end = parseDateArg('2026-09-07', { bound: 'end' });
  assert.equal(start, zonedLocalToUtcMs(2026, 9, 7, 0, 0, 0));
  assert.ok(end > start);
  assert.ok(end < parseDateArg('2026-09-08', { bound: 'start' }));
});

test('resolveDayRange defaults to the last 3 civil days including today', () => {
  const window = resolveDayRange({}, { nowMs: noon });
  assert.equal(window.from, '2026-09-08');
  assert.equal(window.to, '2026-09-10');
  assert.equal(window.dayCount, 3);
});

test('resolveDayRange from/to date-only is inclusive', () => {
  const window = resolveDayRange({ from: '2026-09-07', to: '2026-09-10' }, { nowMs: noon });
  assert.equal(window.from, '2026-09-07');
  assert.equal(window.to, '2026-09-10');
  assert.equal(window.dayCount, 4);
  assert.equal(civilKey({ year: 2026, month: 9, day: 7 }), '2026-09-07');
});

test('resolveDayRange today is a single civil day', () => {
  const window = resolveDayRange({ today: true }, { nowMs: noon });
  assert.equal(window.from, '2026-09-10');
  assert.equal(window.to, '2026-09-10');
  assert.equal(window.dayCount, 1);
});

test('resolveDayRange rejects ranges over maxDays', () => {
  assert.throws(
    () => resolveDayRange({ from: '2026-08-01', to: '2026-09-10' }, { maxDays: 14, nowMs: noon }),
    /14 days/,
  );
});

test('resolveDayRange rejects mixed window flags', () => {
  assert.throws(() => resolveDayRange({ today: true, days: 3 }, { nowMs: noon }), /today, days/);
  assert.throws(() => resolveDayRange({ days: 3, from: '2026-09-01' }, { nowMs: noon }), /days or from/);
});
