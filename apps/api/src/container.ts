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
  MedicationRepository,
  ProductBillingGateway,
  TaskRepository,
  TimelineRepository,
  TimelineService,
  WorkspaceRepository,
  WorkspaceHistoryRepository,
  WorkspaceFileRepository,
  TenantCensusRepository,
  DataLossAlertSink,
  VisaRenewalEvaluationRepository,
} from '@caredesk/application';
import {
  AddContactToCase,
  CollectDueProductSubscriptions,
  CancelProductSubscription,
  CompleteProductBillingSetup,
  ArchiveCaseTask,
  ArchiveMedication,
  CompleteCaseTask,
  CreateCaseTask,
  CreateMedication,
  GetDocumentDownloadUrl,
  GetEmploymentCase,
  GetWorkspace,
  GetProductSubscription,
  GetWorkspaceFileUrl,
  ImportCaseDocument,
  ImportCaseTask,
  ImportMedication,
  InviteFamilyMember,
  ListCaseDocuments,
  ListCaseContacts,
  ListCaseTasks,
  ListCaseTimeline,
  ListEmploymentCases,
  ListFamilyMembers,
  ListMedications,
  OpenEmploymentCase,
  SaveWorkspace,
  UpdateCaregiverProfileUseCase,
  UpdateCaseTask,
  UpdateMedication,
  ListWorkspaceVersions,
  RestoreWorkspaceVersion,
  ScanForSilentDataLoss,
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
  PgMedicationRepository,
  PgMembershipAuthorizationService,
  PgTaskRepository,
  PgTimelineService,
  PgWorkspaceRepository,
  PgWorkspaceHistoryRepository,
  PgWorkspaceFileRepository,
  PgTenantCensusRepository,
  PgVisaRenewalRepository,
  PgVisaRenewalSideEffects,
  PgVisaRenewalEvaluationRepository,
  PgIdempotencyRepository,
  PgVisaRenewalProgressRepository,
  missingMigrations,
  REQUIRED_MIGRATIONS,
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
  InMemoryMedicationRepository,
  InMemoryTaskRepository,
  InMemoryTimelineRepository,
  InMemoryTimelineService,
  InMemoryWorkspaceRepository,
  InMemoryWorkspaceHistoryRepository,
  InMemoryWorkspaceFileRepository,
  InMemoryTenantCensusRepository,
  LoggingDataLossAlertSink,
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
import { workspaceEncryptionKeys, type Env } from './env.js';
import { SupabaseAuthService } from './auth/supabase-auth-service.js';
import { SupabaseInvitationService } from './auth/supabase-invitation-service.js';
import { resolveInvitationRedirect } from './auth/invitation-redirect.js';
import { SupabaseDocumentStorage } from './storage/supabase-document-storage.js';
import { MirroredDocumentStorage } from './storage/mirrored-document-storage.js';
import { CardcomProductBillingGateway } from './billing/cardcom-gateway.js';
import { Wave5Service } from './collaboration/wave5-service.js';
import {
  InMemoryAutomationReceiptStore,
  PgAutomationReceiptStore,
  type AutomationReceiptStore,
} from './automation/automation-receipt-store.js';
import {
  InMemoryRegulationRuleService,
  PgRegulationRuleService,
  type RegulationRuleService,
} from './regulation-rule-service.js';
import {
  InMemoryTermsAcceptanceStore,
  PgTermsAcceptanceStore,
  type TermsAcceptanceStore,
} from './legal/terms-acceptance-store.js';
import { probeSupabaseAuth, probeSupabasePrivateStorage } from './readiness/upstream-probes.js';
import { EmailDataLossAlertSink } from './monitoring/email-data-loss-alert-sink.js';
import { ResendEmailProvider } from './engagement/resend-email-provider.js';
import type { BinderExportService } from './binder-export-service.js';
import type { EvidenceExportService } from './evidence-export-service.js';

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
    'medication:create',
    'medication:read',
    'medication:update',
    'caregiver:update',
    'workspace:read',
    'workspace:update',
    // Restoring an archived version is separable from saving on purpose. It is
    // the one write that deliberately replaces current data with older data,
    // so the account owner holds it and a manager does not.
    'workspace:restore',
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
    'medication:create',
    'medication:read',
    'medication:update',
    'caregiver:update',
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
    'medication:read',
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
    'medication:read',
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
  /**
   * Reviewed regulation content lifecycle (migration 0032). Its
   * `listActiveForContext` is the only query allowed to feed assistant/wizard
   * rule context — active + effective-dated content only.
   */
  regulationRules: RegulationRuleService;
  /**
   * Append-only record that a user accepted the terms of service and the
   * privacy policy (migration 0043). Replaces the billing screen's `useState`
   * consent checkbox, which recorded nothing.
   */
  termsAcceptances: TermsAcceptanceStore;
  openCase: OpenEmploymentCase;
  getCase: GetEmploymentCase;
  listCases: ListEmploymentCases;
  addContact: AddContactToCase;
  listContacts: ListCaseContacts;
  createTask: CreateCaseTask;
  completeTask: CompleteCaseTask;
  updateTask: UpdateCaseTask;
  archiveTask: ArchiveCaseTask;
  /** Idempotent create for the UI cutover — see ImportCaseTask. */
  importTask: ImportCaseTask;
  listTasks: ListCaseTasks;
  listTimeline: ListCaseTimeline;
  uploadDocument: UploadCaseDocument;
  /** Idempotent create for the UI cutover — see ImportCaseDocument. */
  importDocument: ImportCaseDocument;
  listDocuments: ListCaseDocuments;
  getDocumentDownloadUrl: GetDocumentDownloadUrl;
  /** The one genuinely new server-side domain in this round — see migration 0046. */
  createMedication: CreateMedication;
  listMedications: ListMedications;
  updateMedication: UpdateMedication;
  archiveMedication: ArchiveMedication;
  importMedication: ImportMedication;
  /** Corrects caregiver identity fields after intake — see UpdateCaregiverProfileUseCase. */
  updateCaregiver: UpdateCaregiverProfileUseCase;
  getWorkspace: GetWorkspace;
  saveWorkspace: SaveWorkspace;
  /** Read side of the 0035 archive: which versions exist, in metadata only. */
  listWorkspaceVersions: ListWorkspaceVersions;
  /** Per-tenant restore (DR-02), as an audited server-side operation. */
  restoreWorkspaceVersion: RestoreWorkspaceVersion;
  /** The nightly detector (DR-03). Runs from the scheduler, has no actor. */
  scanForSilentDataLoss: ScanForSilentDataLoss;
  /**
   * Also raised synchronously when the shrink guard refuses a save. The guard
   * has always refused correctly and always refused silently: a customer's
   * client attempting to erase their account is exactly the event worth being
   * told about, and waiting for the nightly scan would miss it entirely,
   * because the write it describes never landed.
   */
  dataLossAlerts: DataLossAlertSink;
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
  /**
   * Optional service overrides consumed by create-server.ts route
   * registration — tests inject deterministic in-memory implementations
   * (e.g. a fixed role resolver) before calling buildServer.
   */
  binderExportService?: BinderExportService;
  evidenceExportService?: EvidenceExportService;
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
  let medicationRepository: MedicationRepository;
  let timeline: TimelineService;
  let timelineRepository: TimelineRepository;
  let audit: AuditService;
  let workspaceRepository: WorkspaceRepository;
  let workspaceHistoryRepository: WorkspaceHistoryRepository;
  let workspaceFileRepository: WorkspaceFileRepository;
  let censusRepository: TenantCensusRepository;
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
    medicationRepository = new PgMedicationRepository(pool);
    const pgTimeline = new PgTimelineService(pool);
    timeline = pgTimeline;
    timelineRepository = pgTimeline;
    // Constitution §19: audit must survive a process restart, so it goes to
    // Postgres whenever a database is configured.
    audit = new PgAuditService(pool);
    // One list, built once: the three readers of the workspace envelope must
    // agree on which keys exist, or a rotation half-lands and the census starts
    // reporting unreadable rows that the repository can open perfectly well.
    const encryptionKeys = workspaceEncryptionKeys(env);
    workspaceRepository = new PgWorkspaceRepository(pool, encryptionKeys);
    workspaceHistoryRepository = new PgWorkspaceHistoryRepository(pool, encryptionKeys);
    workspaceFileRepository = new PgWorkspaceFileRepository(pool);
    censusRepository = new PgTenantCensusRepository(pool, encryptionKeys);
    familyMembershipRepository = new PgFamilyMembershipRepository(pool);
    billingRepository = new PgBillingRepository(pool);
  } else {
    repository = new InMemoryCaseFoundationRepository();
    contactRepository = new InMemoryCaseContactRepository();
    taskRepository = new InMemoryTaskRepository();
    documentRepository = new InMemoryDocumentRepository();
    medicationRepository = new InMemoryMedicationRepository();
    const memoryTimeline = new InMemoryTimelineService();
    timeline = memoryTimeline;
    timelineRepository = new InMemoryTimelineRepository(memoryTimeline);
    audit = new InMemoryAuditService();
    workspaceRepository = new InMemoryWorkspaceRepository();
    workspaceHistoryRepository = new InMemoryWorkspaceHistoryRepository();
    workspaceFileRepository = new InMemoryWorkspaceFileRepository();
    censusRepository = new InMemoryTenantCensusRepository();
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

  const invitationRedirect = resolveInvitationRedirect({
    familyInviteRedirectUrl: env.FAMILY_INVITE_REDIRECT_URL,
    corsOrigins: env.CORS_ORIGINS,
    nodeEnv: env.NODE_ENV,
  });
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

  const caseDeps = {
    authorization,
    repository,
    audit,
    timeline,
    clock,
    ids,
    // OpenEmploymentCase seeds compliance tasks (missing passport/visa/
    // medical insurance) right after creating the case — see
    // packages/application/src/use-cases/open-employment-case.ts.
    tasks: taskRepository,
  };
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
  const medicationDeps = {
    authorization,
    medications: medicationRepository,
    audit,
    timeline,
    clock,
    ids,
  };
  const caregiverDeps = { authorization, repository, audit, clock };
  const workspaceDeps = { authorization, workspaces: workspaceRepository, audit, clock };
  // The destination the port was written for. `DataLossAlertSink` names email
  // to the named production operator as step (1) of closing this gap: the pilot
  // has one customer and one operator, so a mailbox is a sufficient pager.
  //
  // The email sink writes the same structured log line first and always, so the
  // durable record does not depend on Resend being up. Without a configured
  // destination the behaviour is exactly what it was — a log line and nothing
  // else — and `/ready` says so rather than pretending the detector is wired.
  const dataLossAlerts: DataLossAlertSink =
    env.DATA_LOSS_ALERT_EMAIL && env.RESEND_API_KEY && env.SUPPORT_FROM_EMAIL
      ? new EmailDataLossAlertSink(
          new ResendEmailProvider({
            apiKey: env.RESEND_API_KEY,
            fromEmail: env.SUPPORT_FROM_EMAIL,
          }),
          env.DATA_LOSS_ALERT_EMAIL,
        )
      : new LoggingDataLossAlertSink();
  const workspaceRestoreDeps = {
    ...workspaceDeps,
    history: workspaceHistoryRepository,
  };
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
  // Instantiated once so the regulation service's in-memory role resolution
  // goes through the very same authenticated read the Family Access page (and
  // its tests) use — a test that makes this instance answer "viewer" makes
  // every regulation mutation fail closed with 403.
  const listFamilyMembersUseCase = new ListFamilyMembers(familyAccessDeps);
  const regulationRules: RegulationRuleService = pool
    ? new PgRegulationRuleService(pool)
    : new InMemoryRegulationRuleService({
        audit,
        resolveRole: async (actor) => {
          const access = await listFamilyMembersUseCase.execute(actor).catch(() => null);
          return access?.members.find((member) => member.isCurrentUser)?.role ?? null;
        },
      });

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
    regulationRules,
    termsAcceptances: pool ? new PgTermsAcceptanceStore(pool) : new InMemoryTermsAcceptanceStore(),
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
    updateTask: new UpdateCaseTask(taskDeps),
    archiveTask: new ArchiveCaseTask(taskDeps),
    importTask: new ImportCaseTask(taskDeps),
    listTasks: new ListCaseTasks(taskDeps),
    listTimeline: new ListCaseTimeline({
      authorization,
      timeline: timelineRepository,
      audit,
      clock,
    }),
    uploadDocument: new UploadCaseDocument(documentDeps),
    importDocument: new ImportCaseDocument(documentDeps),
    listDocuments: new ListCaseDocuments(documentDeps),
    getDocumentDownloadUrl: new GetDocumentDownloadUrl(documentDeps),
    createMedication: new CreateMedication(medicationDeps),
    listMedications: new ListMedications(medicationDeps),
    updateMedication: new UpdateMedication(medicationDeps),
    archiveMedication: new ArchiveMedication(medicationDeps),
    importMedication: new ImportMedication(medicationDeps),
    updateCaregiver: new UpdateCaregiverProfileUseCase(caregiverDeps),
    getWorkspace: new GetWorkspace(workspaceDeps),
    saveWorkspace: new SaveWorkspace(workspaceDeps),
    listWorkspaceVersions: new ListWorkspaceVersions(workspaceRestoreDeps),
    restoreWorkspaceVersion: new RestoreWorkspaceVersion(workspaceRestoreDeps),
    dataLossAlerts,
    scanForSilentDataLoss: new ScanForSilentDataLoss({
      census: censusRepository,
      alerts: dataLossAlerts,
      audit,
      clock,
      ids,
    }),
    putWorkspaceFile: new PutWorkspaceFile(workspaceFileDeps),
    getWorkspaceFileUrl: new GetWorkspaceFileUrl(workspaceFileDeps),
    deleteWorkspaceFile: new DeleteWorkspaceFile(workspaceFileDeps),
    listFamilyMembers: listFamilyMembersUseCase,
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
      // The daily scan can detect a loss; without a destination it can only
      // write a line nobody is subscribed to. In production that is a gap in
      // the control, not a preference, so `/ready` names it. It is a reason
      // rather than a check because the endpoint reports dependencies, and the
      // missing piece here is configuration, not an unreachable service.
      if (!env.DATA_LOSS_ALERT_EMAIL)
        reasons.push(
          'DATA_LOSS_ALERT_EMAIL is not configured; a suspected data loss would be logged and nobody told',
        );

      // R0-08. Until now these two checks ended here, at "the variable is set".
      // That is why `authentication` reported `ok` for the whole of the
      // 2026-08-31 outage. Both dependencies are now asked whether they answer
      // and whether they accept the credential — the same standard `database`
      // has always been held to. See readiness/upstream-probes.ts for why these
      // endpoints and why the probe does not fail open.
      //
      // The two run concurrently: they are independent, and `/ready` should
      // cost one timeout, not two.
      const [authProbe, storageProbe] = await Promise.all([
        hasSupabaseAuth
          ? probeSupabaseAuth({
              supabaseUrl: env.SUPABASE_URL!,
              publishableKey: env.SUPABASE_PUBLISHABLE_KEY!,
            })
          : Promise.resolve(null),
        hasPrivateStorage
          ? probeSupabasePrivateStorage({
              supabaseUrl: env.SUPABASE_URL!,
              serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY!,
              bucket: env.SUPABASE_STORAGE_BUCKET!,
            })
          : Promise.resolve(null),
      ]);
      if (authProbe && !authProbe.reachable) {
        reasons.push(`Supabase authentication is unreachable (${authProbe.detail})`);
        checks.authentication = 'unreachable';
      }
      if (storageProbe && !storageProbe.reachable) {
        // Named by bucket, because the operator's next action differs: a 404 is
        // a bucket to recreate or rename, a 401/403 is a key to rotate.
        reasons.push(
          `Private document storage is unreachable ` +
            `(bucket ${env.SUPABASE_STORAGE_BUCKET}: ${storageProbe.detail})`,
        );
        checks.privateStorage = 'unreachable';
      }
      if (pool) {
        try {
          // Two questions, deliberately kept separate. The object probes below
          // ask "does the pilot schema exist at all"; the ledger comparison
          // that follows asks "is this database as new as the code". The
          // object list is frozen at migration 0021 and is not extended: it
          // was the only check for a year, and it reported ready: true on a
          // database fourteen migrations behind the deployed API (REL-05).
          // db-path-exception: /ready is a control-plane probe, not a tenant
          // request. It asks whether schema objects exist; to_regclass and
          // to_regprocedure read catalogue metadata that carries no tenant_id
          // and is not subject to RLS. Wrapping it in withTenant() would need a
          // tenant id the probe does not have and must not invent. (Root 6)
          const result = await pool.query<{
            actor_resolver: string | null;
            workspace_table: string | null;
            workspace_file_table: string | null;
            family_members_function: string | null;
            billing_table: string | null;
            workflow_table: string | null;
            ledger_table: string | null;
          }>(
            `select
               to_regprocedure('public.resolve_caredesk_actor(text)')::text as actor_resolver,
               to_regclass('public.tenant_workspace')::text as workspace_table,
               to_regclass('public.workspace_file')::text as workspace_file_table,
               to_regprocedure('public.list_caredesk_family_members(uuid)')::text as family_members_function,
               to_regclass('public.product_subscription')::text as billing_table,
               to_regclass('public.workflow_instance')::text as workflow_table,
               to_regclass('public.schema_migrations')::text as ledger_table`,
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

          if (!row?.ledger_table) {
            reasons.push('schema_migrations does not exist; no migration has ever been recorded');
            checks.database = 'migration-required';
          } else {
            // db-path-exception: schema_migrations is the migration ledger. It
            // has no tenant_id and belongs to the deployment, not to a customer;
            // /ready compares it against REQUIRED_MIGRATIONS. (Root 6)
            // Schema-qualified, and it has to be. Supabase ships its own
            // `schema_migrations` in the `auth` and `realtime` schemas, so an
            // unqualified name resolves by search_path and can land on one of
            // theirs. It did: after the SELECT grant was added, `/ready`
            // reported "44 of 44 migrations are not recorded" against a ledger
            // that holds every one of them. Reading an empty table that happens
            // to share a name is worse than being denied - a denial is at least
            // an error, while this looked like a database forty-four migrations
            // behind the code.
            const ledger = await pool.query<{ version: string }>(
              'select version from public.schema_migrations',
            );
            const missing = missingMigrations(ledger.rows.map((entry) => entry.version));
            if (missing.length > 0) {
              // Named, not counted: the oldest missing version is the one the
              // operator has to act on, and a bare count is what let a hand-
              // applied migration go unnoticed in the first place.
              reasons.push(
                `Database is behind the code: ${missing.length} of ${REQUIRED_MIGRATIONS.length} ` +
                  `migration(s) are not recorded in schema_migrations, starting at ${missing[0]}`,
              );
              checks.database = 'migration-required';
            }
          }
        } catch (error) {
          // Name the failure. This catch used to swallow everything and report
          // the same four words for a wrong password, a blocked port, a
          // missing grant and a genuine outage. On 2026-08-31 that cost most of
          // a working day: production was down, `/ready` said only
          // "unreachable", and the cause (the pooler rejecting a role on one
          // port and accepting it on another) had to be found by writing a
          // throwaway probe and running it by hand on a laptop.
          //
          // The code is what distinguishes them - 28P01 is a password, 42501 a
          // grant, ECONNREFUSED/ETIMEDOUT the network - so the code is what
          // this endpoint must say. The message is included because Postgres
          // phrases the useful half there, and neither field carries the
          // connection string: node-postgres builds these from the server's
          // error response, and the driver's own network errors carry a host
          // and port, never the password.
          const detail =
            error instanceof Error
              ? `${(error as { code?: string }).code ?? error.name}: ${error.message}`
              : String(error);
          reasons.push(`Database is unreachable (${detail})`);
          checks.database = 'unreachable';
        }
      }
      return { ready: reasons.length === 0, reasons, checks };
    },
  };
}
