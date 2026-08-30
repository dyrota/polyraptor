// Colorblind-safe categorical palette (Okabe-Ito hues, tuned brighter for
// this app's dark background) shared by every algorithm-state visualization
// -- maze cells, sort bars, and their legends -- so a given hue means the
// same kind of thing everywhere, and no two states shown together are
// indistinguishable under the most common forms of color blindness
// (deuteranopia/protanopia).
export const VIZ = {
  blue: '#58a6ff',
  sky: '#79c0ff',
  yellow: '#f0d264',
  green: '#3fb968',
  vermillion: '#e8703a',
  purple: '#d783b0',
} as const;

// Matches --brand in index.css -- kept here too since <canvas> can't read
// CSS custom properties without extra JS glue, not worth it at this app's
// size. Used sparingly on canvases, only for "this is the current step"
// cursors/rings -- a UI-chrome meaning, not an algorithm-state one, so it's
// deliberately outside the VIZ set above.
export const BRAND = '#e0972b';
