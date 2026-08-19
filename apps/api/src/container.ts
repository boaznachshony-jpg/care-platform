import type {
  ActorResolver,
  AuditService,
  AuthService,
  AuthorizationService,
  BillingRepository,
  CaseContactRepository,
  CaseFoundationRepository,
  DocumentRepository,
  FamilyMembershipRepository,
  IdentityInvitationService,
  ProductBillingGateway,
  TaskRepository,
  TimelineRepository,
  TimelineService,
  WorkspaceRepository,
  WorkspaceFileRepository,
  VisaRenewalEvaluationRepository,
} from '@caredesk/application';
import {
  AddContactToCase,
  CollectDueProductSubscriptions,
  CancelProductSubscription,
  CompleteProductBillingSetup,
  CompleteCaseTask,
  CreateCaseTask,
  GetDocumentDownloadUrl,
  GetEmploymentCase,
  GetWorkspace,
  GetProductSubscription,
  GetWorkspaceFileUrl,
  InviteFamilyMember,
  ListCaseDocuments,
  ListCaseContacts,
  ListCaseTasks,
  ListCaseTimeline,
  ListEmploymentCases,
  ListFamilyMembers,
  OpenEmploymentCase,
  SaveWorkspace,
  PutWorkspaceFile,
  RevokeFamilyMember,
  StartProductBillingSetup,
  DeleteWorkspaceFile,
  UploadCaseDocument,
  UpdateFamilyMemberRole,
  StartVisaRenewalWorkflow,
  GetVisaRenewalWorkflow,
  ListVisaRenewalWorkflows,
  RecordVisaRenewalContactActivity,
  LinkRenewedVisaAuthorization,
  ResolveVisaAuthorizationOverlap,
  CompleteVisaRenewalWorkflow,
} from '@caredesk/application';
import {
  createPool,
  PgActorResolver,
  PgAuditService,
  PgBillingRepository,
  PgCaseContactRepository,
  PgCaseFoundationRepository,
  PgDocumentRepository,
  PgFamilyMembershipRepository,
  PgMembershipAuthorizationService,
  PgTaskRepository,
  PgTimelineService,
  PgWorkspaceRepository,
  PgWorkspaceFileRepository,
  PgVisaRenewalRepository,
  PgVisaRenewalSideEffects,
  PgVisaRenewalEvaluationRepository,
  PgIdempotencyRepository,
  PgVisaRenewalProgressRepository,
} from '@caredesk/db';
import {
  InMemoryActorResolver,
  InMemoryAuditService,
  InMemoryBillingRepository,
  InMemoryCaseContactRepository,
  InMemoryCaseFoundationRepository,
  InMemoryDocumentRepository,
  InMemoryDocumentStorage,
  InMemoryFamilyMembershipRepository,
  InMemoryTaskRepository,
  InMemoryTimelineRepository,
  InMemoryTimelineService,
  InMemoryWorkspaceRepository,
  InMemoryWorkspaceFileRepository,
  MembershipAuthorizationService,
  MockAuthService,
  MockIdentityInvitationService,
  MockProductBillingGateway,
  DisabledProductBillingGateway,
  SystemClock,
  UuidIdGenerator,
  InMemoryVisaRenewalRepository,
} from '@caredesk/infrastructure';
import type { Pool } from 'pg';
import type { Env } from './env.js';
import { SupabaseAuthService } from './auth/supabase-auth-service.js';
import { SupabaseInvitationService } from './auth/supabase-invitation-service.js';
import { SupabaseDocumentStorage } from './storage/supabase-document-storage.js';
import { MirroredDocumentStorage } from './storage/mirrored-document-storage.js';
import { CardcomProductBillingGateway } from './billing/cardcom-gateway.js';
import { Wave5Service } from './collaboration/wave5-service.js';
import {
  InMemoryAutomationReceiptStore,
  PgAutomationReceiptStore,
  type AutomationReceiptStore,
} from './automation/automation-receipt-store.js';

/**
 * Closed-pilot family role-to-permission map (ADR-004). `family_member` is a
 * backwards-compatible, read-only alias for `viewer`.
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
    'membership:read',
    'membership:manage',
    'billing:read',
    'billing:manage',
    'workflow:start',
    'workflow:read',
    'workflow:update',
    'workflow:complete',
  ],
  manager: [
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
    'membership:read',
    'billing:read',
    'workflow:start',
    'workflow:read',
    'workflow:update',
    'workflow:complete',
  ],
  viewer: [
    'employment_case:read',
    'case_contact:read',
    'task:read',
    'timeline:read',
    'document:read',
    'workspace:read',
    'membership:read',
    'billing:read',
    'workflow:read',
  ],
  family_member: [
    'employment_case:read',
    'case_contact:read',
    'task:read',
    'timeline:read',
    // Read-only, deliberately: viewing a case never confers authority to add
    // to it (Constitution §18).
    'document:read',
    'workspace:read',
    'membership:read',
    'billing:read',
    'workflow:read',
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
  wave5?: Wave5Service;
  auth: AuthService;
  actorResolver: ActorResolver;
  audit: AuditService;
  /** Canonical user-facing case history writer (Timeline evidence). */
  timeline: TimelineService;
  /** Durable replay receipts for automation execution (migration 0029). */
  automationReceipts: AutomationReceiptStore;
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
  listFamilyMembers: ListFamilyMembers;
  inviteFamilyMember: InviteFamilyMember;
  updateFamilyMemberRole: UpdateFamilyMemberRole;
  revokeFamilyMember: RevokeFamilyMember;
  getProductSubscription: GetProductSubscription;
  startProductBillingSetup: StartProductBillingSetup;
  completeProductBillingSetup: CompleteProductBillingSetup;
  collectDueProductSubscriptions: CollectDueProductSubscriptions;
  cancelProductSubscription: CancelProductSubscription;
  startVisaRenewal: StartVisaRenewalWorkflow;
  getVisaRenewal: GetVisaRenewalWorkflow;
  listVisaRenewals: ListVisaRenewalWorkflows;
  recordVisaRenewalContact: RecordVisaRenewalContactActivity;
  linkRenewedVisaAuthorization: LinkRenewedVisaAuthorization;
  resolveVisaAuthorizationOverlap: ResolveVisaAuthorizationOverlap;
  completeVisaRenewal: CompleteVisaRenewalWorkflow;
  visaRenewalEvaluation: VisaRenewalEvaluationRepository;
  readiness(): Promise<{
    ready: boolean;
    reasons: string[];
    checks: Record<string, 'ok' | 'unconfigured' | 'unreachable' | 'migration-required'>;
  }>;
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
  let familyMembershipRepository: FamilyMembershipRepository;
  let billingRepository: BillingRepository;
  const memoryVisaRenewals = new InMemoryVisaRenewalRepository();
  const visaRenewalRepository = pool ? new PgVisaRenewalRepository(pool) : memoryVisaRenewals;
  const visaIdempotency = pool ? new PgIdempotencyRepository(pool) : memoryVisaRenewals;
  const visaRenewalEvaluation: VisaRenewalEvaluationRepository = pool
    ? new PgVisaRenewalEvaluationRepository(pool)
    : {
        async evaluate(asOf) {
          return {
            ruleDefinitionId: '00000000-0000-0000-0000-000000000000',
            ruleVersionId: '00000000-0000-0000-0000-000000000000',
            status: 'unavailable',
            asOf,
            dueDate: null,
            priority: null,
            explanationKey: 'visa_renewal.rule_unavailable',
            sourceReferences: [],
            reviewRequired: true,
          };
        },
      };

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
    workspaceRepository = new PgWorkspaceRepository(pool, env.WORKSPACE_ENCRYPTION_KEY);
    workspaceFileRepository = new PgWorkspaceFileRepository(pool);
    familyMembershipRepository = new PgFamilyMembershipRepository(pool);
    billingRepository = new PgBillingRepository(pool);
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
    familyMembershipRepository = new InMemoryFamilyMembershipRepository();
    billingRepository = new InMemoryBillingRepository();
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
    if (familyMembershipRepository instanceof InMemoryFamilyMembershipRepository) {
      familyMembershipRepository.seed({
        tenantId: DEV_TENANT_ID,
        membershipId: '00000000-0000-4000-8000-000000000003',
        userId: DEV_USER_ID,
        displayName: 'Demo owner',
        email: 'owner@example.test',
        role: 'owner',
        status: 'active',
        invitedAt: new Date(0).toISOString(),
        lastAuthenticatedAt: new Date().toISOString(),
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
  const primaryStorage =
    env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY && env.SUPABASE_STORAGE_BUCKET
      ? new SupabaseDocumentStorage(
          env.SUPABASE_URL,
          env.SUPABASE_SERVICE_ROLE_KEY,
          env.SUPABASE_STORAGE_BUCKET,
        )
      : new InMemoryDocumentStorage();
  const storage =
    env.BACKUP_SUPABASE_URL &&
    env.BACKUP_SUPABASE_SERVICE_ROLE_KEY &&
    env.BACKUP_SUPABASE_STORAGE_BUCKET
      ? new MirroredDocumentStorage(
          primaryStorage,
          new SupabaseDocumentStorage(
            env.BACKUP_SUPABASE_URL,
            env.BACKUP_SUPABASE_SERVICE_ROLE_KEY,
            env.BACKUP_SUPABASE_STORAGE_BUCKET,
          ),
        )
      : primaryStorage;

  const invitationRedirect =
    env.FAMILY_INVITE_REDIRECT_URL ?? `${env.CORS_ORIGINS.split(',')[0]?.trim()}/app`;
  const invitations: IdentityInvitationService =
    env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY
      ? new SupabaseInvitationService(
          env.SUPABASE_URL,
          env.SUPABASE_SERVICE_ROLE_KEY,
          invitationRedirect,
        )
      : new MockIdentityInvitationService();

  const billingGateway: ProductBillingGateway =
    env.BILLING_PROVIDER === 'cardcom'
      ? new CardcomProductBillingGateway({
          terminalNumber: env.CARDCOM_TERMINAL_NUMBER!,
          apiName: env.CARDCOM_API_NAME!,
          apiPassword: env.CARDCOM_API_PASSWORD!,
          successUrl: env.BILLING_SUCCESS_URL!,
          failureUrl: env.BILLING_FAILURE_URL!,
          webhookUrl: env.BILLING_WEBHOOK_URL!,
          tokenEncryptionKey: env.CARDCOM_TOKEN_ENCRYPTION_KEY!,
          markAsRecurring: env.CARDCOM_MARK_AS_RECURRING,
        })
      : env.BILLING_PROVIDER === 'mock'
        ? new MockProductBillingGateway()
        : new DisabledProductBillingGateway();

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
  const familyAccessDeps = {
    authorization,
    memberships: familyMembershipRepository,
    invitations,
    audit,
    clock,
    ids,
  };
  const billingDeps = {
    authorization,
    billing: billingRepository,
    gateway: billingGateway,
    audit,
    clock,
    ids,
    defaults: {
      priceAgorot: env.BILLING_PRICE_AGOROT,
      vatRateBps: env.BILLING_VAT_RATE_BPS,
      launchDiscountPercent: env.BILLING_LAUNCH_DISCOUNT_PERCENT,
      // No environment-wide start date: paid billing is activated explicitly
      // per tenant by the guarded operator command.
      chargingStartsAt: null,
    },
  };
  const visaDeps = {
    authorization,
    audit,
    clock,
    ids,
    workflows: visaRenewalRepository,
    idempotency: visaIdempotency,
    progress: pool ? new PgVisaRenewalProgressRepository(pool) : memoryVisaRenewals,
    ...(pool ? { sideEffects: new PgVisaRenewalSideEffects(pool) } : {}),
  };

  return {
    ...(pool ? { wave5: new Wave5Service(pool, storage) } : {}),
    auth,
    actorResolver,
    audit,
    timeline,
    // Durable in Postgres; the in-memory fallback exists only so a bare
    // `pnpm dev:api`/tests keep the identical claim/replay contract.
    automationReceipts: pool
      ? new PgAutomationReceiptStore(pool)
      : new InMemoryAutomationReceiptStore(),
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
    listFamilyMembers: new ListFamilyMembers(familyAccessDeps),
    inviteFamilyMember: new InviteFamilyMember(familyAccessDeps),
    updateFamilyMemberRole: new UpdateFamilyMemberRole(familyAccessDeps),
    revokeFamilyMember: new RevokeFamilyMember(familyAccessDeps),
    getProductSubscription: new GetProductSubscription(billingDeps),
    startProductBillingSetup: new StartProductBillingSetup(billingDeps),
    completeProductBillingSetup: new CompleteProductBillingSetup(billingDeps),
    collectDueProductSubscriptions: new CollectDueProductSubscriptions(billingDeps),
    cancelProductSubscription: new CancelProductSubscription(billingDeps),
    startVisaRenewal: new StartVisaRenewalWorkflow(visaDeps),
    getVisaRenewal: new GetVisaRenewalWorkflow(visaDeps),
    listVisaRenewals: new ListVisaRenewalWorkflows(visaDeps),
    recordVisaRenewalContact: new RecordVisaRenewalContactActivity(visaDeps),
    linkRenewedVisaAuthorization: new LinkRenewedVisaAuthorization(visaDeps),
    resolveVisaAuthorizationOverlap: new ResolveVisaAuthorizationOverlap(visaDeps),
    completeVisaRenewal: new CompleteVisaRenewalWorkflow(visaDeps),
    visaRenewalEvaluation,
    async readiness() {
      const checks: Record<string, 'ok' | 'unconfigured' | 'unreachable' | 'migration-required'> = {
        database: pool ? 'ok' : 'unconfigured',
        authentication: hasSupabaseAuth ? 'ok' : 'unconfigured',
        privateStorage: hasPrivateStorage ? 'ok' : 'unconfigured',
      };
      if (env.NODE_ENV !== 'production') return { ready: true, reasons: [], checks };
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
            family_members_function: string | null;
            billing_table: string | null;
            workflow_table: string | null;
          }>(
            `select
               to_regprocedure('public.resolve_caredesk_actor(text)')::text as actor_resolver,
               to_regclass('public.tenant_workspace')::text as workspace_table,
               to_regclass('public.workspace_file')::text as workspace_file_table,
               to_regprocedure('public.list_caredesk_family_members(uuid)')::text as family_members_function,
               to_regclass('public.product_subscription')::text as billing_table,
               to_regclass('public.workflow_instance')::text as workflow_table`,
          );
          const row = result.rows[0];
          if (
            !row?.actor_resolver ||
            !row.workspace_table ||
            !row.workspace_file_table ||
            !row.family_members_function ||
            !row.billing_table ||
            !row.workflow_table
          ) {
            reasons.push('Required pilot database migrations are missing');
            checks.database = 'migration-required';
          }
        } catch {
          reasons.push('Database is unreachable');
          checks.database = 'unreachable';
        }
      }
      return { ready: reasons.length === 0, reasons, checks };
    },
  };
}
