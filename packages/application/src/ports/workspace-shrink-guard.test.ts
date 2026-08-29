import { describe, expect, it } from 'vitest';
import { isDestructiveShrink, populatedEntryCount } from './workspace-repository.js';

/**
 * The incident this guard exists for.
 *
 * The browser cache is encrypted with a key kept in sessionStorage while the
 * data itself sits in localStorage, so the data outlives the key. On a
 * returning visit every stored key was unreadable, and the capture turned each
 * failure into an empty string. The result was a perfectly well-formed save
 * request that replaced a populated account with a set of blank values, and
 * the optimistic version check waved it through because the version was
 * exactly the one that tab last saw.
 *
 * The client fix stops producing such a snapshot. This is the second line: the
 * server refuses to commit one even if some future client sends it.
 */

const populated = (count: number): Record<string, string> =>
  Object.fromEntries(
    Array.from({ length: count }, (_, index) => [`caredesk.mvp.key.${index}`, `value ${index}`]),
  );

const blanked = (source: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.keys(source).map((key) => [key, '']));

describe('populatedEntryCount', () => {
  it('does not count empty or whitespace-only values as data', () => {
    expect(populatedEntryCount({ a: 'x', b: '', c: '   ', d: '\n' })).toBe(1);
  });
});

describe('isDestructiveShrink', () => {
  it('rejects the exact failure that lost the account: every value blanked', () => {
    const current = populated(29);
    expect(isDestructiveShrink(current, blanked(current))).toBe(true);
  });

  it('rejects a wholesale replacement with an empty payload', () => {
    expect(isDestructiveShrink(populated(29), {})).toBe(true);
  });

  it('allows deleting one case out of several', () => {
    const current = populated(12);
    const afterDeletion = { ...current };
    delete afterDeletion['caredesk.mvp.key.0'];
    delete afterDeletion['caredesk.mvp.key.1'];
    expect(isDestructiveShrink(current, afterDeletion)).toBe(false);
  });

  it('allows ordinary editing that clears a few fields', () => {
    const current = populated(10);
    const edited = { ...current, 'caredesk.mvp.key.0': '', 'caredesk.mvp.key.1': '' };
    expect(isDestructiveShrink(current, edited)).toBe(false);
  });

  it('allows growth', () => {
    expect(isDestructiveShrink(populated(5), populated(9))).toBe(false);
  });

  // A brand-new account genuinely has almost nothing, and must not be locked
  // out of its own first few saves by a guard meant for populated accounts.
  it('never blocks a workspace that holds fewer than three populated entries', () => {
    expect(isDestructiveShrink(populated(2), {})).toBe(false);
    expect(isDestructiveShrink({}, {})).toBe(false);
  });

  it('blocks at the threshold and permits just above it', () => {
    // 9 populated entries: keeping 2 is destructive (2 * 3 < 9), keeping 3 is not.
    expect(isDestructiveShrink(populated(9), populated(2))).toBe(true);
    expect(isDestructiveShrink(populated(9), populated(3))).toBe(false);
  });
});
