import type {
  ActorResolver,
  AuditService,
  AuthService,
  AuthorizationService,
  CaseContactRepository,
  CaseFoundationRepository,
  DocumentRepository,
  TaskRepository,
  TimelineRepository,
  TimelineService,
  WorkspaceRepository,
  WorkspaceFileRepository,
} from '@caredesk/application';
import {
  AddContactToCase,
  CompleteCaseTask,
  CreateCaseTask,
  GetDocumentDownloadUrl,
  GetEmploymentCase,
  GetWorkspace,
  GetWorkspaceFileUrl,
  ListCaseDocuments,
  ListCaseContacts,
  ListCaseTasks,
  ListCaseTimeline,
  ListEmploymentCases,
  OpenEmploymentCase,
  SaveWorkspace,
  PutWorkspaceFile,
  DeleteWorkspaceFile,
  UploadCaseDocument,
} from '@caredesk/application';
import {
  createPool,
  PgActorResolver,
  PgAuditService,
  PgCaseContactRepository,
  PgCaseFoundationRepository,
  PgDocumentRepository,
  PgMembershipAuthorizationService,
  PgTaskRepository,
  PgTimelineService,
  PgWorkspaceRepository,
  PgWorkspaceFileRepository,
} from '@caredesk/db';
import {
  InMemoryActorResolver,
  InMemoryAuditService,
  InMemoryCaseContactRepository,
  InMemoryCaseFoundationRepository,
  InMemoryDocumentRepository,
  InMemoryDocumentStorage,
  InMemoryTaskRepository,
  InMemoryTimelineRepository,
  InMemoryTimelineService,
  InMemoryWorkspaceRepository,
  InMemoryWorkspaceFileRepository,
  MembershipAuthorizationService,
  MockAuthService,
  SystemClock,
  UuidIdGenerator,
} from '@caredesk/infrastructure';
import type { Pool } from 'pg';
import type { Env } from './env.js';
import { SupabaseAuthService } from './auth/supabase-auth-service.js';
import { SupabaseDocumentStorage } from './storage/supabase-document-storage.js';

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
    'document:create',
    'document:read',
    'workspace:read',
    'workspace:update',
  ],
  family_member: [
    'employment_case:read',
    'case_contact:read',
    'task:read',
    'timeline:read',
    // Read-only, deliberately: viewing a case never confers authority to add
    // to it (Constitution §18).
    'document:read',
  ],
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
  auth: AuthService;
  actorResolver: ActorResolver;
  audit: AuditService;
  openCase: OpenEmploymentCase;
  getCase: GetEmploymentCase;
  listCases: ListEmploymentCases;
  addContact: AddContactToCase;
  listContacts: ListCaseContacts;
  createTask: CreateCaseTask;
  completeTask: CompleteCaseTask;
  listTasks: ListCaseTasks;
  listTimeline: ListCaseTimeline;
  uploadDocument: UploadCaseDocument;
  listDocuments: ListCaseDocuments;
  getDocumentDownloadUrl: GetDocumentDownloadUrl;
  getWorkspace: GetWorkspace;
  saveWorkspace: SaveWorkspace;
  putWorkspaceFile: PutWorkspaceFile;
  getWorkspaceFileUrl: GetWorkspaceFileUrl;
  deleteWorkspaceFile: DeleteWorkspaceFile;
  readiness(): Promise<{ ready: boolean; reasons: string[] }>;
  /** Present only when backed by Postgres; close it on shutdown. */
  pool?: Pool;
}

export function buildContainer(env: Env): Container {
  // Postgres when DATABASE_URL is configured, in-memory otherwise — so tests
  // and a bare `pnpm dev:api` still run with no database available.
  //
  // DATABASE_URL is the `caredesk_app` login (ADR-002), not the owner: the
  // pool holds no administrative credential and cannot bypass RLS. The owner
  // connection (DATABASE_ADMIN_URL) is used only by `pnpm db:migrate` and
  // `pnpm db:provision-app-role`, and is never read here.
  const pool = env.DATABASE_URL ? createPool(env.DATABASE_URL) : undefined;
  const hasSupabaseAuth = Boolean(env.SUPABASE_URL && env.SUPABASE_PUBLISHABLE_KEY);
  const hasPrivateStorage = Boolean(
    env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY && env.SUPABASE_STORAGE_BUCKET,
  );
  const mockAuth = new MockAuthService();
  const memoryActorResolver = new InMemoryActorResolver();
  const auth: AuthService = hasSupabaseAuth
    ? new SupabaseAuthService(env.SUPABASE_URL!, env.SUPABASE_PUBLISHABLE_KEY!)
    : mockAuth;
  const actorResolver: ActorResolver =
    pool && hasSupabaseAuth ? new PgActorResolver(pool) : memoryActorResolver;
  const authorization: AuthorizationService = pool
    ? new PgMembershipAuthorizationService(pool, ROLE_PERMISSIONS)
    : new MembershipAuthorizationService(ROLE_PERMISSIONS);

  let repository: CaseFoundationRepository;
  let contactRepository: CaseContactRepository;
  let taskRepository: TaskRepository;
  let documentRepository: DocumentRepository;
  let timeline: TimelineService;
  let timelineRepository: TimelineRepository;
  let audit: AuditService;
  let workspaceRepository: WorkspaceRepository;
  let workspaceFileRepository: WorkspaceFileRepository;

  if (pool) {
    repository = new PgCaseFoundationRepository(pool);
    contactRepository = new PgCaseContactRepository(pool);
    taskRepository = new PgTaskRepository(pool);
    documentRepository = new PgDocumentRepository(pool);
    const pgTimeline = new PgTimelineService(pool);
    timeline = pgTimeline;
    timelineRepository = pgTimeline;
    // Constitution §19: audit must survive a process restart, so it goes to
    // Postgres whenever a database is configured.
    audit = new PgAuditService(pool);
    workspaceRepository = new PgWorkspaceRepository(pool);
    workspaceFileRepository = new PgWorkspaceFileRepository(pool);
  } else {
    repository = new InMemoryCaseFoundationRepository();
    contactRepository = new InMemoryCaseContactRepository();
    taskRepository = new InMemoryTaskRepository();
    documentRepository = new InMemoryDocumentRepository();
    const memoryTimeline = new InMemoryTimelineService();
    timeline = memoryTimeline;
    timelineRepository = new InMemoryTimelineRepository(memoryTimeline);
    audit = new InMemoryAuditService();
    workspaceRepository = new InMemoryWorkspaceRepository();
    workspaceFileRepository = new InMemoryWorkspaceFileRepository();
  }

  const clock = new SystemClock();
  const ids = new UuidIdGenerator();

  if (env.NODE_ENV !== 'production') {
    mockAuth.seedSession(DEV_TOKEN, {
      userId: DEV_USER_ID,
      authSubject: 'synthetic-auth-subject-1',
      issuedAt: new Date().toISOString(),
      // Long-lived on purpose: dev-only mock session over synthetic data.
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString(),
      mfaSatisfied: false,
    });
    memoryActorResolver.seedActor('synthetic-auth-subject-1', {
      userId: DEV_USER_ID,
      tenantId: DEV_TENANT_ID,
    });
    if (authorization instanceof MembershipAuthorizationService) {
      authorization.seedMembership({
        userId: DEV_USER_ID,
        tenantId: DEV_TENANT_ID,
        role: 'owner',
        status: 'active',
      });
    }

    if (pool) {
      // The dev tenant row must exist before any case can reference it.
      //
      // `tenant` is global reference data: `caredesk_app` has SELECT only, so
      // now that the pool connects as that role this insert is expected to be
      // denied on a properly provisioned database. Warn and continue rather
      // than let an unhandled rejection take the process down — the row is
      // seeded once by an operator on the owner connection.
      void pool
        .query(
          `insert into tenant (id, data_region) values ($1, 'synthetic')
         on conflict (id) do nothing`,
          [DEV_TENANT_ID],
        )
        .catch((error: unknown) => {
          console.warn(
            `[dev] could not seed the synthetic tenant row (${
              error instanceof Error ? error.message : String(error)
            }). Insert it once on the owner connection: ` +
              `insert into tenant (id, data_region) values ('${DEV_TENANT_ID}', 'synthetic') on conflict do nothing;`,
          );
        });
    }
  }

  // Object storage is mocked for Milestone 1. Real cloud storage is a separate
  // decision (ADR pending) — the port keeps that swap to one line.
  const storage =
    env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY && env.SUPABASE_STORAGE_BUCKET
      ? new SupabaseDocumentStorage(
          env.SUPABASE_URL,
          env.SUPABASE_SERVICE_ROLE_KEY,
          env.SUPABASE_STORAGE_BUCKET,
        )
      : new InMemoryDocumentStorage();

  const caseDeps = { authorization, repository, audit, timeline, clock, ids };
  const taskDeps = { authorization, tasks: taskRepository, audit, timeline, clock, ids };
  const documentDeps = {
    authorization,
    documents: documentRepository,
    storage,
    audit,
    timeline,
    clock,
    ids,
  };
  const workspaceDeps = { authorization, workspaces: workspaceRepository, audit, clock };
  const workspaceFileDeps = {
    authorization,
    files: workspaceFileRepository,
    storage,
    audit,
    clock,
    ids,
  };

  return {
    auth,
    actorResolver,
    audit,
    pool,
    openCase: new OpenEmploymentCase(caseDeps),
    // Read use cases take audit + clock too: a refused read is an audited
    // security event, so authorization goes through the same helper as writes.
    getCase: new GetEmploymentCase({ authorization, repository, audit, clock }),
    listCases: new ListEmploymentCases({ authorization, repository, audit, clock }),
    addContact: new AddContactToCase({
      authorization,
      repository: contactRepository,
      audit,
      timeline,
      clock,
      ids,
    }),
    listContacts: new ListCaseContacts({
      authorization,
      repository: contactRepository,
      audit,
      clock,
    }),
    createTask: new CreateCaseTask(taskDeps),
    completeTask: new CompleteCaseTask(taskDeps),
    listTasks: new ListCaseTasks(taskDeps),
    listTimeline: new ListCaseTimeline({
      authorization,
      timeline: timelineRepository,
      audit,
      clock,
    }),
    uploadDocument: new UploadCaseDocument(documentDeps),
    listDocuments: new ListCaseDocuments(documentDeps),
    getDocumentDownloadUrl: new GetDocumentDownloadUrl(documentDeps),
    getWorkspace: new GetWorkspace(workspaceDeps),
    saveWorkspace: new SaveWorkspace(workspaceDeps),
    putWorkspaceFile: new PutWorkspaceFile(workspaceFileDeps),
    getWorkspaceFileUrl: new GetWorkspaceFileUrl(workspaceFileDeps),
    deleteWorkspaceFile: new DeleteWorkspaceFile(workspaceFileDeps),
    async readiness() {
      if (env.NODE_ENV !== 'production') return { ready: true, reasons: [] };
      const reasons: string[] = [];
      if (!pool) reasons.push('DATABASE_URL is not configured');
      if (!hasSupabaseAuth) reasons.push('Supabase authentication is not configured');
      if (!hasPrivateStorage) reasons.push('Private document storage is not configured');
      if (pool) {
        try {
          const result = await pool.query<{
            actor_resolver: string | null;
            workspace_table: string | null;
            workspace_file_table: string | null;
          }>(
            `select
               to_regprocedure('resolve_caredesk_actor(text)')::text as actor_resolver,
               to_regclass('tenant_workspace')::text as workspace_table,
               to_regclass('workspace_file')::text as workspace_file_table`,
          );
          const row = result.rows[0];
          if (!row?.actor_resolver || !row.workspace_table || !row.workspace_file_table) {
            reasons.push('Required pilot database migrations are missing');
          }
        } catch {
          reasons.push('Database is unreachable');
        }
      }
      return { ready: reasons.length === 0, reasons };
    },
  };
}
