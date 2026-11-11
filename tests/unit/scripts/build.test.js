import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Contract section 4.30.2 (and the import rule of section 2, the forbidden names of section 4.28, section 14.6).
// scripts/build.js builds the project in the current directory, so every test runs it as a child process inside
// a made-up project in a temporary directory. The repo's own dist/ is never written.

const BUILD = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'scripts', 'build.js');
const MARK = 'DECOY-CONTENT-THAT-MUST-NEVER-BE-PUBLISHED';
const lines = (...rows) => `${rows.join('\n')}\n`;

/** A module full of things that look like imports and are not, or that could throw a lexer off. */
const TRICKY_CODES = lines(
  "// a line comment with import './nowhere.js' and a quote ' that never closes",
  "/* a block comment: import x from '../game/strings.js'; export * from \"openai\"; */",
  "/** @import { Mood } from '../game/types.js' */",
  "/** @type {import('../coach/brief.js').TurnReport|null} */",
  'export const report = null;',
  "export const NOTATION_RE = /^[前中后一二三四五'\"`/]{1,2}[进退平]\\/?$/u;",
  "export const URLS = ['http://example.invalid/a//b', \"it's // not a comment\", `template ${'nested `inner` ' + `${1 + 1}`} import './x.js'`];",
  'export const half = (a, b) => a / b / 2;   // two divisions, not a regular expression',
  "export const text = \"import fake from 'openai'\";",
  "export const CATS = ['brilliant', 'best', 'good', 'ok', 'mistake', 'blunder'];",
  // a lexer that misses this regular expression, or takes the division below for one, opens a template here
  // and swallows the rest of the file
  'export const TICK = /`/g;',
  'export const per = (a, b) => a / b + `/`;',
);

/** A project in which every row of the import rule is used the way it allows. */
const BASE = {
  'package.json': `{"type":"module","mark":"${MARK}"}\n`,
  'index.html': lines(
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="UTF-8">',
    '<link rel="apple-touch-icon" href="./icons/apple-touch-icon.png"><link rel="manifest" href="./manifest.webmanifest">',
    '<link rel="icon" type="image/svg+xml" href="./favicon.svg"><title>弈间 · 中国象棋</title>',
    '<link rel="stylesheet" href="./styles/tokens.css">',
    '<link rel="stylesheet" href="./styles/themes.css">',
    '<script type="module" src="./src/app.js"></script>',
    '</head>',
    '<body><div id="app" class="app"></div></body>',
    '</html>',
  ),
  'favicon.svg': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="28"/></svg>\n',
  'manifest.webmanifest': '{"name":"弈间 · 中国象棋","short_name":"弈间","start_url":"./","display":"standalone","orientation":"any","background_color":"#0b0f1d","theme_color":"#0b0f1d","icons":[{"src":"./icons/icon-192.png","sizes":"192x192","type":"image/png"},{"src":"./icons/icon-512.png","sizes":"512x512","type":"image/png"}]}\n',
  'styles/tokens.css': ':root { --page: #0b0f1d; }\n.mask { mask-image: none; -webkit-mask-size: cover; }\n',
  'styles/themes.css': '[data-theme="chibi"] { --accent: #d8402f; }\n',

  'src/app.js': lines(
    "import { loadConfig } from './config.js';",
    "import { createStage } from './ui/stage.js';",
    "import { createBrainPort } from './game/ports.js';",
    "import { createDirector } from './game/director.js';",
    "export const worker = () => new Worker(new URL('./core/search-worker.js', import.meta.url), { type: 'module' });",
    'export const boot = [loadConfig, createStage, createBrainPort, createDirector];',
  ),
  'src/config.js': lines(
    'export async function loadConfig() {',
    "  const res = await fetch(new URL('./config.json', document.baseURI), { cache: 'no-store' });",
    '  return res.json();',
    '}',
  ),

  'src/core/codes.js': TRICKY_CODES,
  'src/core/types.js': lines('/** @typedef {{row:number, col:number}} Square */', 'export {};'),
  'src/core/engine.js': lines("import { CATS } from './codes.js';", 'export const moveToNotation = () => CATS[0];'),
  'src/core/notation.js': lines("export { moveToNotation } from './engine.js';", "import './codes.js';"),
  'src/core/position.js': 'export const fromFen = () => null;\n',
  'src/core/search.js': lines("import { fromFen } from './position.js';", 'export const search = fromFen;'),
  'src/core/facts.js': lines("import './position.js';", "import './search.js';", "import * as engine from './engine.js';", 'export const facts = engine;'),
  'src/core/teacher.js': lines("import { search } from './search.js';", 'export const teach = search;'),
  'src/core/brain.js': lines("import { facts } from './facts.js';", "import { teach } from './teacher.js';", 'export const brain = [facts, teach];'),
  'src/core/search-worker.js': lines("import { brain } from './brain.js';", 'export default brain;'),

  'src/coach/types.js': 'export {};\n',
  'src/coach/protocol.js': lines("import '../core/codes.js';", 'export const PROTOCOL_VERSION = 1;'),
  'src/coach/lexicon.js': lines("import '../core/codes.js';", "import { PROTOCOL_VERSION } from './protocol.js';", 'export const v = PROTOCOL_VERSION;'),
  'src/coach/fallback.js': lines("import '../core/codes.js';", "import './lexicon.js';", "import './protocol.js';", 'export const composeLocal = () => "";'),
  'src/coach/markup.js': lines("import '../core/codes.js';", 'export const parse = () => [];'),
  'src/coach/book.js': lines("import '../core/notation.js';", "import '../core/engine.js';", 'export const createMoveBook = () => null;'),
  'src/coach/memory.js': lines("import '../core/codes.js';", 'export const createGameMemory = () => null;'),
  'src/coach/brief.js': lines(
    "/** @import { PositionFacts } from '../core/types.js' */",
    "import '../core/codes.js';",
    "import '../core/engine.js';",
    "import '../core/notation.js';",
    "import './lexicon.js';",
    "import './book.js';",
    "/** @param {import('../core/facts.js').Facts} facts @returns {import('../game/types.js').TurnBrief|null} */",
    'export const buildTurnBrief = (facts) => (facts ? null : null);',
  ),
  'src/coach/client.js': lines("import './protocol.js';", "import './fallback.js';", "import './markup.js';", 'export const createCoachClient = () => null;'),

  'src/game/types.js': 'export {};\n',
  'src/game/session.js': lines("import '../core/engine.js';", "import '../core/notation.js';", "import '../core/codes.js';", 'export const createSession = () => null;'),
  'src/game/tasks.js': lines("import '../core/codes.js';", 'export const createTasks = () => null;'),
  'src/game/store.js': lines("import '../core/codes.js';", 'export const createStore = () => null;'),
  'src/game/record.js': lines("import '../core/codes.js';", "import '../core/engine.js';", 'export const buildRecord = () => null;'),
  'src/game/policy.js': lines("import '../core/codes.js';", 'export const shouldSpeakOpp = () => false;'),
  'src/game/rival.js': lines("import '../core/codes.js';", 'export const rivalReact = () => null;'),
  'src/game/strings.js': lines("import '../core/codes.js';", "export const STR = { importFailed: '这个存档读不出来' };"),
  'src/game/director.js': lines(
    "/** @import { StagePort } from './types.js' */",
    "/** @import { TurnReport } from '../coach/brief.js' */",
    "import './session.js';",
    "import './tasks.js';",
    "import './policy.js';",
    "import './strings.js';",
    "import '../core/codes.js';",
    'export const createDirector = () => null;',
  ),
  'src/game/ports.js': lines(
    "import { brain } from '../core/brain.js';",
    "import { createCoachClient } from '../coach/client.js';",
    "import { buildTurnBrief } from '../coach/brief.js';",
    'export const createBrainPort = () => [brain, createCoachClient, buildTurnBrief];',
  ),

  'src/ui/types.js': 'export {};\n',
  'src/ui/geometry.js': 'export const VIEW_W = 920;\n',
  'src/ui/layout.js': lines("import { VIEW_W } from './geometry.js';", 'export const computeLayout = () => VIEW_W;'),
  'src/ui/board-view.js': lines("import './geometry.js';", "import { moveToNotation } from '../core/engine.js';", 'export const createBoardView = () => moveToNotation;'),
  'src/ui/texts.js': lines(
    'export const TXT = {',
    "  start: { go: '开战！', import: '导入存档', settings: '设置' },",
    "  reason: { no_proxy: '没有找到军师服务（config.json 里没有 apiBase）', no_key: '服务器没有配置密钥（COACH_API_KEY）' },",
    '};',
  ),
  'src/ui/hud.js': lines("import { TXT } from './texts.js';", 'export const createHud = () => TXT;'),
  'src/ui/stage.js': lines(
    "import './board-view.js';",
    "import './hud.js';",
    "import { CATS } from '../core/codes.js';",
    'export const createStage = () => CATS;',
  ),

  // what lies next to src/ in the repo and must never reach dist/
  '.env': `COACH_API_KEY=${MARK}\n`,
  '.env.local': `COACH_API_KEY=${MARK}\n`,
  'server/coach-handler.js': `// ${MARK}\n`,
  'scripts/build.js': `// ${MARK}\n`,
  'tests/unit/a.test.js': `// ${MARK}\n`,
  'dev/board.html': `<!-- ${MARK} -->\n`,
  'legacy/index.html': `<!-- ${MARK} -->\n`,
  'legacy/src/app.js': `// ${MARK}\n`,
  'node_modules/openai/index.js': `// ${MARK}\n`,
  'README.md': `${MARK}\n`,
};

/** The modules app.js reaches through static imports in BASE (worked out by hand from the lines above). */
const REACHED_FROM_APP = [
  'src/config.js', 'src/ui/stage.js', 'src/game/ports.js', 'src/game/director.js',
  'src/ui/board-view.js', 'src/ui/hud.js', 'src/core/codes.js', 'src/ui/geometry.js', 'src/core/engine.js', 'src/ui/texts.js',
  'src/core/brain.js', 'src/coach/client.js', 'src/coach/brief.js', 'src/core/facts.js', 'src/core/teacher.js',
  'src/core/position.js', 'src/core/search.js', 'src/coach/protocol.js', 'src/coach/fallback.js', 'src/coach/markup.js',
  'src/coach/lexicon.js', 'src/core/notation.js', 'src/coach/book.js',
  'src/game/session.js', 'src/game/tasks.js', 'src/game/policy.js', 'src/game/strings.js',
];

/** @type {string} */ let tmp;
let counter = 0;

before(async () => { tmp = await mkdtemp(join(os.tmpdir(), 'yijian-build-')); });
after(async () => { await rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

/** A fresh copy of BASE with `changes` applied: a string replaces or adds a file, null removes one. */
async function project(changes = {}) {
  const dir = join(tmp, `p${++counter}`);
  for (const [name, content] of Object.entries({ ...BASE, ...changes })) {
    if (content === null) continue;
    const file = join(dir, ...name.split('/'));
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, content);
  }
  return dir;
}

/** Runs the build in `dir` with an environment that holds nothing of the developer's shell. */
function build(dir, env = {}) {
  const base = { GIT_CEILING_DIRECTORIES: tmp };
  for (const name of ['PATH', 'Path', 'SystemRoot', 'windir', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'PATHEXT', 'ComSpec']) {
    if (process.env[name] !== undefined) base[name] = process.env[name];
  }
  const run = spawnSync(process.execPath, [BUILD], { cwd: dir, env: { ...base, ...env }, encoding: 'utf8' });
  return { status: run.status, stdout: run.stdout, stderr: run.stderr, dist: join(dir, 'dist') };
}

async function tree(dir) {
  const files = [], dirs = [];
  const walk = async (at, prefix) => {
    for (const entry of await readdir(at, { withFileTypes: true })) {
      if (entry.isDirectory()) { dirs.push(prefix + entry.name); await walk(join(at, entry.name), `${prefix}${entry.name}/`); } else files.push(prefix + entry.name);
    }
  };
  await walk(dir, '');
  return { files: files.sort(), dirs: dirs.sort() };
}

function assertFails(run, ...expected) {
  assert.equal(run.status, 1, `the build should have failed:\n${run.stdout}\n${run.stderr}`);
  for (const pattern of expected) assert.match(run.stderr, pattern);
  assert.equal(existsSync(run.dist), false, 'a failed build leaves no dist/ behind');
}

function assertBuilds(run) {
  assert.equal(run.status, 0, `the build should have passed:\n${run.stdout}\n${run.stderr}`);
  assert.equal(run.stderr, '');
}

// ---------------------------------------------------------------------------------------------------------------

test('hashed folder exists and index.html references resolve', async () => {
  const dir = await project();
  const run = build(dir, { BUILD_ID: 'abc123' });
  assertBuilds(run);
  const { files } = await tree(run.dist);

  // the hashed folder holds src/ and styles/, byte for byte; nothing else of the project is in dist/
  const sources = Object.keys(BASE).filter((name) => name.startsWith('src/') || name.startsWith('styles/'));
  for (const name of sources) {
    assert.deepEqual(await readFile(join(run.dist, 'a', 'abc123', ...name.split('/'))), Buffer.from(BASE[name]), name);
  }
  assert.deepEqual(files, [
    ...sources.map((name) => `a/abc123/${name}`),
    'config.json', 'favicon.svg', 'icons/apple-touch-icon.png', 'icons/icon-192.png', 'icons/icon-512.png', 'index.html', 'manifest.webmanifest',
  ].sort());
  assert.deepEqual(await readFile(join(run.dist, 'favicon.svg'), 'utf8'), BASE['favicon.svg']);
  assert.deepEqual(await readFile(join(run.dist, 'manifest.webmanifest'), 'utf8'), BASE['manifest.webmanifest']);

  // index.html: every reference to ./src/ and ./styles/ points into the hashed folder, and everything it loads exists
  const html = await readFile(join(run.dist, 'index.html'), 'utf8');
  assert.ok(!html.includes('="./src/') && !html.includes('="./styles/'));
  assert.ok(html.includes('<script type="module" src="./a/abc123/src/app.js"></script>'));
  assert.ok(html.includes('<link rel="stylesheet" href="./a/abc123/styles/tokens.css">'));
  assert.ok(html.includes('<link rel="stylesheet" href="./a/abc123/styles/themes.css">'));
  const refs = [...html.matchAll(/(?:href|src)="([^"]*)"/g)].map((m) => m[1]);
  assert.ok(refs.length >= 6 + REACHED_FROM_APP.length);
  for (const ref of refs) {
    assert.match(ref, /^\.\//, ref);
    assert.ok(files.includes(ref.slice(2)), `${ref} exists in dist/`);
  }
  // the icons of the page and of the manifest are PNGs of their size
  for (const [name, size] of [['apple-touch-icon.png', 180], ['icon-192.png', 192], ['icon-512.png', 512]]) {
    const png = await readFile(join(run.dist, 'icons', name));
    assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], name);
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [size, size], name);
  }
  for (const icon of JSON.parse(BASE['manifest.webmanifest']).icons) assert.ok(files.includes(icon.src.slice(2)), icon.src);

  // step 8: the file count and the total size
  let bytes = 0;
  for (const name of files) bytes += (await readFile(join(run.dist, ...name.split('/')))).length;
  assert.ok(run.stdout.includes(`${files.length} 个文件`), run.stdout);
  assert.ok(run.stdout.includes(`${(bytes / 1024).toFixed(1)} KB`), run.stdout);
  assert.ok(run.stdout.includes('abc123'), run.stdout);
});

test('a <link rel="modulepreload"> is emitted for every module reachable from app.js, and for no other', async () => {
  const dir = await project();
  const run = build(dir, { BUILD_ID: 'abc123' });
  assertBuilds(run);
  const html = await readFile(join(run.dist, 'index.html'), 'utf8');
  const preloaded = [...html.matchAll(/<link rel="modulepreload" href="\.\/a\/abc123\/([^"]+)">/g)].map((m) => m[1]);
  assert.deepEqual([...preloaded].sort(), [...REACHED_FROM_APP].sort());
  assert.equal(new Set(preloaded).size, preloaded.length, 'no module twice');
  assert.equal((html.match(/rel="modulepreload"/g) ?? []).length, REACHED_FROM_APP.length);
  assert.ok(html.indexOf('rel="modulepreload"') < html.indexOf('</head>'), 'the links are inside <head>');
  // not preloaded: the entry itself, the worker (reached by new URL only), modules nothing imports, the typedef files
  for (const name of ['src/app.js', 'src/core/search-worker.js', 'src/game/store.js', 'src/game/record.js', 'src/game/rival.js',
    'src/coach/memory.js', 'src/ui/layout.js', 'src/core/types.js', 'src/game/types.js']) {
    assert.ok(!preloaded.includes(name), name);
  }
});

test('the tricky module of the fixture is valid JavaScript, and what looks like an import in comments, strings, templates and regular expressions is not one', async () => {
  const dir = await project();
  const codes = await import(pathToFileURL(join(dir, 'src', 'core', 'codes.js')).href);
  assert.equal(codes.half(8, 2), 2);
  assert.equal(codes.URLS[2], "template nested `inner` 2 import './x.js'");
  assert.ok(codes.NOTATION_RE.test('前进/'));
  assert.ok(codes.TICK.test('`'));
  assert.equal(codes.per(6, 3), '2/');
  // BASE builds although codes.js, brief.js and director.js mention other areas in JSDoc (CONTRACT-NOTES item 1)
  assertBuilds(build(dir, { BUILD_ID: 'abc123' }));

  // and the lexer is still in step after all of it: a real import at the end of the same module is seen
  const planted = await project({ 'src/core/codes.js': `${TRICKY_CODES}import '../game/strings.js';\n` });
  assertFails(build(planted), /src\/core\/codes\.js:13: "\.\.\/game\/strings\.js" breaks the import rule/);
});

test('the build id is BUILD_ID, else (outside a git work tree) a base-36 timestamp', async () => {
  const dir = await project();
  const named = build(dir, { BUILD_ID: 'v2.0.0-rc_1' });
  assertBuilds(named);
  assert.ok(existsSync(join(named.dist, 'a', 'v2.0.0-rc_1', 'src', 'app.js')));
  assert.equal(JSON.parse(await readFile(join(named.dist, 'config.json'), 'utf8')).build, 'v2.0.0-rc_1');

  const started = Date.now();
  const stamped = build(dir);
  assertBuilds(stamped);
  const { build: id } = JSON.parse(await readFile(join(stamped.dist, 'config.json'), 'utf8'));
  assert.match(id, /^[0-9a-z]+$/);
  assert.ok(parseInt(id, 36) >= started && parseInt(id, 36) <= Date.now(), `${id} is the time of the build`);
  assert.deepEqual(await readdir(join(stamped.dist, 'a')), [id], 'the earlier build is gone: dist/ is rebuilt from nothing');

  for (const bad of ['../up', 'a/b', '.hidden', 'has space', 'tail.']) {
    assertFails(build(dir, { BUILD_ID: bad }), /build id/);
  }
});

test('inside a git work tree the build id is the short hash of HEAD, unless BUILD_ID is set', async (t) => {
  if (spawnSync('git', ['--version'], { encoding: 'utf8' }).status !== 0) {
    t.skip('git is not installed');
    return;
  }
  // The smallest thing `git rev-parse --short HEAD` answers for, written by hand: no git command changes anything.
  const hash = '0123456789abcdef0123456789abcdef01234567';
  const dir = await project({
    '.git/HEAD': 'ref: refs/heads/main\n',
    '.git/refs/heads/main': `${hash}\n`,
    '.git/objects/info/exclude': '',
  });
  const hashed = build(dir);
  assertBuilds(hashed);
  const { build: id } = JSON.parse(await readFile(join(hashed.dist, 'config.json'), 'utf8'));
  assert.match(id, /^[0-9a-f]{7,40}$/);
  assert.ok(hash.startsWith(id), `${id} abbreviates the hash of HEAD`);
  assert.deepEqual(await readdir(join(hashed.dist, 'a')), [id]);
  assert.ok((await readFile(join(hashed.dist, 'index.html'), 'utf8')).includes(`src="./a/${id}/src/app.js"`));
  assert.equal(existsSync(join(hashed.dist, '.git')), false);

  const named = build(dir, { BUILD_ID: 'release-7' });
  assertBuilds(named);
  assert.deepEqual(await readdir(join(named.dist, 'a')), ['release-7']);
});

test('config.json reflects COACH_API_BASE', async () => {
  const dir = await project();
  const config = async (run) => JSON.parse(await readFile(join(run.dist, 'config.json'), 'utf8'));

  const none = build(dir, { BUILD_ID: 'abc123' });
  assertBuilds(none);
  assert.deepEqual(await config(none), { apiBase: null, build: 'abc123', coach: { mode: 'off', reason: 'no_proxy' } });

  const empty = build(dir, { BUILD_ID: 'abc123', COACH_API_BASE: '' });
  assertBuilds(empty);
  assert.deepEqual(await config(empty), { apiBase: null, build: 'abc123', coach: { mode: 'off', reason: 'no_proxy' } });

  const set = build(dir, { BUILD_ID: 'abc123', COACH_API_BASE: 'https://coach.example.org/api' });
  assertBuilds(set);
  assert.deepEqual(await config(set), { apiBase: 'https://coach.example.org/api', build: 'abc123', coach: { mode: 'live', reason: null } });

  for (const bad of ['http://coach.example.org/api', 'http://192.168.1.50:5173/api', '/api', 'coach.example.org/api', 'ftp://coach.example.org', 'javascript:alert(1)']) {
    assertFails(build(dir, { BUILD_ID: 'abc123', COACH_API_BASE: bad }), /COACH_API_BASE must be empty or an https URL/);
  }
});

test('a planted bare import fails', async () => {
  const one = await project({ 'src/game/ports.js': `import OpenAI from 'openai';\n${BASE['src/game/ports.js']}` });
  assertFails(build(one), /src\/game\/ports\.js:1: "openai" is a bare specifier/);

  // every syntax the crawl follows
  const all = await project({
    'src/app.js': lines(BASE['src/app.js'], "import 'side-effect-package';", "export * from 'exported-package';",
      "export { a as b } from '@scope/named';", "export const lazy = () => import('lazy-package');",
      "export const asset = new URL('core/search-worker.js', import.meta.url);"),
  });
  assertFails(build(all), /"side-effect-package" is a bare specifier/, /"exported-package" is a bare specifier/,
    /"@scope\/named" is a bare specifier/, /"lazy-package" is a bare specifier/, /"core\/search-worker\.js" is a bare specifier/);
});

test('an import that leaves src/, a missing file and a computed specifier fail', async () => {
  const dir = await project({
    'src/game/ports.js': lines(
      BASE['src/game/ports.js'],
      "import '../../server/sign.js';",                    // 6: leaves src/
      "import '../../package.json';",                      // 7
      "import '/src/core/codes.js';",                      // 8: absolute
      "import 'https://cdn.example.org/lib.js';",          // 9: external
      "import '../core/missing.js';",                      // 10: missing
      "import '../core/Codes.js';",                        // 11: wrong case (a 404 on a case-sensitive server)
      "import '../core/codes';",                           // 12: no extension
      'export const lazy = (name) => import(`../core/${name}.js`);',                     // 13
      'export const worker = (name) => new URL(name, import.meta.url);',                // 14
      "export const fine = new URL('../core/search-worker.js', import.meta.url);",      // 15: allowed
      "export const page = new URL('./config.json', document.baseURI);",                // 16: not relative to the module
    ),
  });
  const run = build(dir);
  assertFails(run,
    /src\/game\/ports\.js:6: "\.\.\/\.\.\/server\/sign\.js" leaves src\//,
    /src\/game\/ports\.js:7: "\.\.\/\.\.\/package\.json" leaves src\//,
    /src\/game\/ports\.js:8: "\/src\/core\/codes\.js" leaves src\//,
    /src\/game\/ports\.js:9: "https:\/\/cdn\.example\.org\/lib\.js" leaves src\//,
    /src\/game\/ports\.js:10: "\.\.\/core\/missing\.js" is a missing file/,
    /src\/game\/ports\.js:11: "\.\.\/core\/Codes\.js" is a missing file/,
    /src\/game\/ports\.js:12: "\.\.\/core\/codes" is a missing file/,
    /src\/game\/ports\.js:13: import\(\) with a computed specifier cannot be checked/,
    /src\/game\/ports\.js:14: new URL\(…, import\.meta\.url\) with a computed path cannot be checked/,
  );
  assert.ok(!/ports\.js:1[56]:/.test(run.stderr), run.stderr);
  assert.equal(run.stderr.trim().split('\n').length, 10, `nine problems after the headline:\n${run.stderr}`);

  assertFails(build(await project({ 'src/core/search-worker.js': null })), /src\/core\/search-worker\.js: missing file/);
  assertFails(build(await project({ 'src/app.js': null })), /src\/app\.js: missing file/);
});

test('an import statement the crawl cannot read fails instead of being skipped', async () => {
  // a string as the imported name is legal JavaScript that the crawl does not parse: it must not hide a ui -> game import
  const dir = await project({
    'src/game/strings.js': `${BASE['src/game/strings.js']}const text = '';\nexport { text as "odd name" };\n`,
    'src/ui/hud.js': `${BASE['src/ui/hud.js']}import { "odd name" as odd } from '../game/strings.js';\nexport const o = odd;\n`,
  });
  assertFails(build(dir), /src\/ui\/hud\.js:3: this import statement could not be read/);
});

test('new URL(…, import.meta.url) is read across line breaks and with a trailing comma; import.meta.resolve is followed too', async () => {
  // the way a formatter lays out a long call: the crawl still sees the worker
  const formatted = await project({
    'src/app.js': lines(BASE['src/app.js'].trimEnd(),
      'export const again = () => new Worker(new URL(',
      "  './core/search-worker.js',",
      '  import.meta.url,',
      "), { type: 'module' });"),
  });
  assertBuilds(build(formatted, { BUILD_ID: 'abc123' }));

  const dir = await project({
    'src/ui/hud.js': lines(BASE['src/ui/hud.js'].trimEnd(),                           // lines 1 and 2
      'export const a = new URL(',                                                    // 3
      "  '../game/strings.js',",
      '  import.meta.url,',
      ');',
      "export const b = new URL('../game/policy.js', import.meta.url + '');",        // 7: the base is not import.meta.url itself
      "export const c = new URL('../game/rival.js', String(import.meta.url));",      // 8
      "export const d = import.meta.resolve('../game/tasks.js');",                   // 9
      'export const e = (name) => import.meta.resolve(name);',                        // 10
      "export const f = new URL('../game/store.js', document.baseURI);",             // 11: not relative to the module
      'export const g = new URL(import.meta.url).searchParams;',                      // 12: the module's own address
    ),
  });
  const run = build(dir);
  assertFails(run,
    /src\/ui\/hud\.js:3: "\.\.\/game\/strings\.js" breaks the import rule/,
    /src\/ui\/hud\.js:7: new URL\(…\) with a base that is built from import\.meta, not import\.meta\.url itself, cannot be checked/,
    /src\/ui\/hud\.js:8: new URL\(…\) with a base that is built from import\.meta/,
    /src\/ui\/hud\.js:9: "\.\.\/game\/tasks\.js" breaks the import rule/,
    /src\/ui\/hud\.js:10: import\.meta\.resolve\(\) with a computed specifier cannot be checked/);
  assert.equal(run.stderr.trim().split('\n').length, 6, `five problems after the headline:\n${run.stderr}`);
});

test('a division after a member name that is a keyword does not hide the import behind it', async () => {
  // `o.in / 2` and `o.return / 3` divide; a lexer that starts a regular expression there runs into the quote or the
  // backtick that follows and swallows the import
  const dir = await project({
    'src/ui/hud.js': lines(BASE['src/ui/hud.js'].trimEnd(),                           // lines 1 and 2
      'const o = { in: 4, return: 6 };',
      "export const h = o.in / 2 + '/'; import '../game/strings.js';",               // 4
      'export const r = o.return / 3 + `/`;',
      "import '../game/policy.js';",                                                  // 6
      'export const spread = [...new Set([o.in / 2])];',
    ),
  });
  const run = build(dir);
  assertFails(run,
    /src\/ui\/hud\.js:4: "\.\.\/game\/strings\.js" breaks the import rule/,
    /src\/ui\/hud\.js:6: "\.\.\/game\/policy\.js" breaks the import rule/);
  assert.equal(run.stderr.trim().split('\n').length, 3, run.stderr);
});

test('the server/* row of the import rule is enforced: server/*, the three shared coach modules, codes.js, and openai in provider.js only', async () => {
  const allowed = {
    'server/coach-handler.js': lines(
      "/** @import { CoachRequest } from '../src/coach/types.js' */",
      "/** @param {import('../src/coach/brief.js').TurnReport} report */",
      "import { createHash } from 'node:crypto';",
      "import { isIPv4 } from 'net';",
      "import { loadConfig } from './config.js';",
      "import '../src/coach/protocol.js';",
      "import '../src/coach/lexicon.js';",
      "import '../src/coach/fallback.js';",
      "import '../src/core/codes.js';",
      "export const handleRequest = async () => [createHash, isIPv4, loadConfig, await import('./provider.js')];",
    ),
    'server/config.js': 'export const loadConfig = () => ({});\n',
    'server/provider.js': lines("export const load = () => import('openai');"),
  };
  const good = build(await project(allowed), { BUILD_ID: 'abc123' });
  assertBuilds(good);
  assert.equal(existsSync(join(good.dist, 'server')), false, 'server/ is read, never copied');

  const dir = await project({
    ...allowed,
    'server/coach-handler.js': lines(allowed['server/coach-handler.js'].trimEnd(),    // lines 1 to 10
      "import OpenAI from 'openai';",                                                 // 11: provider.js only
      "import '../src/coach/brief.js';",                                              // 12
      "import '../src/coach/markup.js';",                                             // 13
      "import '../src/core/engine.js';",                                              // 14
      "import '../scripts/serve.js';",                                                // 15
      "import '../package.json';",                                                    // 16
      "import 'express';",                                                            // 17
      'export const lazy = (name) => import(name);',                                  // 18
    ),
    'server/provider.js': lines(allowed['server/provider.js'].trimEnd(), "import '../src/coach/client.js';"),      // 2
  });
  const run = build(dir);
  assertFails(run, /server\/coach-handler\.js:18: import\(\) with a computed specifier cannot be checked/);
  const broken = run.stderr.trim().split('\n').slice(1)
    .map((line) => /^(server\/[^:]+:\d+): "([^"]+)" breaks the import rule: server\/\* may import /.exec(line))
    .filter(Boolean).map((m) => `${m[1]} ${m[2]}`);
  assert.deepEqual(broken, [
    'server/coach-handler.js:11 openai', 'server/coach-handler.js:12 ../src/coach/brief.js', 'server/coach-handler.js:13 ../src/coach/markup.js',
    'server/coach-handler.js:14 ../src/core/engine.js', 'server/coach-handler.js:15 ../scripts/serve.js', 'server/coach-handler.js:16 ../package.json',
    'server/coach-handler.js:17 express', 'server/provider.js:2 ../src/coach/client.js',
  ]);
  assert.equal(run.stderr.trim().split('\n').length, 10, `nine problems after the headline:\n${run.stderr}`);
});

test('a planted ui -> game import fails', async () => {
  const dir = await project({ 'src/ui/hud.js': `${BASE['src/ui/hud.js']}import { STR } from '../game/strings.js';\nexport const s = STR;\n` });
  assertFails(build(dir), /src\/ui\/hud\.js:3: "\.\.\/game\/strings\.js" breaks the import rule: src\/ui\/\* may import/);
});

test('every row of the import rule of section 2 is enforced', async () => {
  const add = (name, ...imports) => [name, `${BASE[name]}${imports.map((spec) => `import '${spec}';\n`).join('')}`];
  /** file -> the imports planted in it, none of which its row allows */
  const planted = {
    'src/core/engine.js': ['./position.js', './search.js'],
    'src/core/notation.js': ['./search.js'],
    'src/core/codes.js': ['./position.js'],
    'src/core/facts.js': ['../coach/lexicon.js', '../ui/geometry.js'],
    'src/core/search-worker.js': ['../game/tasks.js'],
    'src/core/types.js': ['./codes.js'],
    'src/coach/protocol.js': ['../core/engine.js', './markup.js'],
    'src/coach/lexicon.js': ['../core/notation.js', './book.js'],
    'src/coach/fallback.js': ['./memory.js', '../core/engine.js'],
    'src/coach/brief.js': ['../core/facts.js', '../core/position.js'],
    'src/coach/client.js': ['../game/tasks.js', '../ui/stream-text.js'],
    'src/coach/types.js': ['../core/codes.js'],
    'src/ui/stage.js': ['../coach/markup.js', '../core/notation.js', '../game/director.js', '../app.js'],
    'src/ui/types.js': ['./geometry.js'],
    'src/game/session.js': ['./tasks.js', '../core/facts.js'],
    'src/game/tasks.js': ['../core/engine.js', './session.js'],
    'src/game/store.js': ['../core/teacher.js'],
    'src/game/policy.js': ['./strings.js'],
    'src/game/rival.js': ['../core/engine.js'],
    'src/game/strings.js': ['./policy.js'],
    'src/game/record.js': ['../core/notation.js', './store.js'],
    'src/game/director.js': ['../core/engine.js', '../coach/brief.js', '../ui/stage.js', '../core/brain.js'],
    'src/game/types.js': ['../core/codes.js'],
    'src/config.js': ['./core/codes.js'],
  };
  const changes = Object.fromEntries(Object.entries(planted).map(([name, imports]) => add(name, ...imports)));
  changes['src/ui/stream-text.js'] = 'export const createStreamText = () => null;\n';
  changes['src/game/extra.js'] = "import '../core/codes.js';\n";                 // a file the rule does not name
  const run = build(await project(changes));
  assertFails(run);
  const reported = run.stderr.trim().split('\n').slice(1);
  const expected = [];
  for (const [name, imports] of Object.entries(planted)) for (const spec of imports) expected.push(`${name}|${spec}`);
  expected.push('src/game/extra.js|../core/codes.js');
  const seen = reported.map((line) => /^(src\/[^:]+):\d+: "([^"]+)" breaks the import rule: /.exec(line)).filter(Boolean).map((m) => `${m[1]}|${m[2]}`);
  assert.deepEqual(seen.sort(), expected.sort());
  // nothing else is reported, except what the planted engine -> position import gives notation.js on the way
  const others = reported.filter((line) => !line.includes('breaks the import rule'));
  assert.deepEqual(others, ['src/core/notation.js: reaches src/core/position.js through src/core/engine.js; engine.js, notation.js and codes.js never import position.js or search.js'], run.stderr);
});

test('engine.js, notation.js and codes.js never reach position.js or search.js, not through another module either', async () => {
  const dir = await project({ 'src/core/engine.js': `${BASE['src/core/engine.js']}import './teacher.js';\n` });
  // engine -> teacher is "src/core/* may import src/core/*", but teacher imports search, which imports position
  assertFails(build(dir),
    /src\/core\/engine\.js: reaches src\/core\/search\.js through src\/core\/teacher\.js/,
    /src\/core\/engine\.js: reaches src\/core\/position\.js through src\/core\/teacher\.js -> src\/core\/search\.js/,
    /src\/core\/notation\.js: reaches src\/core\/search\.js through src\/core\/engine\.js -> src\/core\/teacher\.js/);
});

test('a planted forbidden API name fails', async () => {
  const one = await project({ 'src/coach/client.js': `${BASE['src/coach/client.js']}export const deadline = () => AbortSignal.timeout(2000);\n` });
  assertFails(build(one), /src\/coach\/client\.js:5: AbortSignal\.timeout is forbidden in src\//);

  // every name of section 4.28, each in a file of its own
  const uses = {
    'src/coach/client.js': ['AbortSignal.any', 'export const both = (a, b) => AbortSignal.any([a, b]);'],
    'src/config.js': ['AbortSignal.timeout', 'export const t = AbortSignal . timeout(1500);'],
    'src/game/store.js': ['crypto.randomUUID', 'export const id = () => crypto.randomUUID();'],
    'src/game/record.js': ['crypto.subtle', 'export const digest = (d) => globalThis.crypto?.subtle.digest("SHA-256", d);'],
    'src/ui/hud.js': ['navigator.clipboard', 'export const copy = (text) => navigator.clipboard.writeText(text);'],
    'src/app.js': ['serviceWorker', "export const sw = 'serviceWorker' in navigator;"],
    'src/ui/layout.js': ['SpeechRecognition', 'export const Recognition = window.webkitSpeechRecognition;'],
    'src/coach/markup.js': ['for await', 'export async function drain(stream) { for await (const chunk of stream) void chunk; }'],
    'src/ui/stage.js': ['backdrop-filter', "export const blur = (el) => el.style.setProperty('backdrop-filter', 'blur(4px)');"],
    'src/ui/board-view.js': ['backdrop-filter', "export const blur = (el) => { el.style.backdropFilter = 'blur(4px)'; };"],
  };
  const changes = Object.fromEntries(Object.entries(uses).map(([name, [, code]]) => [name, `${BASE[name]}${code}\n`]));
  const run = build(await project(changes));
  assertFails(run);
  for (const [name, [api]] of Object.entries(uses)) {
    const line = BASE[name].split('\n').length;
    assert.ok(run.stderr.includes(`${name}:${line}: ${api} is forbidden in src/`), `${name}: ${api}\n${run.stderr}`);
  }
  assert.equal(run.stderr.trim().split('\n').length, 1 + Object.keys(uses).length, run.stderr);

  // a name in a comment is not a use
  const mentioned = await project({
    'src/config.js': `// no AbortSignal.timeout here: a manual timer aborts the request (D-01)\n/* crypto.randomUUID, navigator.clipboard, serviceWorker, SpeechRecognition, for await and backdrop-filter are forbidden too */\n${BASE['src/config.js']}`,
  });
  assertBuilds(build(mentioned, { BUILD_ID: 'abc123' }));
});

test('a planted secret value fails', async () => {
  const secret = 'tok_3f9a1c77e2b04d58';
  const dir = await project({ 'src/game/strings.js': `${BASE['src/game/strings.js']}export const leaked = '${secret}';\n` });
  for (const name of ['PLANTED_TOKEN', 'GATEWAY_API_KEY', 'SIGNING_SECRET', 'COACH_SIGNING_KEY']) {
    const run = build(dir, { BUILD_ID: 'abc123', [name]: secret });
    assertFails(run, new RegExp(`dist/a/abc123/src/game/strings\\.js contains the value of the environment variable ${name}`));
    assert.ok(!(run.stdout + run.stderr).includes(secret), 'the value itself is never printed');
  }
  // not a secret by the rule: another name, or a value shorter than 8 characters
  assertBuilds(build(dir, { BUILD_ID: 'abc123', PLANTED_TOKEN_NAME: secret, KEYBOARD: secret, MY_KEY_FILE: secret }));
  const short = await project({ 'src/game/strings.js': `${BASE['src/game/strings.js']}export const word = 'abc1234';\n` });
  assertBuilds(build(short, { BUILD_ID: 'abc123', PLANTED_TOKEN: 'abc1234' }));
  const eight = await project({ 'src/game/strings.js': `${BASE['src/game/strings.js']}export const word = 'abc12345';\n` });
  assertFails(build(eight, { BUILD_ID: 'abc123', PLANTED_TOKEN: 'abc12345' }), /the value of the environment variable PLANTED_TOKEN/);
  // a secret in a stylesheet or in the page is found as well
  const css = await project({ 'styles/tokens.css': `${BASE['styles/tokens.css']}/* ${secret} */\n` });
  assertFails(build(css, { BUILD_ID: 'abc123', PLANTED_TOKEN: secret }), /dist\/a\/abc123\/styles\/tokens\.css contains the value/);
  const page = await project({ 'index.html': BASE['index.html'].replace('</body>', `<!-- ${secret} --></body>`) });
  assertFails(build(page, { BUILD_ID: 'abc123', PLANTED_TOKEN: secret }), /dist\/index\.html contains the value/);
});

test('the secret scan also refuses the name COACH_API_KEY and anything that looks like an sk- key', async () => {
  // BASE passes although src/ui/texts.js carries the sentence the contract itself puts in the settings sheet
  // (section 4.28.8: 服务器没有配置密钥（COACH_API_KEY）) and tokens.css uses mask-image ("sk-" inside a word).
  assert.ok(BASE['src/ui/texts.js'].includes('服务器没有配置密钥（COACH_API_KEY）'));
  assert.ok(BASE['styles/tokens.css'].includes('mask-image'));

  const named = await project({ 'src/config.js': `${BASE['src/config.js']}export const hint = 'set COACH_API_KEY in .env.local';\n` });
  assertFails(build(named, { BUILD_ID: 'abc123' }), /dist\/a\/abc123\/src\/config\.js contains COACH_API_KEY/);
  const assigned = await project({ 'styles/themes.css': `${BASE['styles/themes.css']}/* COACH_API_KEY=whatever */\n` });
  assertFails(build(assigned, { BUILD_ID: 'abc123' }), /dist\/a\/abc123\/styles\/themes\.css contains COACH_API_KEY/);

  for (const text of ["export const k = 'sk-proj-0123456789abcdef';", 'export const k = "Bearer sk-0123456789abcdef";', '// key: sk-live']) {
    const keyed = await project({ 'src/game/rival.js': `${BASE['src/game/rival.js']}${text}\n` });
    assertFails(build(keyed, { BUILD_ID: 'abc123' }), /dist\/a\/abc123\/src\/game\/rival\.js contains what looks like a secret key/);
  }
});

test('a missing stylesheet referenced by index.html fails', async () => {
  const dir = await project({ 'index.html': BASE['index.html'].replace('<link rel="stylesheet" href="./styles/themes.css">',
    '<link rel="stylesheet" href="./styles/themes.css">\n<link rel="stylesheet" href="./styles/board.css">') });
  assertFails(build(dir, { BUILD_ID: 'abc123' }), /dist\/index\.html: href "\.\/a\/abc123\/styles\/board\.css" is missing in dist\//);

  // the same for anything else the page or the manifest loads
  const wrongCase = await project({ 'index.html': BASE['index.html'].replace('./styles/tokens.css', './styles/Tokens.css') });
  assertFails(build(wrongCase, { BUILD_ID: 'abc123' }), /href "\.\/a\/abc123\/styles\/Tokens\.css" is missing/);
  const script = await project({ 'index.html': BASE['index.html'].replace('</head>', '<script type="module" src="./src/extra.js"></script>\n</head>') });
  assertFails(build(script, { BUILD_ID: 'abc123' }), /src "\.\/a\/abc123\/src\/extra\.js" is missing/);
  const icon = await project({ 'manifest.webmanifest': BASE['manifest.webmanifest'].replace('icon-512.png', 'icon-1024.png') });
  assertFails(build(icon, { BUILD_ID: 'abc123' }), /manifest\.webmanifest: icon "\.\/icons\/icon-1024\.png" is missing/);
  const external = await project({ 'index.html': BASE['index.html'].replace('</head>', '<link rel="stylesheet" href="https://fonts.example.org/font.css">\n</head>') });
  assertFails(build(external, { BUILD_ID: 'abc123' }), /href "https:\/\/fonts\.example\.org\/font\.css" is an external URL/);
});

test('index.html must reference ./src/ and ./styles/ at least twice in all, and the page, the manifest and styles/ must exist', async () => {
  const noStyles = await project({ 'index.html': BASE['index.html'].replace(/<link rel="stylesheet"[^>]*>\n/g, '') });
  assertFails(build(noStyles), /index\.html: expected at least 2 references/);
  assertFails(build(await project({ 'manifest.webmanifest': null })), /manifest\.webmanifest is missing/);
  assertFails(build(await project({ 'styles/tokens.css': null, 'styles/themes.css': null })), /styles is missing/);
  assertFails(build(await project({ 'index.html': null })), /index\.html is missing/);
});

test('dist contains no server/, scripts/, tests/, dev/, legacy/ or .env file', async () => {
  const dir = await project();
  const run = build(dir, { BUILD_ID: 'abc123' });
  assertBuilds(run);
  const { files, dirs } = await tree(run.dist);
  for (const name of [...dirs, ...files]) {
    for (const segment of name.split('/')) {
      assert.ok(!['server', 'scripts', 'tests', 'dev', 'legacy', 'node_modules'].includes(segment), name);
      assert.ok(!segment.startsWith('.env'), name);
    }
  }
  assert.deepEqual(dirs.filter((name) => !name.includes('/')), ['a', 'icons']);
  for (const name of files) {
    assert.ok(!(await readFile(join(run.dist, ...name.split('/')), 'latin1')).includes(MARK), `${name} carries nothing of the files next to src/`);
  }

  // and when one of them sits inside src/ or styles/, the build fails instead of publishing it
  const cases = {
    'src/.env.local': /dist\/a\/abc123\/src\/\.env\.local is an environment file/,
    'styles/.env': /dist\/a\/abc123\/styles\/\.env is an environment file/,
    'src/tests/a.test.js': /dist\/a\/abc123\/src\/tests\/ must never be published/,
    'src/ui/dev/board.html': /dist\/a\/abc123\/src\/ui\/dev\/ must never be published/,
    'src/legacy/old.js': /dist\/a\/abc123\/src\/legacy\/ must never be published/,
    'src/server/x.js': /dist\/a\/abc123\/src\/server\/ must never be published/,
    'styles/scripts/x.css': /dist\/a\/abc123\/styles\/scripts\/ must never be published/,
  };
  const planted = Object.fromEntries(Object.keys(cases).map((name) => [name, 'x\n']));
  const all = build(await project(planted), { BUILD_ID: 'abc123' });
  assertFails(all, ...Object.values(cases));
  assert.equal(all.stderr.trim().split('\n').length, 2 + Object.keys(cases).length, all.stderr);
  // one of them alone is enough
  assertFails(build(await project({ 'src/.env.local': 'x\n' }), { BUILD_ID: 'abc123' }), cases['src/.env.local']);
  assertFails(build(await project({ 'src/tests/a.test.js': 'x\n' }), { BUILD_ID: 'abc123' }), cases['src/tests/a.test.js']);
});
