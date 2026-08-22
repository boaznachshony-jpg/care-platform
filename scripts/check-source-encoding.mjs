#!/usr/bin/env node
/**
 * Guards against a failure class that kept reaching CI: a stray non-ASCII
 * character injected at the very start of a source file (for example an em
 * dash pasted in place of the "i" of `import`). Prettier and tsc both abort
 * with an opaque "Invalid character" / Unexpected "—" error, which costs a
 * full CI round trip to diagnose.
 *
 * The check is deliberately narrow so it never fights legitimate content:
 * Hebrew strings, comments and JSX text stay untouched. It only rejects
 * characters that cannot appear in TypeScript/JavaScript syntax outside a
 * string or comment — em/en dashes, smart quotes, non-breaking spaces and
 * zero-width marks — and only when the file's FIRST line contains one, which
 * is where the corruption has always landed.
 *
 * Run: node scripts/check-source-encoding.mjs   (wired into `pnpm lint`)
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const FORBIDDEN = /[‐-―‘’“” ​-‍﻿]/;

const NAMES = {
  '‐': 'hyphen (U+2010)',
  '‑': 'non-breaking hyphen (U+2011)',
  '‒': 'figure dash (U+2012)',
  '–': 'en dash (U+2013)',
  '—': 'em dash (U+2014)',
  '―': 'horizontal bar (U+2015)',
  '‘': 'left smart quote (U+2018)',
  '’': 'right smart quote (U+2019)',
  '“': 'left smart double quote (U+201C)',
  '”': 'right smart double quote (U+201D)',
  ' ': 'non-breaking space (U+00A0)',
  '​': 'zero-width space (U+200B)',
  '‌': 'zero-width non-joiner (U+200C)',
  '‍': 'zero-width joiner (U+200D)',
  '﻿': 'byte order mark (U+FEFF)',
};

function trackedSourceFiles() {
  const output = execSync('git ls-files "*.ts" "*.tsx" "*.mjs" "*.js"', {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  return output.split('\n').filter(Boolean);
}

const problems = [];
for (const file of trackedSourceFiles()) {
  let firstLine;
  try {
    firstLine = readFileSync(file, 'utf8').split('\n', 1)[0] ?? '';
  } catch {
    continue;
  }
  const match = FORBIDDEN.exec(firstLine);
  if (match) {
    const char = match[0];
    problems.push(
      `${file}:1:${match.index + 1} — ${NAMES[char] ?? JSON.stringify(char)} at the start of the file`,
    );
  }
}

if (problems.length > 0) {
  console.error('Source encoding check failed. Fix these characters before committing:\n');
  for (const problem of problems) console.error(`  ${problem}`);
  console.error(
    '\nThese break `prettier --check` and `tsc` with an opaque "Invalid character" error.',
  );
  process.exit(1);
}

console.log(`Source encoding check passed (${trackedSourceFiles().length} files).`);
