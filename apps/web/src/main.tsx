import '@caredesk/design-tokens/src/tokens.css';
import './global.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import { initI18n } from '@caredesk/i18n';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App.js';
import { AppErrorBoundary } from './components/ErrorBoundary.js';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found.');
}

createRoot(rootElement).render(
  <StrictMode>
    <I18nextProvider i18n={initI18n()}>
      {/* WEB-06: the last line of defence. Inside the i18n provider so the
          recovery screen is in the interface language, and outside the router
          so it still renders if the router itself is what threw. */}
      <AppErrorBoundary>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AppErrorBoundary>
    </I18nextProvider>
  </StrictMode>,
);
