/* eslint-disable no-restricted-syntax -- canonical E2E fixture uses approved Hebrew product copy */
import type { Page, Route } from '@playwright/test';

/**
 * Wave 5 browser-only fixtures for Family Collaboration and the Worker
 * Portal. State lives in these server-side fixture closures, never in
 * browser storage, so reloads and idempotent replays exercise the same
 * semantics as PostgreSQL (the canonical-product-intelligence pattern).
 */

const API = 'http://127.0.0.1:4000';

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

export interface FamilyMemberRecord {
  membershipId: string;
  displayName: string;
  email: string;
  role: 'owner' | 'manager' | 'viewer';
  status: 'invited' | 'active';
  invitedAt: string;
  lastAuthenticatedAt: string | null;
  isCurrentUser: boolean;
}

export type InvitationMode = 'ok' | 'duplicate' | 'delivery' | 'forbidden';

/** Authenticated /family boundary: list, invite, role change and revocation. */
export async function installFamilyAccessApi(page: Page) {
  const members: FamilyMemberRecord[] = [
    {
      membershipId: 'membership-owner',
      displayName: 'בעל החשבון לבדיקה',
      email: 'owner@example.test',
      role: 'owner',
      status: 'active',
      invitedAt: '2026-01-01T08:00:00.000Z',
      lastAuthenticatedAt: '2026-08-15T09:00:00.000Z',
      isCurrentUser: true,
    },
    {
      membershipId: 'membership-sibling',
      displayName: 'אח מנהל לבדיקה',
      email: 'sibling@example.test',
      role: 'manager',
      status: 'active',
      invitedAt: '2026-02-01T08:00:00.000Z',
      lastAuthenticatedAt: '2026-08-10T08:30:00.000Z',
      isCurrentUser: false,
    },
  ];
  const state = { canManage: true, invitationMode: 'ok' as InvitationMode, invitations: 0 };

  await page.route(`${API}/family/members`, (route) => {
    if (route.request().method() !== 'GET') return json(route, { code: 'METHOD_NOT_ALLOWED' }, 405);
    return json(route, { members, canManage: state.canManage });
  });

  await page.route(`${API}/family/invitations`, (route) => {
    if (route.request().method() !== 'POST')
      return json(route, { code: 'METHOD_NOT_ALLOWED' }, 405);
    if (state.invitationMode === 'forbidden') return json(route, { code: 'FORBIDDEN' }, 403);
    if (state.invitationMode === 'duplicate')
      return json(route, { code: 'FAMILY_MEMBER_EXISTS' }, 409);
    if (state.invitationMode === 'delivery')
      return json(route, { code: 'INVITATION_DELIVERY_FAILED' }, 502);
    const input = route.request().postDataJSON() as {
      displayName: string;
      email: string;
      role: 'manager' | 'viewer';
    };
    state.invitations += 1;
    const invited: FamilyMemberRecord = {
      membershipId: `membership-invited-${state.invitations}`,
      displayName: input.displayName,
      email: input.email,
      role: input.role,
      status: 'invited',
      invitedAt: '2026-08-19T10:00:00.000Z',
      lastAuthenticatedAt: null,
      isCurrentUser: false,
    };
    members.push(invited);
    return json(route, invited, 201);
  });

  await page.route(new RegExp(`^${API}/family/members/[^/]+$`), (route) => {
    const membershipId = route.request().url().split('/').at(-1)!;
    const member = members.find((candidate) => candidate.membershipId === membershipId);
    if (!member) return json(route, { code: 'NOT_FOUND' }, 404);
    if (route.request().method() === 'PATCH') {
      const input = route.request().postDataJSON() as { role: 'manager' | 'viewer' };
      member.role = input.role;
      return json(route, member);
    }
    if (route.request().method() === 'DELETE') {
      members.splice(members.indexOf(member), 1);
      return route.fulfill({ status: 204, body: '' });
    }
    return json(route, { code: 'METHOD_NOT_ALLOWED' }, 405);
  });

  return {
    state,
    members: () => [...members],
  };
}

interface CollaborationMember {
  id: string;
  display_name: string;
  role: string;
  status: string;
}
interface CollaborationRequest {
  id: string;
  request_type: string;
  message: string;
  status: string;
  assigned_membership_id: string | null;
}

/** Authenticated employer case boundary with the collaboration aggregate. */
export async function installCaseCollaborationApi(page: Page, caseId = 'case-1') {
  const members: CollaborationMember[] = [
    { id: 'membership-1', display_name: 'אח מנהל לבדיקה', role: 'manager', status: 'active' },
    { id: 'membership-2', display_name: 'אחות צופה לבדיקה', role: 'viewer', status: 'active' },
  ];
  const responsibilities = new Map<string, string>();
  const tasks = [
    {
      id: 'collab-task-1',
      title: 'חידוש ביטוח רפואי',
      assignee_membership_id: null as string | null,
    },
  ];
  const requests: CollaborationRequest[] = [
    {
      id: 'request-vacation-1',
      request_type: 'vacation',
      message: 'בקשת חופשה סינתטית לבדיקה',
      status: 'submitted',
      assigned_membership_id: null,
    },
    {
      id: 'request-general-1',
      request_type: 'general',
      message: 'בקשה כללית סינתטית לבדיקה',
      status: 'submitted',
      assigned_membership_id: null,
    },
  ];
  const idempotencyKeys: string[] = [];
  const state = { forbidden: false };

  await page.route(`${API}/cases/${caseId}`, (route) =>
    json(route, {
      id: caseId,
      status: 'active',
      startDate: '2026-01-01',
      endDate: null,
      careRecipient: {
        id: 'recipient-1',
        fullName: 'בדיקת מקבל שירות',
        careLevel: null,
        city: null,
      },
      employer: {
        id: 'employer-1',
        fullName: 'בדיקת מעסיק',
        relationshipToRecipient: 'משפחה',
        city: null,
      },
      caregiver: {
        id: 'caregiver-1',
        legalName: 'Test Caregiver',
        preferredName: null,
        nationality: 'Testland',
        primaryLanguage: null,
      },
    }),
  );
  await page.route(
    new RegExp(`^${API}/cases/${caseId}/(tasks|documents|contacts|timeline|visa-renewals)$`),
    (route) => json(route, []),
  );

  await page.route(`${API}/cases/${caseId}/collaboration`, (route) => {
    if (state.forbidden) return json(route, { code: 'FORBIDDEN' }, 403);
    return json(route, { members, responsibilities: mapResponsibilities(), tasks, requests });
  });

  const mapResponsibilities = () =>
    [...responsibilities.entries()].map(([responsibility, assignee]) => ({
      responsibility,
      assignee_membership_id: assignee,
    }));

  await page.route(new RegExp(`^${API}/cases/${caseId}/responsibilities/[^/]+$`), (route) => {
    if (route.request().method() !== 'PUT') return json(route, { code: 'METHOD_NOT_ALLOWED' }, 405);
    const kind = route.request().url().split('/').at(-1)!;
    const key = route.request().headers()['idempotency-key'];
    if (key) idempotencyKeys.push(key);
    const input = route.request().postDataJSON() as { assigneeMembershipId: string | null };
    if (input.assigneeMembershipId === null) responsibilities.delete(kind);
    else responsibilities.set(kind, input.assigneeMembershipId);
    return json(route, {
      responsibility: kind,
      assignee_membership_id: input.assigneeMembershipId,
    });
  });

  await page.route(new RegExp(`^${API}/cases/${caseId}/tasks/[^/]+/assignee$`), (route) => {
    if (route.request().method() !== 'PUT') return json(route, { code: 'METHOD_NOT_ALLOWED' }, 405);
    const taskId = route.request().url().split('/').at(-2)!;
    const key = route.request().headers()['idempotency-key'];
    if (key) idempotencyKeys.push(key);
    const task = tasks.find((candidate) => candidate.id === taskId);
    if (!task) return json(route, { code: 'NOT_FOUND' }, 404);
    const input = route.request().postDataJSON() as { assigneeMembershipId: string | null };
    task.assignee_membership_id = input.assigneeMembershipId;
    return json(route, task);
  });

  await page.route(new RegExp(`^${API}/worker-requests/[^/]+$`), (route) => {
    if (route.request().method() !== 'PATCH')
      return json(route, { code: 'METHOD_NOT_ALLOWED' }, 405);
    const requestId = route.request().url().split('/').at(-1)!;
    const key = route.request().headers()['idempotency-key'];
    if (key) idempotencyKeys.push(key);
    const target = requests.find((candidate) => candidate.id === requestId);
    if (!target) return json(route, { code: 'NOT_FOUND' }, 404);
    const input = route.request().postDataJSON() as { status: string };
    target.status = input.status;
    return json(route, target);
  });

  return {
    state,
    idempotencyKeys: () => [...idempotencyKeys],
    responsibilities: () => mapResponsibilities(),
    tasks: () => tasks.map((task) => ({ ...task })),
    requests: () => requests.map((request) => ({ ...request })),
  };
}

interface WorkerPayment {
  closeId: string;
  month: string;
  amountPaid: number | null;
  paymentDate: string;
  acknowledgement: 'pending' | 'acknowledged';
  acknowledgedAt?: string;
}
interface WorkerRequest {
  id: string;
  request_type: string;
  message: string;
  status: string;
}

/** Worker-safe /worker boundary: projection, requests, documents, preferences. */
export async function installWorkerPortalApi(page: Page) {
  const payments: WorkerPayment[] = [
    {
      closeId: 'close-2026-07',
      month: '2026-07',
      amountPaid: null,
      paymentDate: '2026-08-09',
      acknowledgement: 'pending',
    },
  ];
  const requests: WorkerRequest[] = [];
  // Only the explicitly shared document crosses the projection; the withheld
  // one must never appear in any worker payload.
  const sharedDocuments = [{ id: 'document-shared-1', document_type: 'work_permit' }];
  const withheldDocumentId = 'document-private-1';
  const leave = { availableBalance: null as number | null, used: 2, planned: 3 };
  const idempotencyKeys: string[] = [];
  const state = { forbidden: false, requestCount: 0, preferenceSaves: 0 };

  await page.route(`${API}/worker/portal`, (route) => {
    if (state.forbidden) return json(route, { code: 'FORBIDDEN' }, 403);
    return json(route, { payments, leave, requests, documents: sharedDocuments });
  });

  await page.route(new RegExp(`^${API}/worker/payments/[^/]+/acknowledgements$`), (route) => {
    const closeId = route.request().url().split('/').at(-2)!;
    const payment = payments.find((candidate) => candidate.closeId === closeId);
    if (!payment) return json(route, { code: 'NOT_FOUND' }, 404);
    payment.acknowledgement = 'acknowledged';
    payment.acknowledgedAt = '2026-08-19';
    return json(route, { acknowledged_at: '2026-08-19T10:00:00.000Z' }, 201);
  });

  await page.route(`${API}/worker/requests`, (route) => {
    if (route.request().method() !== 'POST')
      return json(route, { code: 'METHOD_NOT_ALLOWED' }, 405);
    const key = route.request().headers()['idempotency-key'];
    if (!key) return json(route, { code: 'IDEMPOTENCY_KEY_REQUIRED' }, 400);
    idempotencyKeys.push(key);
    const input = route.request().postDataJSON() as { type: string; message: string };
    state.requestCount += 1;
    const created: WorkerRequest = {
      id: `worker-request-${state.requestCount}`,
      request_type: input.type,
      message: input.message,
      status: 'submitted',
    };
    requests.unshift(created);
    return json(route, created, 201);
  });

  await page.route(new RegExp(`^${API}/worker/documents/[^/]+/download$`), (route) => {
    const documentId = route.request().url().split('/').at(-2)!;
    if (documentId === withheldDocumentId) return json(route, { code: 'NOT_FOUND' }, 404);
    if (!sharedDocuments.some((candidate) => candidate.id === documentId))
      return json(route, { code: 'NOT_FOUND' }, 404);
    // A hash-only target keeps the SPA alive while proving the signed hand-off.
    return json(route, { url: `/worker#signed-${documentId}` });
  });

  await page.route(`${API}/worker/preferences`, (route) => {
    if (route.request().method() !== 'PUT') return json(route, { code: 'METHOD_NOT_ALLOWED' }, 405);
    const key = route.request().headers()['idempotency-key'];
    if (!key) return json(route, { code: 'IDEMPOTENCY_KEY_REQUIRED' }, 400);
    idempotencyKeys.push(key);
    state.preferenceSaves += 1;
    return json(route, route.request().postDataJSON());
  });

  return {
    state,
    withheldDocumentId,
    idempotencyKeys: () => [...idempotencyKeys],
    requests: () => requests.map((request) => ({ ...request })),
    payments: () => payments.map((payment) => ({ ...payment })),
  };
}
