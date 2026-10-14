import { useState } from 'react';
import Dialog from '../Dialog.jsx';
import { WEEKDAYS } from '../api.js';
import { useT } from '../i18n.jsx';
import { formatDay } from '../dates.js';
import Unavailable from './Unavailable.jsx';

// "12:15–13:45" -> ["12:15", "13:45"]
const splitTime = (label) => {
  const m = /(\d{1,2}):(\d{2})\s*[–-]\s*(\d{1,2}):(\d{2})/.exec(label || '');
  return m ? [`${m[1].padStart(2, '0')}:${m[2]}`, `${m[3].padStart(2, '0')}:${m[4]}`] : ['12:15', '13:30'];
};
const joinTime = (start, end) => `${start}–${end}`;

// One service a day at most, identified by its date. The usual hours come from the
// weekday; an admin can close a single date or give it other hours.
export default function Schedule({ days, weekly, staff, me, isAdmin, actions }) {
  const { t, lang } = useT();
  const [assigning, setAssigning] = useState(null); // a day
  const [editingDay, setEditingDay] = useState(null); // { day, closed, start, end, needed }
  const [editingWeek, setEditingWeek] = useState(false);
  const [formError, setFormError] = useState(null);
  const [showUnavailable, setShowUnavailable] = useState(false);

  const nameOf = new Map(staff.map((m) => [m.id, m.name]));
  const usualOf = (weekday) => weekly.find((w) => w.weekday === weekday);
  const hasService = days.some((d) => d.service);

  const openDay = (day) => {
    setFormError(null);
    const usual = usualOf(day.weekday);
    const [start, end] = splitTime(day.service?.time ?? usual?.time_label);
    setEditingDay({ day, closed: day.closed, start, end, needed: day.service?.needed ?? usual?.needed ?? 2 });
  };
  const openWeek = () => {
    setFormError(null);
    setEditingWeek(true);
  };

  return (
    <div className="screen-inner">
      <div className="page-head">
        <div>
          <div className="eyebrow">{t('Coming up')}</div>
          <h1 className="page-title">{t("Who's on the counter")}</h1>
          <p className="page-lede">{t('Shifts open for cover, and the people whose calendars are free.')}</p>
        </div>
        <div className="shift-actions">
          {hasService && (
            <button className="btn btn-secondary" onClick={() => setShowUnavailable(true)}>
              {t('Who is unavailable')}
            </button>
          )}
          {isAdmin && (
            <button className="btn btn-primary" onClick={openWeek}>
              {t('Usual hours')}
            </button>
          )}
        </div>
      </div>

      {days.length === 0 && (
        <div className="card elev-sm" style={{ padding: 'var(--space-6)' }}>
          <p className="text-muted" style={{ margin: 0 }}>
            {isAdmin ? t('No opening hours yet. Set the usual hours first.') : t('No shifts have been planned yet.')}
          </p>
        </div>
      )}

      <div className="stack gap-6">
        {days.map((day) =>
          day.closed ? (
            <div key={day.key} className="card elev-sm day-card day-closed">
              <div className="day-name">
                {formatDay(day.date, lang)}
                {day.isToday && <span className="tag tag-accent">{t('Today')}</span>}
                <span className="tag tag-neutral">{t('Closed')}</span>
              </div>
              {isAdmin && (
                <div className="shift-actions">
                  <button className="btn btn-ghost" onClick={() => actions.clearServiceDay(day.key)}>
                    {t('Reopen with the usual hours')}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <DayCard
              key={day.key}
              day={day}
              me={me}
              isAdmin={isAdmin}
              nameOf={nameOf}
              onAssign={() => setAssigning(day)}
              onEdit={() => openDay(day)}
              onToggle={(mine) => actions.toggleSelf(day.key, mine)}
            />
          ),
        )}
      </div>

      {showUnavailable && <Unavailable days={days} staff={staff} onClose={() => setShowUnavailable(false)} />}

      {assigning && (
        <Dialog
          title={`${formatDay(assigning.date, lang)} · ${assigning.service.time}`}
          submitLabel="Save"
          onClose={() => setAssigning(null)}
          onSubmit={(data) => {
            actions.assignService(assigning.key, data.getAll('staff').map(Number));
            setAssigning(null);
          }}
        >
          <p className="text-muted" style={{ margin: 0 }}>
            {t('Choose up to {n} people for this shift.', { n: assigning.service.needed })}
          </p>
          {staff.map((m) => (
            <label key={m.id} className="dialog-check">
              <input
                type="checkbox"
                name="staff"
                value={m.id}
                defaultChecked={assigning.service.assigned.includes(m.id)}
              />
              {m.name}
              {assigning.service.busy.includes(m.id) && <span className="tag tag-warn">{t('Busy')}</span>}
              {!assigning.service.busy.includes(m.id) && assigning.service.noClass.includes(m.id) && (
                <span className="tag tag-neutral">{t('No classes')}</span>
              )}
            </label>
          ))}
          <p className="text-muted" style={{ margin: 0, fontSize: 12 }}>
            {t('Availability is only a hint: it never decides who works a shift.')}
          </p>
        </Dialog>
      )}

      {editingDay && (
        <Dialog
          title={formatDay(editingDay.day.date, lang)}
          submitLabel="Save"
          onClose={() => setEditingDay(null)}
          onSubmit={async (d) => {
            const { day } = editingDay;
            if (d.get('closed')) {
              const placed = day.service?.assigned.length ?? 0;
              if (placed && !window.confirm(t('{n} people are placed on this day. Close it anyway? They are placed again if the day reopens.', { n: placed }))) return;
              setEditingDay(null);
              await actions.setServiceDay(day.key, { closed: true, time_label: null, needed: null });
              return;
            }
            const start = d.get('start');
            const end = d.get('end');
            if (end <= start) {
              setFormError(t('The shift must end after it starts.'));
              return;
            }
            const time = joinTime(start, end);
            const needed = Number(d.get('needed'));
            const usual = usualOf(day.weekday);
            setEditingDay(null);
            // Same as the usual hours: no exception to keep for this date.
            if (usual && joinTime(...splitTime(usual.time_label)) === time && usual.needed === needed) {
              if (day.exception) await actions.clearServiceDay(day.key);
              return;
            }
            await actions.setServiceDay(day.key, { closed: false, time_label: time, needed });
          }}
        >
          <p className="text-muted" style={{ margin: 0 }}>
            {t('Changes apply to this date only. The usual hours are set with “Usual hours”.')}
          </p>
          <label className="dialog-check">
            <input
              type="checkbox"
              name="closed"
              defaultChecked={editingDay.closed}
              onChange={(e) => setEditingDay({ ...editingDay, closed: e.target.checked })}
            />
            {t('Closed that day')}
          </label>
          {!editingDay.closed && (
            <>
              <div className="field-row">
                <div className="field">
                  <label htmlFor="day-start">{t('Starts')}</label>
                  <input id="day-start" name="start" type="time" className="input" defaultValue={editingDay.start} required />
                </div>
                <div className="field">
                  <label htmlFor="day-end">{t('Ends')}</label>
                  <input id="day-end" name="end" type="time" className="input" defaultValue={editingDay.end} required />
                </div>
              </div>
              <div className="field">
                <label htmlFor="day-needed">{t('People needed')}</label>
                <input
                  id="day-needed"
                  name="needed"
                  type="number"
                  min="1"
                  max="20"
                  className="input"
                  defaultValue={editingDay.needed}
                  required
                />
              </div>
            </>
          )}
          {formError && <div role="alert" style={{ color: 'var(--color-danger)', fontSize: 13 }}>{formError}</div>}
          {editingDay.day.exception && (
            <button
              type="button"
              className="btn btn-ghost self-start"
              onClick={() => {
                const { day } = editingDay;
                setEditingDay(null);
                actions.clearServiceDay(day.key);
              }}
            >
              {t('Back to the usual hours')}
            </button>
          )}
        </Dialog>
      )}

      {editingWeek && (
        <Dialog
          title={t('Usual hours')}
          submitLabel="Save"
          wide
          onClose={() => setEditingWeek(false)}
          onSubmit={async (d) => {
            const rows = [];
            for (let i = 0; i < 7; i++) {
              const weekday = i + 1;
              if (!d.get(`open-${weekday}`)) continue;
              const start = d.get(`start-${weekday}`);
              const end = d.get(`end-${weekday}`);
              if (!start || !end || end <= start) {
                setFormError(t('{day}: the shift must end after it starts.', { day: t(WEEKDAYS[i]) }));
                return;
              }
              rows.push({ weekday, time_label: joinTime(start, end), needed: Number(d.get(`needed-${weekday}`)) || 1 });
            }
            setEditingWeek(false);
            await actions.setOpeningHours(rows);
          }}
        >
          <p className="text-muted" style={{ margin: 0 }}>
            {t('One shift a day at most. These hours apply to every week; a single date can still be closed or changed from its card.')}
          </p>
          <div className="week-hours">
            {WEEKDAYS.map((name, i) => (
              <WeekdayRow key={name} weekday={i + 1} name={t(name)} usual={usualOf(i + 1)} t={t} />
            ))}
          </div>
          {formError && <div role="alert" style={{ color: 'var(--color-danger)', fontSize: 13 }}>{formError}</div>}
        </Dialog>
      )}
    </div>
  );
}

function DayCard({ day, me, isAdmin, nameOf, onAssign, onEdit, onToggle }) {
  const { t, lang } = useT();
  const s = day.service;
  const open = s.needed - s.assigned.length;
  const mine = s.assigned.includes(me.id);
  return (
    <div className="card elev-sm day-card">
      <div className="day-name">
        {formatDay(day.date, lang)}
        {day.isToday && <span className="tag tag-accent">{t('Today')}</span>}
        {day.exception && <span className="tag tag-neutral">{t('Special hours')}</span>}
      </div>
      <div className="shift">
        <div className="shift-head">
          <div className="shift-time">{s.time}</div>
          <span className={open > 0 ? 'tag tag-warn' : 'tag tag-accent-2'}>
            {open > 0 ? t('{n} open', { n: open }) : t('Full')}
          </span>
        </div>
        <div className="shift-staffed">{t('{a} of {b} staffed', { a: s.assigned.length, b: s.needed })}</div>
        {s.assigned.length > 0 && (
          <div className="shift-people">
            {s.assigned.map((id) => (
              <span key={id} className="shift-person">
                {nameOf.get(id) ?? '—'}
                {s.busy.includes(id) && (
                  <span className="tag tag-warn" title={t('Their calendar shows an event at this time')}>
                    {t('Busy')}
                  </span>
                )}
              </span>
            ))}
          </div>
        )}
        <div className="shift-actions">
          {isAdmin ? (
            <>
              <button className="btn btn-secondary" onClick={onAssign}>{t('Assign staff')}</button>
              <button className="btn btn-ghost" onClick={onEdit}>{t('Edit this day')}</button>
            </>
          ) : (
            <button className="btn btn-secondary" disabled={open <= 0 && !mine} onClick={() => onToggle(mine)}>
              {mine ? t('Leave shift') : t('Take shift')}
            </button>
          )}
        </div>
      </div>
      <div className="free-row">
        <div className="label-caps">{t('Free')}</div>
        {!day.hasCalendars ? (
          <span className="text-muted" style={{ fontSize: 13 }}>{t('No calendars connected yet')}</span>
        ) : day.free.length === 0 ? (
          <span className="text-muted" style={{ fontSize: 13 }}>{t('Nobody is free')}</span>
        ) : (
          day.free.map((person) => <span key={person} className="tag tag-accent-2 tag-lg">{person}</span>)
        )}
      </div>
      {day.hasCalendars && (
        <div className="hint">
          {day.noClass.length > 0 && <span>{t('No classes that day: {names}.', { names: day.noClass.join(', ') })} </span>}
          <span>{t('Availability is only a hint: it never decides who works a shift.')}</span>
        </div>
      )}
    </div>
  );
}

// One line of the usual-hours form: open that weekday?, hours, head count.
function WeekdayRow({ weekday, name, usual, t }) {
  const [open, setOpen] = useState(Boolean(usual));
  const [start, end] = splitTime(usual?.time_label);
  return (
    <div className="week-row">
      <label className="week-day">
        <input type="checkbox" name={`open-${weekday}`} checked={open} onChange={(e) => setOpen(e.target.checked)} />
        {name}
      </label>
      {open ? (
        <>
          <input aria-label={`${name} · ${t('Starts')}`} name={`start-${weekday}`} type="time" className="input" defaultValue={start} required />
          <input aria-label={`${name} · ${t('Ends')}`} name={`end-${weekday}`} type="time" className="input" defaultValue={end} required />
          <input
            aria-label={`${name} · ${t('People needed')}`}
            name={`needed-${weekday}`}
            type="number"
            min="1"
            max="20"
            className="input"
            defaultValue={usual?.needed ?? 2}
            required
          />
        </>
      ) : (
        <span className="text-muted week-closed">{t('Closed')}</span>
      )}
    </div>
  );
}
