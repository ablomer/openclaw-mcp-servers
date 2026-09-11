import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  civilDayDiff,
  civilKey,
  rfc3339,
  resolveWindow,
  zonedLocalToUtcMs,
} from '../src/time.js';

const noon = zonedLocalToUtcMs(2026, 9, 10, 12, 0, 0);

test('resolveWindow defaults to the last 7 civil days including today', () => {
  const window = resolveWindow({}, { nowMs: noon });
  assert.equal(civilKey(window.fromCivil), '2026-09-04');
  assert.equal(civilKey(window.toCivilExclusive), '2026-09-11');
  assert.equal(window.dayCount, 7);
});

test('resolveWindow today is a single civil day', () => {
  const window = resolveWindow({ today: true }, { nowMs: noon });
  assert.equal(civilKey(window.fromCivil), '2026-09-10');
  assert.equal(civilKey(window.toCivilExclusive), '2026-09-11');
  assert.equal(window.dayCount, 1);
});

test('resolveWindow from/to date-only is half-open', () => {
  const window = resolveWindow({ from: '2026-09-01', to: '2026-09-03' }, { nowMs: noon });
  assert.equal(civilKey(window.fromCivil), '2026-09-01');
  assert.equal(civilKey(window.toCivilExclusive), '2026-09-04');
  assert.equal(window.dayCount, 3);
});

test('resolveWindow rejects ranges over maxDays', () => {
  assert.throws(
    () => resolveWindow({ from: '2026-08-01', to: '2026-09-10' }, { maxDays: 14, nowMs: noon }),
    /14 days/,
  );
});

test('resolveWindow rejects today and week together', () => {
  assert.throws(() => resolveWindow({ today: true, week: true }, { nowMs: noon }), /today or week/);
});

test('civilDayDiff and rfc3339 helpers', () => {
  assert.equal(civilDayDiff({ year: 2026, month: 9, day: 1 }, { year: 2026, month: 9, day: 15 }), 14);
  assert.match(rfc3339(noon), /^2026-09-10T/);
});
