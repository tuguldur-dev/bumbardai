import { questSchema, questTreeSchema } from '@hallway/shared/responses';
import {
  ArrowUpRight,
  Check,
  Compass,
  Flag,
  GitBranch,
  Lock,
  MapPinned,
  Play,
  Sparkles,
  Telescope,
  UsersRound,
  Zap,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { api, useAction, useResource, type Quest } from '../../shared/api';
import { Button, Card, ErrorText, Loading, points, Sheet } from '../../shared/ui';

import './quest-tree.css';

const pathStyles = {
  networking: { icon: UsersRound, number: '01', subtitle: 'Meet the people behind the projects' },
  technical: { icon: Telescope, number: '02', subtitle: 'Follow an idea beyond the talk' },
  venue: { icon: MapPinned, number: '03', subtitle: 'Make the conference floor yours' },
  community: { icon: GitBranch, number: '04', subtitle: 'Find a project you can grow with' },
};

const pathStyle = (key: string) => pathStyles[key as keyof typeof pathStyles] ?? pathStyles.venue;

function CompassArt() {
  return (
    <svg className="quest-atlas-art" viewBox="0 0 480 260" fill="none" aria-hidden="true">
      <g stroke="currentColor" strokeOpacity=".22">
        <path d="M15 171C70 148 63 84 115 64s73 19 112-2 53-57 105-52 72 32 86 69 43 35 58 68-10 68-45 71-54-7-93 11-77 21-108-2-56-41-99-26-87 26-116-30Z" />
        <path d="M42 171c42-23 46-68 84-82s72 13 112-9 50-46 94-40 58 29 72 61 35 32 43 55-10 42-35 40-44-5-81 12-67 16-94-5-58-39-95-28-76 28-100-4Z" />
        <path d="M77 161c28-20 30-46 59-53s66 9 111-13 46-35 82-27 46 26 59 49 31 31 28 47-24 16-45 16-31 1-62 13-52 11-71-7-51-37-85-26-58 14-76 1Z" />
        <path d="M112 149c15-22 38-21 58-19s54-8 83-20 48-24 73-16 40 31 52 51-1 20-21 21-28 1-53 10-43 4-59-12-47-26-73-18-42 9-60 3Z" />
      </g>
      <g transform="translate(305 126)" stroke="#dcd4ff">
        <circle r="55" strokeOpacity=".5" strokeDasharray="2 5" />
        <circle r="42" strokeOpacity=".38" />
        <path d="M0-55V-45M55 0H45M0 55V45M-55 0H-45" strokeOpacity=".8" />
        <path
          d="m17-27-8 35-34 16 12-32 30-19Z"
          fill="#a58dff"
          stroke="#eee8ff"
          strokeWidth="1.5"
        />
        <path d="m17-27-17 27-25 24 12-32 30-19Z" fill="#e1d7ff" stroke="none" />
        <circle r="3" fill="#291746" />
      </g>
      <circle cx="190" cy="71" r="4" fill="#f9bd78" />
      <circle cx="418" cy="168" r="3" fill="#b1e9dc" />
      <path d="m120 190 4-7 4 7-4 7-4-7Zm285-132 4-7 4 7-4 7-4-7Z" fill="#dcd4ff" />
    </svg>
  );
}

const markers = { locked: Lock, available: Flag, active: Play, completed: Check };

export function QuestTree({
  renderActive,
}: {
  renderActive: (quest: Quest, close: () => void) => ReactNode;
}) {
  const tree = useResource('quests', () => api('/quests/tree', questTreeSchema), {
    pollingInterval: 15000,
  });
  const start = useAction(
    (key: string) =>
      api('/quests/tree/' + encodeURIComponent(key) + '/start', questSchema, 'POST', {}),
    ['quests', 'today'],
  );
  const [selected, setSelected] = useState<string>();
  const nodes = tree.data?.flatMap((branch) => branch.nodes) ?? [];
  const node = nodes.find(({ key }) => key === selected);
  const active = nodes.find(({ state }) => state === 'active');
  const activeQuest = node?.state === 'active' ? node.quest : null;
  const [selectedPath, setSelectedPath] = useState<string>();
  const branch =
    tree.data?.find(({ key }) => key === selectedPath) ??
    tree.data?.find(({ nodes }) => nodes.some(({ state }) => state === 'active')) ??
    tree.data?.[0];
  const path = branch && pathStyle(branch.key);
  const completed = nodes.filter(({ state }) => state === 'completed').length;
  const next = active ?? branch?.nodes.find(({ state }) => state === 'available');

  function openQuest(key: string) {
    start.reset();
    setSelected(key);
  }
  const close = () => {
    setSelected(undefined);
    start.reset();
  };

  return (
    <Card className="card quest-atlas" aria-labelledby="quest-tree-title">
      <header className="quest-atlas-hero">
        <CompassArt />
        <div className="quest-atlas-hero-copy">
          <p className="quest-atlas-kicker">
            <Compass size={15} aria-hidden="true" /> Hallway adventure
          </p>
          <h2 id="quest-tree-title">Quest tree</h2>
          <p>Four paths. Twenty small adventures.</p>
          {tree.data && (
            <div className="quest-atlas-progress">
              <span>
                <strong>{completed}</strong> / {nodes.length} completed
              </span>
              <progress aria-label="Quests completed" value={completed} max={nodes.length} />
            </div>
          )}
        </div>
      </header>
      <div className="quest-atlas-body">
        {tree.loading && !tree.data && <Loading />}
        <ErrorText error={tree.error} />
        {tree.error && !tree.data && (
          <Button variant="secondary" onClick={tree.refresh}>
            Retry quest tree
          </Button>
        )}
        {tree.data && branch && path && (
          <>
            <div className="quest-atlas-section-label">Choose your path</div>
            <div className="quest-atlas-paths" role="group" aria-label="Quest paths">
              {tree.data.map((item) => {
                const PathIcon = pathStyle(item.key).icon;
                const done = item.nodes.filter(({ state }) => state === 'completed').length;
                return (
                  <Button
                    key={item.key}
                    variant="ghost"
                    className="quest-atlas-path"
                    data-branch={item.key}
                    aria-pressed={item.key === branch.key}
                    onClick={() => setSelectedPath(item.key)}
                  >
                    <span className="quest-atlas-path-icon">
                      <PathIcon aria-hidden="true" />
                    </span>
                    <span className="quest-atlas-path-copy">
                      <strong>{item.title}</strong>
                      <span>
                        {done}/{item.nodes.length} completed
                      </span>
                    </span>
                  </Button>
                );
              })}
            </div>
            <section
              className="quest-atlas-route"
              data-branch={branch.key}
              aria-label={branch.title + ' quest path'}
            >
              <header className="quest-atlas-route-header">
                <div>
                  <p className="quest-atlas-section-label">Path {path.number}</p>
                  <h3>{branch.title}</h3>
                  <p>{path.subtitle}.</p>
                </div>
                <path.icon size={36} aria-hidden="true" className="quest-atlas-route-emblem" />
              </header>
              <ol className="quest-atlas-track">
                {branch.nodes.map((item, index) => {
                  const Marker = markers[item.state];
                  return (
                    <li key={item.key} data-state={item.state}>
                      <Button
                        variant="ghost"
                        className="quest-atlas-node"
                        aria-label={item.state + ' ' + item.title}
                        aria-current={item.state === 'active' ? 'step' : undefined}
                        onClick={() => openQuest(item.key)}
                      >
                        <span className="quest-atlas-node-marker">
                          <Marker size={17} aria-hidden="true" />
                        </span>
                        <span className="quest-atlas-node-copy">
                          <span className="quest-atlas-node-status">
                            {String(index + 1).padStart(2, '0')} · {item.state}
                          </span>
                          <strong>{item.title}</strong>
                          <span className="quest-atlas-node-xp">{points[item.difficulty]} XP</span>
                        </span>
                      </Button>
                    </li>
                  );
                })}
              </ol>
              {next ? (
                <Button
                  variant="ghost"
                  className="quest-atlas-next"
                  onClick={() => openQuest(next.key)}
                >
                  <span className="quest-atlas-next-icon">
                    <Zap aria-hidden="true" />
                  </span>
                  <span>
                    <span className="quest-atlas-section-label">
                      {active ? 'Quest in progress' : 'Next checkpoint'}
                    </span>
                    <strong>{next.title}</strong>
                  </span>
                  <ArrowUpRight aria-hidden="true" className="quest-atlas-next-arrow" />
                </Button>
              ) : (
                <p className="quest-atlas-finished">
                  <Sparkles size={17} aria-hidden="true" /> Path complete
                </p>
              )}
            </section>
          </>
        )}
      </div>
      <Sheet
        open={!!node}
        onOpenChange={(open) => {
          if (!open) close();
        }}
        title={node?.title ?? 'Quest details'}
      >
        {node &&
          (activeQuest ? (
            renderActive(activeQuest, close)
          ) : (
            <div className="form quest-atlas-details">
              <div className="quest-atlas-detail-stats">
                <span className="chip">{node.minutes} min</span>
                <span className="chip capitalize">{node.difficulty}</span>
                <span className="chip">
                  <Zap size={14} aria-hidden="true" /> {points[node.difficulty]} XP
                </span>
              </div>
              <p>{node.mission}</p>
              {node.icebreaker && <p>Conversation starter: “{node.icebreaker}”</p>}
              {node.state === 'locked' && (
                <p>Complete the previous quest in this branch to unlock this one.</p>
              )}
              {node.state === 'completed' && <p>Quest completed.</p>}
              {node.state === 'available' &&
                (active ? (
                  <Button variant="secondary" onClick={() => openQuest(active.key)}>
                    Open active quest
                  </Button>
                ) : (
                  <Button onClick={() => start.run(node.key)} disabled={start.loading}>
                    Start tree quest
                  </Button>
                ))}
              <ErrorText error={start.error} />
            </div>
          ))}
      </Sheet>
    </Card>
  );
}
