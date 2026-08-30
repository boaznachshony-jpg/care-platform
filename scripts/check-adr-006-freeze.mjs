/* global console, process */
/**
 * Enforces clause 5 of ADR-006 (Accepted, architecture freeze, 2026-08-12):
 *
 *   "No new product field may be added to `MvpProfile` or the workspace
 *    payload. A compatibility-only change requires an accepted ADR amendment
 *    naming its removal condition; it must not become the sole store for new
 *    domain data."
 *
 * The freeze was accepted and then never enforced. Code review WEB-11 found
 * the canonical module unreachable, and on 2026-08-29 a whole reminder-
 * recipients model - including third-party consent records - was added
 * straight into the MVP snapshot store, in good faith, by someone who had no
 * way to know the ADR existed. A prose freeze that nothing checks is not a
 * freeze; it is a document.
 *
 * WHAT IS CHECKED
 * ---------------
 *   1. Fields on `interface MvpProfile` in apps/web/src/storage/mvp-storage.ts
 *   2. `caredesk.mvp.*` storage keys anywhere in tracked, non-test source
 *   3. Exported interfaces in mvp-storage.ts (the shapes the workspace payload
 *      carries)
 *
 * Each is compared against a committed inventory, scripts/adr-006-freeze-
 * baseline.json. Anything present in the code and absent from the inventory is
 * an addition to a frozen store and fails the build.
 *
 * WHY A COMMITTED BASELINE
 * ------------------------
 * "New" only means anything relative to a recorded "old". A baseline file is
 * the only form of that record which cannot drift: it is data, it is diffed in
 * review, and it cannot be satisfied by editing the rule. JSON with sorted
 * flat string arrays is chosen so that adding one field is exactly one added
 * line in the diff - impossible to slip past a reviewer inside a reformat, and
 * impossible to produce by accident.
 *
 * HOW AN EXCEPTION IS EXPRESSED
 * -----------------------------
 * Clause 5 permits a compatibility-only change if an accepted ADR amendment
 * names its removal condition. So the escape hatch is not a suppression
 * comment or an allow-list entry - it is a `knownViolations` or `exceptions`
 * ledger entry that must carry `why` and `removalCondition` prose (and, for
 * `exceptions`, the `adrAmendment` that accepted it). This script validates
 * those fields and fails on an entry that only names the symbol. You cannot
 * silence this check without writing down when the thing goes away.
 *
 * A ledger entry that no longer matches any code also fails: once the data is
 * migrated to canonical storage the entry is stale, and a ledger full of
 * resolved entries stops being read.
 *
 * ROBUST TO FORMATTING
 * --------------------
 * Comments and string bodies are blanked before any structure is read, and
 * interface members are found by scanning for `name:` at brace depth 0 rather
 * than by matching lines. Reordering, prettier reflow, added doc comments and
 * multi-line types therefore cannot trip it - only a genuinely new name can.
 *
 * VERIFYING THE GUARD
 * -------------------
 *   node scripts/check-adr-006-freeze.mjs
 *     -> passes against the repository as it stands
 *
 *   pnpm lint:adr-006:demo-failure
 *   node scripts/check-adr-006-freeze.mjs
 *     --source scripts/fixtures/adr-006-freeze-violation/mvp-storage.ts.txt
 *     -> fails, naming an added MvpProfile field, an added storage key and an
 *        added exported interface
 *
 * `--baseline <file>` overrides the inventory the same way. Both also read
 * CHECK_ADR006_SOURCE / CHECK_ADR006_BASELINE, because `VAR=value cmd` is not
 * valid syntax in PowerShell and this repository is developed on Windows.
 *
 * Run: node scripts/check-adr-006-freeze.mjs   (wired into `pnpm lint`)
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const ADR = 'docs/adr/ADR-006-normalized-persistence-migration.md';
const PROFILE_SOURCE = 'apps/web/src/storage/mvp-storage.ts';
const BASELINE = 'scripts/adr-006-freeze-baseline.json';
const KEY_PREFIX = 'caredesk.mvp.';

function flag(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index !== -1 ? process.argv[index + 1] : undefined;
}

const sourcePath = flag('source') || process.env.CHECK_ADR006_SOURCE || PROFILE_SOURCE;
const baselinePath = flag('baseline') || process.env.CHECK_ADR006_BASELINE || BASELINE;

/**
 * Blanks comments and the insides of string/template literals, preserving
 * length and newlines. Everything downstream reads this instead of the raw
 * text, so a doc comment mentioning a field name, or a Hebrew UI string
 * containing a colon, can never be mistaken for code.
 *
 * The string literals are returned separately because the storage-key rule
 * needs exactly those - and only those, never a key named in a comment.
 */
function scan(text) {
  let code = '';
  const strings = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    if (c === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') {
        code += ' ';
        i++;
      }
      continue;
    }
    if (c === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end === -1 ? text.length : end + 2;
      for (; i < stop; i++) code += text[i] === '\n' ? '\n' : ' ';
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      let value = '';
      code += ' ';
      i++;
      while (i < text.length && text[i] !== quote) {
        if (text[i] === '\\') {
          value += text[i + 1] ?? '';
          code += text[i] === '\n' ? '\n' : ' ';
          code += text[i + 1] === '\n' ? '\n' : ' ';
          i += 2;
          continue;
        }
        value += text[i];
        code += text[i] === '\n' ? '\n' : ' ';
        i++;
      }
      code += ' ';
      i++;
      strings.push(value);
      continue;
    }
    code += c;
    i++;
  }
  return { code, strings };
}

/** Body of `interface <name> { ... }`, braces excluded, or null. */
function interfaceBody(code, name) {
  const header = new RegExp(`\\binterface\\s+${name}\\b[^{]*{`);
  const match = header.exec(code);
  if (!match) return null;
  let depth = 1;
  const start = match.index + match[0].length;
  for (let i = start; i < code.length; i++) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}' && --depth === 0) return code.slice(start, i);
  }
  return null;
}

const IDENT_START = /[A-Za-z_$]/;
const IDENT = /[A-Za-z0-9_$]/;

/**
 * Property names declared directly on an interface body. Depth tracking skips
 * nested object types and index signatures; the preceding-token rule is what
 * separates a member name from an identifier inside a member's type, so line
 * breaks and reflowed unions are irrelevant.
 */
function memberNames(body) {
  const text = body.replace(/\breadonly\s+/g, '');
  const names = [];
  let depth = 0;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '{' || c === '(' || c === '[') {
      depth++;
      i++;
      continue;
    }
    if (c === '}' || c === ')' || c === ']') {
      depth--;
      i++;
      continue;
    }
    if (depth !== 0 || !IDENT_START.test(c)) {
      i++;
      continue;
    }
    let end = i;
    while (end < text.length && IDENT.test(text[end])) end++;
    let back = i - 1;
    while (back >= 0 && /\s/.test(text[back])) back--;
    const prev = back < 0 ? '' : text[back];
    if (prev === '' || prev === ';' || prev === ',') {
      let after = end;
      while (after < text.length && /\s/.test(text[after])) after++;
      if (text[after] === '?') {
        after++;
        while (after < text.length && /\s/.test(text[after])) after++;
      }
      if (text[after] === ':') names.push(text.slice(i, end));
    }
    i = end;
  }
  return names;
}

function exportedInterfaces(code) {
  return [...code.matchAll(/\bexport\s+interface\s+([A-Za-z_$][A-Za-z0-9_$]*)/g)].map((m) => m[1]);
}

/**
 * Storage keys, normalised so that scoping and interpolation are not mistaken
 * for new keys: `caredesk.mvp.profile.v1.client.<id>` and
 * `caredesk.mvp.profile.v1` are one key, and a `${...}` segment collapses to
 * `*`. The bare prefix constant is not a key.
 */
function storageKeysIn(strings) {
  const keys = new Set();
  for (const raw of strings) {
    if (!raw.includes(KEY_PREFIX)) continue;
    for (const match of raw.matchAll(/caredesk\.mvp\.[A-Za-z0-9._${}-]*/g)) {
      let key = match[0].replace(/\$\{[^}]*\}/g, '*');
      key = key.split('.client.')[0].replace(/\.$/, '');
      if (key === 'caredesk.mvp' || key.endsWith('*')) continue;
      keys.add(key);
    }
  }
  return keys;
}

function trackedSourceFiles() {
  const out = execFileSync('git', ['ls-files', '-z', '*.ts', '*.tsx', '*.mjs', '*.js'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return out
    .split('\0')
    .filter(Boolean)
    .filter((f) => !/\.test\.|\.spec\.|\/e2e\/|\/dist\//.test(f));
}

function read(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

// --- Inputs -------------------------------------------------------------
const failures = [];

const baselineText = read(baselinePath);
if (baselineText === null) {
  console.error(`ADR-006 freeze check failed: cannot read baseline ${baselinePath}.`);
  process.exit(1);
}
let baseline;
try {
  baseline = JSON.parse(baselineText);
} catch (error) {
  console.error(`ADR-006 freeze check failed: ${baselinePath} is not valid JSON.\n  ${error}`);
  process.exit(1);
}

const sourceText = read(sourcePath);
if (sourceText === null) {
  console.error(`ADR-006 freeze check failed: cannot read ${sourcePath}.`);
  process.exit(1);
}

const source = scan(sourceText);

// --- Ledger -------------------------------------------------------------
const CATEGORIES = [
  {
    key: 'mvpProfileFields',
    label: 'MvpProfile field',
    hint: `added to the frozen profile interface in ${PROFILE_SOURCE}`,
  },
  { key: 'storageKeys', label: 'workspace storage key', hint: 'a new caredesk.mvp.* store' },
  {
    key: 'workspacePayloadEntities',
    label: 'exported workspace payload interface',
    hint: `a new shape exported from ${PROFILE_SOURCE}`,
  },
];

function ledgerEntries(field, required) {
  const entries = Array.isArray(baseline[field]) ? baseline[field] : [];
  const allowed = { mvpProfileFields: [], storageKeys: [], workspacePayloadEntities: [] };
  entries.forEach((entry, index) => {
    const where = `${baselinePath} ${field}[${index}]${entry && entry.id ? ` (${entry.id})` : ''}`;
    if (!entry || typeof entry !== 'object') {
      failures.push(`${where} is not an object.`);
      return;
    }
    for (const prop of required) {
      if (typeof entry[prop] !== 'string' || entry[prop].trim().length < 20) {
        failures.push(
          `${where} is missing a meaningful "${prop}".\n` +
            `    ADR-006 clause 5 allows a compatibility-only change only with a named\n` +
            `    removal condition. An entry that names the symbol and nothing else is a\n` +
            `    silencer, not an exception, so this check refuses to honour it.`,
        );
      }
    }
    let items = 0;
    for (const category of CATEGORIES) {
      const list = Array.isArray(entry[category.key]) ? entry[category.key] : [];
      items += list.length;
      allowed[category.key].push(
        ...list.map((name) => ({ name, entry: entry.id || where, field })),
      );
    }
    if (items === 0) failures.push(`${where} claims no field, key or interface.`);
  });
  return allowed;
}

const known = ledgerEntries('knownViolations', ['why', 'removalCondition']);
const excepted = ledgerEntries('exceptions', ['why', 'removalCondition', 'adrAmendment']);

// --- Observed state -----------------------------------------------------
const profileBody = interfaceBody(source.code, 'MvpProfile');
if (profileBody === null) {
  console.error(
    `ADR-006 freeze check failed: no "interface MvpProfile" found in ${sourcePath}.\n` +
      '  The guard cannot verify a freeze it cannot read. If the interface moved,\n' +
      '  update PROFILE_SOURCE in scripts/check-adr-006-freeze.mjs.',
  );
  process.exit(1);
}

const observed = {
  mvpProfileFields: new Set(memberNames(profileBody)),
  storageKeys: new Set(),
  workspacePayloadEntities: new Set(exportedInterfaces(source.code)),
};

const scannedFiles = [];
for (const file of trackedSourceFiles()) {
  const text = file === sourcePath ? sourceText : read(file);
  if (text === null || !text.includes(KEY_PREFIX)) continue;
  scannedFiles.push(file);
  for (const key of storageKeysIn(scan(text).strings)) observed.storageKeys.add(key);
}
if (sourcePath !== PROFILE_SOURCE) {
  // Fixture run: the fixture's own keys stand in for the real file's.
  for (const key of storageKeysIn(source.strings)) observed.storageKeys.add(key);
}

// --- Rules --------------------------------------------------------------
for (const category of CATEGORIES) {
  const frozen = new Set(Array.isArray(baseline[category.key]) ? baseline[category.key] : []);
  const ledger = new Map(
    [...known[category.key], ...excepted[category.key]].map((item) => [item.name, item]),
  );

  const added = [...observed[category.key]].filter(
    (name) => !frozen.has(name) && !ledger.has(name),
  );
  if (added.length > 0) {
    failures.push(
      `${added.length} new ${category.label}(s) - ${category.hint}:\n` +
        added
          .map((name) => {
            const stored = new RegExp(`(?:readList|saveList)\\s*<\\s*${name}\\s*>`).test(
              source.code,
            )
              ? ' (persisted: read/written through the workspace payload)'
              : '';
            return `      ${name}${stored}`;
          })
          .join('\n') +
        `\n    ADR-006 clause 5 (Accepted, architecture freeze): "No new product field\n` +
        `    may be added to MvpProfile or the workspace payload." See ${ADR}.\n` +
        `    Model this in the normalized PostgreSQL aggregate instead. If it really is\n` +
        `    compatibility-only, add it to "exceptions" in ${baselinePath}\n` +
        `    with "why", "removalCondition" and the "adrAmendment" that accepted it.`,
    );
  }

  const stale = [...ledger.values()].filter((item) => !observed[category.key].has(item.name));
  if (stale.length > 0) {
    failures.push(
      `${stale.length} stale ledger ${category.label}(s) in ${baselinePath}:\n` +
        stale.map((item) => `      ${item.name} (${item.field} entry "${item.entry}")`).join('\n') +
        `\n    The code no longer has these, so the exception has been discharged.\n` +
        `    Delete the ledger entry - a ledger of resolved items stops being read.`,
    );
  }
}

// --- Report -------------------------------------------------------------
if (failures.length > 0) {
  console.error('ADR-006 persistence freeze check failed:\n');
  for (const failure of failures) console.error(`  - ${failure}\n`);
  if (sourcePath !== PROFILE_SOURCE || baselinePath !== BASELINE) {
    console.error(`(evaluated against source: ${sourcePath}, baseline: ${baselinePath})`);
  }
  process.exit(1);
}

const violationCount = CATEGORIES.reduce((total, c) => total + known[c.key].length, 0);
const entryCount = Array.isArray(baseline.knownViolations) ? baseline.knownViolations.length : 0;
console.log(
  `ADR-006 freeze check passed (${observed.mvpProfileFields.size} MvpProfile fields, ` +
    `${observed.storageKeys.size} caredesk.mvp.* keys across ${scannedFiles.length} files, ` +
    `${observed.workspacePayloadEntities.size} exported payload interfaces; ` +
    `${violationCount} item(s) in ${entryCount} known violation(s) pending migration).` +
    (sourcePath !== PROFILE_SOURCE ? ` [source: ${sourcePath}]` : ''),
);
