import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './AppShell.js';
import { DashboardPage } from './pages/DashboardPage.js';
import { TasksPage } from './pages/TasksPage.js';
import { EmployeePage } from './pages/EmployeePage.js';
import { DocumentsPage } from './pages/DocumentsPage.js';
import { TimelinePage } from './pages/TimelinePage.js';
import { PayrollPage } from './pages/PayrollPage.js';
import { SettingsPage } from './pages/SettingsPage.js';
import { OpenCasePage } from './pages/OpenCasePage.js';
import { CasePage } from './pages/CasePage.js';

export function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/tasks" element={<TasksPage />} />
        <Route path="/employee" element={<EmployeePage />} />
        <Route path="/documents" element={<DocumentsPage />} />
        <Route path="/timeline" element={<TimelinePage />} />
        <Route path="/payroll" element={<PayrollPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/cases/new" element={<OpenCasePage />} />
        <Route path="/cases/:caseId" element={<CasePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}
