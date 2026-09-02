import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import type { Actor } from '@caredesk/application';
import type { Container } from '../container.js';
import type { Env } from '../env.js';
import { deriveBillingAccessState } from './access-state.js';
import { sendError } from '../routes/http-errors.js';

/**
 * Server-side enforcement of the billing freeze (Constitution §18: hiding a
 * control in the UI is never sufficient — authorization has to live here).
 *
 * Until now `accessState: 'frozen'` was computed only inside
 * `GET /billing/subscription`, and `AccountFrozenGate` on the client used it
 * to swap the whole screen. Nothing stopped a direct API call (curl, devtools,
 * a client with JavaScript disabled) from writing normally against a frozen
 * tenant — the freeze was a UI decoration, not a control. This hook is the
 * fix: it re-derives the same access state the billing route reports and
 * refuses writes for a frozen tenant regardless of which client makes them.
 *
 * Design decisions, made deliberately rather than by default:
 *
 * 1. Global `preHandler` hook, registered once in create-server.ts, rather
 *    than sprinkling a check into every route file. A hook a developer has to
 *    remember to add to each new route is a hook that will eventually be
 *    forgotten on one of them; a hook the server applies to everything by
 *    default and a short exemption list is the fail-closed shape.
 *
 * 2. Reads survive a freeze; only writes are refused. A frozen family's
 *    caregiver documents, timeline and case history must stay reachable —
 *    trapping a family's own records behind a billing failure is worse than
 *    the freeze itself. `GET`/`HEAD` (and `OPTIONS`, for CORS preflight) pass
 *    through unconditionally; `POST`/`PUT`/`PATCH`/`DELETE` are refused.
 *
 * 3. The emergency binder (`/cases/:caseId/binder-exports`) is exempted
 *    entirely, including its POST — creating a fresh export is exactly the
 *    "might need it for a hospital tonight" action a frozen family cannot be
 *    made to wait on. See EXEMPT_PREFIXES below.
 *
 * 4. Billing routes themselves, health/readiness, and the cron endpoints are
 *    exempt: a frozen tenant must still be able to add a card and cancel, the
 *    load balancer must still see a healthy process, and the scheduler
 *    authenticates with `CRON_SECRET`, not a user session, so it never has an
 *    `actor` for this hook to act on anyway.
 *
 * 5. Cost: this hook does NOT call the database on every request. Fastify
 *    runs instance-level (global) `preHandler` hooks *before* a route's own
 *    `preHandler` option (see node_modules/fastify/docs/Reference/Hooks.md,
 *    "Route level hooks" — route hooks "are always executed as the last hook
 *    in their category"), so this hook cannot rely on `request.actor` already
 *    being set by the route's own `authenticate` preHandler — it has to
 *    resolve the actor itself, the same way `makeAuthenticate` does. What it
 *    does avoid is the DB round trip `GetProductSubscription` performs
 *    (`billing.getOrCreate`, a write-capable upsert) on every single
 *    authenticated request: the derived access state is cached per tenant for
 *    a few seconds (ACCESS_STATE_CACHE_TTL_MS). A tenant that has just been
 *    unfrozen (added a card) may see one extra refusal for up to that window;
 *    a tenant that is not frozen pays no extra query at all beyond the first
 *    request in the window. Auth verification itself (`auth.verifySession` /
 *    `actorResolver.resolveActor`) is not cached here — it duplicates the
 *    work the route's own `authenticate` preHandler does immediately
 *    afterwards, which is the accepted cost of not being able to edit that
 *    shared preHandler from this change's file allowlist. If resolution
 *    fails, this hook does nothing and leaves the 401 to the route's own
 *    `authenticate` — duplicating that response shape/log fields here would
 *    just be a second, potentially divergent, copy of it.
 *
 * 6. Fail open on ambiguity, exactly like `deriveBillingAccessState` and
 *    `AccountFrozenGate` already do: if the subscription cannot be read (a
 *    transient DB error, an authorization edge case), the request is allowed
 *    through rather than refused. A control that can accidentally lock every
 *    tenant out of writing during a database blip is a worse failure mode
 *    than the gap it closes.
 */

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Path prefixes/patterns this guard never applies to. Matched against the
 * *route pattern* (`request.routeOptions.url`, e.g. `/cases/:caseId/binder-
 * exports`), not the raw URL, so a param value can never accidentally widen
 * or narrow the exemption.
 */
const EXEMPT_ROUTE_PATTERNS: RegExp[] = [
  /^\/health$/,
  /^\/ready$/,
  // Billing itself: a frozen tenant must be able to add a card, see their
  // plan, and cancel. The Cardcom webhook and the collection cron also live
  // here and carry no user session at all.
  /^\/billing(\/|$)/,
  // Scheduler-only endpoints, authenticated by CRON_SECRET, never by a user
  // bearer token — see cron-auth.ts.
  /^\/internal\/jobs(\/|$)/,
  // Placeholder deny-by-default probe: always refused on its own terms.
  /^\/protected\/ping$/,
  // Emergency binder exports (Blocker 3): must keep working while frozen,
  // including creating a fresh export, not just listing past ones.
  /^\/cases\/[^/]+\/binder-exports$/,
];

function isExemptRoute(routePattern: string | undefined): boolean {
  if (!routePattern) return false;
  return EXEMPT_ROUTE_PATTERNS.some((pattern) => pattern.test(routePattern));
}

interface CacheEntry {
  frozen: boolean;
  expiresAt: number;
}

/** How long a tenant's derived access state is trusted before re-checking. */
const ACCESS_STATE_CACHE_TTL_MS = 15_000;

/**
 * Tiny per-tenant TTL cache so a burst of authenticated requests from one
 * tenant costs at most one `billing.getOrCreate` call per window, not one per
 * request. Deliberately process-local (no cross-instance invalidation): the
 * worst case of a stale entry is a few extra seconds of either "still
 * frozen" or "still active" being reported, which is exactly the same
 * imprecision the grace-window date math already accepts.
 */
class AccessStateCache {
  private readonly entries = new Map<string, CacheEntry>();

  get(tenantId: string, now: number): boolean | undefined {
    const entry = this.entries.get(tenantId);
    if (!entry || entry.expiresAt <= now) return undefined;
    return entry.frozen;
  }

  set(tenantId: string, frozen: boolean, now: number): void {
    this.entries.set(tenantId, { frozen, expiresAt: now + ACCESS_STATE_CACHE_TTL_MS });
  }

  /** Test-only: forces the next lookup to miss. */
  clear(): void {
    this.entries.clear();
  }
}

export interface AccountFreezeGuard {
  preHandler: preHandlerHookHandler;
  /** Test-only: forces the next request to re-check the subscription. */
  clearCache(): void;
}

async function resolveActor(request: FastifyRequest, container: Container): Promise<Actor | null> {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  const session = await container.auth.verifySession(header.slice('Bearer '.length));
  if (!session) return null;
  const actor = await container.actorResolver.resolveActor(session);
  if (!actor) return null;
  return { ...actor, correlationId: request.correlationId, mfaSatisfied: session.mfaSatisfied };
}

async function isFrozen(
  actor: Actor,
  container: Container,
  env: Env,
  cache: AccessStateCache,
  now: number,
): Promise<boolean> {
  const cached = cache.get(actor.tenantId, now);
  if (cached !== undefined) return cached;

  const plan = await container.getProductSubscription.execute(actor);
  const { accessState } = deriveBillingAccessState(plan, env.BILLING_GRACE_DAYS, new Date(now));
  const frozen = accessState === 'frozen';
  cache.set(actor.tenantId, frozen, now);
  return frozen;
}

/**
 * Builds the guard. `sendFrozenError` is factored out only so the route test
 * file can assert on the exact status/code without duplicating the response
 * shape.
 */
export function makeAccountFreezeGuard(container: Container, env: Env): AccountFreezeGuard {
  const cache = new AccessStateCache();

  const preHandler: preHandlerHookHandler = async (request, reply) => {
    if (READ_METHODS.has(request.method)) return;
    if (isExemptRoute(request.routeOptions?.url)) return;

    const actor = await resolveActor(request, container).catch(() => null);
    // No actor: either unauthenticated (the route's own `authenticate` will
    // 401 it) or session verification failed transiently — either way this
    // hook has nothing to enforce against and stays silent.
    if (!actor) return;

    let frozen: boolean;
    try {
      frozen = await isFrozen(actor, container, env, cache, Date.now());
    } catch {
      // Fail open (see class comment, point 6): a subscription lookup that
      // could not complete must never be interpreted as "frozen".
      return;
    }

    if (!frozen) return;

    sendFrozenError(request, reply);
  };

  return { preHandler, clearCache: () => cache.clear() };
}

/**
 * A distinct, machine-readable code — not a generic 403 — so the web client
 * can tell "your role can't do this" (FORBIDDEN) apart from "your account is
 * frozen, go fix billing" (ACCOUNT_FROZEN) and route the user accordingly.
 * 402 Payment Required is the closest standard status for "this failed
 * specifically because of unpaid billing", distinct from the 403s the rest of
 * the authorization stack already uses for role/permission refusals.
 */
export function sendFrozenError(request: FastifyRequest, reply: FastifyReply): void {
  sendError(request, reply, 402, 'ACCOUNT_FROZEN');
}
