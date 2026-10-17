/* eslint-disable no-restricted-syntax -- canonical E2E fixture uses approved Hebrew product copy */
import type { Page, Route } from '@playwright/test';
import { z } from 'zod';
import {
  calculateMonthlyPayroll,
  deriveApprovedPayrollComponents,
  derivePayrollSettlement,
  payrollTotalMatches,
  PayrollPolicyError,
  roundShekels,
} from '@caredesk/domain';
import { PayrollCalculationContextSchema } from '@caredesk/schemas';
import { closeSchema } from '../../../api/src/routes/canonical-product-intelligence.js';
import type { PayrollEntryResponse, SavePayrollEntryRequest } from '../../src/api/client.js';

type CloseInput = z.infer<typeof closeSchema>;
interface CanonicalClose extends CloseInput {
  id: string;
  settlementBasis: 'worker';
  calculationTotal: number;
  employerContributions: number;
  openingBalance: number;
  closedAt: string;
  closedBy: string | null;
}

// The entry route's body is private. Mirror its HTTP shape here; arithmetic and
// policy refusal use the actual domain, and closes use the exported API schema.
const money = z
  .number()
  .finite()
  .min(0)
  .max(10_000_000)
  .refine((n) => n === roundShekels(n));
const count = (maximum: number) =>
  z
    .number()
    .finite()
    .min(0)
    .max(maximum)
    .refine((n) => n === roundShekels(n));
const entryInput = z
  .object({
    baseSalary: money,
    workDays: count(31),
    paidRestDays: count(6),
    restDayRate: money,
    paidHolidays: count(10),
    holidayPay: money,
    vacationDays: count(31),
    vacationPay: money,
    sickDays: count(31),
    sickPay: money,
    otherAbsenceDays: count(31),
    employerContributions: money,
    additionalPayments: z
      .array(z.object({ description: z.string().trim().min(1).max(120), amount: money }))
      .max(50),
    pocketMoney: money,
    deductions: money,
    advances: money,
    agreedDeductions: money,
    total: z
      .number()
      .finite()
      .min(-10_000_000)
      .max(10_000_000)
      .refine((n) => n === roundShekels(n)),
    status: z.enum(['draft', 'final']),
    version: z.number().int().positive().optional(),
    calculationContext: PayrollCalculationContextSchema.nullish(),
  })
  .strict();
const CASE_ID = '30000000-0000-4000-8000-000000000001';

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

/**
 * Installs a synthetic HTTP contract boundary for browser-only E2E. Its state
 * survives page reload within one test, not test teardown or external deploys.
 * This exercises entry versions, finalization, worker receipts and replay;
 * real PostgreSQL durability, transactions, RLS and authentication are separate
 * integration gates. No reviewed numeric entitlement policies are seeded here.
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
  const responsesByKey = new Map<string, { hash: string; response: CanonicalClose }>();
  const entries = new Map<string, PayrollEntryResponse>();
  const entryResponsesByKey = new Map<string, { hash: string; response: PayrollEntryResponse }>();
  const entryWrites: Array<{ request: SavePayrollEntryRequest; entry: PayrollEntryResponse }> = [];
  let payrollListRequests = 0;
  let caseListUrl: string | undefined;
  let entryCount = 0;
  let closeMutations = 0;
  let lastCloseRequest: { url: string; key: string; input: CloseInput } | undefined;
  const fail = (route: Route, status: number, code: string) =>
    json(
      route,
      {
        code,
        message: 'Unable to complete the request',
        correlationId: 'synthetic-browser-contract',
      },
      status,
    );
  const knownCase = (caseId: string) => cases === 'seeded' && caseId === CASE_ID;
  const scope = (caseId: string, month: string) => `${caseId}:${month}`;

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
    caseListUrl = route.request().url();
    if (cases === 'none') return json(route, []);
    return json(route, [
      {
        id: CASE_ID,
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

  await page.route(
    /\/cases\/([^/]+)\/payroll-entries(?:\/(\d{4}-(?:0[1-9]|1[0-2])))?(?:\?.*)?$/,
    async (route) => {
      const match = /\/cases\/([^/]+)\/payroll-entries(?:\/(\d{4}-\d{2}))?/.exec(
        route.request().url(),
      );
      const caseId = match![1]!;
      const month = match![2];
      if (!knownCase(caseId)) return fail(route, 404, 'NOT_FOUND');
      if (route.request().method() === 'GET') {
        if (month) {
          const entry = entries.get(scope(caseId, month));
          return entry ? json(route, entry) : fail(route, 404, 'NOT_FOUND');
        }
        payrollListRequests += 1;
        return json(
          route,
          [...entries.entries()]
            .filter(([key]) => key.startsWith(`${caseId}:`))
            .map(([, entry]) => entry)
            .sort((a, b) => b.month.localeCompare(a.month)),
        );
      }
      if (route.request().method() !== 'PUT' || !month)
        return fail(route, 405, 'METHOD_NOT_ALLOWED');
      const parsed = entryInput.safeParse(route.request().postDataJSON());
      if (!parsed.success) return fail(route, 400, 'VALIDATION_ERROR');
      const input = parsed.data;
      const key = route.request().headers()['idempotency-key'];
      if (!key || key.length < 8 || key.length > 200)
        return fail(route, 400, 'IDEMPOTENCY_KEY_REQUIRED');
      const hash = JSON.stringify({ caseId, month, input });
      const replay = entryResponsesByKey.get(key);
      if (replay)
        return replay.hash === hash
          ? json(route, { entry: replay.response, replayed: true })
          : fail(route, 409, 'IDEMPOTENCY_CONFLICT');
      let components: z.infer<typeof entryInput>;
      try {
        components = deriveApprovedPayrollComponents(
          input,
          input.calculationContext ?? undefined,
          month,
          [],
        ).components;
      } catch (error) {
        if (!(error instanceof PayrollPolicyError)) throw error;
        return fail(
          route,
          error.code === 'money_precision' || error.code === 'invalid_context' ? 400 : 422,
          error.code === 'money_precision' || error.code === 'invalid_context'
            ? 'VALIDATION_ERROR'
            : 'PAYROLL_POLICY_REQUIRED',
        );
      }
      const totals = calculateMonthlyPayroll(components);
      if (!payrollTotalMatches(input.total, totals.total))
        return fail(route, 422, 'TOTAL_MISMATCH');
      const recordKey = scope(caseId, month);
      if (closes.has(recordKey)) return fail(route, 409, 'PAYROLL_MONTH_CLOSED');
      const previous = entries.get(recordKey);
      if (previous && input.version === undefined) return fail(route, 428, 'VERSION_REQUIRED');
      if (previous && previous.version !== input.version)
        return fail(route, 409, 'VERSION_CONFLICT');
      const now = new Date().toISOString();
      const entry: PayrollEntryResponse = {
        ...components,
        id: previous?.id ?? `40000000-0000-4000-8000-${String(++entryCount).padStart(12, '0')}`,
        month,
        status: input.status,
        total: totals.total,
        version: (previous?.version ?? 0) + 1,
        createdAt: previous?.createdAt ?? now,
        updatedAt: now,
      };
      if (!input.calculationContext) delete entry.calculationContext;
      entries.set(recordKey, entry);
      entryResponsesByKey.set(key, { hash, response: structuredClone(entry) });
      entryWrites.push({ request: structuredClone(input), entry: structuredClone(entry) });
      return json(route, { entry, replayed: false }, 201);
    },
  );

  await page.route(/\/cases\/[^/]+\/payroll-month-closes(?:\?.*)?$/, async (route) => {
    const caseId = /\/cases\/([^/]+)\/payroll-month-closes/.exec(route.request().url())![1]!;
    if (!knownCase(caseId)) return fail(route, 404, 'NOT_FOUND');
    if (route.request().method() === 'GET')
      return json(
        route,
        [...closes.entries()]
          .filter(([key]) => key.startsWith(`${caseId}:`))
          .map(([, close]) => close)
          .sort((a, b) => b.month.localeCompare(a.month)),
      );
    if (route.request().method() !== 'POST') return fail(route, 405, 'METHOD_NOT_ALLOWED');
    const parsed = closeSchema.safeParse(route.request().postDataJSON());
    if (!parsed.success) return fail(route, 400, 'VALIDATION_ERROR');
    const key = route.request().headers()['idempotency-key'];
    if (!key || key.length < 8 || key.length > 200)
      return fail(route, 400, 'IDEMPOTENCY_KEY_REQUIRED');
    const input = parsed.data;
    const hash = JSON.stringify({ caseId, input });
    lastCloseRequest = { url: route.request().url(), key, input };
    const replay = responsesByKey.get(key);
    if (replay)
      return replay.hash === hash
        ? json(route, { close: replay.response, replayed: true })
        : fail(route, 409, 'IDEMPOTENCY_CONFLICT');
    const recordKey = scope(caseId, input.month);
    const existingClose = closes.get(recordKey);
    if (existingClose) {
      if (
        JSON.stringify(input) !==
        JSON.stringify(
          Object.fromEntries(
            Object.keys(input).map((field) => [field, existingClose[field as keyof CloseInput]]),
          ),
        )
      )
        return fail(route, 409, 'PAYROLL_CLOSE_CONFLICT');
      responsesByKey.set(key, { hash, response: structuredClone(existingClose) });
      return json(route, { close: existingClose, replayed: true });
    }
    const entry = entries.get(recordKey);
    if (!entry || entry.id !== input.payrollReference)
      return fail(route, 409, 'PAYROLL_REFERENCE_NOT_FOUND');
    if (entry.version !== input.payrollVersion) return fail(route, 409, 'VERSION_CONFLICT');
    if (entry.status !== 'final') return fail(route, 409, 'PAYROLL_FINAL_REQUIRED');
    const totals = calculateMonthlyPayroll(entry);
    const settlement = derivePayrollSettlement(
      entry,
      entry.calculationContext?.openingBalance?.amount ?? 0,
    );
    if (settlement.openingBalance > 0) return fail(route, 422, 'PAYROLL_CARRY_SOURCE_MISMATCH');
    if (
      !payrollTotalMatches(entry.total, totals.total) ||
      !payrollTotalMatches(input.total, settlement.closingWorkerBalance) ||
      !payrollTotalMatches(input.baseSalary, entry.baseSalary) ||
      !payrollTotalMatches(
        input.additions,
        roundShekels(
          totals.additions - entry.employerContributions + Math.max(settlement.openingBalance, 0),
        ),
      ) ||
      !payrollTotalMatches(
        input.deductions,
        roundShekels(totals.deductions + Math.max(-settlement.openingBalance, 0)),
      )
    )
      return fail(route, 422, 'TOTAL_MISMATCH');
    closeMutations += 1;
    const close: CanonicalClose = {
      ...input,
      id: `20000000-0000-4000-8000-${String(closeMutations).padStart(12, '0')}`,
      settlementBasis: 'worker',
      calculationTotal: entry.total,
      employerContributions: entry.employerContributions,
      openingBalance: settlement.openingBalance,
      closedAt: '2026-08-16T06:10:00.000Z',
      closedBy: null,
    };
    closes.set(recordKey, close);
    responsesByKey.set(key, { hash, response: structuredClone(close) });
    return json(route, { close, replayed: false }, 201);
  });

  return {
    closeMutationCount: () => closeMutations,
    closedMonths: () => [...closes.values()],
    lastCloseRequest: () => lastCloseRequest,
    payrollEntries: () => structuredClone([...entries.values()]),
    payrollWrites: () => structuredClone(entryWrites),
    payrollListRequestCount: () => payrollListRequests,
    caseListUrl: () => caseListUrl,
    caseId: CASE_ID,
  };
}
