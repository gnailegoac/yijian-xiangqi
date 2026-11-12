// Mutation check of tests/unit/game/config.test.js: each mutant of src/config.js runs in its own guarded process on a
// scratch copy (the repo is not touched). A mutant "survives" when the test file still passes.
import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const REPO = 'C:/Users/USERNAME/git/yijian-xiangqi';
const DIR = 'C:/Users/USERNA~1/AppData/Local/Temp/claude/5884157893c5b410/a051714c-de36-47da-b3cc-cfc754f60ac3/scratchpad/work/A1/review/mut';
mkdirSync(`${DIR}/src`, { recursive: true });
mkdirSync(`${DIR}/tests/unit/game`, { recursive: true });
copyFileSync(`${REPO}/tests/unit/game/config.test.js`, `${DIR}/tests/unit/game/config.test.js`);
const source = readFileSync(`${REPO}/src/config.js`, 'utf8');

const mutants = [
  ['status >= 400 instead of !== 200', "response.status !== 200", "response.status >= 400"],
  ['no cache: no-store', "{ cache: 'no-store', signal: controller.signal }", "{ signal: controller.signal }"],
  ['timeout 1400', 'const TIMEOUT_MS = 1500;', 'const TIMEOUT_MS = 1400;'],
  ['timeout 1600', 'const TIMEOUT_MS = 1500;', 'const TIMEOUT_MS = 1600;'],
  ['no abort on timeout', 'controller.abort();\n', '\n'],
  ['timer not cleared', 'clearTimeout(timer);', ''],
  ['opaque origin counts as same', "url.origin !== 'null' && url.origin === base.origin", 'url.origin === base.origin'],
  ['localhost over any protocol', "url.protocol === 'http:' && (url.hostname", '(url.hostname'],
  ['any http allowed', "allowed = sameOrigin || url.protocol === 'https:' || thisMachine;", "allowed = sameOrigin || url.protocol === 'https:' || url.protocol === 'http:' || thisMachine;"],
  ['https not allowed', "allowed = sameOrigin || url.protocol === 'https:' || thisMachine;", 'allowed = sameOrigin || thisMachine;'],
  ['127.0.0.1 not allowed', "(url.hostname === 'localhost' || url.hostname === '127.0.0.1')", "(url.hostname === 'localhost')"],
  ['hostname by prefix', "url.hostname === 'localhost' ||", "url.hostname.startsWith('localhost') ||"],
  ['no trim', 'const text = raw.trim();', 'const text = raw;'],
  ['no strip of the trailing slash', "return text.replace(/\\/+$/, '');", 'return text;'],
  ['returns the resolved URL', "return text.replace(/\\/+$/, '');", "return new URL(text, baseURI).href.replace(/\\/+$/, '');"],
  ['no warn on refusal', "console.warn(`[config] apiBase ${JSON.stringify(text)} is not allowed (same origin, https, or http on localhost / 127.0.0.1 only)`);", ''],
  ['coach=off by first value only', "new URLSearchParams(search).getAll('coach').includes('off')", "new URLSearchParams(search).get('coach') === 'off'"],
  ['coach=off ignored', "if (new URLSearchParams(search).getAll('coach').includes('off')) return off('setting');", ''],
  ['coach=off reason no_proxy', "return off('setting');", "return off('no_proxy');"],
  ['coach=off after the fetch', "includes('off')) return off('setting');", "includes('off')) { await (env?.fetch ?? globalThis.fetch)?.('x').catch(() => {}); return off('setting'); }"],
  ['mode always live', "told.mode === 'mock' ? 'mock' : 'live'", "'live'"],
  ['mode copied from the file', "told.mode === 'mock' ? 'mock' : 'live'", 'told.mode'],
  ['reason always no_proxy', "off(offReason(told.reason) ?? 'no_proxy', build)", "off('no_proxy', build)"],
  ['reason copied unchecked', "off(offReason(told.reason) ?? 'no_proxy', build)", "off(told.reason ?? 'no_proxy', build)"],
  ['build not carried', "const build = typeof file.build === 'string' && file.build !== '' ? file.build : NO_BUILD;", 'const build = NO_BUILD;'],
  ['build copied unchecked', "const build = typeof file.build === 'string' && file.build !== '' ? file.build : NO_BUILD;", 'const build = file.build;'],
  ['arrays accepted as the file', "typeof v === 'object' && v !== null && !Array.isArray(v)", "typeof v === 'object' && v !== null"],
  ['env.location ignored', 'const where = env?.location ?? globalThis.location;', 'const where = globalThis.location;'],
  ['global location ignored', 'const where = env?.location ?? globalThis.location;', 'const where = env?.location;'],
  ['env.fetch ignored', 'const fetchFn = env?.fetch ?? globalThis.fetch;', 'const fetchFn = globalThis.fetch;'],
  ['env.baseURI ignored', 'const baseURI = env?.baseURI ?? globalThis.document?.baseURI;', 'const baseURI = globalThis.document?.baseURI;'],
  ['document.baseURI ignored', 'const baseURI = env?.baseURI ?? globalThis.document?.baseURI;', 'const baseURI = env?.baseURI;'],
  ['config.json from the site root', "new URL('./config.json', baseURI)", "new URL('/config.json', baseURI)"],
  ['rejects instead of returning', "return off('no_proxy');\n  }\n}", "throw error;\n  }\n}"],
  ['fetch errors not caught', '})().catch(() => null);', '})();'],
  ['race without the timer', 'return await Promise.race([read, timeUp]);', 'return await read;'],
];

const guard = '--import file:///C:/Users/USERNA~1/AppData/Local/Temp/claude/5884157893c5b410/a051714c-de36-47da-b3cc-cfc754f60ac3/scratchpad/tools/memguard.mjs';
let survived = 0, bad = 0;
for (const [name, from, to] of mutants) {
  if (!source.includes(from)) { console.log(`NOT APPLIED  ${name}`); bad += 1; continue; }
  writeFileSync(`${DIR}/src/config.js`, source.replace(from, to));
  const r = spawnSync(process.execPath, ['--test', '--test-timeout=20000', 'tests/unit/game/config.test.js'], {
    cwd: DIR, encoding: 'utf8', timeout: 60000, env: { ...process.env, NODE_OPTIONS: guard, MEM_LIMIT_MB: '1000' },
  });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  if (/MEMGUARD/.test(out)) console.log(`MEMGUARD     ${name}`);
  const failed = [...out.matchAll(/^✖ (.+?) \(/gm)].map((m) => m[1]);
  if (r.status === 0) { survived += 1; console.log(`SURVIVED     ${name}`); }
  else console.log(`killed       ${name}  <- ${[...new Set(failed)].slice(0, 3).join(' | ') || (r.error ? String(r.error) : 'exit ' + r.status)}`);
}
// the unmutated copy must pass
writeFileSync(`${DIR}/src/config.js`, source);
const base = spawnSync(process.execPath, ['--test', 'tests/unit/game/config.test.js'], { cwd: DIR, encoding: 'utf8', timeout: 60000, env: { ...process.env, NODE_OPTIONS: guard, MEM_LIMIT_MB: '1000' } });
console.log(`\noriginal: exit ${base.status}; mutants ${mutants.length}, survived ${survived}, not applied ${bad}`);
