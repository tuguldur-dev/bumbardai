import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mcpTools } from '@hallway/shared/mcp';

const url = new URL(process.env.HALLWAY_API_URL || 'http://127.0.0.1:3000');
assert.ok(
  ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname),
  'Run this smoke test against a local test stack.',
);
const register = await fetch(new URL('/api/auth/register', url), {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: 'mcp-' + randomUUID() + '@example.test',
    password: 'hallway-smoke-test',
    demo: true,
  }),
});
assert.equal(register.status, 201, await register.text());
const cookie = register.headers.get('set-cookie')?.split(';')[0];
assert.ok(cookie);
const credential = await fetch(new URL('/api/mcp/credentials', url), {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', cookie },
  body: JSON.stringify({ label: 'SDK smoke test', canSchedule: true }),
});
assert.equal(credential.status, 200);
const { token, id } = (await credential.json()) as { token: string; id: string };
const client = new Client({ name: 'hallway-external-smoke', version: '1.0.0' });
const remote = new Client({ name: 'hallway-remote-smoke', version: '1.0.0' });
try {
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ['--import', 'tsx', fileURLToPath(new URL('index.ts', import.meta.url))],
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env: { HALLWAY_API_URL: url.href, HALLWAY_MCP_TOKEN: token },
    }),
  );
  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), Object.keys(mcpTools).sort());
  const result = await client.callTool({
    name: 'get_next_event',
    arguments: {
      includeRecommendation: true,
      question: 'I have 15 minutes. What should I do next?',
    },
  });
  assert.ok(!result.isError);
  const content = Array.isArray(result.content) ? result.content[0] : null;
  assert.equal(content?.type, 'text');
  const value = JSON.parse(String(content?.text));
  assert.equal(value.recommendation.action.kind, 'quest');
  assert.equal(value.recommendation.minutes, 15);
  const denied = await client.callTool({
    name: 'complete_quest',
    arguments: { questId: randomUUID() },
  });
  assert.equal(denied.isError, true);
  await remote.connect(
    new StreamableHTTPClientTransport(new URL('/mcp', url), {
      requestInit: { headers: { Authorization: 'Bearer ' + token } },
    }),
  );
  const remoteTools = await remote.listTools();
  assert.deepEqual(remoteTools.tools.map((tool) => tool.name).sort(), Object.keys(mcpTools).sort());
  const remoteRecommendation = await remote.callTool({
    name: 'get_next_event',
    arguments: { includeRecommendation: true, question: 'What should I do next?' },
  });
  assert.ok(!remoteRecommendation.isError);
  const created = await remote.callTool({
    name: 'create_schedule_event',
    arguments: {
      event: {
        title: 'MCP smoke meeting',
        category: 'meeting',
        zone: 'America/Denver',
        startsAt: '2026-11-10T20:00:00Z',
        endsAt: '2026-11-10T21:00:00Z',
        day: null,
      },
    },
  });
  assert.ok(!created.isError);
  const entry = Array.isArray(created.content) ? created.content[0] : null;
  assert.equal(entry?.type, 'text');
  assert.equal(JSON.parse(String(entry?.text)).event.title, 'MCP smoke meeting');
  console.log('Verified stdio and remote MCP, recommendation, write scopes, and event creation.');
} finally {
  await remote.close();
  await client.close();
  await fetch(new URL('/api/mcp/credentials/' + id, url), {
    method: 'DELETE',
    headers: { cookie },
  });
  await fetch(new URL('/api/auth/logout', url), { method: 'POST', headers: { cookie } });
}
