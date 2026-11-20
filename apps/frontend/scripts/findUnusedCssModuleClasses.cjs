// Fails when a CSS module defines something the code never uses, or uses it in a way this check
// cannot follow. Part of bin/run-linter-and-unit-tests.sh; run on its own with
// `npm run check:unused-css` (inside the frontend container).
//
// Each `import x from '*.module.css'` binding is resolved to its file via the TypeScript AST, so
// the local name does not matter (`styles`, `settingsStyles`, ...). Reported, all as errors:
//   - a .module.css file nothing (outside tests) imports
//   - a class that no code references through its binding, or only tests do
//   - the reverse: code that references `styles.x` where the module defines no `.x` (evaluates to
//     undefined, so the className silently does nothing)
//   - dynamic access (`styles[size]`) or passing the binding around as a value: the check cannot
//     tell which classes that reaches. Use a typed lookup instead, e.g.
//     `const sizeClass: Record<Size, string> = { small: styles.small, large: styles.large }`.
//     A reference that is undefined on purpose (a default modifier with no styles) can opt out with
//     `// css-modules-allow-undefined: <reason>` on the line above it or at the end of its line. The
//     reason is required, and a comment that no longer matches an undefined class fails the check.
//   - a parameter, variable, destructured binding, function, class or enum that reuses a CSS module binding's name: the
//     check matches `styles.x` by name, not by scope, so it would attribute the shadowing variable's
//     members to the stylesheet. Rename the shadowing variable.
//   - a CSS module import that is not a default import, or does not resolve
const fs = require('fs'), path = require('path'), ts = require('typescript');
const ROOT = path.resolve(__dirname, '..');
const ALIASES = { '@constants': 'src/constants', '@components': 'src/components', '@helpers': 'src/helpers', '@hooks': 'src/hooks', '@styles': 'src/styles', '@customTypes': 'src/types', '@ui-components': 'src/ui-components', '@services': 'src/services', '@contexts': 'src/contexts', '@pages': 'src/pages', '@layouts': 'src/layouts', '@trial-banners': 'src/trial-banners', '@root': 'src' };
// nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- d starts at this app's src/ and entries come from readdir(), not external input
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const all = walk(path.join(ROOT, 'src'));
const isTest = f => /\.test\.tsx?$/.test(f) || f.includes(`${path.sep}test${path.sep}`);
const codeFiles = all.filter(f => /\.tsx?$/.test(f) && !f.endsWith('.d.ts'));
const cssFiles = all.filter(f => f.endsWith('.module.css'));
const rel = f => path.relative(ROOT, f); // frontend-relative (src/...), so terminals and editors can link it

function resolve(from, spec) {
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- spec is an import specifier read from our own source files, only used to look up files in this repo
  if (spec.startsWith('.')) return path.resolve(path.dirname(from), spec);
  const [alias, ...rest] = spec.split('/');
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- alias is looked up in the literal ALIASES table; rest is the import specifier from our own source files
  return ALIASES[alias] ? path.join(ROOT, ALIASES[alias], ...rest) : null;
}

// css file -> classes referenced by non-test / any code, dynamic-access sites, importers, odd imports
const at = (sf, file, n) => `${rel(file)}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`;
const unresolved = [];
const suppressions = []; // every css-modules-allow-undefined comment, so unused ones can be reported
const SUPPRESS = /css-modules-allow-undefined\b(?::\s*(\S.*?))?\s*(?:\*\/\}?)?\s*$/;
const info = new Map(cssFiles.map(f => [f, { prod: new Set(), all: new Set(), refs: new Map(), dynamic: [], shadowed: [], importers: new Set(), prodImporters: new Set(), other: [] }]));

for (const file of codeFiles) {
  const test = isTest(file);
  const sf = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const bindings = new Map(); // local name -> css info
  const visitImports = n => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && n.moduleSpecifier.text.endsWith('.module.css')) {
      const target = resolve(file, n.moduleSpecifier.text);
      const rec = target && info.get(target);
      if (!rec) return unresolved.push({ loc: at(sf, file, n), msg: `does not resolve: ${n.getText()}` });
      rec.importers.add(file); if (!test) rec.prodImporters.add(file);
      const c = n.importClause;
      if (c && c.name && !c.namedBindings) bindings.set(c.name.text, rec);
      else rec.other.push({ loc: at(sf, file, n), msg: `not a default import: ${n.getText()}` });
    }
  };
  sf.statements.forEach(visitImports);
  if (!bindings.size) continue;
  const lines = sf.text.split('\n');
  const markers = new Map();
  lines.forEach((text, i) => {
    const m = SUPPRESS.exec(text);
    if (!m) return;
    const marker = { loc: `${rel(file)}:${i + 1}`, reason: m[1], used: false, ownLine: /^\s*(\/\/|\/\*|\{\/\*)/.test(text) };
    markers.set(i, marker); suppressions.push(marker);
  });
  const markerFor = n => {
    const line = sf.getLineAndCharacterOfPosition(n.getStart()).line;
    return markers.get(line) || (markers.get(line - 1)?.ownLine ? markers.get(line - 1) : undefined);
  };
  const mark = (rec, cls, n) => { rec.all.add(cls); if (!test) rec.prod.add(cls); if (!rec.refs.has(cls)) rec.refs.set(cls, []); rec.refs.get(cls).push({ loc: at(sf, file, n), marker: markerFor(n) }); };
  // Nodes that introduce a local name; one that matches a CSS module binding shadows it.
  const declaresName = n => n.name && ts.isIdentifier(n.name) && (ts.isParameter(n) || ts.isVariableDeclaration(n) || ts.isBindingElement(n) || ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isClassDeclaration(n) || ts.isClassExpression(n) || ts.isEnumDeclaration(n));
  const escape = (rec, why, n) => { if (!test) rec.dynamic.push({ loc: at(sf, file, n), msg: why }); };
  const visit = n => {
    if (ts.isImportDeclaration(n)) return;
    if (declaresName(n) && bindings.has(n.name.text)) {
      bindings.get(n.name.text).shadowed.push({ loc: at(sf, file, n.name), msg: `shadows the CSS module binding \`${n.name.text}\`` });
    } else if (ts.isIdentifier(n) && bindings.has(n.text) && !(n.parent.name === n && declaresName(n.parent))) {
      const rec = bindings.get(n.text), p = n.parent;
      if (ts.isPropertyAccessExpression(p) && p.expression === n) mark(rec, p.name.text, p);
      else if (ts.isElementAccessExpression(p) && p.expression === n) {
        const a = p.argumentExpression;
        if (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)) mark(rec, a.text, p);
        else escape(rec, `dynamic index [${a.getText()}]`, n);
      } else if (!(ts.isPropertyAssignment(p) && p.name === n) && !(ts.isPropertyAccessExpression(p) && p.name === n)) escape(rec, `binding used as value: ${p.getText().slice(0, 50)}`, n);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
}

// class name -> line of its first appearance in a selector. Comments, strings and url() are blanked
// with spaces (newlines kept) so offsets, and therefore line numbers, still match the real file.
function cssClasses(file) {
  const blank = m => m.replace(/[^\n]/g, ' ');
  const t = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, blank).replace(/url\([^)]*\)/g, blank).replace(/(["'])(?:\\.|(?!\1).)*\1/g, blank);
  const out = new Map();
  for (const m of t.matchAll(/([^{};]+)\{/g)) {
    if (m[1].trim().startsWith('@')) continue;
    const sel = m[1].replace(/:global\((?:[^()]|\([^)]*\))*\)/g, blank).replace(/:global\s+[^\s,]+/g, blank);
    for (const c of sel.matchAll(/\.([A-Za-z_][\w-]*)/g)) {
      if (!out.has(c[1])) out.set(c[1], t.slice(0, m.index + c.index).split('\n').length);
    }
  }
  return out;
}

// Colour only for a real terminal (or FORCE_COLOR); honours NO_COLOR, so CI logs stay plain.
const color = !process.env.NO_COLOR && (process.stdout.isTTY || process.env.FORCE_COLOR);
const paint = code => text => (color ? `\x1b[${code}m${text}\x1b[0m` : text);
const [bold, dim, red, green, cyan, yellow] = [1, 2, 31, 32, 36, 33].map(paint);

// On GitHub Actions, also emit workflow commands so each finding is annotated on the PR's files.
// The step runs inside `docker run`, so the workflow passes GITHUB_ACTIONS=true in explicitly.
// Paths are repo-root-relative there; this app lives at apps/frontend.
const annotate = process.env.GITHUB_ACTIONS === 'true';
const escapeData = v => String(v).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const escapeProp = v => escapeData(v).replace(/:/g, '%3A').replace(/,/g, '%2C');
const annotation = (title, hint, { loc, msg, note }) => {
  const [file, line] = loc.split(/:(?=\d+$)/);
  const props = [`file=${escapeProp(`apps/frontend/${file}`)}`, line && `line=${line}`, `title=${escapeProp(title)}`].filter(Boolean);
  return `::error ${props.join(',')}::${escapeData(`${msg}${note ? ` (${note})` : ''}. ${hint.split('\n')[0]}`)}`;
};

const orphans = [], dead = [], testOnly = [], dynamic = [], undefinedRefs = [];
let total = 0;
for (const [css, rec] of info) {
  if (!rec.importers.size) { orphans.push({ loc: rel(css), msg: 'imported nowhere' }); continue; }
  if (!rec.prodImporters.size) { orphans.push({ loc: rel(css), msg: 'imported only by tests' }); continue; }
  const classes = cssClasses(css); total += classes.size;
  for (const [c, locs] of rec.refs) {
    if (classes.has(c)) continue;
    for (const { loc, marker } of locs) {
      if (marker?.reason) marker.used = true;
      else undefinedRefs.push({ loc, msg: `styles.${c}`, note: `not defined in ${rel(css)}` });
    }
  }
  if (rec.dynamic.length) { dynamic.push(...rec.dynamic.map(d => ({ ...d, note: `in ${rel(css)}` }))); continue; }
  for (const [c, line] of classes) {
    if (rec.prod.has(c)) continue;
    (rec.all.has(c) ? testOnly : dead).push({ loc: `${rel(css)}:${line}`, msg: `.${c}` });
  }
}

const badSuppressions = suppressions.flatMap(m => (!m.reason ? [{ loc: m.loc, msg: 'missing a reason' }] : !m.used ? [{ loc: m.loc, msg: 'no undefined class on this line or the next' }] : []));

const sections = [
  ['Orphan CSS modules', 'Delete the file, or import it.', orphans],
  ['Unused classes', 'Delete the class, or reference it as <binding>.<className>.', dead],
  ['Undefined classes', 'The module defines no such class, so this evaluates to undefined. Before removing the reference, check whether the\n   class was renamed or deleted in the CSS (`git log -S".name" -- <module>.module.css`): if so, this element lost its\n   styles, so point it at the new class. Otherwise add the class, remove the reference, or, if it is deliberately\n   unstyled, add `// css-modules-allow-undefined: <reason>` above it.', undefinedRefs],
  ['Classes used only by tests', 'The shipped app never uses them. Delete them, or use them in the component.', testOnly],
  ['Dynamic class access', 'This check cannot follow styles[x], so unused classes in these files go unreported.\n   Use a typed lookup instead, e.g.\n     const sizeClass: Record<Size, string> = { small: styles.small, large: styles.large };', dynamic],
  ['Unusable css-modules-allow-undefined comments', 'Write `// css-modules-allow-undefined: <reason>` directly above or at the end of a styles.x line whose class is undefined, or delete the comment.', badSuppressions],
  ['Shadowed CSS module bindings', 'The check matches styles.x by name, not scope, so it cannot tell the shadowing variable from the stylesheet. Rename the variable.', [...info.values()].flatMap(r => r.shadowed)],
  ['Unsupported CSS module imports', 'Import the module as a default import and check the path resolves.', [...unresolved, ...[...info.values()].flatMap(r => r.other)]],
].filter(([, , items]) => items.length);

if (!sections.length) {
  console.log(`${green('✔')} No unused CSS module classes ${dim(`(checked ${info.size} modules, ${total} classes)`)}`);
  process.exit(0);
}

for (const [title, hint, items] of sections) {
  if (annotate) items.forEach(i => console.log(annotation(title, hint, i)));
  console.log(`\n${red('✖')} ${bold(title)} ${dim(`(${items.length})`)}`);
  console.log(dim(`   ${hint}`));
  const pad = Math.max(...items.map(i => i.loc.length));
  for (const i of items.sort((x, y) => x.loc.localeCompare(y.loc, 'en', { numeric: true }))) {
    console.log(`   ${cyan(i.loc.padEnd(pad))}  ${yellow(i.msg)}${i.note ? dim(`  ${i.note}`) : ''}`);
  }
}
const count = sections.reduce((n, [, , items]) => n + items.length, 0);
console.log(`\n${red(bold(`✖ Unused CSS check failed: ${count} problem${count === 1 ? '' : 's'}`))} ${dim(`(checked ${info.size} modules, ${total} classes)`)}`);
process.exit(1);
