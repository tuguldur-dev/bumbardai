import type { FastifyInstance } from 'fastify';
import { Prisma, type User } from '@prisma/client';
import { profileInput } from '@hallway/shared';
import { z } from 'zod';
import { randomInt } from 'node:crypto';
import { digest, HttpError, requireUser } from '../auth/auth.js';
import { newIcebreaker, newQuestCopy } from '../assistant/assistant.js';
import { questTree, skipTreeQuest, startTreeQuest } from './quest-tree.js';
import { clock, freeUntil, localDay } from '../schedule/calendar.js';
import { agenda } from '../schedule/events.js';
import { db } from '../../shared/db.js';
import { questLeaderboard } from './leaderboard.js';

const rewards = { easy: 50, medium: 75, hard: 100 };
const categories = [
  {
    category: 'Icebreaker',
    title: 'Make the first hello',
    mission: 'Say hello to one attendee and ask what they came to learn.',
    icebreaker: 'What are you hoping to learn here?',
  },
  {
    category: 'Technical Discovery',
    title: 'Find a field story',
    mission: 'Ask an attendee how they got started with TOPIC and listen for one practical tip.',
    icebreaker: 'What surprised you most when you started working with TOPIC?',
  },
  {
    category: 'Conference Exploration',
    title: 'Find your bearings',
    mission:
      'Explore the venue or conference map. Find one room you’ll want to visit and save it in your notes.',
    icebreaker: 'Have you found a good spot to take a quick break?',
  },
  {
    category: 'Community',
    title: 'Discover an open door',
    mission: 'Ask someone about an open-source community that welcomes new contributors.',
    icebreaker: 'What is a friendly way to get involved with your project?',
  },
  {
    category: 'Confidence Building',
    title: 'Try a quick introduction',
    mission: 'Practice a short introduction. If you feel ready, share it with one attendee.',
    icebreaker: 'I’m here to learn more about TOPIC. What brought you to the conference?',
  },
];
const idInput = z.object({ id: z.string().uuid() });
export const activeQuests = (userId: string) =>
  db.quest.findMany({
    where: { userId, status: { in: ['suggested', 'active'] } },
    orderBy: { createdAt: 'desc' },
  });
export const allQuests = (userId: string) =>
  db.quest.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 40 });

export async function progress(userId: string) {
  const [total, badges, completed] = await Promise.all([
    db.xpAward.aggregate({ where: { userId }, _sum: { points: true } }),
    db.badge.findMany({ where: { userId }, orderBy: { name: 'asc' }, select: { name: true } }),
    db.quest.count({ where: { userId, status: 'completed' } }),
  ]);
  const xp = total._sum.points ?? 0;
  return {
    xp,
    level: 1 + Math.floor(xp / 100),
    badges: badges.map((badge) => badge.name),
    completed,
  };
}

export async function generateQuest(user: User, persist = true) {
  const existing = (await activeQuests(user.id)).find((quest) => !quest.templateKey);
  if (existing) return existing;
  const profile = profileInput.safeParse(user.profile).data;
  const now = clock(user.demo);
  const day = localDay(now);
  const events = await agenda(user.id);
  const freeMinutes = Math.floor((+freeUntil(now, events) - +now) / 60000);
  const [done, completed] = await Promise.all([
    db.quest.findMany({
      where: { userId: user.id, status: 'completed' },
      orderBy: { createdAt: 'desc' },
      take: 5,
    }),
    db.quest.count({ where: { userId: user.id, status: 'completed' } }),
  ]);
  const template = (
    completed === 0 && profile?.comfort !== 'quiet'
      ? categories[0]
      : completed === 0
        ? categories[4]
        : categories[completed % categories.length]
  )!;
  const topic = profile?.interests[0] ?? 'cloud native projects';
  const difficulty = profile?.difficulty ?? 'easy';
  const minutes = Math.min(
    difficulty === 'hard' ? 20 : difficulty === 'medium' ? 12 : 5,
    Math.max(5, freeMinutes),
  );
  const copy = await newQuestCopy({
    topic,
    category: template.category,
    minutes,
    difficulty,
    freeMinutes,
    day,
    goals: profile?.goals,
    background: profile?.background,
    comfort: profile?.comfort,
    currentEventCategory: events.find(
      (event) => event.startsAt && event.endsAt && event.startsAt <= now && event.endsAt > now,
    )?.category,
    priorCategories: done.map((quest) => quest.category),
  });
  const data = {
    userId: user.id,
    difficulty,
    minutes,
    category: template.category,
    mode: copy ? 'ai' : 'rules',
    ...(copy ?? {
      title: template.title,
      mission: template.mission.replace('TOPIC', topic),
      icebreaker: template.icebreaker.replace('TOPIC', topic),
    }),
  };
  if (!persist) return { ...data, status: 'preview' as const };
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${user.id} FOR UPDATE`;
    const active = await tx.quest.findFirst({
      where: { userId: user.id, templateKey: null, status: { in: ['suggested', 'active'] } },
    });
    if (active) return active;
    return tx.quest.create({ data });
  });
}

async function finish(tx: Prisma.TransactionClient, userId: string, id: string) {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
  const quest = await tx.quest.findFirst({ where: { id, userId } });
  if (!quest) throw new HttpError(404, 'Quest not found.');
  if (quest.status === 'completed') return { awarded: 0, badges: [] };
  if (quest.status !== 'active') throw new HttpError(409, 'Start this quest before completing it.');
  const points = rewards[quest.difficulty as keyof typeof rewards] ?? 50;
  const changed = await tx.quest.updateMany({
    where: { id, userId, status: 'active' },
    data: { status: 'completed' },
  });
  if (!changed.count) throw new HttpError(409, 'This quest is no longer active.');
  await tx.xpAward.create({ data: { questId: id, userId, points } });
  const count = await tx.quest.count({ where: { userId, status: 'completed' } });
  const possible = [
    ...(quest.category !== 'Conference Exploration' ? ['First Hello'] : ['Hallway Explorer']),
    ...(quest.category === 'Community' ? ['Open Source Adventurer'] : []),
    ...(quest.category === 'Technical Discovery' ? ['Curious Mind'] : []),
    ...(count >= 4 ? ['Community Builder'] : []),
    ...(count >= 6 ? ['Conference Hero'] : []),
  ];
  const badges: string[] = [];
  for (const name of possible) {
    const result = await tx.badge.createMany({ skipDuplicates: true, data: [{ userId, name }] });
    if (result.count) badges.push(name);
  }
  return { awarded: points, badges };
}

export async function completeQuest(userId: string, id: string) {
  const result = await db.$transaction((tx) => finish(tx, userId, id));
  return { ...result, progress: await progress(userId) };
}

export async function icebreaker(user: User, questId?: string, topic?: string) {
  const quest = questId && (await db.quest.findFirst({ where: { id: questId, userId: user.id } }));
  if (questId && !quest) throw new HttpError(404, 'Quest not found.');
  const profile = profileInput.safeParse(user.profile).data;
  const subject = topic || profile?.interests[0] || 'cloud native projects';
  const copy = await newIcebreaker({
    topic: subject,
    previous: quest ? quest.icebreaker : undefined,
    comfort: profile?.comfort,
  });
  const candidates = [
    `What are you excited to learn about ${subject}?`,
    `What helped you get started with ${subject}?`,
    `What is a small win you’ve had recently with ${subject}?`,
  ];
  const text =
    copy?.icebreaker ??
    (quest && candidates.includes(quest.icebreaker)
      ? candidates[(candidates.indexOf(quest.icebreaker) + 1) % candidates.length]!
      : candidates[0]!);
  if (quest) await db.quest.update({ where: { id: quest.id }, data: { icebreaker: text } });
  return { icebreaker: text, mode: copy ? 'ai' : 'rules' };
}

export function questRoutes(app: FastifyInstance) {
  app.get('/api/quests', async (request) => allQuests((await requireUser(request)).id));
  app.get('/api/quests/leaderboard', async (request) =>
    questLeaderboard(await requireUser(request)),
  );
  app.get('/api/progress', async (request) => progress((await requireUser(request)).id));
  app.post('/api/quests/generate', async (request) => generateQuest(await requireUser(request)));
  app.post('/api/quests/:id/action', async (request) => {
    const user = await requireUser(request);
    const { id } = idInput.parse(request.params);
    const { action } = z
      .object({ action: z.enum(['start', 'skip', 'complete']) })
      .parse(request.body);
    if (action === 'complete') return completeQuest(user.id, id);
    if (
      action === 'skip' &&
      (await db.quest.findFirst({ where: { id, userId: user.id, templateKey: { not: null } } }))
    )
      return skipTreeQuest(user.id, id);
    const result = await db.quest.updateMany({
      where: { id, userId: user.id, templateKey: null, status: { in: ['suggested', 'active'] } },
      data: { status: action === 'start' ? 'active' : 'skipped' },
    });
    if (!result.count) throw new HttpError(409, 'This quest is no longer available.');
    return { ok: true };
  });
  app.get('/api/quests/tree', async (request) => questTree((await requireUser(request)).id));
  app.post('/api/quests/tree/:key/start', async (request) => {
    const user = await requireUser(request);
    const { key } = z.object({ key: z.string().max(100) }).parse(request.params);
    return startTreeQuest(user.id, key);
  });
  app.post('/api/icebreaker', async (request) => {
    const user = await requireUser(request);
    const input = z
      .object({
        questId: z.string().uuid().optional(),
        topic: z.string().trim().max(100).optional(),
      })
      .parse(request.body ?? {});
    return icebreaker(user, input.questId, input.topic);
  });
  app.post(
    '/api/quests/:id/code',
    { config: { rateLimit: { max: 15, timeWindow: '1 minute' } } },
    async (request) => {
      const user = await requireUser(request);
      const { id } = idInput.parse(request.params);
      const code = Array.from({ length: 3 }, () =>
        randomInt(10000).toString().padStart(4, '0'),
      ).join('-');
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
      await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${user.id} FOR UPDATE`;
        const quest = await tx.quest.findFirst({
          where: { id, userId: user.id, status: 'active' },
        });
        if (!quest) throw new HttpError(404, 'Active quest not found.');
        await tx.questCode.deleteMany({ where: { questId: id } });
        await tx.questCode.create({ data: { digest: digest(code), questId: id, expiresAt } });
      });
      return { code, expiresAt };
    },
  );
  app.post(
    '/api/quests/verify',
    { config: { rateLimit: { max: 12, timeWindow: '1 minute' } } },
    async (request) => {
      const verifier = await requireUser(request);
      const { code } = z
        .object({ code: z.string().regex(/^\d{4}-\d{4}-\d{4}$/) })
        .parse(request.body);
      return db.$transaction(async (tx) => {
        const key = digest(code);
        const record = await tx.questCode.findUnique({
          where: { digest: key },
          include: { quest: { include: { user: true } } },
        });
        if (
          !record ||
          record.usedAt ||
          record.expiresAt <= new Date() ||
          record.quest.user.demo !== verifier.demo
        )
          throw new HttpError(404, 'Code is invalid or expired.');
        if (record.quest.userId === verifier.id)
          throw new HttpError(400, 'Ask another attendee to confirm your code.');
        await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${record.quest.userId} FOR UPDATE`;
        const updated = await tx.questCode.updateMany({
          where: { digest: key, usedAt: null, expiresAt: { gt: new Date() } },
          data: { usedAt: new Date() },
        });
        if (!updated.count) throw new HttpError(409, 'Code has already been used.');
        const result = await finish(tx, record.quest.userId, record.questId);
        return { verified: true, awarded: result.awarded };
      });
    },
  );
}
