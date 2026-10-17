/* global console, process */
/**
 * N3 (work plan 16.10.2026) - an export that nothing outside its own test
 * imports.
 *
 * WHAT WENT WRONG
 * ---------------
 * `outstandingQuarterlyInsurance` in packages/domain/src/national-insurance.ts
 * is the correct answer to "which National Insurance quarters are still
 * unpaid". It was written, tested and exported - and nothing called it. The web
 * app kept two private copies that each answer a different, wrong question, and
 * on 16.10.2026 the dashboard stopped reporting an overdue payment the day
 * after it fell due, while the tasks screen still said "overdue". The fix
 * existed for weeks. Its tests were green the whole time, which is exactly why
 * nobody looked: a tested function that is never wired is the most expensive
 * kind of green.
 *
 * WHAT IS CHECKED
 * ---------------
 * Every exported value (function, class, const/let, enum, default export) in
 * the non-test TypeScript under apps/ and packages/ must be imported by at
 * least one non-test file, or be used inside its own module. Imports are
 * followed through `export *` and `export { x } from` barrels, so importing
 * `@caredesk/domain` counts as importing the module that declares the name; a
 * barrel re-export alone is not a use. Type-only exports (interfaces, type
 * aliases) are not checked: an unused type cannot hold unwired logic.
 *
 * Not checked, by construction:
 *   - test files (*.test.ts, *.spec.ts, e2e/): they are not consumers;
 *   - packages/testing and mocks/ directories: test support, used by tests;
 *   - names ending in `ForTests`: reset hooks that exist for tests only;
 *   - ENTRY_POINTS below: consumed by a runtime, not by an import.
 *
 * Exports that were already unused when this check landed are listed, each
 * with a reason, in scripts/exported-and-unused-allowlist.json. The list is a
 * ratchet, not a hiding place: a listed export that becomes used is reported
 * as a warning so its line can be deleted, and a new unused export fails.
 *
 * WHEN IT FAILS
 * -------------
 * Wire the export into the code path it was written for, or stop exporting
 * it, or delete it. If it is genuinely meant to be public with no caller yet,
 * add it to the allowlist with a reason a reviewer can check.
 *
 * Usage:
 *   node scripts/check-exported-and-unused.mjs
 *   node scripts/check-exported-and-unused.mjs --fixture DIR   (demo; .ts.txt sources)
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';
import ts from 'typescript';

const ROOT = process.cwd();
const ALLOWLIST_PATH = 'scripts/exported-and-unused-allowlist.json';
const IGNORED_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage']);
const TEST_FILE = /(\.(test|spec)\.tsx?(\.txt)?$)|(^|\/)(e2e|__tests__)\//;
const TEST_SUPPORT = /(^packages\/testing\/)|(\/mocks\/)/;
const TEST_HOOK_NAME = /ForTests$/;

/** Consumed by a runtime rather than an import: their exports are always used. */
const ENTRY_POINTS = new Set([
  // apps/api/api/index.js (the Vercel function) imports dist/index.js.
  'apps/api/src/index.ts',
  // Vercel's Fastify preset discovers src/server.ts by path (see its header).
  'apps/api/src/server.ts',
]);

function flag(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index !== -1 ? process.argv[index + 1] : undefined;
}

const fixtureDir = flag('fixture');
const SUFFIX = fixtureDir ? '.txt' : '';
const SOURCE = fixtureDir ? /\.tsx?\.txt$/ : /\.tsx?$/;
const DECLARATION = /\.d\.ts$/;

const toPosix = (path) => path.split(sep).join(posix.sep);
const display = (file) => toPosix(relative(ROOT, file));

function walk(dir, files = []) {
  if (!existsSync(dir)) return files;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const child = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) walk(child, files);
    } else if (SOURCE.test(entry.name) && !DECLARATION.test(entry.name)) {
      files.push(child);
    }
  }
  return files;
}

/** Workspace package name -> its src/index.ts, so `@caredesk/x` resolves to source. */
const packageEntries = new Map();
const sourceRoots = [];
if (fixtureDir) {
  sourceRoots.push(resolve(ROOT, fixtureDir));
} else {
  for (const group of ['apps', 'packages']) {
    for (const entry of readdirSync(join(ROOT, group), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = join(ROOT, group, entry.name);
      const manifestPath = join(dir, 'package.json');
      if (!existsSync(manifestPath)) continue;
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      sourceRoots.push(join(dir, 'src'));
      if (group === 'apps') sourceRoots.push(join(dir, 'e2e'));
      const entryFile = join(dir, 'src', 'index.ts');
      if (group === 'packages' && existsSync(entryFile))
        packageEntries.set(manifest.name, entryFile);
    }
  }
}

const files = sourceRoots.flatMap((root) => walk(root));
const fileSet = new Set(files);

function resolveSpecifier(fromFile, specifier) {
  if (packageEntries.has(specifier)) return packageEntries.get(specifier);
  if (!specifier.startsWith('.')) return null;
  const stem = resolve(dirname(fromFile), specifier).replace(/\.(js|jsx|mjs|ts|tsx)$/, '');
  for (const candidate of [
    `${stem}.ts${SUFFIX}`,
    `${stem}.tsx${SUFFIX}`,
    join(stem, `index.ts${SUFFIX}`),
    join(stem, `index.tsx${SUFFIX}`),
  ]) {
    if (fileSet.has(candidate)) return candidate;
  }
  return null;
}

function modifiersOf(node) {
  return ts.canHaveModifiers(node) ? (ts.getModifiers(node) ?? []) : [];
}
const isExported = (node) => modifiersOf(node).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
const isDefault = (node) => modifiersOf(node).some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);

/**
 * One parsed module: the value exports it declares, the re-exports it passes
 * through, the imports it makes, and how often each identifier appears in it.
 */
function parseModule(file) {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    file.includes('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const rel = display(file);
  const mod = {
    file,
    rel,
    isTest: TEST_FILE.test(rel),
    declared: new Map(), // exported name -> { line, local }
    reexportAll: [],
    reexportNamed: new Map(), // exported name -> { target, name }
    imports: [], // { target, names: string[] | '*' }
    identifierCounts: new Map(),
  };
  const lineOf = (node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  const declare = (name, node, local) => mod.declared.set(name, { line: lineOf(node), local });

  const visit = (node) => {
    if (ts.isIdentifier(node)) {
      mod.identifierCounts.set(node.text, (mod.identifierCounts.get(node.text) ?? 0) + 1);
    }
    // A dynamic import of a relative path counts as a namespace import here.
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      const target = resolveSpecifier(file, node.arguments[0].text);
      if (target) mod.imports.push({ target, names: '*' });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const target = resolveSpecifier(file, statement.moduleSpecifier.text);
      const clause = statement.importClause;
      if (!target || !clause) continue;
      const names = [];
      if (clause.name) names.push('default');
      if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
        mod.imports.push({ target, names: '*' });
      } else if (clause.namedBindings) {
        for (const element of clause.namedBindings.elements) {
          names.push((element.propertyName ?? element.name).text);
        }
      }
      if (names.length) mod.imports.push({ target, names });
      continue;
    }

    if (ts.isExportDeclaration(statement)) {
      const specifier =
        statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
          ? statement.moduleSpecifier.text
          : null;
      const target = specifier ? resolveSpecifier(file, specifier) : null;
      if (specifier && !target) continue; // an external package re-export
      if (!statement.exportClause) {
        if (target) mod.reexportAll.push(target);
      } else if (ts.isNamespaceExport(statement.exportClause)) {
        mod.imports.push({ target, names: '*' });
      } else if (!statement.isTypeOnly) {
        for (const element of statement.exportClause.elements) {
          if (element.isTypeOnly) continue;
          const exported = element.name.text;
          const local = (element.propertyName ?? element.name).text;
          if (target) mod.reexportNamed.set(exported, { target, name: local });
          else declare(exported, element, local);
        }
      }
      continue;
    }

    if (ts.isExportAssignment(statement)) {
      declare('default', statement, null);
      continue;
    }
    if (!isExported(statement)) continue;
    if (
      ts.isFunctionDeclaration(statement) ||
      ts.isClassDeclaration(statement) ||
      ts.isEnumDeclaration(statement)
    ) {
      if (isDefault(statement)) declare('default', statement, statement.name?.text ?? null);
      else if (statement.name) declare(statement.name.text, statement, statement.name.text);
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          declare(declaration.name.text, declaration, declaration.name.text);
        }
      }
    }
  }
  return mod;
}

const modules = new Map(files.map((file) => [file, parseModule(file)]));
const used = new Set();
const keyOf = (file, name) => `${display(file)}#${name}`;

/** Follow a name through barrels to the module that declares it. */
function markUsed(target, name, seen = new Set()) {
  const id = keyOf(target, name);
  if (seen.has(id)) return;
  seen.add(id);
  const mod = modules.get(target);
  if (!mod) return;
  if (mod.declared.has(name)) {
    used.add(id);
    return;
  }
  const named = mod.reexportNamed.get(name);
  if (named) return markUsed(named.target, named.name, seen);
  for (const all of mod.reexportAll) markUsed(all, name, seen);
}

function markEverything(target, seen = new Set()) {
  if (seen.has(target)) return;
  seen.add(target);
  const mod = modules.get(target);
  if (!mod) return;
  for (const name of mod.declared.keys()) used.add(keyOf(target, name));
  for (const { target: next, name } of mod.reexportNamed.values()) markUsed(next, name);
  for (const all of mod.reexportAll) markEverything(all, seen);
}

for (const mod of modules.values()) {
  if (mod.isTest) continue;
  for (const { target, names } of mod.imports) {
    if (names === '*') markEverything(target);
    else for (const name of names) markUsed(target, name);
  }
}

const unused = [];
for (const mod of modules.values()) {
  if (mod.isTest || TEST_SUPPORT.test(mod.rel) || ENTRY_POINTS.has(mod.rel)) continue;
  for (const [name, { line, local }] of mod.declared) {
    if (TEST_HOOK_NAME.test(name)) continue;
    if (used.has(keyOf(mod.file, name))) continue;
    // Referenced inside its own module beyond the declaration: wired, merely
    // exported more widely than it needs to be. Not what this check is for.
    if (local && (mod.identifierCounts.get(local) ?? 0) > 1) continue;
    unused.push({ id: `${mod.rel}#${name}`, line });
  }
}

const allowlist = fixtureDir
  ? {}
  : JSON.parse(readFileSync(join(ROOT, ALLOWLIST_PATH), 'utf8')).entries;
const failures = unused.filter(({ id }) => !(id in allowlist));
const unusedIds = new Set(unused.map(({ id }) => id));
const nowUsed = Object.keys(allowlist).filter((id) => !unusedIds.has(id));

for (const id of nowUsed) {
  console.warn(
    `warning: ${id} is listed in ${ALLOWLIST_PATH} but is now imported (or gone). ` +
      'Delete its line from the allowlist.',
  );
}

if (failures.length) {
  console.error('Exported-and-unused check failed:\n');
  for (const { id, line } of failures) {
    const [file, name] = id.split('#');
    console.error(`  - ${file}:${line} \`${name}\``);
  }
  console.error(
    '\n  Each name above is exported, and nothing outside its own tests imports it.\n' +
      '  That is how `outstandingQuarterlyInsurance` was written, tested and never\n' +
      '  called while the screen showed a wrong due date. Wire it into the code path\n' +
      '  it was written for, stop exporting it, or delete it. If it must stay public\n' +
      `  with no caller yet, add it to ${ALLOWLIST_PATH} with a reason.`,
  );
  process.exit(1);
}

console.log(
  `Exported-and-unused check passed (${modules.size} files; ` +
    `${unused.length} allowlisted export(s) still unused).`,
);
