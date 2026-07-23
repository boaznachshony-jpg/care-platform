import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, EmptyState, Skeleton, StatusBadge } from '@caredesk/ui';

type HealthState = { kind: 'loading' } | { kind: 'ok' } | { kind: 'error' };

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000';

/**
 * Milestone 0 demo page: proves RTL rendering, i18n, the design-token-based
 * UI primitives, and a real (mocked-backend) API call — synthetic content
 * only, no business feature here yet.
 */
export function DashboardPage() {
  const { t } = useTranslation();
  const [health, setHealth] = useState<HealthState>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE_URL}/health`)
      .then((response) => {
        if (!cancelled) {
          setHealth(response.ok ? { kind: 'ok' } : { kind: 'error' });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHealth({ kind: 'error' });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      {health.kind === 'loading' && (
        <Skeleton loadingLabel={t('shell.loading')} height="1.5rem" width="10rem" />
      )}
      {health.kind === 'ok' && <StatusBadge tone="success" label={t('health.ok')} />}
      {health.kind === 'error' && (
        <Alert variant="warning" title={t('health.unreachable')}>
          {API_BASE_URL}
        </Alert>
      )}

      <EmptyState title={t('shell.emptyDashboardTitle')} body={t('shell.emptyDashboardBody')} />
    </div>
  );
}
