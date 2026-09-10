import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createTools } from './tools.js';

const Rating = z.coerce.number().int().min(1).max(10);
const OptionalRating = Rating.nullish();
const Note = z.string().min(1).max(8000);
const Tags = z.array(z.string()).max(12).optional();
const Social = z.enum(['alone', 'one_on_one', 'group']).nullish();
const Context = z.enum(['home', 'work', 'travel', 'outdoors', 'other']).nullish();
const DateArg = z.string().min(1).optional();
const EntryId = z.string().uuid();

const TOOL_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
};

export function buildServer(db) {
  const tools = createTools(db);
  const server = new McpServer({
    name: 'mood-journal',
    version: '1.0.0',
  });

  server.tool(
    'add_entry',
    'Record a mood journal entry. The server sets the timestamp; do not send recorded_at.',
    {
      mood: Rating,
      note: Note,
      energy: OptionalRating,
      anxiety: OptionalRating,
      sleep_hours: z.coerce.number().min(0).max(24).nullish(),
      sleep_quality: OptionalRating,
      social: Social,
      context: Context,
      tags: Tags,
    },
    TOOL_ANNOTATIONS,
    async (args) => tools.addEntry(args),
  );

  server.tool(
    'update_entry',
    'Update fields on an existing entry. Cannot change when it was recorded.',
    {
      id: EntryId,
      mood: Rating.optional(),
      note: Note.optional(),
      energy: OptionalRating,
      anxiety: OptionalRating,
      sleep_hours: z.coerce.number().min(0).max(24).nullish(),
      sleep_quality: OptionalRating,
      social: Social,
      context: Context,
      tags: Tags,
    },
    TOOL_ANNOTATIONS,
    async (args) => tools.updateEntry(args),
  );

  server.tool(
    'delete_entry',
    'Soft-delete a journal entry by id.',
    { id: EntryId },
    TOOL_ANNOTATIONS,
    async (args) => tools.deleteEntry(args),
  );

  server.tool(
    'get_entry',
    'Fetch one journal entry, including display_recorded_at and tags.',
    { id: EntryId },
    TOOL_ANNOTATIONS,
    async (args) => tools.getEntry(args),
  );

  server.tool(
    'list_entries',
    'List journal entries. Date filters use YYYY-MM-DD, YYYY-MM-DDTHH:mm, or a display_recorded_at value.',
    {
      from: DateArg,
      to: DateArg,
      before: DateArg,
      mood_min: Rating.optional(),
      mood_max: Rating.optional(),
      tags: Tags,
      limit: z.number().int().min(1).max(50).optional(),
    },
    TOOL_ANNOTATIONS,
    async (args) => tools.listEntries(args),
  );

  server.tool(
    'search_entries',
    'Full-text search over journal notes. Returns snippets only.',
    {
      query: z.string().min(2),
      from: DateArg,
      to: DateArg,
      limit: z.number().int().min(1).max(50).optional(),
    },
    TOOL_ANNOTATIONS,
    async (args) => tools.searchEntries(args),
  );

  server.tool(
    'summarize_range',
    'Aggregate mood, energy, anxiety, sleep, weekdays, and top tags for a date range.',
    { from: DateArg, to: DateArg },
    TOOL_ANNOTATIONS,
    async (args) => tools.summarizeRange(args),
  );

  server.tool(
    'mood_by_period',
    'Average mood bucketed by day, week, or month.',
    {
      period: z.enum(['day', 'week', 'month']).optional(),
      from: DateArg,
      to: DateArg,
    },
    TOOL_ANNOTATIONS,
    async (args) => tools.moodByPeriod(args),
  );

  server.tool(
    'compare_tagged',
    'Compare average mood when a tag is present versus absent.',
    { tag: z.string().min(1), from: DateArg, to: DateArg },
    TOOL_ANNOTATIONS,
    async (args) => tools.compareTagged(args),
  );

  server.tool(
    'list_tags',
    'List known tags with usage counts.',
    {},
    TOOL_ANNOTATIONS,
    async () => tools.listTags(),
  );

  return server;
}
