import { Badge } from '../../shared/components/ui/badge';
import {
  credentialSchema,
  okSchema,
  progressSchema,
  reminderPreferences,
} from '@hallway/shared/responses';
import { z } from 'zod';
import { useState } from 'react';
import { Bell, KeyRound, LogOut, Trophy, Zap } from 'lucide-react';
import {
  api,
  useAction,
  useResource,
  type Preferences,
  type Progress,
  type User,
} from '../../shared/api';
import { ProfileForm } from './profile-form';
import { Checkbox, Input, Card, Button, ErrorText, Heading, Loading } from '../../shared/ui';

const prefs: Preferences = {
  enabled: false,
  quietStart: '22:00',
  quietEnd: '07:00',
  zone: 'America/Denver',
};
function Reminders({ user }: { user: User }) {
  const [message, setMessage] = useState('');
  const save = useAction<Preferences, Preferences>(
    (value) => api('/reminders/preferences', reminderPreferences, 'PUT', value),
    ['reminders'],
  );
  const push = useAction<void, void>(async () => {
    if (
      !('serviceWorker' in navigator) ||
      !('PushManager' in window) ||
      !('Notification' in window)
    )
      throw new Error('Browser push is unavailable here. In-app reminders still work.');
    const { key } = await api('/push/key', z.object({ key: z.string().nullable() }));
    if (!key)
      throw new Error(
        'Browser push is not configured on this server. In-app reminders still work.',
      );
    if ((await Notification.requestPermission()) !== 'granted')
      throw new Error('Browser notifications are disabled.');
    const registration = await navigator.serviceWorker.ready;
    const subscription =
      (await registration.pushManager.getSubscription()) ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: key,
      }));
    await api('/push/subscriptions', okSchema, 'POST', subscription.toJSON());
    setMessage('Browser notifications enabled.');
  });
  const current = save.data ?? user.reminderPrefs ?? prefs;
  return (
    <Card className="card block dashboard-card">
      <h2 className="with-icon">
        <Bell size={21} /> Reminders
      </h2>
      <form
        className="form"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          save.run({
            enabled: data.has('enabled'),
            quietStart: String(data.get('quietStart')),
            quietEnd: String(data.get('quietEnd')),
            zone: String(data.get('zone')),
          });
        }}
      >
        <label className="check-label">
          <Checkbox name="enabled" defaultChecked={current.enabled} /> Enable reminders
        </label>
        <div className="form-grid">
          <label>
            Quiet hours start
            <Input name="quietStart" type="time" required defaultValue={current.quietStart} />
          </label>
          <label>
            Quiet hours end
            <Input name="quietEnd" type="time" required defaultValue={current.quietEnd} />
          </label>
        </div>
        <label>
          Reminder time zone
          <Input name="zone" required defaultValue={current.zone} />
        </label>
        <ErrorText error={save.error || push.error} />
        <div className="button-row">
          <Button type="submit" disabled={save.loading}>
            Save reminders
          </Button>
          <Button
            variant="secondary"
            disabled={!current.enabled || push.loading}
            onClick={() => push.run()}
          >
            Enable browser push
          </Button>
        </div>
        {(message || save.data) && (
          <p className="muted" role="status">
            {message || 'Reminder settings saved.'}
          </p>
        )}
      </form>
    </Card>
  );
}
function Credentials() {
  const query = useResource('credentials', () => api('/mcp/credentials', credentialSchema.array()));
  const create = useAction<
    { id: string; token: string },
    { label: string; canWrite: boolean; canSchedule: boolean }
  >(
    (input) =>
      api('/mcp/credentials', credentialSchema.extend({ token: z.string() }), 'POST', input),
    ['credentials'],
  );
  const revoke = useAction<void, string>(
    (id) => api('/mcp/credentials/' + id, z.void(), 'DELETE'),
    ['credentials'],
  );
  return (
    <Card className="card block dashboard-card">
      <h2 className="with-icon">
        <KeyRound size={20} /> Connect an AI client
      </h2>
      <p>
        Connect Gemini Apps or another remote MCP client. Credentials expire in 30 days and can be
        revoked here.
      </p>
      <div className="mcp-setup">
        <strong>Set up Gemini Apps</strong>
        <ol>
          <li>Create a credential below and copy the client ID and secret when they appear.</li>
          <li>
            In{' '}
            <a href="https://gemini.google.com/" target="_blank" rel="noreferrer">
              Gemini web
            </a>
            , open Settings → Connected Apps → Add a custom app.
          </li>
          <li>
            Enter the public HTTPS endpoint <code>{window.location.origin}/mcp</code>. Under
            Advanced features, enter the client ID and secret, then sign in to Hallway Quest and
            approve access.
          </li>
          <li>
            In Gemini web or mobile, select <code>@Hallway Quest</code>. Use voice input to ask
            Scout to recommend an activity or add an event if schedule creation is enabled.
          </li>
        </ol>
      </div>
      <form
        className="form"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          create.run({
            label: String(data.get('label')),
            canWrite: data.has('canWrite'),
            canSchedule: data.has('canSchedule'),
          });
        }}
      >
        <label>
          Client name
          <Input name="label" required maxLength={80} placeholder="My AI assistant" />
        </label>
        <label className="check-label">
          <Checkbox name="canWrite" /> Allow quest completion
        </label>
        <label className="check-label">
          <Checkbox name="canSchedule" /> Allow schedule event creation
        </label>
        <Button type="submit" disabled={create.loading}>
          Create credential
        </Button>
      </form>
      {create.data && (
        <div className="inline-note credential">
          <label>
            Client ID <Input readOnly value={create.data.id} />
          </label>
          <label>
            Client secret (copy now)
            <Input readOnly value={create.data.token} onFocus={(event) => event.target.select()} />
          </label>
          <Button variant="secondary" onClick={() => create.reset()}>
            Hide credential
          </Button>
        </div>
      )}
      {query.data?.map((item) => (
        <div className="inline-note" key={item.id}>
          <span>
            {item.label} ·{' '}
            {[
              ...(item.canWrite ? ['quest completion'] : []),
              ...(item.canSchedule ? ['schedule creation'] : []),
            ].join(', ') || 'read only'}
          </span>
          <Button variant="ghost" disabled={revoke.loading} onClick={() => revoke.run(item.id)}>
            Revoke
          </Button>
        </div>
      ))}
      <p className="muted">Gemini asks you to confirm write actions before it runs them.</p>
      <ErrorText error={query.error || create.error || revoke.error} />
    </Card>
  );
}
export function Profile({
  user,
  onUser,
  logout,
}: {
  user: User;
  onUser: (user: User) => void;
  logout: () => void;
}) {
  const progress = useResource('progress', () => api('/progress', progressSchema));
  return (
    <>
      <Heading
        label="Your field notes"
        title="Profile"
        description="Make Hallway Quest work the way you do."
        action={
          <Button variant="secondary" onClick={logout}>
            <LogOut size={17} /> Sign out
          </Button>
        }
      />
      <Card className="card block dashboard-card">
        <h2 className="with-icon">
          <Trophy size={22} /> Achievements
        </h2>
        {progress.loading && <Loading />}
        <ErrorText error={progress.error} />
        {progress.data && (
          <>
            <p className="with-icon">
              <Zap size={18} /> <strong>{progress.data.xp} XP</strong> · Level {progress.data.level}{' '}
              · {progress.data.completed} quests completed
            </p>
            <div className="chips">
              {progress.data.badges.length ? (
                progress.data.badges.map((badge) => (
                  <Badge variant="secondary" className="chip badge" key={badge}>
                    <Trophy size={16} /> {badge}
                  </Badge>
                ))
              ) : (
                <p className="muted">Complete a quest to earn your first badge.</p>
              )}
            </div>
          </>
        )}
      </Card>
      <div className="profile-layout">
        <Card className="card block dashboard-card">
          <h2>Attendee preferences</h2>
          <ProfileForm user={user} onUser={onUser} />
        </Card>
        <div className="profile-side">
          <Reminders user={user} />
          <Credentials />
        </div>
      </div>
    </>
  );
}
