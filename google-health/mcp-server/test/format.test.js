import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatActivityDays, formatExercise, formatSleep, stripLocation } from '../src/format.js';

const sleepPoint = {
  name: 'users/me/dataTypes/sleep/dataPoints/s1',
  sleep: {
    interval: {
      startTime: '2026-09-09T02:30:00Z',
      endTime: '2026-09-09T10:30:00Z',
    },
    type: 'STAGES',
    stages: [
      { startTime: '2026-09-09T02:30:00Z', endTime: '2026-09-09T04:30:00Z', type: 'LIGHT' },
      { startTime: '2026-09-09T04:30:00Z', endTime: '2026-09-09T06:00:00Z', type: 'DEEP' },
      { startTime: '2026-09-09T06:00:00Z', endTime: '2026-09-09T08:00:00Z', type: 'REM' },
      { startTime: '2026-09-09T08:00:00Z', endTime: '2026-09-09T10:30:00Z', type: 'AWAKE' },
    ],
    shortAwakenings: [{ startTime: '2026-09-09T05:00:00Z', endTime: '2026-09-09T05:02:00Z' }],
  },
};

const exercisePoint = {
  name: 'users/me/dataTypes/exercise/dataPoints/e1',
  exercise: {
    interval: {
      startTime: '2026-09-10T14:00:00Z',
      endTime: '2026-09-10T15:00:00Z',
    },
    exerciseMetadata: { activityType: 'RUNNING', hasGps: true },
    metricsSummary: {
      calories: 480,
      distanceMillimeters: 8500000,
      steps: 7200,
      averageHeartRate: 148,
    },
    events: [{ type: 'PAUSE', location: { latitude: 1, longitude: 2 } }],
    laps: [{ gps: { lat: 1 } }],
  },
};

test('formatSleep summarizes stages and hides raw awakenings unless detail', () => {
  const summary = formatSleep(sleepPoint);
  assert.equal(summary.id, 's1');
  assert.equal(summary.duration_hours, 8);
  assert.deepEqual(summary.stage_minutes, { light: 120, deep: 90, rem: 120, awake: 150 });
  assert.equal(summary.short_awakening_count, 1);
  assert.equal(summary.stages, undefined);
  const detail = formatSleep(sleepPoint, { detail: true });
  assert.equal(detail.stages.length, 4);
  assert.equal(JSON.stringify(detail).includes('shortAwakenings'), false);
});

test('formatExercise converts mm and never keeps GPS fields', () => {
  const summary = formatExercise(exercisePoint);
  assert.equal(summary.activity_type, 'RUNNING');
  assert.equal(summary.duration_min, 60);
  assert.equal(summary.calories, 480);
  assert.equal(summary.distance_m, 8500);
  assert.equal(summary.steps, 7200);
  assert.equal(summary.avg_hr, 148);
  assert.equal(summary.laps, undefined);
  const detail = formatExercise(exercisePoint, { detail: true });
  assert.equal(detail.events[0].location, undefined);
  assert.equal(detail.laps[0].gps, undefined);
  assert.equal(JSON.stringify(detail).includes('latitude'), false);
});

test('stripLocation drops nested coordinate keys', () => {
  assert.deepEqual(stripLocation({ keep: 1, gps: { lat: 9 }, nested: { longitude: 1, ok: true } }), {
    keep: 1,
    nested: { ok: true },
  });
});

test('formatActivityDays merges rollups by civil date', () => {
  const days = formatActivityDays(
    { rollupDataPoints: [{ civilStartTime: { year: 2026, month: 9, day: 1 }, steps: { countSum: 8000 } }] },
    { rollupDataPoints: [{ civilStartTime: { year: 2026, month: 9, day: 1 }, activeMinutes: { minutesSum: 42 } }] },
    { rollupDataPoints: [{ civilStartTime: { year: 2026, month: 9, day: 2 }, totalCalories: { caloriesSum: 2100 } }] },
  );
  assert.deepEqual(days, [
    { date: '2026-09-01', steps: 8000, active_minutes: 42, calories: null },
    { date: '2026-09-02', steps: null, active_minutes: null, calories: 2100 },
  ]);
});
