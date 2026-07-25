import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';
import { PgAuditService } from '@caredesk/db';
import { InMemoryAuditService } from '@caredesk/infrastructure';
import { describe, expect, it } from 'vitest';
import { buildContainer } from './container.js';
import { loadEnv } from './env.js';

const MIGRATION = readFileSync(
  fileURLToPath(new URL('../../../database/migrations/0009_audit_event.sql', import.meta.url)),
  'utf8',
);

interface RecordedQuery {
  text: string;
  values?: unknown[];
}

/**
 * A pg-shaped stub. The point of these tests is the SQL and the transaction
 * envelope, which are exactly the parts a database-backed test would not show
 * us any more clearly, and which we can assert with no database available.
 */
function stubPool(): { pool: Pool; queries: RecordedQuery[] } {
  const queries: RecordedQuery[] = [];
  const client = {
    query: async (text: string, values?: unknown[]) => {
      queries.push({ text, values });
      return { rows: [], rowCount: 0 };
    },
    release: () => undefined,
  };
  const pool = { connect: async () => client } as unknown as Pool;
  return { pool, queries };
}

const EVENT = {
  tenantId: '00000000-0000-4000-8000-000000000001',
  actorId: '00000000-0000-4000-8000-000000000002',
  action: 'employment_case.opened',
  resourceType: 'employment_case',
  resourceId: '00000000-0000-4000-8000-000000000003',
  correlationId: 'corr-1',
  occurredAt: '2026-03-01T09:00:00.000Z',
  changeSummary: 'Employment case opened.',
  sensitivity: 'employment_sensitive',
} as const;

describe('PgAuditService append-only contract', () => {
  it('exposes recording only — no update, delete or purge on the port surface', () => {
    const { pool } = stubPool();
    const service = new PgAuditService(pool);

    const methods = new Set<string>();
    for (
      let proto: object | null = Object.getPrototypeOf(service) as object | null;
      proto !== null && proto !== Object.prototype;
      proto = Object.getPrototypeOf(proto) as object | null
    ) {
      for (const name of Object.getOwnPropertyNames(proto)) {
        if (name !== 'constructor') {
          methods.add(name);
        }
      }
    }

    expect([...methods]).toEqual(['record']);
  });

  it('writes a single plain insert — never an update, delete or upsert', async () => {
    const { pool, queries } = stubPool();
    await new PgAuditService(pool).record(EVENT);

    const statements = queries.map((q) => q.text.toLowerCase());
    const writes = statements.filter((text) => text.includes('audit_event'));
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain('insert into audit_event');
    expect(writes[0]).not.toContain('on conflict');
    for (const text of statements) {
      expect(text).not.toMatch(/\bupdate\s+audit_event\b/);
      expect(text).not.toMatch(/\bdelete\s+from\s+audit_event\b/);
    }
  });

  it('writes inside withTenant so RLS is enforced as the least-privilege role', async () => {
    const { pool, queries } = stubPool();
    await new PgAuditService(pool).record(EVENT);

    const statements = queries.map((q) => q.text.toLowerCase());
    expect(statements[0]).toBe('begin');
    expect(statements[1]).toBe('set local role caredesk_app');
    expect(statements[2]).toContain('set_config');
    expect(queries[2]?.values).toEqual([EVENT.tenantId]);
    expect(statements.at(-1)).toBe('commit');
  });

  it('persists exactly the port fields and nothing free-form', async () => {
    const { pool, queries } = stubPool();
    await new PgAuditService(pool).record(EVENT);

    const insert = queries.find((q) => q.text.includes('insert into audit_event'));
    expect(insert?.values).toEqual([
      EVENT.tenantId,
      EVENT.actorId,
      EVENT.action,
      EVENT.resourceType,
      EVENT.resourceId,
      EVENT.occurredAt,
      EVENT.correlationId,
      EVENT.changeSummary,
      EVENT.sensitivity,
    ]);
  });
});

describe('0009_audit_event.sql', () => {
  it('grants insert and select only — the application cannot rewrite the trail', () => {
    const grants = MIGRATION.split('\n').filter(
      (line) => line.trimStart().startsWith('grant') && line.includes('audit_event'),
    );
    expect(grants).toEqual(['grant select, insert on audit_event to caredesk_app;']);
  });

  it('enables and forces RLS with a policy carrying both using and with check', () => {
    expect(MIGRATION).toContain('alter table audit_event enable row level security;');
    expect(MIGRATION).toContain('alter table audit_event force row level security;');
    expect(MIGRATION).toContain('create policy audit_event_tenant_isolation on audit_event');
    expect(MIGRATION).toContain("using (tenant_id = current_setting('app.tenant_id', true)::uuid)");
    expect(MIGRATION).toContain(
      "with check (tenant_id = current_setting('app.tenant_id', true)::uuid)",
    );
  });

  it('indexes the blueprint §8 audit query patterns', () => {
    expect(MIGRATION).toContain('audit_event (tenant_id, occurred_at desc)');
    expect(MIGRATION).toContain('audit_event (resource_type, resource_id)');
  });

  it('has no free-form payload column that would invite dumping sensitive data', () => {
    const sql = MIGRATION.split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n');
    expect(sql).not.toMatch(/\bjsonb\b|\bjson\b|\bbytea\b/i);
    expect(MIGRATION).toContain('audit_event_change_summary_is_a_summary');
  });

  it('registers itself in schema_migrations', () => {
    expect(MIGRATION).toContain(
      "insert into schema_migrations (version) values ('0009_audit_event')",
    );
  });
});

describe('container audit wiring', () => {
  it('falls back to the in-memory mock when no DATABASE_URL is configured', () => {
    const container = buildContainer(loadEnv({}));
    expect(container.audit).toBeInstanceOf(InMemoryAuditService);
    expect(container.pool).toBeUndefined();
  });
});
