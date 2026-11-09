import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { dateKey, eventInput, profileInput, timeZone, type EventInput } from '@hallway/shared';
import { z } from 'zod';
import { HttpError, requireUser } from '../auth/auth.js';
import {
  atLocal,
  clock,
  dayAfter,
  localDay,
  overlaps,
  readIcs,
  writeIcs,
  zone,
} from './calendar.js';
import { db } from '../../shared/db.js';
import { preparationCopy } from '../assistant/assistant.js';

const checklistTemplates: Record<string, string[]> = {
  hackathon: [
    'Pack your laptop',
    'Pack your charger',
    'Check GitHub access',
    'Set up development tools',
    'Review registration details',
  ],
  workshop: [
    'Review workshop prerequisites',
    'Check required software',
    'Review registration confirmation',
  ],
  networking: [
    'Practice your introduction',
    'Pick a conversation starter',
    'Prepare a contact-sharing method',
  ],
  session: ['Check the room and time', 'Prepare a question', 'Review your saved notes'],
};
const eventId = z.object({ id: z.string().min(1).max(200) });
const agendaOrder = [
  { startsAt: 'asc' },
  { day: 'asc' },
  { title: 'asc' },
] satisfies Prisma.EventOrderByWithRelationInput[];

function eventData(input: EventInput) {
  return {
    ...input,
    startsAt: input.startsAt ? new Date(input.startsAt) : null,
    endsAt: input.endsAt ? new Date(input.endsAt) : null,
    endDay: input.endDay ?? null,
  };
}

export async function agenda(userId: string, from?: string, until?: string) {
  return db.event.findMany({
    where: {
      userId,
      ...(from && until
        ? {
            OR: [
              {
                startsAt: { lt: atLocal(until + 'T00:00') },
                endsAt: { gt: atLocal(from + 'T00:00') },
              },
              { day: { gte: from, lt: until } },
              { day: { lt: from }, endDay: { gt: from } },
            ],
          }
        : {}),
    },
    include: { checklist: { orderBy: [{ status: 'desc' }, { label: 'asc' }] } },
    orderBy: agendaOrder,
  });
}

export async function nextEvent(userId: string, now: Date) {
  return db.event.findFirst({
    where: { userId, completedAt: null, startsAt: { gte: now } },
    orderBy: { startsAt: 'asc' },
    include: { checklist: true },
  });
}

async function ownedEvent(userId: string, id: string) {
  const event = await db.event.findFirst({ where: { id, userId } });
  if (!event) throw new HttpError(404, 'Event not found.');
  return event;
}

async function saveEvent(
  userId: string,
  input: EventInput,
  confirmConflict: boolean,
  id?: string,
  catalogId?: string,
) {
  const data = eventData(input);
  if (id) await ownedEvent(userId, id);
  return db.$transaction(async (tx) => {
    // Serialize schedule writes that need conflict confirmation for the same attendee.
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
    if (catalogId) {
      const existing = await tx.event.findUnique({
        where: { userId_sourceKey: { userId, sourceKey: 'catalog:' + catalogId } },
      });
      if (existing) return { event: existing, alreadySaved: true };
    }
    if (data.startsAt && data.endsAt && !confirmConflict) {
      const possible = await tx.event.findMany({
        where: {
          userId,
          id: id ? { not: id } : undefined,
          startsAt: { lt: data.endsAt },
          endsAt: { gt: data.startsAt },
        },
      });
      const conflicts = possible
        .filter((event) => overlaps(data.startsAt!, data.endsAt!, event))
        .map((event) => ({ id: event.id, title: event.title }));
      if (conflicts.length) return { conflicts };
    }
    const checklist = {
      create: (checklistTemplates[input.category] ?? []).map((label) => ({ label })),
    };
    const event = id
      ? await tx.event.update({ where: { id, userId }, data, include: { checklist: true } })
      : catalogId
        ? await tx.event.upsert({
            where: { userId_sourceKey: { userId, sourceKey: 'catalog:' + catalogId } },
            update: {},
            create: { ...data, userId, sourceKey: 'catalog:' + catalogId, catalogId, checklist },
          })
        : await tx.event.create({
            data: { ...data, userId, checklist },
            include: { checklist: true },
          });
    return { event };
  });
}

export function createEvent(userId: string, input: EventInput) {
  return saveEvent(userId, input, false);
}

export async function saveCatalogEvent(
  user: { id: string; demo: boolean },
  id: string,
  confirmConflict = false,
  requireTimed = false,
) {
  const item = await db.catalogItem.findFirst({ where: { id, demo: user.demo, active: true } });
  if (!item || (requireTimed && (!item.startsAt || !item.endsAt)))
    throw new HttpError(404, 'Session time is unavailable.');
  return saveEvent(
    user.id,
    eventInput.parse({
      ...item,
      zone,
      startsAt: item.startsAt?.toISOString() ?? null,
      endsAt: item.endsAt?.toISOString() ?? null,
      day: item.startsAt ? null : item.day,
    }),
    confirmConflict,
    undefined,
    id,
  );
}

export function eventRoutes(app: FastifyInstance) {
  app.get('/api/events', async (request) => {
    const user = await requireUser(request);
    const { from, until } = z
      .object({ from: dateKey.optional(), until: dateKey.optional() })
      .parse(request.query);
    if ((from && !until) || (!from && until) || (from && until && until <= from))
      throw new HttpError(400, 'Provide both dates, with until after from.');
    return agenda(user.id, from, until);
  });
  const saveInput = z.object({ event: eventInput, confirmConflict: z.boolean().default(false) });
  app.post('/api/events', async (request) => {
    const user = await requireUser(request);
    const input = saveInput.parse(request.body);
    return saveEvent(user.id, input.event, input.confirmConflict);
  });
  app.put('/api/events/:id', async (request) => {
    const user = await requireUser(request);
    const { id } = eventId.parse(request.params);
    const input = saveInput.parse(request.body);
    return saveEvent(user.id, input.event, input.confirmConflict, id);
  });
  app.post('/api/events/:id/complete', async (request) => {
    const user = await requireUser(request);
    const { id } = eventId.parse(request.params);
    const { completed } = z.object({ completed: z.boolean() }).parse(request.body);
    await ownedEvent(user.id, id);
    return db.event.update({
      where: { id, userId: user.id },
      data: { completedAt: completed ? clock(user.demo) : null },
    });
  });
  app.delete('/api/events/:id', async (request, reply) => {
    const user = await requireUser(request);
    const { id } = eventId.parse(request.params);
    const result = await db.event.deleteMany({ where: { id, userId: user.id } });
    if (!result.count) throw new HttpError(404, 'Event not found.');
    return reply.code(204).send();
  });
  app.post('/api/catalog/:id/save', async (request) => {
    const user = await requireUser(request);
    const { id } = eventId.parse(request.params);
    const { confirmConflict } = z
      .object({ confirmConflict: z.boolean().default(false) })
      .parse(request.body ?? {});
    return saveCatalogEvent(user, id, confirmConflict);
  });
  app.post('/api/events/:id/checklist', async (request) => {
    const user = await requireUser(request);
    const { id } = eventId.parse(request.params);
    const { label } = z.object({ label: z.string().trim().min(1).max(180) }).parse(request.body);
    await ownedEvent(user.id, id);
    return db.checklistItem.create({ data: { eventId: id, label } });
  });
  app.post(
    '/api/events/:id/preparation',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request) => {
      const user = await requireUser(request);
      const { id } = eventId.parse(request.params);
      const event = await db.event.findFirst({
        where: { id, userId: user.id },
        include: { checklist: true },
      });
      if (!event) throw new HttpError(404, 'Event not found.');
      const profile = profileInput.safeParse(user.profile).data;
      const copy = await preparationCopy({
        category: event.category,
        title: event.title,
        interests: profile?.interests,
        goals: profile?.goals,
        existing: event.checklist.map((item) => item.label),
      });
      const fallback = ['Review the activity details', 'Allow time to get to the venue'];
      const added = await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Event" WHERE id = ${id} FOR UPDATE`;
        const known = new Set(
          (await tx.checklistItem.findMany({ where: { eventId: id } })).map((item) =>
            item.label.trim().toLowerCase(),
          ),
        );
        const labels = (copy?.items ?? fallback).filter((label) => {
          const key = label.trim().toLowerCase();
          if (known.has(key)) return false;
          known.add(key);
          return true;
        });
        const result = await tx.checklistItem.createMany({
          data: labels.map((label) => ({ eventId: id, label })),
        });
        return result.count;
      });
      return { added, mode: copy ? 'ai' : 'rules' };
    },
  );
  app.patch('/api/checklist/:id', async (request) => {
    const user = await requireUser(request);
    const { id } = eventId.parse(request.params);
    const item = await db.checklistItem.findFirst({ where: { id, event: { userId: user.id } } });
    if (!item) throw new HttpError(404, 'Checklist item not found.');
    const data = z
      .object({
        label: z.string().trim().min(1).max(180).optional(),
        status: z.enum(['open', 'done', 'dismissed']).optional(),
      })
      .parse(request.body);
    return db.checklistItem.update({ where: { id }, data });
  });
  app.post('/api/calendar/import', async (request) => {
    const user = await requireUser(request);
    const {
      text,
      zone: importZone,
      commit,
    } = z
      .object({
        text: z.string().min(10).max(700000),
        zone: timeZone.default(zone),
        commit: z.boolean().default(false),
      })
      .parse(request.body);
    const day = localDay(clock(user.demo));
    const result = (() => {
      try {
        return readIcs(text, importZone, dayAfter(day, -90), dayAfter(day, 366));
      } catch {
        throw new HttpError(400, 'This file could not be read as an ICS calendar.');
      }
    })();
    const entries = [...new Map(result.entries.map((entry) => [entry.sourceKey, entry])).values()];
    const imported = await db.event.findMany({
      where: { userId: user.id, sourceKey: { in: entries.map((entry) => entry.sourceKey) } },
      select: { sourceKey: true },
    });
    const keys = new Set(imported.map((event) => event.sourceKey));
    if (!commit)
      return {
        skipped: result.skipped,
        entries: entries.map((entry) => ({ ...entry, duplicate: keys.has(entry.sourceKey) })),
      };
    const saved = await db.event.createMany({
      skipDuplicates: true,
      data: entries.map(({ sourceKey, event }) => ({
        ...eventData(event),
        sourceKey,
        userId: user.id,
      })),
    });
    return {
      imported: saved.count,
      skipped: result.skipped,
      duplicates: entries.length - saved.count,
    };
  });
  app.get('/api/calendar/export', async (request, reply) => {
    const user = await requireUser(request);
    return reply
      .type('text/calendar; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename=hallway-quest.ics')
      .send(writeIcs(await agenda(user.id)));
  });
}
