import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createTools } from './tools.js';

const Source = z.enum(['whatsapp', 'gmessages', 'instagram']);

const TOOL_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
};

export function buildServer(db) {
  const tools = createTools(db);
  const server = new McpServer({
    name: 'messages',
    version: '1.0.0',
  });

  server.tool(
    'list_recent_conversations',
    'List recent message threads from the local read-only archive. Never sends messages.',
    {
      source: Source.optional(),
      limit: z.number().int().min(1).max(50).optional(),
      before_ts: z.number().optional(),
    },
    TOOL_ANNOTATIONS,
    async (args) => tools.listRecentConversations(args),
  );

  server.tool(
    'get_thread_history',
    'Fetch recent history for a single chat_id (newest first). Read-only.',
    {
      chat_id: z.string().min(3),
      limit: z.number().int().min(1).max(200).optional(),
      before_ts: z.number().optional(),
    },
    TOOL_ANNOTATIONS,
    async (args) => tools.getThreadHistory(args),
  );

  server.tool(
    'list_messages',
    'List archived messages in a calendar-day range, grouped by thread. Dates are YYYY-MM-DD in America/New_York. Read-only.',
    {
      from: z.string().min(1).max(128).optional(),
      to: z.string().min(1).max(128).optional(),
      days: z.number().int().min(1).max(14).optional(),
      today: z.boolean().optional(),
      source: Source.optional(),
      limit: z.number().int().min(1).max(200).optional(),
      include_empty: z.boolean().optional(),
    },
    TOOL_ANNOTATIONS,
    async (args) => tools.listMessages(args),
  );

  server.tool(
    'search_messages',
    'Full-text search over archived message bodies. Returns snippets only, never raw_json.',
    {
      query: z.string().min(2),
      source: Source.optional(),
      chat_id: z.string().optional(),
      limit: z.number().int().min(1).max(50).optional(),
      before_ts: z.number().optional(),
    },
    TOOL_ANNOTATIONS,
    async (args) => tools.searchMessages(args),
  );

  return server;
}
