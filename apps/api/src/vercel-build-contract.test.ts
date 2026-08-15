import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const readApiFile = (path: string) =>
  readFile(fileURLToPath(new URL(`../${path}`, import.meta.url)), 'utf8');

describe('Vercel API build contract', () => {
  it('uses the API production build and keeps browser DOM types out of server TypeScript', async () => {
    const [vercel, tsconfig, buildConfig] = await Promise.all([
      readApiFile('vercel.json'),
      readApiFile('tsconfig.json'),
      readApiFile('tsconfig.build.json'),
    ]);

    expect(JSON.parse(vercel)).toMatchObject({
      buildCommand: 'pnpm --filter @caredesk/api... build',
    });
    expect(JSON.parse(tsconfig).compilerOptions).toMatchObject({
      lib: ['ES2022'],
      types: ['node'],
      noEmit: true,
    });
    expect(JSON.parse(buildConfig).compilerOptions).toMatchObject({ noEmit: false });
  });
});
