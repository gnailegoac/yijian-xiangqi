import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import { computeLayout, applyLayout } from '../../../src/ui/layout.js';

const read = (/** @type {string} */ path) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');

/** @param {number} W @param {number} H @param {{visibleH?:number, sheet?:boolean}} [o] */
const at = (W, H, o = {}) => computeLayout({ W, H, visibleH: o.visibleH ?? H, sheet: o.sheet ?? false });

// ---------------------------------------------------------------------------------------------------------------------
// computeLayout
// ---------------------------------------------------------------------------------------------------------------------

/**
 * The table of SPEC §12.2, one array per row:
 * [W, H, visibleH, mode, c, piece diameter, board "w x h", coach width (0 = "—"), coach height, 诸葛亮 px, figure, chip rows (0 = hidden)]
 */
const TABLE = /** @type {const} */ ([
  [1180, 820, 820, 'landscape', 65.28, '57.4', '601 x 692', 480, 692, 291, 'full', 2],
  [1024, 768, 768, 'landscape', 60.37, '53.1', '555 x 640', 421, 640, 269, 'full', 2],
  [1366, 1024, 1024, 'landscape', 84.00, '73.9', '773 x 890', 480, 896, 300, 'full', 2],
  [1440, 900, 900, 'landscape', 72.83, '64.1', '670 x 772', 480, 772, 300, 'full', 2],
  [1920, 1080, 1080, 'landscape', 84.00, '73.9', '773 x 890', 480, 952, 300, 'full', 2],
  [1180, 820, 420, 'landscape', 27.54, '24.2', '253 x 292', 480, 292, 123, 'bust', 1],
  [820, 1180, 1180, 'portrait', 76.60, '67.4', '705 x 812', 0, 176, 120, 'bust', 1],
  [768, 1024, 1024, 'portrait', 61.88, '54.5', '569 x 656', 0, 176, 120, 'bust', 1],
  [820, 1180, 780, 'portrait', 46.41, '40.8', '427 x 492', 0, 96, 72, 'bust', 0],
  [360, 560, 560, 'compact', 35.09, '30.9', '323 x 372', 0, 88, 56, 'bust', 0],
  [360, 640, 640, 'compact', 38.26, '33.7', '352 x 406', 0, 130, 56, 'bust', 1],
  [360, 740, 740, 'compact', 38.26, '33.7', '352 x 406', 0, 230, 56, 'bust', 1],
  [390, 844, 844, 'compact', 41.52, '36.5', '382 x 440', 0, 300, 56, 'bust', 1],
  [844, 390, 390, 'landscape', 28.11, '24.7', '259 x 298', 480, 298, 125, 'bust', 1],
]);

/** Sum of the rows and gaps of a mode's grid (§12.1) from top to bottom; it must fill the usable height exactly. */
function usedHeight(/** @type {ReturnType<typeof computeLayout>} */ r) {
  if (r.layout === 'landscape') return r.top + r.pad + r.coachH + r.pad + r.bar;
  if (r.layout === 'portrait') return r.top + r.boardH + r.bar + r.coachH + r.actions + 20;      // four row gaps of 5 px
  return r.top + r.boardH + r.bar + r.coachH + 12;                                                   // three row gaps of 4 px
}

test('every row of the 12.2 table', () => {
  for (const [W, H, visibleH, mode, c, piece, board, coachW, coachH, buddyH, figure, chipRows] of TABLE) {
    const name = `${W} x ${H}${visibleH === H ? '' : ` (visible ${visibleH})`}`;
    const r = at(W, H, { visibleH });
    assert.equal(r.layout, mode, `${name}: mode`);
    assert.equal(r.c, c, `${name}: c`);
    assert.equal((0.88 * r.c).toFixed(1), piece, `${name}: piece diameter`);
    assert.equal(`${Math.round(r.boardW)} x ${Math.round(r.boardH)}`, board, `${name}: board`);
    assert.equal(r.panelW, coachW, `${name}: coach width`);
    assert.equal(Math.round(r.coachH), coachH, `${name}: coach height`);
    assert.equal(r.buddyH, buddyH, `${name}: 诸葛亮 height`);
    assert.equal(r.buddy, figure, `${name}: full figure or bust`);
    assert.equal(r.showChips ? r.chipRows : 0, chipRows, `${name}: chip rows`);
    assert.equal(r.kb, visibleH !== H, `${name}: keyboard flag`);

    // What the row implies beyond its printed cells.
    assert.ok(Math.abs(r.boardW - 9.2 * r.c) < 1e-9 && Math.abs(r.boardH - 10.6 * r.c) < 1e-9, `${name}: the frame is 9.2 c x 10.6 c`);
    assert.ok(Math.abs(usedHeight(r) - visibleH) < 1e-6, `${name}: rows and gaps fill the visible height`);
    assert.equal(r.stageScale, 1, `${name}: no miniature without the sheet`);
    if (mode === 'landscape') {
      assert.ok(r.boardW + r.panelW + 3 * r.gap <= W + 0.5, `${name}: board, coach column and three gaps fit the width`);
      assert.ok(r.boardH <= r.coachH + 1e-9, `${name}: the board is not higher than its cell`);
      assert.equal(r.actions, r.bar, `${name}: actions share the bottom row`);
    } else {
      assert.ok(r.boardW + 2 * r.pad <= W + 1e-9, `${name}: the board and its gutters fit the width`);
      assert.equal(r.panelW, 0);
    }
  }
  // The bars of §12.3: 48 px top bar (40 / 36 px compact, 36 px on a landscape phone), under-bar 64 / 60 / 52 px.
  assert.deepEqual([at(1180, 820).top, at(1180, 820).bar, at(1180, 820).actions], [48, 64, 64]);
  assert.deepEqual([at(820, 1180).top, at(820, 1180).bar, at(820, 1180).actions], [48, 60, 64]);
  assert.deepEqual([at(360, 740).top, at(360, 740).bar, at(360, 740).actions], [40, 52, 0]);
  assert.deepEqual([at(360, 560).top, at(360, 560).bar], [36, 52]);
  assert.deepEqual([at(844, 390).top, at(844, 390).bar, at(844, 390).pad, at(844, 390).gap], [36, 48, 4, 8]);
  assert.deepEqual([at(1180, 820).pad, at(1180, 820).gap], [8, 16]);
  // §10.1 "Readable first": the smallest supported board (360 px wide) still has cells of at least 34.4 px.
  for (let H = 560; H <= 900; H += 20) assert.ok(at(360, H).c >= 34.4, `360 x ${H}: c >= 34.4`);
});

test('keyboard up shrinks the board and keeps it on screen in all three modes', () => {
  /** [W, H, visible height with the keyboard up, expected mode] */
  const cases = /** @type {const} */ ([[1180, 820, 420, 'landscape'], [820, 1180, 780, 'portrait'], [360, 740, 440, 'compact'], [390, 844, 500, 'compact']]);
  for (const [W, H, visibleH, mode] of cases) {
    const open = at(W, H);
    const kb = at(W, H, { visibleH });
    const name = `${W} x ${H}, visible ${visibleH}`;
    assert.equal(open.kb, false, `${name}: no keyboard without a height difference`);
    assert.equal(kb.kb, true, `${name}: keyboard detected`);
    assert.equal(kb.layout, mode, `${name}: the mode does not change when the keyboard opens`);
    assert.equal(open.layout, mode);
    assert.ok(kb.c < open.c, `${name}: the board shrinks`);
    assert.ok(kb.c >= 20, `${name}: never below 20 px per cell`);
    // Everything above the keyboard: the grid still adds up to the visible height, so the board cannot be pushed out.
    assert.ok(Math.abs(usedHeight(kb) - visibleH) < 1e-6, `${name}: rows fill the visible height`);
    assert.ok(kb.top + kb.boardH <= visibleH, `${name}: the board ends above the keyboard`);
    assert.ok(kb.coachH >= 88, `${name}: room is left for the strategist and the input`);
  }
  // The keyboard counts as "up" only when more than 120 px of the layout viewport are covered.
  assert.equal(at(820, 1180, { visibleH: 1060 }).kb, false);
  assert.equal(at(820, 1180, { visibleH: 1059 }).kb, true);
  assert.equal(at(360, 740, { visibleH: 620 }).kb, false);
  assert.equal(at(360, 740, { visibleH: 619 }).kb, true);
  // Portrait gives the coach 96 px instead of 176 px while typing, and hides the chips (§12.4).
  const portrait = at(820, 1180, { visibleH: 780 });
  assert.equal(Math.round(portrait.coachH), 96);
  assert.equal(portrait.showChips, false);
  // Landscape collapses the chips to one row and the figure to a bust.
  const landscape = at(1180, 820, { visibleH: 420 });
  assert.deepEqual([landscape.chipRows, landscape.buddy, landscape.showChips], [1, 'bust', true]);
});

test('landscape needs W >= 900 and W / H >= 1.05', () => {
  assert.equal(at(900, 857).layout, 'landscape');          // 900 / 857 = 1.0502
  assert.equal(at(900, 858).layout, 'portrait');           // 900 / 858 = 1.0490: too square
  assert.equal(at(899, 800).layout, 'portrait');           // wide enough in proportion, but under 900 px
  assert.equal(at(1050, 1000).layout, 'landscape');        // exactly 1.05
  assert.equal(at(1049, 1000).layout, 'portrait');
  assert.equal(at(1024, 1366).layout, 'portrait');         // a large iPad held upright
  assert.equal(at(1366, 1024).layout, 'landscape');
  // Below 600 px of width the upright layout is the phone one.
  assert.equal(at(600, 900).layout, 'portrait');
  assert.equal(at(599, 900).layout, 'compact');
  // A landscape phone is the one exception: lower than 480 px and wider than high.
  assert.equal(at(844, 390).layout, 'landscape');
  assert.equal(at(560, 320).layout, 'landscape');
  assert.equal(at(700, 480).layout, 'portrait');           // 480 px high is not "lower than 480"
  assert.equal(at(400, 400).layout, 'compact');            // square is not "wider than high"
  // The proportion is taken from the layout viewport, not from what the keyboard leaves visible.
  assert.equal(at(1180, 820, { visibleH: 420 }).layout, 'landscape');
  assert.equal(at(820, 1180, { visibleH: 400 }).layout, 'portrait');
  assert.equal(at(360, 740, { visibleH: 300 }).layout, 'compact');
});

test('compact: the conversation sheet scales the stage to a miniature', () => {
  const closed = at(360, 740);
  const open = at(360, 740, { sheet: true });
  assert.equal(closed.stageScale, 1);
  assert.equal(open.miniH, 260);                                              // clamp(132, 0.36 * 740, 260)
  assert.ok(Math.abs(open.stageScale * open.boardH - open.miniH) < 1e-9, 'the scaled board is exactly miniH high');
  assert.ok(Math.abs(at(360, 640, { sheet: true }).miniH - 230.4) < 1e-9);    // 0.36 * 640
  assert.equal(at(360, 740, { visibleH: 340, sheet: true }).miniH, 132);      // 0.36 * 340 = 122.4 -> the floor of 132
  // Only the compact mode has a miniature: the sheet covers the coach side elsewhere.
  assert.deepEqual([at(1180, 820, { sheet: true }).stageScale, at(1180, 820, { sheet: true }).miniH], [1, 0]);
  assert.deepEqual([at(820, 1180, { sheet: true }).stageScale, at(820, 1180, { sheet: true }).miniH], [1, 0]);
});

// ---------------------------------------------------------------------------------------------------------------------
// applyLayout
// ---------------------------------------------------------------------------------------------------------------------

function fakeApp() {
  /** @type {Map<string, string>} */
  const props = new Map();
  const style = {
    top: '',
    setProperty: (/** @type {string} */ name, /** @type {string} */ value) => { props.set(name, String(value)); },
    removeProperty: (/** @type {string} */ name) => { props.delete(name); return ''; },
  };
  return { props, style, dataset: /** @type {Record<string, string>} */ ({}) };
}
/** @param {ReturnType<typeof fakeApp>} app */
const asElement = app => /** @type {HTMLElement} */ (/** @type {unknown} */ (app));
/** @param {number} height @param {number} offsetTop */
const viewport = (height, offsetTop) => /** @type {VisualViewport} */ (/** @type {unknown} */ ({ height, offsetTop }));

test('applyLayout writes the custom properties and data attributes on #app', () => {
  const app = fakeApp();
  applyLayout(asElement(app), at(1180, 820), viewport(820, 0));
  assert.deepEqual(Object.fromEntries(app.props), {
    '--c': '65.28px', '--board-w': '600.58px', '--board-h': '691.97px', '--top': '48px', '--bar': '64px', '--actions': '64px',
    '--panel-w': '480px', '--buddy-h': '291px', '--stage-scale': '1', '--mini-h': '0px',
  });
  assert.deepEqual(app.dataset, { layout: 'landscape', kb: '0' });
  assert.equal(app.style.top, '');

  const phone = fakeApp();
  applyLayout(asElement(phone), at(360, 740, { sheet: true }), null);
  assert.equal(phone.props.get('--c'), '38.26px');
  assert.equal(phone.props.get('--actions'), '0px');
  assert.equal(phone.props.get('--panel-w'), '0px');
  assert.equal(phone.props.get('--buddy-h'), '56px');
  assert.equal(phone.props.get('--mini-h'), '260px');
  assert.ok(Math.abs(Number(phone.props.get('--stage-scale')) - 260 / 405.556) < 1e-4, '--stage-scale is a plain number');
  assert.equal(phone.props.has('--app-h'), false, '--app-h is only set while the keyboard is up');
  assert.deepEqual(phone.dataset, { layout: 'compact', kb: '0' });

  const upright = fakeApp();
  applyLayout(asElement(upright), at(820, 1180), viewport(1180, 0));
  assert.deepEqual(upright.dataset, { layout: 'portrait', kb: '0' });
  assert.deepEqual([upright.props.get('--top'), upright.props.get('--bar'), upright.props.get('--actions')], ['48px', '60px', '64px']);
});

test('applyLayout follows the visual viewport while the keyboard is up', () => {
  const app = fakeApp();
  applyLayout(asElement(app), at(820, 1180, { visibleH: 780 }), viewport(780, 37.5));
  assert.equal(app.props.get('--app-h'), '780px');
  assert.equal(app.style.top, '37.5px', 'top follows visualViewport.offsetTop so a scrolled page cannot push the board away');
  assert.deepEqual(app.dataset, { layout: 'portrait', kb: '1' });
  assert.equal(app.props.get('--c'), '46.41px');

  // The keyboard closes: back to the CSS height and to `inset: 0`.
  applyLayout(asElement(app), at(820, 1180), viewport(1180, 0));
  assert.equal(app.props.has('--app-h'), false);
  assert.equal(app.style.top, '');
  assert.deepEqual(app.dataset, { layout: 'portrait', kb: '0' });

  // A browser without visualViewport: nothing to follow, the CSS height stays in charge.
  const old = fakeApp();
  applyLayout(asElement(old), at(820, 1180, { visibleH: 780 }), null);
  assert.equal(old.props.has('--app-h'), false);
  assert.equal(old.style.top, '');
  assert.equal(old.dataset.kb, '1');
});

// ---------------------------------------------------------------------------------------------------------------------
// styles/layout.css and index.html: the shell that applyLayout drives
// ---------------------------------------------------------------------------------------------------------------------

/**
 * A reader for the plain CSS this project writes: rules, and @media blocks one level deep.
 * @param {string} text
 * @returns {{media:string|null, selector:string, decls:[string, string][]}[]}
 */
function parseCss(text) {
  const src = text.replace(/\/\*[\s\S]*?\*\//g, '');
  /** @type {{media:string|null, selector:string, decls:[string, string][]}[]} */
  const rules = [];
  let i = 0;
  /** @param {string|null} media */
  const block = (media) => {
    while (i < src.length) {
      const open = src.indexOf('{', i), close = src.indexOf('}', i);
      if (close !== -1 && (open === -1 || close < open)) { i = close + 1; return; }
      if (open === -1) { i = src.length; return; }
      const prelude = src.slice(i, open).trim().replace(/\s+/g, ' ');
      i = open + 1;
      if (prelude.startsWith('@media')) { block(prelude.slice(6).trim()); continue; }
      const end = src.indexOf('}', i);
      /** @type {[string, string][]} */
      const decls = [];
      for (const part of src.slice(i, end).split(';')) {
        const colon = part.indexOf(':');
        if (colon > 0) decls.push([part.slice(0, colon).trim(), part.slice(colon + 1).trim().replace(/\s+/g, ' ')]);
      }
      i = end + 1;
      rules.push({ media, selector: prelude, decls });
    }
  };
  block(null);
  return rules;
}

/**
 * Evaluates a CSS length or number built from px, vw, dvh, numbers, + - * /, parentheses, calc(), min(), max(),
 * clamp() and var(). Returns px (or the plain number).
 * @param {string} text
 * @param {{W:number, H:number, vars:Map<string, string>}} env
 * @returns {number}
 */
function evalCss(text, env) {
  const tokens = text.match(/--[\w-]+|[a-z]+(?=\()|\d*\.?\d+(?:px|vw|dvh)?|[-+*/(),]/g) ?? [];
  let p = 0;
  /** @returns {number} */
  const expr = () => {
    let value = term();
    while (tokens[p] === '+' || tokens[p] === '-') value = tokens[p++] === '+' ? value + term() : value - term();
    return value;
  };
  /** @returns {number} */
  const term = () => {
    let value = factor();
    while (tokens[p] === '*' || tokens[p] === '/') value = tokens[p++] === '*' ? value * factor() : value / factor();
    return value;
  };
  /** @returns {number} */
  const factor = () => {
    const token = tokens[p++];
    if (token === '-') return -factor();
    if (token === '(') { const value = expr(); p++; return value; }
    if (/^[a-z]+$/.test(token)) {
      p++;                                                    // the opening parenthesis
      if (token === 'var') {
        const name = tokens[p++];
        p++;
        const value = env.vars.get(name);
        assert.ok(value !== undefined, `var(${name}) is defined in the block`);
        return evalCss(value, env);
      }
      const args = [expr()];
      while (tokens[p] === ',') { p++; args.push(expr()); }
      p++;
      if (token === 'calc') return args[0];
      if (token === 'min') return Math.min(...args);
      if (token === 'max') return Math.max(...args);
      if (token === 'clamp') return Math.max(args[0], Math.min(args[1], args[2]));
      assert.fail(`unexpected function ${token}()`);
    }
    const number = parseFloat(token);
    if (token.endsWith('vw')) return number * env.W / 100;
    if (token.endsWith('dvh')) return number * env.H / 100;
    return number;
  };
  const value = expr();
  assert.equal(p, tokens.length, `"${text}" was read to the end`);
  return value;
}

const LAYOUT_CSS = parseCss(read('styles/layout.css'));
const MODES = /** @type {const} */ (['landscape', 'portrait', 'compact']);
/** @param {string} selector @param {(media:string|null) => boolean} [mediaTest] */
const rulesOf = (selector, mediaTest = media => media === null) => LAYOUT_CSS.filter(rule => rule.selector === selector && mediaTest(rule.media));
/** @param {'landscape'|'portrait'|'compact'} mode */
const modeBlock = (mode) => {
  const found = rulesOf(`.app[data-layout="${mode}"]`);
  assert.equal(found.length, 1, `one base block for ${mode}`);
  return found[0];
};
/** @param {[string, string][]} decls @param {string} name */
const valueOf = (decls, name) => decls.findLast(([prop]) => prop === name)?.[1];

test('layout.css: the three grids of 12.1', () => {
  const landscape = modeBlock('landscape').decls, portrait = modeBlock('portrait').decls, compact = modeBlock('compact').decls;
  assert.equal(valueOf(landscape, 'grid-template-columns'), 'minmax(0, 1fr) var(--panel-w)');
  assert.equal(valueOf(landscape, 'grid-template-rows'), 'var(--top) minmax(0, 1fr) var(--bar)');
  assert.equal(valueOf(landscape, 'grid-template-areas'), '"top top" "stage coach" "under actions"');
  assert.equal(valueOf(portrait, 'grid-template-columns'), 'minmax(0, 1fr)');
  assert.equal(valueOf(portrait, 'grid-template-rows'), 'var(--top) auto var(--bar) minmax(0, 1fr) var(--actions)');
  assert.equal(valueOf(portrait, 'grid-template-areas'), '"top" "stage" "under" "coach" "actions"');
  // 38fr 62fr, each with a zero minimum so that a long label can never widen the page
  assert.equal(valueOf(compact, 'grid-template-columns'), 'minmax(0, 38fr) minmax(0, 62fr)');
  assert.equal(valueOf(compact, 'grid-template-rows'), 'var(--top) auto var(--bar) minmax(0, 1fr)');
  assert.equal(valueOf(compact, 'grid-template-areas'), '"top top" "stage stage" "under actions" "coach coach"');

  // Undo is directly under the board in every mode: "under" follows "stage" in the same column.
  for (const mode of MODES) {
    const rows = (valueOf(modeBlock(mode).decls, 'grid-template-areas') ?? '').match(/"[^"]+"/g)?.map(row => row.slice(1, -1).split(' ')) ?? [];
    const stageRow = rows.findIndex(row => row[0] === 'stage');
    assert.ok(stageRow >= 0, `${mode}: there is a stage row`);
    assert.equal(rows[stageRow + 1]?.[0], 'under', `${mode}: the under-bar is the next row, first column`);
  }

  // The gaps and gutters are the ones computeLayout budgets for.
  assert.equal(valueOf(landscape, 'gap'), `0 ${at(1180, 820).gap}px`);
  assert.equal(valueOf(landscape, 'padding-left'), `max(${at(1180, 820).gap}px, env(safe-area-inset-left))`);
  assert.equal(valueOf(landscape, 'padding-right'), `max(${at(1180, 820).gap}px, env(safe-area-inset-right))`);
  assert.equal(valueOf(landscape, '--_stage-pad'), `${at(1180, 820).pad}px`);
  assert.equal(valueOf(portrait, 'gap'), '5px 0', 'four row gaps of 5 px are the 20 px of `gaps`');
  assert.equal(valueOf(portrait, 'padding-left'), `max(${at(820, 1180).pad}px, env(safe-area-inset-left))`);
  assert.equal(valueOf(compact, 'gap'), '4px 8px', 'three row gaps of 4 px are the 12 px of `gaps`');
  // compact: 8 px page gutter, and the stage reaches 4 px further out on each side -> a 4 px board gutter
  assert.equal(valueOf(compact, 'padding-left'), 'max(8px, env(safe-area-inset-left))');
  assert.equal(8 + parseFloat(valueOf(compact, '--_stage-bleed') ?? ''), at(360, 740).pad);
  const small = rulesOf('.app[data-layout="landscape"]', media => media === '(max-height: 479.98px)');
  assert.equal(small.length, 1, 'one block for the landscape phone');
  assert.equal(valueOf(small[0].decls, 'column-gap'), `${at(844, 390).gap}px`);
  assert.equal(valueOf(small[0].decls, '--_stage-pad'), `${at(844, 390).pad}px`);

  // The regions sit in their named areas; the stage clips (the fx canvas bleeds past the board).
  const areas = { '.topbar': 'top', '.stage': 'stage', '.underbar': 'under', '.coach': 'coach', '.actions': 'actions' };
  for (const [selector, area] of Object.entries(areas)) {
    assert.equal(valueOf(rulesOf(selector)[0].decls, 'grid-area'), area, `${selector} is placed in "${area}"`);
  }
  assert.equal(valueOf(rulesOf('.stage')[0].decls, 'overflow'), 'clip');
  const app = rulesOf('.app')[0].decls;
  assert.equal(valueOf(app, 'position'), 'fixed');
  assert.equal(valueOf(app, 'inset'), '0');
  assert.deepEqual(app.filter(([prop]) => prop === 'height').map(([, value]) => value), ['100vh', '100dvh']);
  assert.equal(valueOf(app, 'padding'), 'env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)');
});

test('layout.css: the sizes before the first applyLayout equal computeLayout', () => {
  /** Viewports of the 12.2 table without the keyboard, plus a few in between. */
  const viewports = [
    ...TABLE.filter(row => row[1] === row[2]).map(row => [row[0], row[1]]),
    [1280, 720], [2560, 1440], [1000, 700], [600, 900], [700, 1000], [375, 667], [412, 915], [320, 568], [568, 320], [667, 375],
  ];
  for (const [W, H] of viewports) {
    const r = at(W, H);
    const name = `${W} x ${H} (${r.layout})`;
    const vars = new Map(modeBlock(r.layout).decls.filter(([prop]) => prop.startsWith('--')));
    /** @param {{decls:[string, string][]}[]} found */
    const overlay = (found) => { for (const rule of found) for (const [prop, value] of rule.decls) vars.set(prop, value); };
    if (r.layout === 'landscape' && H < 480) overlay(rulesOf('.app[data-layout="landscape"]', media => media === '(max-height: 479.98px)'));
    if (r.layout === 'compact' && H < 600) {
      const short = rulesOf('.app:not([style])', media => media !== null && media.includes('(max-height: 599.98px)'));
      assert.equal(short.length, 1, 'one block for phones lower than 600 px');
      overlay(short);
    }
    const env = { W, H, vars };
    const css = (/** @type {string} */ prop) => evalCss(vars.get(prop) ?? assert.fail(`${prop} has a CSS default in the ${r.layout} block`), env);

    assert.equal(css('--top'), r.top, `${name}: --top`);
    assert.equal(css('--bar'), r.bar, `${name}: --bar`);
    assert.equal(css('--actions'), r.actions, `${name}: --actions`);
    assert.equal(css('--stage-scale'), 1, `${name}: --stage-scale`);
    // computeLayout floors c to 0.01 px; CSS does not round.
    assert.ok(css('--c') - r.c >= -1e-9 && css('--c') - r.c < 0.01, `${name}: --c ${css('--c')} vs ${r.c}`);
    assert.ok(Math.abs(css('--board-w') - r.boardW) < 0.1, `${name}: --board-w`);
    assert.ok(Math.abs(css('--board-h') - r.boardH) < 0.11, `${name}: --board-h`);
    assert.ok(Math.abs(css('--panel-w') - r.panelW) <= 0.6, `${name}: --panel-w ${css('--panel-w')} vs ${r.panelW}`);
    assert.ok(Math.abs(css('--buddy-h') - r.buddyH) <= 0.62, `${name}: --buddy-h ${css('--buddy-h')} vs ${r.buddyH}`);
    assert.ok(Math.abs(css('--mini-h') - r.miniH) < 1e-6, `${name}: --mini-h`);
  }
});

test('layout.css: after applyLayout the board is drawn at the size computeLayout decided', () => {
  // #board is `min(--board-w, 100 %, the height left for it)`. The third term exists for safe-area insets, which
  // computeLayout does not know; without insets it must never bite, or the board would silently be smaller than
  // --board-w says. That holds exactly when the CSS reserves the heights computeLayout reserves (bars, gaps, the
  // coach minimum of 176 / 96 / 88 px).
  /** @type {[number, number, number][]} */
  const cases = TABLE.map(row => [row[0], row[1], row[2]]);
  for (let W = 360; W <= 2000; W += 40) for (let H = 560; H <= 1400; H += 40) cases.push([W, H, H]);
  // keyboard up: 300 to 400 px of every viewport of the table covered
  for (const row of TABLE) for (const covered of [300, 400]) if (row[1] === row[2] && row[1] - covered >= 300) cases.push([row[0], row[1], row[1] - covered]);
  let checked = 0, heightLimited = 0;
  for (const [W, H, visibleH] of cases) {
    const r = at(W, H, { visibleH });
    if (r.c === 20) continue;                   // the floor: computeLayout itself no longer fits the board
    const name = `${W} x ${H}${visibleH === H ? '' : ` (visible ${visibleH})`} (${r.layout})`;
    const vars = new Map(modeBlock(r.layout).decls.filter(([prop]) => prop.startsWith('--')));
    /** @param {{decls:[string, string][]}[]} found */
    const overlay = (found) => { for (const rule of found) for (const [prop, value] of rule.decls) vars.set(prop, value); };
    if (r.layout === 'landscape' && H < 480) overlay(rulesOf('.app[data-layout="landscape"]', media => media === '(max-height: 479.98px)'));
    if (r.layout === 'portrait' && r.kb) {
      const typing = rulesOf('.app[data-layout="portrait"][data-kb="1"]');
      assert.equal(typing.length, 1, 'one block for portrait with the keyboard up');
      overlay(typing);
    }
    const app = fakeApp();
    applyLayout(asElement(app), r, viewport(visibleH, 0));
    for (const [prop, value] of app.props) vars.set(prop, value);          // inline style wins over the block
    vars.set('--_h', `${visibleH}px`);                                      // the app's height without insets
    const fit = vars.get('--_board-fit') ?? assert.fail(`${name}: --_board-fit is set`);
    assert.ok(fit.startsWith('min(var(--board-w), 100%, '), `${name}: ${fit}`);
    const drawn = evalCss(fit.replace('100%, ', ''), { W, H, vars });
    const boardW = Math.round(r.boardW * 100) / 100;
    assert.ok(drawn <= boardW && drawn > boardW - 0.011, `${name}: the board is drawn ${drawn} px wide, computeLayout says ${boardW}`);
    checked++;
    // Where the height decides c, the bound is tight: a larger reserve in the CSS would show up above.
    const bound = evalCss(fit.replace('min(var(--board-w), 100%, ', '('), { W, H, vars });
    if (bound - boardW < 0.1) heightLimited++;
    assert.ok(bound > boardW - 0.011, `${name}: the height bound ${bound} is not below the board ${boardW}`);
  }
  assert.ok(checked > 600 && heightLimited > 200, `${checked} viewports checked, ${heightLimited} of them limited by the height`);
});

test('layout.css: the mode chosen before the first applyLayout repeats the data-layout block', () => {
  // index.html ships data-layout="landscape"; until a script has run, media queries pick the mode.
  const NOT_LANDSCAPE = '(not (((min-width: 900px) and (min-aspect-ratio: 21/20)) or ((max-height: 479.98px) and (orientation: landscape))))';
  const fallback = {
    portrait: rulesOf('.app:not([style])', media => media === `${NOT_LANDSCAPE} and (min-width: 600px)`),
    compact: rulesOf('.app:not([style])', media => media === `${NOT_LANDSCAPE} and (max-width: 599.98px)`),
  };
  for (const mode of /** @type {const} */ (['portrait', 'compact'])) {
    assert.equal(fallback[mode].length, 1, `one fallback block for ${mode}`);
    assert.deepEqual(fallback[mode][0].decls, modeBlock(mode).decls, `${mode}: the fallback block is a copy of the data-layout block`);
  }
  // Every mode block sets the same properties, so switching the mode can never leave a value of another mode behind.
  const names = (/** @type {'landscape'|'portrait'|'compact'} */ mode) => modeBlock(mode).decls.map(([prop]) => prop).sort();
  assert.deepEqual(names('portrait'), names('landscape'));
  assert.deepEqual(names('compact'), names('landscape'));
  // The fallback blocks come after the data-layout blocks (same specificity: the later rule wins).
  const order = LAYOUT_CSS.map(rule => `${rule.media === null ? '' : '@'}${rule.selector}`);
  assert.ok(order.indexOf('@.app:not([style])') > order.indexOf('.app[data-layout="compact"]'));
  // What applyLayout writes inline are exactly the properties that have a CSS default (plus --app-h, which has a fallback where it is used).
  const app = fakeApp();
  applyLayout(asElement(app), at(820, 1180, { visibleH: 780 }), viewport(780, 0));
  for (const prop of app.props.keys()) {
    if (prop === '--app-h') continue;
    for (const mode of MODES) assert.ok(valueOf(modeBlock(mode).decls, prop) !== undefined, `${mode} block has a default for ${prop}`);
  }
  assert.ok(read('styles/layout.css').includes('var(--app-h, 100dvh)'));
});

test('layout.css: the conversation sheet and the keyboard', () => {
  // compact: the stage row becomes the miniature and the stage is scaled from its top centre (G4, 220 ms)
  const rows = rulesOf('.app[data-layout="compact"][data-sheet="1"]');
  assert.equal(valueOf(rows[0].decls, 'grid-template-rows'), 'var(--top) var(--mini-h) var(--bar) minmax(0, 1fr)');
  const stage = rulesOf('.app[data-layout="compact"][data-sheet="1"] .stage')[0].decls;
  assert.equal(valueOf(stage, 'transform'), 'scale(var(--stage-scale))');
  // The origin must not depend on the sheet: while the sheet closes the stage is still scaled (the transition runs
  // back to 1), and an origin that had already fallen back to the centre would make the miniature jump down first.
  assert.equal(valueOf(stage, 'transform-origin'), undefined, 'the origin is not tied to data-sheet');
  assert.equal(valueOf(rulesOf('.app[data-layout="compact"] .stage')[0].decls, 'transform-origin'), 'top center');
  const motion = rulesOf(':root[data-motion="full"] .app[data-layout="compact"] .stage')[0].decls;
  assert.equal(valueOf(motion, 'transition'), 'transform 220ms var(--e-inout)');
  // the sheet stacks at --z-sheet in every mode
  assert.equal(valueOf(rulesOf('.app[data-sheet="1"] .coach__chat')[0].decls, 'z-index'), 'var(--z-sheet)');
  // portrait: at most the lower 40 % of the board, at most 320 px of it, never lower than 280 px
  const portraitSheet = valueOf(rulesOf('.app[data-layout="portrait"][data-sheet="1"] .coach__chat')[0].decls, 'height') ?? '';
  assert.ok(portraitSheet.includes('min(var(--board-h) * .4, 320px)') && portraitSheet.startsWith('max(280px,'), portraitSheet);
  // keyboard: the app takes the height of the visual viewport
  assert.equal(valueOf(rulesOf('.app[data-kb="1"]')[0].decls, 'height'), 'var(--app-h, 100dvh)');
  // #overlays lies over the whole app, so it must let taps through; its children take them again, with a rule
  // of no specificity so that hud.css can still switch one of them off.
  assert.equal(valueOf(rulesOf('#overlays')[0].decls, 'pointer-events'), 'none');
  assert.equal(valueOf(rulesOf(':where(#overlays) > *')[0].decls, 'pointer-events'), 'auto');
  assert.equal(rulesOf('#overlays > *').length, 0, 'no id-strength rule on the children of #overlays');
});

/**
 * Evaluates a media query list made of width / height / aspect-ratio / orientation features with `not`, `and`,
 * `or`, parentheses and commas, for a viewport of W x H CSS px.
 * @param {string} text
 * @param {number} W
 * @param {number} H
 * @returns {boolean}
 */
function matchesMedia(text, W, H) {
  const tokens = text.match(/[(),:]|[a-z-]+|[\d.]+(?:px)?(?:\/[\d.]+)?/g) ?? [];
  let p = 0;
  /** @param {string} expected */
  const eat = (expected) => { assert.equal(tokens[p++], expected, `"${text}": expected ${expected}`); };
  /** @returns {boolean} */
  const feature = () => {
    const name = tokens[p++];
    eat(':');
    const value = tokens[p++];
    if (name === 'min-width') return W >= parseFloat(value);
    if (name === 'max-width') return W <= parseFloat(value);
    if (name === 'min-height') return H >= parseFloat(value);
    if (name === 'max-height') return H <= parseFloat(value);
    if (name === 'min-aspect-ratio') { const [a, b] = value.split('/').map(Number); return W * b >= H * a; }
    if (name === 'orientation') return value === 'landscape' ? W > H : H >= W;
    assert.fail(`unexpected media feature ${name}`);
  };
  /** @returns {boolean} */
  const inParens = () => {
    eat('(');
    const value = tokens[p] === '(' || tokens[p] === 'not' ? condition() : feature();
    eat(')');
    return value;
  };
  /** @returns {boolean} */
  const condition = () => {
    if (tokens[p] === 'not') { p++; return !inParens(); }
    let value = inParens();
    while (tokens[p] === 'and' || tokens[p] === 'or') {
      const op = tokens[p++];
      const right = inParens();
      value = op === 'and' ? value && right : value || right;
    }
    return value;
  };
  let result = condition();
  while (tokens[p] === ',') { p++; result = condition() || result; }
  assert.equal(p, tokens.length, `"${text}" was read to the end`);
  return result;
}

test('the media queries pick the mode, the small bars and the wide type scale exactly as computeLayout does', () => {
  // The evaluator itself, on queries whose answer is obvious.
  assert.equal(matchesMedia('(min-width: 600px)', 600, 100), true);
  assert.equal(matchesMedia('(min-width: 600px)', 599, 100), false);
  assert.equal(matchesMedia('(not ((min-width: 600px) or (max-height: 99.98px)))', 599, 100), true);
  assert.equal(matchesMedia('(not ((min-width: 600px) or (max-height: 99.98px)))', 599, 99), false);
  assert.equal(matchesMedia('(min-width: 600px), (max-height: 479.98px) and (orientation: landscape)', 500, 400), true);
  assert.equal(matchesMedia('(min-width: 600px), (max-height: 479.98px) and (orientation: landscape)', 400, 400), false);
  assert.equal(matchesMedia('(min-aspect-ratio: 21/20)', 1050, 1000), true);
  assert.equal(matchesMedia('(min-aspect-ratio: 21/20)', 1049, 1000), false);

  const fallbacks = LAYOUT_CSS.filter(rule => rule.selector === '.app:not([style])' && rule.media !== null);
  /** @param {string} areas */
  const mediaOfGrid = (areas) => fallbacks.find(rule => valueOf(rule.decls, 'grid-template-areas') === areas)?.media ?? assert.fail(`a fallback block with the areas ${areas}`);
  const portraitMedia = mediaOfGrid('"top" "stage" "under" "coach" "actions"');
  const compactMedia = mediaOfGrid('"top top" "stage stage" "under actions" "coach coach"');
  const shortMedia = fallbacks.find(rule => valueOf(rule.decls, 'grid-template-areas') === undefined)?.media ?? assert.fail('a block for short phones');
  assert.equal(fallbacks.length, 3);
  const smallMedia = rulesOf('.app[data-layout="landscape"]', media => media !== null)[0]?.media ?? assert.fail('a block for the landscape phone');
  const wideMedia = parseCss(read('styles/tokens.css')).find(rule => rule.media !== null && rule.selector === ':root' && valueOf(rule.decls, '--fs-body') === '16px')?.media
    ?? assert.fail('tokens.css has the wide type scale in a media query');

  /** @type {[number, number][]} */
  const viewports = [];
  for (let W = 320; W <= 2000; W += 7) for (let H = 300; H <= 1500; H += 11) viewports.push([W, H]);
  // every boundary of computeLayout, one pixel on each side
  for (const W of [359, 360, 480, 599, 600, 601, 899, 900, 901, 945, 1049, 1050, 1051]) {
    for (const H of [320, 400, 479, 480, 481, 599, 600, 601, 856, 857, 858, 899, 900, 901, 999, 1000, 1001]) viewports.push([W, H]);
  }
  for (const [W, H] of viewports) {
    const r = at(W, H);
    const name = `${W} x ${H}`;
    const portrait = matchesMedia(portraitMedia, W, H), compact = matchesMedia(compactMedia, W, H);
    // index.html ships data-layout="landscape": that block stays in force exactly when neither fallback matches.
    assert.equal(portrait ? 'portrait' : compact ? 'compact' : 'landscape', r.layout, `${name}: mode before the first applyLayout`);
    assert.ok(!(portrait && compact), `${name}: at most one fallback block applies`);
    if (r.layout === 'landscape') assert.equal(matchesMedia(smallMedia, W, H), r.top === 36, `${name}: the landscape-phone block`);
    assert.equal(matchesMedia(shortMedia, W, H), r.layout === 'compact' && r.top === 36, `${name}: the 36 px top bar of a short phone`);
    assert.equal(matchesMedia(wideMedia, W, H), r.layout !== 'compact', `${name}: the wide type scale`);
  }
});

test('layout.css: in landscape the board, its under-bar and the coach column are one centred group', () => {
  // Owner decision K-99. computeLayout caps the board at 84 px per cell and the coach column at 480 px; in a window
  // larger than that the grid is padded so that the regions stay together in the middle (the numbers of the 12.2
  // table do not change: computeLayout is untouched).
  const WIDE = '(min-width: 900px) and (min-aspect-ratio: 21/20) and (min-height: 480px)';
  const found = rulesOf('.app[data-layout="landscape"]', media => media === WIDE);
  assert.equal(found.length, 1, 'one block for the centred group');
  const decls = found[0].decls;
  const base = modeBlock('landscape').decls;

  // It follows the base block and the landscape-phone block (same specificity: the later rule wins).
  const order = LAYOUT_CSS.map(rule => `${rule.media ?? ''}|${rule.selector}`);
  assert.ok(order.indexOf(`${WIDE}|.app[data-layout="landscape"]`) > order.indexOf('(max-height: 479.98px)|.app[data-layout="landscape"]'));
  assert.ok(order.indexOf('(max-height: 479.98px)|.app[data-layout="landscape"]') > order.indexOf('|.app[data-layout="landscape"]'));

  // The gutters grow, they are never smaller than the ones of 12.1, and a larger safe-area inset still wins.
  assert.equal(valueOf(decls, 'column-gap'), 'var(--_mid)');
  assert.equal(valueOf(decls, 'padding-left'), 'max(var(--group-x), env(safe-area-inset-left))');
  assert.equal(valueOf(decls, 'padding-right'), 'max(var(--group-x), env(safe-area-inset-right))');
  assert.equal(valueOf(decls, 'padding-top'), 'calc(env(safe-area-inset-top, 0px) + var(--group-y))');
  assert.equal(valueOf(decls, 'padding-bottom'), 'calc(env(safe-area-inset-bottom, 0px) + var(--group-y))');
  // The grid itself is the one of 12.1: this block changes no track and no area.
  for (const [prop] of decls) assert.ok(!prop.startsWith('grid'), `${prop} is not redefined for wide windows`);

  // Across, everything is taken from the window alone, so the coach column does not move when the on-screen
  // keyboard shrinks the board: --_c0 is the --c default of the landscape block less the safe areas above and below
  // (computeLayout does not know them; the board is drawn that much smaller), and nothing reads what applyLayout writes.
  const SAFE_Y = ' - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px)';
  assert.equal(valueOf(decls, '--_c0'), (valueOf(base, '--c') ?? '').replace('(100dvh - 128px)', `(100dvh - 128px${SAFE_Y})`));
  assert.ok((valueOf(decls, '--_c0') ?? '').includes(SAFE_Y), '--_c0 takes the safe areas off the height');
  for (const prop of ['--_c0', '--_spare', '--_mid', '--group-x', '--_stage-room']) {
    const value = valueOf(decls, prop) ?? assert.fail(`${prop} is set`);
    const allowed = prop === '--_stage-room' ? ['var(--_mid', 'var(--group-x'] : ['var(--_c0', 'var(--_spare', 'var(--_mid'];
    for (const used of value.match(/var\(--[\w-]+/g) ?? []) assert.ok(allowed.includes(used), `${prop} reads ${used})`);
  }

  /**
   * The block's values for a window, after applyLayout. `insets` are the safe areas [top, right, bottom, left].
   * `drawn` is the board's width as the height lets #board be (--_board-fit without its 100 % term).
   * @param {number} W @param {number} H @param {number} [visibleH] @param {[number, number, number, number]} [insets]
   */
  const groupAt = (W, H, visibleH = H, insets = [0, 0, 0, 0]) => {
    const r = at(W, H, { visibleH });
    const px = { top: insets[0], right: insets[1], bottom: insets[2], left: insets[3] };
    const safe = (/** @type {string} */ text) => text.replace(/env\(safe-area-inset-(top|right|bottom|left)(?:, 0px)?\)/g,
      (_, /** @type {'top'|'right'|'bottom'|'left'} */ side) => `${px[side]}px`);
    const vars = new Map([...base, ...decls].filter(([prop]) => prop.startsWith('--')).map(([prop, value]) => [prop, safe(value)]));
    const app = fakeApp();
    applyLayout(asElement(app), r, viewport(visibleH, 0));
    for (const [prop, value] of app.props) vars.set(prop, value);
    vars.set('--_h', `${visibleH - px.top - px.bottom}px`);                 // the app's height without insets
    const css = (/** @type {string} */ prop) => evalCss(vars.get(prop) ?? assert.fail(`${prop} is set`), { W, H, vars });
    const drawn = evalCss((vars.get('--_board-fit') ?? '').replace('100%, ', ''), { W, H, vars });
    return { r, mid: css('--_mid'), x: css('--group-x'), y: css('--group-y'), room: css('--_stage-room'), drawn };
  };

  // The media query is computeLayout's landscape test for a window of 480 px or higher.
  for (let W = 320; W <= 2600; W += 13) {
    for (let H = 300; H <= 1500; H += 17) {
      const r = at(W, H);
      assert.equal(matchesMedia(WIDE, W, H), r.layout === 'landscape' && r.top === 48, `${W} x ${H}: the block applies to landscape, not to the landscape phone`);
    }
  }
  for (const [W, H] of [[899, 800], [900, 800], [900, 857], [900, 858], [1050, 1000], [1049, 1000], [1000, 479], [1000, 480]]) {
    const r = at(W, H);
    assert.equal(matchesMedia(WIDE, W, H), r.layout === 'landscape' && r.top === 48, `${W} x ${H}`);
  }

  let checked = 0, lifted = 0, widened = 0;
  for (let W = 900; W <= 2600; W += 20) {
    for (let H = 480; H <= 1600; H += 20) {
      const r = at(W, H);
      if (r.layout !== 'landscape' || r.c === 20) continue;
      const name = `${W} x ${H}`;
      const g = groupAt(W, H);
      // across: margin | board | gap | coach column | margin fills the width; the stage column is the board's width
      assert.ok(g.mid >= 16 - 1e-9 && g.mid <= 40 + 1e-9, `${name}: the gap between board and coach column is ${g.mid}`);
      assert.ok(g.x >= 16 - 1e-9, `${name}: the margin is ${g.x}`);
      const stageColumn = W - 2 * g.x - g.mid - r.panelW;
      assert.ok(Math.abs(stageColumn - r.boardW) <= 0.6, `${name}: the stage column is ${stageColumn} wide, the board ${r.boardW}`);
      // the stage's box reaches one gap further out on both sides (room for a shake, a glow, the fx canvas): up to
      // the coach column on the right, and never past the window's edge on the left
      assert.ok(Math.abs(g.room - g.mid) < 1e-9, `${name}: the stage has ${g.room} px of room, the gap is ${g.mid}`);
      assert.ok(g.x - g.room >= -1e-9, `${name}: the stage's left edge stays in the window`);
      // thirds until the gap is 40 px, then only the margins grow
      if (g.mid < 40 - 1e-9) assert.ok(Math.abs(g.x - g.mid) < 1e-6, `${name}: margins ${g.x} and gap ${g.mid} are equal below 40 px`);
      else assert.ok(g.x >= 40 - 1e-6, `${name}: the margins ${g.x} are not smaller than the 40 px gap`);
      // down: top bar, the board with its two paddings, bottom row; the rest is split above and below
      assert.ok(g.y >= 0, `${name}: --group-y = ${g.y}`);
      assert.ok(Math.abs(g.y - (r.coachH - r.boardH) / 2) < 0.006, `${name}: --group-y = ${g.y}`);
      assert.ok(Math.abs(r.top + r.pad + r.boardH + r.pad + r.bar + 2 * g.y - H) < 0.011, `${name}: the group and its two margins fill the height`);
      checked++;
      if (g.y > 1) lifted++;
      if (g.x > 16.5) widened++;
    }
  }
  assert.ok(checked > 1500 && lifted > 300 && widened > 500, `${checked} windows checked, ${lifted} with room above and below, ${widened} with wide margins`);

  // The reference windows of K-99: the gap is between 24 and 48 px, the group is centred, the under-bar is directly
  // under the board (the stage row is the board plus its two 8 px paddings, as at 1180 x 820).
  /** [W, H, margin left and right, gap, margin top and bottom] */
  const reference = /** @type {const} */ ([
    [1180, 820, 33.1, 33.1, 0], [1366, 1024, 37.7, 37.7, 2.8], [1440, 900, 125, 40, 0], [1920, 1080, 313.6, 40, 30.8], [2560, 1440, 633.6, 40, 210.8],
  ]);
  for (const [W, H, x, mid, y] of reference) {
    const g = groupAt(W, H);
    const name = `${W} x ${H}`;
    assert.ok(g.mid >= 24 && g.mid <= 48, `${name}: gap ${g.mid}`);
    assert.ok(Math.abs(g.x - x) < 0.06 && Math.abs(g.mid - mid) < 0.06 && Math.abs(g.y - y) < 0.06, `${name}: margins ${g.x}, gap ${g.mid}, above and below ${g.y}`);
    assert.equal(g.r.panelW, 480, `${name}: the coach column keeps its 480 px`);
    assert.ok(Math.abs(2 * g.x + g.r.boardW + g.mid + g.r.panelW - W) < 0.1, `${name}: equal margins left and right of board + gap + column`);
  }
  // A window that leaves board and column only the three 16 px gutters of 12.1 is laid out as before.
  assert.deepEqual([groupAt(1024, 768).x, groupAt(1024, 768).mid], [16, 16]);

  // Keyboard up: the margins and the gap are the ones of the window without the keyboard, and the shrunken board
  // still has its under-bar directly below (no room is left above or below it).
  for (const [W, H, visibleH] of /** @type {const} */ ([[1180, 820, 420], [1366, 1024, 620], [1920, 1080, 600]])) {
    const open = groupAt(W, H), typing = groupAt(W, H, visibleH);
    assert.equal(typing.r.kb, true);
    assert.deepEqual([typing.x, typing.mid], [open.x, open.mid], `${W} x ${H}, visible ${visibleH}: the coach column does not move`);
    assert.ok(typing.y >= 0 && typing.y < 0.06, `${W} x ${H}, visible ${visibleH}: --group-y = ${typing.y}`);      // c is floored to 0.01 px
  }

  // A home-screen web app on an iPad has safe areas above and below (status bar 24 px, home indicator 20 px) that
  // computeLayout does not know: #board is drawn smaller (--_board-fit). The stage column shrinks with it, so the
  // group stays centred and the gap stays the gap; a column as wide as the full-size board would hold the smaller
  // board off-centre, 19 px further from the coach column at 1180 x 820.
  /** [W, H, whether the 44 px make the board smaller (at 1920 x 1080 the 84 px cap still decides)] */
  const homeScreen = /** @type {const} */ ([[1180, 820, true], [1194, 834, true], [1366, 1024, true], [1920, 1080, false]]);
  for (const [W, H, smaller] of homeScreen) {
    const plain = groupAt(W, H), g = groupAt(W, H, H, [24, 0, 20, 0]);
    const name = `${W} x ${H} with safe areas of 24 and 20 px`;
    assert.equal(g.drawn < plain.drawn - 20, smaller, `${name}: the board is drawn ${g.drawn} px wide instead of ${plain.drawn}`);
    const stageColumn = W - 2 * g.x - g.mid - g.r.panelW;
    assert.ok(Math.abs(stageColumn - g.drawn) < 0.1, `${name}: the stage column is ${stageColumn} wide, the drawn board ${g.drawn}`);
    assert.ok(g.mid >= 24 && g.mid <= 48 && g.x >= g.mid - 1e-6, `${name}: gap ${g.mid}, margins ${g.x}`);
    assert.ok(Math.abs(g.room - g.mid) < 1e-9, `${name}: the stage's room is the gap`);
    const groupH = 48 + 8 + g.drawn * 1060 / 920 + 8 + 64 + 2 * g.y;
    assert.ok(g.y >= 0 && Math.abs(groupH - (H - 44)) < 0.02, `${name}: the group is ${groupH} high between the safe areas`);
  }

  // A safe area at the side (a camera cut-out): one smaller than the margin moves nothing, and the stage's room
  // stops in front of it; one larger than the margin takes the margin's place, and the stage gets no room at all.
  const open = groupAt(1440, 900);                                          // margins 125 px, gap 40 px
  assert.ok(Math.abs(open.x - 124.98) < 0.01 && open.mid === 40 && open.room === 40);
  const cut = groupAt(1440, 900, 900, [0, 0, 0, 100]);
  assert.deepEqual([cut.x, cut.mid], [open.x, open.mid]);
  assert.ok(Math.abs(cut.room - (open.x - 100)) < 1e-9, `the stage stops at the 100 px inset: its room is ${cut.room} px`);
  assert.ok(Math.abs(groupAt(1440, 900, 900, [0, 100, 0, 0]).room - cut.room) < 1e-9, 'either side counts');
  assert.equal(groupAt(1440, 900, 900, [0, 0, 0, 130]).room, 0, 'no room next to an inset wider than the margin');

  // The room is the stage's margin and comes back as its padding, so the board's column (the 100 % of --_board-fit)
  // is what it was; the other modes and the landscape phone have no such room, and compact keeps its 4 px bleed.
  const stage = rulesOf('.stage')[0].decls;
  assert.equal(valueOf(stage, 'padding'), 'var(--_stage-pad) var(--_stage-room, 0px)');
  assert.equal(valueOf(stage, 'margin-inline'), 'calc(var(--_stage-bleed) - var(--_stage-room, 0px))');
  const setsRoom = LAYOUT_CSS.filter(rule => valueOf(rule.decls, '--_stage-room') !== undefined);
  assert.deepEqual(setsRoom.map(rule => [rule.media, rule.selector]), [[WIDE, '.app[data-layout="landscape"]']]);
  assert.equal(valueOf(base, '--_stage-bleed'), '0px');
});

test('computeLayout: every viewport from 360 x 560 up gets a board that fits and bars of the right mode', () => {
  for (let W = 360; W <= 2600; W += 20) {
    for (let H = 560; H <= 1600; H += 20) {
      const r = at(W, H);
      const name = `${W} x ${H} (${r.layout})`;
      assert.ok(r.c >= 20 && r.c <= (r.layout === 'compact' ? 56 : 84), `${name}: c = ${r.c}`);
      assert.ok(Math.abs(r.c * 100 - Math.round(r.c * 100)) < 1e-6, `${name}: c has two decimals`);
      assert.ok(Math.abs(usedHeight(r) - H) < 1e-6, `${name}: rows and gaps fill the height`);
      assert.ok(r.buddyH >= 56 && r.buddyH <= 300 && Number.isInteger(r.buddyH), `${name}: buddyH = ${r.buddyH}`);
      assert.equal(r.buddy === 'full', r.layout === 'landscape' && r.buddyH >= 160, `${name}: full figure only in landscape from 160 px`);
      assert.deepEqual([r.kb, r.stageScale], [false, 1], `${name}: no keyboard, no miniature`);
      assert.equal(r.miniH > 0, r.layout === 'compact', `${name}: only compact has a miniature height`);
      assert.equal(r.panelW > 0, r.layout === 'landscape', `${name}: only landscape has a coach column`);
      if (r.c === 20) continue;                 // the floor of 20 px per cell: a window too low for its mode, no promises
      if (r.layout === 'landscape') {
        assert.ok(r.panelW >= 340 && r.panelW <= 480, `${name}: panelW = ${r.panelW}`);
        assert.ok(r.boardW + r.panelW + 3 * r.gap <= W + 0.5, `${name}: board, coach column and gutters fit the width`);
        assert.ok(r.boardH <= r.coachH + 1e-9, `${name}: the board fits its cell`);
      } else {
        assert.ok(r.boardW + 2 * r.pad <= W + 1e-9, `${name}: the board and its gutters fit the width`);
        assert.ok(r.coachH >= (r.layout === 'portrait' ? 176 : 88) - 1e-6, `${name}: the coach keeps its minimum (${r.coachH})`);
      }
    }
  }
});

test('index.html: the head of 4.30.4, the shell of 12.1, and the manifest', () => {
  const html = read('index.html');
  // The colour of the browser's bar and of the installed app's splash is the page colour of the default theme (the
  // first rule of themes.css), so the first paint and the theme agree; the stage repaints it when the theme changes.
  const page = /** @type {RegExpMatchArray} */ (read('styles/themes.css').match(/--page:\s*(#[0-9a-f]{6});/i))[1];
  for (const line of [
    '<meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-visual">',
    `<meta name="theme-color" content="${page}">`,
    '<meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes">',
    '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"><meta name="apple-mobile-web-app-title" content="弈间">',
    '<link rel="apple-touch-icon" href="./icons/apple-touch-icon.png"><link rel="manifest" href="./manifest.webmanifest">',
    '<link rel="icon" type="image/svg+xml" href="./favicon.svg"><title>弈间 · 中国象棋</title>',
    '<script type="module" src="./src/app.js"></script>',
    '<div id="app" class="app" data-layout="landscape" data-phase="boot" data-ply="0" data-kb="0" data-sheet="0" data-coach="local">',
    '<header id="topbar" class="topbar"></header>',
    '<main id="stage" class="stage"><div id="board"></div></main>',
    '<div id="underbar" class="underbar"></div>',
    '<section id="coach" class="coach" aria-label="军师">',
    '<div id="buddy" class="coach__buddy"></div>',
    '<div id="chat" class="coach__chat"></div>',
    '<div id="actions" class="actions"></div>',
    '<div id="overlays"></div>',
    '<noscript><p class="noscript">请开启 JavaScript 后开始对弈。</p></noscript>',
  ]) assert.ok(html.includes(line), `index.html contains ${line}`);

  // The stylesheets: the three everything else builds on come first, in this order, and every file of styles/ is
  // linked exactly once (a skin file that is not linked would never show; a link without a file is a 404).
  const sheets = [...html.matchAll(/<link rel="stylesheet" href="\.\/styles\/([a-z]+)\.css">/g)].map(match => match[1]);
  assert.deepEqual(sheets.slice(0, 3), ['tokens', 'themes', 'layout']);
  const files = readdirSync(new URL('../../../styles/', import.meta.url)).filter(name => name.endsWith('.css')).map(name => name.slice(0, -4));
  assert.deepEqual([...sheets].sort(), files.sort());
  // Two scripts and no style element (the build rewrites `="./src/` and `="./styles/` only): the module, and right after
  // it one small inline classic script that says so when the game does not come up (CONTRACT-NOTES 150). It loads nothing.
  assert.equal((html.match(/<script/g) ?? []).length, 2);
  const inline = html.match(/<script type="module" src="\.\/src\/app\.js"><\/script>\n<script>\n([\s\S]*?)<\/script>\n<\/head>/);
  assert.ok(inline, 'the inline script follows the module script and closes the head');
  assert.ok(inline[1].includes('棋局没能打开，点这里重新加载'));
  assert.ok(inline[1].includes('window.__bootFailed = '), 'src/app.js tells a fault before its stage exists through it');
  assert.doesNotMatch(inline[1], /\b(?:href|src)\s*=|\bimport\b|\bfetch\b|<\//, 'no reference, no request, nothing that ends the element early');
  assert.equal((html.match(/<style/g) ?? []).length, 0);
  // the build rewrites these references and nothing else: the one module script and the stylesheet links
  assert.equal((html.match(/="\.\/src\//g) ?? []).length, 1);
  assert.equal((html.match(/="\.\/styles\//g) ?? []).length, sheets.length);
  // The six regions are the children of #app in grid order; no element is ever re-parented by script.
  const ids = [...html.matchAll(/ id="([a-z]+)"/g)].map(match => match[1]);
  assert.deepEqual(ids, ['app', 'topbar', 'stage', 'board', 'underbar', 'coach', 'buddy', 'chat', 'actions', 'overlays']);
  // The default theme is on <html> before any script runs.
  assert.match(html, /<html lang="zh-CN" data-theme="shachang">/);

  assert.deepEqual(JSON.parse(read('manifest.webmanifest')), {
    name: '弈间 · 中国象棋', short_name: '弈间', start_url: './', display: 'standalone', orientation: 'any',
    background_color: page, theme_color: page,
    icons: [{ src: './icons/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: './icons/icon-512.png', sizes: '512x512', type: 'image/png' }],
  });
});
