import { Buffer } from 'node:buffer';
import { timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

const SOURCE_SHA = '376ca59e447a3944b48d4bd420b85f0a84cee21b';
const BRANCH = 'test/pr-160-external-preview';
const PROJECTS = { web: 'caredesk-pr160-test-web', api: 'caredesk-pr160-test-api' };

class TestConfigurationError extends Error {
  constructor(field) {
    super(`Invalid TEST configuration: ${field}`);
  }
}

function fail(field) {
  throw new TestConfigurationError(field);
}

function required(source, field) {
  const value = Object.hasOwn(source, field) ? source[field] : undefined;
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > 32_768 ||
    value.trim() !== value ||
    Array.from(value).some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  ) {
    fail(field);
  }
  return value;
}

function exact(source, field, expected) {
  const value = required(source, field);
  if (value !== expected) fail(field);
  return value;
}

function parseUrl(value, field) {
  try {
    return new URL(value);
  } catch {
    fail(field);
  }
}

function previewOrigin(source, field, projectName) {
  const value = required(source, field);
  const url = parseUrl(value, field);
  const suffix = url.hostname.slice(projectName.length + 1, -'.vercel.app'.length);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    url.origin !== value ||
    !url.hostname.startsWith(`${projectName}-`) ||
    !url.hostname.endsWith('.vercel.app') ||
    !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(suffix) ||
    url.hostname.split('.')[0].length > 63
  ) {
    fail(field);
  }
  return value;
}

function projectRef(source, field) {
  const ref = required(source, field);
  if (
    !/^[a-z0-9]{20}$/.test(ref) ||
    /^(?:abcdefghijklmnopqrst|01234567890123456789|zyxwvutsrqponmlkjihgfe)$/.test(ref) ||
    /^(.{1,10})\1+$/.test(ref) ||
    /example|placeholder|changeme|replace|yourproject/.test(ref)
  ) {
    fail(field);
  }
  return ref;
}

function databaseUrl(source, field, ref, administrative = false) {
  const value = required(source, field);
  const url = parseUrl(value, field);
  let username;
  try {
    username = decodeURIComponent(url.username);
    decodeURIComponent(url.password);
  } catch {
    fail(field);
  }
  const direct = url.hostname === `db.${ref}.supabase.co`;
  const pooled = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.pooler\.supabase\.com$/.test(url.hostname);
  const allowedUsers = administrative ? ['caredesk_app', 'postgres'] : ['caredesk_app'];
  const users = pooled ? allowedUsers.map((user) => `${user}.${ref}`) : allowedUsers;
  const tlsModes = ['require', 'verify-ca', 'verify-full'];
  const sslmode = url.searchParams.get('sslmode');
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    (!direct && !pooled) ||
    !users.includes(username) ||
    !url.password ||
    url.pathname !== '/postgres' ||
    url.hash ||
    (url.port && !(pooled ? ['5432', '6543'] : ['5432']).includes(url.port)) ||
    !tlsModes.includes(sslmode) ||
    url.searchParams.getAll('sslmode').length !== 1
  ) {
    fail(field);
  }
  // libpq/node-postgres connection overrides must not change the checked host,
  // role or TLS requirements after the URL itself has passed validation.
  for (const [key, setting] of url.searchParams) {
    if (key === 'sslmode') continue;
    if (key !== 'pgbouncer' || setting !== 'true' || !pooled) fail(field);
    if (url.searchParams.getAll(key).length !== 1) fail(field);
  }
  return { value, connectionType: direct ? 'direct' : 'pooler', sslmode };
}

function decodeJwtPart(part, field) {
  if (!/^[a-zA-Z0-9_-]+$/.test(part)) fail(field);
  const bytes = Buffer.from(part, 'base64url');
  if (bytes.toString('base64url') !== part) fail(field);
  try {
    const value = JSON.parse(bytes.toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(field);
    return value;
  } catch {
    fail(field);
  }
}

function supabaseKey(source, field, ref, role) {
  const value = required(source, field);
  const prefix = role === 'anon' ? 'sb_publishable_' : 'sb_secret_';
  if (value.startsWith(prefix)) {
    const suffix = value.slice(prefix.length);
    if (
      !/^[a-zA-Z0-9_-]{16,}$/.test(suffix) ||
      /example|placeholder|changeme|replace|yourkey/i.test(suffix) ||
      new Set(suffix).size < 8
    ) {
      fail(field);
    }
    return { value, format: 'opaque', projectBinding: 'NOT_VERIFIED' };
  }
  const parts = value.split('.');
  if (parts.length !== 3 || !/^[a-zA-Z0-9_-]{16,}$/.test(parts[2])) fail(field);
  const header = decodeJwtPart(parts[0], field);
  const payload = decodeJwtPart(parts[1], field);
  if (
    !['HS256', 'ES256', 'RS256'].includes(header.alg) ||
    payload.ref !== ref ||
    payload.role !== role
  ) {
    fail(field);
  }
  // Inspecting claims is not signature verification or a request to Auth.
  return { value, format: 'legacy-jwt', projectBinding: 'CLAIMS_ONLY' };
}

function bucket(source, field) {
  const value = required(source, field);
  if (
    !/^[a-z0-9][a-z0-9._-]{0,62}$/.test(value) ||
    /^(?:example|placeholder|changeme|your[-_]bucket|replace[-_]me)$/.test(value)
  ) {
    fail(field);
  }
  return value;
}

function encryptionKey(source) {
  const field = 'TEST_WORKSPACE_ENCRYPTION_KEY';
  const value = required(source, field);
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length !== 32 || bytes.toString('base64') !== value || new Set(bytes).size < 16) {
    fail(field);
  }
  // Reject known reuse without inheriting or returning another environment's
  // key. A local preflight cannot prove how or when a configured key was made.
  for (const name of ['WORKSPACE_ENCRYPTION_KEY', 'PRODUCTION_WORKSPACE_ENCRYPTION_KEY']) {
    if (!Object.hasOwn(source, name) || typeof source[name] !== 'string') continue;
    const other = Buffer.from(source[name], 'base64');
    if (other.length === bytes.length && timingSafeEqual(other, bytes)) fail(field);
  }
  return value;
}

/** Require the real hosting target, exact branch and reviewed product source. */
export function assertPr160PreviewTarget(source) {
  try {
    if (!source || typeof source !== 'object' || Array.isArray(source)) fail('ENVIRONMENT');
    exact(source, 'VERCEL_ENV', 'preview');
    exact(source, 'VERCEL_GIT_COMMIT_REF', BRANCH);
    exact(source, 'TEST_MANIFEST_SOURCE_SHA', SOURCE_SHA);
    return { sourceSha: SOURCE_SHA, branch: BRANCH, deploymentTarget: 'preview' };
  } catch (error) {
    if (error instanceof TestConfigurationError) throw error;
    fail('ENVIRONMENT');
  }
}

/** Web builds require public configuration only, never database/admin secrets. */
export function validatePr160TestWebEnvironment(source) {
  try {
    const target = assertPr160PreviewTarget(source);
    exact(source, 'TEST_WEB_PROJECT_NAME', PROJECTS.web);
    exact(source, 'TEST_API_PROJECT_NAME', PROJECTS.api);
    const webOrigin = previewOrigin(source, 'TEST_WEB_ORIGIN', PROJECTS.web);
    const apiOrigin = previewOrigin(source, 'TEST_API_ORIGIN', PROJECTS.api);
    const testRef = projectRef(source, 'TEST_SUPABASE_PROJECT_REF');
    const productionRef = projectRef(source, 'PRODUCTION_SUPABASE_PROJECT_REF');
    if (testRef === productionRef) fail('TEST_SUPABASE_PROJECT_REF');
    const supabaseUrl = exact(source, 'TEST_SUPABASE_URL', `https://${testRef}.supabase.co`);
    const publishable = supabaseKey(source, 'TEST_SUPABASE_PUBLISHABLE_KEY', testRef, 'anon');
    const webEnv = {
      VITE_API_BASE_URL: apiOrigin,
      VITE_SUPABASE_URL: supabaseUrl,
      VITE_SUPABASE_PUBLISHABLE_KEY: publishable.value,
      VITE_DEV_TOKEN: '',
      VITE_REGULATION_CONSOLE: '',
      VITE_PUBLIC_SITE_URL: webOrigin,
      VITE_PUBLIC_SIGNUP_URL: webOrigin,
    };
    const publicReport = {
      validation: 'CONFIGURATION_ONLY',
      status: 'CONFIGURATION_VALIDATED',
      ...target,
      projects: {
        web: { name: PROJECTS.web, origin: webOrigin },
        api: { name: PROJECTS.api, origin: apiOrigin },
      },
      supabase: { testProjectRef: testRef, productionProjectRef: productionRef },
      credentials: {
        publishableKeyFormat: publishable.format,
        publishableProjectBinding: publishable.projectBinding,
        signatureVerification: 'NOT_RUN',
      },
      liveChecks: {
        auth: 'NOT_RUN',
        database: 'NOT_RUN',
        rls: 'NOT_RUN',
        storage: 'NOT_RUN',
        backup: 'NOT_RUN',
        readiness: 'NOT_RUN',
        actions: 'NOT_RUN',
      },
    };
    return { webEnv, publicReport };
  } catch (error) {
    if (error instanceof TestConfigurationError) throw error;
    fail('ENVIRONMENT');
  }
}

/**
 * Validate configuration only; never connect, deploy, authenticate or migrate.
 * The two curated maps contain secrets for the parent's hosting integration.
 * Only publicReport is safe to print. Never spread source into a runtime map.
 */
export function validatePr160TestEnvironment(source) {
  try {
    const { webEnv, publicReport: webReport } = validatePr160TestWebEnvironment(source);
    const testRef = webReport.supabase.testProjectRef;
    const productionRef = webReport.supabase.productionProjectRef;
    const webOrigin = webReport.projects.web.origin;
    const supabaseUrl = webEnv.VITE_SUPABASE_URL;
    const database = databaseUrl(source, 'TEST_DATABASE_URL', testRef);
    const adminPresent = Object.hasOwn(source, 'TEST_DATABASE_ADMIN_URL');
    if (adminPresent) databaseUrl(source, 'TEST_DATABASE_ADMIN_URL', testRef, true);
    const service = supabaseKey(source, 'TEST_SUPABASE_SERVICE_ROLE_KEY', testRef, 'service_role');
    const storageBucket = bucket(source, 'TEST_SUPABASE_STORAGE_BUCKET');
    const backupBucket = bucket(source, 'TEST_BACKUP_SUPABASE_STORAGE_BUCKET');
    if (storageBucket === backupBucket) fail('TEST_BACKUP_SUPABASE_STORAGE_BUCKET');
    const workspaceKey = encryptionKey(source);
    const apiEnv = {
      NODE_ENV: 'production',
      CORS_ORIGINS: webOrigin,
      DATABASE_URL: database.value,
      WORKSPACE_ENCRYPTION_KEY: workspaceKey,
      PRODUCTION_SUPABASE_PROJECT_REF: productionRef,
      SUPABASE_URL: supabaseUrl,
      SUPABASE_PUBLISHABLE_KEY: webEnv.VITE_SUPABASE_PUBLISHABLE_KEY,
      SUPABASE_SERVICE_ROLE_KEY: service.value,
      SUPABASE_STORAGE_BUCKET: storageBucket,
      BACKUP_SUPABASE_URL: supabaseUrl,
      BACKUP_SUPABASE_SERVICE_ROLE_KEY: service.value,
      BACKUP_SUPABASE_STORAGE_BUCKET: backupBucket,
      FAMILY_INVITE_REDIRECT_URL: `${webOrigin}/app`,
      BILLING_PROVIDER: 'disabled',
      AI_PROVIDER: 'mock',
    };
    const publicReport = {
      ...webReport,
      database: {
        connectionType: database.connectionType,
        appRole: 'caredesk_app',
        privilegeVerification: 'NOT_RUN',
        sslmode: database.sslmode,
        adminConfigurationValidated: adminPresent,
        administrativeCredentialsInRuntime: false,
      },
      storage: {
        primaryConfigured: true,
        backupConfigured: true,
        distinctBuckets: true,
        sameTestProject: true,
      },
      credentials: {
        ...webReport.credentials,
        serviceKeyFormat: service.format,
        serviceProjectBinding: service.projectBinding,
        encryptionKeyFreshness: 'NOT_VERIFIED',
      },
    };
    return { webEnv, apiEnv, publicReport };
  } catch (error) {
    if (error instanceof TestConfigurationError) throw error;
    fail('ENVIRONMENT');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { publicReport } = validatePr160TestEnvironment(process.env);
    process.stdout.write(`${JSON.stringify(publicReport, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(
      `${error instanceof TestConfigurationError ? error.message : 'Invalid TEST configuration.'}\n`,
    );
    process.exitCode = 1;
  }
}
