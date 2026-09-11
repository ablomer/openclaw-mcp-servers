import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTools } from '../src/tools.js';
import { truncatePayload } from '../src/validate.js';
import { zonedLocalToUtcMs } from '@openclaw-google-health/shared';

function parse(result) {
  assert.equal(result.isError, undefined);
  return JSON.parse(result.content[0].text);
}

function fakeClient(overrides = {}) {
  const calls = [];
  const client = {
    async reconcileSleep(fromMs, toMsExclusive) {
      calls.push({ op: 'reconcileSleep', fromMs, toMsExclusive });
      return {
        dataPoints: [
          {
            name: 'users/me/dataTypes/sleep/dataPoints/s1',
            sleep: {
              interval: { startTime: '2026-09-09T02:30:00Z', endTime: '2026-09-09T10:30:00Z' },
              type: 'STAGES',
              stages: [],
              shortAwakenings: [],
            },
          },
        ],
        truncated: false,
      };
    },
    async reconcileExercise(fromMs, toMsExclusive) {
      calls.push({ op: 'reconcileExercise', fromMs, toMsExclusive });
      return { dataPoints: [], truncated: false };
    },
    async getDataPoint(dataType, id) {
      calls.push({ op: 'getDataPoint', dataType, id });
      if (dataType === 'sleep') {
        return {
          name: `users/me/dataTypes/sleep/dataPoints/${id}`,
          sleep: {
            interval: { startTime: '2026-09-09T02:30:00Z', endTime: '2026-09-09T10:30:00Z' },
            type: 'STAGES',
            stages: [{ startTime: '2026-09-09T02:30:00Z', endTime: '2026-09-09T04:30:00Z', type: 'LIGHT' }],
          },
        };
      }
      return {
        name: `users/me/dataTypes/exercise/dataPoints/${id}`,
        exercise: {
          interval: { startTime: '2026-09-10T14:00:00Z', endTime: '2026-09-10T14:30:00Z' },
          exerciseMetadata: { activityType: 'WALKING', hasGps: true },
          metricsSummary: { calories: 120, distanceMillimeters: 2000000 },
          events: [{ location: { latitude: 40.7 } }],
        },
      };
    },
    async dailyRollUp(dataType, fromCivil, toCivilExclusive) {
      calls.push({ op: 'dailyRollUp', dataType, fromCivil, toCivilExclusive });
      if (dataType === 'steps') {
        return { rollupDataPoints: [{ civilStartTime: fromCivil, steps: { countSum: 1000 } }] };
      }
      return { rollupDataPoints: [] };
    },
    ...overrides,
  };
  return { calls, tools: createTools({ client }) };
}

test('list_sleep shapes sessions and uses the requested window', async () => {
  const { calls, tools } = fakeClient();
  const payload = parse(await tools.listSleep({ from: '2026-09-01', to: '2026-09-07' }));
  assert.equal(payload.sessions[0].id, 's1');
  assert.equal(payload.sessions[0].duration_hours, 8);
  assert.equal(payload.truncated, false);
  assert.equal(calls[0].op, 'reconcileSleep');
  assert.equal(calls[0].fromMs, zonedLocalToUtcMs(2026, 9, 1, 0, 0, 0));
  assert.equal(calls[0].toMsExclusive, zonedLocalToUtcMs(2026, 9, 8, 0, 0, 0));
});

test('get_sleep includes stages and get_exercise strips GPS', async () => {
  const { tools } = fakeClient();
  const sleep = parse(await tools.getSleep({ id: 's1' }));
  assert.equal(sleep.session.stages[0].type, 'LIGHT');
  const exercise = parse(await tools.getExercise({ id: 'e1' }));
  assert.equal(exercise.session.activity_type, 'WALKING');
  assert.equal(JSON.stringify(exercise).includes('latitude'), false);
});

test('summarize_activity uses a 14-day cap', async () => {
  const { tools } = fakeClient();
  const failed = await tools.summarizeActivity({ from: '2026-08-01', to: '2026-09-10' });
  assert.equal(failed.isError, true);
  assert.match(failed.content[0].text, /14 days/);
  const payload = parse(await tools.summarizeActivity({ from: '2026-09-01', to: '2026-09-07' }));
  assert.deepEqual(payload.days[0], {
    date: '2026-09-01',
    steps: 1000,
    active_minutes: null,
    calories: null,
  });
});

test('auth errors become error results', async () => {
  const { tools } = fakeClient({
    async reconcileSleep() {
      throw new Error('not authenticated; run scripts/auth.mjs');
    },
  });
  const result = await tools.listSleep({ today: true });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /not authenticated/);
});

test('truncatePayload replaces oversized JSON', () => {
  const stub = JSON.parse(truncatePayload({ blob: 'x'.repeat(40_000) }));
  assert.equal(stub.truncated, true);
  assert.equal(stub.reason, 'payload exceeded 32KiB cap');
});
