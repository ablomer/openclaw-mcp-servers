import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createHealthClient,
  dataPointName,
  exerciseFilter,
  sleepFilter,
} from '../src/client.js';
import { zonedLocalToUtcMs } from '../src/time.js';

function mockFetch(replies) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    const reply = replies.shift();
    if (!reply) throw new Error('unexpected fetch');
    return {
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      async text() {
        return reply.body == null ? '' : JSON.stringify(reply.body);
      },
    };
  };
  return { calls, fetchImpl };
}

const fromMs = zonedLocalToUtcMs(2026, 9, 1, 0, 0, 0);
const toMs = zonedLocalToUtcMs(2026, 9, 8, 0, 0, 0);

test('sleep and exercise filters use the correct interval fields', () => {
  const sleep = sleepFilter(fromMs, toMs);
  assert.match(sleep, /sleep\.interval\.end_time >= "/);
  assert.match(sleep, /sleep\.interval\.end_time < "/);
  const exercise = exerciseFilter(fromMs, toMs);
  assert.match(exercise, /exercise\.interval\.start_time >= "/);
  assert.match(exercise, /exercise\.interval\.start_time < "/);
});

test('dataPointName accepts a short id or a full resource name', () => {
  assert.equal(dataPointName('sleep', 'abc'), 'users/me/dataTypes/sleep/dataPoints/abc');
  assert.equal(
    dataPointName('sleep', 'users/me/dataTypes/sleep/dataPoints/abc'),
    'users/me/dataTypes/sleep/dataPoints/abc',
  );
});

test('reconcileSleep pages until the session cap and marks truncated', async () => {
  const page = (id, token) => ({
    status: 200,
    body: {
      dataPoints: [{ name: `users/me/dataTypes/sleep/dataPoints/${id}` }],
      nextPageToken: token,
    },
  });
  const { calls, fetchImpl } = mockFetch([page('a', 'p2'), page('b', 'p3'), page('c', 'p4')]);
  const client = createHealthClient({
    getToken: async () => 'tok',
    fetchImpl,
    maxSessions: 2,
  });
  const result = await client.reconcileSleep(fromMs, toMs);
  assert.equal(result.truncated, true);
  assert.equal(result.dataPoints.length, 2);
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /dataPoints:reconcile/);
  assert.match(calls[0].url, /pageSize=2/);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer tok');
});

test('getDataPoint and dailyRollUp hit the expected paths', async () => {
  const { calls, fetchImpl } = mockFetch([
    { status: 200, body: { name: 'users/me/dataTypes/exercise/dataPoints/e1' } },
    { status: 200, body: { rollupDataPoints: [] } },
  ]);
  const client = createHealthClient({ getToken: async () => 'tok', fetchImpl });
  await client.getDataPoint('exercise', 'e1');
  await client.dailyRollUp('steps', { year: 2026, month: 9, day: 1 }, { year: 2026, month: 9, day: 8 });
  assert.match(calls[0].url, /users\/me\/dataTypes\/exercise\/dataPoints\/e1$/);
  assert.match(calls[1].url, /steps\/dataPoints:dailyRollUp$/);
  assert.equal(calls[1].options.method, 'POST');
  const body = JSON.parse(calls[1].options.body);
  assert.deepEqual(body.range.start, { year: 2026, month: 9, day: 1 });
  assert.deepEqual(body.range.end, { year: 2026, month: 9, day: 8 });
});

test('401 becomes a re-auth error and never leaks the body', async () => {
  const { fetchImpl } = mockFetch([{ status: 401, body: { error: 'nope', token: 'secret' } }]);
  const client = createHealthClient({ getToken: async () => 'tok', fetchImpl });
  await assert.rejects(client.getDataPoint('sleep', 'x'), /not authenticated/);
});
