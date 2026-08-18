import '@caredesk/design-tokens/src/tokens.css';
import './global.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import { initI18n } from '@caredesk/i18n';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App.js';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found.');
}

createRoot(rootElement).render(
  <StrictMode>
    <I18nextProvider i18n={initI18n()}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </I18nextProvider>
  </StrictMode>,
);
