import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (/** @type {string} */ path) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');

const THEMES = /** @type {const} */ (['chibi', 'longzhong', 'shachang']);

/**
 * The token table of SPEC §10.1, one row per custom property: [chibi, longzhong, shachang].
 * "none" in the contract is `transparent`. The contract names every token except the river opacity and the four
 * arrow colours; themes.css calls those --river-opacity and --arrow-hint / -idea / -threat / -reply.
 */
const TABLE = /** @type {Record<string, [string, string, string]>} */ ({
  '--page': ['#0b0f1d', '#eef0e4', '#1c1610'],
  '--frame': ['#0a0d18', '#d9dcc2', '#3a2a18'],
  '--frame-edge': ['#5a2f1c', '#8a9a78', '#8a6a3a'],
  '--field-a': ['#1b2440', '#f2efdf', '#d9b77c'],
  '--field-b': ['#10162b', '#e3e6cf', '#c59d5f'],
  '--line': ['#e0b56a', '#4f5f45', '#4a2e10'],
  '--line-glow': ['#ff8a3d30', 'transparent', 'transparent'],
  '--river-a': ['#14324f', '#cfd8c6', '#b88f52'],
  '--river-b': ['#1f5a7a', '#e6ebdc', '#cfa868'],
  '--river-opacity': ['.55', '.60', '.50'],
  '--river-text': ['#f0c27a', '#4f5f45', '#4a2e10'],
  '--label': ['#a98d58', '#55634a', '#e0c79a'],
  '--red-a': ['#ff8a66', '#e8604f', '#d9483a'],
  '--red-b': ['#d8402f', '#c8362a', '#b3261a'],
  '--red-c': ['#8f1f14', '#8a1f16', '#6e140d'],
  '--red-rim': ['#ffd98a', '#f2d79a', '#e8b85a'],
  '--red-glyph': ['#fff3d6', '#fff6e2', '#ffeccc'],
  '--red-glow': ['#ff6a3d55', 'transparent', 'transparent'],
  '--blk-a': ['#5a6a8f', '#4a5f55', '#4a423c'],
  '--blk-b': ['#2a3552', '#27352f', '#262220'],
  '--blk-c': ['#141a2e', '#131c18', '#100d0c'],
  '--blk-rim': ['#a9bfe6', '#9cc4a8', '#b08d57'],
  '--blk-glyph': ['#eaf2ff', '#eef3ea', '#f0e6d2'],
  '--blk-glow': ['transparent', 'transparent', 'transparent'],
  '--piece-edge': ['#05070d', '#6f7a66', '#3a2a18'],
  '--shadow': ['#000a', '#2a3a2a55', '#000a'],
  '--sel': ['#ffd166', '#1f6b3f', '#7a1f12'],
  '--trial': ['#ffb000', '#8f4a00', '#0b4f5a'],
  '--ink': ['#eef2ff', '#232a22', '#f6ead2'],
  '--ink-2': ['#9aa6c7', '#5b6656', '#c2ae8a'],
  '--surface': ['#19213a', '#fbfaf2', '#2b2219'],
  '--surface-2': ['#222c4b', '#eff0e2', '#3a2e21'],
  '--edge': ['#2f3b63', '#cfd6c0', '#5a4630'],
  '--accent': ['#ffb347', '#2f7d4f', '#e8a33d'],
  '--accent-ink': ['#2a1600', '#ffffff', '#2a1700'],
  '--danger': ['#ff6b5e', '#b8281e', '#ff7a5c'],
  '--danger-ink': ['#2a0a06', '#ffffff', '#2a0a06'],
  '--arrow-hint': ['#ffd166', '#8f4a00', '#0b4f5a'],
  '--arrow-idea': ['#7fe3c0', '#1f6b3f', '#1f5a2e'],
  '--arrow-threat': ['#ff6b5e', '#b8281e', '#9c1f12'],
  '--arrow-reply': ['#a9bfe6', '#3b4a45', '#3a2a18'],
  '--fx-spark': ['#ffd166', '#c97a00', '#e8a33d'],
  '--fx-ember': ['#ff7a3d', '#c8362a', '#d9483a'],
  '--fx-cool': ['#58dcff', '#2f7d4f', '#0f7a8a'],
  '--fx-white': ['#ffffff', '#fffdf2', '#fff3dc'],
  '--shu': ['#d8402f', '#c8362a', '#b3261a'],
  '--wei': ['#3a5a9a', '#2f4f6a', '#2a3a55'],
});

/**
 * Rules of a plain stylesheet (no nesting needed here: at-rules are skipped).
 * @param {string} text
 * @returns {{selectors:string[], decls:Map<string, string>}[]}
 */
function parseRules(text) {
  const src = text.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  for (const match of src.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const prelude = match[1].trim();
    if (prelude.startsWith('@')) continue;
    const decls = new Map();
    for (const part of match[2].split(';')) {
      const colon = part.indexOf(':');
      if (colon > 0) decls.set(part.slice(0, colon).trim(), part.slice(colon + 1).trim());
    }
    rules.push({ selectors: prelude.split(',').map(s => s.trim()), decls });
  }
  return rules;
}

const THEME_RULES = parseRules(read('styles/themes.css'));

/** The custom properties of one theme, from the rule whose selector list names it. */
function tokensOf(/** @type {string} */ theme) {
  const found = THEME_RULES.filter(rule => rule.selectors.includes(`[data-theme="${theme}"]`));
  assert.equal(found.length, 1, `exactly one rule defines the theme ${theme}`);
  return new Map([...found[0].decls].filter(([prop]) => prop.startsWith('--')));
}

/** @param {string} hex  #rgb, #rgba, #rrggbb or #rrggbbaa @returns {[number, number, number, number]} r, g, b in 0..255 and alpha in 0..1 */
function rgba(hex) {
  assert.match(hex, /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i, `${hex} is a hex colour`);
  const digits = hex.length <= 5 ? [...hex.slice(1)].map(d => d + d).join('') : hex.slice(1);
  const part = (/** @type {number} */ i) => parseInt(digits.slice(i, i + 2), 16);
  return [part(0), part(2), part(4), digits.length === 8 ? part(6) / 255 : 1];
}

/** WCAG 2 relative luminance of an opaque colour. */
function luminance(/** @type {string} */ hex) {
  const [r, g, b, a] = rgba(hex);
  assert.equal(a, 1, `${hex} is opaque`);
  const linear = [r, g, b].map(v => v / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

/** WCAG 2 contrast ratio. */
function contrast(/** @type {string} */ a, /** @type {string} */ b) {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

test('every theme defines every token', () => {
  const expected = Object.keys(TABLE).sort();
  assert.equal(expected.length, 47);
  THEMES.forEach((theme, index) => {
    const tokens = tokensOf(theme);
    assert.deepEqual([...tokens.keys()].sort(), expected, `${theme} defines exactly the tokens of §10.1`);
    for (const [name, row] of Object.entries(TABLE)) {
      assert.equal(tokens.get(name), row[index], `${theme} ${name}`);
    }
    // Every colour token can be used wherever CSS expects a colour.
    for (const [name, value] of tokens) {
      if (name === '--river-opacity') {
        assert.ok(Number(value) > 0 && Number(value) <= 1, `${theme} --river-opacity is a number in (0, 1]`);
      } else if (value !== 'transparent') {
        rgba(value);
      }
    }
  });
  // chibi is the default: its rule also covers a page without the attribute.
  const chibi = THEME_RULES.find(rule => rule.selectors.includes('[data-theme="chibi"]'));
  assert.ok(chibi?.selectors.includes(':root'), ':root shares the chibi palette');
  // On <html data-theme="longzhong"> both `:root` and `[data-theme="longzhong"]` match with equal specificity,
  // so the other two palettes must come later in the file than the default one, or the default would win.
  const position = (/** @type {string} */ theme) => THEME_RULES.findIndex(rule => rule.selectors.includes(`[data-theme="${theme}"]`));
  assert.ok(position('longzhong') > position('chibi') && position('shachang') > position('chibi'), 'the default palette is the first rule');
  for (const theme of THEMES) {
    const rule = THEME_RULES[position(theme)];
    for (const selector of rule.selectors) {
      assert.ok(selector === ':root' || selector === `[data-theme="${theme}"]`, `${theme}: "${selector}" keeps the palettes at one specificity`);
    }
  }
  // Dark themes and the bright one tell the browser which form controls and scrollbars to draw.
  const scheme = (/** @type {string} */ theme) => THEME_RULES.find(rule => rule.selectors.includes(`[data-theme="${theme}"]`))?.decls.get('color-scheme');
  assert.deepEqual(THEMES.map(scheme), ['dark', 'light', 'dark']);
  // No theme-coloured token lives outside the three palettes: tokens.css has no colours of its own.
  const shared = parseRules(read('styles/tokens.css')).filter(rule => rule.selectors.includes(':root'));
  for (const rule of shared) for (const name of rule.decls.keys()) assert.ok(!(name in TABLE), `${name} is defined in themes.css only`);
});

test('contrast floors of 10.1', () => {
  /**
   * [what, floor, the ratios §10.1 states for chibi / longzhong / shachang, how to compute it from a theme's tokens]
   * Grid lines, --sel and --trial sit on a gradient: the weaker end counts.
   */
  const CHECKS = /** @type {[string, number, [number, number, number]|null, (t:Map<string, string>) => number][]} */ ([
    ['body text on surfaces', 7, [14.2, 14.1, 13.1], t => contrast(get(t, '--ink'), get(t, '--surface'))],
    ['secondary text', 4.5, [6.6, 5.8, 7.2], t => contrast(get(t, '--ink-2'), get(t, '--surface'))],
    ['primary button label', 4.5, [9.7, 5.0, 8.0], t => contrast(get(t, '--accent-ink'), get(t, '--accent'))],
    ['text on danger fills', 4.5, [6.6, 6.2, 7.2], t => contrast(get(t, '--danger-ink'), get(t, '--danger'))],
    ['grid lines on the field', 4, [8.0, 5.4, 4.9], t => Math.min(contrast(get(t, '--line'), get(t, '--field-a')), contrast(get(t, '--line'), get(t, '--field-b')))],
    ['red glyph on its disc', 4, [4.1, 4.9, 5.6], t => contrast(get(t, '--red-glyph'), get(t, '--red-b'))],
    ['black glyph on its disc', 4, [10.8, 11.4, 12.7], t => contrast(get(t, '--blk-glyph'), get(t, '--blk-b'))],
    ['--sel on the field', 3, null, t => Math.min(contrast(get(t, '--sel'), get(t, '--field-a')), contrast(get(t, '--sel'), get(t, '--field-b')))],
    ['--trial on the field', 3, null, t => Math.min(contrast(get(t, '--trial'), get(t, '--field-a')), contrast(get(t, '--trial'), get(t, '--field-b')))],
  ]);
  /** @param {Map<string, string>} tokens @param {string} name */
  function get(tokens, name) {
    const value = tokens.get(name);
    assert.ok(value, `${name} is defined`);
    return value;
  }

  // The formula itself, on the two fixed points of WCAG.
  assert.ok(Math.abs(contrast('#000000', '#ffffff') - 21) < 1e-9);
  assert.equal(contrast('#777777', '#777777'), 1);
  assert.ok(Math.abs(contrast('#fff', '#000') - 21) < 1e-9, 'short hex is read like long hex');

  let weakestMark = Infinity;
  THEMES.forEach((theme, index) => {
    const tokens = tokensOf(theme);
    for (const [what, floor, stated, ratioOf] of CHECKS) {
      const ratio = ratioOf(tokens);
      assert.ok(ratio >= floor, `${theme}: ${what} is ${ratio.toFixed(2)}, floor ${floor}`);
      // The contract prints each ratio with one decimal; the recomputed value must be that number.
      if (stated) assert.ok(Math.abs(ratio - stated[index]) < 0.1, `${theme}: ${what} is ${ratio.toFixed(2)}, §10.1 states ${stated[index]}`);
      if (!stated) weakestMark = Math.min(weakestMark, ratio);
    }
  });
  // "--sel and --trial on the field ≥ 3.7 in every theme": the weakest of the six is the one the contract quotes.
  assert.ok(Math.abs(weakestMark - 3.7) < 0.1, `the weakest selection mark is ${weakestMark.toFixed(2)}`);

  // The two sides stay apart in every theme: the red disc and the dark disc differ clearly in luminance,
  // and each glyph is lighter than its disc (cream on lacquer, pale on dark).
  for (const theme of THEMES) {
    const t = tokensOf(theme);
    assert.ok(contrast(get(t, '--red-b'), get(t, '--blk-b')) >= 2, `${theme}: red and dark discs differ`);
    assert.ok(luminance(get(t, '--red-glyph')) > luminance(get(t, '--red-b')), `${theme}: red glyph is lighter than its disc`);
    assert.ok(luminance(get(t, '--blk-glyph')) > luminance(get(t, '--blk-b')), `${theme}: dark glyph is lighter than its disc`);
  }
});

test('tokens.css carries the shared tokens of 10.1 verbatim', () => {
  const root = parseRules(read('styles/tokens.css')).find(rule => rule.selectors.length === 1 && rule.selectors[0] === ':root');
  assert.ok(root, 'tokens.css starts with a :root rule');
  const expected = {
    '--e-out': 'cubic-bezier(.2,.8,.2,1)', '--e-in': 'cubic-bezier(.6,0,.9,.4)', '--e-inout': 'cubic-bezier(.65,0,.35,1)',
    '--e-back': 'cubic-bezier(.34,1.56,.64,1)', '--e-slam': 'cubic-bezier(.5,0,.1,1)',
    '--t-1': '100ms', '--t-2': '160ms', '--t-3': '240ms', '--t-4': '360ms', '--t-5': '600ms',
    '--font-ui': 'system-ui, -apple-system, "PingFang SC", "HarmonyOS Sans SC", "MiSans", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif',
    '--font-kai': '"KaiTi", "STKaiti", "Kaiti SC", "BiauKai", "Songti SC", "SimSun", "Noto Serif CJK SC", serif',
    '--fs-body': '15px', '--lh-body': '22px', '--fs-small': '13px', '--fs-button': '16px',
    '--gap': '4px', '--pad': '8px', '--r-btn': '14px', '--r-card': '16px', '--r-chip': '17px',
    '--z-art': '0', '--z-marks': '1', '--z-pieces': '2', '--z-over': '3', '--z-fx': '4', '--z-banner': '5', '--z-hit': '6',
    '--z-sheet': '20', '--z-dialog': '30', '--z-toast': '40',
  };
  assert.deepEqual(Object.fromEntries(root.decls), expected);
  // The wide type scale (16 / 24 / 13 / 16) is a media query, so it holds before any script runs.
  const css = read('styles/tokens.css').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(css, /@media \(min-width: 600px\), \(max-height: 479\.98px\) and \(orientation: landscape\) \{\s*:root \{ --fs-body: 16px; --lh-body: 24px; --fs-small: 13px; --fs-button: 16px; \}/);
  // Focus ring of §10.1 and the reduced-motion block.
  assert.match(css, /:focus-visible \{ outline: 3px solid var\(--accent\); outline-offset: 2px; \}/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  // "Zeroes transitions" is literal. A tiny positive duration would give every element a real transition on every
  // property (transition-property defaults to all): a geometry read right after a write would see the old value
  // (board-view's FLIP reads exactly that way) and transitionend would fire for changes nobody declared.
  const reduced = parseRules(read('styles/tokens.css')).find(rule => rule.selectors.includes(':root:not([data-motion="full"]) *'));
  assert.ok(reduced, 'the reduced-motion block spares a page whose player chose full motion');
  assert.deepEqual(reduced.selectors, [':root:not([data-motion="full"]) *', ':root:not([data-motion="full"]) *::before', ':root:not([data-motion="full"]) *::after']);
  for (const prop of ['transition-duration', 'transition-delay']) {
    const value = reduced.decls.get(prop) ?? '';
    assert.match(value, /^0m?s !important$/, `${prop} is exactly zero, and wins over any module's rule`);
  }
  assert.ok(!/animation/.test([...reduced.decls.keys()].join(' ')), 'animations are not touched here: loops are gated on data-motion="full"');
  // No web font and no asset file anywhere in the three shell stylesheets (§10: everything is drawn in code).
  for (const file of ['styles/tokens.css', 'styles/themes.css', 'styles/layout.css']) {
    const text = read(file);
    assert.ok(!/@font-face|@import|url\(/.test(text), `${file} loads nothing`);
    assert.ok(!/backdrop-filter/.test(text.replace(/\/\*[\s\S]*?\*\//g, '')), `${file} does not use backdrop-filter`);
  }
});
