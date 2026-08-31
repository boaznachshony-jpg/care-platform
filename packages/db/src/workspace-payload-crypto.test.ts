import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  countPopulatedEntries,
  decryptPayload,
  encryptPayload,
  isEncryptedEnvelope,
  keyFingerprint,
} from './workspace-payload-crypto.js';

const TENANT = '5b1a956d-7319-49e9-84dc-583af6fcf6d1';
const OTHER_TENANT = '6dc92e6d-4fa1-4e2a-a9a2-764d8ff85ef9';

function key(): string {
  return randomBytes(32).toString('base64');
}

const PAYLOAD = { 'caredesk.mvp.profile': '{"name":"אילנה נחשוני"}', empty: '' };

describe('keyFingerprint', () => {
  it('names a key without revealing it', () => {
    const encoded = key();
    const id = keyFingerprint(encoded);
    expect(id).toMatch(/^[0-9a-f]{16}$/);
    expect(encoded).not.toContain(id);
  });

  it('is stable for the same key and different for another', () => {
    const a = key();
    expect(keyFingerprint(a)).toBe(keyFingerprint(a));
    expect(keyFingerprint(a)).not.toBe(keyFingerprint(key()));
  });

  it('rejects a key that is not 32 bytes, rather than naming a broken one', () => {
    expect(() => keyFingerprint(randomBytes(16).toString('base64'))).toThrow(/32 bytes/);
  });
});

describe('rotation', () => {
  it('writes with the first key and records which one it used', () => {
    const next = key();
    const previous = key();
    const envelope = encryptPayload(PAYLOAD, TENANT, [next, previous]);
    expect(isEncryptedEnvelope(envelope)).toBe(true);
    expect(envelope.keyId).toBe(keyFingerprint(next));
  });

  it('still opens a row sealed before keyId existed', () => {
    // The production rows written before this field. They carry no keyId at
    // all, so the reader has to find the key by trying - and must succeed even
    // when the retired key is no longer the one being written with.
    const retired = key();
    const legacy = { ...encryptPayload(PAYLOAD, TENANT, retired) };
    delete legacy.keyId;

    expect(decryptPayload(legacy, TENANT, [key(), retired])).toEqual(PAYLOAD);
  });

  it('names the missing key instead of failing anonymously', () => {
    const envelope = encryptPayload(PAYLOAD, TENANT, key());
    expect(() => decryptPayload(envelope, TENANT, key())).toThrow(
      new RegExp(`keyId ${envelope.keyId}`),
    );
  });

  it('reads both generations during a rotation window', () => {
    const previous = key();
    const next = key();
    const oldRow = encryptPayload({ era: 'before' }, TENANT, previous);
    const newRow = encryptPayload({ era: 'after' }, TENANT, [next, previous]);

    expect(decryptPayload(oldRow, TENANT, [next, previous])).toEqual({ era: 'before' });
    expect(decryptPayload(newRow, TENANT, [next, previous])).toEqual({ era: 'after' });
  });

  it('refuses to read when no key is configured at all', () => {
    const envelope = encryptPayload(PAYLOAD, TENANT, key());
    expect(() => decryptPayload(envelope, TENANT, [])).toThrow(/without its encryption key/);
    expect(() => decryptPayload(envelope, TENANT, undefined)).toThrow(/without its encryption key/);
  });
});

describe('tenant binding survives rotation', () => {
  it('will not open a payload under a different tenant, whichever key is offered', () => {
    // The tenant id is the AAD. Adding a key list must not weaken that: a row
    // moved between tenants has to stay shut even when the correct key is
    // present, because the key is not what authorises the read.
    const encoded = key();
    const envelope = encryptPayload(PAYLOAD, TENANT, encoded);
    expect(() => decryptPayload(envelope, OTHER_TENANT, [encoded])).toThrow();
  });
});

describe('countPopulatedEntries', () => {
  it('counts non-empty entries without returning their contents', () => {
    const envelope = encryptPayload(PAYLOAD, TENANT, key());
    expect(countPopulatedEntries(envelope, TENANT, [key()])).toBeNull();
  });

  it('returns a count when a matching key is present', () => {
    const encoded = key();
    const envelope = encryptPayload(PAYLOAD, TENANT, encoded);
    // One populated entry; the empty string is deliberately not counted,
    // because the incident this detector exists for turned entries into "".
    expect(countPopulatedEntries(envelope, TENANT, [encoded])).toBe(1);
  });
});
