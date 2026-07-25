import { describe, expect, it } from 'vitest';
import {
  APP_ROLE_NAME,
  assertUsableRolePassword,
  buildGrantConnectSql,
  buildGrantLoginSql,
  derivePoolerUsername,
  quoteSqlLiteral,
} from './sql-literal.js';

/**
 * `ALTER ROLE ... PASSWORD` cannot take a bind parameter, so the password is
 * embedded in the statement text. These tests are the whole safety net for
 * that: they run without a database and must keep running in CI.
 */

// Built with fromCharCode so the fixtures cannot be quietly "fixed" by an
// editor normalising escapes, and so control characters never appear literally
// in this file.
const QUOTE = String.fromCharCode(39);
const BACKSLASH = String.fromCharCode(92);
const NUL = String.fromCharCode(0);
const NEWLINE = String.fromCharCode(10);

/** Long enough to clear the length rule; the interesting part is the quoting. */
const NASTY_PASSWORD = `pw${QUOTE}${BACKSLASH}x${QUOTE}${QUOTE}0123456789abcdefgh`;

describe('quoteSqlLiteral', () => {
  it('wraps a plain value in single quotes', () => {
    expect(quoteSqlLiteral('plain')).toBe(`${QUOTE}plain${QUOTE}`);
  });

  it('doubles an embedded single quote', () => {
    expect(quoteSqlLiteral(`a${QUOTE}b`)).toBe(`${QUOTE}a${QUOTE}${QUOTE}b${QUOTE}`);
  });

  it('uses the E-string form when the value contains a backslash', () => {
    // E'' makes the escaping independent of standard_conforming_strings.
    const quoted = quoteSqlLiteral(`a${BACKSLASH}b`);
    expect(quoted.trimStart()).toBe(`E${QUOTE}a${BACKSLASH}${BACKSLASH}b${QUOTE}`);
  });

  it('rejects a NUL byte rather than truncating it', () => {
    expect(() => quoteSqlLiteral(`a${NUL}b`)).toThrow(/NUL/);
  });
});

describe('buildGrantLoginSql', () => {
  it('produces the expected statement for a simple password', () => {
    expect(buildGrantLoginSql(APP_ROLE_NAME, 'abcdefghijklmnopqrstuvwx')).toBe(
      `alter role "caredesk_app" with login nobypassrls password ` +
        `${QUOTE}abcdefghijklmnopqrstuvwx${QUOTE}`,
    );
  });

  it('keeps a quote-and-backslash password entirely inside one literal', () => {
    const sql = buildGrantLoginSql(APP_ROLE_NAME, NASTY_PASSWORD);
    const literal = sql.slice(sql.indexOf('password ') + 'password '.length).trim();

    // The literal is an E-string (backslash present) and is closed exactly once.
    expect(literal.startsWith(`E${QUOTE}`)).toBe(true);
    expect(literal.endsWith(QUOTE)).toBe(true);

    // Every quote inside the body is doubled, so nothing terminates the literal
    // early — the classic injection escape. Strip the doubled pairs and there
    // must be no stray quote left in the body.
    const body = literal.slice(2, -1);
    expect(body.split(`${QUOTE}${QUOTE}`).join('')).not.toContain(QUOTE);

    // Backslashes are doubled too, so `\'` cannot smuggle a quote through.
    expect(body).toContain(`${BACKSLASH}${BACKSLASH}`);

    // And nothing escaped into statement position.
    expect(sql).not.toContain(';');
  });

  it('contains no statement separator for an injection-shaped password', () => {
    const payload = `x${QUOTE}; drop table tenant; --aaaaaaaaaaaaaaaaaaaaaa`;
    const sql = buildGrantLoginSql(APP_ROLE_NAME, payload);

    // The payload survives verbatim only *inside* the literal: the statement
    // still starts with the ALTER ROLE and the semicolons are quoted data.
    expect(sql.startsWith('alter role "caredesk_app" with login nobypassrls password ')).toBe(true);
    const literal = sql.slice(sql.indexOf('password ') + 'password '.length).trim();
    expect(literal.startsWith(QUOTE)).toBe(true);
    expect(literal.endsWith(QUOTE)).toBe(true);
    const body = literal.slice(1, -1);
    expect(body.split(`${QUOTE}${QUOTE}`).join('')).not.toContain(QUOTE);
  });

  it('refuses an unexpected role name instead of quoting it', () => {
    expect(() =>
      buildGrantLoginSql('caredesk_app"; drop role x', 'abcdefghijklmnopqrstuvwx'),
    ).toThrow(/unexpected role name/);
  });

  it('refuses a short password', () => {
    expect(() => buildGrantLoginSql(APP_ROLE_NAME, 'short')).toThrow(/too short/);
  });
});

describe('assertUsableRolePassword', () => {
  it('accepts a long password with punctuation', () => {
    expect(() => {
      assertUsableRolePassword(NASTY_PASSWORD);
    }).not.toThrow();
  });

  it('rejects a password with an embedded newline', () => {
    expect(() => {
      assertUsableRolePassword(`abcdefghijklmnopqrstuvwx${NEWLINE}`);
    }).toThrow(/control character/);
  });

  it('rejects a password with a NUL byte', () => {
    expect(() => {
      assertUsableRolePassword(`abcdefghijklmnopqrstuvwx${NUL}`);
    }).toThrow(/NUL/);
  });
});

describe('buildGrantConnectSql', () => {
  it('interpolates the database name server-side, not in JS', () => {
    const sql = buildGrantConnectSql(APP_ROLE_NAME);
    expect(sql).toContain('current_database()');
    expect(sql).toContain(`${QUOTE}caredesk_app${QUOTE}`);
  });
});

describe('derivePoolerUsername', () => {
  it('carries the Supavisor project-ref suffix over to the app role', () => {
    expect(
      derivePoolerUsername(
        'postgresql://postgres.abcdefgh:pw@aws-1-eu.pooler.supabase.com:5432/postgres',
        APP_ROLE_NAME,
      ),
    ).toBe('caredesk_app.abcdefgh');
  });

  it('returns undefined for a plain (non-pooler) username', () => {
    expect(
      derivePoolerUsername('postgres://postgres:pw@localhost:5432/caredesk_dev', APP_ROLE_NAME),
    ).toBeUndefined();
  });

  it('returns undefined for an unparseable URL', () => {
    expect(derivePoolerUsername('not a url', APP_ROLE_NAME)).toBeUndefined();
  });
});
