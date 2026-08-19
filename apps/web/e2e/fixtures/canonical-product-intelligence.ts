/* eslint-disable no-restricted-syntax -- canonical E2E fixture uses approved Hebrew product copy */
import type { Page, Route } from '@playwright/test';

interface CanonicalClose {
  id: string;
  payrollReference: string;
  month: string;
  paymentDate: string;
  paymentMethod: string;
  total: number;
  baseSalary: number;
  additions: number;
  deductions: number;
  closedAt: string;
}

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

/**
 * Installs the authenticated canonical API boundary used by browser-only E2E.
 * State lives in this server-side fixture closure, never in browser storage,
 * so reload and idempotent replay exercise the same semantics as PostgreSQL.
 */
export async function installCanonicalProductIntelligence(page: Page) {
  const closes = new Map<string, CanonicalClose>();
  const responsesByKey = new Map<string, CanonicalClose>();
  let closeMutations = 0;
  let lastCloseRequest:
    { url: string; key: string; input: Omit<CanonicalClose, 'id' | 'closedAt'> } | undefined;

  await page.route(/\/cases\/[^/]+\/timeline(?:\?.*)?$/, (route) =>
    json(route, [
      {
        id: '10000000-0000-4000-8000-000000000001',
        eventTypeKey: 'document.medical_insurance.renewal_due',
        summaryKey: 'חידוש ביטוח רפואי',
        occurredAt: '2026-08-16T06:00:00.000Z',
        actorDisplay: null,
        sensitivity: 'employment_sensitive',
        actionTarget: '/documents',
      },
      {
        id: '10000000-0000-4000-8000-000000000002',
        eventTypeKey: 'employment_license.renewal_due',
        summaryKey: 'חידוש רישיון ההעסקה',
        occurredAt: '2026-08-16T06:01:00.000Z',
        actorDisplay: null,
        sensitivity: 'employment_sensitive',
        actionTarget: '/tasks',
      },
      {
        id: '10000000-0000-4000-8000-000000000003',
        eventTypeKey: 'visa.renewal_due',
        summaryKey: 'חידוש הוויזה',
        occurredAt: '2026-08-16T06:02:00.000Z',
        actorDisplay: null,
        sensitivity: 'identity_sensitive',
        actionTarget: '/tasks',
      },
    ]),
  );

  await page.route(/\/cases\/[^/]+\/health(?:\?.*)?$/, (route) =>
    json(route, {
      score: 75,
      actionsRemaining: 1,
      disclaimer: 'employment_file_health_not_legal_certification',
      factors: [
        {
          id: 'medical-insurance',
          title: 'חידוש ביטוח רפואי',
          status: 'attention',
          points: 0,
          weight: 25,
          explanation: 'נדרש חידוש מתועד בתיק הקנוני',
          recommendedAction: 'פתיחת הפעולה',
          actionTarget: '/documents',
          provenance: { sourceType: 'document', sourceIds: ['document-insurance'] },
        },
      ],
    }),
  );

  // The settings page renders RegulationRulesAdmin, which loads the reviewed
  // regulation rules on mount. An empty list keeps the page free of load-error
  // alerts so assertions on role="alert" stay unambiguous.
  await page.route(/\/regulation-rules(?:\?.*)?$/, (route) => {
    if (route.request().method() === 'GET') return json(route, []);
    return json(route, { code: 'METHOD_NOT_ALLOWED' }, 405);
  });

  await page.route(/\/cases\/[^/]+\/payroll-month-closes(?:\?.*)?$/, async (route) => {
    if (route.request().method() === 'GET') return json(route, [...closes.values()]);
    if (route.request().method() !== 'POST')
      return json(route, { code: 'METHOD_NOT_ALLOWED' }, 405);
    const key = route.request().headers()['idempotency-key'];
    const input = route.request().postDataJSON() as Omit<CanonicalClose, 'id' | 'closedAt'>;
    if (key) lastCloseRequest = { url: route.request().url(), key, input };
    const replay = key ? responsesByKey.get(key) : undefined;
    if (replay) return json(route, { close: replay, replayed: true });
    closeMutations += 1;
    const close: CanonicalClose = {
      ...input,
      id: `20000000-0000-4000-8000-${String(closeMutations).padStart(12, '0')}`,
      closedAt: '2026-08-16T06:10:00.000Z',
    };
    closes.set(close.month, close);
    if (key) responsesByKey.set(key, close);
    return json(route, { close, replayed: false }, 201);
  });

  return {
    closeMutationCount: () => closeMutations,
    closedMonths: () => [...closes.values()],
    lastCloseRequest: () => lastCloseRequest,
  };
}
