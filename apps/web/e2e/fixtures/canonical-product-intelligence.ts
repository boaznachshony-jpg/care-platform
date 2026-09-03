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
export interface CanonicalProductIntelligenceOptions {
  /**
   * Whether the canonical case list already contains a case for the legacy
   * client under test.
   *
   * `'seeded'` (the default) is the ordinary state of a family that finished
   * onboarding, and it is what every screen assertion needs — a payroll close,
   * a timeline and a health score all hang off that case id.
   *
   * `'none'` is the state of a client whose case was never opened, which is
   * the only state in which the case-creation form is the correct screen to
   * show: a client that already has a case is sent to it instead of being
   * offered a second one. A test about that form has to ask for this
   * explicitly, or it is asserting on a screen the product would never show.
   */
  cases?: 'seeded' | 'none';
}

export async function installCanonicalProductIntelligence(
  page: Page,
  { cases = 'seeded' }: CanonicalProductIntelligenceOptions = {},
) {
  const closes = new Map<string, CanonicalClose>();
  const responsesByKey = new Map<string, CanonicalClose>();
  let closeMutations = 0;
  let lastCloseRequest:
    { url: string; key: string; input: Omit<CanonicalClose, 'id' | 'closedAt'> } | undefined;

  // The canonical case list. Every screen that talks to a `/cases/:caseId`
  // route now resolves the case id from the legacy client id first (payroll
  // closes, the timeline, the health score) instead of passing the client id
  // straight through, which is what made those requests 404 in production.
  // Without this stub that lookup fails here, and the screens correctly show
  // "could not reach the server" — so the fixture has to answer it.
  //
  // The legacy client id is read out of the page URL rather than passed in:
  // `enterSeededClient` only learns the id *after* the routes are installed,
  // and every screen under test is reached from `/clients/:clientId/...`.
  // Unscoped screens (`/documents`, `/tasks`) use the same sentinel the app
  // does, so a single case still matches there.
  const legacyClientIdOf = (frameUrl: string): string =>
    /\/clients\/([^/?#]+)/.exec(frameUrl)?.[1] ?? 'legacy:unscoped';

  await page.route(/\/cases(?:\?.*)?$/, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    if (cases === 'none') return json(route, []);
    return json(route, [
      {
        id: '30000000-0000-4000-8000-000000000001',
        status: 'active',
        startDate: '2026-01-15',
        endDate: null,
        legacyClientId: legacyClientIdOf(route.request().frame().url()),
        careRecipient: {
          id: '30000000-0000-4000-8000-0000000000a1',
          fullName: 'מטופל בדיקה',
          careLevel: null,
          city: null,
        },
        employer: {
          id: '30000000-0000-4000-8000-0000000000b1',
          fullName: 'מעסיק בדיקה',
          relationshipToRecipient: 'מעסיק',
          city: null,
        },
        caregiver: {
          id: '30000000-0000-4000-8000-0000000000c1',
          legalName: 'Dilnoza',
          preferredName: null,
          nationality: 'אוזבקיסטן',
          primaryLanguage: 'אוזבקית',
        },
      },
    ]);
  });

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
