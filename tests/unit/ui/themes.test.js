import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (/** @type {string} */ path) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');

// The default theme comes first: its rule is the first palette rule of themes.css and also covers :root.
const THEMES = /** @type {const} */ (['shachang', 'chibi', 'longzhong']);
const DEFAULT_THEME = 'shachang';

/**
 * Every custom property a theme defines (SPEC §10.1 plus the furniture tokens of the sand-table look).
 * The palettes themselves are a matter of art and change with the look; what the other stylesheets rely on is that
 * each of these names exists in every theme with a usable value, and that the pairs below keep their contrast.
 * "none" in the contract is `transparent`.
 */
const TOKENS = [
  '--page', '--frame', '--frame-edge', '--field-a', '--field-b', '--line', '--line-glow',
  '--river-a', '--river-b', '--river-opacity', '--river-text', '--label',
  '--red-a', '--red-b', '--red-c', '--red-rim', '--red-glyph', '--red-glow',
  '--blk-a', '--blk-b', '--blk-c', '--blk-rim', '--blk-glyph', '--blk-glow',
  '--piece-edge', '--shadow', '--sel', '--trial', '--ink', '--ink-2',
  '--surface', '--surface-2', '--edge', '--accent', '--accent-ink', '--danger', '--danger-ink',
  '--arrow-hint', '--arrow-idea', '--arrow-threat', '--arrow-reply',
  '--fx-spark', '--fx-ember', '--fx-cool', '--fx-white', '--shu', '--wei',
  // the furniture of the sand-table look: bars and desk, the confirm key, secondary keys, the accent as text
  '--wood', '--wood-lo', '--wood-ink', '--jade', '--jade-ink', '--sky', '--sky-ink', '--accent-text',
];
/** The only tokens that may be "none": a glow a theme does not have. */
const MAY_BE_NONE = new Set(['--line-glow', '--red-glow', '--blk-glow']);
/** Tokens that are painted as they are, with nothing mixed under them: they must be opaque. */
const OPAQUE = TOKENS.filter(name => !MAY_BE_NONE.has(name) && name !== '--shadow' && name !== '--river-opacity');

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
  const expected = [...TOKENS].sort();
  assert.equal(expected.length, 55);
  assert.equal(new Set(TOKENS).size, TOKENS.length, 'no token is listed twice');
  for (const theme of THEMES) {
    const tokens = tokensOf(theme);
    // The same set of names in every theme: a stylesheet that reads a token never falls through to nothing.
    assert.deepEqual([...tokens.keys()].sort(), expected, `${theme} defines exactly the tokens of the list`);
    // Every colour token can be used wherever CSS expects a colour.
    for (const [name, value] of tokens) {
      if (name === '--river-opacity') {
        assert.ok(Number(value) > 0 && Number(value) <= 1, `${theme} --river-opacity is a number in (0, 1]`);
      } else if (value === 'transparent') {
        assert.ok(MAY_BE_NONE.has(name), `${theme} ${name} may not be "none"`);
      } else {
        rgba(value);
      }
    }
    // The panels sit on a colourful scene, so what they are painted with is opaque.
    for (const name of OPAQUE) assert.equal(rgba(tokens.get(name) ?? '')[3], 1, `${theme} ${name} is opaque`);
  }
  // shachang is the default: its rule also covers a page without the attribute.
  const first = THEME_RULES.find(rule => rule.selectors.includes(`[data-theme="${DEFAULT_THEME}"]`));
  assert.ok(first?.selectors.includes(':root'), ':root shares the default palette');
  assert.equal(THEME_RULES.filter(rule => rule.selectors.includes(':root')).length, 1, 'no other rule sets tokens on :root');
  // On <html data-theme="chibi"> both `:root` and `[data-theme="chibi"]` match with equal specificity,
  // so the other two palettes must come later in the file than the default one, or the default would win.
  const position = (/** @type {string} */ theme) => THEME_RULES.findIndex(rule => rule.selectors.includes(`[data-theme="${theme}"]`));
  assert.equal(position(DEFAULT_THEME), 0, 'the default palette is the first rule of the file');
  for (const theme of THEMES) {
    if (theme !== DEFAULT_THEME) assert.ok(position(theme) > position(DEFAULT_THEME), `${theme} comes after the default palette`);
    const rule = THEME_RULES[position(theme)];
    for (const selector of rule.selectors) {
      assert.ok(selector === (theme === DEFAULT_THEME ? ':root' : '') || selector === `[data-theme="${theme}"]`, `${theme}: "${selector}" keeps the palettes at one specificity`);
    }
  }
  // Each theme tells the browser which form controls and scrollbars to draw, and that matches its panels:
  // light paper gets `light`, dark panels get `dark`.
  for (const theme of THEMES) {
    const scheme = THEME_RULES[position(theme)].decls.get('color-scheme');
    const paper = luminance(tokensOf(theme).get('--surface') ?? '');
    assert.equal(scheme, paper > 0.5 ? 'light' : 'dark', `${theme}: color-scheme follows the panel colour`);
  }
  assert.equal(THEME_RULES[position(DEFAULT_THEME)].decls.get('color-scheme'), 'light', 'the default theme is the bright one');
  // No theme-coloured token lives outside the three palettes: tokens.css has no colours of its own.
  const shared = parseRules(read('styles/tokens.css')).filter(rule => rule.selectors.includes(':root'));
  for (const rule of shared) for (const name of rule.decls.keys()) assert.ok(!TOKENS.includes(name), `${name} is defined in themes.css only`);
});

test('contrast floors of 10.1', () => {
  /** @param {Map<string, string>} tokens @param {string} name */
  function get(tokens, name) {
    const value = tokens.get(name);
    assert.ok(value, `${name} is defined`);
    return value;
  }
  /** The weaker of the two ends of the field's gradient counts. */
  const onField = (/** @type {string} */ name) => (/** @type {Map<string, string>} */ t) =>
    Math.min(contrast(get(t, name), get(t, '--field-a')), contrast(get(t, name), get(t, '--field-b')));
  const pair = (/** @type {string} */ ink, /** @type {string} */ ground) => (/** @type {Map<string, string>} */ t) => contrast(get(t, ink), get(t, ground));

  /** [what, floor, how to compute it from a theme's tokens] */
  const CHECKS = /** @type {[string, number, (t:Map<string, string>) => number][]} */ ([
    // text on the panels
    ['body text on surfaces', 7, pair('--ink', '--surface')],
    ['body text on inset surfaces', 7, pair('--ink', '--surface-2')],
    ['secondary text', 4.5, pair('--ink-2', '--surface')],
    ['secondary text on inset surfaces', 4.5, pair('--ink-2', '--surface-2')],
    ['the accent as text', 4.5, pair('--accent-text', '--surface')],
    ['primary button label', 4.5, pair('--accent-ink', '--accent')],
    ['confirm button label', 4.5, pair('--jade-ink', '--jade')],
    ['secondary button label', 4.5, pair('--sky-ink', '--sky')],
    ['text on danger fills', 4.5, pair('--danger-ink', '--danger')],
    ['text and icons on wood', 4.5, pair('--wood-ink', '--wood')],
    // large text, icons and outlines
    ['danger as an icon on surfaces', 3, pair('--danger', '--surface')],
    ['the outline of a panel', 3, pair('--edge', '--surface')],
    // the small pictures of the board and the pieces
    ['grid lines on the field', 4, onField('--line')],
    ['red glyph on its disc', 4, pair('--red-glyph', '--red-b')],
    ['black glyph on its disc', 4, pair('--blk-glyph', '--blk-b')],
    // marks on the field
    ['--sel on the field', 3, onField('--sel')],
    ['--trial on the field', 3, onField('--trial')],
    ['--danger on the field', 3, onField('--danger')],
    ['--label on the field', 3, onField('--label')],
    ['--wei on the field', 3, onField('--wei')],
    ['--arrow-hint on the field', 3, onField('--arrow-hint')],
    ['--arrow-idea on the field', 3, onField('--arrow-idea')],
    ['--arrow-threat on the field', 3, onField('--arrow-threat')],
    ['--arrow-reply on the field', 3, onField('--arrow-reply')],
    // The camp red is a saturated red on warm sand in the default theme: hue carries it, the floor is lower.
    ['--shu on the field', 2.2, onField('--shu')],
  ]);

  // The formula itself, on the two fixed points of WCAG.
  assert.ok(Math.abs(contrast('#000000', '#ffffff') - 21) < 1e-9);
  assert.equal(contrast('#777777', '#777777'), 1);
  assert.ok(Math.abs(contrast('#fff', '#000') - 21) < 1e-9, 'short hex is read like long hex');

  for (const theme of THEMES) {
    const tokens = tokensOf(theme);
    for (const [what, floor, ratioOf] of CHECKS) {
      const ratio = ratioOf(tokens);
      assert.ok(ratio >= floor, `${theme}: ${what} is ${ratio.toFixed(2)}, floor ${floor}`);
    }
  }

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
    // the rounder corners, the outline width and the hard-shadow offset of the sand-table look
    '--gap': '4px', '--pad': '8px', '--r-btn': '16px', '--r-card': '22px', '--r-chip': '24px',
    '--ol': '3px', '--drop': '4px',
    '--z-art': '0', '--z-marks': '1', '--z-pieces': '2', '--z-over': '3', '--z-fx': '4', '--z-banner': '5', '--z-hit': '6',
    '--z-sheet': '20', '--z-dialog': '30', '--z-toast': '40',
  };
  assert.equal(Object.keys(expected).length, 33);
  assert.deepEqual(Object.fromEntries(root.decls), expected);
  // The hard shadow is at most 4 px and the outline is a few px: lengths only, the colour comes from the theme.
  assert.match(root.decls.get('--ol') ?? '', /^[1-4]px$/);
  assert.match(root.decls.get('--drop') ?? '', /^[1-4]px$/);
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
