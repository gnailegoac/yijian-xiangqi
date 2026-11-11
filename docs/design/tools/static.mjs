// Throwaway static file server for checking dev pages during the build.
// Usage: node static.mjs --root <dir> --port <n>
// Binds to 127.0.0.1 only and never serves dot-files or dot-directories.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';

const arg = name => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const root = resolve(arg('root') ?? '.');
const port = Number(arg('port') ?? 5200);
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};

createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    let file = resolve(root, `.${path}`);
    const inside = file === root || file.startsWith(root + sep);
    const hidden = file.slice(root.length).split(sep).some(part => part.startsWith('.'));
    if (!inside || hidden) { res.writeHead(404); res.end('Not found'); return; }
    if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html');
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
}).listen(port, '127.0.0.1', () => console.log(`static: http://127.0.0.1:${port}/ root=${root}`));
