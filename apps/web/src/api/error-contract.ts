/**
 * H1 (work plan 16.10.2026) - what the person on the screen is told when the
 * API refuses a request, and whether trying again can help.
 *
 * Every apps/api error has the same shape: an HTTP status plus a stable `code`
 * (packages/schemas/src/api-error.ts). The `message` is deliberately generic
 * ("Unable to complete the request") so nothing internal leaks, which means
 * the code is the only thing the client can turn into words. Until now each
 * screen did that by hand, a few codes at a time, and the rest fell through to
 * whatever the screen's own catch-all said - or to nothing, which is how a
 * failed save goes unseen (CLAUDE.md §2).
 *
 * This table is the one place that does it. `describeApiError(error)` takes
 * whatever a request threw and returns:
 *   - messageKey: an `errors.api.*` key in packages/i18n (he.json, en.json);
 *   - retryable:  true only when sending the SAME request again, unchanged,
 *                 can succeed without the person doing anything else first
 *                 (a timeout, a rate limit, a provider outage). A conflict,
 *                 a validation error or a closed month is not retryable: a
 *                 "try again" button there repeats the failure.
 *
 * Lookup order: the exact (code, status) row, then the code with any status
 * (some routes vary the status for one code), then the status class, then a
 * generic message. A thrown value that is not an API error at all - fetch
 * rejects with a TypeError when the network is down - is `network`.
 *
 * Adoption: apps/web/src/api/client.ts belongs to Team 1 in the 16.10.2026
 * work plan, so this file does not change it. `ApiRequestError` already
 * carries `status` and `code`, so a screen (or client.ts) can adopt this by
 * passing the caught error straight to `describeApiError`.
 * error-contract.test.ts keeps the table complete: every literal
 * (status, code) the API sends must have its own row here.
 */

export type ApiErrorMessageKey =
  | 'errors.api.network'
  | 'errors.api.sessionExpired'
  | 'errors.api.forbidden'
  | 'errors.api.managerRequired'
  | 'errors.api.mfaRequired'
  | 'errors.api.notFound'
  | 'errors.api.validation'
  | 'errors.api.badRequest'
  | 'errors.api.conflict'
  | 'errors.api.invalidState'
  | 'errors.api.inProgress'
  | 'errors.api.payrollMonthClosed'
  | 'errors.api.totalMismatch'
  | 'errors.api.workspaceShrinkRejected'
  | 'errors.api.workspaceRestoreNotConfirmed'
  | 'errors.api.reviewerRequired'
  | 'errors.api.documentNotInCase'
  | 'errors.api.ruleExists'
  | 'errors.api.familyMemberExists'
  | 'errors.api.invitationInvalid'
  | 'errors.api.accountFrozen'
  | 'errors.api.rateLimited'
  | 'errors.api.deliveryFailed'
  | 'errors.api.billingUnavailable'
  | 'errors.api.serviceUnavailable'
  | 'errors.api.server'
  | 'errors.api.generic';

export interface ApiErrorPresentation {
  messageKey: ApiErrorMessageKey;
  retryable: boolean;
}

interface ApiErrorContractRow extends ApiErrorPresentation {
  code: string;
  /** The status the API sends this code with; '*' when it varies by route. */
  status: number | '*';
}

const row = (
  code: string,
  status: number | '*',
  messageKey: ApiErrorMessageKey,
  retryable = false,
): ApiErrorContractRow => ({ code, status, messageKey, retryable });

/** Every (code, status) pair apps/api sends to a browser, as of 17.10.2026. */
export const API_ERROR_CONTRACT: readonly ApiErrorContractRow[] = [
  // 400
  row('VALIDATION_ERROR', 400, 'errors.api.validation'),
  row('IDEMPOTENCY_KEY_REQUIRED', 400, 'errors.api.badRequest'),
  row('MANIFEST_DOCUMENT_NOT_IN_CASE', 400, 'errors.api.documentNotInCase'),
  row('REVIEWER_REQUIRED', 400, 'errors.api.reviewerRequired'),
  row('WORKSPACE_RESTORE_NOT_CONFIRMED', 400, 'errors.api.workspaceRestoreNotConfirmed'),
  // 401 - also thrown by the client itself when it holds no session.
  row('UNAUTHENTICATED', 401, 'errors.api.sessionExpired'),
  // 402
  row('ACCOUNT_FROZEN', 402, 'errors.api.accountFrozen'),
  // 403 - FORBIDDEN is also sent with 404/409 by family-access.ts.
  row('FORBIDDEN', '*', 'errors.api.forbidden'),
  row('MANAGER_REQUIRED', 403, 'errors.api.managerRequired'),
  row('MFA_REQUIRED', 403, 'errors.api.mfaRequired'),
  // A server that has no authorization wiring: a deployment fault, not a refusal.
  row('AUTHORIZATION_NOT_CONFIGURED', 403, 'errors.api.server'),
  // 404 - NOT_FOUND is also sent with 409 by family-access.ts.
  row('NOT_FOUND', '*', 'errors.api.notFound'),
  row('WORKSPACE_VERSION_NOT_FOUND', 404, 'errors.api.notFound'),
  row('WORKFLOW_NOT_FOUND', 404, 'errors.api.notFound'),
  // 409
  row('VERSION_CONFLICT', 409, 'errors.api.conflict'),
  row('IDEMPOTENCY_CONFLICT', 409, 'errors.api.conflict'),
  row('IDEMPOTENCY_KEY_REUSED', 409, 'errors.api.conflict'),
  row('INVALID_TRANSITION', 409, 'errors.api.invalidState'),
  row('INVALID_STATE_TRANSITION', 409, 'errors.api.invalidState'),
  row('FAMILY_MEMBER_INVARIANT', 409, 'errors.api.invalidState'),
  row('COMMIT_IN_PROGRESS', 409, 'errors.api.inProgress', true),
  row('CONFIRMATION_IN_PROGRESS', 409, 'errors.api.inProgress', true),
  row('PAYROLL_MONTH_CLOSED', 409, 'errors.api.payrollMonthClosed'),
  row('PAYROLL_REFERENCE_NOT_FOUND', 409, 'errors.api.notFound'),
  row('PAYROLL_FINAL_REQUIRED', 409, 'errors.api.invalidState'),
  row('PAYROLL_CLOSE_CONFLICT', 409, 'errors.api.conflict'),
  row('PAYROLL_CARRY_SOURCE_REUSED', 409, 'errors.api.conflict'),
  row('PAYROLL_PAYMENT_EVENT_CONFLICT', 409, 'errors.api.conflict'),
  row('RULE_EXISTS', 409, 'errors.api.ruleExists'),
  row('FAMILY_MEMBER_EXISTS', 409, 'errors.api.familyMemberExists'),
  row('WORKSPACE_SHRINK_REJECTED', 409, 'errors.api.workspaceShrinkRejected'),
  // 410
  row('INVITATION_INVALID', 410, 'errors.api.invitationInvalid'),
  // 422
  row('TOTAL_MISMATCH', 422, 'errors.api.totalMismatch'),
  row('PAYROLL_CARRY_SOURCE_MISMATCH', 422, 'errors.api.validation'),
  // Selected dynamically by the policy guard, outside the literal-code scan.
  row('PAYROLL_POLICY_REQUIRED', 422, 'errors.api.invalidState'),
  row('EFFECTIVE_FROM_REQUIRED', 422, 'errors.api.validation'),
  row('PLAN_INVALID', 422, 'errors.api.validation'),
  row('RULE_UNVERIFIED', 422, 'errors.api.invalidState'),
  row('RACI_INVALID', 422, 'errors.api.validation'),
  row('COMPLETION_INVALID', 422, 'errors.api.invalidState'),
  // 428
  row('VERSION_REQUIRED', 428, 'errors.api.conflict'),
  // 429
  row('RATE_LIMITED', 429, 'errors.api.rateLimited', true),
  row('SUPPORT_RATE_LIMITED', 429, 'errors.api.rateLimited', true),
  // 5xx
  row('INTERNAL_ERROR', 500, 'errors.api.server', true),
  row('INVITATION_DELIVERY_FAILED', 502, 'errors.api.deliveryFailed', true),
  row('SUPPORT_DELIVERY_FAILED', 502, 'errors.api.deliveryFailed', true),
  row('BILLING_SETUP_FAILED', 502, 'errors.api.billingUnavailable', true),
  row('BILLING_PROVIDER_UNAVAILABLE', 503, 'errors.api.billingUnavailable', true),
  row('BILLING_COLLECTION_UNAVAILABLE', 503, 'errors.api.billingUnavailable', true),
  row('SUPPORT_NOT_CONFIGURED', 503, 'errors.api.serviceUnavailable'),
  row('DATA_INTEGRITY_SCAN_UNAVAILABLE', 503, 'errors.api.serviceUnavailable', true),
];

const byCodeAndStatus = new Map(API_ERROR_CONTRACT.map((r) => [`${r.code}|${r.status}`, r]));

function byStatusClass(status: number): ApiErrorPresentation {
  if (status === 401) return { messageKey: 'errors.api.sessionExpired', retryable: false };
  if (status === 403) return { messageKey: 'errors.api.forbidden', retryable: false };
  if (status === 404 || status === 410)
    return { messageKey: 'errors.api.notFound', retryable: false };
  if (status === 409 || status === 428)
    return { messageKey: 'errors.api.conflict', retryable: false };
  if (status === 400 || status === 422)
    return { messageKey: 'errors.api.validation', retryable: false };
  if (status === 429) return { messageKey: 'errors.api.rateLimited', retryable: true };
  if (status === 502 || status === 503 || status === 504)
    return { messageKey: 'errors.api.serviceUnavailable', retryable: true };
  if (status >= 500 && status < 600) return { messageKey: 'errors.api.server', retryable: true };
  return { messageKey: 'errors.api.generic', retryable: false };
}

function isApiErrorLike(error: unknown): error is { status: number; code: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { status?: unknown }).status === 'number' &&
    typeof (error as { code?: unknown }).code === 'string'
  );
}

/** What to tell the person, and whether a "try again" can help. */
export function describeApiError(error: unknown): ApiErrorPresentation {
  if (!isApiErrorLike(error)) {
    // fetch() rejects with a TypeError when the request never reached a server.
    return error instanceof TypeError
      ? { messageKey: 'errors.api.network', retryable: true }
      : { messageKey: 'errors.api.generic', retryable: false };
  }
  const found =
    byCodeAndStatus.get(`${error.code}|${error.status}`) ?? byCodeAndStatus.get(`${error.code}|*`);
  if (found) return { messageKey: found.messageKey, retryable: found.retryable };
  return byStatusClass(error.status);
}
