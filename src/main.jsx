import React from 'react';
import { createRoot } from 'react-dom/client';
import './fonts.css';
import './tokens-and-components.css';
import './layout.css';
import './responsive.css';
import App from './App.jsx';
import { I18nProvider } from './i18n.jsx';

// Service worker: lets the app be installed and opened offline (production only).
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

createRoot(document.getElementById('root')).render(
  <I18nProvider>
    <App />
  </I18nProvider>,
);
