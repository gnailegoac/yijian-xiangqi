import { mkdir, cp, readdir, stat } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
for (const name of ['index.html', 'styles.css', 'favicon.svg', 'src']) await cp(name, `dist/${name}`, { recursive: true });
async function size(dir) { let bytes = 0; for (const name of await readdir(dir)) { const path = `${dir}/${name}`; const info = await stat(path); bytes += info.isDirectory() ? await size(path) : info.size; } return bytes; }
console.log(`静态站点已生成到 dist/（${(await size('dist') / 1024).toFixed(1)} KB），无外部运行依赖。`);
