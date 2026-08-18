import { describe, expect, it } from 'vitest';
import { isAllowedTransition } from './state-machine.js';

describe('workflow instance state machine', () => {
  it('allows not_started -> active', () => {
    expect(isAllowedTransition('not_started', 'active')).toBe(true);
  });

  it('rejects a terminal state re-entering active', () => {
    expect(isAllowedTransition('completed', 'active')).toBe(false);
    expect(isAllowedTransition('cancelled', 'active')).toBe(false);
  });

  it('rejects skipping straight from not_started to completed', () => {
    expect(isAllowedTransition('not_started', 'completed')).toBe(false);
  });
});
