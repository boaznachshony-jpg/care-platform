import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import process from 'node:process';
import { test } from 'node:test';
import { fileURLToPath, URL } from 'node:url';
import {
  assertPr160PreviewTarget,
  validatePr160TestEnvironment,
  validatePr160TestWebEnvironment,
} from './pr160-test-environment.mjs';

const TEST_REF = 'tstqmvwzckrnejhsyuop';
const PRODUCTION_REF = 'prdnhxczwqjksmuvetao';
const SCRIPT = fileURLToPath(new URL('./pr160-test-environment.mjs', import.meta.url));
const WEB_ORIGIN = 'https://caredesk-pr160-test-web-git-test-review-team.vercel.app';
const API_ORIGIN = 'https://caredesk-pr160-test-api-git-test-review-team.vercel.app';

function jwt(ref, role, header = { alg: 'HS256', typ: 'JWT' }) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode(header)}.${encode({ ref, role })}.${randomBytes(32).toString('base64url')}`;
}

function fixture() {
  return {
    VERCEL_ENV: 'preview',
    VERCEL_GIT_COMMIT_REF: 'test/pr-160-external-preview',
    TEST_MANIFEST_SOURCE_SHA: '376ca59e447a3944b48d4bd420b85f0a84cee21b',
    TEST_WEB_PROJECT_NAME: 'caredesk-pr160-test-web',
    TEST_API_PROJECT_NAME: 'caredesk-pr160-test-api',
    TEST_WEB_ORIGIN: WEB_ORIGIN,
    TEST_API_ORIGIN: API_ORIGIN,
    TEST_SUPABASE_PROJECT_REF: TEST_REF,
    PRODUCTION_SUPABASE_PROJECT_REF: PRODUCTION_REF,
    TEST_SUPABASE_URL: `https://${TEST_REF}.supabase.co`,
    TEST_DATABASE_URL: `postgresql://caredesk_app:test-only-password@db.${TEST_REF}.supabase.co:5432/postgres?sslmode=require`,
    TEST_SUPABASE_PUBLISHABLE_KEY: jwt(TEST_REF, 'anon'),
    TEST_SUPABASE_SERVICE_ROLE_KEY: jwt(TEST_REF, 'service_role'),
    TEST_SUPABASE_STORAGE_BUCKET: 'pr160-test-documents',
    TEST_BACKUP_SUPABASE_STORAGE_BUCKET: 'pr160-test-backups',
    TEST_WORKSPACE_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  };
}

function rejected(source, field) {
  assert.throws(
    () => validatePr160TestEnvironment(source),
    (error) => error.message === `Invalid TEST configuration: ${field}`,
  );
}

test('curates real TEST web/API configuration without inheriting ambient providers', () => {
  const source = {
    ...fixture(),
    DATABASE_URL: 'inherited-production-database-must-not-be-used',
    SUPABASE_SERVICE_ROLE_KEY: 'inherited-production-service-key',
    VITE_DEV_TOKEN: 'inherited-dev-auth-token',
    VITE_REGULATION_CONSOLE: 'true',
    CRON_SECRET: 'inherited-cron-secret',
    RESEND_API_KEY: 'inherited-messaging-secret',
    CARDCOM_API_PASSWORD: 'inherited-payment-secret',
    OPENAI_API_KEY: 'inherited-provider-secret',
  };
  const { webEnv, apiEnv, publicReport } = validatePr160TestEnvironment(source);
  assert.deepEqual(Object.keys(webEnv).sort(), [
    'VITE_API_BASE_URL',
    'VITE_DEV_TOKEN',
    'VITE_PUBLIC_SIGNUP_URL',
    'VITE_PUBLIC_SITE_URL',
    'VITE_REGULATION_CONSOLE',
    'VITE_SUPABASE_PUBLISHABLE_KEY',
    'VITE_SUPABASE_URL',
  ]);
  assert.equal(webEnv.VITE_API_BASE_URL, API_ORIGIN);
  assert.equal(webEnv.VITE_SUPABASE_URL, source.TEST_SUPABASE_URL);
  assert.equal(webEnv.VITE_DEV_TOKEN, '');
  assert.equal(webEnv.VITE_REGULATION_CONSOLE, '');
  assert.equal(webEnv.VITE_PUBLIC_SITE_URL, WEB_ORIGIN);
  assert.equal(webEnv.VITE_PUBLIC_SIGNUP_URL, WEB_ORIGIN);
  assert.equal(apiEnv.NODE_ENV, 'production');
  assert.equal(publicReport.deploymentTarget, 'preview');
  for (const name of ['VERCEL', 'VERCEL_ENV', 'VERCEL_GIT_COMMIT_REF']) {
    assert.equal(Object.hasOwn(apiEnv, name), false);
    assert.equal(Object.hasOwn(webEnv, name), false);
  }
  assert.equal(apiEnv.CORS_ORIGINS, WEB_ORIGIN);
  assert.equal(apiEnv.DATABASE_URL, source.TEST_DATABASE_URL);
  assert.equal(apiEnv.SUPABASE_SERVICE_ROLE_KEY, source.TEST_SUPABASE_SERVICE_ROLE_KEY);
  assert.equal(apiEnv.BACKUP_SUPABASE_URL, source.TEST_SUPABASE_URL);
  assert.equal(apiEnv.BACKUP_SUPABASE_SERVICE_ROLE_KEY, source.TEST_SUPABASE_SERVICE_ROLE_KEY);
  assert.notEqual(apiEnv.BACKUP_SUPABASE_STORAGE_BUCKET, apiEnv.SUPABASE_STORAGE_BUCKET);
  assert.equal(apiEnv.BILLING_PROVIDER, 'disabled');
  assert.equal(apiEnv.AI_PROVIDER, 'mock');
  assert.equal(apiEnv.FAMILY_INVITE_REDIRECT_URL, `${WEB_ORIGIN}/app`);
  for (const name of ['CRON_SECRET', 'RESEND_API_KEY', 'CARDCOM_API_PASSWORD', 'OPENAI_API_KEY']) {
    assert.equal(Object.hasOwn(apiEnv, name), false);
    assert.equal(Object.hasOwn(webEnv, name), false);
  }
  assert.equal(publicReport.validation, 'CONFIGURATION_ONLY');
  assert.deepEqual(new Set(Object.values(publicReport.liveChecks)), new Set(['NOT_RUN']));
  assert.equal(publicReport.credentials.signatureVerification, 'NOT_RUN');
  assert.equal(publicReport.credentials.encryptionKeyFreshness, 'NOT_VERIFIED');
});

test('does not mutate the caller or use inherited prototype configuration', () => {
  const source = Object.freeze(fixture());
  validatePr160TestEnvironment(source);
  rejected(Object.create(source), 'VERCEL_ENV');
  rejected(null, 'ENVIRONMENT');
  rejected([], 'ENVIRONMENT');
});

test('public-only Web preflight succeeds without placing any server secrets in the Web project', () => {
  const source = fixture();
  for (const field of [
    'TEST_DATABASE_URL',
    'TEST_SUPABASE_SERVICE_ROLE_KEY',
    'TEST_SUPABASE_STORAGE_BUCKET',
    'TEST_BACKUP_SUPABASE_STORAGE_BUCKET',
    'TEST_WORKSPACE_ENCRYPTION_KEY',
  ]) {
    delete source[field];
  }
  source.VITE_API_BASE_URL = 'https://care-platform-api.vercel.app';
  source.VITE_SUPABASE_URL = `https://${PRODUCTION_REF}.supabase.co`;
  source.VITE_SUPABASE_PUBLISHABLE_KEY = 'inherited-production-publishable';
  source.VITE_DEV_TOKEN = 'inherited-dev-token';
  const { webEnv, publicReport } = validatePr160TestWebEnvironment(source);
  assert.equal(webEnv.VITE_API_BASE_URL, API_ORIGIN);
  assert.equal(webEnv.VITE_SUPABASE_URL, source.TEST_SUPABASE_URL);
  assert.equal(webEnv.VITE_SUPABASE_PUBLISHABLE_KEY, source.TEST_SUPABASE_PUBLISHABLE_KEY);
  assert.equal(webEnv.VITE_DEV_TOKEN, '');
  assert.equal(Object.keys(webEnv).length, 7);
  assert.equal(Object.hasOwn(publicReport, 'database'), false);
  assert.equal(Object.hasOwn(publicReport.credentials, 'serviceKeyFormat'), false);
  assert.deepEqual(new Set(Object.values(publicReport.liveChecks)), new Set(['NOT_RUN']));
});

test('both Web validation and API build gate reject real production target or a wrong source', () => {
  for (const validate of [validatePr160TestWebEnvironment, assertPr160PreviewTarget]) {
    for (const [field, value] of [
      ['VERCEL_ENV', 'production'],
      ['VERCEL_GIT_COMMIT_REF', 'main'],
      ['TEST_MANIFEST_SOURCE_SHA', '0000000000000000000000000000000000000000'],
    ]) {
      assert.throws(
        () => validate({ ...fixture(), [field]: value }),
        (error) => error.message === `Invalid TEST configuration: ${field}`,
      );
    }
  }
  assert.deepEqual(assertPr160PreviewTarget(fixture()), {
    sourceSha: '376ca59e447a3944b48d4bd420b85f0a84cee21b',
    branch: 'test/pr-160-external-preview',
    deploymentTarget: 'preview',
  });
});

test('rejects every missing required input without returning any secret', () => {
  for (const field of Object.keys(fixture())) {
    const source = fixture();
    delete source[field];
    rejected(source, field);
  }
});

test('rejects production deployment, other branch, wrong source and wrong project names', () => {
  for (const [field, value] of [
    ['VERCEL_ENV', 'production'],
    ['VERCEL_ENV', 'development'],
    ['VERCEL_GIT_COMMIT_REF', 'feature/caredesk-ux-v2-visual'],
    ['TEST_MANIFEST_SOURCE_SHA', '376ca59'],
    ['TEST_WEB_PROJECT_NAME', 'care-platform-web'],
    ['TEST_API_PROJECT_NAME', 'care-platform-api'],
  ]) {
    rejected({ ...fixture(), [field]: value }, field);
  }
});

test('rejects unsafe, bare, custom, credential-bearing and cross-project origins', () => {
  for (const origin of [
    'https://caredesk-isr.com',
    'https://www.caredesk-isr.com',
    'https://care-platform-web.vercel.app',
    'https://caredesk-pr160-test-web.vercel.app',
    'https://unknown-preview.vercel.app',
    'http://caredesk-pr160-test-web-review.vercel.app',
    'https://localhost',
    'https://127.0.0.1',
    'https://caredesk-pr160-test-web-review.example.com',
    'https://caredesk-pr160-test-web-review.vercel.app.evil.test',
    'https://caredesk-pr160-test-web-review.vercel.app@evil.test',
    'https://username:never-print-this@caredesk-pr160-test-web-review.vercel.app',
    `${WEB_ORIGIN}/`,
    `${WEB_ORIGIN}/app`,
    `${WEB_ORIGIN}?secret=never-print-this`,
    `${WEB_ORIGIN}#never-print-this`,
    `${WEB_ORIGIN}:444`,
    API_ORIGIN,
  ]) {
    rejected({ ...fixture(), TEST_WEB_ORIGIN: origin }, 'TEST_WEB_ORIGIN');
  }
  rejected({ ...fixture(), TEST_API_ORIGIN: WEB_ORIGIN }, 'TEST_API_ORIGIN');
});

test('requires distinct, real-shaped non-placeholder Supabase refs and exact TEST URL', () => {
  rejected(
    { ...fixture(), TEST_SUPABASE_PROJECT_REF: PRODUCTION_REF },
    'TEST_SUPABASE_PROJECT_REF',
  );
  for (const field of ['TEST_SUPABASE_PROJECT_REF', 'PRODUCTION_SUPABASE_PROJECT_REF']) {
    for (const ref of [
      'short',
      'abcdefghijklmnopqrst',
      'xxxxxxxxxxxxxxxxxxxx',
      'abababababababababab',
    ]) {
      rejected({ ...fixture(), [field]: ref }, field);
    }
  }
  for (const url of [
    `https://${PRODUCTION_REF}.supabase.co`,
    `https://${TEST_REF}.supabase.co/`,
    `https://user:secret@${TEST_REF}.supabase.co`,
  ]) {
    rejected({ ...fixture(), TEST_SUPABASE_URL: url }, 'TEST_SUPABASE_URL');
  }
});

test('accepts TEST pooler app role and all explicit verified TLS modes', () => {
  for (const sslmode of ['require', 'verify-ca', 'verify-full']) {
    const source = fixture();
    source.TEST_DATABASE_URL = `postgresql://caredesk_app.${TEST_REF}:test-password@aws-1-eu-central-1.pooler.supabase.com:6543/postgres?sslmode=${sslmode}&pgbouncer=true`;
    const { apiEnv, publicReport } = validatePr160TestEnvironment(source);
    assert.equal(apiEnv.DATABASE_URL, source.TEST_DATABASE_URL);
    assert.equal(publicReport.database.connectionType, 'pooler');
    assert.equal(publicReport.database.sslmode, sslmode);
  }
});

test('rejects wrong DB projects, owner/runtime roles, non-Supabase hosts and absent/weak TLS', () => {
  const db = (host, user = 'caredesk_app', query = 'sslmode=require') =>
    `postgresql://${user}:test-password@${host}:5432/postgres?${query}`;
  for (const value of [
    db(`db.${PRODUCTION_REF}.supabase.co`),
    db(`db.${TEST_REF}.supabase.co`, 'postgres'),
    db(`db.${TEST_REF}.supabase.co`, 'supabase_admin'),
    db('aws-1-eu-central-1.pooler.supabase.com', `caredesk_app.${PRODUCTION_REF}`),
    db('aws-1-eu-central-1.pooler.supabase.com', `postgres.${TEST_REF}`),
    db('aws-1-eu-central-1.pooler.supabase.com'),
    db('127.0.0.1'),
    db(`db.${TEST_REF}.supabase.co.evil.test`),
    db(`db.${TEST_REF}.supabase.co`, 'caredesk_app', ''),
    db(`db.${TEST_REF}.supabase.co`, 'caredesk_app', 'sslmode=disable'),
    db(`db.${TEST_REF}.supabase.co`, 'caredesk_app', 'sslmode=prefer'),
    db(`db.${TEST_REF}.supabase.co`, 'caredesk_app', 'sslmode=require&sslmode=disable'),
    db(`db.${TEST_REF}.supabase.co`, 'caredesk_app', 'sslmode=require&ssl=false'),
    db(`db.${TEST_REF}.supabase.co`, 'caredesk_app', 'sslmode=require&options=-crole%3Dpostgres'),
    db(`db.${TEST_REF}.supabase.co`, 'caredesk_app', 'sslmode=require&host=production.test'),
    db(`db.${TEST_REF}.supabase.co`).replace('/postgres?', '/other?'),
    db(`db.${TEST_REF}.supabase.co`).replace(':5432/', ':9999/'),
    db(`db.${TEST_REF}.supabase.co`).replace(':test-password@', '@'),
  ]) {
    rejected({ ...fixture(), TEST_DATABASE_URL: value }, 'TEST_DATABASE_URL');
  }
});

test('validates optional admin against TEST and never exposes it to either runtime/report', () => {
  const source = fixture();
  source.TEST_DATABASE_ADMIN_URL = `postgresql://postgres:admin-secret-sentinel@db.${TEST_REF}.supabase.co:5432/postgres?sslmode=verify-full`;
  const result = validatePr160TestEnvironment(source);
  assert.equal(result.publicReport.database.adminConfigurationValidated, true);
  for (const object of [result.webEnv, result.apiEnv, result.publicReport]) {
    assert.equal(JSON.stringify(object).includes('admin-secret-sentinel'), false);
    assert.equal(Object.hasOwn(object, 'DATABASE_ADMIN_URL'), false);
    assert.equal(Object.hasOwn(object, 'TEST_DATABASE_ADMIN_URL'), false);
  }
  rejected(
    {
      ...source,
      TEST_DATABASE_ADMIN_URL: source.TEST_DATABASE_ADMIN_URL.replace(TEST_REF, PRODUCTION_REF),
    },
    'TEST_DATABASE_ADMIN_URL',
  );
  rejected({ ...source, TEST_DATABASE_ADMIN_URL: '' }, 'TEST_DATABASE_ADMIN_URL');
});

test('checks legacy JWT roles/ref and rejects malformed or unsigned credentials', () => {
  for (const [field, role] of [
    ['TEST_SUPABASE_PUBLISHABLE_KEY', 'anon'],
    ['TEST_SUPABASE_SERVICE_ROLE_KEY', 'service_role'],
  ]) {
    for (const key of [
      jwt(PRODUCTION_REF, role),
      jwt(TEST_REF, role === 'anon' ? 'service_role' : 'anon'),
      jwt(TEST_REF, role, { alg: 'none' }),
      'invalid.credentials.sentinel-never-print',
      'not-a-configured-supabase-key',
    ]) {
      rejected({ ...fixture(), [field]: key }, field);
    }
  }
});

test('accepts configured opaque credentials without pretending to verify project ownership', () => {
  const source = fixture();
  source.TEST_SUPABASE_PUBLISHABLE_KEY = `sb_publishable_${randomBytes(24).toString('base64url')}`;
  source.TEST_SUPABASE_SERVICE_ROLE_KEY = `sb_secret_${randomBytes(24).toString('base64url')}`;
  const { publicReport } = validatePr160TestEnvironment(source);
  assert.equal(publicReport.credentials.publishableKeyFormat, 'opaque');
  assert.equal(publicReport.credentials.serviceKeyFormat, 'opaque');
  assert.equal(publicReport.credentials.publishableProjectBinding, 'NOT_VERIFIED');
  assert.equal(publicReport.credentials.serviceProjectBinding, 'NOT_VERIFIED');
  rejected(
    { ...source, TEST_SUPABASE_PUBLISHABLE_KEY: source.TEST_SUPABASE_SERVICE_ROLE_KEY },
    'TEST_SUPABASE_PUBLISHABLE_KEY',
  );
});

test('does not reflect bucket values that could accidentally equal a configured credential', () => {
  const source = fixture();
  source.TEST_SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_abcd1234efgh5678ijkl9012';
  source.TEST_SUPABASE_STORAGE_BUCKET = source.TEST_SUPABASE_SERVICE_ROLE_KEY;
  const { publicReport } = validatePr160TestEnvironment(source);
  assert.equal(JSON.stringify(publicReport).includes(source.TEST_SUPABASE_SERVICE_ROLE_KEY), false);
  assert.equal(publicReport.storage.distinctBuckets, true);
});

test('requires different buckets and rejects malformed, weak or known-reused encryption keys', () => {
  const source = fixture();
  rejected(
    { ...source, TEST_BACKUP_SUPABASE_STORAGE_BUCKET: source.TEST_SUPABASE_STORAGE_BUCKET },
    'TEST_BACKUP_SUPABASE_STORAGE_BUCKET',
  );
  rejected(
    { ...source, TEST_SUPABASE_STORAGE_BUCKET: '../production' },
    'TEST_SUPABASE_STORAGE_BUCKET',
  );
  for (const key of [
    'invalid-base64-secret',
    Buffer.alloc(32).toString('base64'),
    randomBytes(31).toString('base64'),
    source.TEST_WORKSPACE_ENCRYPTION_KEY.replace(/=$/, ''),
  ]) {
    rejected({ ...source, TEST_WORKSPACE_ENCRYPTION_KEY: key }, 'TEST_WORKSPACE_ENCRYPTION_KEY');
  }
  for (const field of ['WORKSPACE_ENCRYPTION_KEY', 'PRODUCTION_WORKSPACE_ENCRYPTION_KEY']) {
    rejected(
      { ...source, [field]: source.TEST_WORKSPACE_ENCRYPTION_KEY },
      'TEST_WORKSPACE_ENCRYPTION_KEY',
    );
  }
});

test('public report and CLI never print runtime secrets, connection strings or unsafe URLs', () => {
  const source = fixture();
  source.TEST_DATABASE_ADMIN_URL = `postgresql://postgres:admin-secret-sentinel@db.${TEST_REF}.supabase.co/postgres?sslmode=require`;
  const { publicReport } = validatePr160TestEnvironment(source);
  const forbidden = [
    source.TEST_DATABASE_URL,
    source.TEST_DATABASE_ADMIN_URL,
    source.TEST_SUPABASE_PUBLISHABLE_KEY,
    source.TEST_SUPABASE_SERVICE_ROLE_KEY,
    source.TEST_WORKSPACE_ENCRYPTION_KEY,
    'test-only-password',
    'admin-secret-sentinel',
  ];
  const cli = spawnSync(process.execPath, [SCRIPT], { env: { ...source }, encoding: 'utf8' });
  assert.equal(cli.status, 0);
  assert.equal(cli.stderr, '');
  assert.deepEqual(JSON.parse(cli.stdout), publicReport);
  for (const secret of forbidden) assert.equal(cli.stdout.includes(secret), false);

  for (const [field, value] of [
    ['TEST_WEB_ORIGIN', 'https://user:password-sentinel@production.invalid'],
    ['TEST_DATABASE_URL', 'postgres://postgres:db-secret-sentinel@production.invalid/postgres'],
    ['TEST_SUPABASE_SERVICE_ROLE_KEY', 'invalid-secret-sentinel'],
  ]) {
    const failed = spawnSync(process.execPath, [SCRIPT], {
      env: { ...source, [field]: value },
      encoding: 'utf8',
    });
    assert.equal(failed.status, 1);
    assert.equal(failed.stdout, '');
    assert.equal(failed.stderr, `Invalid TEST configuration: ${field}\n`);
    assert.equal(failed.stderr.includes(value), false);
  }
});

test('unexpected caller failures are reduced to a generic environment error', () => {
  const source = fixture();
  Object.defineProperty(source, 'TEST_DATABASE_URL', {
    get() {
      throw new Error('unexpected-secret-sentinel');
    },
  });
  rejected(source, 'ENVIRONMENT');
});
