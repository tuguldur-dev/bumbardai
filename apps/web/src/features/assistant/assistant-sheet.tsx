import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Compass, Trash2 } from 'lucide-react';
import { z } from 'zod';
import {
  assistantActionSchema,
  assistantHistorySchema,
  assistantTurnSchema,
} from '@hallway/shared/responses';
import { api, useAction, useResource } from '../../shared/api';
import { Button, ErrorText, Loading, Sheet, Textarea } from '../../shared/ui';

type Activity = NonNullable<z.infer<typeof assistantActionSchema>['savedActivity']>;

function SavedActivity({ activity, close }: { activity: Activity; close: () => void }) {
  const date = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: activity.zone,
  });
  const time = new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: activity.zone,
    timeZoneName: 'short',
  });
  return (
    <div className="mt-2 space-y-1 rounded-xl border border-border bg-card p-3">
      <strong>{activity.title}</strong>
      <p>
        {activity.startsAt && activity.endsAt
          ? date.format(new Date(activity.startsAt)) +
            ' – ' +
            time.format(new Date(activity.endsAt))
          : (activity.day ?? 'Time TBD')}
      </p>
      {activity.location && <p>{activity.location}</p>}
      <p className="muted">{activity.reason}</p>
      <Link
        className="text-link"
        to={'/schedule?edit=' + encodeURIComponent(activity.id)}
        onClick={close}
      >
        Edit activity <ArrowRight size={15} />
      </Link>
    </div>
  );
}

function ScoutAvatar() {
  return (
    <span className="scout-avatar" aria-label="Scout, your field guide" role="img">
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <circle cx="24" cy="24" r="23" fill="currentColor" opacity=".12" />
        <path d="M10 22a14 14 0 0 1 28 0v13H10z" fill="currentColor" opacity=".25" />
        <circle cx="24" cy="23" r="10" fill="var(--surface)" />
        <circle cx="20.5" cy="22" r="1.3" fill="currentColor" />
        <circle cx="27.5" cy="22" r="1.3" fill="currentColor" />
        <path d="M21 27q3 2.5 6 0" fill="none" stroke="currentColor" strokeLinecap="round" />
        <path d="m24 8 2 4-2-1-2 1z" fill="currentColor" />
      </svg>
    </span>
  );
}

export function AssistantSheet({
  open,
  close,
  initial,
}: {
  open: boolean;
  close: () => void;
  initial: string;
}) {
  const [question, setQuestion] = useState(initial);
  const history = useResource(
    'assistant-history',
    () => api('/assistant/history', assistantHistorySchema),
    { ready: open },
  );
  const action = useAction<z.infer<typeof assistantTurnSchema>, string>(
    (text) => api('/assistant', assistantTurnSchema, 'POST', { question: text }),
    ['assistant-history', 'quests', 'today', 'events'],
  );
  const clear = useAction<void, void>(
    () => api('/assistant/history', z.void(), 'DELETE'),
    ['assistant-history'],
  );
  const scroll = useRef<HTMLDivElement>(null);
  const asked = useRef(false);
  const messages = new Map(
    [...(history.data ?? []), ...(action.data?.messages ?? [])].map((message) => [
      message.id,
      message,
    ]),
  );

  useEffect(() => {
    if (initial && !asked.current) {
      asked.current = true;
      action.run(initial, { onSuccess: () => setQuestion('') });
    }
  }, [initial, action.run]);

  useEffect(() => {
    if (open) setQuestion(initial);
  }, [open, initial]);

  useEffect(() => {
    scroll.current?.scrollTo({ top: scroll.current.scrollHeight, behavior: 'smooth' });
  }, [history.data, action.data, action.loading, open]);

  return (
    <Sheet
      open={open}
      onOpenChange={(value) => {
        if (!value) close();
      }}
      title="Chat with Scout"
    >
      <div className="scout-chat">
        <div className="scout-intro">
          <ScoutAvatar />
          <div>
            <strong>Scout</strong>
            <p className="muted">Your conference field guide</p>
          </div>
          {(messages.size > 0 || history.loading) && (
            <Button
              className="scout-clear"
              variant="ghost"
              aria-label="Clear chat history"
              title="Clear chat history"
              disabled={clear.loading || history.loading || action.loading}
              onClick={() =>
                clear.run(undefined, {
                  onSuccess: () => {
                    action.reset();
                    history.refresh();
                  },
                })
              }
            >
              <Trash2 size={17} />
            </Button>
          )}
        </div>

        <div className="scout-transcript" ref={scroll} aria-live="polite" aria-label="Chat history">
          {history.loading && <Loading />}
          {!history.loading && messages.size === 0 && (
            <div className="scout-welcome">
              <ScoutAvatar />
              <p>
                Hey, I’m Scout. I can help you find your next step or add an event to your schedule.
              </p>
              <span className="muted">Your recent chat stays private to your account.</span>
            </div>
          )}
          {[...messages.values()].map((message) => (
            <div className={'scout-message ' + message.role} key={message.id}>
              {message.role === 'assistant' && <ScoutAvatar />}
              <div className="scout-bubble">
                {message.role === 'assistant' && (
                  <span className="scout-message-name">
                    Scout{message.mode === 'rules' ? ' · Rules-based guidance' : ''}
                  </span>
                )}
                <p>{message.content}</p>
                {message.action?.savedActivity ? (
                  <SavedActivity activity={message.action.savedActivity} close={close} />
                ) : (
                  message.action && (
                    <Link className="text-link" to={message.action.path} onClick={close}>
                      {message.action.kind === 'event' ? 'Open schedule' : 'Explore this'}{' '}
                      <ArrowRight size={15} />
                    </Link>
                  )
                )}
              </div>
            </div>
          ))}
          {action.loading && (
            <div className="scout-thinking" role="status">
              <Compass size={15} /> Scout is thinking…
            </div>
          )}
          <div className="scout-bottom" />
        </div>

        <div className="button-row" aria-label="Starter messages">
          {[
            'Find me a Kubernetes session this afternoon',
            'Schedule a session based on my interests',
          ].map((prompt) => (
            <Button
              key={prompt}
              type="button"
              variant="secondary"
              onClick={() => setQuestion(prompt)}
              disabled={action.loading}
              className="h-auto whitespace-normal text-left"
            >
              {prompt}
            </Button>
          ))}
        </div>
        <ErrorText error={history.error || action.error || clear.error} />
        <form
          className="form scout-composer"
          onSubmit={(event) => {
            event.preventDefault();
            const text = question.trim();
            if (!text) return;
            action.run(text, {
              onSuccess: () => setQuestion(''),
            });
          }}
        >
          <label>
            Message Scout
            <Textarea
              rows={2}
              maxLength={700}
              required
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="Add lunch with Alex tomorrow at noon…"
            />
          </label>
          <Button type="submit" disabled={!question.trim() || action.loading}>
            Send <ArrowRight size={17} />
          </Button>
        </form>
      </div>
    </Sheet>
  );
}
