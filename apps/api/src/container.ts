import type {
  CaseContactRepository,
  CaseFoundationRepository,
  TaskRepository,
  TimelineRepository,
  TimelineService,
} from '@caredesk/application';
import {
  AddContactToCase,
  CompleteCaseTask,
  CreateCaseTask,
  GetEmploymentCase,
  ListCaseContacts,
  ListCaseTasks,
  ListCaseTimeline,
  ListEmploymentCases,
  OpenEmploymentCase,
} from '@caredesk/application';
import {
  createPool,
  PgCaseContactRepository,
  PgCaseFoundationRepository,
  PgTaskRepository,
  PgTimelineService,
} from '@caredesk/db';
import {
  InMemoryAuditService,
  InMemoryCaseContactRepository,
  InMemoryCaseFoundationRepository,
  InMemoryTaskRepository,
  InMemoryTimelineRepository,
  InMemoryTimelineService,
  MembershipAuthorizationService,
  MockAuthService,
  SystemClock,
  UuidIdGenerator,
} from '@caredesk/infrastructure';
import type { Pool } from 'pg';
import type { Env } from './env.js';

/**
 * Milestone 1 role→permission map. This is an interim, code-level map — the
 * canonical role vocabulary is a Milestone 1 permission-model decision still
 * to be recorded; keep it minimal until then.
 *
 * `family_member` is deliberately read-only: per Constitution §18 a family
 * member views a case without gaining authority to change it.
 */
const ROLE_PERMISSIONS = {
  owner: [
    'employment_case:create',
    'employment_case:read',
    'case_contact:create',
    'case_contact:read',
    'task:create',
    'task:read',
    'task:update',
    'timeline:read',
  ],
  family_member: ['employment_case:read', 'case_contact:read', 'task:read', 'timeline:read'],
} as const;

/**
 * Synthetic development identity (Constitution §16/§25 — synthetic only).
 * The bearer token is NOT a secret: it only exists outside production and
 * unlocks a mock session over synthetic data.
 */
export const DEV_TOKEN = 'dev-local-token';
/**
 * Fixed UUIDs: tenant_id, and the created_by/updated_by actor columns, are all
 * `uuid` in the schema, so the synthetic dev identity has to parse as one.
 */
const DEV_TENANT_ID = '00000000-0000-4000-8000-000000000001';
const DEV_USER_ID = '00000000-0000-4000-8000-000000000002';

export interface Container {
  auth: MockAuthService;
  tenantByUser: Map<string, string>;
  audit: InMemoryAuditService;
  openCase: OpenEmploymentCase;
  getCase: GetEmploymentCase;
  listCases: ListEmploymentCases;
  addContact: AddContactToCase;
  listContacts: ListCaseContacts;
  createTask: CreateCaseTask;
  completeTask: CompleteCaseTask;
  listTasks: ListCaseTasks;
  listTimeline: ListCaseTimeline;
  /** Present only when backed by Postgres; close it on shutdown. */
  pool?: Pool;
}

export function buildContainer(env: Env): Container {
  const auth = new MockAuthService();
  const authorization = new MembershipAuthorizationService(ROLE_PERMISSIONS);

  // Postgres when DATABASE_URL is configured, in-memory otherwise — so tests
  // and a bare `pnpm dev:api` still run with no database available.
  const pool = env.DATABASE_URL ? createPool(env.DATABASE_URL) : undefined;

  let repository: CaseFoundationRepository;
  let contactRepository: CaseContactRepository;
  let taskRepository: TaskRepository;
  let timeline: TimelineService;
  let timelineRepository: TimelineRepository;

  if (pool) {
    repository = new PgCaseFoundationRepository(pool);
    contactRepository = new PgCaseContactRepository(pool);
    taskRepository = new PgTaskRepository(pool);
    const pgTimeline = new PgTimelineService(pool);
    timeline = pgTimeline;
    timelineRepository = pgTimeline;
  } else {
    repository = new InMemoryCaseFoundationRepository();
    contactRepository = new InMemoryCaseContactRepository();
    taskRepository = new InMemoryTaskRepository();
    const memoryTimeline = new InMemoryTimelineService();
    timeline = memoryTimeline;
    timelineRepository = new InMemoryTimelineRepository(memoryTimeline);
  }

  const audit = new InMemoryAuditService();
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

    if (pool) {
      // The dev tenant row must exist before any case can reference it.
      void pool.query(
        `insert into tenant (id, data_region) values ($1, 'synthetic')
         on conflict (id) do nothing`,
        [DEV_TENANT_ID],
      );
    }
  }

  const caseDeps = { authorization, repository, audit, timeline, clock, ids };
  const taskDeps = { authorization, tasks: taskRepository, audit, timeline, clock, ids };

  return {
    auth,
    tenantByUser,
    audit,
    pool,
    openCase: new OpenEmploymentCase(caseDeps),
    getCase: new GetEmploymentCase({ authorization, repository }),
    listCases: new ListEmploymentCases({ authorization, repository }),
    addContact: new AddContactToCase({
      authorization,
      repository: contactRepository,
      audit,
      timeline,
      clock,
      ids,
    }),
    listContacts: new ListCaseContacts({ authorization, repository: contactRepository }),
    createTask: new CreateCaseTask(taskDeps),
    completeTask: new CompleteCaseTask(taskDeps),
    listTasks: new ListCaseTasks(taskDeps),
    listTimeline: new ListCaseTimeline({ authorization, timeline: timelineRepository }),
  };
}
