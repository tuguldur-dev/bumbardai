import { Temporal } from '@js-temporal/polyfill';
import { conferenceZone, eventInput, profileInput } from '@hallway/shared';
import type { Event, User } from '@prisma/client';
import { db } from '../../shared/db.js';
import { HttpError } from '../auth/auth.js';
import { ensureDemoCatalog } from '../explore/catalog.js';
import { atLocal, clock, dayAfter, localDay, overlaps } from '../schedule/calendar.js';
import { agenda, saveCatalogEvent } from '../schedule/events.js';

const weekdays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const dayPattern = new RegExp('\\b(' + weekdays.join('|') + ')\\b', 'i');
const timePattern =
  '(\\d{1,2}(?::\\d{2})?\\s*(?:a\\.?m\\.?|p\\.?m\\.?)|\\d{1,2}:\\d{2}|noon|midnight)';
const stop = new Set(
  'a an am pm at about around based day fit fits free mountain this using add afternoon after and activity activities before best book can choose conference could create evening find for from get give i in interest interests into is it like matches me morning my next noon midnight of on one or pick plan please put recommend rest schedule session sessions something suggest talk talks the time to today tomorrow want what which with would workshop workshops hackathon hackathons'.split(
    ' ',
  ),
);
const words = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

function clockTime(value: string) {
  const text = value.toLowerCase().replace(/[.\s]/g, '');
  if (text === 'noon') return '12:00';
  if (text === 'midnight') return '00:00';
  const match = /^(\d{1,2})(?::(\d{2}))?(am|pm)?$/.exec(text);
  if (!match) throw new RangeError('Invalid clock time.');
  const hour = Number(match[1]);
  const minutes = Number(match[2] ?? 0);
  if (minutes > 59 || (match[3] ? hour < 1 || hour > 12 : hour > 23))
    throw new RangeError('Invalid clock time.');
  const localHour = match[3] ? (hour % 12) + (match[3] === 'pm' ? 12 : 0) : hour;
  return String(localHour).padStart(2, '0') + ':' + String(minutes).padStart(2, '0');
}

function sessionWindow(question: string, now: Date) {
  const explicitDate = /\b\d{4}-\d{2}-\d{2}\b/.exec(question)?.[0];
  const weekday = dayPattern.exec(question)?.[1]?.toLowerCase();
  const today = localDay(now);
  const day =
    explicitDate ??
    (/\btomorrow\b/i.test(question)
      ? dayAfter(today)
      : weekday
        ? dayAfter(
            today,
            (weekdays.indexOf(weekday) + 1 - Temporal.PlainDate.from(today).dayOfWeek + 7) % 7,
          )
        : today);
  if (
    /\b(next week|this weekend|next month|next (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|utc|gmt|est|pst|edt|pdt)\b/i.test(
      question,
    ) ||
    /\b\d{1,2}\/\d{1,2}\b/.test(question)
  )
    throw new RangeError('Specify one conference date and use Mountain Time.');

  const part = /\b(morning|afternoon|evening)\b/i.exec(question)?.[1]?.toLowerCase();
  const exact = new RegExp('\\bat\\s+' + timePattern, 'i').exec(question)?.[1];
  const from = new RegExp('\\b(?:from|after|between)\\s+' + timePattern, 'i').exec(question)?.[1];
  const until = new RegExp('\\b(?:before|until|to|and)\\s+' + timePattern, 'i').exec(question)?.[1];
  if (
    (/\bat\s+\d/i.test(question) && !exact) ||
    (/\b(?:from|after|between)\s+\d/i.test(question) && !from) ||
    (/\b(?:before|until)\s+\d/i.test(question) && !until) ||
    (/\bbetween\b/i.test(question) && (!from || !until))
  )
    throw new RangeError('Use a clear time such as 2 p.m. or 14:00.');

  const start = exact ?? from;
  const after = start
    ? atLocal(day + 'T' + clockTime(start))
    : atLocal(
        day + 'T' + (part === 'afternoon' ? '12:00' : part === 'evening' ? '17:00' : '00:00'),
      );
  const before = until
    ? atLocal(day + 'T' + clockTime(until))
    : part === 'morning'
      ? atLocal(day + 'T12:00')
      : part === 'afternoon'
        ? atLocal(day + 'T17:00')
        : atLocal(dayAfter(day) + 'T00:00');
  if (before <= after) throw new RangeError('The end must come after the start.');
  return { day, after: new Date(Math.max(+after, +now)), before, exact: exact ? after : undefined };
}

const personalRequest = new RegExp(
  '^(?:please\\s+)?(?:add|schedule|book|block|create)\\s+(.+?)\\s+(today|tomorrow|\\d{4}-\\d{2}-\\d{2})\\s+from\\s+' +
    timePattern +
    '\\s+to\\s+' +
    timePattern +
    '\\s*\\.?$',
  'i',
);

export function readPersonalActivity(question: string, now: Date) {
  const match = personalRequest.exec(question);
  if (!match) return null;
  const [, title, day, start, end] = match;
  try {
    const today = localDay(now);
    const date =
      day!.toLowerCase() === 'today'
        ? today
        : day!.toLowerCase() === 'tomorrow'
          ? dayAfter(today)
          : day!;
    return eventInput.parse({
      title,
      category: 'personal',
      startsAt: atLocal(date + 'T' + clockTime(start!)).toISOString(),
      endsAt: atLocal(date + 'T' + clockTime(end!)).toISOString(),
      zone: conferenceZone,
      day: null,
      endDay: null,
    });
  } catch {
    return null;
  }
}

export function savedActivityReply(
  event: Event,
  reason: string,
  mode: 'ai' | 'rules',
  alreadySaved = false,
) {
  return {
    content: alreadySaved
      ? 'That activity is already on your schedule.'
      : 'I added this activity to your schedule.',
    mode,
    action: {
      kind: 'event' as const,
      title: event.title,
      detail: reason,
      path: '/schedule?edit=' + encodeURIComponent(event.id),
      savedActivity: {
        id: event.id,
        title: event.title,
        startsAt: event.startsAt?.toISOString() ?? null,
        endsAt: event.endsAt?.toISOString() ?? null,
        day: event.day,
        zone: event.zone,
        location: event.location,
        reason,
      },
    },
  };
}

export async function planCatalogSession(
  user: User,
  question: string,
  save: boolean,
  suggestedId?: string,
) {
  const explicitCatalog =
    /\b(session|sessions|talk|talks|workshop|workshops|hackathon|hackathons)\b/i.test(question);
  const generalPlan =
    /\bplan (?:my |the )?(?:day|morning|afternoon|evening)\b|\b(?:schedule|add|find|recommend) (?:me )?(?:an? activity|something)\b/i.test(
      question,
    );
  if (!save && !explicitCatalog && !generalPlan) return null;
  if (user.demo) await ensureDemoCatalog();
  const catalog = await db.catalogItem.findMany({
    where: { demo: user.demo, active: true },
    orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
  });
  const normalized = words(question).join(' ');
  const named = catalog.filter((item) =>
    suggestedId
      ? item.id === suggestedId
      : (' ' + normalized + ' ').includes(' ' + words(item.title).join(' ') + ' '),
  );
  if (
    !named.length &&
    save &&
    !generalPlan &&
    /\b(?:my own|personal|lunch|coffee|dinner|prep session)\b/i.test(question) &&
    !/\b(?:conference|catalog)\b/i.test(question)
  )
    return null;
  if (!explicitCatalog && !generalPlan && !named.length) return null;

  const reply = (content: string) => ({ content, mode: 'rules' as const, action: null });
  const now = clock(user.demo);
  let window: ReturnType<typeof sessionWindow>;
  try {
    const hasDate =
      /\b(?:today|tomorrow|\d{4}-\d{2}-\d{2})\b/i.test(question) || dayPattern.test(question);
    const request = suggestedId && named[0] && !hasDate ? named[0].day + ' ' + question : question;
    window = sessionWindow(request, now);
  } catch {
    return reply(
      'Which date and time window should I use? Give me one conference date and a clear time in Mountain Time.',
    );
  }
  const events = await agenda(user.id, window.day, dayAfter(window.day));
  const interests = profileInput.safeParse(user.profile).data?.interests ?? [];
  const topic = [
    ...new Set(
      words(question.replace(/\b\d{4}-\d{2}-\d{2}\b/g, '')).filter(
        (word) => !stop.has(word) && !weekdays.includes(word) && !/^\d+$/.test(word),
      ),
    ),
  ];
  const candidates = (named.length ? named : catalog)
    .flatMap((item) => {
      if (
        !item.startsAt ||
        !item.endsAt ||
        item.day !== window.day ||
        item.startsAt < window.after ||
        item.endsAt > window.before ||
        (window.exact && +item.startsAt !== +window.exact)
      )
        return [];
      if (
        !named.length &&
        ((/\bworkshops?\b/i.test(question) && item.category !== 'workshop') ||
          (/\bhackathons?\b/i.test(question) && item.category !== 'hackathon') ||
          (/\btalks?\b/i.test(question) && item.category !== 'session'))
      )
        return [];
      const title = new Set(words(item.title));
      const topics = new Set(words(item.topics.join(' ')));
      const detail = new Set(words([item.description, item.skill, ...item.speakers].join(' ')));
      const matches = topic.map((word) =>
        title.has(word) ? 4 : topics.has(word) ? 3 : detail.has(word) ? 1 : 0,
      );
      if (!named.length && matches.some((score) => score === 0)) return [];
      const interestMatches = interests.filter((interest) =>
        words(interest).every((word) => title.has(word) || topics.has(word) || detail.has(word)),
      );
      const existing = events.find((event) => event.catalogId === item.id);
      if (!existing && events.some((event) => overlaps(item.startsAt!, item.endsAt!, event)))
        return [];
      return [
        {
          item,
          existing,
          interestMatches,
          score:
            matches.reduce<number>((sum, score) => sum + score, 0) * 10 + interestMatches.length,
        },
      ];
    })
    .sort((a, b) => b.score - a.score);
  const best = candidates[0];
  if (!best)
    return reply(
      'I couldn’t find a matching session with a confirmed time that fits. Try another time or topic.',
    );
  const reason = best.interestMatches.length
    ? 'Matches your interest in ' + best.interestMatches.join(', ') + '.'
    : named.length || topic.length
      ? 'Matches the session or topic you requested.'
      : 'Fits your available time.';
  if (!save) {
    return {
      content:
        'I suggest “' +
        best.item.title +
        '”. ' +
        reason +
        ' Ask me to add it if you want it on your schedule.',
      mode: 'rules' as const,
      action: {
        kind: 'session' as const,
        title: best.item.title,
        detail: reason,
        path: '/explore?session=' + encodeURIComponent(best.item.id),
      },
    };
  }
  if (best.existing?.startsAt && best.existing.endsAt)
    return savedActivityReply(best.existing, reason, 'rules', true);
  try {
    const result = await saveCatalogEvent(user, best.item.id, false, true);
    if (!result.event)
      return reply('Your schedule changed before I could save that session. Try a different time.');
    return savedActivityReply(result.event, reason, 'rules', result.alreadySaved);
  } catch (error) {
    if (error instanceof HttpError && error.statusCode === 404)
      return reply('That session time is no longer available. Try a different time or topic.');
    throw error;
  }
}
