import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createTools } from './tools.js';

const CalendarId = z.string().min(1).max(256).optional();
const EventId = z.string().min(1).max(256);
const DateTime = z.string().min(1).max(128);
const OptionalDateTime = DateTime.optional();
const Summary = z.string().min(1).max(2000);
const Description = z.string().max(8000).optional();
const Location = z.string().max(2000).optional();
const Attendees = z.array(z.string().email().max(320)).max(20).optional();
const Scope = z.enum(['single', 'all']).optional();
const Status = z.enum(['accepted', 'declined', 'tentative']);
const Limit = z.number().int().min(1).max(50).optional();
const Days = z.number().int().min(1).max(90).optional();

const TOOL_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
};

const EventWrite = {
  calendar_id: CalendarId,
  summary: Summary.optional(),
  from: OptionalDateTime,
  to: OptionalDateTime,
  description: Description,
  location: Location,
  attendees: Attendees,
  all_day: z.boolean().optional(),
  scope: Scope,
  original_start: OptionalDateTime,
};

export function buildServer(deps) {
  const tools = createTools(deps);
  const server = new McpServer({
    name: 'calendar',
    version: '1.0.0',
  });

  server.tool(
    'list_calendars',
    'List existing Google calendars. Does not create or delete calendars.',
    {},
    TOOL_ANNOTATIONS,
    async () => tools.listCalendars(),
  );

  server.tool(
    'list_events',
    'List events on an existing calendar (default primary). Cannot create calendars.',
    {
      calendar_id: CalendarId,
      from: OptionalDateTime,
      to: OptionalDateTime,
      days: Days,
      today: z.boolean().optional(),
      week: z.boolean().optional(),
      query: z.string().max(500).optional(),
      max: Limit,
    },
    TOOL_ANNOTATIONS,
    async (args) => tools.listEvents(args),
  );

  server.tool(
    'get_event',
    'Get one event by calendar id and event id.',
    { calendar_id: CalendarId, event_id: EventId },
    TOOL_ANNOTATIONS,
    async (args) => tools.getEvent(args),
  );

  server.tool(
    'search_events',
    'Search events by free-text query.',
    { query: z.string().min(1).max(500), max: Limit },
    TOOL_ANNOTATIONS,
    async (args) => tools.searchEvents(args),
  );

  server.tool(
    'create_event',
    'Create an appointment on an existing calendar. Cannot create a new calendar.',
    {
      ...EventWrite,
      summary: Summary,
      from: DateTime,
      to: DateTime,
    },
    TOOL_ANNOTATIONS,
    async (args) => tools.createEvent(args),
  );

  server.tool(
    'update_event',
    'Update an existing appointment. Cannot create or delete calendars.',
    {
      ...EventWrite,
      event_id: EventId,
    },
    TOOL_ANNOTATIONS,
    async (args) => tools.updateEvent(args),
  );

  server.tool(
    'delete_event',
    'Delete an appointment. Cannot delete a calendar.',
    {
      calendar_id: CalendarId,
      event_id: EventId,
      scope: Scope,
      original_start: OptionalDateTime,
    },
    TOOL_ANNOTATIONS,
    async (args) => tools.deleteEvent(args),
  );

  server.tool(
    'find_conflicts',
    'Find conflicting events in a time range. Read-only.',
    {
      calendar_id: CalendarId,
      from: OptionalDateTime,
      to: OptionalDateTime,
      days: Days,
      today: z.boolean().optional(),
      week: z.boolean().optional(),
    },
    TOOL_ANNOTATIONS,
    async (args) => tools.findConflicts(args),
  );

  server.tool(
    'get_freebusy',
    'Check free/busy for a time range on an existing calendar.',
    {
      calendar_id: CalendarId,
      from: DateTime,
      to: DateTime,
    },
    TOOL_ANNOTATIONS,
    async (args) => tools.getFreebusy(args),
  );

  server.tool(
    'respond_event',
    'RSVP to an event (accepted, declined, or tentative). Not calendar admin.',
    {
      calendar_id: CalendarId,
      event_id: EventId,
      status: Status,
    },
    TOOL_ANNOTATIONS,
    async (args) => tools.respondEvent(args),
  );

  return server;
}
