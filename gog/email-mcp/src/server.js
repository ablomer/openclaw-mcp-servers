import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createTools } from './tools.js';

const Query = z.string().min(1).max(2000);
const MessageId = z.string().min(1).max(256);
const Format = z.enum(['full', 'metadata']).optional();

const TOOL_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
};

export function buildServer(deps) {
  const tools = createTools(deps);
  const server = new McpServer({
    name: 'email-readonly',
    version: '1.0.0',
  });

  server.tool(
    'search_messages',
    'Search Gmail with Gmail query syntax. Read-only; never sends mail.',
    {
      query: Query,
      max: z.number().int().min(1).max(50).optional(),
    },
    TOOL_ANNOTATIONS,
    async (args) => tools.searchMessages(args),
  );

  server.tool(
    'get_message',
    'Read one Gmail message by id. Body is sanitized. Never sends mail.',
    {
      id: MessageId,
      format: Format,
    },
    TOOL_ANNOTATIONS,
    async (args) => tools.getMessage(args),
  );

  server.tool(
    'get_thread',
    'Read one Gmail thread by id. Body is sanitized. Never sends mail.',
    { id: MessageId },
    TOOL_ANNOTATIONS,
    async (args) => tools.getThread(args),
  );

  server.tool(
    'list_labels',
    'List Gmail labels. Read-only.',
    {},
    TOOL_ANNOTATIONS,
    async () => tools.listLabels(),
  );

  return server;
}
