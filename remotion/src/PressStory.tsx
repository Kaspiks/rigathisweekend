// Single-event hero story: the design is not revealed, it is PRINTED. A hinged heat press swings down
// onto blank linen, steam bursts from the closing gap, it holds, and when it swings back up the ink is
// there. The event's own workshop is thermopress printing, so the story is the thing the event does.
// No photography: every mark is drawn, which is the point — riga.lv ships no usable image for this one.
//
// The press is hinged rather than descending flat, and that is a staging decision, not a styling one:
// a flat plate large enough to cover the design is also large enough to black out the whole frame on
// its way in AND on its way out. Hinging it keeps cloth on screen throughout, and it means the lift
// uncovers the print from the bottom up instead of all at once.
import '@fontsource/cormorant-garamond/500.css';
import '@fontsource/cormorant-garamond/600.css';
import '@fontsource/cormorant-garamond/700.css';
import '@fontsource/great-vibes/400.css';
import type { CSSProperties } from 'react';
import { AbsoluteFill, Audio, Easing, Img, Sequence, continueRender, delayRender, interpolate, staticFile, useCurrentFrame } from 'remotion';
import { Burst, type BurstKind } from './bursts';

const fonts = delayRender('Loading press fonts');
Promise.all([
  document.fonts.load('700 140px "Cormorant Garamond"'),
  document.fonts.load('600 52px "Cormorant Garamond"'),
  document.fonts.load('500 28px "Cormorant Garamond"'),
  document.fonts.load('100px "Great Vibes"'),
]).then(() => continueRender(fonts));

export type PressStoryProps = { title: string; kicker: string; day: string; date: string; time: string; venue: string; price: string; holdSeconds: number; burst: BurstKind };

export const PRESS_FPS = 30;
const T = {
  swing:  [0, 20],    // the press comes down on its hinge, gathering speed
  press:  [20, 38],   // held shut. Steam curls and nothing else happens, which is the tension
  lift:   [38, 64],   // it swings back up and the ink is already there
  bloom:  [42, 76],   // the heat leaving the cloth
  burn:   [56, 96],   // the ash-brown pass catches quickly, then settles as the plate clears
  away:   [70, 84],   // the machine clears the frame only once it is edge-on, never over the print
} as const;
const BURN_LEN = 96 - 26;  // T.burn's span; the fire envelope is written against it

// Frames of silence before the transient in public/audio.wav, measured from the file itself.
const STAMP_LEAD = 20;
const STAMP_IN = Math.max(0, 20 - STAMP_LEAD);  // T.swing[1] is 20; kept literal so T can stay const

export const PRESS_OPEN_FRAMES = T.away[1] + 6;  // the burn deliberately runs past this, into the hold
export const pressDuration = (holdSeconds: number) => PRESS_OPEN_FRAMES + Math.round(Math.max(1, holdSeconds) * PRESS_FPS);

const INK = '#51342c', LIME = '#8fb02e', SCORCH = '#3f3732', LINEN = '#efe7d5', DEEP = '#0f241e';
const serif = (size: number, weight = 600, extra: CSSProperties = {}): CSSProperties => ({ fontFamily: '"Cormorant Garamond"', fontWeight: weight, fontSize: size, lineHeight: 1, color: INK, fontVariantNumeric: 'lining-nums', whiteSpace: 'nowrap', ...extra });
const fit = (text: string, max: number, budget: number) => Math.min(max, budget / Math.max(1, text.length));

const TEX = 900;
const tex = (freq: number, oct: number, seed: number, m: string) =>
  `url("data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${TEX}" height="${TEX}"><filter id="f"><feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="${oct}" seed="${seed}"/><feColorMatrix values="${m}"/></filter><rect width="${TEX}" height="${TEX}" filter="url(#f)"/></svg>`)}")`;

// Linen: a loose weave plus two grades of fibre noise. The weave on its own looks like graph paper.
const WEAVE = 'repeating-linear-gradient(0deg, rgba(120,102,70,0.08) 0 1px, transparent 1px 4px), repeating-linear-gradient(90deg, rgba(120,102,70,0.065) 0 1px, transparent 1px 4px)';
const FIBRE = tex(0.75, 3, 5, '0 0 0 0 0.45  0 0 0 0 0.38  0 0 0 0 0.24  0 0 0 0.18 0');
const SLUB = tex(0.02, 3, 12, '0 0 0 0 0.42  0 0 0 0 0.34  0 0 0 0 0.21  0 0 0 0.2 -0.08');
const CLOTH = `${WEAVE}, ${FIBRE}, ${SLUB}, linear-gradient(168deg, #f6f0e2 0%, ${LINEN} 52%, #e2d8c2 100%)`;
const VIGNETTE = 'radial-gradient(90% 62% at 50% 46%, transparent 46%, rgba(70,52,26,0.26) 100%)';

// The cloth never changes across the whole video, yet as live CSS it measured ~34ms a frame: two
// feTurbulence filters re-rasterised 240 times to produce identical pixels. Baked to a PNG it is
// decoded once. Re-bake after touching WEAVE, FIBRE, SLUB or the gradient:
//   npx remotion still src/index.ts ClothPlate public/cloth.png
// This composition exists only to produce that file.
export const ClothPlate = () => (
  <AbsoluteFill>
    <AbsoluteFill style={{ background: CLOTH }} />
    <AbsoluteFill style={{ background: VIGNETTE }} />
  </AbsoluteFill>
);

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// Declared before the mask tables below, which are built at module load: a const declared later is
// still in its temporal dead zone at that point.

// Ink on cloth is never solid: the weave takes it unevenly and the high spots stay bare. The offset in
// the alpha row is a threshold on that noise - raise it and more of the mask opens. Held high it is
// ink sitting in the weave; swept upwards it is a scorch spreading, the mark appearing in patches
// where the cloth takes the heat first. Fading opacity alone reads as a dissolve; a burn has to
// arrive unevenly to read as a burn.
//
// The steps are PRECOMPUTED. Building the URI from a continuous `p` makes every frame a new URL, so
// the browser re-runs a 900x900 feTurbulence from scratch each time instead of reusing a decoded
// image. Fourteen steps over a hundred frames is invisible against noise this organic, and the
// opacity ramp underneath stays continuous so nothing pops.
const BURN_STEPS = 14;
const FINE = tex(0.55, 4, 31, '0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 -7 4.7');
const BURN = Array.from({ length: BURN_STEPS + 1 }, (_, i) =>
  tex(0.05, 3, 17, `0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 -3.2 ${lerp(0.15, 2.8, i / BURN_STEPS).toFixed(2)}`));
// No blur here: a 0.35px blur on a full-screen layer forced a separate render surface over two
// million pixels and measured 17ms a frame, for an effect below one pixel.
const inkedAt = (p: number): CSSProperties => ({
  WebkitMaskImage: `${FINE}, ${BURN[Math.round(Math.max(0, Math.min(1, p)) * BURN_STEPS)]}`,
  WebkitMaskComposite: 'source-in', maskComposite: 'intersect',
});
const inked: CSSProperties = inkedAt(1);

// The noise threshold alone chars everywhere at once, just patchily. A burn you can follow needs a
// FRONT: a disc that grows out from where the plate bit hardest, intersected with that noise so the
// edge stays ragged rather than reading as a circle.
//
// The radii are in PIXELS, not percent. On a full-screen mask a percentage resolves against the
// farthest corner (~1240px here), so 1% is 12px and the front crosses the whole poster in the first
// quarter of the burn. The accent artwork sits within ~500px of the centre, so that is the distance
// the front actually has to travel.
const FRONT_R = 620;
const spreadMask = (p: number) => {
  const r = p * FRONT_R;
  return `radial-gradient(circle at 50% 58%, #000 0px, #000 ${r.toFixed(0)}px, transparent ${(r + 110).toFixed(0)}px)`;
};
// The same front as a ring, for the ember edge riding just ahead of the ash.
const ringMask = (p: number) => {
  const r = p * FRONT_R;
  return `radial-gradient(circle at 50% 58%, transparent 0px, transparent ${Math.max(0, r - 78).toFixed(0)}px, #000 ${Math.max(0, r - 26).toFixed(0)}px, #000 ${(r + 16).toFixed(0)}px, transparent ${(r + 104).toFixed(0)}px)`;
};
const charredAt = (noise: number, front: number): CSSProperties => ({
  WebkitMaskImage: `${spreadMask(front)}, ${FINE}, ${BURN[Math.round(Math.max(0, Math.min(1, noise)) * BURN_STEPS)]}`,
  WebkitMaskComposite: 'source-in', maskComposite: 'intersect',
});
// Cracks, not blobs. Thresholding noise with a colour matrix gives you REGIONS; a narrow spike in a
// feComponentTransfer table gives you the CONTOUR of the noise field instead - a thin winding line
// where the value crosses one level, which is exactly what a crack is. The inverse table is the same
// line punched out, so the ash can be cut by the very cracks the ember glows through.
const crackTex = (invert: boolean) =>
  `url("data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${TEX}" height="${TEX}"><filter id="c"><feTurbulence type="fractalNoise" baseFrequency="0.016" numOctaves="2" seed="43"/><feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  1 0 0 0 0"/><feComponentTransfer><feFuncA type="table" tableValues="${invert ? '1 1 1 1 0 1 1 1 1' : '0 0 0 0 1 0 0 0 0'}"/></feComponentTransfer></filter><rect width="${TEX}" height="${TEX}" filter="url(#c)"/></svg>`)}")`;
const CRACK_OUT = crackTex(true);   // everything except the crack lines

// The hot interior: the whole charred region, with nothing cut out of it. It only becomes visible
// where the ash above is broken, which is what makes it read as coal rather than as an outline.
const emberAt = (front: number): CSSProperties => ({
  WebkitMaskImage: `${spreadMask(front)}, ${FINE}`,
  WebkitMaskComposite: 'source-in', maskComposite: 'intersect',
});
// The ash crust, cut by the cracks so the ember shows through the fissures.
const crustAt = (noise: number, front: number): CSSProperties => ({
  WebkitMaskImage: `${spreadMask(front)}, ${CRACK_OUT}, ${FINE}, ${BURN[Math.round(Math.max(0, Math.min(1, noise)) * BURN_STEPS)]}`,
  WebkitMaskComposite: 'source-in', maskComposite: 'intersect',
});
const frontAt = (front: number): CSSProperties => ({
  WebkitMaskImage: `${ringMask(front)}, ${FINE}`,
  WebkitMaskComposite: 'source-in', maskComposite: 'intersect',
});

const PX = 90, PW = 900, HINGE = 132, PH = 1490;  // the upper platen, hinged along its top edge
const DX = 150, DY = 330, DW = 780, DH = 1230;    // the printable area

const range = (frame: number, [a, b]: readonly [number, number], easing = Easing.bezier(0.65, 0, 0.35, 1)) =>
  interpolate(frame, [a, b], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing });

// A damped oscillation, hand-tuned rather than a spring: the press is heavy and the table is not, so
// the frame should snap once and be still again inside half a second.
const shakeAt = (t: number) => {
  if (t < 0 || t > 16) return { x: 0, y: 0, r: 0 };
  const d = Math.exp(-t * 0.33);
  return { x: Math.sin(t * 2.15) * 16 * d, y: Math.cos(t * 1.72) * 24 * d, r: Math.sin(t * 1.94) * 0.55 * d };
};

// The angry rye bun: the workshop's own motif. One ink colour with the face knocked out of it, the way
// a one-colour print works — the features are bare cloth, not a second pass of a lighter ink.
// The slice is authored in its own coordinate space, so the viewBox is its bounding box rather than a
// square. One BOX drives the viewBox, the mask region AND the inked rect: those three have to agree,
// and when they are written out by hand they drift and silently clip the artwork off the canvas.
const BOX = { x: 230, y: 278, w: 546, h: 296 };
// A slice off a round loaf halved lengthways: one straight cut across the bottom, and a broad low dome
// over it. Close to a half ellipse, but with the crown flattened by a short middle segment - a pure
// half ellipse peaks too sharply, and leaving the flanks vertical for any distance reads as an arch.
const SLICE = 'M243,560 C243,410 330,292 445,288 C484,286 522,286 561,288 C676,292 763,410 763,560 Z';
// The crust, drawn as a line knocked out of the ink a little inside the curved edge. A one-colour print
// cannot shade a band, so the boundary is the mark - which is how a woodcut would do it too.
const CRUST = 'M276,560 C276,418 352,324 452,320 C486,318 520,318 554,320 C654,324 730,418 730,560';

// `size` is the WIDTH; the height follows the box, because a slice is not square.
const Slice = ({ size }: { size: number }) => (
  <svg width={size} height={(size * BOX.h) / BOX.w} viewBox={`${BOX.x} ${BOX.y} ${BOX.w} ${BOX.h}`}>
    <defs>
      <mask id="slice" maskUnits="userSpaceOnUse" x={BOX.x} y={BOX.y} width={BOX.w} height={BOX.h}>
        <path d={SLICE} fill="#fff" />
        <path d={CRUST} fill="none" stroke="#000" strokeWidth="7" strokeLinecap="round" opacity="0.9" />
        {/* brows angled down towards the middle, which is the whole trick to an angry face */}
        <path d="M406,395 L468,419" stroke="#000" strokeWidth="21" strokeLinecap="round" />
        <path d="M600,395 L538,419" stroke="#000" strokeWidth="21" strokeLinecap="round" />
        <ellipse cx="438" cy="458" rx="16" ry="19" fill="#000" />
        <ellipse cx="568" cy="458" rx="16" ry="19" fill="#000" />
        {/* a scowl, turned down hard at the ends */}
        <path d="M442,506 C470,484 536,484 564,506" stroke="#000" strokeWidth="16" fill="none" strokeLinecap="round" />
        {/* open crumb. Deliberately not mirrored - pores are not symmetric */}
        <circle cx="325" cy="448" r="9" fill="#000" opacity="0.85" />
        <circle cx="356" cy="512" r="6" fill="#000" opacity="0.7" />
        <circle cx="305" cy="538" r="5" fill="#000" opacity="0.6" />
        <circle cx="678" cy="452" r="8" fill="#000" opacity="0.8" />
        <circle cx="706" cy="512" r="6" fill="#000" opacity="0.7" />
        <circle cx="648" cy="542" r="4" fill="#000" opacity="0.6" />
        <circle cx="500" cy="548" r="5" fill="#000" opacity="0.65" />
      </mask>
    </defs>
    <rect x={BOX.x} y={BOX.y} width={BOX.w} height={BOX.h} fill={INK} mask="url(#slice)" />
  </svg>
);
// Both colour passes come from ONE layout: the pass that is not being drawn is still laid out, just
// hidden. That is what guarantees the two screens register with each other — position them separately
// and any later edit to the dark pass silently shifts the scorch pass one off the marks.
const Design = ({ pass, accent = SCORCH, accentText = LINEN, script, textHalo, lift, liftAt = -1, glow = 0, glowRgb = '143,176,46', title, kicker, day, date, time, venue, price }: Pick<PressStoryProps, 'title' | 'kicker' | 'day' | 'date' | 'time' | 'venue' | 'price'> & { pass: 'ink' | 'accent' | 'price'; accent?: string; accentText?: string; script?: string; textHalo?: string; lift?: CSSProperties; liftAt?: number; glow?: number; glowRgb?: string }) => {
  const on = (p: 'ink' | 'accent'): CSSProperties => ({ visibility: pass === p ? 'visible' : 'hidden' });
  const hotGlow = glow > 0 ? `0 0 ${Math.round(8 + glow * 22)}px rgba(${glowRgb},${(glow * 0.55).toFixed(2)})` : 'none';
  // Great Vibes is a thin script, so the ink and crack masks punch holes straight through its strokes
  // and it reads washed out. Raising the layer's opacity cannot help - it is already 1, and the gaps
  // are missing ink, not transparency. A tight shadow in the stroke's own colour fills them back in,
  // which is what actually raises the density on the page.
  const scriptInk = script || accent;
  const scriptShadow = [`0 0 2px ${scriptInk}`, `0 0 4px ${scriptInk}`, hotGlow !== 'none' ? hotGlow : ''].filter(Boolean).join(', ');
  return (
    <div style={{ position: 'absolute', left: DX, top: DY, width: DW, height: DH, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'absolute', inset: -46, border: `4px solid ${INK}`, borderRadius: 20, ...on('ink') }} />
      <div style={{ position: 'absolute', inset: -32, border: `2px solid ${INK}`, opacity: 0.65, borderRadius: 12, ...on('ink') }} />
      <div style={serif(30, 600, { letterSpacing: '0.36em', marginRight: '-0.36em', ...on('ink') })}>RĪGA · THIS WEEKEND</div>
      <div style={{ marginTop: 26, ...on('ink') }}><Slice size={560} /></div>
      <div style={serif(fit(title, 150, 1250), 700, { marginTop: 8, letterSpacing: '0.05em', marginRight: '-0.05em', ...on('ink') })}>{title}</div>
      <div style={{ fontFamily: '"Great Vibes"', fontSize: 100, lineHeight: 1, color: scriptInk, textShadow: scriptShadow, whiteSpace: 'nowrap', marginTop: 26, ...on('accent') }}>{kicker}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 22, marginTop: 34 }}>
        <span style={{ width: 120, height: 3, background: INK, ...on('ink') }} />
        <span style={{ width: 17, height: 17, transform: 'rotate(45deg)', background: accent, boxShadow: hotGlow, ...on('accent') }} />
        <span style={{ width: 120, height: 3, background: INK, ...on('ink') }} />
      </div>
      <div style={serif(52, 600, { marginTop: 34, letterSpacing: '0.16em', marginRight: '-0.16em', ...on('ink') })}>{day} · {date}</div>
      <div style={serif(46, 500, { marginTop: 22, letterSpacing: '0.12em', marginRight: '-0.12em', ...on('ink') })}>{time}</div>
      <div style={serif(fit(venue, 28, 760), 500, { marginTop: 26, letterSpacing: '0.2em', marginRight: '-0.2em', opacity: 0.98, ...on('ink') })}>{venue}</div>
      <div style={{ marginTop: 40, background: pass === 'price' ? 'transparent' : accent, boxShadow: pass === 'price' ? 'none' : hotGlow, padding: '15px 48px', borderRadius: 40, ...serif(42, 700, { color: accentText, letterSpacing: '0.3em', marginRight: '-0.3em', textShadow: textHalo || 'none' }), visibility: pass === 'accent' || pass === 'price' ? 'visible' : 'hidden' }}>
        {lift ? price.split('').map((ch, i) => <span key={i} style={i === liftAt ? lift : undefined}>{ch}</span>) : price}
      </div>
    </div>
  );
};

// Flecks emitted by the accent artwork while it chars. They are seeded once so Remotion produces the
// same burn on every render, and confined to the script, diamond and price stamp rather than sprayed
// across the whole poster like the impact burst.
type BurnFleck = { x: number; y: number; a: number; b: number; c: number; d: number };
const burnFlecks = (n: number, seed: number, x: number, y: number, w: number, h: number): BurnFleck[] => {
  let s = seed;
  const random = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  return Array.from({ length: n }, () => ({ x: x + random() * w, y: y + random() * h, a: random(), b: random(), c: random(), d: random() }));
};
const BURN_FLECKS = [
  ...burnFlecks(42, 147, 245, 958, 590, 130),
  ...burnFlecks(8, 263, 510, 1092, 60, 60),
  ...burnFlecks(24, 389, 400, 1370, 280, 105),
];

const BurnParticles = ({ progress }: { progress: number }) => (
  <>
    {BURN_FLECKS.map((p, i) => {
      const trigger = 0.03 + p.a * 0.76;
      const life = 0.14 + p.b * 0.2;
      const k = (progress - trigger) / life;
      if (k <= 0 || k >= 1) return null;
      const ember = p.c > 0.24;
      const size = ember ? 2 + p.d * 5 : 3 + p.d * 4;
      const driftX = (p.b - 0.5) * 54 * k;
      const driftY = ember ? -(22 + p.c * 72) * k : (10 + p.c * 28) * k;
      const fade = Math.sin(Math.PI * k) * Math.min(1, (1 - progress) * 9);
      const color = ember ? (p.c > 0.7 ? '#ffd18a' : '#923b0f') : SCORCH;
      return (
        <span key={i} style={{
          position: 'absolute', left: p.x + driftX, top: p.y + driftY,
          width: size, height: ember ? size : size * 0.55, borderRadius: ember ? '50%' : 1,
          background: color,
          boxShadow: ember ? `0 0 ${Math.round(size * 3.5)}px rgba(238,102,42,0.85)` : 'none',
          transform: `rotate(${(p.a * 240 + k * 170).toFixed(1)}deg) scale(${(1 - k * 0.45).toFixed(2)})`,
          opacity: fade,
        }} />
      );
    })}
  </>
);

const Platen = () => (
  <div style={{ position: 'absolute', left: PX, top: HINGE, width: PW, height: PH, borderRadius: '10px 10px 26px 26px', background: 'linear-gradient(178deg, #454c4a 0%, #262c2b 26%, #15191a 100%)', overflow: 'hidden', backfaceVisibility: 'hidden' }}>
    <div style={{ position: 'absolute', inset: 0, borderRadius: '10px 10px 26px 26px', boxShadow: 'inset 0 4px 0 rgba(255,255,255,0.2), inset 0 -5px 0 rgba(0,0,0,0.65), inset 0 0 90px rgba(0,0,0,0.5)' }} />
    {/* the heating element, just visible through the plate */}
    <div style={{ position: 'absolute', inset: '40px 44px 52px', borderRadius: 14, background: 'repeating-linear-gradient(0deg, rgba(190,72,38,0.2) 0 3px, transparent 3px 52px)', border: '1px solid rgba(255,255,255,0.06)' }} />
    <div style={{ position: 'absolute', inset: '40px 44px 52px', borderRadius: 14, background: 'radial-gradient(64% 44% at 50% 40%, rgba(255,150,90,0.12) 0%, transparent 72%)' }} />
    {[[26, PH - 40], [PW - 42, PH - 40]].map(([x, y], i) => (
      <div key={i} style={{ position: 'absolute', left: x, top: y, width: 16, height: 16, borderRadius: 8, background: 'linear-gradient(160deg,#737b79,#1f2423)' }} />
    ))}
  </div>
);

export const PressStory = ({ title, kicker, day, date, time, venue, price, holdSeconds: _hold, burst }: PressStoryProps) => {
  const frame = useCurrentFrame();

  const swing = range(frame, T.swing, Easing.bezier(0.5, 0, 0.75, 0.2)); // accelerates all the way into the hit
  const lift = range(frame, T.lift, Easing.bezier(0.25, 0, 0.35, 1));
  const bloom = range(frame, T.bloom);
  const away = range(frame, T.away);
  // Heat catches promptly, then eases into the last flecks of the cloth texture.
  const burn = range(frame, T.burn, Easing.bezier(0.2, 0.82, 0.3, 1));
  // The fresh lime print flashes through first; the darker pass follows and chars it away unevenly.
  const char = Math.max(0, Math.min(1, (burn - 0.28) / 0.72));
  const heat = Math.sin(Math.PI * Math.min(1, burn * 1.35)) * (1 - char * 0.72);
  const hotOpacity = Math.min(1, burn * 3.2) * (1 - char);
  // Coal does not glow steadily, it breathes - and it has to keep breathing through the hold, so the
  // pulse runs off the raw frame rather than off `char`, which is finished by then. Two sines at rates
  // that never line up read as alive; a single sine reads as a loop.
  const pulse = 0.5 + 0.5 * (Math.sin(frame * 0.085) * 0.62 + Math.sin(frame * 0.037 + 1.7) * 0.38);
  const emberEnv = Math.sin(Math.PI * Math.min(1, char * 1.15));
  const emberOpacity = Math.min(1, 0.07 + 0.1 * pulse + emberEnv * 0.78);
  // Amber rather than linen: white letters on coal read as paper, not as heat coming through it.
  // Coal cools. The breath keeps going, but its whole range slides from amber down towards a dark
  // red across the hold, so the card settles warm-dark instead of staying at flashpoint.
  const cool = range(frame, [T.burn[1], T.burn[1] + 104], Easing.bezier(0.4, 0, 0.6, 1));
  const cooled = (hotLo: number[], hotHi: number[], coldLo: number[], coldHi: number[]) => {
    const c = (i: number) => Math.round(lerp(lerp(hotLo[i], hotHi[i], pulse), lerp(coldLo[i], coldHi[i], pulse), cool));
    return [c(0), c(1), c(2)];
  };
  const scriptRgb = cooled([214, 136, 66], [253, 188, 112], [62, 55, 14], [144, 38, 22]);
  const scriptText = `rgb(${scriptRgb[0]},${scriptRgb[1]},${scriptRgb[2]})`;
  const textRgb = cooled([214, 136, 66], [253, 188, 112], [228, 134, 72], [255, 184, 114]);
  const emberText = `rgb(${textRgb[0]},${textRgb[1]},${textRgb[2]})`;
  const bedRgb = cooled([214, 92, 18], [255, 122, 24], [46, 14, 7], [82, 26, 12]);
  const emberBed = `rgb(${bedRgb[0]},${bedRgb[1]},${bedRgb[2]})`;
  // The ash itself goes from warm grey-brown to near black, so the crust darkens with the fissures
  // rather than staying a lighter colour than the coal it is supposed to be made of.
  const crustRgb = [Math.round(lerp(63, 21, cool)), Math.round(lerp(55, 16, cool)), Math.round(lerp(50, 14, cool))];
  const crustColor = `rgb(${crustRgb[0]},${crustRgb[1]},${crustRgb[2]})`;
  const glowRgb = `${textRgb[0]},${Math.round(textRgb[1] * 0.86)},${Math.round(textRgb[2] * 0.7)}`;
  // FREE sits on the noisiest part of the poster: ash speckle with cracks glowing through it. Against
  // a background that is busy rather than uniformly dark, brightness alone does not separate text -
  // some of what is behind it is already bright. A hard dark edge does, because nothing in the crust
  // is that dark. The first shadow is the letter's own colour closing the speckle inside the strokes;
  // the other two are the edge that lifts it off whatever happens to be behind.
  const badgeHalo = `0 0 2px ${emberText}, 0 0 3px rgba(10,5,2,0.99), 0 0 6px rgba(10,5,2,0.97), 0 0 13px rgba(10,5,2,0.9), 0 1px 3px rgba(10,5,2,0.99)`;
  // The third character of FREE lands under a pale crack and reads a step weaker than its neighbours.
  // A brighter fill plus a heavier dark edge on that one letter evens the word out; index rather than
  // the letter itself, so it stays tied to the position in the layout and not to the word's spelling.
  const liftText = `rgb(${Math.min(255, textRgb[0] + 16)},${Math.min(255, textRgb[1] + 36)},${Math.min(255, textRgb[2] + 32)})`;
  const badgeLift: CSSProperties = { color: liftText, textShadow: `0 0 3px ${liftText}, 0 0 11px rgba(8,4,2,0.96), 0 1px 3px rgba(8,4,2,0.98)` };
  const shut = frame >= T.swing[1];
  const sh = shakeAt(frame - T.swing[1]);

  // One angle drives the whole machine. 82 degrees open is nearly edge-on, so the cloth underneath is
  // never hidden and the story has something to look at from the first frame.
  const angle = shut ? lerp(0, -82, lift) : lerp(-82, 0, swing);
  const closed = 1 - Math.abs(angle) / 82; // 0 wide open, 1 shut: drives the shadow and the light

  return (
    <AbsoluteFill style={{ background: DEEP, overflow: 'hidden' }}>
      {}
      {}
      <Sequence from={STAMP_IN} name="stamp">
        <Audio src={staticFile('audio.wav')} trimBefore={STAMP_LEAD - (T.swing[1] - STAMP_IN)} volume={1} />
      </Sequence>
      <Sequence from={T.burn[0]} name="burn">
        {/* The room-fire bed is a loop with no shape of its own, so the envelope has to come from here.
            It is written against the LENGTH OF THE BURN rather than fixed frame numbers, so retiming
            T.burn drags the sound with it and the two cannot drift apart. It catches fast, holds while
            the ash travels, then trails about a second past the last of the char - embers outlast the
            flame, but not by the four seconds a flat fade-to-composition-end would give. */}
        <Audio
          src={staticFile('burn.wav')}
          volume={(f) => interpolate(f, [0, 8, BURN_LEN, BURN_LEN + 34], [0, 0.5, 0.32, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })}
        />
      </Sequence>
      <AbsoluteFill style={{ transform: `translate(${sh.x.toFixed(2)}px, ${sh.y.toFixed(2)}px) rotate(${sh.r.toFixed(3)}deg) scale(1.05)` }}>
        <Img src={staticFile('cloth.png')} style={{ width: 1080, height: 1920, objectFit: 'cover' }} />

        {/* The plate's footprint, scorched a shade darker into the cloth. It stays after the lift. */}
        {shut && <div style={{ position: 'absolute', left: PX, top: HINGE, width: PW, height: PH, borderRadius: 26, background: 'rgba(124,98,54,0.12)', boxShadow: 'inset 0 0 48px rgba(124,98,54,0.2)' }} />}

        {/* Both passes exist from the moment of the hit, hidden under the plate until it swings up. */}
        {shut && (
          <AbsoluteFill style={inked}>
            <Design pass="ink" title={title} kicker={kicker} day={day} date={date} time={time} venue={venue} price={price} />
          </AbsoluteFill>
        )}
        {shut && hotOpacity > 0 && (
          <AbsoluteFill style={{ ...inkedAt(burn), opacity: hotOpacity }}>
            <Design pass="accent" accent={LIME} accentText={INK} glow={heat} title={title} kicker={kicker} day={day} date={date} time={time} venue={venue} price={price} />
          </AbsoluteFill>
        )}
        {shut && char > 0 && (
          // The ember bed, drawn FIRST so the crust lands on top of it. Hottest just after the ink
          // catches, cooling to a residual glow so the settled card still smoulders faintly.
          <AbsoluteFill style={{ ...emberAt(char), opacity: emberOpacity }}>
            <Design pass="accent" accent={emberBed} accentText="#ffd08a" title={title} kicker={kicker} day={day} date={date} time={time} venue={venue} price={price} />
          </AbsoluteFill>
        )}
        {shut && char > 0 && (
          // The ash crust over it, broken by the cracks. Perfect registration makes the ash look as
          // though it is consuming the hot lime in place, and the spreading front makes that travel.
          <AbsoluteFill style={{ ...crustAt(char, char), opacity: Math.min(1, char * 3) }}>
            <Design pass="accent" accent={crustColor} accentText={emberText} script={scriptText} textHalo={badgeHalo} lift={badgeLift} liftAt={2} glow={char * (0.28 + 0.5 * pulse) * (1 - cool * 0.85)} glowRgb={glowRgb} title={title} kicker={kicker} day={day} date={date} time={time} venue={venue} price={price} />
          </AbsoluteFill>
        )}
        {shut && char > 0 && (
          // The cracks break the crust, and until now they broke the badge LETTERS with it - whichever
          // letter sat on a fissure was cut away and you saw the fissure through it, which no amount of
          // extra brightness could fix because the ink simply was not there. The letters are re-laid
          // here over the cracked pill, masked by the ink texture only: crust stays broken, word stays
          // whole. A 'price' pass draws the letters with no pill behind them.
          <AbsoluteFill style={{ ...emberAt(char), opacity: Math.min(1, char * 3) }}>
            <Design pass="price" accentText={emberText} textHalo={badgeHalo} lift={badgeLift} liftAt={2} title={title} kicker={kicker} day={day} date={date} time={time} venue={venue} price={price} />
          </AbsoluteFill>
        )}
        {shut && char > 0 && char < 1 && <BurnParticles progress={char} />}

        {/* Heat coming back out of the cloth once the plate is off it. */}
        {bloom > 0 && bloom < 1 && (
          <div style={{ position: 'absolute', left: PX, top: HINGE, width: PW, height: PH, borderRadius: 26, background: 'radial-gradient(58% 38% at 50% 44%, rgba(255,186,120,0.45) 0%, transparent 74%)', opacity: 1 - bloom, mixBlendMode: 'screen' }} />
        )}

        {away < 1 && (
          <AbsoluteFill style={{ opacity: 1 - away }}>
            {/* The cast shadow is not the plate: it is the wedge of light the plate is shutting out,
                so it tightens and darkens as the gap closes rather than simply following the plate. */}
            <div style={{
              position: 'absolute', left: PX - 20, top: HINGE + 40, width: PW + 40, height: PH,
              borderRadius: 30, background: '#000', transformOrigin: '50% 0%',
              transform: `scaleY(${lerp(0.22, 1, closed).toFixed(3)}) scaleX(${lerp(1.06, 1, closed).toFixed(3)})`,
              opacity: lerp(0.1, 0.44, closed), filter: `blur(${lerp(52, 15, closed).toFixed(0)}px)`,
            }} />
            <AbsoluteFill style={{ perspective: 1500, perspectiveOrigin: '50% 26%' }}>
              <div style={{ position: 'absolute', inset: 0, transformOrigin: `50% ${HINGE}px`, transform: `rotateX(${angle.toFixed(2)}deg)`, transformStyle: 'preserve-3d' }}>
                <Platen />
              </div>
            </AbsoluteFill>
            {/* The hinge block the plate swings from, drawn over it so the pivot reads as a machine. */}
            <div style={{ position: 'absolute', left: PX - 14, top: 0, width: PW + 28, height: HINGE + 16, borderRadius: '0 0 16px 16px', background: 'linear-gradient(180deg, #0e1112 0%, #2c3332 62%, #171c1c 100%)', boxShadow: '0 16px 34px rgba(0,0,0,0.5)' }} />
            <div style={{ position: 'absolute', left: PX + 60, top: HINGE - 16, width: PW - 120, height: 20, borderRadius: 10, background: 'linear-gradient(180deg,#5f6a68,#1b2020)' }} />
          </AbsoluteFill>
        )}

        {/* The burst last, so it carries over the plate as well as beside it. Swap `burst` in the
            props panel to compare: steam, flour, embers, shock, none. */}
        {shut && <Burst kind={burst} t={frame - T.swing[1]} x={PX} y={HINGE} w={PW} h={PH} />}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
