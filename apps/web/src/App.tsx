import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { useEffect, type ReactNode } from 'react';
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
import { MedicationsPage } from './pages/MedicationsPage.js';
import { TrustMessagesPage } from './pages/TrustMessagesPage.js';
import { GlossaryPage } from './pages/GlossaryPage.js';
import { ClientsPage } from './pages/ClientsPage.js';
import { useMvpProfile } from './hooks/use-mvp-profile.js';
import { useClientPath } from './hooks/use-client-path.js';
import { readMvpClients } from './storage/mvp-storage.js';
import { getEnvironmentTranslationKey } from './environment.js';
import { AuthProvider } from './auth/auth-context.js';
import {
  AuthConfigurationRequiredPage,
  AuthLoadingPage,
  LoginPage,
  PasswordRecoveryPage,
  StorageUnavailablePage,
} from './pages/LoginPage.js';
import {
  DirectEmploymentGuidePage,
  PublicContactPage,
  PublicLandingPage,
} from './pages/PublicLandingPage.js';
import { FamilyAccessPage } from './pages/FamilyAccessPage.js';
import { BillingPage } from './pages/BillingPage.js';
import {
  PublicPrivacyPage,
  PublicSubscriptionTermsPage,
  PublicTermsPage,
} from './pages/PublicLandingPage.js';
import { ContactPage } from './pages/ContactPage.js';
import { CasePage } from './pages/CasePage.js';
import { WorkerPortalPage } from './pages/WorkerPortalPage.js';
import { EmergencyBinderPage } from './pages/EmergencyBinderPage.js';
import { OpenIssuesPage } from './pages/OpenIssuesPage.js';
import { OpenCasePage } from './pages/OpenCasePage.js';
import { DemoOverviewPage } from './pages/DemoOverviewPage.js';
import { AccountFrozenGate } from './components/AccountFrozenGate.js';

const authenticatedEntrypoints = new Set([
  '/app',
  '/onboarding',
  '/tasks',
  '/employee',
  '/trust',
  '/glossary',
  '/documents',
  '/timeline',
  '/payroll',
  '/settings',
  '/family',
  '/billing',
  '/contact',
  '/worker',
  '/binder',
]);

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
    return <Navigate to="/app" replace />;
  }

  return <AppShell>{children}</AppShell>;
}

function AuthenticatedApp() {
  const { t } = useTranslation();

  useEffect(() => {
    const previousTitle = document.title;
    const robots = document.head.querySelector<HTMLMetaElement>('meta[name="robots"]');
    const previousRobots = robots?.content;
    document.title = t('auth.privatePageTitle');
    if (robots) robots.content = 'noindex, nofollow, noarchive';

    return () => {
      document.title = previousTitle;
      if (robots && previousRobots) robots.content = previousRobots;
    };
  }, [t]);

  return (
    <AuthProvider
      login={<LoginPage />}
      configurationRequired={<AuthConfigurationRequiredPage />}
      storageUnavailable={<StorageUnavailablePage />}
      passwordRecovery={<PasswordRecoveryPage />}
      loading={<AuthLoadingPage />}
      /* WEB-05: a token refresh or a resumed mobile tab briefly reports an
         empty session. The app stays mounted behind this notice instead of
         being torn down and rebuilt from scratch. */
      sessionRecovering={<span>{t('errors.sessionRecovering')}</span>}
    >
      <AccountFrozenGate>
        <Routes>
          <Route path="/worker" element={<WorkerPortalPage />} />
          <Route
            path="/binder"
            element={
              <ClientApp>
                <EmergencyBinderPage />
              </ClientApp>
            }
          />
          <Route path="/app" element={<ClientsPage />} />
          <Route path="/family" element={<FamilyAccessPage />} />
          <Route path="/billing" element={<BillingPage />} />
          {/* Declared before /cases/:caseId so "new" is a route, not a case id. */}
          <Route path="/cases/new" element={<OpenCasePage />} />
          <Route path="/cases/:caseId" element={<CasePage />} />
          <Route
            path="/clients/:clientId"
            element={
              <ClientApp>
                <ClientHome />
              </ClientApp>
            }
          />
          <Route
            path="/clients/:clientId/overview"
            element={
              <ClientApp>
                <OpenIssuesPage />
              </ClientApp>
            }
          />
          {/* The client-scoped entry point to case creation. OpenCasePage reads
              the active client from the path, so the case it opens is linked to
              this client rather than to whichever workspace happened to be
              loaded. */}
          <Route
            path="/clients/:clientId/cases/new"
            element={
              <ClientApp>
                <OpenCasePage />
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
            path="/clients/:clientId/medications"
            element={
              <ClientApp>
                <MedicationsPage />
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
            path="/clients/:clientId/binder"
            element={
              <ClientApp>
                <EmergencyBinderPage />
              </ClientApp>
            }
          />
          <Route
            path="/clients/:clientId/contact"
            element={
              <ClientApp>
                <ContactPage />
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
            path="/medications"
            element={
              <ClientApp>
                <MedicationsPage />
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
          <Route
            path="/contact"
            element={
              <ClientApp>
                <ContactPage />
              </ClientApp>
            }
          />
          <Route path="*" element={<Navigate to="/app" replace />} />
        </Routes>
      </AccountFrozenGate>
    </AuthProvider>
  );
}

function ApplicationEntry() {
  const { pathname } = useLocation();
  const isPrivatePath =
    pathname.startsWith('/clients/') ||
    pathname.startsWith('/cases/') ||
    authenticatedEntrypoints.has(pathname);
  return isPrivatePath ? <AuthenticatedApp /> : <Navigate to="/" replace />;
}

export function App() {
  const { t } = useTranslation();
  const environmentTranslationKey = getEnvironmentTranslationKey();

  return (
    <>
      {environmentTranslationKey ? (
        <div className="environment-banner">{t(environmentTranslationKey)}</div>
      ) : null}
      <Routes>
        <Route path="/" element={<PublicLandingPage />} />
        <Route path="/contact-us" element={<PublicContactPage />} />
        <Route path="/guide/direct-caregiver-employment" element={<DirectEmploymentGuidePage />} />
        <Route path="/terms" element={<PublicTermsPage />} />
        <Route path="/privacy" element={<PublicPrivacyPage />} />
        {/* Kept, not redirected: `product_subscription.terms_version` already
            records '2026-08-04' against this URL for existing subscriptions.
            See PublicSubscriptionTermsPage for the full reasoning. */}
        <Route path="/terms/subscription" element={<PublicSubscriptionTermsPage />} />
        {/* /cases/new is NOT listed here. It used to be, redirecting to the
            marketing page, and that redirect was the whole of code review
            WEB-11: OpenCasePage was the only component that could create an
            EmploymentCase and no route reached it, so the canonical module was
            unreachable and every canonical screen was a dead end. It is now an
            authenticated route below, and falls through to ApplicationEntry,
            which already treats any /cases/ path as private. */}
        <Route path="/cases/not-a-public-route" element={<Navigate to="/" replace />} />
        <Route path="/demo/overview" element={<DemoOverviewPage />} />
        <Route path="*" element={<ApplicationEntry />} />
      </Routes>
    </>
  );
}
