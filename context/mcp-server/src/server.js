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
    'Assemble a JSON dump of recent messages, upcoming calendar events, and inbox email from the messages, calendar, and email MCP servers. Read-only; does not read OpenClaw workspace files.',
    {},
    TOOL_ANNOTATIONS,
    async () => tools.generateContext(),
  );

  return server;
}
