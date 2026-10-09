import { useState } from 'react';
import Dialog from '../Dialog.jsx';
import { PlusIcon } from '../icons.jsx';
import { WEEKDAYS } from '../api.js';
import { useT } from '../i18n.jsx';
import { formatDay } from '../dates.js';
import Unavailable from './Unavailable.jsx';

// "12:15–13:45" -> ["12:15", "13:45"]
const splitTime = (label) => {
  const m = /(\d{1,2}):(\d{2})\s*[–-]\s*(\d{1,2}):(\d{2})/.exec(label || '');
  return m ? [`${m[1].padStart(2, '0')}:${m[2]}`, `${m[3].padStart(2, '0')}:${m[4]}`] : ['12:15', '13:30'];
};

export default function Schedule({ days, staff, me, isAdmin, actions }) {
  const { t, lang } = useT();
  const [assigning, setAssigning] = useState(null); // { shift, date }
  const [editing, setEditing] = useState(null); // { id?, day, start, end, needed }
  const [formError, setFormError] = useState(null);
  const [showUnavailable, setShowUnavailable] = useState(false);

  const nameOf = new Map(staff.map((m) => [m.id, m.name]));

  const openNew = () => {
    setFormError(null);
    setEditing({ day: days[0]?.name ?? 'Monday', start: '12:15', end: '13:30', needed: 2 });
  };
  const openEdit = (shift, dayName) => {
    setFormError(null);
    const [start, end] = splitTime(shift.time);
    setEditing({ id: shift.id, day: dayName, start, end, needed: shift.needed });
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
          {days.length > 0 && (
            <button className="btn btn-secondary" onClick={() => setShowUnavailable(true)}>
              {t('Who is unavailable')}
            </button>
          )}
          {isAdmin && (
            <button className="btn btn-primary" onClick={openNew}>
              <PlusIcon /> {t('Add shift')}
            </button>
          )}
        </div>
      </div>

      {days.length === 0 && (
        <div className="card elev-sm" style={{ padding: 'var(--space-6)' }}>
          <p className="text-muted" style={{ margin: 0 }}>
            {isAdmin ? t('No shifts yet. Add the first one.') : t('No shifts have been planned yet.')}
          </p>
        </div>
      )}

      <div className="stack gap-6">
        {days.map((day) => (
          <div key={day.key} className="card elev-sm day-card">
            <div className="day-name">
              {formatDay(day.date, lang)}
              {day.isToday && <span className="tag tag-accent">{t('Today')}</span>}
            </div>
            <div className="shift-grid">
              {day.shifts.map((shift) => {
                const open = shift.needed - shift.assigned.length;
                const mine = shift.assigned.includes(me.id);
                return (
                  <div key={shift.id} className="shift">
                    <div className="shift-head">
                      <div className="shift-time">{shift.time}</div>
                      <span className={open > 0 ? 'tag tag-accent' : 'tag tag-accent-2'}>
                        {open > 0 ? t('{n} open', { n: open }) : t('Full')}
                      </span>
                    </div>
                    <div className="shift-staffed">
                      {t('{a} of {b} staffed', { a: shift.assigned.length, b: shift.needed })}
                    </div>
                    {shift.assigned.length > 0 && (
                      <div className="shift-people">
                        {shift.assigned.map((id) => (
                          <span key={id} className="shift-person">
                            {nameOf.get(id) ?? '—'}
                            {shift.busy.includes(id) && (
                              <span className="tag tag-accent" title={t('Their calendar shows an event at this time')}>
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
                          <button
                            className="btn btn-secondary"
                            onClick={() => setAssigning({ shift, date: day.date })}
                          >
                            {t('Assign staff')}
                          </button>
                          <button className="btn btn-ghost" onClick={() => openEdit(shift, day.name)}>
                            {t('Edit')}
                          </button>
                        </>
                      ) : (
                        <button
                          className="btn btn-secondary"
                          disabled={open <= 0 && !mine}
                          onClick={() => actions.toggleSelf(shift.id, shift.dateKey, mine)}
                        >
                          {mine ? t('Leave shift') : t('Take shift')}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="free-row">
              <div className="label-caps">{t('Free')}</div>
              {!day.hasCalendars ? (
                <span className="text-muted" style={{ fontSize: 13 }}>{t('No calendars connected yet')}</span>
              ) : day.free.length === 0 ? (
                <span className="text-muted" style={{ fontSize: 13 }}>{t('Nobody is free')}</span>
              ) : (
                day.free.map((person) => (
                  <span key={person} className="tag tag-accent-2 tag-lg">{person}</span>
                ))
              )}
            </div>
            {day.hasCalendars && (
              <div className="hint">
                {day.noClass.length > 0 && (
                  <span>{t('No classes that day: {names}.', { names: day.noClass.join(', ') })} </span>
                )}
                <span>{t('Availability is only a hint: it never decides who works a shift.')}</span>
              </div>
            )}
          </div>
        ))}
      </div>

      {showUnavailable && <Unavailable days={days} staff={staff} onClose={() => setShowUnavailable(false)} />}

      {assigning && (
        <Dialog
          title={`${formatDay(assigning.date, lang)} · ${assigning.shift.time}`}
          submitLabel="Save"
          onClose={() => setAssigning(null)}
          onSubmit={(data) => {
            actions.assignShift(assigning.shift.id, assigning.shift.dateKey, data.getAll('staff').map(Number));
            setAssigning(null);
          }}
        >
          <p className="text-muted" style={{ margin: 0 }}>
            {t('Choose up to {n} people for this shift.', { n: assigning.shift.needed })}
          </p>
          {staff.map((m) => (
            <label key={m.id} className="dialog-check">
              <input
                type="checkbox"
                name="staff"
                value={m.id}
                defaultChecked={assigning.shift.assigned.includes(m.id)}
              />
              {m.name}
              {assigning.shift.busy.includes(m.id) && <span className="tag tag-accent">{t('Busy')}</span>}
              {!assigning.shift.busy.includes(m.id) && assigning.shift.noClass.includes(m.id) && (
                <span className="tag tag-neutral">{t('No classes')}</span>
              )}
            </label>
          ))}
          <p className="text-muted" style={{ margin: 0, fontSize: 12 }}>
            {t('Availability is only a hint: it never decides who works a shift.')}
          </p>
        </Dialog>
      )}

      {editing && (
        <Dialog
          title={editing.id ? t('Edit shift') : t('Add shift')}
          submitLabel="Save"
          onClose={() => setEditing(null)}
          onSubmit={async (d) => {
            const start = d.get('start');
            const end = d.get('end');
            if (end <= start) {
              setFormError(t('The shift must end after it starts.'));
              return;
            }
            const shift = { day: d.get('day'), time_label: `${start}–${end}`, needed: Number(d.get('needed')) };
            setEditing(null);
            await (editing.id ? actions.updateShift(editing.id, shift) : actions.addShift(shift));
          }}
        >
          <div className="field">
            <label htmlFor="sh-day">{t('Day')}</label>
            <select id="sh-day" name="day" className="input" defaultValue={editing.day}>
              {WEEKDAYS.map((d) => (
                <option key={d} value={d}>{t(d)}</option>
              ))}
            </select>
          </div>
          <div className="field-row">
            <div className="field">
              <label htmlFor="sh-start">{t('Starts')}</label>
              <input id="sh-start" name="start" type="time" className="input" defaultValue={editing.start} required />
            </div>
            <div className="field">
              <label htmlFor="sh-end">{t('Ends')}</label>
              <input id="sh-end" name="end" type="time" className="input" defaultValue={editing.end} required />
            </div>
          </div>
          <div className="field">
            <label htmlFor="sh-needed">{t('People needed')}</label>
            <input
              id="sh-needed"
              name="needed"
              type="number"
              min="1"
              max="20"
              className="input"
              defaultValue={editing.needed}
              required
            />
          </div>
          {formError && <div role="alert" style={{ color: 'var(--color-accent-700)', fontSize: 13 }}>{formError}</div>}
          {editing.id && (
            <button
              type="button"
              className="btn btn-ghost self-start"
              onClick={() => {
                if (window.confirm(t('Delete this shift?'))) {
                  const id = editing.id;
                  setEditing(null);
                  actions.deleteShift(id);
                }
              }}
            >
              {t('Delete shift')}
            </button>
          )}
        </Dialog>
      )}
    </div>
  );
}
