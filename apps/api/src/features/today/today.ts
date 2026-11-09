import type { User } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { profileInput } from '@hallway/shared';
import { z } from 'zod';
import { assistantActionSchema } from '@hallway/shared/responses';
import { HttpError, requireUser } from '../auth/auth.js';
import { briefingCopy, nextCopy } from '../assistant/assistant.js';
import { clock, dayAfter, freeUntil, localDay, overlaps } from '../schedule/calendar.js';
import {
  catalogQuery,
  catalogSearch,
  ensureDemoCatalog,
  nextSession,
  reasonFor,
} from '../explore/catalog.js';
import { agenda, nextEvent } from '../schedule/events.js';
import { activeQuests, generateQuest, icebreaker, progress } from '../quests/quests.js';
import { venueFor, weather } from './weather.js';
import { db } from '../../shared/db.js';
import { findPeople } from '../explore/people.js';
import { Temporal } from '@js-temporal/polyfill';
import { conferenceZone, eventInput } from '@hallway/shared';
import { scheduleIntent } from '../assistant/assistant.js';
import { createEvent } from '../schedule/events.js';
import {
  planCatalogSession,
  readPersonalActivity,
  savedActivityReply,
} from '../assistant/session-planner.js';

export async function briefingContext(user: User) {
  const now = clock(user.demo);
  const day = localDay(now);
  const [events, next, quests, status] = await Promise.all([
    agenda(user.id, day, dayAfter(day)),
    nextEvent(user.id, now),
    activeQuests(user.id),
    progress(user.id),
  ]);
  const current = events.find((event) => overlaps(now, new Date(+now + 1), event));
  const [forecast, recommendation] = await Promise.all([
    weather(day, user.demo, venueFor((current ?? next)?.location)),
    nextSession(user, events),
  ]);
  const prepToday = events.find(
    (event) =>
      !event.completedAt && event.checklist.length && (!event.endsAt || event.endsAt > now),
  );
  const checklistEvent = next?.checklist.length ? next : (prepToday ?? next);
  const checklist = checklistEvent
    ? {
        eventId: checklistEvent.id,
        title: checklistEvent.title,
        items: checklistEvent.checklist,
      }
    : null;
  const freeMinutes = Math.max(0, Math.floor((+freeUntil(now, events) - +now) / 60000));
  return {
    now,
    day,
    events,
    current: current ?? null,
    next,
    forecast,
    recommendation,
    checklist,
    quest: quests[0] ?? null,
    progress: status,
    freeMinutes,
  };
}

export async function today(user: User) {
  const facts = await briefingContext(user);
  const profile = profileInput.safeParse(user.profile).data;
  const copy = await briefingCopy({
    nickname: profile?.nickname,
    interests: profile?.interests,
    firstTime: profile?.firstTime,
    goals: profile?.goals,
    count: facts.events.length,
    nextCategory: facts.next?.category,
    freeMinutes: facts.freeMinutes,
    weatherGuidance: facts.forecast.guidance,
    completedQuests: facts.progress.completed,
  });
  return {
    ...facts,
    briefing: {
      mode: copy ? 'ai' : 'rules',
      lead: copy?.lead ?? 'Make time for what brought you here.',
      tips:
        copy?.tips ??
        (profile?.firstTime ? ['Give yourself a moment to get oriented between activities.'] : []),
    },
  };
}

export async function nextAction(user: User, question: string, persistQuest = true) {
  const now = clock(user.demo);
  const day = localDay(now);
  const events = await agenda(user.id, day, dayAfter(day));
  const end = freeUntil(now, events);
  const requested = /\b(\d{1,3})\s*(?:minutes?|mins?)\b/i.exec(question)?.[1];
  const cutoff = requested ? new Date(Math.min(+end, +now + Number(requested) * 60000)) : end;
  const minutes = Math.max(0, Math.floor((+cutoff - +now) / 60000));
  const current = events.find((event) => overlaps(now, new Date(+now + 1), event));
  const session = await nextSession(user, events, cutoff);
  const quest = minutes >= 5 && !session ? await generateQuest(user, persistQuest) : null;
  const next = await nextEvent(user.id, now);
  const action = current
    ? {
        kind: 'event',
        title: current.title,
        detail: 'This activity is on your schedule now.',
        path: '/schedule',
      }
    : session
      ? { kind: 'session', title: session.title, detail: session.reason, path: '/explore' }
      : quest && quest.minutes <= minutes
        ? { kind: 'quest', title: quest.title, detail: quest.mission, path: '/quests' }
        : next
          ? {
              kind: 'event',
              title: next.title,
              detail: 'Review your schedule and get ready for your next event.',
              path: '/schedule',
            }
          : {
              kind: 'break',
              title: 'Take a short break',
              detail: 'Check the conference catalog when you’re ready.',
              path: '/explore',
            };
  const copy = await nextCopy({ kind: action.kind, minutes }, question);
  return {
    action,
    minutes,
    mode: copy ? 'ai' : 'rules',
    lead: copy?.lead ?? 'Here’s an option based on your plans.',
    tips: copy?.tips ?? [],
  };
}

async function answer(user: User, question: string) {
  const now = clock(user.demo);
  const day = localDay(now);
  const response = (kind: string, title: string, detail: string, path: string, mode = 'rules') => ({
    action: { kind, title, detail, path },
    mode,
    minutes: 0,
    lead: '',
    tips: [],
  });
  if (/ice.?breaker|conversation starter|break the ice/i.test(question)) {
    const copy = await icebreaker(user);
    return response(
      'quest',
      'Try this conversation starter',
      copy.icebreaker,
      '/quests',
      copy.mode,
    );
  }
  if (/weather|forecast|umbrella|jacket|how cold|will it rain/i.test(question)) {
    const next = await nextEvent(user.id, now);
    const forecast = await weather(day, user.demo, venueFor(next?.location));
    const title =
      forecast.mode === 'demo'
        ? 'Simulated venue forecast'
        : forecast.mode === 'stale'
          ? 'Cached venue forecast'
          : 'Venue forecast';
    const detail =
      forecast.high === null
        ? 'A forecast is unavailable for this date.'
        : `Low ${forecast.low}°F, high ${forecast.high}°F. ${forecast.guidance.join(' ')}`;
    return response('weather', title, detail, '/');
  }
  if (/prepare|pack|checklist|what.*bring/i.test(question)) {
    const events = await agenda(user.id, day, dayAfter(day));
    const event =
      (await nextEvent(user.id, now)) ??
      events.find((item) => !item.completedAt && item.checklist.length);
    const open =
      event?.checklist.filter((item) => item.status === 'open').map((item) => item.label) ?? [];
    return response(
      'preparation',
      event?.title ?? 'Preparation checklist',
      open.length ? open.join(' · ') : 'There are no open preparation items.',
      '/schedule',
    );
  }
  if (
    /who.*meet|find.*(?:people|attendee|someone)|suggest.*(?:people|connection)/i.test(question)
  ) {
    const match = (await findPeople(user))[0];
    return response(
      'people',
      match?.nickname ?? 'Meet fellow attendees',
      match
        ? match.reason + ' “' + match.icebreaker + '”'
        : 'Check the People tab and enable discovery from Profile if you want to see matches.',
      '/explore?tab=people',
    );
  }
  if (
    /search.*(?:talks?|sessions?)|find.*(?:talks?|sessions?)|recommend.*(?:talks?|sessions?)/i.test(
      question,
    ) &&
    !/next/i.test(question)
  ) {
    const results = await catalogSearch(user, catalogQuery.parse({ q: question, limit: 1 }));
    const item = results.results[0];
    return response(
      'session',
      item?.title ?? 'Search conference sessions',
      item?.reason ?? 'Try a broader topic in Explore.',
      item ? '/explore?session=' + encodeURIComponent(item.id) : '/explore',
    );
  }
  return nextAction(user, question);
}

function explicitScheduleRequest(question: string) {
  return /^(?:please\s+|(?:can|could|would) you\s+|i (?:want|need) (?:you )?to\s+)*(?:add|schedule|put|book|block|create|plan)\b/i.test(
    question,
  );
}

function scheduleRequest(
  question: string,
  history: { role: string; content: string; action: unknown }[],
) {
  if (explicitScheduleRequest(question)) return true;
  const last = history.at(-1);
  return Boolean(
    last?.role === 'assistant' &&
      !last.action &&
      explicitScheduleRequest(history.at(-2)?.content ?? '') &&
      /\b(date|day|time|duration|start|end)\b/i.test(last.content) &&
      /\b(?:am|pm|today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\d{1,2}[:.]\d{2}/i.test(
        question,
      ),
  );
}

async function scheduleReply(
  user: User,
  question: string,
  history: { role: string; content: string }[],
) {
  const fallback =
    'I can add that to your schedule. What is the event title, date, start time, and end time?';
  const now = clock(user.demo);
  const zone = conferenceZone;
  const localNow = Temporal.Instant.from(now.toISOString()).toZonedDateTimeISO(zone);
  const [events, quests] = await Promise.all([agenda(user.id), activeQuests(user.id)]);
  const profile = profileInput.safeParse(user.profile).data;
  const interpretation = await scheduleIntent(
    {
      nickname: profile?.nickname,
      interests: profile?.interests,
      goals: profile?.goals,
      comfort: profile?.comfort,
      zone,
      currentLocalTime: localNow.toString(),
      schedule: events.slice(0, 30).map((event) => ({
        title: event.title,
        startsAt: event.startsAt?.toISOString() ?? null,
        endsAt: event.endsAt?.toISOString() ?? null,
        day: event.day,
        location: event.location,
      })),
      activeQuests: quests.map((quest) => quest.title),
      recentConversation: history.slice(-24).map(({ role, content }) => ({
        role,
        content: content.slice(0, 700),
      })),
    },
    question,
  );

  const plainActivity = !interpretation ? readPersonalActivity(question, now) : null;
  if (plainActivity) return savePersonalActivity(user.id, plainActivity, 'rules');
  if (!interpretation || interpretation.action === 'clarify' || !interpretation.event) {
    return {
      content: interpretation?.message ?? fallback,
      action: null,
      mode: interpretation ? ('ai' as const) : ('rules' as const),
    };
  }

  const draft = interpretation.event;
  let input: ReturnType<typeof eventInput.parse>;
  try {
    const start = Temporal.PlainDateTime.from(`${draft.day}T${draft.startTime}`)
      .toZonedDateTime(zone, { disambiguation: 'reject' })
      .toInstant();
    const end = Temporal.PlainDateTime.from(`${draft.day}T${draft.endTime}`)
      .toZonedDateTime(zone, { disambiguation: 'reject' })
      .toInstant();
    input = eventInput.parse({
      ...draft,
      zone,
      startsAt: start.toString(),
      endsAt: end.toString(),
      day: null,
      endDay: null,
    });
  } catch {
    return {
      content:
        'I need a different time to save this. The date or time may be invalid or unclear in the conference time zone.',
      action: null,
      mode: 'ai' as const,
    };
  }
  return savePersonalActivity(user.id, input, 'ai');
}

async function savePersonalActivity(
  userId: string,
  input: ReturnType<typeof eventInput.parse>,
  mode: 'ai' | 'rules',
) {
  const result = await createEvent(userId, input);
  if (!result.event) {
    return {
      content: `I didn't add it because it overlaps with ${result.conflicts.map((item) => item.title).join(', ')}. Tell me a different time and I’ll try again.`,
      action: {
        kind: 'event' as const,
        title: 'Resolve schedule conflict',
        detail: 'Choose another time for this event.',
        path: '/schedule',
      },
      mode,
    };
  }
  return savedActivityReply(result.event, 'Based on the details you provided in chat.', mode);
}

export function todayRoutes(app: FastifyInstance) {
  app.get('/api/today', async (request) => today(await requireUser(request)));
  app.get('/api/assistant/history', async (request) => {
    const user = await requireUser(request);
    const history = await db.assistantMessage.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 24,
    });
    return history.reverse();
  });
  app.delete('/api/assistant/history', async (request, reply) => {
    const user = await requireUser(request);
    await db.assistantMessage.deleteMany({ where: { userId: user.id } });
    return reply.code(204).send();
  });
  app.post(
    '/api/assistant',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request) => {
      const user = await requireUser(request);
      const { question } = z
        .object({ question: z.string().trim().min(1).max(700) })
        .parse(request.body);
      const recent = await db.assistantMessage.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
        take: 24,
      });
      const history = recent.reverse();
      const wantsSchedule = scheduleRequest(question, history);
      const plannerQuestion =
        wantsSchedule && !explicitScheduleRequest(question)
          ? (history.at(-2)?.content ?? '') + ' ' + question
          : question;
      const previous = assistantActionSchema.safeParse(history.at(-1)?.action).data;
      const refersToSuggestion =
        /\b(?:add|schedule|book) (?:it|that|the (?:session|talk) you suggested)\b/i.test(question);
      const suggestionId =
        wantsSchedule && refersToSuggestion && previous?.kind === 'session'
          ? (new URL(previous.path, 'https://hallway.invalid').searchParams.get('session') ??
            undefined)
          : undefined;
      const planned = await planCatalogSession(user, plannerQuestion, wantsSchedule, suggestionId);
      const reply = planned
        ? planned
        : wantsSchedule
          ? await scheduleReply(user, question, history)
          : await answer(user, question).then((advice) => ({
              content: [advice.lead, advice.action.title, advice.action.detail, ...advice.tips]
                .filter(Boolean)
                .join('\n\n'),
              action: advice.action,
              mode: advice.mode,
            }));
      const createdAt = new Date();
      const messages = await db.$transaction(async (tx) => {
        const userMessage = await tx.assistantMessage.create({
          data: { userId: user.id, role: 'user', content: question, createdAt },
        });
        const assistantMessage = await tx.assistantMessage.create({
          data: {
            userId: user.id,
            role: 'assistant',
            content: reply.content,
            action: reply.action ?? undefined,
            mode: reply.mode,
            createdAt: new Date(createdAt.getTime() + 1),
          },
        });
        const retained = await tx.assistantMessage.findMany({
          where: { userId: user.id },
          orderBy: { createdAt: 'desc' },
          take: 24,
          select: { id: true },
        });
        await tx.assistantMessage.deleteMany({
          where: { userId: user.id, id: { notIn: retained.map((item) => item.id) } },
        });
        return [userMessage, assistantMessage] as const;
      });
      return { messages };
    },
  );
  app.get('/api/catalog/:id', async (request) => {
    const user = await requireUser(request);
    const { id } = z.object({ id: z.string().max(200) }).parse(request.params);
    if (user.demo) await ensureDemoCatalog();
    const item = await db.catalogItem.findFirst({ where: { id, demo: user.demo, active: true } });
    if (!item) throw new HttpError(404, 'Session not found.');
    return {
      ...item,
      reason: reasonFor(item, profileInput.safeParse(user.profile).data?.interests ?? []),
    };
  });
  app.get('/api/catalog', async (request) =>
    catalogSearch(await requireUser(request), catalogQuery.parse(request.query)),
  );
}
