// Builds a contact sheet (HTML) from PNG files and screenshots it.  node sheet.mjs <out.png> <width-per-image> <cols> <files...>
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { basename, resolve } from 'node:path';
const [out, w, cols, ...files] = process.argv.slice(2);
const html = `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#444;font:12px/1.2 sans-serif;color:#fff}
.g{display:grid;grid-template-columns:repeat(${cols},${w}px);gap:6px;padding:6px}figure{margin:0}img{display:block;width:${w}px}figcaption{padding:2px 0}</style>
<div class="g">${files.map(f => `<figure><img src="${pathToFileURL(resolve(f)).href}"><figcaption>${basename(f)}</figcaption></figure>`).join('')}</div>`;
const page = resolve(out.replace(/\.png$/, '.html'));
writeFileSync(page, html);
const tool = resolve('../../tools/shot.mjs');
const width = Number(cols) * (Number(w) + 6) + 6;
try { execFileSync(process.execPath, [tool, '--url', pathToFileURL(page).href, '--out', resolve(out), '--w', String(width), '--h', '400', '--full', '--wait', '300'], { stdio: 'pipe' }); }
catch (e) { console.log(String(e.stdout)); }
console.log('sheet', out);
