import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scheduleIntentSchema } from '@hallway/shared/responses';
import { z } from 'zod';
import { briefingCopy, nextCopy, preparationCopy, scheduleIntent } from './assistant.js';

test('the OpenAI adapter supplies strict tool and output schemas, and passes authoritative context', async (t) => {
  const prior = process.env.OPENAI_API_KEY;
  const previousProvider = process.env.AI_PROVIDER;
  process.env.AI_PROVIDER = 'openai';
  process.env.OPENAI_API_KEY = 'fixture-key';
  const sent: Record<string, unknown>[] = [];
  const fake = t.mock.method(
    globalThis,
    'fetch',
    async (_url: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as Record<string, unknown>;
      sent.push(request);
      const output = request.tools
        ? [
            {
              type: 'function_call',
              id: 'fc_fixture',
              name: 'get_attendee_context',
              call_id: 'call_fixture',
              arguments: '{}',
              status: 'completed',
            },
          ]
        : [
            {
              type: 'message',
              id: 'msg_fixture',
              role: 'assistant',
              status: 'completed',
              content: [
                {
                  type: 'output_text',
                  text: '{"lead":"Make room for curiosity.","tips":["Take a moment to get oriented."]}',
                  annotations: [],
                },
              ],
            },
          ];
      return new Response(JSON.stringify({ id: 'resp_fixture', status: 'completed', output }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  );
  try {
    const response = await briefingCopy({
      count: 2,
      freeMinutes: 15,
      weatherGuidance: ['Pack a warm layer.'],
    });
    assert.deepEqual(response, {
      lead: 'Make room for curiosity.',
      tips: ['Take a moment to get oriented.'],
    });
    assert.equal(sent.length, 2);
    const first = sent[0] as { store: boolean; tools: { strict: boolean }[] };
    const second = sent[1] as {
      store: boolean;
      text: { format: { strict: boolean } };
      input: { type?: string; output?: string }[];
    };
    assert.equal(first.store, false);
    assert.equal(first.tools[0]?.strict, true);
    assert.equal(second.store, false);
    assert.equal(second.text.format.strict, true);
    const context = second.input.find((item) => item.type === 'function_call_output')?.output;
    assert.match(context ?? '', /"freeMinutes":15/);
    assert.equal(await preparationCopy({ category: 'hackathon' }), null);
  } finally {
    fake.mock.restore();
    if (prior === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = prior;
    if (previousProvider === undefined) delete process.env.AI_PROVIDER;
    else process.env.AI_PROVIDER = previousProvider;
  }
});

test('Ollama receives the field-guide schema and invalid replies fall back', async (t) => {
  const environment = {
    AI_PROVIDER: 'ollama',
    OLLAMA_BASE_URL: 'http://127.0.0.1:11434',
    OLLAMA_MODEL: 'local-test-model',
  };
  const previous = Object.keys(environment).map((key) => [key, process.env[key]] as const);
  Object.assign(process.env, environment);
  t.after(() => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const guidance = { lead: 'Try a short quest.', tips: ['Start with one question.'] };
  const mockFetch = t.mock.method(
    globalThis,
    'fetch',
    async (_url: RequestInfo | URL, _options?: RequestInit) =>
      Response.json({ done: true, message: { content: JSON.stringify(guidance) } }),
  );

  const context = { kind: 'quest', minutes: 15 };
  const question = 'What should I do next?';
  assert.deepEqual(await nextCopy(context, question), guidance);

  const [url, options] = mockFetch.mock.calls[0]!.arguments;
  assert.equal(String(url), 'http://127.0.0.1:11434/api/chat');
  assert.equal(new Headers(options?.headers).has('Authorization'), false);
  const payload = JSON.parse(String(options?.body));
  assert.equal(payload.model, environment.OLLAMA_MODEL);
  assert.deepEqual(payload.format.required, ['lead', 'tips']);
  assert.deepEqual(JSON.parse(payload.messages[1].content), { question, context });

  mockFetch.mock.mockImplementation(async () =>
    Response.json({ done: true, message: { content: '{"lead":"No tips field"}' } }),
  );
  assert.equal(await nextCopy(context, question), null);
});

test('the scheduling agent uses structured output and asks instead of guessing missing times', async (t) => {
  const previous = {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    AI_PROVIDER: process.env.AI_PROVIDER,
  };
  process.env.AI_PROVIDER = 'openai';
  process.env.OPENAI_API_KEY = 'fixture-key';
  let reply: z.infer<typeof scheduleIntentSchema> = {
    action: 'clarify',
    message: 'What start and end time should I use?',
    event: null,
  };
  const requests: Record<string, unknown>[] = [];
  const mockFetch = t.mock.method(
    globalThis,
    'fetch',
    async (_url: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requests.push(request);
      const output = request.tools
        ? [
            {
              type: 'function_call',
              id: 'fc_schedule',
              name: 'get_attendee_context',
              call_id: 'call_schedule',
              arguments: '{}',
              status: 'completed',
            },
          ]
        : [
            {
              type: 'message',
              id: 'msg_schedule',
              role: 'assistant',
              status: 'completed',
              content: [{ type: 'output_text', text: JSON.stringify(reply), annotations: [] }],
            },
          ];
      return Response.json({ id: 'resp_schedule', status: 'completed', output });
    },
  );
  t.after(() => {
    mockFetch.mock.restore();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const context = {
    zone: 'America/Denver',
    currentLocalTime: '2026-11-10T10:45:00-07:00[America/Denver]',
    recentConversation: [{ role: 'user', content: 'Add lunch tomorrow' }],
  };
  const clarification = await scheduleIntent(context, 'Add lunch tomorrow');
  assert.equal(clarification?.action, 'clarify');
  assert.equal(clarification?.event, null);
  assert.equal(requests[1]?.store, false);
  const input = requests[1]?.input as { output?: string }[];
  assert.match(input.find((item) => item.output)?.output ?? '', /America\/Denver/);

  reply = {
    action: 'create',
    message: 'I’m adding lunch to your schedule.',
    event: {
      title: 'Lunch',
      category: 'personal',
      location: '',
      description: '',
      day: '2026-11-11',
      startTime: '12:00',
      endTime: '13:00',
    },
  };
  const complete = await scheduleIntent(context, 'Tomorrow from noon to 1');
  assert.equal(complete?.action, 'create');
  assert.equal(complete?.event?.startTime, '12:00');
});
