/* global console, process */
/**
 * N1 (work plan 16.10.2026) - tests must never run against a stale `dist/`.
 *
 * WHAT WENT WRONG
 * ---------------
 * Every workspace package is consumed through its compiled `dist/` (each
 * package.json points `main` at ./dist/index.js), and `dist/` is gitignored.
 * `pnpm test` does not build. So a test in apps/web or apps/api that imports
 * `@caredesk/schemas` runs against whatever was compiled last - possibly days
 * and several contract changes ago. That is how #123 was held up by a
 * "blocker" that existed only in an old dist/, and the same mechanism hides
 * any contract change made in a package but not yet rebuilt: the test passes
 * against the old contract, or fails against code nobody wrote.
 *
 * WHAT IS CHECKED
 * ---------------
 * For every package under packages/ that has a build script and a tsconfig
 * with rootDir/outDir, every non-test source file is compared with the file
 * the build emits for it:
 *
 *   src/foo.ts, src/foo.tsx   ->  dist/foo.js   (must exist and be newer)
 *   src/foo.json, src/foo.css ->  dist/foo.json / dist/foo.css, when the
 *                                 build emits one (compared if present)
 *
 * A source file newer than its output, or a TypeScript source with no output
 * at all, means `dist/` does not reflect `src/`. The check fails and names
 * the package and the file. It never builds by itself: a slow hidden build
 * inside `pnpm test` would just move the surprise somewhere else.
 *
 * Test files are skipped - consumers never import them, so a test edited
 * since the last build cannot change what another package sees.
 *
 * Runs as the root `pretest` hook, so `pnpm test` at the repo root refuses to
 * start on a stale build. CI builds before it tests, so there it always
 * passes; its job is the local run, where nobody builds first.
 *
 * Usage:
 *   node scripts/check-dist-freshness.mjs              check this repository
 *   node scripts/check-dist-freshness.mjs --root DIR   check another tree
 *   node scripts/check-dist-freshness.mjs --demo-failure
 *        build a throwaway stale package in a temp dir and show the failure
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix, relative, sep } from 'node:path';

function flag(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index !== -1 ? process.argv[index + 1] : undefined;
}

const TEST_SOURCE = /\.(test|spec)\.tsx?$/;
const TS_SOURCE = /\.tsx?$/;
const DECLARATION = /\.d\.ts$/;
const ASSET_SOURCE = /\.(json|css)$/;
const MAX_FILES_LISTED = 5;

function toPosix(path) {
  return path.split(sep).join(posix.sep);
}

function walk(dir, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') walk(child, files);
    } else {
      files.push(child);
    }
  }
  return files;
}

/** tsconfig.json may carry comments; the ones in this repo do not, but be lenient. */
function readTsconfig(path) {
  const text = readFileSync(path, 'utf8').replace(/^\s*\/\/.*$/gm, '');
  return JSON.parse(text);
}

function packagesUnder(root) {
  const packagesDir = join(root, 'packages');
  if (!existsSync(packagesDir)) return [];
  const found = [];
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(packagesDir, entry.name);
    const manifestPath = join(dir, 'package.json');
    const tsconfigPath = join(dir, 'tsconfig.json');
    if (!existsSync(manifestPath) || !existsSync(tsconfigPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (!manifest.scripts?.build) continue;
    const options = readTsconfig(tsconfigPath).compilerOptions ?? {};
    if (!options.rootDir || !options.outDir) continue;
    found.push({
      name: manifest.name ?? entry.name,
      dir,
      srcDir: join(dir, options.rootDir),
      outDir: join(dir, options.outDir),
    });
  }
  return found;
}

function findStaleOutputs(root) {
  const stale = [];
  for (const pkg of packagesUnder(root)) {
    if (!existsSync(pkg.srcDir)) continue;
    if (!existsSync(pkg.outDir)) {
      stale.push({ name: pkg.name, dir: pkg.dir, problems: [{ source: '', reason: '' }] });
      continue;
    }
    const problems = [];
    for (const source of walk(pkg.srcDir)) {
      const rel = relative(pkg.srcDir, source);
      if (TEST_SOURCE.test(rel) || DECLARATION.test(rel)) continue;
      let output;
      let required;
      if (TS_SOURCE.test(rel)) {
        output = join(pkg.outDir, rel.replace(TS_SOURCE, '.js'));
        required = true;
      } else if (ASSET_SOURCE.test(rel)) {
        output = join(pkg.outDir, rel);
        required = false;
      } else {
        continue;
      }
      if (!existsSync(output)) {
        if (required) problems.push({ source: rel, reason: 'has never been built' });
        continue;
      }
      if (statSync(source).mtimeMs > statSync(output).mtimeMs) {
        problems.push({ source: rel, reason: 'changed since the last build' });
      }
    }
    if (problems.length) stale.push({ name: pkg.name, dir: pkg.dir, problems });
  }
  return stale;
}

function report(stale, root) {
  console.error('dist/ freshness check failed - tests would run against an old build:\n');
  for (const pkg of stale) {
    console.error(`  - ${pkg.name} (${toPosix(relative(root, pkg.dir)) || '.'})`);
    for (const problem of pkg.problems.slice(0, MAX_FILES_LISTED)) {
      console.error(
        problem.source
          ? `      src/${toPosix(problem.source)} ${problem.reason}`
          : '      dist/ does not exist - this package has never been built',
      );
    }
    if (pkg.problems.length > MAX_FILES_LISTED) {
      console.error(`      ...and ${pkg.problems.length - MAX_FILES_LISTED} more`);
    }
  }
  console.error(
    '\n  Every package is consumed through its gitignored dist/, and `pnpm test`\n' +
      '  does not build. Rebuild first (PowerShell, at the repository root):\n\n' +
      '      pnpm build\n\n' +
      '  then run the tests again.',
  );
}

function demoFailure() {
  const root = mkdtempSync(join(tmpdir(), 'dist-freshness-demo-'));
  try {
    const pkg = join(root, 'packages', 'demo');
    mkdirSync(join(pkg, 'src'), { recursive: true });
    mkdirSync(join(pkg, 'dist'), { recursive: true });
    writeFileSync(
      join(pkg, 'package.json'),
      JSON.stringify({ name: '@demo/stale', scripts: { build: 'tsc' } }),
    );
    writeFileSync(
      join(pkg, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { rootDir: 'src', outDir: 'dist' } }),
    );
    writeFileSync(join(pkg, 'dist', 'contract.js'), 'export const SECTIONS = ["case"];\n');
    writeFileSync(join(pkg, 'src', 'contract.ts'), "export const SECTIONS = ['case', 'x'];\n");
    writeFileSync(join(pkg, 'src', 'added.ts'), 'export const ADDED = true;\n');
    const built = new Date(Date.now() - 60_000);
    utimesSync(join(pkg, 'dist', 'contract.js'), built, built);
    const stale = findStaleOutputs(root);
    if (!stale.length) {
      console.error('demo-failure: the stale fixture was NOT detected - the check is broken.');
      return 2;
    }
    report(stale, root);
    return 1;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

if (process.argv.includes('--demo-failure')) {
  process.exit(demoFailure());
}

const root = flag('root') ?? process.cwd();
const stale = findStaleOutputs(root);
if (stale.length) {
  report(stale, root);
  process.exit(1);
}
console.log(`dist/ freshness check passed (${packagesUnder(root).length} packages).`);
