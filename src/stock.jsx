// Entry of the public stock board (stock/index.html): no sign-in, nothing else of the app.
import React from 'react';
import { createRoot } from 'react-dom/client';
import './fonts.css';
import './tokens-and-components.css';
import './public-stock.css';
import PublicStock from './screens/PublicStock.jsx';
import { I18nProvider } from './i18n.jsx';

createRoot(document.getElementById('root')).render(
  <I18nProvider>
    <PublicStock />
  </I18nProvider>,
);
