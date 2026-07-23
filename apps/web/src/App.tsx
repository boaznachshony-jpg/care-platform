import { Route, Routes } from 'react-router-dom';
import { AppShell } from './AppShell.js';
import { DashboardPage } from './pages/DashboardPage.js';

export function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
      </Routes>
    </AppShell>
  );
}
