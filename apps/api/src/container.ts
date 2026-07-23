import { GetEmploymentCase, ListEmploymentCases, OpenEmploymentCase } from '@caredesk/application';
import {
  InMemoryAuditService,
  InMemoryCaseFoundationRepository,
  InMemoryTimelineService,
  MembershipAuthorizationService,
  MockAuthService,
  SystemClock,
  UuidIdGenerator,
} from '@caredesk/infrastructure';
import type { Env } from './env.js';

/**
 * Milestone 1 role→permission map. This is an interim, code-level map — the
 * canonical role vocabulary is a Milestone 1 permission-model decision still
 * to be recorded; keep it minimal until then.
 */
const ROLE_PERMISSIONS = {
  owner: ['employment_case:create', 'employment_case:read'],
  family_member: ['employment_case:read'],
} as const;

/**
 * Synthetic development identity (Constitution §16/§25 — synthetic only).
 * The bearer token is NOT a secret: it only exists outside production and
 * unlocks a mock session over synthetic data.
 */
export const DEV_TOKEN = 'dev-local-token';
const DEV_USER_ID = 'user-synthetic-1';
const DEV_TENANT_ID = 'tenant-synthetic-1';

export interface Container {
  auth: MockAuthService;
  tenantByUser: Map<string, string>;
  audit: InMemoryAuditService;
  timeline: InMemoryTimelineService;
  openCase: OpenEmploymentCase;
  getCase: GetEmploymentCase;
  listCases: ListEmploymentCases;
}

export function buildContainer(env: Env): Container {
  const auth = new MockAuthService();
  const authorization = new MembershipAuthorizationService(ROLE_PERMISSIONS);
  const repository = new InMemoryCaseFoundationRepository();
  const audit = new InMemoryAuditService();
  const timeline = new InMemoryTimelineService();
  const clock = new SystemClock();
  const ids = new UuidIdGenerator();
  const tenantByUser = new Map<string, string>();

  if (env.NODE_ENV !== 'production') {
    auth.seedSession(DEV_TOKEN, {
      userId: DEV_USER_ID,
      authSubject: 'synthetic-auth-subject-1',
      issuedAt: new Date().toISOString(),
      // Long-lived on purpose: dev-only mock session over synthetic data.
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString(),
      mfaSatisfied: false,
    });
    authorization.seedMembership({
      userId: DEV_USER_ID,
      tenantId: DEV_TENANT_ID,
      role: 'owner',
      status: 'active',
    });
    tenantByUser.set(DEV_USER_ID, DEV_TENANT_ID);
  }

  return {
    auth,
    tenantByUser,
    audit,
    timeline,
    openCase: new OpenEmploymentCase({ authorization, repository, audit, timeline, clock, ids }),
    getCase: new GetEmploymentCase({ authorization, repository }),
    listCases: new ListEmploymentCases({ authorization, repository }),
  };
}
