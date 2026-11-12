// Converts the four files of package X5 to LF line endings without BOM, and reports what it found.
import fs from 'node:fs';

const root = 'C:/Users/USERNAME/git/yijian-xiangqi/';
for (const f of ['src/ui/buddy.js', 'src/ui/rival-view.js', 'styles/buddy.css', 'dev/buddy.html']) {
  const buf = fs.readFileSync(root + f);
  let text = buf.toString('utf8');
  const bom = text.charCodeAt(0) === 0xfeff;
  const cr = (text.match(/\r/g) ?? []).length;
  if (bom) text = text.slice(1);
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!text.endsWith('\n')) text += '\n';
  if (bom || cr) fs.writeFileSync(root + f, text);
  const after = fs.readFileSync(root + f);
  console.log(`${f}: had ${cr} CR${bom ? ' + BOM' : ''}; now ${after.includes(13) ? 'STILL HAS CR' : 'LF only'}, ${text.split('\n').length - 1} lines, trailing spaces on ${text.split('\n').filter((l) => /[ \t]+$/.test(l)).length} lines`);
}
