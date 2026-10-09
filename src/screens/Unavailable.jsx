import Dialog from '../Dialog.jsx';
import { useT } from '../i18n.jsx';
import { formatDay, formatTime } from '../dates.js';

// For every shift that still needs people: who can't make it and why. Purely informational.
export default function Unavailable({ days, staff, onClose }) {
  const { t, lang } = useT();
  const nameOf = new Map(staff.map((m) => [m.id, m.name]));

  const toCover = days.flatMap((day) =>
    day.shifts
      .filter((shift) => shift.assigned.length < shift.needed)
      .map((shift) => {
        const rows = shift.status ?? [];
        const placed = new Set(shift.assigned);
        const named = (r) => ({ id: r.staff_id, name: nameOf.get(r.staff_id) ?? '—', placed: placed.has(r.staff_id) });
        return {
          day,
          shift,
          busy: rows.filter((r) => r.busy).map((r) => ({ ...named(r), row: r })),
          noClass: rows.filter((r) => !r.busy && !r.on_campus).map(named),
          // people whose calendar hasn't been read for this shift yet
          unknown: staff.filter((m) => !rows.some((r) => r.staff_id === m.id)).map((m) => ({ id: m.id, name: m.name })),
        };
      }),
  );

  return (
    <Dialog title={t('Unavailable people')} onClose={onClose} wide>
      {toCover.length === 0 ? (
        <p style={{ margin: 0 }}>{t('Every shift is covered: nothing to fill.')}</p>
      ) : (
        <>
          {toCover.map(({ day, shift, busy, noClass, unknown }) => (
            <section key={shift.id} className="unavail-shift">
              <div className="unavail-head">
                <strong>{formatDay(day.date, lang)}</strong>
                <span>{shift.time}</span>
                <span className="tag tag-accent">{t('{n} open', { n: shift.needed - shift.assigned.length })}</span>
              </div>

              {busy.length === 0 && noClass.length === 0 && (
                <p className="text-muted unavail-line">{t('Nobody is known to be unavailable.')}</p>
              )}

              {busy.length > 0 && (
                <ul className="unavail-list">
                  {busy.map((p) => (
                    <li key={p.id}>
                      <span className="unavail-name">{p.name}</span>
                      {p.placed && <span className="tag tag-neutral">{t('Already placed')}</span>}
                      <span className="text-muted">
                        {t('Busy {from}–{until} ({n} min of the shift)', {
                          from: formatTime(p.row.busy_from),
                          until: formatTime(p.row.busy_until),
                          n: p.row.overlap_minutes,
                        })}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {noClass.length > 0 && (
                <p className="unavail-line">
                  <strong>{t('No classes that day')}</strong> : {noClass.map((p) => p.name).join(', ')}
                </p>
              )}

              {unknown.length > 0 && (
                <p className="text-muted unavail-line">
                  {t('Calendar not connected')} : {unknown.map((p) => p.name).join(', ')}
                </p>
              )}
            </section>
          ))}
          <p className="text-muted" style={{ margin: 0, fontSize: 12 }}>
            {t('Availability is only a hint: it never decides who works a shift.')}
          </p>
        </>
      )}
    </Dialog>
  );
}
