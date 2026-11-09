import { questSchema, questTreeSchema } from '@hallway/shared/responses';
import { Check, Flag, Lock, Play } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { api, useAction, useResource, type Quest } from '../../shared/api';
import { Button, Card, ErrorText, Loading, points, Sheet } from '../../shared/ui';

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
  const close = () => {
    setSelected(undefined);
    start.reset();
  };

  return (
    <Card className="card block quest-map" aria-labelledby="quest-tree-title">
      <div className="quest-map-heading">
        <span className="tile lavender">
          <Flag size={20} aria-hidden="true" />
        </span>
        <div>
          <p className="eyebrow">YOUR ADVENTURE</p>
          <h2 id="quest-tree-title">Quest tree</h2>
        </div>
        {tree.data && (
          <span className="chip">
            {nodes.filter(({ state }) => state === 'completed').length} / {nodes.length}
          </span>
        )}
      </div>
      <p className="muted">Choose a path. Finish a quest to unlock the next one in that branch.</p>
      {tree.loading && !tree.data && <Loading />}
      <ErrorText error={tree.error} />
      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {tree.data?.map((branch) => (
          <section key={branch.key} className="rounded-xl border border-border p-3">
            <h3 className="mb-3">{branch.title}</h3>
            <ol className="quest-map-trail">
              {branch.nodes.map((item) => {
                const Marker = markers[item.state];
                return (
                  <li
                    key={item.key}
                    className={
                      'quest-map-stop ' +
                      (item.state === 'completed'
                        ? 'is-complete'
                        : item.state === 'active'
                          ? 'is-current'
                          : '')
                    }
                  >
                    <span className="quest-map-marker">
                      <Marker size={15} aria-hidden="true" />
                    </span>
                    <Button
                      variant={item.state === 'active' ? 'secondary' : 'ghost'}
                      className="h-auto min-w-0 flex-1 flex-col items-start whitespace-normal text-left"
                      onClick={() => {
                        start.reset();
                        setSelected(item.key);
                      }}
                    >
                      <span className="quest-map-status capitalize">{item.state}</span>
                      <span>{item.title}</span>
                    </Button>
                  </li>
                );
              })}
            </ol>
          </section>
        ))}
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
            <div className="form">
              <p>{node.mission}</p>
              <p className="muted">
                {node.minutes} min · {node.difficulty} · {points[node.difficulty]} XP
              </p>
              {node.icebreaker && <p>Conversation starter: “{node.icebreaker}”</p>}
              {node.state === 'locked' && (
                <p>Complete the previous quest in this branch to unlock this one.</p>
              )}
              {node.state === 'completed' && <p>Quest completed.</p>}
              {node.state === 'available' &&
                (active ? (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      start.reset();
                      setSelected(active.key);
                    }}
                  >
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
