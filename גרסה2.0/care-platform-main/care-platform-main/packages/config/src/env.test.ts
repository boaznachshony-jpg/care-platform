import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseEnv } from './env.js';

describe('parseEnv', () => {
  const schema = z.object({
    PORT: z.coerce.number().int().positive(),
  });

  it('parses a valid source', () => {
    expect(parseEnv(schema, { PORT: '4000' })).toEqual({ PORT: 4000 });
  });

  it('throws with every issue listed when invalid', () => {
    expect(() => parseEnv(schema, { PORT: 'not-a-number' })).toThrow(/PORT/);
  });
});
