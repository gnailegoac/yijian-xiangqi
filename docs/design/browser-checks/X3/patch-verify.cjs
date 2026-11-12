const fs = require('fs'); let s = fs.readFileSync('verify.mjs', 'utf8');
const rep = (a, b) => { if (!s.includes(a)) throw new Error('missing: ' + a.slice(0, 70)); s = s.replace(a, b); };
rep("const fs = Math.min(SIZE[kind] * Math.max(20, Math.min(48, c)), 0.92 * W / TEXT[kind].length);",
    "const specFs = SIZE[kind] * Math.max(20, Math.min(48, c));          // 2.0 c (40–96 px), other sizes in proportion\n    const fsOk = (near(b.fs, specFs, 0.1) && b.textW <= 0.92 * W + 1) || (b.fs < specFs && near(b.textW, 0.92 * W, 2));   // set smaller only when it would not fit\n    const fs = b.fs;");
rep("near(b.fs, fs, 0.1) && near(b.h, 1.6 * fs, 1.5)", "fsOk && near(b.h, 1.6 * fs, 1.5)");
rep("`G banner ${kind}: 「${TEXT[kind]}」 tone ${TONE[kind]}, font ${fs.toFixed(1)} px,", "`G banner ${kind}: 「${TEXT[kind]}」 tone ${TONE[kind]}, font ${specFs.toFixed(1)} px (or fitted),");
rep("near(st.full.border, 0.08, 0.012) && near(st.full.outline, 0.03, 0.012) && near(st.full.offset, 0.06, 0.012) &&",
    "near(st.full.border, 0.08, snap) && near(st.full.outline, 0.03, snap) && near(st.full.offset, 0.06, snap) &&");
rep("  check('I stamp full: seal red", "  const snap = Math.max(0.012, 1 / (1.5 * c));             // borders snap to whole pixels\n  check('I stamp full: seal red");
fs.writeFileSync('verify.mjs', s);
