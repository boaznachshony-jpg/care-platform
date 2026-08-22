/* global console, process */
/**
 * Guards a failure class that `tsc` cannot catch: a relative import that
 * resolves against the WORKING TREE but not against the committed tree.
 *
 * This happened for real. A branch was built on a stale base that predated
 * the commit adding `format-timestamp.ts`. Locally every check passed - the
 * file was sitting right there in the working tree - but the Vercel build
 * died with "Could not resolve ../format-timestamp.js", because the file was
 * never part of that commit. Type-checking cannot see this: tsc reads the
 * working tree, and the working tree was fine.
 *
 * So this check deliberately asks git, not the filesystem: for every tracked
 * source file, does every relative import resolve to another TRACKED file?
 *
 * Run: node scripts/check-imports-resolve.mjs   (wired into `pnpm lint`)
 */
import { execSync } from 'node:child_process';
import { dirname, normalize, join } from 'node:path';

function git(args) {
  return execSync(`git ${args}`, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

// Both the file list and the file contents are read from the SAME ref, so the
// two can never disagree. CHECK_REF exists so the guard itself can be verified
// against any branch instead of only whatever happens to be checked out.
const ref = process.env.CHECK_REF || 'HEAD';
const tracked = new Set(
  git(`ls-tree -r --name-only ${JSON.stringify(ref)}`)
    .split('\n')
    .filter(Boolean),
);
const sources = [...tracked].filter(
  (f) =>
    (f.endsWith('.ts') || f.endsWith('.tsx') || f.endsWith('.mjs') || f.endsWith('.js')) &&
    !f.includes('/dist/'),
);

const IMPORT = /(?:from|import)\s*\(?\s*['"](\.[^'"]+)['"]/g;
const problems = [];
let checked = 0;

for (const file of sources) {
  let contents;
  try {
    contents = git(`show ${JSON.stringify(`${ref}:${file}`)}`);
  } catch {
    continue;
  }
  for (const match of contents.matchAll(IMPORT)) {
    const spec = match[1];
    checked += 1;
    const base = normalize(join(dirname(file), spec))
      .split('\\')
      .join('/');
    // TypeScript ESM writes `./x.js` for a file that lives on disk as `x.ts`.
    // Imports that point into a build output are correct by design - the
    // target is generated during the build and is never tracked.
    if (base.includes('/dist/') || base.startsWith('dist/')) continue;
    const stem = base.endsWith('.js') ? base.slice(0, -3) : base;
    const candidates = [base, `${stem}.ts`, `${stem}.tsx`, `${stem}/index.ts`, `${stem}/index.tsx`];
    if (!candidates.some((candidate) => tracked.has(candidate))) {
      problems.push(`${file} -> ${spec}`);
    }
  }
}

if (problems.length > 0) {
  console.error('Unresolvable relative imports (the bundler will fail on these):\n');
  for (const problem of problems) console.error(`  ${problem}`);
  console.error(
    '\nThe target is not a tracked file. Usually the import is fine locally but the\n' +
      'file was never committed, or the branch was built on a base that predates it.',
  );
  process.exit(1);
}

console.log(
  `Import resolution check passed (${checked} relative imports across ${sources.length} files).`,
);
