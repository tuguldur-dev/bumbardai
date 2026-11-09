import type { FastifyInstance } from 'fastify';
import { type User, Prisma } from '@prisma/client';
import { profileInput } from '@hallway/shared';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { HttpError, requireUser } from '../auth/auth.js';
import { db } from '../../shared/db.js';
import { attendeeSearch } from './search.js';

const personas = [
  {
    id: 'd0b1b201-26e4-4589-9bbd-04d743e5e001',
    nickname: 'Riley · Demo',
    background: 'Platform engineer',
    interests: ['Kubernetes', 'Go'],
    goals: 'Compare developer tooling and contribute to a Kubernetes project.',
  },
  {
    id: 'd0b1b201-26e4-4589-9bbd-04d743e5e002',
    nickname: 'Sam · Demo',
    background: 'Open-source contributor',
    interests: ['Open Source', 'Observability', 'eBPF'],
    goals: 'Find an approachable first contribution and learn from maintainers.',
  },
  {
    id: 'd0b1b201-26e4-4589-9bbd-04d743e5e003',
    nickname: 'Mina · Demo',
    background: 'ML infrastructure engineer',
    interests: ['AI', 'Kubernetes', 'Security'],
    goals: 'Explore reliable inference infrastructure and talk about production AI.',
  },
];

async function ensureDemoPeople() {
  await db.user.createMany({
    skipDuplicates: true,
    data: personas.map(({ id, ...profile }) => ({
      id,
      demo: true,
      email: id + '@demo.invalid',
      passwordHash: 'disabled:' + randomUUID(),
      profile: profileInput.parse({
        ...profile,
        discoverable: true,
        shareBackground: true,
        firstTime: false,
        comfort: 'warming-up',
        difficulty: 'easy',
      }),
    })),
  });
}

const published = (demo: boolean) =>
  ({ demo, profile: { path: ['discoverable'], equals: true } }) satisfies Prisma.UserWhereInput;

export async function findPeople(user: User) {
  const profile = profileInput.safeParse(user.profile).data;
  if (!profile?.discoverable) return [];
  if (user.demo) await ensureDemoPeople();
  const profiles = await db.user.findMany({
    where: published(user.demo),
    select: { id: true, profile: true },
    orderBy: { id: 'asc' },
  });
  const docs = profiles.flatMap((row) => {
    const candidate = profileInput.safeParse(row.profile).data;
    return candidate
      ? [
          {
            id: row.id,
            demo: user.demo,
            title: candidate.nickname,
            topics: candidate.interests,
            text: [
              ...candidate.interests,
              candidate.goals,
              ...(candidate.shareBackground ? [candidate.background] : []),
            ].join(' '),
          },
        ]
      : [];
  });
  const ranked = await attendeeSearch(
    [...profile.interests, profile.goals].join(' '),
    docs,
    user.demo,
    user.id,
  );
  const rank = new Map(ranked?.ids.map((id, position) => [id, position]) ?? []);
  const current = await db.user.findMany({
    where: {
      ...published(user.demo),
      id: { in: docs.filter((doc) => doc.id !== user.id).map((doc) => doc.id) },
    },
    select: { id: true, profile: true },
  });
  return current
    .flatMap((person) => {
      const other = profileInput.safeParse(person.profile).data;
      if (!other?.discoverable) return [];
      const shared = profile.interests.filter((interest) => other.interests.includes(interest));
      if (!shared.length && !rank.has(person.id)) return [];
      const reason = shared.length
        ? 'You both follow ' + shared.join(', ') + '.'
        : 'Your conference interests and goals overlap.';
      const topic = shared[0] ?? other.interests[0] ?? 'cloud native projects';
      return [
        {
          id: person.id,
          nickname: other.nickname,
          ...(other.shareBackground ? { background: other.background } : {}),
          ...(other.shareLinkedIn && other.linkedinUrl ? { linkedinUrl: other.linkedinUrl } : {}),
          shared,
          reason,
          icebreaker: 'What are you hoping to learn about ' + topic + ' here?',
        },
      ];
    })
    .sort(
      (a, b) =>
        (rank.get(a.id) ?? 1000) - (rank.get(b.id) ?? 1000) || b.shared.length - a.shared.length,
    )
    .slice(0, 12);
}

export function peopleRoutes(app: FastifyInstance) {
  app.get('/api/people', async (request) => {
    const user = await requireUser(request);
    const [people, introductions] = await Promise.all([
      findPeople(user),
      db.introduction.findMany({
        where: { OR: [{ senderId: user.id }, { recipientId: user.id }] },
        include: {
          sender: { select: { profile: true } },
          recipient: { select: { profile: true } },
        },
      }),
    ]);
    return {
      people,
      introductions: introductions.map((item) => {
        const incoming = item.recipientId === user.id;
        const other = profileInput.safeParse(
          (incoming ? item.sender : item.recipient).profile,
        ).data;
        return {
          id: item.id,
          personId: incoming ? item.senderId : item.recipientId,
          incoming,
          status: item.status,
          nickname:
            other?.discoverable || item.status === 'accepted'
              ? (other?.nickname ?? 'Attendee')
              : 'Unavailable attendee',
        };
      }),
    };
  });
  app.post('/api/people/:id/intro', async (request) => {
    const user = await requireUser(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    if (id === user.id || !profileInput.safeParse(user.profile).data?.discoverable)
      throw new HttpError(403, 'Enable discovery to send introductions.');
    const recipient = await db.user.findFirst({
      where: { ...published(user.demo), id },
      select: { id: true },
    });
    if (!recipient) throw new HttpError(404, 'This attendee is unavailable.');
    const pairKey = [user.id, id].sort().join(':');
    const result = await db.introduction.upsert({
      where: { pairKey },
      update: {},
      create: { pairKey, senderId: user.id, recipientId: id },
    });
    return { id: result.id, status: result.status };
  });
  app.patch('/api/introductions/:id', async (request) => {
    const user = await requireUser(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const { accept } = z.object({ accept: z.boolean() }).parse(request.body);
    const status = accept ? 'accepted' : 'declined';
    const result = await db.introduction.updateMany({
      where: {
        id,
        recipientId: user.id,
        status: 'pending',
        ...(accept ? { recipient: published(user.demo), sender: published(user.demo) } : {}),
      },
      data: { status },
    });
    if (!result.count) throw new HttpError(404, 'This introduction is unavailable.');
    return { id, status };
  });
}
