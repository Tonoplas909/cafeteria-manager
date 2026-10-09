import { useEffect, useState } from 'react';
import Dialog from './Dialog.jsx';
import { useT } from './i18n.jsx';

// Chrome/Edge/Android fire `beforeinstallprompt` once, early: keep the event so the button can use it later.
let deferredPrompt = null;
const listeners = new Set();
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  listeners.forEach((fn) => fn());
});
window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  listeners.forEach((fn) => fn());
});

const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
// iPhone / iPad (iPadOS reports itself as a Mac with a touch screen)
const isIos = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// "Install the app" button. Android and desktop Chrome get the native prompt; iPhones have no
// such API, so we explain Share → "Add to Home Screen". Hidden once the app is installed.
export default function InstallApp() {
  const { t } = useT();
  const [, refresh] = useState(0);
  const [help, setHelp] = useState(false);

  useEffect(() => {
    const fn = () => refresh((n) => n + 1);
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, []);

  if (isStandalone()) return null;

  if (deferredPrompt) {
    return (
      <button
        className="btn btn-ghost foot-link"
        onClick={async () => {
          const prompt = deferredPrompt;
          deferredPrompt = null;
          prompt.prompt();
          await prompt.userChoice;
          refresh((n) => n + 1);
        }}
      >
        {t('Install the app')}
      </button>
    );
  }

  if (isIos()) {
    return (
      <>
        <button className="btn btn-ghost foot-link" onClick={() => setHelp(true)}>{t('Install the app')}</button>
        {help && (
          <Dialog title={t('Add to your home screen')} onClose={() => setHelp(false)}>
            <ol className="steps">
              <li>{t('Tap the Share button in the browser toolbar (the square with an arrow).')}</li>
              <li>{t('Scroll down and tap “Add to Home Screen”.')}</li>
              <li>{t('Tap “Add”. The app then opens full screen, like any other.')}</li>
            </ol>
          </Dialog>
        )}
      </>
    );
  }

  return null;
}
