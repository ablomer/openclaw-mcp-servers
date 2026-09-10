import {
  calendarPrefix,
  flagValue,
  parseGogResult,
  positionals,
  runGog as defaultRunGog,
} from '@openclaw-gog/shared';
import { calendarId, clampInt, truncatePayload } from './validate.js';

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

async function invoke(exec, args) {
  try {
    const result = await exec(args);
    const parsed = parseGogResult(result);
    if (!parsed.ok) return errorResult(parsed.error);
    return textResult(parsed.data);
  } catch (err) {
    return errorResult(err?.message || 'gog failed');
  }
}

function eventWriteFlags({
  summary,
  from,
  to,
  description,
  location,
  attendees,
  all_day,
  scope,
  original_start,
}) {
  const flags = [
    ...flagValue('--summary', summary),
    ...flagValue('--from', from),
    ...flagValue('--to', to),
    ...flagValue('--description', description),
    ...flagValue('--location', location),
    ...flagValue(
      '--attendees',
      Array.isArray(attendees) && attendees.length ? attendees.join(',') : '',
    ),
    ...flagValue('--scope', scope),
    ...flagValue('--original-start', original_start),
  ];
  if (all_day) flags.push('--all-day');
  return flags;
}

export function createTools({ runGog } = {}) {
  const exec = runGog ?? defaultRunGog;
  const prefix = () => calendarPrefix();

  return {
    listCalendars() {
      return invoke(exec, [...prefix(), 'calendar', 'calendars']);
    },

    listEvents({
      calendar_id,
      from,
      to,
      days,
      today,
      week,
      query,
      max,
    } = {}) {
      const n = clampInt(max, 20, 1, 50);
      const args = [
        ...prefix(),
        'calendar',
        'events',
        ...flagValue('--cal', calendarId(calendar_id)),
        ...flagValue('--from', from),
        ...flagValue('--to', to),
        ...flagValue('--query', query),
        '--max',
        String(n),
      ];
      if (today) args.push('--today');
      if (week) args.push('--week');
      if (days != null) args.push('--days', String(clampInt(days, 7, 1, 90)));
      return invoke(exec, args);
    },

    getEvent({ calendar_id, event_id } = {}) {
      return invoke(exec, [
        ...prefix(),
        'calendar',
        'event',
        ...positionals(calendarId(calendar_id), event_id),
      ]);
    },

    searchEvents({ query, max } = {}) {
      const n = clampInt(max, 20, 1, 50);
      return invoke(exec, [
        ...prefix(),
        'calendar',
        'search',
        '--max',
        String(n),
        ...positionals(query),
      ]);
    },

    createEvent(args = {}) {
      return invoke(exec, [
        ...prefix(),
        'calendar',
        'create',
        ...eventWriteFlags(args),
        ...positionals(calendarId(args.calendar_id)),
      ]);
    },

    updateEvent(args = {}) {
      return invoke(exec, [
        ...prefix(),
        'calendar',
        'update',
        ...eventWriteFlags(args),
        ...positionals(calendarId(args.calendar_id), args.event_id),
      ]);
    },

    deleteEvent({ calendar_id, event_id, scope, original_start } = {}) {
      return invoke(exec, [
        ...prefix(),
        'calendar',
        'delete',
        '--force',
        ...flagValue('--scope', scope),
        ...flagValue('--original-start', original_start),
        ...positionals(calendarId(calendar_id), event_id),
      ]);
    },

    findConflicts({ calendar_id, from, to, days, today, week } = {}) {
      const args = [
        ...prefix(),
        'calendar',
        'conflicts',
        ...flagValue('--cal', calendarId(calendar_id)),
        ...flagValue('--from', from),
        ...flagValue('--to', to),
      ];
      if (today) args.push('--today');
      if (week) args.push('--week');
      if (days != null) args.push('--days', String(clampInt(days, 7, 1, 90)));
      return invoke(exec, args);
    },

    getFreebusy({ calendar_id, from, to } = {}) {
      return invoke(exec, [
        ...prefix(),
        'calendar',
        'freebusy',
        ...flagValue('--cal', calendarId(calendar_id)),
        ...flagValue('--from', from),
        ...flagValue('--to', to),
      ]);
    },

    respondEvent({ calendar_id, event_id, status } = {}) {
      return invoke(exec, [
        ...prefix(),
        'calendar',
        'respond',
        ...flagValue('--status', status),
        ...positionals(calendarId(calendar_id), event_id),
      ]);
    },
  };
}
