import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CALENDAR_DISABLED } from '@openclaw-gog/shared';
import { createTools } from '../src/tools.js';

function fakeRunner() {
  const calls = [];
  const runGog = async (args) => {
    calls.push(args);
    return { exitCode: 0, stdout: '{"ok":true}', stderr: '', timedOut: false };
  };
  return { calls, tools: createTools({ runGog }) };
}

function afterDash(args) {
  const i = args.indexOf('--');
  assert.ok(i >= 0, 'expected -- before positionals');
  return args.slice(i + 1);
}

function assertNoAdmin(args) {
  assert.equal(args.includes('create-calendar'), false);
  assert.equal(args.includes('delete-calendar'), false);
  assert.equal(args.includes('acl'), false);
  const disabled = args[args.indexOf('--disable-commands') + 1];
  assert.equal(disabled, CALENDAR_DISABLED);
  assert.match(disabled, /create-calendar/);
}

test('create_event writes an appointment, never create-calendar', async () => {
  const { calls, tools } = fakeRunner();
  await tools.createEvent({
    calendar_id: 'primary',
    summary: '--force',
    from: '2026-09-08T10:00:00-04:00',
    to: '2026-09-08T10:30:00-04:00',
    attendees: ['ada@example.com', 'al@example.com'],
    all_day: false,
  });
  const args = calls[0];
  assertNoAdmin(args);
  assert.ok(args.includes('create'));
  assert.equal(args[args.indexOf('--summary') + 1], '--force');
  assert.equal(args[args.indexOf('--attendees') + 1], 'ada@example.com,al@example.com');
  assert.deepEqual(afterDash(args), ['primary']);
});

test('update_event and delete_event keep ids after --', async () => {
  const { calls, tools } = fakeRunner();
  await tools.updateEvent({
    calendar_id: '--account evil',
    event_id: 'evt1',
    summary: 'Moved',
    scope: 'single',
    original_start: '2026-09-08T10:00:00-04:00',
  });
  await tools.deleteEvent({
    calendar_id: 'primary',
    event_id: 'evt1 && rm -rf /',
  });
  assertNoAdmin(calls[0]);
  assertNoAdmin(calls[1]);
  assert.deepEqual(afterDash(calls[0]), ['--account evil', 'evt1']);
  assert.ok(calls[1].includes('--force'));
  assert.deepEqual(afterDash(calls[1]), ['primary', 'evt1 && rm -rf /']);
  assert.equal(calls[1].filter((a) => a === 'acl').length, 0);
});

test('search_events treats a shell-looking query as one positional', async () => {
  const { calls, tools } = fakeRunner();
  const query = 'dentist && gog calendar create-calendar';
  await tools.searchEvents({ query });
  const args = calls[0];
  assertNoAdmin(args);
  assert.deepEqual(afterDash(args), [query]);
  assert.equal(args.includes('create-calendar'), false);
});

test('list_calendars / list_events / get_event / scheduling helpers', async () => {
  const { calls, tools } = fakeRunner();
  await tools.listCalendars();
  await tools.listEvents({ today: true, query: 'standup', max: 5 });
  await tools.getEvent({ event_id: 'abc' });
  await tools.findConflicts({ week: true });
  await tools.getFreebusy({
    from: '2026-09-08T09:00:00-04:00',
    to: '2026-09-08T18:00:00-04:00',
  });
  await tools.respondEvent({ event_id: 'abc', status: 'tentative' });

  assert.deepEqual(calls[0].slice(-2), ['calendar', 'calendars']);
  assert.ok(calls[1].includes('--today'));
  assert.equal(calls[1][calls[1].indexOf('--query') + 1], 'standup');
  assert.deepEqual(afterDash(calls[2]), ['primary', 'abc']);
  assert.ok(calls[3].includes('conflicts'));
  assert.ok(calls[4].includes('freebusy'));
  assert.equal(calls[5][calls[5].indexOf('--status') + 1], 'tentative');
  for (const args of calls) assertNoAdmin(args);
});
