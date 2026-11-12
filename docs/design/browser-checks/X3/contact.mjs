// node contact.mjs <out.html> <columns> <img...>   builds a contact sheet page of local PNGs
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { basename, resolve } from 'node:path';
const [out, cols, ...imgs] = process.argv.slice(2);
const cells = imgs.map(f => `<figure><img src="${pathToFileURL(resolve(f)).href}"><figcaption>${basename(f, '.png')}</figcaption></figure>`).join('');
writeFileSync(out, `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#222;color:#ddd;font:12px sans-serif}
.g{display:grid;grid-template-columns:repeat(${cols},1fr);gap:4px;padding:4px}figure{margin:0}img{width:100%;display:block}figcaption{text-align:center;padding:2px}</style><div class="g">${cells}</div>`);
