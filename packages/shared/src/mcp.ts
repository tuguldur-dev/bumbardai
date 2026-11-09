import { z } from 'zod';
import { dateKey, eventInput } from './index.js';

const empty = z.object({}).strict();
const search = z
  .object({
    q: z.string().trim().max(250).optional(),
    day: dateKey.optional(),
    topic: z.string().trim().max(100).optional(),
    skill: z.string().trim().max(40).optional(),
    limit: z.number().int().min(1).max(50).optional(),
  })
  .strict();
export const mcpTools = {
  get_my_schedule: {
    description:
      'Read the signed-in attendee’s calendar, optionally for a date range (until is exclusive).',
    input: z.object({ from: dateKey.optional(), until: dateKey.optional() }).strict(),
  },
  get_next_event: {
    description:
      'Get the next scheduled event, or ask for a conflict-free recommendation for what to do now.',
    input: z
      .object({
        includeRecommendation: z.boolean().optional(),
        question: z.string().max(700).optional(),
      })
      .strict(),
  },
  get_weather_forecast: {
    description:
      'Get the sourced weather forecast and preparation guidance for the conference venue.',
    input: z.object({ day: dateKey.optional() }).strict(),
  },
  get_daily_briefing: {
    description: 'Read the briefing for today with schedule, forecast, preparation and progress.',
    input: empty,
  },
  get_preparation_checklist: {
    description: 'Read the preparation checklist for an owned event or the next upcoming event.',
    input: z.object({ eventId: z.string().uuid().optional() }).strict(),
  },
  recommend_sessions: {
    description: 'Find a confirmed session that fits the attendee’s interests and schedule today.',
    input: empty,
  },
  search_sessions: {
    description:
      'Search the actual conference catalog with optional date, skill and topic filters.',
    input: search,
  },
  generate_quests: {
    description:
      'Preview a personalized quest or retrieve the existing active quest without changing it.',
    input: empty,
  },
  get_active_quests: { description: 'List current suggested and active quests.', input: empty },
  complete_quest: {
    description:
      'Complete an active quest and award XP once. Requires a credential with quest completion enabled.',
    input: z.object({ questId: z.string().uuid() }).strict(),
  },
  create_schedule_event: {
    description:
      'Create a new event on the attendee’s schedule. Requires a credential with schedule creation enabled. Returns conflicts without saving when the event overlaps.',
    input: z.object({ event: eventInput }).strict(),
  },
  find_opt_in_connections: {
    description: 'Find attendees who have opted in to discovery.',
    input: empty,
  },
  generate_icebreaker: {
    description: 'Generate a low-pressure conference icebreaker for an optional topic.',
    input: z.object({ topic: z.string().trim().max(100).optional() }).strict(),
  },
  get_my_progress: { description: 'Get the attendee’s XP, level and badges.', input: empty },
} as const;
