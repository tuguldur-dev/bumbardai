import { questTreeSchema } from '@hallway/shared/responses';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { questLeaderboardSchema } from '@hallway/shared/responses';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { createApp } from './app.js';
import { digest } from './features/auth/auth.js';
import { db } from './shared/db.js';
import { importCatalog } from './features/explore/import-catalog.js';
import { runReminderCycle } from './features/reminders/reminders.js';
import { weather } from './features/today/weather.js';
import { assistantTurnSchema, scheduleIntentSchema } from '@hallway/shared/responses';
import { z } from 'zod';

let app: FastifyInstance;
const userIds: string[] = [];
let ip = 1;
const enabled = !!process.env.TEST_DATABASE;
const setup = { skip: !enabled };
before(async () => {
  if (enabled) app = await createApp();
});
after(async () => {
  if (!enabled) return;
  await app.close();
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  await db.$disconnect();
});
async function request(
  url: string,
  method: InjectOptions['method'] = 'GET',
  payload?: object,
  cookie?: string,
  headers?: Record<string, string>,
) {
  return app.inject({
    url,
    method,
    payload,
    headers: { ...headers, ...(cookie ? { cookie } : {}) },
    remoteAddress: '127.1.0.' + ip,
  });
}
async function attendee(discoverable = false, demo = true) {
  ip++;
  const created = await request('/api/auth/register', 'POST', {
    email: randomUUID() + '@example.test',
    password: 'safe-test-password',
    demo,
  });
  assert.equal(created.statusCode, 201, created.body);
  const id = created.json().id as string;
  userIds.push(id);
  const cookie = (created.headers['set-cookie'] as string).split(';')[0]!;
  const profile = {
    nickname: 'Test ' + ip,
    background: 'private background',
    interests: ['Kubernetes', 'Go'],
    goals: 'Learn about tooling',
    firstTime: true,
    comfort: 'warming-up',
    difficulty: 'easy',
    discoverable,
    shareBackground: false,
  };
  const saved = await request('/api/profile', 'PUT', profile, cookie);
  assert.equal(saved.statusCode, 200, saved.body);
  return { id, cookie, profile };
}

const activity = {
  title: 'Personal hackathon',
  category: 'hackathon',
  location: 'The Shop Workspace',
  description: '',
  zone: 'America/Denver',
  startsAt: '2026-11-10T18:00:00Z',
  endsAt: '2026-11-10T19:00:00Z',
  day: null,
};
async function addEvent(cookie: string, event = activity, confirmConflict = false) {
  const result = await request('/api/events', 'POST', { event, confirmConflict }, cookie);
  assert.equal(result.statusCode, 200, result.body);
  return result.json();
}
async function startQuest(cookie: string) {
  const generated = await request('/api/quests/generate', 'POST', {}, cookie);
  assert.equal(generated.statusCode, 200, generated.body);
  const id = generated.json().id as string;
  const started = await request(
    '/api/quests/' + id + '/action',
    'POST',
    { action: 'start' },
    cookie,
  );
  assert.equal(started.statusCode, 200, started.body);
  return id;
}

test(
  'quest tree unlocks branch nodes and awards XP once after skip and restart',
  setup,
  async () => {
    const user = await attendee();
    const other = await attendee();
    const read = async (cookie = user.cookie) =>
      questTreeSchema.parse((await request('/api/quests/tree', 'GET', undefined, cookie)).json());
    const start = (key: string) =>
      request('/api/quests/tree/' + encodeURIComponent(key) + '/start', 'POST', {}, user.cookie);
    const action = (id: string, action: string) =>
      request('/api/quests/' + id + '/action', 'POST', { action }, user.cookie);

    assert.equal((await request('/api/quests/tree')).statusCode, 401);
    const tree = await read();
    assert.deepEqual(
      tree.map(({ nodes }) => nodes.map(({ state }) => state)),
      Array.from({ length: 4 }, () => ['available', 'locked', 'locked', 'locked', 'locked']),
    );
    const [first, next] = tree[0]!.nodes;
    assert.equal((await start(next!.key)).statusCode, 409);
    const started = await start(first!.key);
    assert.equal(started.statusCode, 200, started.body);
    const { id } = started.json();
    assert.equal((await start(tree[1]!.nodes[0]!.key)).statusCode, 409);
    assert.equal((await action(id, 'skip')).statusCode, 200);
    assert.equal((await read())[0]?.nodes[0]?.state, 'available');
    assert.equal((await action(id, 'start')).statusCode, 409);
    assert.equal((await start(first!.key)).json().id, id);
    const awards = await Promise.all([action(id, 'complete'), action(id, 'complete')]);
    assert.deepEqual(awards.map((response) => response.json().awarded).sort(), [0, 50]);
    assert.deepEqual(
      (await read())[0]?.nodes.slice(0, 2).map(({ state }) => state),
      ['completed', 'available'],
    );
    assert.equal((await read(other.cookie))[0]?.nodes[0]?.state, 'available');
    assert.equal((await start(first!.key)).statusCode, 409);
  },
);

test(
  'accounts are isolated, writes guard origins, and schedule overlaps require confirmation',
  setup,
  async () => {
    const a = await attendee();
    const b = await attendee();
    const saved = await addEvent(a.cookie);
    const overlap = await addEvent(a.cookie, { ...activity, title: 'Conflicting session' });
    assert.deepEqual(
      overlap.conflicts.map((item: { id: string }) => item.id),
      [saved.event.id],
    );
    assert.ok(
      (await addEvent(a.cookie, { ...activity, title: 'Conflicting session' }, true)).event,
    );
    assert.deepEqual((await request('/api/events', 'GET', undefined, b.cookie)).json(), []);
    assert.equal(
      (await request('/api/events/' + saved.event.id, 'DELETE', undefined, b.cookie)).statusCode,
      404,
    );
    assert.equal(
      (
        await request('/api/profile', 'PUT', a.profile, a.cookie, {
          origin: 'https://other.invalid',
        })
      ).statusCode,
      403,
    );
    assert.equal((await request('/api/auth/logout', 'POST', undefined, a.cookie)).statusCode, 204);
    assert.equal((await request('/api/me', 'GET', undefined, a.cookie)).statusCode, 401);
  },
);

test(
  'assistant chat is private, clearable, and adds only conflict-free events',
  setup,
  async (t) => {
    const a = await attendee();
    const b = await attendee();
    const first = await request(
      '/api/assistant',
      'POST',
      { question: 'What is the weather?' },
      a.cookie,
    );
    assert.equal(first.statusCode, 200, first.body);
    const ownHistory = await request('/api/assistant/history', 'GET', undefined, a.cookie);
    assert.equal(ownHistory.json().length, 2);
    assert.deepEqual(
      (await request('/api/assistant/history', 'GET', undefined, b.cookie)).json(),
      [],
    );
    assert.equal(
      (await request('/api/assistant/history', 'DELETE', undefined, b.cookie)).statusCode,
      204,
    );
    assert.equal(
      (await request('/api/assistant/history', 'GET', undefined, a.cookie)).json().length,
      2,
    );

    const prior = {
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      AI_PROVIDER: process.env.AI_PROVIDER,
    };
    process.env.OPENAI_API_KEY = 'fixture-key';
    process.env.AI_PROVIDER = 'openai';
    let interpretation: z.infer<typeof scheduleIntentSchema> = {
      action: 'clarify',
      message: 'What start and end time should I use?',
      event: null,
    };
    const mock = t.mock.method(
      globalThis,
      'fetch',
      async (_url: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        const output = body.tools
          ? [
              {
                type: 'function_call',
                id: 'fc_event',
                name: 'get_attendee_context',
                call_id: 'call_event',
                arguments: '{}',
                status: 'completed',
              },
            ]
          : [
              {
                type: 'message',
                id: 'msg_event',
                role: 'assistant',
                status: 'completed',
                content: [
                  { type: 'output_text', text: JSON.stringify(interpretation), annotations: [] },
                ],
              },
            ];
        return Response.json({ id: 'resp_event', status: 'completed', output });
      },
    );
    try {
      const clarify = await request(
        '/api/assistant',
        'POST',
        { question: 'Add lunch tomorrow' },
        a.cookie,
      );
      assert.match(clarify.json().messages[1].content, /start and end time/);
      assert.equal((await request('/api/events', 'GET', undefined, a.cookie)).json().length, 0);

      interpretation = {
        action: 'create',
        message: 'I found a time for lunch.',
        event: {
          title: 'Lunch with the team',
          category: 'meeting',
          location: '',
          description: '',
          day: '2026-11-10',
          startTime: '13:00',
          endTime: '14:00',
        },
      };
      const created = await request(
        '/api/assistant',
        'POST',
        { question: 'Tomorrow from 1 to 2' },
        a.cookie,
      );
      assert.equal(created.json().messages[1].action.savedActivity.title, 'Lunch with the team');
      assert.equal((await request('/api/events', 'GET', undefined, a.cookie)).json().length, 1);

      await addEvent(a.cookie, {
        ...activity,
        title: 'Existing appointment',
        startsAt: '2026-11-10T21:00:00Z',
        endsAt: '2026-11-10T22:00:00Z',
      });
      interpretation = {
        action: 'create',
        message: 'I found another time.',
        event: {
          title: 'Conflicting lunch',
          category: 'meeting',
          location: '',
          description: '',
          day: '2026-11-10',
          startTime: '13:30',
          endTime: '14:30',
        },
      };
      const conflict = await request(
        '/api/assistant',
        'POST',
        { question: 'Schedule a follow-up tomorrow afternoon' },
        a.cookie,
      );
      assert.match(conflict.json().messages[1].content, /overlaps with .*Existing appointment/);
      assert.equal((await request('/api/events', 'GET', undefined, a.cookie)).json().length, 2);
      assert.equal(
        (await request('/api/assistant/history', 'DELETE', undefined, a.cookie)).statusCode,
        204,
      );
      assert.deepEqual(
        (await request('/api/assistant/history', 'GET', undefined, a.cookie)).json(),
        [],
      );
    } finally {
      mock.mock.restore();
      for (const [key, value] of Object.entries(prior)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  },
);

test(
  'Scout suggests without writing, saves one published session, and deduplicates retries',
  setup,
  async () => {
    const owner = await attendee();
    const ask = async (question: string) => {
      const response = await request('/api/assistant', 'POST', { question }, owner.cookie);
      assert.equal(response.statusCode, 200, response.body);
      return assistantTurnSchema.parse(response.json()).messages[1];
    };
    const events = async () =>
      (await request('/api/events', 'GET', undefined, owner.cookie)).json();
    const recommendation = await ask('Find me a Go session before 1 pm');
    assert.equal(recommendation.action?.kind, 'session');
    assert.match(recommendation.content, /Go tools for cloud native beginners/);
    assert.deepEqual(await events(), []);
    const saved = await ask('Add it');
    const savedActivity = saved.action?.savedActivity;
    assert.ok(savedActivity);
    assert.equal(savedActivity.title, 'Go tools for cloud native beginners');
    assert.equal(savedActivity.startsAt, '2026-11-10T18:30:00.000Z');
    assert.match(savedActivity.reason, /Go/);
    const duplicate = await ask('Schedule a Go session before 1 pm');
    assert.equal(duplicate.action?.savedActivity?.id, savedActivity.id);
    assert.equal((await events()).length, 1);

    const ambiguous = await ask('Schedule an observability workshop at 3');
    assert.match(ambiguous.content, /Which date and time/);
    await addEvent(owner.cookie, {
      ...activity,
      title: 'Busy afternoon',
      startsAt: '2026-11-10T22:00:00Z',
      endsAt: '2026-11-10T23:30:00Z',
    });
    const conflict = await ask('Schedule an observability workshop this afternoon');
    assert.match(conflict.content, /couldn’t find a matching session/);
    assert.equal((await events()).length, 2);
    const personal = await ask('Add coffee tomorrow from 13:00 to 14:00');
    assert.equal(personal.action?.savedActivity?.title, 'coffee');
    assert.equal(personal.action?.savedActivity?.startsAt, '2026-11-11T20:00:00.000Z');
  },
);

test(
  'calendar import previews and deduplicates; a broken catalog refresh preserves rows',
  setup,
  async () => {
    const a = await attendee();
    await addEvent(a.cookie);
    const exportResult = await request('/api/calendar/export', 'GET', undefined, a.cookie);
    const text = exportResult.body;
    const preview = await request('/api/calendar/import', 'POST', { text }, a.cookie);
    assert.equal(preview.json().entries.length, 1, preview.body);
    const imported = await request(
      '/api/calendar/import',
      'POST',
      { text, commit: true },
      a.cookie,
    );
    assert.equal(imported.json().imported, 1, imported.body);
    const retried = await request('/api/calendar/import', 'POST', { text, commit: true }, a.cookie);
    assert.equal(retried.json().duplicates, 1, retried.body);
    const before = await db.catalogItem.count({ where: { active: true, demo: false } });
    await assert.rejects(importCatalog({}));
    assert.equal(await db.catalogItem.count({ where: { active: true, demo: false } }), before);
  },
);

test(
  'stale weather is labeled and provider failures have a grounded assistant fallback',
  setup,
  async (t) => {
    const original = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'test-fixture-key';
    const fetch = t.mock.method(globalThis, 'fetch', async () => {
      throw new Error('provider unavailable');
    });
    try {
      const at = new Date('2026-11-10T17:00:00Z');
      const payload = {
        hourly: {
          time: [+at / 1000],
          temperature_2m: [38],
          rain: [0],
          snowfall: [0],
          wind_gusts_10m: [15],
        },
      };
      const updatedAt = new Date(Date.now() - 3600000);
      await db.forecast.upsert({
        where: { venue: 'shop' },
        update: { payload, updatedAt },
        create: { venue: 'shop', payload, updatedAt },
      });
      const cached = await weather('2026-11-10', false, 'shop');
      assert.equal(cached.mode, 'stale');
      assert.equal(cached.low, 38);
      assert.equal((await weather('2027-01-01', false, 'shop')).mode, 'unavailable');
      const a = await attendee();
      const briefing = await request('/api/today', 'GET', undefined, a.cookie);
      assert.equal(briefing.json().briefing.mode, 'rules', briefing.body);
      assert.equal(briefing.json().forecast.mode, 'demo');
    } finally {
      fetch.mock.restore();
      if (original === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = original;
      await db.forecast.deleteMany({
        where: { venue: 'shop', updatedAt: { lt: new Date(Date.now() - 1800000) } },
      });
    }
  },
);

test('hybrid discovery, consent and mutual introduction use server-owned data', setup, async () => {
  const a = await attendee(true);
  const b = await attendee(true);
  const catalog = await request('/api/catalog?q=beginner+Go', 'GET', undefined, a.cookie);
  assert.equal(catalog.statusCode, 200, catalog.body);
  assert.ok(
    catalog.json().results.some((item: { id: string }) => item.id === 'demo-go'),
    catalog.body,
  );
  if (process.env.ELASTICSEARCH_URL) assert.equal(catalog.json().mode, 'hybrid', catalog.body);
  const matches = await request('/api/people', 'GET', undefined, a.cookie);
  const person = matches.json().people.find((item: { id: string }) => item.id === b.id);
  assert.ok(person, matches.body);
  assert.equal(person.background, undefined);
  await request(
    '/api/profile',
    'PUT',
    { ...b.profile, linkedinUrl: 'https://www.linkedin.com/in/test-person' },
    b.cookie,
  );
  const privateLinkedIn = await request('/api/people', 'GET', undefined, a.cookie);
  const privatePerson = privateLinkedIn
    .json()
    .people.find((item: { id: string }) => item.id === b.id);
  assert.equal(privatePerson.linkedinUrl, undefined);
  await request(
    '/api/profile',
    'PUT',
    {
      ...b.profile,
      linkedinUrl: 'https://www.linkedin.com/in/test-person',
      shareLinkedIn: true,
    },
    b.cookie,
  );
  const sharedLinkedIn = await request('/api/people', 'GET', undefined, a.cookie);
  const sharedPerson = sharedLinkedIn
    .json()
    .people.find((item: { id: string }) => item.id === b.id);
  assert.equal(sharedPerson.linkedinUrl, 'https://www.linkedin.com/in/test-person');
  const intro = await request('/api/people/' + b.id + '/intro', 'POST', {}, a.cookie);
  assert.equal(intro.json().status, 'pending', intro.body);
  assert.equal(
    (await request('/api/introductions/' + intro.json().id, 'PATCH', { accept: true }, a.cookie))
      .statusCode,
    404,
  );
  assert.equal(
    (
      await request('/api/introductions/' + intro.json().id, 'PATCH', { accept: true }, b.cookie)
    ).json().status,
    'accepted',
  );
  await request('/api/profile', 'PUT', { ...b.profile, discoverable: false }, b.cookie);
  const after = await request('/api/people', 'GET', undefined, a.cookie);
  assert.ok(!after.json().people.some((item: { id: string }) => item.id === b.id));
});

test(
  'demo reminder preferences only generate reminders for the caller and are rate limited',
  setup,
  async () => {
    const caller = await attendee();
    const other = await attendee();
    const prefs = { enabled: true, quietStart: '22:00', quietEnd: '07:00', zone: 'America/Denver' };
    await addEvent(caller.cookie);
    await addEvent(other.cookie);
    await db.user.update({ where: { id: other.id }, data: { reminderPrefs: prefs } });

    const save = () => request('/api/reminders/preferences', 'PUT', prefs, caller.cookie);
    for (let attempt = 0; attempt < 10; attempt++) {
      const response = await save();
      assert.equal(response.statusCode, 200, response.body);
    }
    assert.equal((await save()).statusCode, 429);
    assert.equal(await db.reminder.count({ where: { userId: caller.id } }), 2);
    assert.equal(await db.reminder.count({ where: { userId: other.id } }), 0);

    await runReminderCycle();
    assert.equal(await db.reminder.count({ where: { userId: other.id } }), 2);
  },
);

test(
  'duplicate reminder cycles produce one reminder and completed checklists stay quiet',
  setup,
  async () => {
    const a = await attendee();
    const event = await addEvent(a.cookie);
    const prefs = { enabled: true, quietStart: '22:00', quietEnd: '07:00', zone: 'America/Denver' };
    await request('/api/reminders/preferences', 'PUT', prefs, a.cookie);
    await Promise.all([runReminderCycle(), runReminderCycle()]);
    const reminders = (await request('/api/reminders', 'GET', undefined, a.cookie)).json();
    assert.equal(reminders.length, 2);
    assert.ok(reminders.some((item: { message: string }) => item.message.startsWith('Get ready')));
    const later = await addEvent(a.cookie, {
      ...activity,
      title: 'Already prepared',
      startsAt: '2026-11-10T19:15:00Z',
      endsAt: '2026-11-10T19:30:00Z',
    });
    await db.checklistItem.updateMany({
      where: { eventId: later.event.id },
      data: { status: 'done' },
    });
    await runReminderCycle();
    assert.equal(await db.reminder.count({ where: { userId: a.id } }), 2);
    assert.ok(event.event.checklist.length > 0);
  },
);

test(
  'XP is atomic across simultaneous completions and QR verification rejects replay',
  setup,
  async () => {
    const a = await attendee();
    const b = await attendee();
    const questId = await startQuest(a.cookie);
    const finish = () =>
      request('/api/quests/' + questId + '/action', 'POST', { action: 'complete' }, a.cookie);
    const responses = await Promise.all([finish(), finish(), finish()]);
    assert.deepEqual(
      responses.map((result) => result.json().awarded).sort((x, y) => x - y),
      [0, 0, 50],
    );
    assert.deepEqual((await request('/api/progress', 'GET', undefined, a.cookie)).json().badges, [
      'First Hello',
    ]);
    const next = await startQuest(a.cookie);
    const code = (await request('/api/quests/' + next + '/code', 'POST', {}, a.cookie)).json().code;
    assert.equal((await request('/api/quests/verify', 'POST', { code }, a.cookie)).statusCode, 400);
    assert.equal((await request('/api/quests/verify', 'POST', { code }, b.cookie)).statusCode, 200);
    assert.equal((await request('/api/quests/verify', 'POST', { code }, b.cookie)).statusCode, 404);
  },
);

test(
  'MCP tokens enforce read scope, expiry, revocation, and the attendee boundary',
  setup,
  async () => {
    const a = await attendee();
    const b = await attendee();
    await addEvent(a.cookie);
    const questId = await startQuest(a.cookie);
    const created = await request(
      '/api/mcp/credentials',
      'POST',
      { label: 'Test client' },
      a.cookie,
    );
    const auth = { authorization: 'Bearer ' + created.json().token };
    const call = (tool: string, payload: object = {}) =>
      request('/api/mcp/tools/' + tool, 'POST', payload, undefined, auth);
    assert.equal((await call('get_my_schedule')).json().length, 1);
    assert.equal(
      (await call('get_next_event', { includeRecommendation: true })).json().recommendation.action
        .kind,
      'quest',
    );
    assert.equal((await call('complete_quest', { questId })).statusCode, 403);
    const eventDraft = {
      title: 'Gemini-created event',
      category: 'meeting',
      location: '',
      description: '',
      zone: 'America/Denver',
      startsAt: '2026-11-10T20:00:00Z',
      endsAt: '2026-11-10T21:00:00Z',
      day: null,
    };
    assert.equal((await call('create_schedule_event', { event: eventDraft })).statusCode, 403);
    const scheduleToken = (
      await request(
        '/api/mcp/credentials',
        'POST',
        { label: 'Schedule client', canSchedule: true },
        a.cookie,
      )
    ).json().token;
    assert.equal(
      (
        await request('/api/mcp/tools/complete_quest', 'POST', { questId }, undefined, {
          authorization: 'Bearer ' + scheduleToken,
        })
      ).statusCode,
      403,
    );
    const scheduled = await request(
      '/api/mcp/tools/create_schedule_event',
      'POST',
      { event: eventDraft },
      undefined,
      { authorization: 'Bearer ' + scheduleToken },
    );
    assert.equal(scheduled.statusCode, 200, scheduled.body);
    assert.equal(scheduled.json().event.title, 'Gemini-created event');
    const overlap = await request(
      '/api/mcp/tools/create_schedule_event',
      'POST',
      {
        event: {
          ...eventDraft,
          title: 'Overlapping event',
          startsAt: '2026-11-10T20:30:00Z',
          endsAt: '2026-11-10T21:30:00Z',
        },
      },
      undefined,
      { authorization: 'Bearer ' + scheduleToken },
    );
    assert.equal(overlap.json().conflicts.length, 1);
    assert.equal((await request('/api/events', 'GET', undefined, a.cookie)).json().length, 2);
    const writeToken = (
      await request(
        '/api/mcp/credentials',
        'POST',
        { label: 'Other attendee', canWrite: true },
        b.cookie,
      )
    ).json().token;
    assert.equal(
      (
        await request('/api/mcp/tools/complete_quest', 'POST', { questId }, undefined, {
          authorization: 'Bearer ' + writeToken,
        })
      ).statusCode,
      404,
    );
    await db.mcpToken.update({
      where: { digest: digest(created.json().token) },
      data: { expiresAt: new Date(0) },
    });
    assert.equal((await call('get_my_progress')).statusCode, 401);
    const record = (
      await request('/api/mcp/credentials', 'POST', { label: 'Revoked' }, a.cookie)
    ).json();
    await request('/api/mcp/credentials/' + record.id, 'DELETE', undefined, a.cookie);
    assert.equal(
      (
        await request('/api/mcp/tools/get_my_progress', 'POST', {}, undefined, {
          authorization: 'Bearer ' + record.token,
        })
      ).statusCode,
      401,
    );
  },
);

test('Gemini OAuth binds consent and PKCE to a revocable credential', setup, async (t) => {
  const previous = process.env.PUBLIC_ORIGIN;
  const origin = 'https://hallway.example.test';
  process.env.PUBLIC_ORIGIN = origin;
  t.after(() => {
    if (previous === undefined) delete process.env.PUBLIC_ORIGIN;
    else process.env.PUBLIC_ORIGIN = previous;
  });
  const owner = await attendee();
  const other = await attendee();
  const client = (
    await request('/api/mcp/credentials', 'POST', { label: 'Gemini' }, owner.cookie)
  ).json();
  const verifier = 'A'.repeat(43);
  const redirect = 'https://oauth-redirect.googleusercontent.com/r/hallway-test';
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: client.id,
    redirect_uri: redirect,
    state: 'test-state',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    resource: origin + '/mcp',
  });
  const authorize = '/api/mcp/oauth/authorize?' + query;
  assert.equal((await request(authorize, 'GET', undefined, other.cookie)).statusCode, 403);
  const consent = await request(authorize, 'POST', undefined, owner.cookie, { origin });
  assert.equal(consent.statusCode, 303, consent.body);
  const location = new URL(consent.headers.location!);
  assert.equal(location.searchParams.get('state'), 'test-state');
  const exchange = (proof: string) =>
    request('/api/mcp/oauth/token', 'POST', {
      grant_type: 'authorization_code',
      client_id: client.id,
      client_secret: client.token,
      code: location.searchParams.get('code'),
      redirect_uri: redirect,
      code_verifier: proof,
      resource: origin + '/mcp',
    });
  assert.equal((await exchange('B'.repeat(43))).json().error, 'invalid_grant');
  const access = await exchange(verifier);
  assert.equal(access.statusCode, 200, access.body);
  assert.equal((await exchange(verifier)).json().error, 'invalid_grant');
  const auth = { authorization: 'Bearer ' + access.json().access_token };
  assert.equal(
    (await request('/api/mcp/tools/get_my_progress', 'POST', {}, undefined, auth)).statusCode,
    200,
  );
  await request('/api/mcp/credentials/' + client.id, 'DELETE', undefined, owner.cookie);
  assert.equal(
    (await request('/api/mcp/tools/get_my_progress', 'POST', {}, undefined, auth)).statusCode,
    401,
  );
});
test(
  'quest leaderboard ranks earned XP within each audience and reads current consent',
  setup,
  async () => {
    const endpoint = '/api/quests/leaderboard';
    assert.equal((await request(endpoint)).statusCode, 401);

    async function seedScore(userId: string, points: number) {
      await db.quest.create({
        data: {
          userId,
          title: 'Leaderboard fixture',
          mission: 'Say hello',
          icebreaker: 'What are you learning?',
          category: 'Icebreaker',
          difficulty: 'easy',
          minutes: 5,
          status: 'completed',
          mode: 'rules',
          award: { create: { userId, points } },
        },
      });
    }

    async function read(cookie: string) {
      const response = await request(endpoint, 'GET', undefined, cookie);
      assert.equal(response.statusCode, 200, response.body);
      return questLeaderboardSchema.parse(response.json());
    }

    async function consent(person: Awaited<ReturnType<typeof attendee>>, enabled: boolean) {
      const response = await request(
        '/api/profile',
        'PUT',
        { ...person.profile, showOnQuestLeaderboard: enabled },
        person.cookie,
      );
      assert.equal(response.statusCode, 200, response.body);
    }

    const viewer = await attendee();
    await seedScore(viewer.id, 50);
    assert.deepEqual(await read(viewer.cookie), { leaders: [], viewer: null });
    await consent(viewer, true);
    assert.deepEqual((await read(viewer.cookie)).leaders, [
      { rank: 1, nickname: viewer.profile.nickname, xp: 50, isViewer: true },
    ]);

    const first = await attendee();
    await consent(first, true);
    await seedScore(first.id, 50);
    await seedScore(first.id, 50);
    const second = await attendee();
    await consent(second, true);
    await seedScore(second.id, 100);

    for (let index = 0; index < 8; index++) {
      const person = await attendee();
      await consent(person, true);
      await seedScore(person.id, 75);
    }

    const hidden = await attendee(true);
    await seedScore(hidden.id, 100);
    const zeroXp = await attendee();
    await consent(zeroXp, true);
    const live = await attendee(false, false);
    await consent(live, true);
    await seedScore(live.id, 100);

    const board = await read(viewer.cookie);
    assert.deepEqual(
      board.leaders.map(({ rank, xp }) => [rank, xp]),
      [[1, 100], [1, 100], ...Array.from({ length: 8 }, () => [3, 75])],
    );
    assert.equal(
      board.leaders.some(({ isViewer }) => isViewer),
      false,
    );
    assert.deepEqual(board.viewer, { rank: 11, nickname: viewer.profile.nickname, xp: 50 });
    assert.deepEqual((await read(live.cookie)).leaders, [
      { rank: 1, nickname: live.profile.nickname, xp: 100, isViewer: true },
    ]);

    await consent(first, false);
    const updated = await read(viewer.cookie);
    assert.ok(!updated.leaders.some(({ nickname }) => nickname === first.profile.nickname));
    assert.equal(updated.viewer?.rank, 10);
    await consent(viewer, false);
    assert.equal((await read(viewer.cookie)).viewer, null);
  },
);
