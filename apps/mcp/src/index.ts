import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { mcpTools } from '@hallway/shared/mcp';

const endpoint = new URL(process.env.HALLWAY_API_URL || 'http://127.0.0.1:3000');
const token = process.env.HALLWAY_MCP_TOKEN;
if (!token)
  throw new Error('Set HALLWAY_MCP_TOKEN to a credential issued in Hallway Quest Profile.');
if (
  endpoint.protocol !== 'https:' &&
  !(
    endpoint.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname)
  )
) {
  throw new Error('Use HTTPS or an HTTP loopback address.');
}

const server = new McpServer({ name: 'hallway-quest', version: '0.1.0' });
for (const [name, tool] of Object.entries(mcpTools)) {
  server.registerTool(
    name,
    {
      description: tool.description,
      inputSchema: tool.input.shape,
      annotations: {
        readOnlyHint: name !== 'complete_quest' && name !== 'create_schedule_event',
        destructiveHint: false,
        idempotentHint: name === 'complete_quest',
        openWorldHint: false,
      },
    },
    async (input: unknown): Promise<CallToolResult> => {
      try {
        const response = await fetch(new URL('/api/mcp/tools/' + name, endpoint), {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
          signal: AbortSignal.timeout(45000),
          redirect: 'error',
        });
        const data: unknown = await response.json();
        return { isError: !response.ok, content: [{ type: 'text', text: JSON.stringify(data) }] };
      } catch {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: 'Hallway Quest is unavailable. Check the API URL and try again.',
            },
          ],
        };
      }
    },
  );
}
await server.connect(new StdioServerTransport());
