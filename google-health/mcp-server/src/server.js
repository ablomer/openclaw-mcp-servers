import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createTools } from './tools.js';

const DateArg = z.string().min(1).max(128).optional();
const Days90 = z.number().int().min(1).max(90).optional();
const Days14 = z.number().int().min(1).max(14).optional();
const DataPointId = z.string().min(1).max(512);

const RangeArgs = {
  from: DateArg,
  to: DateArg,
  days: Days90,
  today: z.boolean().optional(),
  week: z.boolean().optional(),
};

const TOOL_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
};

export function buildServer(deps) {
  const tools = createTools(deps);
  const server = new McpServer({
    name: 'google-health',
    version: '1.0.0',
  });

  server.tool(
    'list_sleep',
    'List reconciled sleep sessions in a date range. Read-only; never writes health data.',
    RangeArgs,
    TOOL_ANNOTATIONS,
    async (args) => tools.listSleep(args),
  );

  server.tool(
    'get_sleep',
    'Get one sleep session by id, including stage intervals. Read-only.',
    { id: DataPointId },
    TOOL_ANNOTATIONS,
    async (args) => tools.getSleep(args),
  );

  server.tool(
    'list_exercises',
    'List reconciled exercise sessions in a date range. Read-only; never includes GPS.',
    RangeArgs,
    TOOL_ANNOTATIONS,
    async (args) => tools.listExercises(args),
  );

  server.tool(
    'get_exercise',
    'Get one exercise session by id. Read-only; GPS and location fields are stripped.',
    { id: DataPointId },
    TOOL_ANNOTATIONS,
    async (args) => tools.getExercise(args),
  );

  server.tool(
    'summarize_activity',
    'Daily steps, active minutes, and calories. Max 14 days. Read-only.',
    {
      from: DateArg,
      to: DateArg,
      days: Days14,
      today: z.boolean().optional(),
      week: z.boolean().optional(),
    },
    TOOL_ANNOTATIONS,
    async (args) => tools.summarizeActivity(args),
  );

  return server;
}
