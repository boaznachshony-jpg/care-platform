import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const sql = readFileSync(
  new URL('../../../database/migrations/0024_wave4_automation.sql', import.meta.url),
  'utf8',
);
describe('Wave 4 automation persistence', () => {
  it.each(['document_intake_review', 'event_action_plan'])('forces tenant RLS for %s', (table) => {
    expect(sql).toContain(`alter table ${table} enable row level security`);
    expect(sql).toContain(`alter table ${table} force row level security`);
    expect(sql).toMatch(
      new RegExp(
        `policy ${table}_tenant_isolation[\\s\\S]*using \\(tenant_id = app.current_tenant_id\\(\\)\\)[\\s\\S]*with check`,
        'i',
      ),
    );
  });
  it('does not persist raw prompts, OCR, or responses', () => {
    expect(sql).not.toMatch(/raw_(?:prompt|response|ocr)/i);
  });
});
