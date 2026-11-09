import { z } from 'zod';

export const interests = [
  'Kubernetes',
  'Go',
  'AI',
  'DevOps',
  'Security',
  'Observability',
  'eBPF',
  'Open Source',
] as const;
export const difficulty = z.enum(['easy', 'medium', 'hard']);
export const category = z.enum([
  'session',
  'workshop',
  'hackathon',
  'networking',
  'meeting',
  'personal',
]);
export const profileInput = z.object({
  nickname: z.string().trim().min(1).max(60),
  background: z.string().trim().max(240),
  interests: z.array(z.enum(interests)).min(1).max(interests.length),
  goals: z.string().trim().min(1).max(400),
  firstTime: z.boolean(),
  comfort: z.enum(['quiet', 'warming-up', 'outgoing']),
  difficulty,
  showOnQuestLeaderboard: z.boolean().default(false),
  discoverable: z.boolean().default(false),
  shareBackground: z.boolean().default(false),
  linkedinUrl: z
    .string()
    .trim()
    .max(300)
    .default('')
    .refine((value) => {
      if (!value) return true;
      try {
        const url = new URL(value);
        return (
          url.protocol === 'https:' &&
          (url.hostname === 'linkedin.com' || url.hostname.endsWith('.linkedin.com'))
        );
      } catch {
        return false;
      }
    }, 'Enter a valid LinkedIn profile URL'),
  shareLinkedIn: z.boolean().default(false),
});
export const credentials = z.object({
  email: z
    .string()
    .trim()
    .email()
    .max(254)
    .transform((value) => value.toLowerCase()),
  password: z.string().min(10).max(128),
});
export const dateKey = z.string().date();
export const timeZone = z.string().refine((zone) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}, 'Use a valid IANA time zone');
export const eventInput = z
  .object({
    title: z.string().trim().min(1).max(200),
    category,
    location: z.string().trim().max(200).default(''),
    description: z.string().trim().max(4000).default(''),
    zone: timeZone.default('America/Denver'),
    startsAt: z.string().datetime({ offset: true }).nullable(),
    endsAt: z.string().datetime({ offset: true }).nullable(),
    day: dateKey.nullable(),
    endDay: dateKey.nullable().optional(),
  })
  .refine(
    (event) =>
      event.startsAt && event.endsAt
        ? !event.day && !event.endDay && Date.parse(event.startsAt) < Date.parse(event.endsAt)
        : !event.startsAt &&
          !event.endsAt &&
          !!event.day &&
          (!event.endDay || event.day < event.endDay),
    'Use an end time or date after the start',
  );
export type ProfileInput = z.infer<typeof profileInput>;
export type EventInput = z.infer<typeof eventInput>;
export const conferenceZone = 'America/Denver';
export const officialSchedule =
  'https://events.linuxfoundation.org/kubecon-cloudnativecon-north-america/program/schedule/';
export const hackathonSource = 'https://www.wemakedevs.org/hackathons/cnh';
