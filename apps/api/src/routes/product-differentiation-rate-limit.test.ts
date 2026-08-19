import { describe, expect, it } from 'vitest';
import { PRODUCT_DIFFERENTIATION_RATE_LIMITS } from './product-differentiation.js';

describe('product differentiation route rate limits', () => {
  it('defines a bounded typed policy for every authenticated route', () => {
    expect(PRODUCT_DIFFERENTIATION_RATE_LIMITS).toEqual({
      health: { max: 60, timeWindow: 60_000, bucket: 'health' },
      assistant: { max: 10, timeWindow: 60_000, bucket: 'assistant' },
      checklistConfirmation: { max: 20, timeWindow: 60_000, bucket: 'checklist' },
      reviewList: { max: 60, timeWindow: 60_000, bucket: 'review-list' },
      reviewCreate: { max: 10, timeWindow: 60_000, bucket: 'review-create' },
      reviewGet: { max: 60, timeWindow: 60_000, bucket: 'review-get' },
      reviewTransition: { max: 20, timeWindow: 60_000, bucket: 'review-transition' },
    });
  });
});
