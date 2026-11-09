import { db } from '../../shared/db.js';
import { HttpError } from '../auth/auth.js';

const paths = [
  {
    key: 'networking',
    title: 'Networking',
    category: 'Icebreaker',
    missions: [
      [
        'first-hello',
        'First Hello',
        'Introduce yourself to one attendee and ask what brought them here.',
        'What are you hoping to learn this week?',
      ],
      [
        'common-ground',
        'Find Common Ground',
        'Find an attendee who shares one technical interest with you.',
        'Which projects have caught your eye?',
      ],
      [
        'maintainer',
        'Meet a Maintainer',
        'Ask a project maintainer what they wish new contributors knew.',
        'What is an easy first step into your project?',
      ],
      [
        'introduction',
        'Make an Introduction',
        'With their permission, introduce two attendees who share an interest.',
        'Would you like to meet someone working on that too?',
      ],
      [
        'keep-in-touch',
        'Keep in Touch',
        'Reconnect with someone you met and agree on one way to follow up if you both want to.',
        'Would you like to continue this conversation after the conference?',
      ],
    ],
  },
  {
    key: 'technical',
    title: 'Technical discovery',
    category: 'Technical Discovery',
    missions: [
      [
        'talk',
        'Find a Talk',
        'Pick a talk outside your usual specialty and write down one thing you want to learn.',
        'Which talk would you recommend to someone new to this topic?',
      ],
      [
        'question',
        'Ask a Question',
        'Ask a speaker or attendee one question about something you learned.',
        'What tradeoff surprised you most?',
      ],
      [
        'compare',
        'Compare Two Tools',
        'Compare two tools discussed at the conference and note when you would use each.',
        'What made you choose that tool?',
      ],
      [
        'takeaway',
        'Share a Takeaway',
        'Share one practical tip from a session with another attendee.',
        'What is one idea you can use next week?',
      ],
      [
        'explain',
        'Explain a New Idea',
        'Explain one idea you learned, using an example and one limitation.',
        'Does this example make sense in your setup?',
      ],
    ],
  },
  {
    key: 'venue',
    title: 'Venue exploration',
    category: 'Conference Exploration',
    missions: [
      [
        'bearings',
        'Get Your Bearings',
        'Use the venue map to find registration and your next session room.',
        '',
      ],
      [
        'quiet-spot',
        'Find a Quiet Spot',
        'Find a comfortable spot for a break and note how to get back to it.',
        'Do you know a quiet place to take a break?',
      ],
      [
        'new-track',
        'Visit a New Track',
        'Locate a room hosting a track you have not explored yet.',
        'What is worth seeing in this track?',
      ],
      [
        'expo',
        'Explore the Expo',
        'Visit two expo booths and note one project you want to revisit.',
        'What are you demonstrating today?',
      ],
      [
        'venue-tip',
        'Share a Venue Tip',
        'Share a useful route or accessibility tip with an attendee who wants it.',
        'Would a quick tip for getting to your next session help?',
      ],
    ],
  },
  {
    key: 'community',
    title: 'Community',
    category: 'Community',
    missions: [
      [
        'project',
        'Find a Project',
        'Find an open source project that matches one of your interests.',
        'What problem does your project solve?',
      ],
      [
        'contributor',
        'Meet a Contributor',
        'Ask a contributor what helped them get involved.',
        'How did you make your first contribution?',
      ],
      [
        'first-issue',
        'Find a First Issue',
        'Find a beginner issue or documentation task and save the link for later.',
        'Is there a small issue newcomers can try?',
      ],
      [
        'meetup',
        'Join a Community Meetup',
        'Attend a community meetup or project discussion and note one thing you learned.',
        'What are people here working on next?',
      ],
      [
        'newcomer',
        'Help a Newcomer',
        'Offer a newcomer a useful resource or introduction if they would like help.',
        'Is there anything I can help you find?',
      ],
    ],
  },
] as const;

const difficulties = ['easy', 'easy', 'medium', 'medium', 'hard'] as const;
const minutes = [5, 8, 12, 15, 20] as const;
const branches = paths.map(({ key, title, category, missions }) => ({
  key,
  title,
  nodes: missions.map(([slug, title, mission, icebreaker], index) => ({
    key: key + ':' + slug,
    prerequisite: index === 0 ? null : key + ':' + missions[index - 1]![0],
    title,
    mission,
    icebreaker,
    category,
    difficulty: difficulties[index]!,
    minutes: minutes[index]!,
  })),
}));

export async function questTree(userId: string) {
  const records = await db.quest.findMany({ where: { userId, templateKey: { not: null } } });
  const byKey = new Map(records.map((record) => [record.templateKey, record]));
  return branches.map(({ key, title, nodes }) => ({
    key,
    title,
    nodes: nodes.map(({ prerequisite, category: _category, ...node }) => {
      const quest = byKey.get(node.key);
      const unlocked = !prerequisite || byKey.get(prerequisite)?.status === 'completed';
      const state =
        quest?.status === 'completed' || quest?.status === 'active'
          ? quest.status
          : unlocked
            ? 'available'
            : 'locked';
      return { ...node, state, quest: quest ?? null };
    }),
  }));
}

export async function startTreeQuest(userId: string, key: string) {
  const node = branches.flatMap(({ nodes }) => nodes).find((item) => item.key === key);
  if (!node) throw new HttpError(404, 'Quest node not found.');

  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
    const existing = await tx.quest.findUnique({
      where: { userId_templateKey: { userId, templateKey: key } },
    });
    if (existing?.status === 'active') return existing;
    if (existing?.status === 'completed')
      throw new HttpError(409, 'This quest is already complete.');
    if (
      node.prerequisite &&
      !(await tx.quest.findFirst({
        where: { userId, templateKey: node.prerequisite, status: 'completed' },
      }))
    )
      throw new HttpError(409, 'Complete the previous quest to unlock this one.');
    if (
      await tx.quest.findFirst({ where: { userId, templateKey: { not: null }, status: 'active' } })
    )
      throw new HttpError(409, 'Finish or skip your active tree quest first.');

    if (existing)
      return tx.quest.update({ where: { id: existing.id }, data: { status: 'active' } });
    const { key: templateKey, prerequisite: _prerequisite, ...template } = node;
    return tx.quest.create({
      data: { ...template, userId, templateKey, status: 'active', mode: 'rules' },
    });
  });
}

export async function skipTreeQuest(userId: string, id: string) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
    const result = await tx.quest.updateMany({
      where: { id, userId, templateKey: { not: null }, status: 'active' },
      data: { status: 'skipped' },
    });
    if (!result.count) throw new HttpError(409, 'This quest is no longer available.');
    await tx.questCode.deleteMany({ where: { questId: id } });
    return { ok: true };
  });
}
