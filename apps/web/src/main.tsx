import {
  attendeeSchema,
  eventSchema,
  questSchema,
  reminderSchema,
} from '@hallway/shared/responses';
import { z } from 'zod';
import React, { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useRequest } from 'ahooks';
import {
  BrowserRouter,
  Link,
  Navigate,
  NavLink,
  Route,
  Routes,
  useNavigate,
} from 'react-router-dom';
import { MotionConfig } from 'framer-motion';
import {
  Bell,
  CalendarDays,
  Compass,
  Home,
  Menu,
  Moon,
  Sparkles,
  Sun,
  Trophy,
  UserRound,
  WifiOff,
} from 'lucide-react';
import { api, ApiError, useAction, useResource, type User } from './shared/api';
import { AuthForm } from './features/auth/auth-form';
import { ProfileForm } from './features/profile/profile-form';
import { Today } from './features/today/today';
import { Card, Brand, Button, Empty, ErrorText, Heading, Loading, Sheet } from './shared/ui';
import { OfflinePage } from './features/offline/offline-page';
import { AssistantSheet } from './features/assistant/assistant-sheet';
import { clearSnapshot, readSnapshot, saveSnapshot } from './features/offline/snapshot';
import { useUI } from './shared/ui-store';
import './shared/styles.css';

const Explore = lazy(() =>
  import('./features/explore/explore').then((module) => ({ default: module.Explore })),
);
const Schedule = lazy(() =>
  import('./features/schedule/schedule').then((module) => ({ default: module.Schedule })),
);
const Quests = lazy(() =>
  import('./features/quests/quests').then((module) => ({ default: module.Quests })),
);
const Profile = lazy(() =>
  import('./features/profile/profile').then((module) => ({ default: module.Profile })),
);

const nav = [
  { path: '/', name: 'Today', icon: Home },
  { path: '/explore', name: 'Explore', icon: Compass },
  { path: '/quests', name: 'Quests', icon: Trophy },
  { path: '/schedule', name: 'Schedule', icon: CalendarDays },
  { path: '/profile', name: 'Profile', icon: UserRound },
];
const defaultQuestion = 'What should I do next?';

function Shell({
  user,
  onUser,
  sessionOwner,
}: {
  user: User;
  onUser: (user: User | null) => void;
  sessionOwner: React.RefObject<string | undefined>;
}) {
  const navigate = useNavigate();
  const ui = useUI();
  const [assistant, setAssistant] = useState<string | null>(null);
  const [notifications, setNotifications] = useState(false);
  const reminders = useResource('reminders', () => api('/reminders', reminderSchema.array()), {
    pollingInterval: 30000,
  });
  const dismiss = useAction<void, string>(
    (id) => api('/reminders/' + id, z.void(), 'DELETE'),
    ['reminders'],
  );
  const logout = useAction<void, void>(async () => {
    await api('/auth/logout', z.void(), 'POST');
    if ('serviceWorker' in navigator)
      void navigator.serviceWorker
        .getRegistration()
        .then((registration) => registration?.pushManager?.getSubscription())
        .then((subscription) => subscription?.unsubscribe())
        .catch(() => {});
  });
  const saved = useResource('events', () => api('/events', eventSchema.array()));
  const quests = useResource('quests', () => api('/quests', questSchema.array()));
  useEffect(() => {
    if (sessionOwner.current !== user.id) return;
    saveSnapshot(user, {
      ...(saved.data ? { events: saved.data } : {}),
      ...(quests.data
        ? { quests: quests.data.filter((quest) => ['active', 'suggested'].includes(quest.status)) }
        : {}),
    });
  }, [sessionOwner, user, saved.data, quests.data]);
  const links = nav.map(({ path, name, icon: Icon }) => (
    <NavLink key={path} to={path} end={path === '/'} title={name}>
      <Icon size={20} />
      <span>{name}</span>
    </NavLink>
  ));
  return (
    <div className={'layout ' + (ui.collapsed ? 'collapsed' : '')}>
      <a className="skip" href="#main-content">
        Skip to content
      </a>
      <aside className="sidebar">
        <Link to="/" aria-label="Hallway Quest home">
          <Brand />
        </Link>
        <div className="workspace-label">CONFERENCE HUB</div>
        <nav aria-label="Primary">{links}</nav>
        <div className="sidebar-footer">
          <div className="event-marker">
            <span className="tile lavender">
              <Compass size={17} />
            </span>
            <span>
              <strong>KubeCon NA ’26</strong>
              <small>Salt Lake City, UT</small>
            </span>
          </div>
          <Button variant="ghost" onClick={ui.toggleSidebar} aria-label="Toggle sidebar">
            <Menu size={18} />
            <span>{ui.collapsed ? 'Expand' : 'Collapse sidebar'}</span>
          </Button>
        </div>
      </aside>
      <div className="content-area">
        <header className="topbar">
          <div className="mobile-brand">
            <Brand />
          </div>
          <div className="edition">
            <span /> KubeCon North America 2026
          </div>
          <div className="top-actions">
            {user.demo && <span className="demo-label">Demo replay</span>}
            <Button
              className="icon-button"
              variant="ghost"
              aria-label={ui.dark ? 'Use light mode' : 'Use dark mode'}
              onClick={ui.toggleDark}
            >
              {ui.dark ? <Sun size={19} /> : <Moon size={19} />}
            </Button>
            <Button
              className="icon-button notice-button"
              variant="ghost"
              aria-label="Reminders"
              onClick={() => setNotifications(true)}
            >
              <Bell size={20} />
              {!!reminders.data?.length && <i />}
            </Button>
            <Link className="avatar" to="/profile" aria-label="Your profile">
              {user.profile?.nickname.slice(0, 1).toUpperCase() || 'H'}
            </Link>
          </div>
        </header>
        <main id="main-content" className="page">
          <ErrorText error={logout.error} />
          <Suspense fallback={<Loading />}>
            <Routes>
              <Route
                path="/"
                element={<Today user={user} ask={() => setAssistant(defaultQuestion)} />}
              />
              <Route path="/explore" element={<Explore user={user} />} />
              <Route path="/quests" element={<Quests />} />
              <Route path="/schedule" element={<Schedule user={user} />} />
              <Route
                path="/profile"
                element={
                  <Profile
                    user={user}
                    onUser={onUser}
                    logout={() =>
                      logout.run(undefined, {
                        onSuccess: () => {
                          onUser(null);
                          navigate('/');
                        },
                      })
                    }
                  />
                }
              />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
          <footer>
            Hallway Quest <span>·</span> Make the hallway yours.
          </footer>
        </main>
      </div>
      <nav className="bottom-nav" aria-label="Primary mobile">
        {links}
      </nav>
      <Button
        className="assistant-fab"
        onClick={() => setAssistant('')}
        aria-label="Chat with Scout"
      >
        <Sparkles size={21} />
        <span>Chat with Scout</span>
      </Button>
      {assistant !== null && (
        <AssistantSheet open initial={assistant} close={() => setAssistant(null)} />
      )}
      <Sheet open={notifications} onOpenChange={setNotifications} title="Reminders">
        {reminders.loading && <Loading />}
        <ErrorText error={reminders.error || dismiss.error} />
        {reminders.data?.length === 0 && (
          <Empty title="You’re all caught up">
            Enable reminders in Profile to get timely preparation nudges.
          </Empty>
        )}
        {reminders.data?.map((item) => (
          <div className="inline-note" key={item.id}>
            <span>{item.message}</span>
            <Button variant="ghost" onClick={() => dismiss.run(item.id)}>
              Dismiss
            </Button>
          </div>
        ))}
      </Sheet>
    </div>
  );
}

function App() {
  const dark = useUI((state) => state.dark);
  const [online, setOnline] = useState(navigator.onLine);
  const sessionOwner = useRef<string | undefined>(undefined);
  const me = useRequest(
    async () => {
      try {
        return await api('/me', attendeeSchema);
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    {
      ready: online,
      refreshOnWindowFocus: true,
      onSuccess: updateOwner,
      onError: () => {},
    },
  );

  function updateOwner(user: User | null) {
    if ((sessionOwner.current ?? readSnapshot()?.owner) !== user?.id) clearSnapshot();
    sessionOwner.current = user?.id;
    if (user) saveSnapshot(user);
  }

  function setUser(user: User | null) {
    me.cancel();
    updateOwner(user);
    me.mutate(user);
  }
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  }, [dark]);
  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    const storage = (event: StorageEvent) => {
      if (event.key === 'hallway-offline' && !event.newValue) me.refresh();
    };
    window.addEventListener('storage', storage);
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
      window.removeEventListener('storage', storage);
    };
  }, [me.refresh]);
  useLayoutEffect(() => {
    if (me.data === null) clearSnapshot();
  }, [me.data]);
  if (!online)
    return (
      <>
        <div className="offline-strip">
          <WifiOff size={16} /> Offline mode
        </div>
        <OfflinePage />
      </>
    );
  if (me.loading && me.data === undefined) return <Loading />;
  if (me.error)
    return (
      <main className="offline-page">
        <Brand />
        <ErrorText error={me.error} />
        <Button onClick={() => void me.refresh()}>Try again</Button>
        {readSnapshot() && <OfflinePage />}
      </main>
    );
  if (!me.data) return <AuthForm onUser={setUser} />;
  if (!me.data.profile)
    return (
      <main className="onboarding">
        <Brand />
        <Heading
          label="Your first checkpoint"
          title="Make this conference yours."
          description="Tell us a little about yourself. You can change any of this later."
        />
        <Card className="card block dashboard-card">
          <ProfileForm user={me.data} onUser={setUser} onboarding />
        </Card>
      </main>
    );
  return <Shell key={me.data.id} user={me.data} onUser={setUser} sessionOwner={sessionOwner} />;
}
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MotionConfig reducedMotion="user">
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </MotionConfig>
  </React.StrictMode>,
);
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
