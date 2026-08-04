import { describe, expect, it } from 'vitest';
import {
  findDestructiveMigrationStatements,
  parseNameStatus,
  validateMigrationChanges,
} from './migration-safety.js';

describe('findDestructiveMigrationStatements', () => {
  it('accepts an additive migration', () => {
    expect(
      findDestructiveMigrationStatements(`
        alter table task add column if not exists reminder_days integer;
        create index if not exists task_reminder_idx on task (reminder_days);
      `),
    ).toEqual([]);
  });

  it('rejects data deletion and destructive schema changes', () => {
    const findings = findDestructiveMigrationStatements(`
      delete from task;
      alter table task drop column title;
    `);

    expect(findings.map(({ rule }) => rule)).toEqual(['delete-from', 'drop-column']);
  });

  it('does not treat comments and string values as executable SQL', () => {
    expect(
      findDestructiveMigrationStatements(`
        -- Never run: drop table task;
        insert into audit_event (event_type) values ('delete from task');
      `),
    ).toEqual([]);
  });

  it('checks statements inside a dollar-quoted migration block', () => {
    const findings = findDestructiveMigrationStatements(`
      do $$
      begin
        delete from task;
      end
      $$;
    `);

    expect(findings.map(({ rule }) => rule)).toContain('delete-from');
  });
});

describe('parseNameStatus', () => {
  it('preserves both paths of a rename', () => {
    expect(
      parseNameStatus(
        'A\tdatabase/migrations/0018_add_reminders.sql\nR100\tdatabase/migrations/0001_baseline.sql\tdatabase/migrations/0001_changed.sql',
      ),
    ).toEqual([
      { status: 'A', paths: ['database/migrations/0018_add_reminders.sql'] },
      {
        status: 'R100',
        paths: ['database/migrations/0001_baseline.sql', 'database/migrations/0001_changed.sql'],
      },
    ]);
  });
});

describe('validateMigrationChanges', () => {
  it('allows a new additive numbered migration', async () => {
    const errors = await validateMigrationChanges(
      [{ status: 'A', paths: ['database/migrations/0018_add_reminders.sql'] }],
      async () => 'alter table task add column reminder_days integer;',
    );

    expect(errors).toEqual([]);
  });

  it('blocks edits to an existing migration', async () => {
    const errors = await validateMigrationChanges(
      [{ status: 'M', paths: ['database/migrations/0008_documents.sql'] }],
      async () => '',
    );

    expect(errors.join('\n')).toMatch(/immutable/);
  });

  it('blocks a destructive new migration', async () => {
    const errors = await validateMigrationChanges(
      [{ status: 'A', paths: ['database/migrations/0018_cleanup.sql'] }],
      async () => 'truncate table document;',
    );

    expect(errors.join('\n')).toMatch(/TRUNCATE/);
  });
});
