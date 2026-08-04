import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AppShell } from './AppShell.js';
import { DashboardPage } from './pages/DashboardPage.js';
import { TasksPage } from './pages/TasksPage.js';
import { EmployeePage } from './pages/EmployeePage.js';
import { DocumentsPage } from './pages/DocumentsPage.js';
import { TimelinePage } from './pages/TimelinePage.js';
import { PayrollPage } from './pages/PayrollPage.js';
import { SettingsPage } from './pages/SettingsPage.js';
import { OnboardingPage } from './pages/OnboardingPage.js';
import { TrustMessagesPage } from './pages/TrustMessagesPage.js';
import { GlossaryPage } from './pages/GlossaryPage.js';
import { ClientsPage } from './pages/ClientsPage.js';
import { useMvpProfile } from './hooks/use-mvp-profile.js';
import { useClientPath } from './hooks/use-client-path.js';
import { readMvpClients } from './storage/mvp-storage.js';
import { getEnvironmentTranslationKey } from './environment.js';
import { AuthProvider } from './auth/auth-context.js';
import { AuthConfigurationRequiredPage, AuthLoadingPage, LoginPage } from './pages/LoginPage.js';

function ClientHome() {
  const [profile] = useMvpProfile();
  const path = useClientPath();
  return profile.onboardingCompleted ? (
    <DashboardPage />
  ) : (
    <Navigate to={path('/onboarding')} replace />
  );
}

function ClientApp({ children }: { children: ReactNode }) {
  const { clientId } = useParams();

  if (clientId && !readMvpClients().some((client) => client.id === clientId)) {
    return <Navigate to="/" replace />;
  }

  return <AppShell>{children}</AppShell>;
}

export function App() {
  const { t } = useTranslation();
  const environmentTranslationKey = getEnvironmentTranslationKey();

  return (
    <>
      {environmentTranslationKey ? (
        <div className="environment-banner">{t(environmentTranslationKey)}</div>
      ) : null}
      <AuthProvider
        login={<LoginPage />}
        configurationRequired={<AuthConfigurationRequiredPage />}
        loading={<AuthLoadingPage />}
      >
        <Routes>
          <Route path="/" element={<ClientsPage />} />
          <Route
            path="/clients/:clientId"
            element={
              <ClientApp>
                <ClientHome />
              </ClientApp>
            }
          />
          <Route
            path="/clients/:clientId/onboarding"
            element={
              <ClientApp>
                <OnboardingPage />
              </ClientApp>
            }
          />
          <Route
            path="/clients/:clientId/tasks"
            element={
              <ClientApp>
                <TasksPage />
              </ClientApp>
            }
          />
          <Route
            path="/clients/:clientId/employee"
            element={
              <ClientApp>
                <EmployeePage />
              </ClientApp>
            }
          />
          <Route
            path="/clients/:clientId/trust"
            element={
              <ClientApp>
                <TrustMessagesPage />
              </ClientApp>
            }
          />
          <Route
            path="/clients/:clientId/glossary"
            element={
              <ClientApp>
                <GlossaryPage />
              </ClientApp>
            }
          />
          <Route
            path="/clients/:clientId/documents"
            element={
              <ClientApp>
                <DocumentsPage />
              </ClientApp>
            }
          />
          <Route
            path="/clients/:clientId/timeline"
            element={
              <ClientApp>
                <TimelinePage />
              </ClientApp>
            }
          />
          <Route
            path="/clients/:clientId/payroll"
            element={
              <ClientApp>
                <PayrollPage />
              </ClientApp>
            }
          />
          <Route
            path="/clients/:clientId/settings"
            element={
              <ClientApp>
                <SettingsPage />
              </ClientApp>
            }
          />
          <Route
            path="/onboarding"
            element={
              <ClientApp>
                <OnboardingPage />
              </ClientApp>
            }
          />
          <Route
            path="/tasks"
            element={
              <ClientApp>
                <TasksPage />
              </ClientApp>
            }
          />
          <Route
            path="/employee"
            element={
              <ClientApp>
                <EmployeePage />
              </ClientApp>
            }
          />
          <Route
            path="/trust"
            element={
              <ClientApp>
                <TrustMessagesPage />
              </ClientApp>
            }
          />
          <Route
            path="/glossary"
            element={
              <ClientApp>
                <GlossaryPage />
              </ClientApp>
            }
          />
          <Route
            path="/documents"
            element={
              <ClientApp>
                <DocumentsPage />
              </ClientApp>
            }
          />
          <Route
            path="/timeline"
            element={
              <ClientApp>
                <TimelinePage />
              </ClientApp>
            }
          />
          <Route
            path="/payroll"
            element={
              <ClientApp>
                <PayrollPage />
              </ClientApp>
            }
          />
          <Route
            path="/settings"
            element={
              <ClientApp>
                <SettingsPage />
              </ClientApp>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </>
  );
}
