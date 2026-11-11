// Layout: one pure function decides every size; applyLayout writes them on #app (SPEC §12.2). Package X1.
//
// The stage (stage.js) calls computeLayout + applyLayout on `resize`, on visualViewport `resize` / `scroll`, on
// orientation change and when the conversation sheet opens or closes. styles/layout.css reads the custom
// properties written here; until the first applyLayout it uses equivalent CSS-only defaults (no inline style yet).

/** @import { LayoutMode } from './types.js' */

/**
 * @param {{ W:number, H:number, visibleH:number, sheet:boolean }} v
 *   W, H: window.innerWidth / innerHeight (layout viewport); visibleH: visualViewport.height (keyboard excluded)
 * @returns {{ layout:LayoutMode, c:number, boardW:number, boardH:number, top:number, bar:number, actions:number, pad:number, gap:number,
 *             panelW:number, coachH:number, buddyH:number, buddy:'full'|'bust', showChips:boolean, chipRows:number,
 *             stageScale:number, miniH:number, kb:boolean }}
 */
export function computeLayout(v) {
  /** @param {number} x */
  const f2 = (x) => Math.floor(x * 100) / 100;
  /** @param {number} lo @param {number} x @param {number} hi */
  const clamp = (lo, x, hi) => Math.max(lo, Math.min(hi, x));
  const kb = v.H - v.visibleH > 120;                       // on-screen keyboard is up
  const H = kb ? v.visibleH : v.H, W = v.W;
  const landscape = (W >= 900 && W / v.H >= 1.05) || (v.H < 480 && W > v.H);     // iPad landscape, desktop, landscape phone
  if (landscape) {
    const small = v.H < 480;
    const top = small ? 36 : 48, bar = small ? 48 : 64, pad = small ? 4 : 8, gap = small ? 8 : 16, minPanel = small ? 240 : 340;
    const c = f2(clamp(20, Math.min((W - minPanel - 3 * gap) / 9.2, (H - top - bar - 2 * pad) / 10.6), 84));
    const boardW = 9.2 * c, boardH = 10.6 * c;
    const panelW = Math.round(clamp(minPanel, W - boardW - 3 * gap, 480));
    const coachH = H - top - bar - 2 * pad;
    const buddyH = Math.round(clamp(96, coachH * 0.42, 300));
    return { layout: 'landscape', c, boardW, boardH, top, bar, actions: bar, pad, gap, panelW, coachH, buddyH, buddy: buddyH >= 160 ? 'full' : 'bust',
             showChips: true, chipRows: coachH - buddyH >= 220 ? 2 : 1, stageScale: 1, miniH: 0, kb };
  }
  if (W >= 600) {                                            // iPad portrait
    const top = 48, bar = 60, actions = 64, gaps = 20, coachMin = kb ? 96 : 176, gutter = 8;
    const c = f2(clamp(20, Math.min((W - 2 * gutter) / 9.2, (H - top - bar - actions - gaps - coachMin) / 10.6), 84));
    const boardW = 9.2 * c, boardH = 10.6 * c;
    const coachH = H - top - bar - actions - gaps - boardH;
    const buddyH = Math.round(clamp(72, coachH - 56, 200));
    return { layout: 'portrait', c, boardW, boardH, top, bar, actions, pad: gutter, gap: 8, panelW: 0, coachH, buddyH, buddy: 'bust',
             showChips: coachH >= 150, chipRows: 1, stageScale: 1, miniH: 0, kb };
  }
  const top = v.H < 600 ? 36 : 40, bar = 52, gaps = 12, coachMin = 88, gutter = 4;     // phone
  const c = f2(clamp(20, Math.min((W - 2 * gutter) / 9.2, (H - top - bar - gaps - coachMin) / 10.6), 56));
  const boardW = 9.2 * c, boardH = 10.6 * c, coachH = H - top - bar - gaps - boardH;
  const miniH = clamp(132, v.visibleH * 0.36, 260);
  return { layout: 'compact', c, boardW, boardH, top, bar, actions: 0, pad: gutter, gap: 4, panelW: 0, coachH, buddyH: 56, buddy: 'bust',
           showChips: coachH >= 124, chipRows: 1, stageScale: v.sheet ? miniH / boardH : 1, miniH, kb };
}

/**
 * A length in CSS px with at most two decimals (9.2 * 65.28 is 600.5759999999999 in floating point).
 * @param {number} n
 * @returns {string}
 */
function px(n) {
  return `${Math.round(n * 100) / 100}px`;
}

/**
 * Writes --c, --board-w, --board-h, --top, --bar, --actions, --panel-w, --buddy-h, --stage-scale, --mini-h, --app-h (= visibleH when kb)
 * and data-layout / data-kb on #app; with kb it also sets `top: visualViewport.offsetTop` on #app so Safari's scroll cannot push the board away.
 * @param {HTMLElement} app                             the #app element
 * @param {ReturnType<typeof computeLayout>} result
 * @param {VisualViewport|null} visualViewport          window.visualViewport
 * @returns {void}
 */
export function applyLayout(app, result, visualViewport) {
  const style = app.style;
  style.setProperty('--c', px(result.c));
  style.setProperty('--board-w', px(result.boardW));
  style.setProperty('--board-h', px(result.boardH));
  style.setProperty('--top', px(result.top));
  style.setProperty('--bar', px(result.bar));
  style.setProperty('--actions', px(result.actions));
  style.setProperty('--panel-w', px(result.panelW));
  style.setProperty('--buddy-h', px(result.buddyH));
  style.setProperty('--stage-scale', String(Math.round(result.stageScale * 10000) / 10000));
  style.setProperty('--mini-h', px(result.miniH));
  if (result.kb && visualViewport) {
    // Keyboard up: the app shrinks to the visible viewport and follows it when the browser scrolls the page under it.
    style.setProperty('--app-h', px(visualViewport.height));
    style.top = px(visualViewport.offsetTop);
  } else {
    style.removeProperty('--app-h');
    style.top = '';
  }
  app.dataset.layout = result.layout;
  app.dataset.kb = result.kb ? '1' : '0';
}
