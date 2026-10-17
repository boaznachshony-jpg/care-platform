/* global console, process */
/**
 * N2 (work plan 16.10.2026) - a value one side sends that the other side's
 * enum does not accept.
 *
 * WHAT WENT WRONG
 * ---------------
 * The Emergency Binder page sent `medications` in its section list. The API
 * route validated sections with its own `z.enum([...])`, which did not list
 * it. Both files type-checked, every test passed - the page test mocked the
 * API client and the route test never sent what the page sends - and in
 * production every default export was refused with 400.
 *
 * TypeScript cannot see this class of bug. The two lists live on opposite
 * sides of an HTTP request: the route's zod enum on one side, a string union
 * in apps/web/src/api/client.ts or a literal at a call site on the other. They
 * share no type, so each can drift alone. (#138 fixed the binder by moving
 * its list into @caredesk/schemas; most route enums have not moved yet.)
 *
 * WHAT IS CHECKED
 * ---------------
 * scripts/shared-enums.json lists the pairs that must agree. Each pair names
 * a `producer` (the values one side can send) and a `consumer` (the enum the
 * other side accepts), each as a locator into a source file:
 *
 *   { "file", "zodEnum": "<property>", "within"?: "<variable>" }
 *       the string literals of `<property>: z.enum([...])`
 *   { "file", "type": "<alias>" }
 *       the string-literal members of `type <alias> = 'a' | 'b'`
 *   { "file", "interface": "<name>", "property": "<prop>" }
 *       the string-literal union of one interface property
 *   { "file", "function": "<name>", "parameter": "<param>" }
 *       the string-literal union of one parameter's type
 *   { "file", "call": "<callee>", "property": "<prop>" }
 *       every string literal passed as `<prop>` in an object-literal argument
 *       to any call of `<callee>` in the file (a producer at its call site)
 *   { "file", "const": "<name>" }
 *       the string literals of `const <name> = [...]`
 *
 * Any locator may add "exclude": [...] with a mandatory "excludeReason".
 *
 * relation "subset" (default): every producer value is accepted by the
 * consumer. relation "equal": the two sets are identical - for a response
 * type that must cover every status the server can return, and for request
 * enums that should not silently grow on one side only.
 *
 * A locator that matches nothing, or matches more than one declaration, fails
 * the check: a guard that quietly reads an empty set after a refactor guards
 * nothing.
 *
 * Usage:
 *   node scripts/check-shared-enums.mjs
 *   node scripts/check-shared-enums.mjs --sidecar FILE --root DIR   (demo)
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ts from 'typescript';

function flag(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index !== -1 ? process.argv[index + 1] : undefined;
}

const ROOT = resolve(flag('root') ?? process.cwd());
const SIDECAR = flag('sidecar') ?? 'scripts/shared-enums.json';

const parsed = new Map();
function sourceOf(file) {
  if (!parsed.has(file)) {
    const text = readFileSync(join(ROOT, file), 'utf8');
    const kind = /\.tsx(\.txt)?$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    parsed.set(file, ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind));
  }
  return parsed.get(file);
}

function walk(node, visit) {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

function find(node, predicate) {
  const found = [];
  walk(node, (candidate) => {
    if (predicate(candidate)) found.push(candidate);
  });
  return found;
}

const nameOf = (node) => (node.name && ts.isIdentifier(node.name) ? node.name.text : undefined);

/** String literals of a union type node, through parentheses and nested unions. */
function unionLiterals(typeNode) {
  if (!typeNode) return null;
  if (ts.isParenthesizedTypeNode(typeNode)) return unionLiterals(typeNode.type);
  if (ts.isUnionTypeNode(typeNode)) {
    const values = [];
    for (const member of typeNode.types) {
      const inner = unionLiterals(member);
      if (inner === null) return null;
      values.push(...inner);
    }
    return values;
  }
  if (ts.isLiteralTypeNode(typeNode) && ts.isStringLiteral(typeNode.literal)) {
    return [typeNode.literal.text];
  }
  return null;
}

function stringLiteralsIn(node) {
  return find(node, (n) => ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)).map(
    (n) => n.text,
  );
}

function isZodEnumCall(node) {
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === 'enum' &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === 'z' &&
    node.arguments[0] !== undefined &&
    ts.isArrayLiteralExpression(node.arguments[0])
  );
}

function exactlyOne(matches, describe) {
  if (matches.length === 0) throw new Error(`${describe} matches nothing`);
  if (matches.length > 1)
    throw new Error(`${describe} matches ${matches.length} declarations; narrow it with "within"`);
  return matches[0];
}

function extract(locator) {
  const source = sourceOf(locator.file);
  const where = `${locator.file}: ${JSON.stringify({ ...locator, file: undefined })}`;
  let values;

  if (locator.zodEnum) {
    let scope = source;
    if (locator.within) {
      scope = exactlyOne(
        find(source, (n) => ts.isVariableDeclaration(n) && nameOf(n) === locator.within),
        `${where} (variable ${locator.within})`,
      );
    }
    const property = exactlyOne(
      find(
        scope,
        (n) =>
          ts.isPropertyAssignment(n) &&
          nameOf(n) === locator.zodEnum &&
          find(n.initializer, isZodEnumCall).length > 0,
      ),
      where,
    );
    const call = exactlyOne(find(property.initializer, isZodEnumCall), where);
    values = stringLiteralsIn(call.arguments[0]);
  } else if (locator.type) {
    const alias = exactlyOne(
      find(source, (n) => ts.isTypeAliasDeclaration(n) && n.name.text === locator.type),
      where,
    );
    values = unionLiterals(alias.type);
  } else if (locator.interface) {
    const declaration = exactlyOne(
      find(source, (n) => ts.isInterfaceDeclaration(n) && n.name.text === locator.interface),
      where,
    );
    const member = exactlyOne(
      declaration.members.filter(
        (m) => ts.isPropertySignature(m) && nameOf(m) === locator.property,
      ),
      where,
    );
    values = unionLiterals(member.type);
  } else if (locator.function) {
    const fn = exactlyOne(
      find(
        source,
        (n) =>
          (ts.isFunctionDeclaration(n) && nameOf(n) === locator.function) ||
          (ts.isVariableDeclaration(n) &&
            nameOf(n) === locator.function &&
            n.initializer !== undefined &&
            (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))),
      ),
      where,
    );
    const signature = ts.isVariableDeclaration(fn) ? fn.initializer : fn;
    const parameter = exactlyOne(
      signature.parameters.filter((p) => nameOf(p) === locator.parameter),
      where,
    );
    values = unionLiterals(parameter.type);
  } else if (locator.call) {
    const calls = find(
      source,
      (n) =>
        ts.isCallExpression(n) &&
        ((ts.isIdentifier(n.expression) && n.expression.text === locator.call) ||
          (ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === locator.call)),
    );
    const initializers = calls.flatMap((call) =>
      call.arguments
        .filter(ts.isObjectLiteralExpression)
        .flatMap((object) =>
          object.properties.filter(
            (p) => ts.isPropertyAssignment(p) && nameOf(p) === locator.property,
          ),
        )
        .map((p) => p.initializer),
    );
    if (!initializers.length) throw new Error(`${where} matches nothing`);
    values = initializers.flatMap(stringLiteralsIn);
  } else if (locator.const) {
    const declaration = exactlyOne(
      find(source, (n) => ts.isVariableDeclaration(n) && nameOf(n) === locator.const),
      where,
    );
    let initializer = declaration.initializer;
    while (
      initializer &&
      (ts.isAsExpression(initializer) ||
        ts.isSatisfiesExpression(initializer) ||
        ts.isParenthesizedExpression(initializer))
    ) {
      initializer = initializer.expression;
    }
    if (!initializer || !ts.isArrayLiteralExpression(initializer))
      throw new Error(`${where} is not an array literal`);
    values = stringLiteralsIn(initializer);
  } else {
    throw new Error(`${where}: unknown locator kind`);
  }

  if (values === null) throw new Error(`${where} is not a union of string literals`);
  if (locator.exclude) {
    if (!locator.excludeReason) throw new Error(`${where}: "exclude" needs an "excludeReason"`);
    values = values.filter((value) => !locator.exclude.includes(value));
  }
  if (!values.length) throw new Error(`${where} yields no values`);
  return new Set(values);
}

const sidecar = JSON.parse(readFileSync(join(ROOT, SIDECAR), 'utf8'));
const failures = [];
let checked = 0;

for (const pair of sidecar.pairs) {
  let producer;
  let consumer;
  try {
    producer = extract(pair.producer);
    consumer = extract(pair.consumer);
  } catch (error) {
    failures.push(`${pair.name}: ${error.message}`);
    continue;
  }
  checked += 1;
  const unaccepted = [...producer].filter((value) => !consumer.has(value));
  for (const value of unaccepted) {
    failures.push(
      `${pair.name}: ${pair.producer.file} can send '${value}', ` +
        `which ${pair.consumer.file} does not accept`,
    );
  }
  if ((pair.relation ?? 'subset') === 'equal') {
    for (const value of [...consumer].filter((v) => !producer.has(v))) {
      failures.push(
        `${pair.name}: ${pair.consumer.file} accepts '${value}', ` +
          `which ${pair.producer.file} does not list`,
      );
    }
  }
}

if (failures.length) {
  console.error('Shared-enum check failed:\n');
  for (const failure of failures) console.error(`  - ${failure}`);
  console.error(
    '\n  One side of an HTTP request sends a value the other side does not accept,\n' +
      '  or a pair in ' +
      SIDECAR +
      ' no longer points at real code. This is how the\n' +
      '  binder page sent `medications` to a route that refused it, for every\n' +
      '  default export, with every test green. Make the two lists agree - best\n' +
      '  by moving the enum into @caredesk/schemas and importing it on both sides.',
  );
  process.exit(1);
}

console.log(`Shared-enum check passed (${checked} producer/consumer pair(s)).`);
