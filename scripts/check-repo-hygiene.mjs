/* global console, process */
/**
 * Guards three cleanup decisions that have all silently reverted before, and
 * that together account for 12 of the repository's 13 Dependabot alerts.
 *
 *   1. ARCHIVED DIRECTORIES MUST NOT BE TRACKED.
 *      A full copy of an older release lives in the working folder. Nothing
 *      imports from it, nothing builds it - but the package manifests and lock
 *      files inside it are scanned by Dependabot, so a dead tree generates
 *      live security alerts. It is ignored by eslint and prettier already;
 *      this check is what keeps it out of git.
 *
 *   2. WINDOWS "- Copy" DUPLICATES MUST NOT BE TRACKED.
 *      The documentation duplicates are noise. The CONFIG duplicates are the
 *      real hazard: it costs about an hour to work out why edits to
 *      `eslint.config - Copy.js` change nothing.
 *
 *   3. EVERY OVERRIDE IN THE LOCK FILE MUST BE DECLARED.
 *      `pnpm-lock.yaml` carries an `overrides:` block pinning patched
 *      versions of transitive dependencies (nanoid, postcss, js-yaml,
 *      brace-expansion, fast-uri). If those pins exist ONLY in the lock file,
 *      the next dependency refresh regenerates the lock and every pin
 *      evaporates with no diff to notice. This check asserts that each pin in
 *      the lock is also declared in a source pnpm reads - `overrides:` in
 *      `pnpm-workspace.yaml` (pnpm 10+) or `pnpm.overrides` in
 *      `package.json`. It compares versions exactly, so it also catches a
 *      declaration that has drifted away from what is actually installed.
 *
 * VERIFYING THE GUARD
 * -------------------
 * A check nobody has watched fail is not a check. Point CHECK_HYGIENE_FIXTURE
 * at a directory holding a synthetic repository state and every rule above is
 * evaluated against that instead of the real repo:
 *
 *   node scripts/check-repo-hygiene.mjs
 *     -> passes against the real repository
 *
 *   pnpm lint:hygiene:demo-failure
 *   node scripts/check-repo-hygiene.mjs --fixture scripts/fixtures/repo-hygiene-violations
 *     -> fails, reporting one violation of each of the three rules
 *
 * (`CHECK_HYGIENE_FIXTURE=<dir>` does the same on a POSIX shell.)
 *
 * The fixture directory may contain any of `tracked-files.txt` (one path per
 * line), `pnpm-lock.yaml`, `pnpm-workspace.yaml` and `package.json`. Anything
 * absent falls back to the real file, so a fixture can exercise one rule at a
 * time.
 *
 * CHECK_REF additionally runs the tracked-file rules against a git ref rather
 * than the index, mirroring `check-imports-resolve.mjs`.
 *
 * Run: node scripts/check-repo-hygiene.mjs   (wired into `pnpm lint`)
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';

// Written as escapes so this file stays pure ASCII, in the same spirit as
// check-source-encoding.mjs. U+05D2 U+05E8 U+05E1 U+05D4 is the Hebrew word
// ("version") followed by "2.0", plus the self-nested export folder inside it.
const ARCHIVED_DIR_NAMES = ['\u05D2\u05E8\u05E1\u05D4' + '2.0', 'care-platform-main'];

// Matches "README - Copy.md", "package - Copy.json", "notes - Copy (2).txt"
// and an extensionless "config - Copy". Anchored on " - Copy" so a legitimate
// name such as "copy-button.tsx" is never touched.
const COPY_SUFFIX = /\s-\s[Cc]opy(\s\(\d+\))?(\..*)?$/;

// `--fixture <dir>` and CHECK_HYGIENE_FIXTURE are equivalent. The flag exists
// because `VAR=value cmd` is not valid syntax in cmd.exe or PowerShell, and
// this repository is developed on Windows - an env-var-only escape hatch would
// be undemonstrable for the person most likely to need it.
function flag(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index !== -1 ? process.argv[index + 1] : undefined;
}

const fixtureDir = flag('fixture') || process.env.CHECK_HYGIENE_FIXTURE || '';
const ref = flag('ref') || process.env.CHECK_REF || '';

function fixtureFile(name) {
  if (!fixtureDir) return null;
  const candidate = join(fixtureDir, name);
  return existsSync(candidate) ? candidate : null;
}

function readManifest(name) {
  const path = fixtureFile(name) || name;
  try {
    return { path, text: readFileSync(path, 'utf8') };
  } catch {
    return { path, text: '' };
  }
}

function trackedFiles() {
  const fixture = fixtureFile('tracked-files.txt');
  if (fixture) {
    return readFileSync(fixture, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'));
  }
  // -z is not optional: without it git applies core.quotepath and returns the
  // archive's Hebrew path as C-style octal escapes, which would never match
  // ARCHIVED_DIR_NAMES and the rule would pass while being wrong.
  const args = ref ? ['ls-tree', '-r', '--name-only', '-z', ref] : ['ls-files', '-z'];
  const out = execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return out.split('\0').filter(Boolean);
}

/**
 * Minimal reader for a top-level `overrides:` block of flat `key: value`
 * pairs. Deliberately not a YAML parser - the block is machine-written by
 * pnpm and is always flat, and a dependency-free guard cannot itself become a
 * supply-chain surface.
 */
function yamlOverrides(text) {
  const result = new Map();
  const lines = text.split('\n');
  let inside = false;
  for (const line of lines) {
    if (/^overrides:\s*$/.test(line)) {
      inside = true;
      continue;
    }
    if (!inside) continue;
    if (/^\s*$/.test(line)) continue;
    if (!/^\s+\S/.test(line)) break; // dedented back to a new top-level key
    const match = line.match(/^\s+(.+?):\s*(.+?)\s*$/);
    if (match) result.set(unquote(match[1]), unquote(match[2]));
  }
  return result;
}

function unquote(value) {
  return value.replace(/^['"]|['"]$/g, '').trim();
}

function packageJsonOverrides(text) {
  const result = new Map();
  if (!text) return result;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return result;
  }
  const overrides = parsed && parsed.pnpm && parsed.pnpm.overrides;
  if (!overrides || typeof overrides !== 'object') return result;
  for (const [key, value] of Object.entries(overrides)) result.set(key, String(value));
  return result;
}

const failures = [];

// --- Rule 1 + 2: tracked files -----------------------------------------
const files = trackedFiles();
const archived = [];
const copies = [];

for (const file of files) {
  const segments = file.split('/');
  if (segments.some((segment) => ARCHIVED_DIR_NAMES.includes(segment))) {
    archived.push(file);
    continue; // an archived file is one problem, not two
  }
  if (COPY_SUFFIX.test(basename(file))) copies.push(file);
}

if (archived.length > 0) {
  const dirs = [
    ...new Set(archived.map((f) => f.split('/').find((s) => ARCHIVED_DIR_NAMES.includes(s)))),
  ];
  failures.push(
    `${archived.length} tracked file(s) live inside an archived directory (${dirs.join(', ')}).\n` +
      `    Example: ${archived[0]}\n` +
      `    These are not built, not deployed and not imported, but Dependabot still\n` +
      `    scans the manifests inside them. Untrack with:\n` +
      dirs.map((d) => `      git rm -r --cached "${d}"`).join('\n') +
      `\n    The files stay on disk and stay in history; only tracking stops.`,
  );
}

if (copies.length > 0) {
  failures.push(
    `${copies.length} tracked Windows "- Copy" duplicate file(s).\n` +
      copies
        .slice(0, 10)
        .map((f) => `      ${f}`)
        .join('\n') +
      (copies.length > 10 ? `\n      ... and ${copies.length - 10} more` : '') +
      `\n    Untrack them (git rm --cached) - a stale duplicate of a config file is\n` +
      `    edited by mistake sooner or later.`,
  );
}

// --- Rule 3: declared overrides ----------------------------------------
const lock = readManifest('pnpm-lock.yaml');
const workspace = readManifest('pnpm-workspace.yaml');
const pkg = readManifest('package.json');

const lockOverrides = yamlOverrides(lock.text);
const declared = new Map([...yamlOverrides(workspace.text), ...packageJsonOverrides(pkg.text)]);

const undeclared = [];
const mismatched = [];
for (const [name, version] of lockOverrides) {
  if (!declared.has(name)) undeclared.push(`${name} -> ${version}`);
  else if (declared.get(name) !== version) {
    mismatched.push(`${name}: lock pins ${version}, declaration says ${declared.get(name)}`);
  }
}

if (undeclared.length > 0) {
  failures.push(
    `${undeclared.length} security override(s) exist only in ${lock.path} and are not declared.\n` +
      undeclared.map((o) => `      ${o}`).join('\n') +
      `\n    An undeclared override survives only until the lock file is regenerated,\n` +
      `    then the patched version silently reverts. Declare each one under\n` +
      `    "overrides:" in pnpm-workspace.yaml (pnpm 10+) or "pnpm.overrides" in\n` +
      `    package.json, using the exact version the lock already resolved.`,
  );
}

if (mismatched.length > 0) {
  failures.push(
    `${mismatched.length} declared override(s) disagree with ${lock.path}.\n` +
      mismatched.map((o) => `      ${o}`).join('\n') +
      `\n    The declaration and the installed tree have drifted. Reconcile them\n` +
      `    before assuming the patched version is what is installed.`,
  );
}

// --- Report -------------------------------------------------------------
if (failures.length > 0) {
  console.error('Repository hygiene check failed:\n');
  for (const failure of failures) console.error(`  - ${failure}\n`);
  if (fixtureDir) {
    console.error(`(evaluated against fixture: ${fixtureDir})`);
  }
  process.exit(1);
}

console.log(
  `Repository hygiene check passed (${files.length} tracked files, ` +
    `0 archived, 0 "- Copy" duplicates, ${lockOverrides.size} lock overrides all declared).` +
    (fixtureDir ? ` [fixture: ${fixtureDir}]` : ''),
);
