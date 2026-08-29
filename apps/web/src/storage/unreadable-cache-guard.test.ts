import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { captureMvpWorkspace } from './mvp-storage.js';
import { canUseCachedWorkspace } from './workspace-sync.js';

/**
 * The defect that emptied a customer's account.
 *
 * The device cache is encrypted with a key kept in sessionStorage, while the
 * data itself is kept in localStorage. sessionStorage dies with the browser
 * session and localStorage does not, so a returning visitor reliably holds
 * data they can no longer decrypt. captureMvpWorkspace turned each of those
 * failures into an empty string, the sync layer saw a complete, well-formed
 * snapshot, and the server accepted it - replacing every real value with ''.
 *
 * Nothing in the request looked wrong. The only place the truth was visible
 * was at the moment of the failed read, and it was discarded there.
 */

const KEY = 'caredesk.mvp.clients.v1';
const OWNER_KEY = 'caredesk.workspace-owner.v1';
const CACHE_KEY_NAME = 'caredesk.cache-key.v1';

/** Stored by an earlier session, under a key this session does not have. */
const CIPHERTEXT_FROM_A_DEAD_SESSION =
  'caredesk-encrypted-v1:0102030405060708090a0b0c:deadbeefdeadbeefdeadbeef';

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe('captureMvpWorkspace with an unreadable device cache', () => {
  it('reports the unreadable key instead of publishing it as an empty value', () => {
    window.localStorage.setItem(KEY, CIPHERTEXT_FROM_A_DEAD_SESSION);

    const capture = captureMvpWorkspace();

    expect(capture.unreadableKeys).toBe(1);
    // The critical assertion: the key is absent, not present-and-blank. A
    // blank value is indistinguishable from a customer clearing the field.
    expect(Object.hasOwn(capture.entries, KEY)).toBe(false);
  });

  it('counts every unreadable key, not just the first', () => {
    for (let index = 0; index < 5; index += 1) {
      window.localStorage.setItem(`caredesk.mvp.key.${index}`, CIPHERTEXT_FROM_A_DEAD_SESSION);
    }
    expect(captureMvpWorkspace().unreadableKeys).toBe(5);
  });

  it('does not mistake a value that is genuinely empty for an unreadable one', () => {
    // Plaintext is accepted for legacy migration, so this reads back as ''.
    window.localStorage.setItem(KEY, '');

    const capture = captureMvpWorkspace();

    expect(capture.unreadableKeys).toBe(0);
    expect(capture.entries[KEY]).toBe('');
  });

  it('ignores keys outside the CareDesk business namespace', () => {
    window.localStorage.setItem('some.other.app', CIPHERTEXT_FROM_A_DEAD_SESSION);
    expect(captureMvpWorkspace().unreadableKeys).toBe(0);
  });
});

describe('canUseCachedWorkspace', () => {
  it('refuses a cache it cannot decrypt even when the owner marker matches', () => {
    window.localStorage.setItem(OWNER_KEY, 'user-1');
    window.localStorage.setItem(KEY, CIPHERTEXT_FROM_A_DEAD_SESSION);

    expect(canUseCachedWorkspace('user-1')).toBe(false);
  });

  it('accepts a cache written by this session', () => {
    // Force a known session key so the value below really round-trips.
    window.sessionStorage.setItem(CACHE_KEY_NAME, '00'.repeat(32));
    window.localStorage.setItem(OWNER_KEY, 'user-1');
    window.localStorage.setItem(KEY, '[]');

    expect(canUseCachedWorkspace('user-1')).toBe(true);
  });

  it('refuses a cache belonging to a different account', () => {
    window.localStorage.setItem(OWNER_KEY, 'user-2');
    expect(canUseCachedWorkspace('user-1')).toBe(false);
  });
});
