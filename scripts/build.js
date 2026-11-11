// scripts/build.js (T1) — the static build (contract section 4.30.2). Run from the repo root: `npm run build`.
//
//   1. remove dist/; id = BUILD_ID || `git rev-parse --short HEAD` || Date.now().toString(36)
//   2. src/ -> dist/a/<id>/src/, styles/ -> dist/a/<id>/styles/; favicon.svg, manifest.webmanifest -> dist/;
//      dist/icons/*.png from make-icons.js
//   3. index.html -> dist/index.html with ="./src/ and ="./styles/ pointing into the hashed folder
//   4. the import crawl (missing file, bare specifier, import leaving src/, import rule of contract section 2,
//      its server/* row included), the forbidden API names of section 4.28, <link rel="modulepreload"> for every
//      module app.js reaches
//   5. every href / src of dist/index.html and every icon of the manifest exists in dist/
//   6. dist/config.json
//   7. the secret scan; no server/, scripts/, tests/, dev/, legacy/ and no .env* file in dist/
//   8. the file count and the total size
//
// The checks of step 4 read the source tree and run before anything is copied, so a build that fails them writes
// nothing. A failed build never leaves a dist/ behind. All module imports and the Worker URL are relative, so they
// resolve inside the hashed folder: a deploy can never mix old and new modules from the HTTP cache.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { isBuiltin } from 'node:module';
import { join, posix } from 'node:path';
import { makeIcon } from './make-icons.js';

const ROOT = process.cwd();
const DIST = join(ROOT, 'dist');

/** dist/icons/<name>: edge length. The names are the ones index.html and the manifest use (section 4.30.4). */
const ICONS = [['apple-touch-icon.png', 180], ['icon-192.png', 192], ['icon-512.png', 512]];

/** A name that scripts/serve.js is willing to serve as a path segment; the build id becomes a folder name. */
const SERVABLE_SEGMENT = /^[A-Za-z0-9_-](?:[A-Za-z0-9._-]*[A-Za-z0-9_-])?$/;

const ENTRIES = ['src/app.js', 'src/core/search-worker.js'];

class BuildError extends Error {}

/**
 * @param {string|string[]} problems
 * @returns {never}
 */
function fail(problems) {
  throw new BuildError(Array.isArray(problems) ? problems.join('\n') : problems);
}

/**
 * Every file and every directory under `dir`, as sorted paths relative to it with `/` separators.
 * @param {string} dir
 * @returns {Promise<{files: string[], dirs: string[]}>}
 */
async function listTree(dir) {
  /** @type {string[]} */
  const files = [];
  /** @type {string[]} */
  const dirs = [];
  /** @param {string} at @param {string} prefix */
  async function walk(at, prefix) {
    for (const entry of await readdir(at, { withFileTypes: true })) {
      const rel = prefix + entry.name;
      if (entry.isDirectory()) { dirs.push(rel); await walk(join(at, entry.name), `${rel}/`); } else files.push(rel);
    }
  }
  await walk(dir, '');
  return { files: files.sort(), dirs: dirs.sort() };
}

/** @param {string} text @param {number} index @returns {number} the 1-based line of `index` */
function lineAt(text, index) {
  let line = 1;
  for (let i = text.indexOf('\n'); i >= 0 && i < index; i = text.indexOf('\n', i + 1)) line++;
  return line;
}

// ---------------------------------------------------------------------------------------------------------------
// Step 1: the build id
// ---------------------------------------------------------------------------------------------------------------

function buildId() {
  let id = process.env.BUILD_ID ?? '';
  if (!id) {
    try {
      id = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
        cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true,
      }).trim();
    } catch {
      id = '';
    }
  }
  if (!id) id = Date.now().toString(36);
  if (!SERVABLE_SEGMENT.test(id)) fail(`the build id "${id}" cannot be used as a folder name (letters, digits, "_", "-" and inner dots only)`);
  return id;
}

// ---------------------------------------------------------------------------------------------------------------
// Step 4, part one: a small JavaScript lexer, so that comments, strings and regular expressions never look like code
// ---------------------------------------------------------------------------------------------------------------

/** After these words a `/` starts a regular expression, not a division. */
const REGEX_AFTER = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);

/** @param {string} ch */
function isWordChar(ch) {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || ch === '_' || ch === '$' || ch > '\x7f';
}

/**
 * The end of the regular expression literal that starts at `start`, or null when the `/` there cannot start one.
 * @param {string} text
 * @param {number} start
 * @returns {{bodyEnd: number, next: number}|null}
 */
function regexEnd(text, start) {
  let inClass = false;
  for (let j = start + 1; j < text.length; j++) {
    const ch = text[j];
    if (ch === '\n' || ch === '\r') return null;
    if (ch === '\\') { j++; continue; }
    if (inClass) { if (ch === ']') inClass = false; continue; }
    if (ch === '[') { inClass = true; continue; }
    if (ch === '/') {
      let next = j + 1;
      while (next < text.length && isWordChar(text[next])) next++;        // flags
      return { bodyEnd: j, next };
    }
  }
  return null;
}

/**
 * Replaces every character of the given ranges except line breaks by a space; offsets and lines stay the same.
 * @param {string} text
 * @param {[number, number][]} ranges ascending, not overlapping
 */
function blankOut(text, ranges) {
  let out = '', at = 0;
  for (const [from, to] of ranges) {
    out += text.slice(at, from) + text.slice(from, to).replace(/[^\n\r]/g, ' ');
    at = to;
  }
  return out + text.slice(at);
}

/**
 * Two views of a module, both as long as the source:
 * `code` has its comments blanked (CONTRACT-NOTES item 1: JSDoc `@import` tags and `import('…')` type expressions
 * are not runtime imports); `shape` also has the contents of strings, templates and regular expressions blanked,
 * with the quotes kept, so that import syntax can be matched without being fooled by text.
 * @param {string} text
 * @returns {{code: string, shape: string}}
 */
function lex(text) {
  const n = text.length;
  /** @type {[number, number][]} */
  const comments = [];
  /** @type {[number, number][]} */
  const literals = [];
  /** @type {number[]} */
  const braces = [];                 // one counter per open `${`: the braces opened inside that substitution
  let afterValue = false;            // true when the last token ends a value, so that a `/` divides
  let i = 0;

  /** Template characters from `from` on: returns the index after the closing backtick or after `${`. @param {number} from */
  const templateText = (from) => {
    for (let j = from; j < n; j++) {
      const ch = text[j];
      if (ch === '\\') { j++; continue; }
      if (ch === '`') { literals.push([from, j]); afterValue = true; return j + 1; }
      if (ch === '$' && text[j + 1] === '{') { literals.push([from, j]); braces.push(0); afterValue = false; return j + 2; }
    }
    literals.push([from, n]);
    return n;
  };

  while (i < n) {
    const ch = text[i], next = text[i + 1];
    if (ch === '/' && next === '/') {
      let end = text.indexOf('\n', i);
      if (end < 0) end = n;
      comments.push([i, end]); i = end;
    } else if (ch === '/' && next === '*') {
      let end = text.indexOf('*/', i + 2);
      end = end < 0 ? n : end + 2;
      comments.push([i, end]); i = end;
    } else if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < n && text[j] !== ch && text[j] !== '\n') j += text[j] === '\\' ? 2 : 1;
      j = Math.min(j, n);
      literals.push([i + 1, j]);
      i = text[j] === ch ? j + 1 : j; afterValue = true;
    } else if (ch === '`') {
      i = templateText(i + 1);
    } else if (ch === '{') {
      if (braces.length) braces[braces.length - 1]++;
      afterValue = false; i++;
    } else if (ch === '}') {
      if (braces.length && braces[braces.length - 1] === 0) { braces.pop(); i = templateText(i + 1); continue; }
      if (braces.length) braces[braces.length - 1]--;
      afterValue = true; i++;
    } else if (ch === '/') {
      const regex = afterValue ? null : regexEnd(text, i);
      if (regex) { literals.push([i + 1, regex.bodyEnd]); i = regex.next; afterValue = true; } else { afterValue = false; i++; }
    } else if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++;
    } else if (isWordChar(ch)) {
      let j = i + 1;
      while (j < n && isWordChar(text[j])) j++;
      // `o.in / 2`: a member name is a value whatever the word is (a spread `...new X` is not a member access)
      let before = i - 1;
      while (before >= 0 && (text[before] === ' ' || text[before] === '\t' || text[before] === '\n' || text[before] === '\r')) before--;
      const member = before >= 0 && text[before] === '.' && text[before - 1] !== '.';
      afterValue = member || !REGEX_AFTER.has(text.slice(i, j)); i = j;
    } else if (ch === ')' || ch === ']') {
      afterValue = true; i++;
    } else if ((ch === '+' || ch === '-') && next === ch) {
      afterValue = true; i += 2;                                           // x++ / y divides
    } else {
      afterValue = false; i++;
    }
  }
  const code = blankOut(text, comments);
  return { code, shape: blankOut(code, literals) };
}

// ---------------------------------------------------------------------------------------------------------------
// Step 4, part two: imports of one module
// ---------------------------------------------------------------------------------------------------------------

const NOT_A_MEMBER = '(?<![\\w$.#])';
/** `import './x.js'` */
const SIDE_EFFECT_IMPORT = new RegExp(`${NOT_A_MEMBER}import\\s*(?=['"])`, 'g');
/** `import a, { b as c }, * as d from './x.js'` */
const IMPORT_FROM = new RegExp(`${NOT_A_MEMBER}import\\b(?!\\s*[(.:'"])[^'"\`;()=]*?\\bfrom\\s*(?=['"])`, 'g');
/** `export * from`, `export * as ns from`, `export { a, b as c } from` */
const EXPORT_FROM = new RegExp(`${NOT_A_MEMBER}export\\s*(?:\\*\\s*(?:as\\s+[\\w$]+\\s*)?|\\{[^}'"\`;]*\\}\\s*)from\\s*(?=['"])`, 'g');
/** every `import` that is a statement (not `import(`, not `import.meta`, not an object key `import:`) */
const IMPORT_STATEMENT = new RegExp(`${NOT_A_MEMBER}import\\b(?!\\s*[(.:])`, 'g');
/** every `from '…'` */
const FROM_STRING = new RegExp(`${NOT_A_MEMBER}from\\s*(?=['"])`, 'g');
const DYNAMIC_IMPORT = new RegExp(`${NOT_A_MEMBER}import\\s*\\(\\s*`, 'g');
const NEW_URL = new RegExp(`${NOT_A_MEMBER}new\\s+URL\\s*\\(\\s*`, 'g');
/** `import.meta.resolve('./x.js')`: the same URL as `new URL('./x.js', import.meta.url)` */
const META_RESOLVE = new RegExp(`${NOT_A_MEMBER}import\\s*\\.\\s*meta\\s*\\.\\s*resolve\\s*\\(\\s*`, 'g');
/** what follows the path in `new URL('./x.js', import.meta.url)`; a trailing comma is allowed */
const THEN_MODULE_URL = /^\s*,\s*import\s*\.\s*meta\s*\.\s*url\s*,?\s*$/;
const MENTIONS_MODULE_META = /(?<![\w$.#])import\s*\.\s*meta(?![\w$])/;
/** `new URL(import.meta.url)`: the module's own address, which loads nothing */
const ONLY_MODULE_URL = /^\s*import\s*\.\s*meta\s*\.\s*url\s*$/;

/**
 * The runtime imports of a module: static `import` / `export … from`, `import('…')`, `new URL('…', import.meta.url)`
 * and its twin `import.meta.resolve('…')`.
 * Anything of these that cannot be read (a computed specifier) is a problem, because it cannot be checked.
 * @param {string} text the source
 * @param {string} shape the second view of `lex`
 * @returns {{edges: {kind: 'static'|'dynamic'|'url', spec: string, line: number}[], problems: {line: number, text: string}[]}}
 */
function findImports(text, shape) {
  /** @type {{kind: 'static'|'dynamic'|'url', spec: string, line: number}[]} */
  const edges = [];
  /** @type {{line: number, text: string}[]} */
  const problems = [];
  /** The plain string literal whose opening quote is at `open`. @param {number} open */
  const literalAt = (open) => {
    const quote = shape[open];
    if (quote !== '"' && quote !== "'" && quote !== '`') return null;
    const close = shape.indexOf(quote, open + 1);
    if (close < 0 || shape.slice(open + 1, close).trim() !== '') return null;     // a template with a substitution
    return { spec: text.slice(open + 1, close), end: close + 1 };
  };

  const understoodImports = new Set(), understoodFroms = new Set();
  for (const [pattern, keywordIsImport] of /** @type {[RegExp, boolean][]} */ ([[SIDE_EFFECT_IMPORT, true], [IMPORT_FROM, true], [EXPORT_FROM, false]])) {
    for (const m of shape.matchAll(pattern)) {
      const open = m.index + m[0].length;
      const literal = literalAt(open);
      if (!literal) continue;
      if (keywordIsImport) understoodImports.add(m.index);
      understoodFroms.add(open);
      edges.push({ kind: 'static', spec: literal.spec, line: lineAt(text, m.index) });
    }
  }
  // Nothing that looks like an import statement may be skipped silently.
  for (const m of shape.matchAll(IMPORT_STATEMENT)) {
    if (!understoodImports.has(m.index)) problems.push({ line: lineAt(text, m.index), text: 'this import statement could not be read' });
  }
  for (const m of shape.matchAll(FROM_STRING)) {
    const open = m.index + m[0].length;
    if (!understoodFroms.has(open)) problems.push({ line: lineAt(text, m.index), text: 'this "from" clause could not be read' });
  }

  for (const m of shape.matchAll(DYNAMIC_IMPORT)) {
    const literal = literalAt(m.index + m[0].length);
    if (literal && /^\s*[,)]/.test(shape.slice(literal.end, literal.end + 256))) {
      edges.push({ kind: 'dynamic', spec: literal.spec, line: lineAt(text, m.index) });
    } else {
      problems.push({ line: lineAt(text, m.index), text: 'import() with a computed specifier cannot be checked' });
    }
  }

  for (const m of shape.matchAll(NEW_URL)) {
    const open = m.index + m[0].length;
    let depth = 1, end = open;
    for (; end < shape.length && depth > 0; end++) {
      if (shape[end] === '(') depth++; else if (shape[end] === ')') depth--;
    }
    const args = shape.slice(open, end - 1);
    if (!MENTIONS_MODULE_META.test(args) || ONLY_MODULE_URL.test(args)) continue;      // not relative to the module
    const literal = literalAt(open);
    if (literal && THEN_MODULE_URL.test(shape.slice(literal.end, end - 1))) {
      edges.push({ kind: 'url', spec: literal.spec, line: lineAt(text, m.index) });
    } else if (literal) {
      problems.push({ line: lineAt(text, m.index), text: 'new URL(…) with a base that is built from import.meta, not import.meta.url itself, cannot be checked' });
    } else {
      problems.push({ line: lineAt(text, m.index), text: 'new URL(…, import.meta.url) with a computed path cannot be checked' });
    }
  }

  for (const m of shape.matchAll(META_RESOLVE)) {
    const literal = literalAt(m.index + m[0].length);
    if (literal && /^\s*[,)]/.test(shape.slice(literal.end, literal.end + 256))) {
      edges.push({ kind: 'url', spec: literal.spec, line: lineAt(text, m.index) });
    } else {
      problems.push({ line: lineAt(text, m.index), text: 'import.meta.resolve() with a computed specifier cannot be checked' });
    }
  }
  edges.sort((a, b) => a.line - b.line);                                    // source order (the sort is stable)
  return { edges, problems };
}

// ---------------------------------------------------------------------------------------------------------------
// Step 4, part three: the import rule of contract section 2
// ---------------------------------------------------------------------------------------------------------------

const CORE = 'src/core/', COACH = 'src/coach/', UI = 'src/ui/', GAME = 'src/game/';
const CODES = 'src/core/codes.js', ENGINE = 'src/core/engine.js', NOTATION = 'src/core/notation.js';
const LIGHT_CORE = [ENGINE, NOTATION, CODES];
const HEAVY_CORE = ['src/core/position.js', 'src/core/search.js'];
/** The proxy loads these three, so they stay inside a closed set. */
const PROXY_SHARED = ['src/coach/protocol.js', 'src/coach/lexicon.js', 'src/coach/fallback.js'];
/** CONTRACT-NOTES item 2: the files the table omits have no runtime import at all. */
const NO_IMPORTS = ['src/config.js', 'src/core/types.js', 'src/coach/types.js', 'src/game/types.js', 'src/ui/types.js'];
const CODES_ONLY = ['src/game/tasks.js', 'src/game/store.js', 'src/game/policy.js', 'src/game/rival.js', 'src/game/strings.js'];

/**
 * @param {string} from a module under src/
 * @param {string} to an existing file under src/
 * @returns {string|null} null when the import is allowed, else the rule it breaks
 */
function ruleAgainst(from, to) {
  if (NO_IMPORTS.includes(from)) return `${from} has no runtime import (types cross areas in JSDoc only)`;
  if (from === 'src/app.js' || from === 'src/game/ports.js') return null;                     // anything under src/
  if (from.startsWith(CORE)) {
    if (!to.startsWith(CORE)) return 'src/core/* may import src/core/* only';
    if (LIGHT_CORE.includes(from) && HEAVY_CORE.includes(to)) return 'engine.js, notation.js and codes.js never import position.js or search.js';
    return null;
  }
  if (PROXY_SHARED.includes(from)) {
    return to === CODES || PROXY_SHARED.includes(to) ? null : 'protocol.js, lexicon.js and fallback.js import only codes.js and each other';
  }
  if (from.startsWith(COACH)) {
    return LIGHT_CORE.includes(to) || to.startsWith(COACH) ? null : 'src/coach/* may import core/codes.js, core/engine.js, core/notation.js and src/coach/*';
  }
  if (from.startsWith(UI)) {
    return to.startsWith(UI) || to === ENGINE || to === CODES ? null : 'src/ui/* may import src/ui/*, core/engine.js and core/codes.js';
  }
  if (from === 'src/game/session.js') {
    return LIGHT_CORE.includes(to) ? null : 'game/session.js may import core/engine.js, core/notation.js and core/codes.js';
  }
  if (CODES_ONLY.includes(from)) return to === CODES ? null : `${from.slice(4)} may import core/codes.js only`;
  if (from === 'src/game/record.js') {
    return to === CODES || to === ENGINE ? null : 'game/record.js may import core/codes.js and core/engine.js only';
  }
  if (from === 'src/game/director.js') {
    return to.startsWith(GAME) || to === CODES ? null : 'game/director.js may import src/game/* and core/codes.js (everything else arrives through ports)';
  }
  return `the import rule names no file ${from}, so it may not import anything`;
}

const SERVER_RULE = 'server/* may import server/*, src/coach/protocol.js, lexicon.js, fallback.js, src/core/codes.js and (provider.js only) openai';

/**
 * The last row of the import rule: the proxy. server/ is not part of the site and is never copied; only its imports
 * are read here, so that the row is enforced like the others. Node's own modules are not restricted.
 * @param {string[]} problems receives one line per broken import
 */
async function checkServerImports(problems) {
  if (!existsSync(join(ROOT, 'server'))) return;
  for (const name of (await listTree(join(ROOT, 'server'))).files) {
    if (!name.endsWith('.js')) continue;
    const file = `server/${name}`;
    const text = await readFile(join(ROOT, file), 'utf8');
    const found = findImports(text, lex(text).shape);
    for (const p of found.problems) problems.push(`${file}:${p.line}: ${p.text}`);
    for (const { spec, line } of found.edges) {
      if (isBuiltin(spec)) continue;
      let allowed;
      if (spec.startsWith('./') || spec.startsWith('../')) {
        const to = posix.normalize(posix.join(posix.dirname(file), spec));
        allowed = to.startsWith('server/') || to === CODES || PROXY_SHARED.includes(to);
      } else {
        allowed = file === 'server/provider.js' && (spec === 'openai' || spec.startsWith('openai/'));
      }
      if (!allowed) problems.push(`${file}:${line}: "${spec}" breaks the import rule: ${SERVER_RULE}`);
    }
  }
}

/** What section 4.28 forbids in src/, by name. Looked for in code, not in comments. */
const FORBIDDEN = /** @type {[string, RegExp][]} */ ([
  ['AbortSignal.any', /\bAbortSignal\s*\??\.\s*any\b/g],
  ['AbortSignal.timeout', /\bAbortSignal\s*\??\.\s*timeout\b/g],
  ['crypto.randomUUID', /\bcrypto\s*\??\.\s*randomUUID\b/g],
  ['crypto.subtle', /\bcrypto\s*\??\.\s*subtle\b/g],
  ['navigator.clipboard', /\bnavigator\s*\??\.\s*clipboard\b/g],
  ['serviceWorker', /serviceWorker/g],
  ['SpeechRecognition', /SpeechRecognition/g],
  ['for await', /\bfor\s+await\b/g],
  ['backdrop-filter', /backdrop-filter|backdropFilter/g],
]);

/**
 * Reads src/ (and the imports of server/), checks every module against the rules of step 4 and returns the modules
 * app.js reaches through static imports (app.js itself excluded), in the order a breadth-first walk finds them.
 * @returns {Promise<string[]>}
 */
async function checkSources() {
  const files = (await listTree(join(ROOT, 'src'))).files.map((file) => `src/${file}`);
  const known = new Set(files);
  /** @type {string[]} */
  const problems = [];
  /** @type {Map<string, {to: string, kind: 'static'|'dynamic'|'url'}[]>} */
  const graph = new Map();

  for (const entry of ENTRIES) if (!known.has(entry)) problems.push(`${entry}: missing file (an entry of the import crawl)`);

  for (const file of files) {
    const text = await readFile(join(ROOT, file), 'utf8');
    const isModule = file.endsWith('.js');
    const { code, shape } = isModule ? lex(text) : { code: text, shape: text };

    for (const [name, pattern] of FORBIDDEN) {
      for (const m of code.matchAll(pattern)) problems.push(`${file}:${lineAt(code, m.index)}: ${name} is forbidden in src/ (contract section 4.28)`);
    }
    if (!isModule) continue;

    /** @type {{to: string, kind: 'static'|'dynamic'|'url'}[]} */
    const out = [];
    graph.set(file, out);
    const found = findImports(text, shape);
    for (const p of found.problems) problems.push(`${file}:${p.line}: ${p.text}`);
    for (const { kind, spec, line } of found.edges) {
      const where = `${file}:${line}: "${spec}"`;
      if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(spec) || spec.startsWith('/')) {
        problems.push(`${where} leaves src/ (only relative paths resolve inside the hashed folder)`);
        continue;
      }
      if (!spec.startsWith('./') && !spec.startsWith('../')) { problems.push(`${where} is a bare specifier`); continue; }
      const to = posix.normalize(posix.join(posix.dirname(file), spec));
      if (!to.startsWith('src/')) { problems.push(`${where} leaves src/`); continue; }
      if (!known.has(to)) { problems.push(`${where} is a missing file (${to}; names are case-sensitive on the web server)`); continue; }
      const broken = ruleAgainst(file, to);
      if (broken) problems.push(`${where} breaks the import rule: ${broken}`);
      out.push({ to, kind });
    }
  }

  /**
   * @param {string} start
   * @param {boolean} staticOnly
   * @returns {Map<string, string>} every module reached, with the module it was reached from
   */
  const reach = (start, staticOnly) => {
    /** @type {Map<string, string>} */
    const via = new Map([[start, '']]);
    const queue = [start];
    for (let head = 0; head < queue.length; head++) {
      for (const edge of graph.get(queue[head]) ?? []) {
        if ((staticOnly && edge.kind !== 'static') || via.has(edge.to)) continue;
        via.set(edge.to, queue[head]);
        queue.push(edge.to);
      }
    }
    return via;
  };

  // "never import": not through another module either.
  for (const light of LIGHT_CORE) {
    const via = reach(light, false);
    for (const heavy of HEAVY_CORE) {
      if (!via.has(heavy) || via.get(heavy) === light) continue;           // a direct import is reported above
      const chain = [heavy];
      while (chain[0] !== light) chain.unshift(via.get(chain[0]) ?? light);
      problems.push(`${light}: reaches ${heavy} through ${chain.slice(1, -1).join(' -> ')}; engine.js, notation.js and codes.js never import position.js or search.js`);
    }
  }

  await checkServerImports(problems);

  if (problems.length) fail(problems);
  return [...reach('src/app.js', true).keys()].slice(1);
}

// ---------------------------------------------------------------------------------------------------------------
// Steps 5 and 7: checks on dist/
// ---------------------------------------------------------------------------------------------------------------

/**
 * The file in dist/ a reference of dist/index.html or of the manifest points to, or a problem.
 * @param {string} ref
 * @returns {{file: string}|{problem: string}|null} null when the reference loads nothing (a fragment, a data: URI)
 */
function distTarget(ref) {
  if (ref === '' || ref.startsWith('#') || /^data:/i.test(ref)) return null;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(ref) || ref.startsWith('//')) return { problem: 'is an external URL; the page loads nothing from outside dist/' };
  if (ref.startsWith('/')) return { problem: 'is an absolute path; it breaks when the site is served from a sub-folder' };
  const file = posix.normalize(ref.split(/[?#]/, 1)[0]);
  if (file === '.' || file === './') return { file: 'index.html' };
  if (file.startsWith('../')) return { problem: 'leaves dist/' };
  return { file: file.replace(/\/$/, '/index.html') };
}

/** Step 5. @param {string} html the text of dist/index.html */
async function verifyReferences(html) {
  const present = new Set((await listTree(DIST)).files);
  /** @type {string[]} */
  const problems = [];
  /** @param {string} where @param {string} ref */
  const check = (where, ref) => {
    const target = distTarget(ref);
    if (!target) return;
    if ('problem' in target) problems.push(`${where} "${ref}" ${target.problem}`);
    else if (!present.has(target.file)) problems.push(`${where} "${ref}" is missing in dist/ (${target.file})`);
  };
  const markup = html.replace(/<!--[\s\S]*?-->/g, '');
  for (const m of markup.matchAll(/(?<![\w-])(href|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi)) {
    check(`dist/index.html: ${m[1].toLowerCase()}`, m[2] ?? m[3] ?? m[4] ?? '');
  }
  /** @type {unknown} */
  let manifest;
  try {
    manifest = JSON.parse(await readFile(join(DIST, 'manifest.webmanifest'), 'utf8'));
  } catch {
    fail('manifest.webmanifest is not valid JSON');
  }
  const icons = /** @type {{icons?: unknown}|null} */ (manifest)?.icons;
  for (const icon of /** @type {unknown[]} */ (Array.isArray(icons) ? icons : [])) {
    const src = /** @type {{src?: unknown}|null} */ (icon)?.src;
    if (typeof src === 'string' && src !== '') check('manifest.webmanifest: icon', src);
    else problems.push('manifest.webmanifest: an icon has no src');
  }
  if (problems.length) fail(problems);
}

/** The one place where the contract itself puts the variable's name into the page: TXT of section 4.28.8. */
const KEY_NAME_IN_SETTINGS_TEXT = Buffer.from('服务器没有配置密钥（COACH_API_KEY）', 'utf8').toString('latin1');
const NO_DIST_DIRS = new Set(['server', 'scripts', 'tests', 'dev', 'legacy']);

/** Step 7. Values are never printed, only the name of the variable. */
async function scanDist() {
  const { files, dirs } = await listTree(DIST);
  /** @type {string[]} */
  const problems = [];
  for (const dir of dirs) {
    const name = posix.basename(dir);
    if (NO_DIST_DIRS.has(name)) problems.push(`dist/${dir}/ must never be published`);
    if (name.startsWith('.env')) problems.push(`dist/${dir}/ looks like an environment file`);
  }
  const secrets = Object.entries(process.env).filter(([name, value]) => /(_KEY|_TOKEN|_SECRET)$/.test(name) && (value ?? '').length >= 8);
  let bytes = 0;
  for (const file of files) {
    if (posix.basename(file).startsWith('.env')) problems.push(`dist/${file} is an environment file`);
    const data = await readFile(join(DIST, file));
    bytes += data.length;
    const text = data.toString('latin1');
    if (text.replaceAll(KEY_NAME_IN_SETTINGS_TEXT, '').includes('COACH_API_KEY')) problems.push(`dist/${file} contains COACH_API_KEY`);
    if (/(?<![A-Za-z0-9_-])sk-/.test(text)) problems.push(`dist/${file} contains what looks like a secret key ("sk-")`);
    for (const [name, value] of secrets) {
      if (data.includes(value ?? '')) problems.push(`dist/${file} contains the value of the environment variable ${name}`);
    }
  }
  if (problems.length) fail(['secret scan:', ...problems]);
  return { count: files.length, bytes };
}

// ---------------------------------------------------------------------------------------------------------------
// The build
// ---------------------------------------------------------------------------------------------------------------

async function build() {
  // 1
  await rm(DIST, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  const id = buildId();
  const apiBase = process.env.COACH_API_BASE || null;           // for step 6; a wrong value fails before any work
  if (apiBase !== null) {
    let protocol = '';
    try { protocol = new URL(apiBase).protocol; } catch { /* not a URL */ }
    if (protocol !== 'https:') fail('COACH_API_BASE must be empty or an https URL');
  }
  for (const name of ['index.html', 'favicon.svg', 'manifest.webmanifest', 'src', 'styles']) {
    if (!existsSync(join(ROOT, name))) fail(`${name} is missing in ${ROOT}`);
  }

  // 4, on the sources
  const reachable = await checkSources();

  // 2
  const hashed = join(DIST, 'a', id);
  await mkdir(hashed, { recursive: true });
  await cp(join(ROOT, 'src'), join(hashed, 'src'), { recursive: true });
  await cp(join(ROOT, 'styles'), join(hashed, 'styles'), { recursive: true });
  for (const name of ['favicon.svg', 'manifest.webmanifest']) await cp(join(ROOT, name), join(DIST, name));
  await mkdir(join(DIST, 'icons'));
  for (const [name, size] of /** @type {[string, number][]} */ (ICONS)) await writeFile(join(DIST, 'icons', name), makeIcon(size));

  // 3, and the preload links of 4
  let replaced = 0;
  let html = (await readFile(join(ROOT, 'index.html'), 'utf8')).replace(/="\.\/(src|styles)\//g, (_, tree) => {
    replaced++;
    return `="./a/${id}/${tree}/`;
  });
  if (replaced < 2) fail(`index.html: expected at least 2 references to "./src/ and "./styles/, found ${replaced}`);
  if (reachable.length) {
    const links = reachable.map((file) => `<link rel="modulepreload" href="./a/${id}/${file}">\n`).join('');
    let placed = false;
    html = html.replace(/<\/head\s*>/i, (end) => { placed = true; return links + end; });
    if (!placed) fail('index.html has no </head> to put the modulepreload links before');
  }
  await writeFile(join(DIST, 'index.html'), html);

  // 5
  await verifyReferences(html);

  // 6
  const config = { apiBase, build: id, coach: apiBase === null ? { mode: 'off', reason: 'no_proxy' } : { mode: 'live', reason: null } };
  await writeFile(join(DIST, 'config.json'), `${JSON.stringify(config)}\n`);

  // 7, 8
  const { count, bytes } = await scanDist();
  console.log(`静态站点已生成到 dist/：${count} 个文件，共 ${(bytes / 1024).toFixed(1)} KB，构建号 ${id}。`);
}

try {
  await build();
} catch (e) {
  await rm(DIST, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }).catch(() => {});
  if (e instanceof BuildError) console.error(`build failed:\n${e.message}`);
  else console.error('build failed:', e);
  process.exitCode = 1;
}
