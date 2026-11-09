import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { mcpTools } from '@hallway/shared/mcp';
import { z } from 'zod';
import { digest, HttpError, requireUser, secret } from '../auth/auth.js';
import { db } from '../../shared/db.js';
import { agenda, createEvent, nextEvent } from '../schedule/events.js';
import { clock, localDay } from '../schedule/calendar.js';
import { catalogQuery, catalogSearch, nextSession } from '../explore/catalog.js';
import { nextAction, today } from '../today/today.js';
import { venueFor, weather } from '../today/weather.js';
import { findPeople } from '../explore/people.js';
import { oauthRoutes, publicMcpOrigin } from './oauth.js';
import { traced } from '../../shared/telemetry.js';
import {
  activeQuests,
  completeQuest,
  generateQuest,
  icebreaker,
  progress,
} from '../quests/quests.js';

const tokenSelect = {
  id: true,
  label: true,
  canWrite: true,
  canSchedule: true,
  expiresAt: true,
} as const;

async function credential(request: FastifyRequest) {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ') || header.length > 150)
    throw new HttpError(401, 'An MCP credential is required.');
  const value = header.slice(7);
  const hash = digest(value);
  const grant = value.startsWith('hq_oauth_')
    ? await db.mcpOAuthGrant.findFirst({
        where: {
          accessDigest: hash,
          resource: publicMcpOrigin() + '/mcp',
          expiresAt: { gt: new Date() },
        },
        include: { client: { include: { user: true } } },
      })
    : null;
  const token = value.startsWith('hq_oauth_')
    ? grant?.client
    : await db.mcpToken.findUnique({ where: { digest: hash }, include: { user: true } });
  if (!token || token.expiresAt <= new Date())
    throw new HttpError(401, 'This MCP credential is invalid or expired.');
  return token;
}

type Credential = NonNullable<Awaited<ReturnType<typeof credential>>>;
type ToolName = keyof typeof mcpTools;

async function executeTool(token: Credential, tool: ToolName, input: unknown) {
  const { user } = token;
  const now = clock(user.demo);
  switch (tool) {
    case 'get_my_schedule': {
      const { from, until } = mcpTools[tool].input.parse(input);
      if ((from && !until) || (!from && until) || (from && until && until <= from))
        throw new HttpError(400, 'Provide both dates, with until after from.');
      return agenda(user.id, from, until);
    }
    case 'get_next_event': {
      const { includeRecommendation, question } = mcpTools[tool].input.parse(input);
      const event = await nextEvent(user.id, now);
      return includeRecommendation
        ? {
            event,
            recommendation: await nextAction(user, question ?? 'What should I do next?', false),
          }
        : { event };
    }
    case 'get_weather_forecast': {
      const { day } = mcpTools[tool].input.parse(input);
      const event = await nextEvent(user.id, now);
      return weather(day ?? localDay(now), user.demo, venueFor(event?.location));
    }
    case 'get_preparation_checklist': {
      const { eventId } = mcpTools[tool].input.parse(input);
      const event = eventId
        ? await db.event.findFirst({
            where: { id: eventId, userId: user.id },
            include: { checklist: true },
          })
        : await nextEvent(user.id, now);
      if (eventId && !event) throw new HttpError(404, 'Event not found.');
      return { eventId: event?.id, title: event?.title, items: event?.checklist ?? [] };
    }
    case 'search_sessions':
      return catalogSearch(user, catalogQuery.parse(mcpTools[tool].input.parse(input)));
    case 'complete_quest': {
      if (!token.canWrite) throw new HttpError(403, 'This credential cannot complete quests.');
      const { questId } = mcpTools[tool].input.parse(input);
      return completeQuest(user.id, questId);
    }
    case 'create_schedule_event': {
      if (!token.canSchedule)
        throw new HttpError(403, 'This credential cannot create schedule events.');
      const { event } = mcpTools[tool].input.parse(input);
      return createEvent(user.id, event);
    }
    case 'generate_icebreaker': {
      const { topic } = mcpTools[tool].input.parse(input);
      return icebreaker(user, undefined, topic);
    }
    case 'get_daily_briefing':
      mcpTools[tool].input.parse(input);
      return today(user);
    case 'recommend_sessions':
      mcpTools[tool].input.parse(input);
      return { session: await nextSession(user, await agenda(user.id)) };
    case 'generate_quests':
      mcpTools[tool].input.parse(input);
      return generateQuest(user, false);
    case 'get_active_quests':
      mcpTools[tool].input.parse(input);
      return activeQuests(user.id);
    case 'find_opt_in_connections':
      mcpTools[tool].input.parse(input);
      return findPeople(user);
    case 'get_my_progress':
      mcpTools[tool].input.parse(input);
      return progress(user.id);
  }
}

function remoteServer(token: Credential) {
  const server = new McpServer({ name: 'Hallway Quest', version: '0.2.0' });
  for (const name of Object.keys(mcpTools) as ToolName[]) {
    const tool = mcpTools[name];
    const write = name === 'complete_quest' || name === 'create_schedule_event';
    server.registerTool(
      name,
      {
        description: tool.description,
        inputSchema: tool.input.shape,
        annotations: {
          readOnlyHint: !write,
          destructiveHint: false,
          idempotentHint: name === 'complete_quest',
          openWorldHint: false,
        },
      },
      async (input: unknown): Promise<CallToolResult> => {
        try {
          const result = await traced('mcp.tool.' + name, () => executeTool(token, name, input));
          return { content: [{ type: 'text', text: JSON.stringify(result) }] };
        } catch (error) {
          const message = error instanceof HttpError ? error.message : 'The MCP tool failed.';
          return { isError: true, content: [{ type: 'text', text: message }] };
        }
      },
    );
  }
  return server;
}

export function mcpRoutes(app: FastifyInstance) {
  void app.register(oauthRoutes);
  app.get('/api/mcp/credentials', async (request) =>
    db.mcpToken.findMany({
      where: { userId: (await requireUser(request)).id, expiresAt: { gt: new Date() } },
      select: tokenSelect,
    }),
  );
  app.post('/api/mcp/credentials', async (request) => {
    const user = await requireUser(request);
    const input = z
      .object({
        label: z.string().trim().min(1).max(80),
        canWrite: z.boolean().default(false),
        canSchedule: z.boolean().default(false),
      })
      .parse(request.body);
    const token = 'hq_' + secret();
    const record = await db.mcpToken.create({
      data: {
        ...input,
        digest: digest(token),
        userId: user.id,
        expiresAt: new Date(Date.now() + 30 * 86400000),
      },
      select: tokenSelect,
    });
    return { ...record, token };
  });
  app.delete('/api/mcp/credentials/:id', async (request, reply) => {
    const user = await requireUser(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    await db.mcpToken.deleteMany({ where: { id, userId: user.id } });
    return reply.code(204).send();
  });
  app.post(
    '/api/mcp/tools/:tool',
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (request) => {
      const token = await credential(request);
      const { tool } = z
        .object({
          tool: z.string().refine((value): value is ToolName => Object.hasOwn(mcpTools, value)),
        })
        .parse(request.params);
      return executeTool(token, tool, request.body ?? {});
    },
  );
  app.all(
    '/mcp',
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const token = await credential(request).catch((error: unknown) => {
        const origin = publicMcpOrigin();
        if (error instanceof HttpError && error.statusCode === 401 && origin)
          reply.header(
            'WWW-Authenticate',
            'Bearer resource_metadata="' + origin + '/.well-known/oauth-protected-resource/mcp"',
          );
        throw error;
      });
      const server = remoteServer(token);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      await server.connect(transport);
      reply.hijack();
      try {
        await transport.handleRequest(request.raw, reply.raw, request.body);
      } catch (error) {
        request.log.warn(
          { name: error instanceof Error ? error.name : 'unknown' },
          'MCP request failed',
        );
        if (!reply.raw.writableEnded) reply.raw.destroy();
      } finally {
        await server.close();
      }
    },
  );
}
