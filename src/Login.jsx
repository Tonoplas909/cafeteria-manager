import { useState } from 'react';
import { supabase } from './api.js';
import { useT, LangSwitch } from './i18n.jsx';

const redirectTo = () => window.location.origin + window.location.pathname;

function Shell({ title, children }) {
  return (
    <div className="login">
      <div className="card elev-md login-card">
        <div className="login-top">
          <div className="brand" style={{ padding: 0 }}>
            <img className="brand-logo" src="/brand/miage-logo.png" alt="" />
            <div className="brand-name">Campus Café</div>
          </div>
          <LangSwitch />
        </div>
        <h2 style={{ margin: 0 }}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

const Field = ({ id, label, ...props }) => (
  <div className="field">
    <label htmlFor={id}>{label}</label>
    <input id={id} className="input" {...props} />
  </div>
);

const ErrorText = ({ children }) =>
  children ? <div role="alert" style={{ color: 'var(--color-accent-700)', fontSize: 13 }}>{children}</div> : null;

// Email + password sign-in. Accounts are created by an admin (invitation link);
// forgotten passwords are reset through an emailed link.
export default function Login() {
  const { t } = useT();
  const [mode, setMode] = useState('signin'); // signin | forgot
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(null); // message shown after a reset request

  const switchTo = (m) => {
    setMode(m);
    setError(null);
    setSent(null);
  };

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const addr = email.trim();
    let res;
    if (mode === 'signin') {
      res = await supabase.auth.signInWithPassword({ email: addr, password });
    } else {
      res = await supabase.auth.resetPasswordForEmail(addr, { redirectTo: redirectTo() });
      if (!res.error) setSent(t('If {email} has an account, a reset link is on its way.', { email: addr }));
    }
    if (res.error) setError(res.error.message);
    setBusy(false);
  }

  const titles = { signin: t('Sign in'), forgot: t('Reset your password') };

  if (sent) {
    return (
      <Shell title={titles[mode]}>
        <p style={{ margin: 0 }}>{sent}</p>
        <button className="btn btn-secondary" onClick={() => switchTo('signin')}>{t('Back to sign in')}</button>
      </Shell>
    );
  }

  return (
    <Shell title={titles[mode]}>
      <form onSubmit={submit} className="stack gap-3">
        {mode === 'signin' && (
          <p className="text-muted" style={{ margin: 0 }}>
            {t("Accounts are created by an admin. Ask one if you don't have yours yet.")}
          </p>
        )}
        <Field
          id="email"
          label={t('Email')}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          autoFocus
          required
        />
        {mode !== 'forgot' && (
          <Field
            id="password"
            label={t('Password')}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        )}
        <ErrorText>{error}</ErrorText>
        <button className="btn btn-primary" disabled={busy}>
          {busy ? t('Please wait…') : { signin: t('Sign in'), forgot: t('Email me a reset link') }[mode]}
        </button>
      </form>

      <div className="login-links">
        {mode === 'signin' ? (
          <button className="btn btn-ghost" onClick={() => switchTo('forgot')}>{t('Forgot password?')}</button>
        ) : (
          <button className="btn btn-ghost" onClick={() => switchTo('signin')}>{t('Back to sign in')}</button>
        )}
      </div>
    </Shell>
  );
}

// Shown after following an invitation or password-reset link.
export function SetPassword({ onDone }) {
  const { t } = useT();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) setError(error.message);
    else onDone();
  }

  return (
    <Shell title={t('Choose your password')}>
      <form onSubmit={submit} className="stack gap-3">
        <Field
          id="new-password"
          label={t('New password')}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          minLength={8}
          autoFocus
          required
        />
        <ErrorText>{error}</ErrorText>
        <button className="btn btn-primary" disabled={busy}>{busy ? t('Saving…') : t('Save password')}</button>
      </form>
    </Shell>
  );
}
