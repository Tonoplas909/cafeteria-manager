import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useT } from '../i18n.jsx';

// "My shifts in my calendar": a personal subscription link that lists the member's next shifts.
function ShiftsFeed() {
  const { t, lang } = useT();
  const [url, setUrl] = useState(null);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    api.feedLink(lang).then((u) => live && setUrl(u)).catch((e) => live && setError(e.message));
    return () => { live = false; };
  }, [lang]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError(t('Copy failed. Select the address and copy it by hand.'));
    }
  };
  const reset = async () => {
    if (!window.confirm(t('Reset the link? The old one stops working and you will need to subscribe again.'))) return;
    try {
      setUrl(await api.rotateFeedLink(lang));
    } catch (e) {
      setError(e.message);
    }
  };
  // Google Calendar's "add by link" entry point; takes a webcal:// address.
  const googleUrl = url
    ? `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(url.replace(/^https:/, 'webcal:'))}`
    : '#';

  return (
    <div className="card elev-sm" style={{ padding: 'var(--space-6)', gap: 'var(--space-4)' }}>
      <div className="section-title">{t('My shifts in my calendar')}</div>
      <p style={{ margin: 0, fontSize: 15, maxWidth: '64ch', color: 'var(--color-neutral-700)' }}>
        {t('Subscribe once and the shifts you are placed on show up in your calendar. The link lists your next shifts only.')}
      </p>
      {url ? (
        <>
          <div className="field">
            <label htmlFor="feed-url">{t('Your personal calendar address')}</label>
            <input id="feed-url" className="input" value={url} readOnly onFocus={(e) => e.target.select()} />
          </div>
          <div className="shift-actions">
            <a className="btn btn-primary" href={googleUrl} target="_blank" rel="noopener noreferrer">
              {t('Add to Google Calendar')}
            </a>
            <button className="btn btn-secondary" onClick={copy}>{copied ? t('Copied') : t('Copy address')}</button>
            <button className="btn btn-ghost" onClick={reset}>{t('Reset link')}</button>
          </div>
        </>
      ) : (
        !error && <p className="text-muted" style={{ margin: 0 }}>{t('Loading…')}</p>
      )}
      {error && <div role="alert" style={{ color: 'var(--color-danger)', fontSize: 13 }}>{error}</div>}
      <p className="text-muted" style={{ margin: 0, fontSize: 13 }}>
        {t('Google refreshes subscribed calendars only every 12 to 24 hours, so a change can take that long to appear. Treat the address like a password.')}
      </p>
    </div>
  );
}

// Each member connects their own private iCal link; admins see everyone's in Admin → Calendars.
export default function MyCalendar({ mine, actions }) {
  const { t, fmtDate } = useT();
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  const connect = async (e) => {
    e.preventDefault();
    setBusy(true);
    setDone(null);
    const ok = await actions.connectCalendar(url.trim());
    setBusy(false);
    if (ok) {
      setUrl('');
      setDone(t('Calendar connected.'));
    }
  };

  return (
    <div className="screen-inner">
      <div>
        <div className="eyebrow">{t('Your availability')}</div>
        <h1 className="page-title">{t('My calendar')}</h1>
        <p className="page-lede">
          {t('Connect your calendar and the schedule shows when you are free, and flags a shift that clashes with an event.')}
        </p>
      </div>

      <ShiftsFeed />

      {mine && (
        <div className="card elev-sm row-card">
          <div className="row-main">
            <div className="row-name">{t('Calendar connected')}</div>
            <div className="row-sub">{t('Last synced {date}', { date: fmtDate(mine.lastSync) })}</div>
          </div>
          <span className="tag tag-accent-2">{t('Connected')}</span>
          <button className="btn btn-secondary" onClick={() => actions.syncNow()}>{t('Sync now')}</button>
          <button className="btn btn-ghost" onClick={() => actions.disconnectCalendar(mine.id)}>{t('Disconnect')}</button>
        </div>
      )}

      <div className="card elev-sm" style={{ padding: 'var(--space-6)', gap: 'var(--space-4)' }}>
        <div className="section-title">{mine ? t('Use a different calendar') : t('Connect a calendar')}</div>
        <ol className="steps">
          <li>{t('In Google Calendar, open Settings and pick your calendar under “Settings for my calendars”.')}</li>
          <li>{t('Scroll to “Integrate calendar” and copy the “Secret address in iCal format”.')}</li>
          <li>{t('Paste it below. We only read whether you are busy; event titles are never stored.')}</li>
        </ol>
        <form onSubmit={connect} className="stack gap-3">
          <div className="field">
            <label htmlFor="ical">{t('Secret iCal address')}</label>
            <input
              id="ical"
              className="input"
              type="url"
              placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              autoComplete="off"
              required
            />
          </div>
          <button className="btn btn-primary self-start" disabled={busy}>
            {busy ? t('Connecting…') : t('Connect')}
          </button>
          {done && <div role="status" className="text-muted" style={{ fontSize: 13 }}>{done}</div>}
        </form>
        <p className="text-muted" style={{ margin: 0, fontSize: 13 }}>
          {t('Treat the address like a password: anyone with it can read your calendar. You can reset it in Google Calendar at any time.')}
        </p>
      </div>
    </div>
  );
}
