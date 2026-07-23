import { Route, Routes } from 'react-router-dom';
import { AppShell } from './AppShell.js';
import { CasePage } from './pages/CasePage.js';
import { DashboardPage } from './pages/DashboardPage.js';
import { OpenCasePage } from './pages/OpenCasePage.js';

export function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/cases/new" element={<OpenCasePage />} />
        <Route path="/cases/:caseId" element={<CasePage />} />
      </Routes>
    </AppShell>
  );
}
