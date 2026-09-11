import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createTools } from './tools.js';

const TOOL_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
};

export function buildServer(deps) {
  const tools = createTools(deps);
  const server = new McpServer({
    name: 'context',
    version: '1.0.0',
  });

  server.tool(
    'generate_context',
    'Assemble a JSON dump of memories, recent messages, upcoming calendar events, and inbox email. Read-only; calls the messages, calendar, and email MCP servers.',
    {},
    TOOL_ANNOTATIONS,
    async () => tools.generateContext(),
  );

  return server;
}
