// The player glyph, on YouTube's 24 px grid and in its 2-unit weight: a note
// (round head, straight stem, square flag), plain while the music plays; struck
// through while Musicless removes it, the strike a little above the diagonal so
// it clears the head, cutting a gap 1.2 units above it and 0.7 below, as
// Material's "off" icons do (CUT is the strike moved to the gap's centre, and
// CUT_WIDTH = 2 + 1.2 + 0.7); and a dot at the bottom right while Musicless
// waits for the user. button.js draws the player's control from it, and
// tools/icons.mjs the glyphs in the setup and popup text. Musicless's brand
// mark is separate artwork.
export const NOTE = [
  ["circle", { cx: 9.2, cy: 17.9, r: 4.2 }],
  ["rect", { x: 11.4, y: 1.9, width: 2, height: 16 }],
  ["rect", { x: 11.4, y: 1.9, width: 6.4, height: 4.4 }],
];
export const STRIKE = "M3.4 2.3 21.4 20.3";
export const CUT = "M3.58 2.12 21.58 20.12";
export const DOT = { cx: 19.6, cy: 19.6, r: 2.6 };
export const STRIKE_WIDTH = 2;
export const CUT_WIDTH = 3.9;
