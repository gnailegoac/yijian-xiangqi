# V2: the new look (the sand table), first cut

Written on 2026-11-12. `SPEC.md` and `CONTRACT-NOTES.md` stay the record of version 1 and are not edited; this file
records what the new look changed, what it deliberately left alone, and what is still open.

## Why

The owner tried the published version 1 and said the interface was not cool enough to attract children. Asked for a
direction, they chose the style "Q版三国卡通" and, from three mocks, concept C "沙盘点兵": every piece is a little
cartoon soldier holding a shield that carries its character, on a bright sand table, with cartoon figures of 诸葛亮
and 司马懿 and a camp scene behind. They then asked for it to land fast, so the first cut is a change of skin only.

## What the first cut is

The game itself is unchanged: rules, engine, rival, strategist, prompts, proxy, saves, the flow of a turn, the three
pouches, every Chinese line. The layout (regions, sizes, geometry of the board) is unchanged too. What changed is
what things look like, and where that look lives.

**The skin now has its own files.** A later change of look replaces these and touches no mechanics module:

| What | Files |
|---|---|
| The 14 soldiers | `src/ui/piece-art.js` (`pieceArt(color, type)`, `PIECE_BOX`), `styles/pieces.css`, `dev/pieces.html` |
| The table (frame, sand, grid, river, palaces, file numbers) | `src/ui/table-art.js` (`tableArt(theme, bottom, id)`), `styles/table.css`, `dev/table.html` |
| The camp scene behind everything | `src/ui/scene.js` (`createScene(host, opts)`), `styles/scene.css`, `dev/scene.html` |
| 诸葛亮 | the drawing inside `src/ui/buddy.js`, `styles/buddy.css` |
| 司马懿 | the drawing inside `src/ui/rival-view.js`, `styles/rival.css` (moved out of `buddy.css`), `dev/rival.html` |
| Furniture and palettes | `styles/themes.css`, `styles/tokens.css`, `styles/hud.css`, `styles/chat.css`, `styles/fx.css` |

`src/ui/board-view.js` keeps the box of a piece, its states, the motion and the marks; it asks the two art modules for
the drawings. The decoration layers of version 1 (river drift, ships, pennants, fire glow) are switched off.

**Rules of the look that the code now depends on**

- Nothing but pieces stands on the playing field. Palaces are a floor colour and their diagonals.
- A piece never hides the character of another piece. A soldier is taller than its square (box 1 c x 1.28 c, grid
  point at (50, 72) of a 100 x 128 box, nothing drawn above y = 12), so:
  - pieces are painted by row: `z-index: calc(10 + var(--vy))`; lifted 30, previews 40, moving 50, dragging 60;
  - the lifts of the selected, trial and aiming piece are smaller than in version 1 (at most `-.09 c`, scale 1.06);
  - `dev/pieces.html` checks all 196 ordered vertical pairs with the lower piece lifted and prints `PAIRS OK`.
- The character of a piece stays HTML text in `.piece__glyph`, one colour per side.
- Pieces, marks and effects are the same in the three themes; the table and the scene differ per theme.
- No bitmap, no web font, no `url(` in CSS, no `filter` on anything that moves; loops only under
  `html[data-motion="full"]` and never on a child inside an `<svg>`.

**Themes.** The three ids stay. `shachang` (沙场, the sunny day of the mock) is the default; `chibi` (赤壁) is the
same table at night; `longzhong` (隆中) is the calm bamboo version. Saved settings carry `look: 2`; a record saved
under the first look (no `look`) gets the default theme once and keeps everything else (`sanitizeSettings` in
`src/game/store.js`). `theme-color` in `index.html` and the two colours of the manifest are the page colour of the
default theme.

## Tests that changed, and why

A test that pinned a look value was rewritten as the guarantee the value protected; none was deleted.

- `tests/unit/game/store.test.js`: the default settings have `theme: 'shachang'` and `look: 2`; raw records in two
  checks got `look: 2` so that they still test what they tested; new checks for the one-time theme reset; the backup
  fixture (made under the first look) now imports with the default theme.
- `tests/unit/ui/layout.test.js`: the list of eight stylesheets became "tokens, themes, layout first; every file of
  `styles/` is linked exactly once"; the count of nine build references became "one module script and one reference
  per stylesheet"; the default theme on `<html>` is `shachang`; `theme-color` and the manifest colours must equal
  `--page` of the first rule of `themes.css`.
- `tests/unit/ui/themes.test.js`: the table of exact colours became "every theme defines the same set of token names,
  each a valid opaque colour"; "chibi is the default" became "shachang is rule 0 and the only one on `:root`";
  `color-scheme` follows the luminance of the panel colour; the stated contrast numbers were dropped and the floors
  kept, with new floors for the new tokens; `tokens.css` has 33 declarations (three radii changed, `--ol` and `--drop`
  are new).

## What was checked

- Type check (both configurations), the unit tests, the build, and the 30 end-to-end flows in the three projects
  (1180 x 820, 820 x 1180, 360 x 740; all with reduced motion).
- By eye in a desktop browser: a whole turn (select, trial, comment, confirm, the rival's reply), the three themes,
  the three sizes, the start screen.
- Not checked by anyone: a real iPad, Safari, sound by ear, full motion on a slow device.

## Known gaps of the first cut

- The file numbers are small (22 units; about 8 px on a 360 px phone): the rails of the old geometry leave no more
  room next to the heads of the back rank. The fix is a taller board (more margin above and below the grid).
- The layout is still the two columns of version 1. The mock's three columns (司马懿 as a large half figure on the
  left, the desk on the right) are not built.
- A move still uses the choreography and the sounds of version 1. The mock's reel (trail and dust on every move,
  slash and shards on a capture, the combo sticker, the cannon shot, the new banners) is not built.
- The soldiers do not move by themselves (no twinkle, no rolling wheels); 司马懿 has no "bow" face and his mouth does
  not move; 诸葛亮's far arm is still.
- The start screen is a plain poster, not the mock's.
- `--shu` on the sand is about 2.3 : 1 and the labels on the jade and sky keys are dark instead of the mock's white,
  both to keep the contrast floors.
