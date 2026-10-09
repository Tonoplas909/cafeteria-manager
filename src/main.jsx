import React from 'react';
import { createRoot } from 'react-dom/client';
import './fonts.css';
import './tokens-and-components.css';
import './layout.css';
import './responsive.css';
import App from './App.jsx';
import { I18nProvider } from './i18n.jsx';

createRoot(document.getElementById('root')).render(
  <I18nProvider>
    <App />
  </I18nProvider>,
);
