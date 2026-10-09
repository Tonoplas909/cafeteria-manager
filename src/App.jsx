import { useCallback, useEffect, useState } from 'react';
import { supabase, loadAll, api, auth } from './api.js';
import Login, { SetPassword } from './Login.jsx';
import Dialog from './Dialog.jsx';
import { useT, LangSwitch } from './i18n.jsx';
import { CoffeeIcon, CalendarIcon, CalendarCheckIcon, PackageIcon, SlidersIcon } from './icons.jsx';
import Schedule from './screens/Schedule.jsx';
import Inventory from './screens/Inventory.jsx';
import MyCalendar from './screens/MyCalendar.jsx';
import Admin from './screens/Admin.jsx';

const NAV = [
  ['schedule', 'Schedule', CalendarIcon, false],
  ['inventory', 'Inventory', PackageIcon, false],
  ['calendar', 'My calendar', CalendarCheckIcon, false],
  ['admin', 'Admin', SlidersIcon, true], // admin only
];

const EMPTY = { staff: [], inventory: [], calendars: [], days: [] };

export default function App() {
  // undefined = still checking, null = signed out
  const [session, setSession] = useState(undefined);
  // Arrived via an invitation link: the person must choose a password first.
  const [recovering, setRecovering] = useState(/type=invite/.test(window.__authHash || ''));

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') setRecovering(true);
      setSession(s);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  if (session === undefined) return null;
  if (!session) return <Login />;
  if (recovering) return <SetPassword onDone={() => setRecovering(false)} />;
  return <Signed session={session} />;
}

function Signed({ session }) {
  const { t } = useT();
  const [screen, setScreen] = useState('schedule');
  const [data, setData] = useState(EMPTY);
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);
  const [pwDialog, setPwDialog] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setData(await loadAll());
      setStatus('ready');
      setError(null);
    } catch (e) {
      setError(e.message || String(e));
      setStatus((s) => (s === 'loading' ? 'error' : s));
    }
  }, []);

  // Load, then refresh calendars in the background if they are stale.
  useEffect(() => {
    refresh().then(() =>
      api.syncCalendars(false).then(refresh).catch(() => {}),
    );
  }, [refresh]);

  // Run a write, then reload everything so the screens match the database.
  // Resolves to true on success so callers can show a confirmation.
  const run = (fn) => async (...args) => {
    try {
      await fn(...args);
    } catch (e) {
      setError(e.message || String(e));
      return false;
    }
    await refresh();
    return true;
  };

  const email = session.user.email?.toLowerCase();
  const me = data.staff.find((m) => m.email.toLowerCase() === email);
  const isAdmin = me?.role === 'admin';
  const myCalendar = data.calendars.find((c) => c.staffId === me?.id);

  const actions = {
    // staff
    addStaff: run(api.createStaff),
    sendLink: run(api.sendLink),
    removeStaff: run(api.deleteStaff),
    toggleRole: run((id) => api.toggleRole(id, data.staff.find((m) => m.id === id).role === 'admin' ? 'staff' : 'admin')),
    // products
    addProduct: run((p) => api.addProduct({ name: p.name, cost: p.cost, price: p.price })),
    removeProduct: run(api.removeProduct),
    adjustStock: run(api.adjustStock),
    importProducts: run(api.importProducts),
    // shifts
    addShift: run(api.addShift),
    updateShift: run(api.updateShift),
    deleteShift: run(api.deleteShift),
    assignShift: run(api.assignShift),
    toggleSelf: run((shiftId, joined) => (joined ? api.leaveShift(shiftId, me.id) : api.joinShift(shiftId, me.id))),
    // calendars
    connectCalendar: run(api.connectCalendar),
    disconnectCalendar: run(api.disconnectCalendar),
    syncNow: run(() => api.syncCalendars(true)),
  };

  // Signed in, but the email isn't on the staff list (RLS returns no rows).
  if (status === 'ready' && !me) {
    return (
      <div className="login">
        <div className="card elev-md login-card">
          <h2 style={{ margin: 0 }}>{t('No access yet')}</h2>
          <p style={{ margin: 0 }}>
            {t("{email} isn't on the staff list. Ask an admin to add this address, then sign in again.", {
              email: session.user.email,
            })}
          </p>
          <button className="btn btn-secondary" onClick={() => auth.signOut()}>{t('Sign out')}</button>
        </div>
      </div>
    );
  }

  const visible = (id) => id !== 'admin' || isAdmin;

  return (
    <div className="app">
      <nav className="sidebar" aria-label="Main">
        <div className="brand">
          <div className="brand-mark"><CoffeeIcon /></div>
          <div className="brand-name">Campus Café</div>
        </div>
        <div className="side-nav">
          {NAV.filter(([id]) => visible(id)).map(([id, label, Icon]) => (
            <button
              key={id}
              className="nav-item"
              aria-current={screen === id ? 'page' : undefined}
              onClick={() => setScreen(id)}
            >
              <Icon /> {t(label)}
            </button>
          ))}
        </div>
        <div className="sidebar-foot">
          <LangSwitch />
          <div className="who">{me?.name ?? session.user.email}</div>
          <button className="btn btn-ghost foot-link" onClick={() => setPwDialog(true)}>{t('Change password')}</button>
          <button className="btn btn-secondary" onClick={() => auth.signOut()}>{t('Sign out')}</button>
        </div>
      </nav>

      <main className="main">
        <div className="screen">
          {error && (
            <div className="card elev-sm notice" role="alert">
              <div>
                <strong>{t('Something went wrong.')}</strong> <span className="text-muted">{error}</span>
              </div>
              <button className="btn btn-secondary" onClick={() => { setError(null); refresh(); }}>{t('Retry')}</button>
            </div>
          )}
          {info && (
            <div className="card elev-sm notice" role="status">
              <div>{info}</div>
              <button className="btn btn-secondary" onClick={() => setInfo(null)}>{t('Dismiss')}</button>
            </div>
          )}
          {status === 'loading' && <p className="text-muted">{t('Loading…')}</p>}
          {status === 'ready' && screen === 'schedule' && (
            <Schedule days={data.days} staff={data.staff} me={me} isAdmin={isAdmin} actions={actions} />
          )}
          {status === 'ready' && screen === 'inventory' && (
            <Inventory inventory={data.inventory} adjustStock={actions.adjustStock} importProducts={actions.importProducts} canEdit={isAdmin} />
          )}
          {status === 'ready' && screen === 'calendar' && <MyCalendar mine={myCalendar} actions={actions} />}
          {status === 'ready' && screen === 'admin' && isAdmin && (
            <Admin staff={data.staff} inventory={data.inventory} calendars={data.calendars} actions={actions} me={me} />
          )}
        </div>
      </main>

      {pwDialog && (
        <Dialog
          title={t('Change password')}
          submitLabel="Save password"
          onClose={() => setPwDialog(false)}
          onSubmit={async (d) => {
            setPwDialog(false);
            try {
              await api.changePassword(d.get('password'));
              setInfo(t('Your password has been changed.'));
            } catch (e) {
              setError(e.message || String(e));
            }
          }}
        >
          <div className="field">
            <label htmlFor="new-pw">{t('New password')}</label>
            <input
              id="new-pw"
              name="password"
              type="password"
              className="input"
              minLength={8}
              autoComplete="new-password"
              autoFocus
              required
            />
          </div>
          <p className="text-muted" style={{ margin: 0, fontSize: 13 }}>{t('At least 8 characters.')}</p>
        </Dialog>
      )}
    </div>
  );
}
