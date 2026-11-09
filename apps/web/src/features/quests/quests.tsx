import {
  awardSchema,
  icebreakerSchema,
  okSchema,
  questCodeSchema,
  questSchema,
} from '@hallway/shared/responses';
import { z } from 'zod';
import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Camera, Compass, MessageCircle, QrCode, Sparkles, Timer, Trophy, Zap } from 'lucide-react';
import { Link } from 'react-router-dom';
import { QuestLeaderboard } from './quest-leaderboard';
import { api, useAction, useResource, type Award, type Quest } from '../../shared/api';
import { QuestTree } from './quest-tree';
import {
  Input,
  Card,
  Button,
  Empty,
  ErrorText,
  Heading,
  Loading,
  points,
  Sheet,
} from '../../shared/ui';

function Scanner({ onScan }: { onScan: (code: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const handler = useRef(onScan);
  handler.current = onScan;
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    let stop: (() => void) | undefined;
    void (async () => {
      try {
        const { BrowserQRCodeReader } = await import('@zxing/browser');
        if (!live || !video.current) return;
        const reader = new BrowserQRCodeReader();
        const controls = await reader.decodeFromVideoDevice(
          undefined,
          video.current,
          (result, _, controls) => {
            const code = result?.getText().replace(/^hallway-quest:/, '');
            if (live && code && /^\d{4}-\d{4}-\d{4}$/.test(code)) {
              controls.stop();
              handler.current(code);
            }
          },
        );
        if (!live) controls.stop();
        else stop = () => controls.stop();
      } catch {
        if (live) setError('Camera unavailable. Enter the confirmation code below.');
      }
    })();
    return () => {
      live = false;
      stop?.();
    };
  }, []);
  return (
    <>
      <video className="scanner" ref={video} autoPlay muted playsInline />
      <ErrorText error={error} />
    </>
  );
}
export function QuestCard({ quest, onAward }: { quest: Quest; onAward: (result: Award) => void }) {
  const action = useAction<Award | { ok: true }, string>(
    (action) =>
      api('/quests/' + quest.id + '/action', awardSchema.or(okSchema), 'POST', { action }),
    ['quests', 'today', 'progress', 'quest-leaderboard'],
  );
  const ice = useAction<{ icebreaker: string }, void>(
    () => api('/icebreaker', icebreakerSchema, 'POST', { questId: quest.id }),
    ['quests', 'today'],
  );
  const qr = useAction<{ code: string; expiresAt: string }, void>(() =>
    api('/quests/' + quest.id + '/code', questCodeSchema, 'POST', {}),
  );
  const [qrImage, setQrImage] = useState('');
  const [showQr, setShowQr] = useState(false);
  useEffect(() => {
    if (!showQr || !qr.data) return;
    let live = true;
    const code = qr.data.code;
    void import('qrcode')
      .then(({ default: QRCode }) =>
        QRCode.toDataURL('hallway-quest:' + code, { width: 224, margin: 2 }),
      )
      .then((value) => {
        if (live) setQrImage(value);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [qr.data, showQr]);
  const active = quest.status === 'active';
  const pending = action.loading || ice.loading || qr.loading;
  return (
    <Card className="card block quest-card">
      <div className="section-label">
        <span className="tile peach">
          <Compass size={20} />
        </span>
        {quest.category}
        <span className="chip quest-status">{quest.status}</span>
      </div>
      <h2>{quest.title}</h2>
      <p>{quest.mission}</p>
      <div className="chips">
        <span className="chip">{quest.difficulty}</span>
        <span className="chip">
          <Timer size={14} /> {quest.minutes} min
        </span>
        <span className="chip">
          <Zap size={14} /> +{points[quest.difficulty]} XP
        </span>
        <span className="chip">{quest.mode === 'ai' ? 'AI personalized' : 'Rules-based'}</span>
      </div>
      <div className="icebreaker">
        <span className="eyebrow">
          <MessageCircle size={14} /> Conversation starter
        </span>
        <p>“{ice.data?.icebreaker || quest.icebreaker}”</p>
      </div>
      {(active || quest.status === 'suggested') && (
        <div className="button-row">
          <Button
            disabled={pending}
            onClick={() =>
              action.run(active ? 'complete' : 'start', {
                onSuccess: (result) => {
                  if ('awarded' in result) onAward(result);
                },
              })
            }
          >
            {active ? 'Complete quest' : 'Start quest'}
          </Button>
          <Button variant="secondary" disabled={pending} onClick={() => ice.run()}>
            New icebreaker
          </Button>
          <Link className="button button-secondary" to="/explore?tab=people">
            Find someone
          </Link>
          {active && (
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() => {
                setQrImage('');
                setShowQr(true);
                qr.run();
              }}
            >
              <QrCode size={17} /> Verify by QR
            </Button>
          )}
          <Button variant="ghost" disabled={pending} onClick={() => action.run('skip')}>
            Skip
          </Button>
        </div>
      )}
      <ErrorText error={action.error || ice.error} />
      <Sheet open={showQr} onOpenChange={setShowQr} title="Ask an attendee to confirm">
        {qr.loading && <Loading />}
        <ErrorText error={qr.error} />
        {qr.data && (
          <div className="qr-panel">
            {qrImage && (
              <img src={qrImage} alt="Quest confirmation QR code" width="224" height="224" />
            )}
            <strong className="code">{qr.data.code}</strong>
            <p>
              Another signed-in attendee can scan this QR or enter the code under Quests. It expires
              in five minutes.
            </p>
            <Button variant="secondary" onClick={() => setShowQr(false)}>
              Done
            </Button>
          </div>
        )}
      </Sheet>
    </Card>
  );
}
export function Quests() {
  const query = useResource('quests', () => api('/quests', questSchema.array()), {
    pollingInterval: 15000,
  });
  const create = useAction<Quest, void>(
    () => api('/quests/generate', questSchema, 'POST', {}),
    ['quests', 'today'],
  );
  const verify = useAction<{ verified: boolean }, string>(
    (code) => api('/quests/verify', z.object({ verified: z.literal(true) }), 'POST', { code }),
    ['quests', 'today', 'progress', 'quest-leaderboard'],
  );
  const [award, setAward] = useState<Award>();
  const [verifying, setVerifying] = useState(false);
  const [scan, setScan] = useState(false);
  const [code, setCode] = useState('');
  const available = query.data?.find(
    (quest) => !quest.templateKey && (quest.status === 'active' || quest.status === 'suggested'),
  );
  const history = query.data?.filter(
    (quest) => !quest.templateKey && (quest.status === 'completed' || quest.status === 'skipped'),
  );
  return (
    <>
      <Heading
        label="Small steps, real connections"
        title="Quests"
        description="A little practice makes the hallway feel more like home."
        action={
          <Button
            variant="secondary"
            onClick={() => {
              setCode('');
              setScan(false);
              verify.reset();
              setVerifying(true);
            }}
          >
            <QrCode size={18} /> Confirm a quest
          </Button>
        }
      />
      <QuestTree
        renderActive={(quest, close) => (
          <QuestCard
            key={quest.id}
            quest={quest}
            onAward={(result) => {
              close();
              setAward(result);
            }}
          />
        )}
      />
      {query.loading && <Loading />}
      <ErrorText error={query.error || create.error} />
      {available ? (
        <QuestCard key={available.id} quest={available} onAward={setAward} />
      ) : (
        !query.loading && (
          <Card className="card block quest-feature quest-empty">
            <div className="section-label">
              <span className="tile peach">
                <Sparkles size={21} />
              </span>{' '}
              YOUR NEXT MISSION
            </div>
            <h2>Start with a small quest.</h2>
            <p>
              We’ll suggest a challenge based on your interests, comfort level, and how much time
              you have.
            </p>
            <Button disabled={create.loading} onClick={() => create.run()}>
              {create.loading ? 'Creating quest…' : 'Generate a quest'}
            </Button>
          </Card>
        )
      )}
      <QuestLeaderboard />
      {history && history.length > 0 && (
        <section className="section-gap">
          <h2>Quest history</h2>
          <div className="cards-grid">
            {history.map((quest) => (
              <QuestCard key={quest.id} quest={quest} onAward={setAward} />
            ))}
          </div>
        </section>
      )}
      {!available && !history?.length && !query.loading && (
        <Empty title="Your quest log is fresh">
          Completed and skipped quests will appear here.
        </Empty>
      )}
      <Sheet
        open={!!award}
        onOpenChange={(open) => {
          if (!open) setAward(undefined);
        }}
        title="Quest completed"
      >
        {award && (
          <motion.div
            className="award"
            initial={{ opacity: 0, scale: 0.88 }}
            animate={{ opacity: 1, scale: 1 }}
          >
            <span className="tile peach">
              <Trophy size={26} />
            </span>
            <h2>+{award.awarded} XP</h2>
            {award.badges.map((badge) => (
              <p key={badge}>
                Badge unlocked · <strong>{badge}</strong>
              </p>
            ))}
            <Button onClick={() => setAward(undefined)}>Keep exploring</Button>
          </motion.div>
        )}
      </Sheet>
      <Sheet
        open={verifying}
        onOpenChange={(open) => {
          setVerifying(open);
          if (!open) setScan(false);
        }}
        title="Confirm an attendee’s quest"
      >
        {verify.data ? (
          <p role="status">Quest confirmed. Thanks for helping another attendee!</p>
        ) : (
          <form
            className="form"
            onSubmit={(event) => {
              event.preventDefault();
              verify.run(code.trim());
            }}
          >
            {scan ? (
              <Scanner
                onScan={(result) => {
                  setScan(false);
                  setCode(result);
                }}
              />
            ) : (
              <Button variant="secondary" onClick={() => setScan(true)}>
                <Camera size={17} /> Use camera
              </Button>
            )}
            <label>
              Confirmation code
              <Input
                placeholder="0000-0000-0000"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                required
              />
            </label>
            <ErrorText error={verify.error} />
            <Button type="submit" disabled={verify.loading}>
              Confirm quest
            </Button>
          </form>
        )}
      </Sheet>
    </>
  );
}
