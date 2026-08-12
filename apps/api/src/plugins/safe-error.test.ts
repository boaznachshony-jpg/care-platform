import { describe, expect, it } from 'vitest';
import { safeErrorDetails } from './safe-error.js';

describe('safeErrorDetails', () => {
  it('does not retain messages, stacks, causes or sensitive provider payloads', () => {
    const secret = 'passport=123456789 bank=987654 document=base64-secret';
    const error = Object.assign(new Error(secret), {
      code: 'PROVIDER_REJECTED',
      statusCode: 502,
      cause: { identity: secret },
      response: { body: secret },
    });
    const serialized = JSON.stringify(safeErrorDetails(error));
    expect(serialized).toBe(
      '{"errorType":"Error","errorCode":"PROVIDER_REJECTED","statusCode":502}',
    );
    expect(serialized).not.toContain(secret);
  });
});
