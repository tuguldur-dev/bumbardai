import { questLeaderboardSchema } from '@hallway/shared/responses';
import { Trophy } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, useResource } from '../../shared/api';
import { Button, Card, Empty, ErrorText, Loading } from '../../shared/ui';

export function QuestLeaderboard() {
  const board = useResource(
    'quest-leaderboard',
    () => api('/quests/leaderboard', questLeaderboardSchema),
    { pollingInterval: 15000 },
  );
  const leaders = board.data?.leaders ?? [];
  const viewer = board.data?.viewer;

  return (
    <section className="section-gap" aria-labelledby="quest-leaderboard-title">
      <Card className="card block dashboard-card">
        <h2 id="quest-leaderboard-title" className="with-icon">
          <Trophy size={20} aria-hidden="true" /> Quest leaderboard
        </h2>
        <p className="muted">
          Top 10 by total quest XP. You can choose to appear in <Link to="/profile">Profile</Link>.
        </p>
        {board.loading && !board.data && <Loading />}
        <ErrorText error={board.error} />
        {board.error && (
          <Button variant="secondary" onClick={board.refresh} disabled={board.loading}>
            Retry leaderboard
          </Button>
        )}
        {!board.error && board.data && leaders.length === 0 && (
          <Empty title="No ranked attendees yet">
            Earn quest XP and opt in from Profile to join the leaderboard.
          </Empty>
        )}
        {!board.error && leaders.length > 0 && (
          <table className="w-full text-left">
            <caption className="sr-only">Top attendees by quest XP</caption>
            <thead>
              <tr className="border-b border-border text-sm text-muted-foreground">
                <th scope="col" className="px-2 py-2">
                  Rank
                </th>
                <th scope="col" className="px-2 py-2">
                  Attendee
                </th>
                <th scope="col" className="px-2 py-2 text-right">
                  Quest XP
                </th>
              </tr>
            </thead>
            <tbody>
              {leaders.map(({ rank, nickname, xp, isViewer }, position) => (
                <tr
                  key={position}
                  className={isViewer ? 'bg-secondary font-semibold' : 'border-b border-border'}
                >
                  <td className="px-2 py-2">{rank}</td>
                  <th scope="row" className="px-2 py-2 break-all">
                    {nickname}
                    {isViewer && <span className="muted"> (you)</span>}
                  </th>
                  <td className="px-2 py-2 text-right tabular-nums">{xp.toLocaleString()} XP</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!board.error && viewer && !leaders.some(({ isViewer }) => isViewer) && (
          <p className="inline-note">
            Your rank is {viewer.rank} with {viewer.xp.toLocaleString()} XP.
          </p>
        )}
      </Card>
    </section>
  );
}
