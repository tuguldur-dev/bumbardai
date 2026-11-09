import {
  catalogResultsSchema,
  catalogSchema,
  icebreakerSchema,
  introductionSchema,
  peopleSchema,
  saveEventSchema,
} from '@hallway/shared/responses';
import { useDebounce } from 'ahooks';
import { useState } from 'react';
import { ArrowRight, CalendarPlus, Compass, Search, Users } from 'lucide-react';
import { interests } from '@hallway/shared';
import { useSearchParams } from 'react-router-dom';
import {
  api,
  useAction,
  useResource,
  type Catalog,
  type SaveResult,
  type User,
} from '../../shared/api';
import {
  Input,
  NativeSelect,
  Card,
  Button,
  dayLabel,
  Empty,
  ErrorText,
  Heading,
  Loading,
  Sheet,
  time,
} from '../../shared/ui';
import { SessionDetails } from '../today/today';

type Person = ReturnType<typeof peopleSchema.parse>['people'][number];
function MatchIcebreaker({ person }: { person: Person }) {
  const ice = useAction<{ icebreaker: string; mode: string }, void>(() =>
    api('/icebreaker', icebreakerSchema, 'POST', { topic: person.shared[0] }),
  );
  return (
    <>
      <p className="reason">“{ice.data?.icebreaker ?? person.icebreaker}”</p>
      {ice.data && (
        <p className="muted">
          {ice.data.mode === 'ai' ? 'AI conversation starter' : 'Rules-based conversation starter'}
        </p>
      )}
      <Button variant="ghost" disabled={ice.loading} onClick={() => ice.run()}>
        New conversation starter
      </Button>
      <ErrorText error={ice.error} />
    </>
  );
}
function People({ user }: { user: User }) {
  const query = useResource('people', () => api('/people', peopleSchema));
  const intro = useAction<unknown, string>(
    (id) => api('/people/' + id + '/intro', introductionSchema, 'POST', {}),
    ['people'],
  );
  const reply = useAction<unknown, { id: string; accept: boolean }>(
    ({ id, accept }) => api('/introductions/' + id, introductionSchema, 'PATCH', { accept }),
    ['people'],
  );
  return (
    <>
      {!user.profile?.discoverable && (
        <p className="inline-note">
          Enable attendee discovery in Profile to meet people and send introductions.
        </p>
      )}
      {query.loading && <Loading />}
      <ErrorText error={query.error || intro.error || reply.error} />
      {!!query.data?.introductions.length && (
        <Card className="card block dashboard-card">
          <h2>Introductions</h2>
          {query.data.introductions.map((item) => (
            <div className="inline-note" key={item.id}>
              <span>
                {item.nickname} · {item.status}
              </span>
              {item.incoming && item.status === 'pending' && (
                <div className="button-row">
                  <Button onClick={() => reply.run({ id: item.id, accept: true })}>Accept</Button>
                  <Button variant="ghost" onClick={() => reply.run({ id: item.id, accept: false })}>
                    Decline
                  </Button>
                </div>
              )}
            </div>
          ))}
        </Card>
      )}
      <div className="cards-grid">
        {query.data?.people.map((person) => (
          <Card className="card block dashboard-card" key={person.id}>
            <div className="section-label">
              <span className="tile mint">
                <Users size={18} />
              </span>{' '}
              ATTENDEE MATCH
            </div>
            <h2>{person.nickname}</h2>
            {person.background && <p>{person.background}</p>}
            {person.linkedinUrl && (
              <a href={person.linkedinUrl} target="_blank" rel="noreferrer">
                LinkedIn profile
              </a>
            )}
            <p className="muted">{person.reason}</p>
            <div className="chips">
              {person.shared.map((tag) => (
                <span className="chip" key={tag}>
                  {tag}
                </span>
              ))}
            </div>
            <MatchIcebreaker person={person} />
            <Button
              variant="secondary"
              disabled={
                intro.loading ||
                query.data?.introductions.some((item) => item.personId === person.id)
              }
              onClick={() => intro.run(person.id)}
            >
              Request introduction
            </Button>
          </Card>
        ))}
      </div>
      {query.data?.people.length === 0 && (
        <Empty title="No matches yet">
          Attendees can choose to appear here from their profile.
        </Empty>
      )}
    </>
  );
}

export function Explore({ user }: { user: User }) {
  const [params, setParams] = useSearchParams();
  const people = params.get('tab') === 'people';
  const [input, setInput] = useState('');
  const [day, setDay] = useState('');
  const [topic, setTopic] = useState('');
  const [skill, setSkill] = useState('');
  const [limit, setLimit] = useState(12);
  const q = useDebounce(input.trim(), { wait: 350 });
  const id = params.get('session');
  const query = useResource(
    'catalog',
    () =>
      api(
        '/catalog?' +
          new URLSearchParams({
            q,
            ...(day ? { day } : {}),
            ...(topic ? { topic } : {}),
            ...(skill ? { skill } : {}),
            limit: String(limit),
          }),
        catalogResultsSchema,
      ),
    { ready: !people, refreshDeps: [q, day, topic, skill, limit] },
  );
  const itemQuery = useResource(
    'catalog-item',
    () => api('/catalog/' + encodeURIComponent(id!), catalogSchema),
    { ready: !!id && !people, refreshDeps: [id] },
  );
  const item =
    query.data?.results.find((value) => value.id === id) ??
    (itemQuery.data?.id === id ? itemQuery.data : undefined);
  const save = useAction<SaveResult, { id: string; confirmConflict?: boolean }>(
    ({ id, confirmConflict }) =>
      api('/catalog/' + encodeURIComponent(id) + '/save', saveEventSchema, 'POST', {
        confirmConflict,
      }),
    ['events', 'today'],
  );
  const select = (value?: string) => {
    save.reset();
    setParams(value ? { session: value } : {});
  };
  return (
    <>
      <Heading
        label="Find your people and your talks"
        title="Explore"
        description="Follow your curiosity through the conference."
      />
      <div className="tabs" aria-label="Explore categories">
        <Button
          variant={!people ? 'secondary' : 'ghost'}
          onClick={() => setParams({})}
          aria-pressed={!people}
        >
          <Compass size={17} /> Sessions
        </Button>
        <Button
          variant={people ? 'secondary' : 'ghost'}
          onClick={() => setParams({ tab: 'people' })}
          aria-pressed={people}
        >
          <Users size={17} /> People
        </Button>
      </div>
      {people ? (
        <People user={user} />
      ) : (
        <>
          <Card className="card block search-panel">
            <label>
              Find a session
              <div className="search-field">
                <Search size={20} />
                <Input
                  value={input}
                  onChange={(event) => {
                    setInput(event.target.value);
                    setLimit(12);
                  }}
                  placeholder="Try “beginner-friendly Kubernetes talks”"
                />
              </div>
            </label>
            <div className="form-grid filters">
              <label>
                Date
                <Input
                  type="date"
                  value={day}
                  onChange={(event) => {
                    setDay(event.target.value);
                    setLimit(12);
                  }}
                />
              </label>
              <label>
                Topic
                <NativeSelect
                  value={topic}
                  onChange={(event) => {
                    setTopic(event.target.value);
                    setLimit(12);
                  }}
                >
                  <option value="">All topics</option>
                  {interests.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </NativeSelect>
              </label>
              <label>
                Skill level
                <NativeSelect
                  value={skill}
                  onChange={(event) => {
                    setSkill(event.target.value);
                    setLimit(12);
                  }}
                >
                  <option value="">All levels</option>
                  <option>Beginner</option>
                  <option>Advanced</option>
                  <option>Any Level</option>
                </NativeSelect>
              </label>
            </div>
          </Card>
          {query.loading && <Loading />}
          <ErrorText error={query.error} />
          {query.data && (
            <div className="results-line">
              <span>{query.data.results.length} shown</span>
              <span>
                {query.data.mode === 'hybrid'
                  ? 'Hybrid semantic search'
                  : query.data.mode === 'keyword'
                    ? 'Keyword-only search'
                    : 'Conference catalog'}
                {user.demo ? ' · Demo' : ''}
              </span>
            </div>
          )}
          {query.data?.results.length === 0 && (
            <Empty title="No sessions found">Try a broader search or remove a filter.</Empty>
          )}
          <div className="cards-grid">
            {query.data?.results.map((result) => (
              <Card key={result.id} className="card block dashboard-card">
                <div className="eyebrow">
                  {result.demo ? 'Demo · ' : ''}
                  {result.category}
                </div>
                <h2>{result.title}</h2>
                <p className="muted">
                  {dayLabel(result.day!)} · {time(result.startsAt)}
                </p>
                <p>{result.reason}</p>
                <Button variant="secondary" onClick={() => select(result.id)}>
                  View details <ArrowRight size={16} />
                </Button>
              </Card>
            ))}
          </div>
          {query.data?.results.length === limit && limit < 50 && (
            <Button
              className="section-gap"
              variant="secondary"
              onClick={() => setLimit(Math.min(50, limit + 12))}
            >
              Show more
            </Button>
          )}
          <Sheet
            open={!!id}
            onOpenChange={(open) => {
              if (!open) select();
            }}
            title={item?.title ?? 'Session details'}
          >
            {item ? (
              <>
                <SessionDetails item={item} />
                <div className="sheet-extra">
                  <ErrorText error={save.error} />
                  {save.data?.conflicts?.length ? (
                    <div className="inline-note">
                      <span>
                        Overlaps with{' '}
                        {save.data.conflicts.map((conflict) => conflict.title).join(', ')}.
                      </span>
                      <Button onClick={() => save.run({ id: item.id, confirmConflict: true })}>
                        Save anyway
                      </Button>
                    </div>
                  ) : save.data?.event ? (
                    <p role="status">Saved to your schedule</p>
                  ) : (
                    <Button disabled={save.loading} onClick={() => save.run({ id: item.id })}>
                      <CalendarPlus size={17} /> Save to schedule
                    </Button>
                  )}
                </div>
              </>
            ) : itemQuery.loading ? (
              <Loading />
            ) : (
              <ErrorText error={itemQuery.error} />
            )}
          </Sheet>
        </>
      )}
    </>
  );
}
