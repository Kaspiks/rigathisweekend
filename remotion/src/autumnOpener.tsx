// Shared by the autumn story openers (LeafGustStory, HarvestBagStory, PressedLeafStory): their props, the
// palette, the type, and the footer band each of them ends on. They take exactly what the ticket and the
// envelope take, so the render service and the grid page drive them the same way: the day's grid sheet
// (1080 x 1920 with the bottom BAR_H strip left clear) is revealed, and the band settles into that strip.
import '@fontsource/cormorant-garamond/500.css';
import '@fontsource/cormorant-garamond/600.css';
import '@fontsource/cormorant-garamond/700.css';
import '@fontsource/great-vibes/400.css';
import type { CSSProperties } from 'react';
import { continueRender, delayRender, Easing, Img, interpolate, staticFile } from 'remotion';

export type AutumnOpenerProps = { day: string; date: string; kicker: string; category: string; count: number; sheet: string; holdSeconds: number };
export const AUTUMN_FPS = 30;
export const BAR_H = 190; // the strip the grid leaves clear (BAR_H in src/grids.js)

// Fonts load lazily; every opener holds its first frame until the faces on the label are ready.
const fonts = delayRender('Loading autumn opener fonts');
Promise.all([
  document.fonts.load('700 150px "Cormorant Garamond"'),
  document.fonts.load('600 60px "Cormorant Garamond"'),
  document.fonts.load('500 36px "Cormorant Garamond"'),
  document.fonts.load('64px "Great Vibes"'),
]).then(() => continueRender(fonts));

// Harvest colours: a kraft and cream base, bark-brown ink, and the rust and amber of turned leaves.
export const A = {
  bark: '#2e1b10', barkSoft: '#5a3a24', rust: '#a8431c', amber: '#d98b2b', ochre: '#c9a227',
  kraft: '#c49a6c', kraftDark: '#a67c4f', cream: '#f4ead8', paper: '#efe3cc', soil: '#1c120b',
} as const;

export const serif = (size: number, weight = 600, extra: CSSProperties = {}): CSSProperties => ({
  fontFamily: '"Cormorant Garamond"', fontWeight: weight, fontSize: size, lineHeight: 1, color: A.bark,
  fontVariantNumeric: 'lining-nums', whiteSpace: 'nowrap', ...extra,
});
export const script = (size: number, color: string = A.rust): CSSProperties => ({ fontFamily: '"Great Vibes"', fontSize: size, lineHeight: 1, color, whiteSpace: 'nowrap' });
// Long words shrink to fit instead of running past the edge of whatever they are printed on.
export const fit = (text: string, max: number, budget: number) => Math.min(max, budget / Math.max(1, text.length));
// Paper grain, as a tiny tiled noise texture.
export const grain = (alpha = 0.1) => `url("data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 0.3  0 0 0 0 0.2  0 0 0 0 0.1  0 0 0 ${alpha} 0"/></filter><rect width="300" height="300" filter="url(#n)"/></svg>`)}")`;

export const range = (frame: number, [a, b]: readonly [number, number], easing = Easing.bezier(0.65, 0, 0.35, 1)) =>
  interpolate(frame, [a, b], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing });
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const sheetSrc = (sheet: string) => (/^https?:\/\//.test(sheet) ? sheet : staticFile(sheet));

// A maple leaf, drawn once: stem at the bottom centre, about 200 x 200 units.
export const MAPLE = 'M100,190 L100,158 C86,166 64,170 48,166 L60,146 C40,142 20,128 8,108 L34,104 C24,88 20,68 22,50 C38,60 52,64 62,62 L58,36 C72,46 84,52 92,56 C92,38 96,20 100,6 C104,20 108,38 108,56 C116,52 128,46 142,36 L138,62 C148,64 162,60 178,50 C180,68 176,88 166,104 L192,108 C180,128 160,142 140,146 L152,166 C136,170 114,166 100,158 Z';
export const MAPLE_VEINS = 'M100,158 L100,40 M100,120 L46,78 M100,120 L154,78 M100,140 L40,116 M100,140 L160,116';

// The footer band every opener ends on: the day, large, then the date and the category. `grow` runs 0 to 1
// as it arrives, so each opener can bring its own piece of paper into the strip and have it become this.
export const Band = ({ day, date, category, grow = 1, accent = A.rust }: { day: string; date: string; category: string; grow?: number; accent?: string }) => (
  <div style={{
    position: 'absolute', left: 0, right: 0, bottom: 0, height: BAR_H, background: `${grain(0.12)}, ${A.cream}`,
    borderTop: `6px solid ${accent}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '0 64px', transform: `translateY(${lerp(BAR_H + 10, 0, grow)}px)`, boxShadow: '0 -10px 30px rgba(0,0,0,0.25)',
  }}>
    <div style={{ opacity: range(grow, [0.45, 1]) }}>
      <div style={serif(fit(day, 64, 620), 700, { letterSpacing: '0.12em' })}>{day}</div>
      <div style={serif(30, 600, { letterSpacing: '0.2em', color: A.barkSoft, marginTop: 8 })}>{date} · {category.toUpperCase()}</div>
    </div>
    <svg width="96" height="96" viewBox="0 0 200 200" style={{ opacity: range(grow, [0.6, 1]), transform: 'rotate(-18deg)' }}>
      <path d={MAPLE} fill={accent} />
      <path d={MAPLE_VEINS} stroke={A.cream} strokeOpacity={0.55} strokeWidth={4} fill="none" strokeLinecap="round" />
    </svg>
  </div>
);

// Where each card sits in the grid sheet: the same layout as gridLayout in src/grids.js (keep them in step),
// so an opener can bring the cards in one at a time, each exactly where it is on the sheet.
export type Cell = { left: number; top: number; width: number; height: number };
const GRID_W = 1080, GUTTER = 12, CARDS_H = 1920 - BAR_H;
export const gridCells = (count: number): Cell[] => {
  const n = Math.max(1, Math.min(6, Math.round(count)));
  if (n === 2) {
    const h = Math.floor((CARDS_H - GUTTER) / 2);
    return [{ left: 0, top: 0, width: GRID_W, height: h }, { left: 0, top: h + GUTTER, width: GRID_W, height: CARDS_H - h - GUTTER }];
  }
  const rows = Math.ceil(n / 2), h = Math.floor((CARDS_H - GUTTER * (rows - 1)) / rows), w = (GRID_W - GUTTER) / 2;
  return Array.from({ length: n }, (_, i) => {
    const row = Math.floor(i / 2), last = i === n - 1 && n % 2 === 1;
    const top = row * (h + GUTTER), height = row === rows - 1 ? CARDS_H - top : h;
    return last ? { left: 0, top, width: GRID_W, height } : { left: (i % 2) * (w + GUTTER), top, width: w, height };
  });
};
// One card cut out of the sheet, drawn at its own position (the parent places it).
export const CardSlice = ({ sheet, cell }: { sheet: string; cell: Cell }) => (
  <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
    <Img src={sheetSrc(sheet)} style={{ position: 'absolute', left: -cell.left, top: -cell.top, width: 1080, height: 1920, maxWidth: 'none' }} />
  </div>
);
