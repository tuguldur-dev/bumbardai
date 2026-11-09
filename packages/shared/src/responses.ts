import { z } from 'zod';
import { category, dateKey, difficulty, eventInput, profileInput, timeZone } from './index.js';

const timestamp = z.string().datetime({ offset: true });
const id = z.string().uuid();
const count = z.number().int().nonnegative();
const mode = z.enum(['ai', 'rules']);

export const reminderPreferences = z.object({
  enabled: z.boolean(),
  quietStart: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  quietEnd: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  zone: timeZone,
});
export const attendeeSchema = z.object({
  id,
  email: z.string().email(),
  demo: z.boolean(),
  profile: profileInput.nullable(),
  reminderPrefs: reminderPreferences.nullish(),
});
export const checklistItemSchema = z.object({
  id,
  label: z.string(),
  status: z.enum(['open', 'done', 'dismissed']),
});
export const eventSchema = z.intersection(
  eventInput,
  z.object({
    id,
    catalogId: z.string().nullable(),
    completedAt: timestamp.nullable(),
    checklist: checklistItemSchema.array().default([]),
  }),
);
export const catalogSchema = z.object({
  id: z.string(),
  title: z.string(),
  category,
  location: z.string(),
  description: z.string(),
  day: dateKey,
  startsAt: timestamp.nullable(),
  endsAt: timestamp.nullable(),
  topics: z.string().array(),
  speakers: z.string().array(),
  skill: z.string().nullable(),
  demo: z.boolean(),
  sourceUrl: z.string().url(),
  reason: z.string(),
});
export const catalogResultsSchema = z.object({
  results: catalogSchema.array(),
  mode: z.enum(['catalog', 'keyword', 'hybrid']),
});
export const questSchema = z.object({
  id,
  title: z.string(),
  templateKey: z.string().nullable().optional(),
  mission: z.string(),
  icebreaker: z.string(),
  category: z.string(),
  minutes: count,
  difficulty,
  status: z.enum(['suggested', 'active', 'completed', 'skipped']),
  mode,
});
const leaderboardPlacementSchema = z.object({
  rank: z.number().int().positive(),
  nickname: z.string().min(1).max(60),
  xp: z.number().int().positive(),
});
export const questLeaderboardSchema = z.object({
  leaders: leaderboardPlacementSchema.extend({ isViewer: z.boolean() }).array().max(10),
  viewer: leaderboardPlacementSchema.nullable(),
});
export const progressSchema = z.object({
  xp: count,
  level: count,
  badges: z.string().array(),
  completed: count,
});
export const questTreeSchema = z.array(
  z.object({
    key: z.string(),
    title: z.string(),
    nodes: z.array(
      z.object({
        key: z.string(),
        title: z.string(),
        mission: z.string(),
        icebreaker: z.string(),
        difficulty,
        minutes: z.number().int().positive(),
        state: z.enum(['locked', 'available', 'active', 'completed']),
        quest: questSchema.nullable(),
      }),
    ),
  }),
);
export const awardSchema = z.object({
  awarded: count,
  badges: z.string().array(),
  progress: progressSchema,
});
export const todaySchema = z.object({
  now: timestamp,
  day: dateKey,
  freeMinutes: count,
  events: eventSchema.array(),
  next: eventSchema.nullable(),
  current: eventSchema.nullable(),
  forecast: z.object({
    mode: z.enum(['demo', 'live', 'stale', 'unavailable']),
    venue: z.string(),
    low: z.number().nullable(),
    high: z.number().nullable(),
    updatedAt: timestamp.nullable(),
    guidance: z.string().array(),
  }),
  briefing: z.object({ mode, lead: z.string(), tips: z.string().array() }),
  progress: progressSchema,
  quest: questSchema.nullable(),
  recommendation: catalogSchema.nullable(),
  checklist: z
    .object({ eventId: id, title: z.string(), items: checklistItemSchema.array() })
    .nullable(),
});
export const adviceSchema = z.object({
  action: z.object({
    kind: z.enum(['event', 'session', 'quest', 'break', 'weather', 'preparation', 'people']),
    title: z.string(),
    detail: z.string(),
    path: z.string().regex(/^\/(?!\/)/),
  }),
  minutes: count,
  mode,
  lead: z.string(),
  tips: z.string().array(),
});
export const assistantActionSchema = adviceSchema.shape.action.extend({
  savedActivity: z
    .object({
      id,
      title: z.string(),
      startsAt: timestamp.nullable(),
      endsAt: timestamp.nullable(),
      day: dateKey.nullable(),
      zone: timeZone,
      location: z.string(),
      reason: z.string(),
    })
    .optional(),
});
export const assistantMessageSchema = z.object({
  id,
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  action: assistantActionSchema.nullable(),
  mode: mode.nullable(),
  createdAt: timestamp,
});
export const assistantTurnSchema = z.object({
  messages: z.tuple([assistantMessageSchema, assistantMessageSchema]),
});
export const assistantHistorySchema = assistantMessageSchema.array().max(24);
export const scheduleIntentSchema = z.object({
  action: z.enum(['create', 'clarify']),
  message: z.string().trim().min(1).max(500),
  event: z
    .object({
      title: z.string().trim().min(1).max(200),
      category,
      location: z.string().trim().max(200),
      description: z.string().trim().max(4000),
      day: dateKey,
      startTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
      endTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
    })
    .nullable(),
});
export const saveEventSchema = z.object({
  event: eventSchema.optional(),
  conflicts: z.object({ id, title: z.string() }).array().optional(),
});
export const peopleSchema = z.object({
  people: z
    .object({
      id,
      nickname: z.string(),
      background: z.string().optional(),
      linkedinUrl: z.string().url().optional(),
      shared: z.string().array(),
      reason: z.string(),
      icebreaker: z.string(),
    })
    .array(),
  introductions: z
    .object({
      id,
      personId: id,
      nickname: z.string(),
      status: z.enum(['pending', 'accepted', 'declined']),
      incoming: z.boolean(),
    })
    .array(),
});
export const reminderSchema = z.object({ id, message: z.string() });
export const credentialSchema = z.object({
  id,
  label: z.string(),
  expiresAt: timestamp,
  canWrite: z.boolean(),
  canSchedule: z.boolean(),
});
export const calendarPreviewSchema = z.object({
  skipped: count,
  entries: z.object({ sourceKey: z.string(), event: eventInput, duplicate: z.boolean() }).array(),
});
export const calendarImportSchema = z.object({
  imported: count,
  skipped: count,
  duplicates: count,
});
export const questCodeSchema = z.object({ code: z.string(), expiresAt: timestamp });
export const icebreakerSchema = z.object({ icebreaker: z.string(), mode });
export const preparationResultSchema = z.object({ added: count, mode });
export const githubProfileSchema = z.object({ nickname: z.string(), background: z.string() });
export const okSchema = z.object({ ok: z.literal(true) });
export const introductionSchema = z.object({
  id,
  status: z.enum(['pending', 'accepted', 'declined']),
});
