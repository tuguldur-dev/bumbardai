import type { User } from '@prisma/client';
import { db } from '../../shared/db.js';

export async function questLeaderboard(viewer: Pick<User, 'id' | 'demo'>) {
  const rows = await db.$queryRaw<
    { nickname: string; xp: bigint; rank: bigint; position: bigint; isViewer: boolean }[]
  >`
    WITH scores AS (
      SELECT attendee.id, attendee.profile->>'nickname' AS nickname, SUM(award.points) AS xp
      FROM "User" AS attendee
      JOIN "XpAward" AS award ON award."userId" = attendee.id
      WHERE attendee.demo = ${viewer.demo}
        AND attendee.profile->'showOnQuestLeaderboard' = 'true'::jsonb
        AND jsonb_typeof(attendee.profile->'nickname') = 'string'
        AND length(btrim(attendee.profile->>'nickname')) BETWEEN 1 AND 60
      GROUP BY attendee.id
      HAVING SUM(award.points) > 0
    ),
    ranked AS (
      SELECT *,
        RANK() OVER (ORDER BY xp DESC) AS rank,
        ROW_NUMBER() OVER (ORDER BY xp DESC, id) AS position
      FROM scores
    )
    SELECT nickname, xp, rank, position, id = ${viewer.id} AS "isViewer"
    FROM ranked
    WHERE position <= 10 OR id = ${viewer.id}
    ORDER BY position
  `;

  const placements = rows.map(({ nickname, xp, rank, position, isViewer }) => ({
    placement: { nickname, xp: Number(xp), rank: Number(rank) },
    isViewer,
    inTopTen: position <= 10n,
  }));

  return {
    leaders: placements
      .filter(({ inTopTen }) => inTopTen)
      .map(({ placement, isViewer }) => ({ ...placement, isViewer })),
    viewer: placements.find(({ isViewer }) => isViewer)?.placement ?? null,
  };
}
