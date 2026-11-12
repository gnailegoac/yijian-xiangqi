import fs from 'node:fs';
const p = 'C:/Users/USERNAME/git/yijian-xiangqi/src/ui/buddy.js';
let s = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const rep = (a, b) => { if (!s.includes(a)) throw new Error('missing: ' + a.slice(0, 60)); s = s.replace(a, b); };

rep('const FIGURE = `\n<ellipse class="b-shadow"',
    'const FRINGE = \'M30.6 52 Q28.5 21 60 20 Q91.5 21 89.4 52 Q85 39.5 75 36.5 Q70.5 44.5 61 38 Q52.5 46.5 44.5 37.5 Q36 41 30.6 52 Z\';\nconst BROW_L = \'M42 40.5 L51 38.6\', BROW_R = \'M69 38.6 L78 40.5\';\n\n/** The drawing, back to front (§11.2). `uid` keeps the clip-path id unique when several figures share a page. @param {string} uid */\nconst figureMarkup = (uid) => `\n<defs><clipPath id="${uid}-fringe"><path d="${FRINGE}"/></clipPath></defs>\n<ellipse class="b-shadow"');
rep('      <path d="M30.6 52 Q28.5 21 60 20 Q91.5 21 89.4 52 Q85 39.5 75 36.5 Q70.5 44.5 61 38 Q52.5 46.5 44.5 37.5 Q36 41 30.6 52 Z" fill="${INK}"/>\n',
    '      <path class="b-brow-l" d="${BROW_L}" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/>\n      <path class="b-brow-r" d="${BROW_R}" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/>\n      <path d="${FRINGE}" fill="${INK}"/>\n      <g clip-path="url(#${uid}-fringe)">\n        <path class="b-brow-l" d="${BROW_L}" stroke="${BROW_ON_HAIR}" stroke-width="2.4" stroke-linecap="round"/>\n        <path class="b-brow-r" d="${BROW_R}" stroke="${BROW_ON_HAIR}" stroke-width="2.4" stroke-linecap="round"/>\n      </g>\n');
rep('      <path d="M52 8 Q60 0 68 8 Q60 12 52 8 Z" fill="${FOLD}" stroke="${INK}"/>\n',
    '      <path d="M53.5 10 Q46 15 42 30 M66.5 10 Q74 15 78 30 M60 11.5 V25" fill="none" stroke="${FOLD}" stroke-width="1.2" stroke-linecap="round"/>\n      <path d="M52 8 Q60 0 68 8 Q60 12 52 8 Z" fill="${FOLD}" stroke="${INK}"/>\n');
rep('      <path class="b-brow-l" d="M42 40.5 L51 38.6" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/>\n      <path class="b-brow-r" d="M69 38.6 L78 40.5" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/>\n      ${variants(\'b-eyes\', EYES)}',
    '      ${variants(\'b-eyes\', EYES)}');
rep('${fan([-104, -97, -90, -83, -76], 7, 40)}', '${fan([-104, -97, -90, -83, -76], 7, 40, 5)}');
rep('${fan([-150, -130, -110, -90, -70, -50, -30], 9, 42)}', '${fan([-150, -130, -110, -90, -70, -50, -30], 9, 42, 9)}');
rep('  svg.innerHTML = FIGURE;                                   // static template, numbers only',
    '  svg.innerHTML = figureMarkup(`buddy${++figures}`);        // static template, numbers only');
rep('const SVG_NS = \'http://www.w3.org/2000/svg\';\nconst VIEW_FULL', 'const SVG_NS = \'http://www.w3.org/2000/svg\';\nlet figures = 0;                                          // for unique ids inside each drawing\nconst VIEW_FULL');
fs.writeFileSync(p, s);
console.log('ok');
