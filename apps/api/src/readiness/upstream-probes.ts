/**
 * R0-08 — asking the upstream whether it works, not whether it was spelled.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Until now `/ready` answered two of its three questions with a boolean over
 * environment variables:
 *
 *     authentication: Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY)
 *     privateStorage: Boolean(SUPABASE_URL && SERVICE_ROLE_KEY && BUCKET)
 *
 * That reports `ok` for a URL pointing at a Supabase project that was deleted,
 * a publishable key that was rotated, a service-role key that expired, and a
 * bucket that no longer exists. On 2026-08-31, through an outage that lasted
 * most of a working day, `authentication` reported `ok` from the first minute
 * to the last — because the variable was set, which was never the question.
 *
 * `database` already gets a real probe. These two now get one as well, and the
 * endpoint means the same thing for all three: the dependency answered.
 *
 * WHY THESE TWO ENDPOINTS
 * -----------------------
 * `/auth/v1/settings` is behind Supabase's API gateway, which rejects a request
 * carrying no valid `apikey` before GoTrue ever sees it. So one call proves
 * three things at once: the host resolves, the project exists, and the
 * publishable key is accepted. `/auth/v1/health` would prove only the first two
 * — it answers without a key, which is exactly the failure mode being closed.
 *
 * `/storage/v1/bucket/:name` distinguishes the two storage failures that need
 * different human responses: a 404 means the bucket is gone or renamed, a
 * 401/403 means the service-role key is wrong or revoked. A blind
 * `Boolean(bucket)` cannot tell those apart, and neither can a probe that only
 * lists buckets.
 *
 * WHY NOT FAIL OPEN
 * -----------------
 * A probe that degrades to `ok` when it cannot reach the dependency reproduces
 * the bug it replaces. An unreachable dependency is reported as unreachable,
 * exactly as `database` already is. The timeout is what keeps that from turning
 * a slow upstream into a hung health check.
 *
 * WHAT IT NEVER DOES
 * ------------------
 * No key is placed in a URL, a reason string, or a log line. Keys travel in
 * headers only. The reason carries the HTTP status and, when the upstream sent
 * one, its own short `message` — Supabase phrases the useful half there
 * ("Invalid API key", "Bucket not found") and never echoes the credential back.
 * The body is read as text, capped, and stripped of anything resembling a JWT
 * before it is used, because "the upstream would not do that" is a weaker
 * guarantee than not being able to.
 */

/** Long enough for a cold upstream, short enough that `/ready` still answers. */
export const UPSTREAM_PROBE_TIMEOUT_MS = 2_500;

/** Characters of an upstream message kept in a reason string. */
const MAX_DETAIL_CHARS = 160;

interface ProbeResponseLike {
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
}

export type ProbeFetch = (
  input: string,
  init?: Record<string, unknown>,
) => Promise<ProbeResponseLike>;

export interface ProbeOutcome {
  /** `true` only when the dependency answered and accepted the credential. */
  reachable: boolean;
  /** Absent when `reachable`. Safe to place in a `/ready` reason. */
  detail?: string;
}

/**
 * A JWT is three base64url segments joined by dots. Supabase keys are JWTs, so
 * this is the shape to remove from anything echoed back to an operator. It is a
 * belt-and-braces measure: no upstream observed returns a key in its body.
 */
const JWT_SHAPED = /\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\b/g;

function safeDetail(status: number, body: string): string {
  let message = body.trim();
  // Supabase answers JSON with the human half under `message` (GoTrue) or
  // `error` (Storage). Anything else is used as-is; it is already text.
  try {
    const parsed: unknown = JSON.parse(message);
    if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>;
      const named = [record.message, record.error, record.msg].find(
        (value): value is string => typeof value === 'string' && value.length > 0,
      );
      if (named) message = named;
    }
  } catch {
    // Not JSON. Fall through with the raw text.
  }
  message = message
    .replace(JWT_SHAPED, '[redacted]')
    .replace(/\s+/g, ' ')
    .slice(0, MAX_DETAIL_CHARS);
  return message ? `HTTP ${status}: ${message}` : `HTTP ${status}`;
}

function transportDetail(error: unknown): string {
  // Node's fetch wraps the real cause; `cause.code` is where ECONNREFUSED,
  // ENOTFOUND and ETIMEDOUT actually live. The name alone ("TypeError") tells
  // an operator nothing, which is the same mistake as "Database is unreachable".
  if (error instanceof Error) {
    const cause = (error as { cause?: { code?: string } }).cause;
    const code = cause?.code ?? (error as { code?: string }).code ?? error.name;
    return `${code}: ${error.message}`;
  }
  return String(error);
}

async function probe(
  url: string,
  headers: Record<string, string>,
  fetchImpl: ProbeFetch,
  timeoutMs: number,
): Promise<ProbeOutcome> {
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers,
      // AbortSignal.timeout is native from Node 18 and needs no cleanup, unlike
      // a controller plus a timer that leaks when the request wins the race.
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.ok) return { reachable: true };
    const body = await response.text().catch(() => '');
    return { reachable: false, detail: safeDetail(response.status, body) };
  } catch (error) {
    return { reachable: false, detail: transportDetail(error) };
  }
}

/**
 * Proves the Supabase project answers and accepts the publishable key.
 *
 * A 401 here is the case this whole item exists for: the variable is set, and
 * the value is wrong.
 */
export async function probeSupabaseAuth(options: {
  supabaseUrl: string;
  publishableKey: string;
  fetchImpl?: ProbeFetch;
  timeoutMs?: number;
}): Promise<ProbeOutcome> {
  const base = options.supabaseUrl.replace(/\/$/, '');
  return probe(
    `${base}/auth/v1/settings`,
    { apikey: options.publishableKey },
    options.fetchImpl ?? (globalThis.fetch as unknown as ProbeFetch),
    options.timeoutMs ?? UPSTREAM_PROBE_TIMEOUT_MS,
  );
}

/**
 * Proves the private bucket exists and the service-role key may read it.
 *
 * The bucket name is a path segment, so it is encoded: a name with a slash or a
 * space would otherwise probe a different URL than the one the application
 * writes to, and report on something else entirely.
 */
export async function probeSupabasePrivateStorage(options: {
  supabaseUrl: string;
  serviceRoleKey: string;
  bucket: string;
  fetchImpl?: ProbeFetch;
  timeoutMs?: number;
}): Promise<ProbeOutcome> {
  const base = options.supabaseUrl.replace(/\/$/, '');
  return probe(
    `${base}/storage/v1/bucket/${encodeURIComponent(options.bucket)}`,
    {
      apikey: options.serviceRoleKey,
      authorization: `Bearer ${options.serviceRoleKey}`,
    },
    options.fetchImpl ?? (globalThis.fetch as unknown as ProbeFetch),
    options.timeoutMs ?? UPSTREAM_PROBE_TIMEOUT_MS,
  );
}
