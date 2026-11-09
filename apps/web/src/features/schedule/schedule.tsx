import {
  calendarImportSchema,
  calendarPreviewSchema,
  eventSchema,
  saveEventSchema,
} from '@hallway/shared/responses';
import { z } from 'zod';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Temporal } from '@js-temporal/polyfill';
import { CalendarDays, ChevronLeft, ChevronRight, Download, Plus, Upload } from 'lucide-react';
import { category, conferenceZone, eventInput, type EventInput } from '@hallway/shared';
import {
  api,
  useAction,
  useResource,
  type Event,
  type SaveResult,
  type User,
} from '../../shared/api';
import {
  Checkbox,
  Input,
  Textarea,
  NativeSelect,
  Card,
  Button,
  dayLabel,
  Empty,
  ErrorText,
  Heading,
  Loading,
  Sheet,
} from '../../shared/ui';
import { Checklist, EventRow } from '../today/today';

export const addDays = (day: string, count: number) =>
  Temporal.PlainDate.from(day).add({ days: count }).toString();
export const isoDay = (iso: string, zone = conferenceZone) =>
  Temporal.Instant.from(iso).toZonedDateTimeISO(zone).toPlainDate().toString();
const categories = category.options;
function inputTime(iso: string | null | undefined, zone: string, fallback: string) {
  return iso
    ? Temporal.Instant.from(iso)
        .toZonedDateTimeISO(zone)
        .toPlainDateTime()
        .toString({ smallestUnit: 'minute' })
    : fallback;
}

function EventEditor({
  current,
  day,
  close,
  onSaved,
}: {
  current: Event | null;
  day: string;
  close: () => void;
  onSaved: (event: Event) => void;
}) {
  const [allDay, setAllDay] = useState(!!current && !current.startsAt);
  const [validation, setValidation] = useState<string>();
  const [pending, setPending] = useState<EventInput>();
  const zone = current?.zone ?? conferenceZone;
  const save = useAction<SaveResult, { event: EventInput; confirmConflict?: boolean }>(
    (data) =>
      api(
        current ? '/events/' + current.id : '/events',
        saveEventSchema,
        current ? 'PUT' : 'POST',
        data,
      ),
    ['events', 'today'],
  );
  const change = useAction<unknown, 'complete' | 'delete'>(
    (action) =>
      action === 'delete'
        ? api('/events/' + current?.id, z.void(), 'DELETE')
        : api('/events/' + current?.id + '/complete', eventSchema, 'POST', {
            completed: !current?.completedAt,
          }),
    ['events', 'today'],
  );
  const submit = (event: EventInput, confirmConflict = false) =>
    save.run(
      { event, confirmConflict },
      {
        onSuccess: (result) => {
          if (result.conflicts?.length) setPending(event);
          else {
            if (result.event) onSaved(result.event);
            close();
          }
        },
      },
    );
  return (
    <>
      <form
        className="form"
        onSubmit={(event) => {
          event.preventDefault();
          setValidation(undefined);
          setPending(undefined);
          const data = new FormData(event.currentTarget);
          const read = (name: string) => String(data.get(name) ?? '');
          try {
            const inputZone = read('zone');
            const toInstant = (name: string) =>
              Temporal.PlainDateTime.from(read(name))
                .toZonedDateTime(inputZone, { disambiguation: 'reject' })
                .toInstant()
                .toString();
            submit(
              eventInput.parse({
                title: read('title'),
                category: read('category'),
                location: read('location'),
                description: read('description'),
                zone: inputZone,
                startsAt: allDay ? null : toInstant('start'),
                endsAt: allDay ? null : toInstant('end'),
                day: allDay ? read('day') : null,
                endDay: allDay ? read('endDay') || null : null,
              }),
            );
          } catch {
            setValidation(
              'Check the time zone and make sure the end follows the start. Choose an unambiguous local time.',
            );
          }
        }}
      >
        <label>
          Title
          <Input
            name="title"
            required
            maxLength={200}
            defaultValue={current?.title}
            placeholder="Add an activity"
          />
        </label>
        <div className="form-grid">
          <label>
            Category
            <NativeSelect name="category" defaultValue={current?.category ?? 'personal'}>
              {categories.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </NativeSelect>
          </label>
          <label>
            Location
            <Input
              name="location"
              defaultValue={current?.location}
              maxLength={200}
              placeholder="Venue or room"
            />
          </label>
        </div>
        <label className="check-label">
          <Checkbox checked={allDay} onCheckedChange={(checked) => setAllDay(checked === true)} />{' '}
          All day or time TBD
        </label>
        {allDay ? (
          <div className="form-grid">
            <label>
              Date
              <Input name="day" type="date" required defaultValue={current?.day || day} />
            </label>
            <label>
              End date (exclusive, optional)
              <Input name="endDay" type="date" defaultValue={current?.endDay || ''} />
            </label>
          </div>
        ) : (
          <div className="form-grid">
            <label>
              Starts
              <Input
                name="start"
                type="datetime-local"
                required
                defaultValue={inputTime(current?.startsAt, zone, day + 'T13:00')}
              />
            </label>
            <label>
              Ends
              <Input
                name="end"
                type="datetime-local"
                required
                defaultValue={inputTime(current?.endsAt, zone, day + 'T14:00')}
              />
            </label>
          </div>
        )}
        <label>
          Time zone
          <Input name="zone" required defaultValue={zone} />
        </label>
        <label>
          Notes
          <Textarea
            name="description"
            maxLength={4000}
            rows={2}
            defaultValue={current?.description}
          />
        </label>
        {validation && (
          <p className="error" role="alert">
            {validation}
          </p>
        )}
        <ErrorText error={save.error || change.error} />
        {pending && save.data?.conflicts?.length ? (
          <div className="inline-note">
            <p>Overlaps with {save.data.conflicts.map((item) => item.title).join(', ')}.</p>
            <Button disabled={save.loading} onClick={() => submit(pending, true)}>
              Save anyway
            </Button>
          </div>
        ) : null}
        <div className="button-row">
          <Button type="submit" disabled={save.loading}>
            Save activity
          </Button>
          {current && (
            <Button
              variant="secondary"
              disabled={change.loading}
              onClick={() => change.run('complete', { onSuccess: close })}
            >
              {current.completedAt ? 'Mark incomplete' : 'Mark complete'}
            </Button>
          )}
          {current && (
            <Button
              variant="ghost"
              disabled={change.loading}
              onClick={() => {
                if (window.confirm('Delete this activity?'))
                  change.run('delete', { onSuccess: close });
              }}
            >
              Delete
            </Button>
          )}
        </div>
      </form>
      {current && (
        <div className="sheet-extra">
          <h3>Preparation checklist</h3>
          <Checklist eventId={current.id} items={current.checklist} />
        </div>
      )}
    </>
  );
}

function ImportCalendar() {
  const [source, setSource] = useState('');
  const [readError, setReadError] = useState('');
  const preview = useAction<
    { skipped: number; entries: { sourceKey: string; event: EventInput; duplicate: boolean }[] },
    string
  >((text) => api('/calendar/import', calendarPreviewSchema, 'POST', { text }));
  const save = useAction<{ imported: number; skipped: number; duplicates: number }, string>(
    (text) => api('/calendar/import', calendarImportSchema, 'POST', { text, commit: true }),
    ['events', 'today'],
  );
  return (
    <div className="form">
      <label>
        Calendar file
        <Input
          type="file"
          accept=".ics,text/calendar"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            preview.reset();
            save.reset();
            setSource('');
            setReadError('');
            if (!file) return;
            if (file.size > 700000) {
              setReadError('Choose an ICS file under 700 KB.');
              return;
            }
            try {
              const text = await file.text();
              setSource(text);
              preview.run(text);
            } catch {
              setReadError('Could not read this file.');
            }
          }}
        />
      </label>
      {(preview.loading || save.loading) && <Loading />}
      <ErrorText error={readError || preview.error || save.error} />
      {save.data ? (
        <p role="status">
          {save.data.imported} imported · {save.data.duplicates} duplicates · {save.data.skipped}{' '}
          skipped
        </p>
      ) : (
        preview.data && (
          <>
            <p>
              {preview.data.entries.length} entries · {preview.data.skipped} unreadable
            </p>
            <ul className="simple-list">
              {preview.data.entries.slice(0, 12).map((entry) => (
                <li key={entry.sourceKey}>
                  {entry.event.title}
                  {entry.duplicate ? ' · Already saved' : ''}
                </li>
              ))}
            </ul>
            <Button
              disabled={save.loading || !preview.data.entries.some((entry) => !entry.duplicate)}
              onClick={() => save.run(source)}
            >
              Import events
            </Button>
          </>
        )
      )}
    </div>
  );
}

export function Schedule({ user }: { user: User }) {
  const [day, setDay] = useState(user.demo ? '2026-11-10' : isoDay(new Date().toISOString()));
  const [week, setWeek] = useState(false);
  const [edit, setEdit] = useState<'new' | Event | null>(null);
  const [importing, setImporting] = useState(false);
  const [params, setParams] = useSearchParams();
  const editId = params.get('edit');
  function closeEditor() {
    setEdit(null);
    if (editId)
      setParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          next.delete('edit');
          return next;
        },
        { replace: true },
      );
  }
  const query = useResource('events', () => api('/events', eventSchema.array()));
  const dates = Array.from({ length: week ? 7 : 1 }, (_, index) => addDays(day, index));
  const linked = query.data?.find((item) => item.id === editId);
  const selected =
    typeof edit === 'object' && edit
      ? (query.data?.find((item) => item.id === edit.id) ?? edit)
      : (linked ?? null);
  return (
    <>
      <Heading
        label="Your agenda"
        title="Schedule"
        description="Make room for the things that matter."
        action={
          <Button onClick={() => setEdit('new')}>
            <Plus size={18} /> Add activity
          </Button>
        }
      />
      {editId && query.loading && <Loading />}
      {editId && query.data && !linked && (
        <ErrorText error="This activity is no longer on your schedule." />
      )}
      <Card className="card block dashboard-card">
        <div className="schedule-tools">
          <div className="button-row">
            <Button
              variant="ghost"
              className="icon-button"
              aria-label="Previous dates"
              onClick={() => setDay(addDays(day, week ? -7 : -1))}
            >
              <ChevronLeft />
            </Button>
            <strong>
              {dayLabel(day, { weekday: undefined })}
              {week ? ' – ' + dayLabel(addDays(day, 6), { weekday: undefined }) : ''}
            </strong>
            <Button
              variant="ghost"
              className="icon-button"
              aria-label="Next dates"
              onClick={() => setDay(addDays(day, week ? 7 : 1))}
            >
              <ChevronRight />
            </Button>
          </div>
          <div className="button-row">
            <Button
              variant={week ? 'ghost' : 'secondary'}
              onClick={() => setWeek(false)}
              aria-pressed={!week}
            >
              Day
            </Button>
            <Button
              variant={week ? 'secondary' : 'ghost'}
              onClick={() => setWeek(true)}
              aria-pressed={week}
            >
              Week
            </Button>
          </div>
        </div>
        <p className="muted with-icon">
          <CalendarDays size={15} /> Mountain Time · America/Denver
        </p>
        {query.loading && <Loading />}
        <ErrorText error={query.error} />
        <div className={week ? 'week-grid' : ''}>
          {dates.map((date) => {
            const events = (query.data ?? []).filter((event) =>
              event.day
                ? event.day <= date && (event.endDay ?? addDays(event.day, 1)) > date
                : event.startsAt &&
                  event.endsAt &&
                  isoDay(event.startsAt) <= date &&
                  isoDay(new Date(Date.parse(event.endsAt) - 1).toISOString()) >= date,
            );
            return (
              <div key={date} className="day-column">
                <h3>{dayLabel(date)}</h3>
                {events.length ? (
                  events.map((event) => (
                    <button
                      className="plain-event"
                      key={event.id}
                      type="button"
                      onClick={() => setEdit(event)}
                    >
                      <EventRow event={event} />
                    </button>
                  ))
                ) : (
                  <p className="muted">Nothing scheduled.</p>
                )}
              </div>
            );
          })}
        </div>
        {!query.loading && query.data?.length === 0 && (
          <Empty title="Your schedule is open">
            Add a personal activity or save something from Explore.
          </Empty>
        )}
      </Card>
      <div className="button-row section-gap">
        <Button variant="secondary" onClick={() => setImporting(true)}>
          <Upload size={17} /> Import ICS
        </Button>
        <a className="button button-secondary" href="/api/calendar/export">
          <Download size={17} /> Export ICS
        </a>
      </div>
      <Sheet
        open={!!edit || !!linked}
        onOpenChange={(open) => {
          if (!open) closeEditor();
        }}
        title={selected ? 'Edit activity' : 'Add activity'}
      >
        {(edit || linked) && (
          <EventEditor
            key={selected?.id ?? 'new'}
            current={selected}
            day={day}
            close={closeEditor}
            onSaved={(event) => {
              const eventDay = event.startsAt ? isoDay(event.startsAt) : event.day;
              if (eventDay) setDay(eventDay);
            }}
          />
        )}
      </Sheet>
      <Sheet open={importing} onOpenChange={setImporting} title="Import a calendar">
        {importing && <ImportCalendar />}
      </Sheet>
    </>
  );
}
