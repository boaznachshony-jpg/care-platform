import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.js';

describe('loadEnv', () => {
  it('defaults to safe Milestone 0 values with an empty environment', () => {
    const env = loadEnv({});
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(4000);
    expect(env.AI_PROVIDER).toBe('mock');
  });

  it('rejects an AI_PROVIDER value outside the approved set', () => {
    expect(() => loadEnv({ AI_PROVIDER: 'some-other-vendor' })).toThrow();
  });
});
