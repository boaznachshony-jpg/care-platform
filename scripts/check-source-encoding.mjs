/* global console, process */
/**
 * Guards against a failure class that kept reaching CI: a stray non-ASCII
 * character injected at the very start of a source file (for example an em-
 * dash pasted in place of the "i" of `import`). Prettier and tsc both abort
 * with an opaque "Invalid character" / Unexpected character error, which costs
 * a full CI round trip to diagnose.
 *
 * The check is deliberately narrow so it never fights legitimate content:
 * Hebrew strings, comments and JSX text stay untouched. It only rejects
 * characters that cannot appear in TypeScript/JavaScript syntax outside a
 * string or comment: dashes, smart quotes, non-breaking spaces and
 * zero-width marks - and only when the file's FIRST line contains one, which
 * is where the corruption has always landed.
 *
 * Every forbidden character is written as an escape here on purpose: this file
 * must stay pure ASCII so it can never trip the rule it enforces.
 *
 * Run: node scripts/check-source-encoding.mjs   (wired into `pnpm lint`)
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const FORBIDDEN = [
  ['\u2010', 'hyphen (U+2010)'],
  ['\u2011', 'non-breaking hyphen (U+2011)'],
  ['\u2012', 'figure dash (U+2012)'],
  ['\u2013', 'en dash (U+2013)'],
  ['\u2014', 'em dash (U+2014)'],
  ['\u2015', 'horizontal bar (U+2015)'],
  ['\u2018', 'left smart quote (U+2018)'],
  ['\u2019', 'right smart quote (U+2019)'],
  ['\u201C', 'left smart double quote (U+201C)'],
  ['\u201D', 'right smart double quote (U+201D)'],
  ['\u00A0', 'non-breaking space (U+00A0)'],
  ['\u200B', 'zero-width space (U+200B)'],
  ['\u200C', 'zero-width non-joiner (U+200C)'],
  ['\u200D', 'zero-width joiner (U+200D)'],
  ['\uFEFF', 'byte order mark (U+FEFF)'],
];

function trackedSourceFiles() {
  const output = execSync('git ls-files "*.ts" "*.tsx" "*.mjs" "*.js"', {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  return output.split('\n').filter(Boolean);
}

const files = trackedSourceFiles();
const problems = [];

for (const file of files) {
  let firstLine;
  try {
    firstLine = readFileSync(file, 'utf8').split('\n', 1)[0] ?? '';
  } catch {
    continue;
  }
  for (const [char, name] of FORBIDDEN) {
    const index = firstLine.indexOf(char);
    if (index !== -1) {
      problems.push(`${file}:1:${index + 1} - ${name} at the start of the file`);
      break;
    }
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

console.log(`Source encoding check passed (${files.length} files).`);
