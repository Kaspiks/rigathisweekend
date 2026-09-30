// Story opener for hands-on weekends: a spiral sketchbook. The day is already pencilled on the page. A pencil
// comes in and writes the kicker in a quick hand, then roughs out the day's cards one by one, each a quick
// box exactly where it sits in the grid. As each box is closed, watercolour drops into it and blooms out,
// fast at first and creeping as the water runs out, and the card comes up through the wash as it dries.
import { AbsoluteFill, Easing, Img, useCurrentFrame } from 'remotion';
import { A, AUTUMN_FPS, Band, CardSlice, fit, gridCells, lerp, range, script, serif, sheetSrc, type AutumnOpenerProps, type Cell } from './autumnOpener';
import { Sfx } from './sfx';

const T = {
  enter: [0, 5],    // the pencil comes in to the start of the word
  write: [5, 26],   // writes the kicker
  boxes: [28, 84],  // roughs out each card's box in turn
  exit: [84, 92],   // and lifts away
  sheet: [100, 108],  // the pencil lines fade and the gutters take the grid's colour
  band: [100, 116],
} as const;
export const SKETCH_OPEN_FRAMES = T.band[1];
export const sketchDuration = (holdSeconds: number) => SKETCH_OPEN_FRAMES + Math.round(Math.max(1, holdSeconds) * AUTUMN_FPS);

const GRAPHITE = '#3a3a40';
const KICK_SIZE = 140, KICK_Y = 950;

// Points along a curve, and a way to find the point a given fraction of the way along it, so the pencil's
// tip can sit exactly where the drawn line has reached.
type Pt = [number, number];
const along = (pts: Pt[]) => {
  const acc = [0];
  for (let i = 1; i < pts.length; i++) acc.push(acc[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = acc[acc.length - 1];
  return (t: number): Pt => {
    const d = Math.min(1, Math.max(0, t)) * total;
    let i = 1; while (i < acc.length - 1 && acc[i] < d) i++;
    const k = (d - acc[i - 1]) / Math.max(1e-6, acc[i] - acc[i - 1]);
    return [lerp(pts[i - 1][0], pts[i][0], k), lerp(pts[i - 1][1], pts[i][1], k)];
  };
};
const pathOf = (pts: Pt[]) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');

// A pencil, tip at the origin, lying to the upper right as a right hand holds it: graphite, the shaved wood
// cone, a six-sided yellow body (three facets show), the ferrule and the eraser.
const Pencil = () => (
  <svg width={660} height={60} viewBox="0 -30 660 60" style={{ overflow: 'visible', position: 'absolute', left: 0, top: -30 }}>
    <defs>
      <linearGradient id="sk-body" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#f3cb57" /><stop offset="0.33" stopColor="#f3cb57" />
        <stop offset="0.34" stopColor="#e2ac2e" /><stop offset="0.66" stopColor="#e2ac2e" />
        <stop offset="0.67" stopColor="#b98318" /><stop offset="1" stopColor="#b98318" />
      </linearGradient>
      <linearGradient id="sk-metal" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#e9e6df" /><stop offset="0.5" stopColor="#a9a49a" /><stop offset="1" stopColor="#6d685f" />
      </linearGradient>
    </defs>
    <path d="M0,0 L18,-5 L18,5 Z" fill="#2b2b30" />
    <path d="M18,-5 L74,-17 L74,17 L18,5 Z" fill="#e8c9a0" />
    <path d="M74,-17 L80,-12 L86,-17 L92,-12 L98,-17 L98,17 L74,17 Z" fill="url(#sk-body)" />
    <rect x={74} y={-17} width={500} height={34} fill="url(#sk-body)" />
    <rect x={574} y={-18} width={40} height={36} fill="url(#sk-metal)" />
    {[584, 596].map(x => <rect key={x} x={x} y={-18} width={3} height={36} fill="#5d584f" opacity={0.6} />)}
    <rect x={614} y={-17} width={36} height={34} rx={6} fill="#d98c8c" />
  </svg>
);

// Heavy cold-press paper: an even tooth that the graphite and the paint both catch on.
const TOOTH = `url("data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><filter id="t"><feTurbulence type="fractalNoise" baseFrequency="0.35" numOctaves="3" seed="2" result="n"/><feDiffuseLighting in="n" surfaceScale="1.6" lighting-color="#fff"><feDistantLight azimuth="225" elevation="55"/></feDiffuseLighting></filter><rect width="400" height="400" filter="url(#t)"/></svg>')}")`;
// Pencil on that paper: mostly solid, broken where the tooth doesn't take it.
const PENCIL_TOOTH = `url("data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><filter id="p"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="6"/><feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -2 1.9"/></filter><rect width="300" height="300" filter="url(#p)"/></svg>')}")`;

// Watercolour for each card: a colour dropped in near the middle of the box, spreading with a wandering wet
// edge. The mask is the wet area; the tint over the card is the pigment, darker at the rim where it dries.
const WASH = ['#d9a236', '#b8502a', '#3c8a82', '#6d3b63', '#2f5aa0', '#c9722a'];
const wetMask = (w: number, h: number, cx: number, cy: number, r: number, seed: number) =>
  `url("data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><filter id="w" x="-30%" y="-30%" width="160%" height="160%"><feTurbulence type="fractalNoise" baseFrequency="0.006" numOctaves="4" seed="${seed}"/><feDisplacementMap in="SourceGraphic" scale="${Math.round(Math.min(160, 30 + r * 0.25))}" xChannelSelector="R" yChannelSelector="G"/></filter><circle cx="${cx}" cy="${cy}" r="${r.toFixed(1)}" fill="#fff" filter="url(#w)"/></svg>`)}")`;

// A quick box round a card, the way you'd rough one out: starts just off the corner, a slight wobble along
// each side, and runs on past where it started.
const boxPts = (c: Cell, seed: number): Pt[] => {
  const x0 = c.left + 14, y0 = c.top + 14, x1 = c.left + c.width - 14, y1 = c.top + c.height - 14;
  const corners: Pt[] = [[x0 - 10, y0 + 3], [x1 + 6, y0 - 2], [x1 - 2, y1 + 8], [x0 + 3, y1 - 2], [x0 + 1, y0 - 12]];
  const pts: Pt[] = [];
  for (let k = 0; k < 4; k++) {
    const [ax, ay] = corners[k], [bx, by] = corners[k + 1];
    for (let j = 0; j < 16; j++) {
      const t = j / 16, wob = Math.sin((t + seed * 0.37 + k) * Math.PI * 2) * 3;
      pts.push([lerp(ax, bx, t) + (ay === by ? 0 : wob), lerp(ay, by, t) + (ax === bx ? 0 : wob)]);
    }
  }
  pts.push(corners[4]);
  return pts;
};

export const SketchStory = ({ day, date, kicker, category, count, sheet }: AutumnOpenerProps) => {
  const frame = useCurrentFrame();
  const write = range(frame, T.write, Easing.linear);
  const sheetIn = range(frame, T.sheet, Easing.inOut(Easing.quad));
  const band = range(frame, T.band, Easing.bezier(0.2, 0.9, 0.2, 1));
  const cells = gridCells(count);

  // Where the kicker sits. Its width is estimated from its length, so the pencil can follow it.
  const kw = Math.min(900, kicker.length * KICK_SIZE * 0.4), kx = 540 - kw / 2;
  const kickTip = (t: number): Pt => [kx + kw * t, KICK_Y + 110 - Math.abs(Math.sin(t * Math.PI * kicker.length * 0.9)) * 70];

  // Each card gets an equal share of the boxing time: most of it drawing, the rest hopping to the next.
  const per = (T.boxes[1] - T.boxes[0]) / cells.length;
  const boxes = cells.map((c, i) => {
    const pts = boxPts(c, i + 1), at = T.boxes[0] + i * per;
    return { c, pts, on: along(pts), path: pathOf(pts), at, done: at + per * 0.72 };
  });

  // The pencil's tip. `lift` is 0 on the paper and 1 held well above it, and spreads its shadow out.
  let tip: Pt, lift = 0;
  const hop = (a: Pt, b: Pt, t: number): Pt => { lift = Math.sin(t * Math.PI) * 0.6; return [lerp(a[0], b[0], t), lerp(a[1], b[1], t)]; };
  const box = boxes.findIndex(b => frame < b.at + per);
  if (frame < T.write[0]) { const t = range(frame, T.enter, Easing.out(Easing.quad)); tip = [lerp(1250, kickTip(0)[0], t), lerp(1700, kickTip(0)[1], t)]; lift = 1 - t; }
  else if (frame < T.write[1]) tip = kickTip(write);
  else if (frame < T.boxes[0]) tip = hop(kickTip(1), boxes[0].on(0), range(frame, [T.write[1], T.boxes[0]]));
  else if (box >= 0) {
    const b = boxes[box];
    if (frame < b.done) tip = b.on(range(frame, [b.at, b.done], Easing.bezier(0.3, 0, 0.6, 1)));
    else tip = hop(b.on(1), box + 1 < boxes.length ? boxes[box + 1].on(0) : [1500, 2300], range(frame, [b.done, b.at + per]));
  } else { const t = range(frame, T.exit, Easing.in(Easing.quad)); tip = [lerp(1500, 1900, t), lerp(2300, 2700, t)]; lift = 1; }

  const graphite = { mixBlendMode: 'multiply' as const, WebkitMaskImage: PENCIL_TOOTH };

  return (
    <AbsoluteFill style={{ background: '#f6f0e2', overflow: 'hidden' }}>
      <AbsoluteFill style={{ background: `${TOOTH}, #f6f0e2`, backgroundBlendMode: 'multiply' }} />
      <AbsoluteFill style={{ background: 'radial-gradient(120% 80% at 35% 25%, rgba(255,252,240,0.5), rgba(80,60,30,0.14))' }} />

      <div style={{ position: 'absolute', left: 0, right: 0, top: 560, display: 'flex', flexDirection: 'column', alignItems: 'center', ...graphite }}>
        <div style={serif(32, 600, { color: GRAPHITE, letterSpacing: '0.36em', marginRight: '-0.36em' })}>RĪGA · THIS WEEKEND</div>
        <div style={serif(fit(day, 150, 820), 600, { color: GRAPHITE, marginTop: 40, letterSpacing: '0.06em', marginRight: '-0.06em' })}>{day}</div>
        <div style={serif(56, 500, { color: GRAPHITE, marginTop: 22, letterSpacing: '0.2em', marginRight: '-0.2em' })}>{date}</div>
      </div>
      {/* The kicker, uncovered just behind the pencil's tip. */}
      <div style={{ position: 'absolute', left: 0, right: 0, top: KICK_Y, display: 'flex', justifyContent: 'center', ...graphite,
        clipPath: write >= 1 ? undefined : `inset(0 ${1080 - (kx + kw * write)}px 0 0)` }}>
        <div style={script(KICK_SIZE, GRAPHITE)}>{kicker}</div>
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: KICK_Y + 200, display: 'flex', flexDirection: 'column', alignItems: 'center', ...graphite }}>
        <div style={serif(fit(category, 62, 1100), 500, { color: GRAPHITE })}>{category}</div>
        <div style={serif(30, 700, { color: GRAPHITE, marginTop: 44, letterSpacing: '0.3em', marginRight: '-0.3em' })}>{count} {count === 1 ? 'THING' : 'THINGS'} TO JOIN IN</div>
      </div>

      {boxes.map(({ c, done }, i) => {
        // The wash: dropped in as the box closes, spreading fast and then slowly; the card comes up through
        // it as it dries, the pigment fading back to leave only the card.
        const spread = range(frame, [done - 1, done + 16], Easing.out(Easing.cubic));
        const dry = range(frame, [done + 5, done + 20], Easing.inOut(Easing.quad));
        if (spread === 0) return null;
        const cx = c.width * (0.38 + 0.2 * ((i * 7) % 3) / 2), cy = c.height * (0.4 + 0.15 * ((i * 5) % 3) / 2);
        const r = Math.hypot(Math.max(cx, c.width - cx), Math.max(cy, c.height - cy)) * 1.25 * spread;
        const tint = WASH[i % WASH.length];
        return (
          <div key={i} style={{ position: 'absolute', left: c.left, top: c.top, width: c.width, height: c.height,
            WebkitMaskImage: spread >= 1 ? undefined : wetMask(Math.round(c.width), Math.round(c.height), cx, cy, r, 12 + i) }}>
            <div style={{ position: 'absolute', inset: 0, opacity: lerp(0.25, 1, dry) }}><CardSlice sheet={sheet} cell={c} /></div>
            <div style={{ position: 'absolute', inset: 0, mixBlendMode: 'multiply', opacity: 1 - dry,
              background: `radial-gradient(circle at ${cx}px ${cy}px, ${tint}66 0, ${tint}88 ${(r * 0.8).toFixed(0)}px, ${tint}dd ${(r * 0.96).toFixed(0)}px, ${tint}00 ${r.toFixed(0)}px)` }} />
            <div style={{ position: 'absolute', inset: 0, background: `${TOOTH}`, mixBlendMode: 'multiply', opacity: 0.5 * (1 - dry) }} />
          </div>
        );
      })}

      {/* The pencil boxes, on top of everything, until the grid is done. */}
      <svg width={1080} height={1920} style={{ position: 'absolute', inset: 0, ...graphite, opacity: 1 - sheetIn }}>
        {boxes.map(({ path, at, done }, i) => {
          const d = range(frame, [at, done], Easing.bezier(0.3, 0, 0.6, 1));
          return d > 0 ? <path key={i} d={path} stroke={GRAPHITE} strokeWidth={5} fill="none" strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray={`${d} 1`} /> : null;
        })}
      </svg>
      {sheetIn > 0 && (
        <AbsoluteFill style={{ opacity: sheetIn }}>
          <Img src={sheetSrc(sheet)} style={{ width: 1080, height: 1920 }} />
        </AbsoluteFill>
      )}

      {frame < T.exit[1] && (
        // The pencil: its shadow falls down and to the right, and spreads and fades the higher it's held.
        <>
          <div style={{ position: 'absolute', left: tip[0] + 10 + lift * 60, top: tip[1] + 14 + lift * 70, transform: 'rotate(-38deg)', transformOrigin: '0 0',
            filter: `blur(${4 + lift * 16}px)`, opacity: 0.35 - lift * 0.15 }}>
            <div style={{ position: 'absolute', left: 0, top: -14, width: 650, height: 28, background: '#2a1d10', borderRadius: 14 }} />
          </div>
          <div style={{ position: 'absolute', left: tip[0], top: tip[1], transform: `rotate(-38deg) scale(${1 + lift * 0.06})`, transformOrigin: '0 0' }}>
            <Pencil />
          </div>
        </>
      )}
      {/* Sound: the pencil writing the kicker, then roughing out each box (cut to the stroke), a drop falling
          into each box as it closes and the wash spreading, and the band sliding in. */}
      <Sfx at={T.write[0]} name="sketch-write" volume={0.7} frames={T.write[1] - T.write[0] + 2} />
      {boxes.map(({ at, done }, i) => <Sfx key={`b${i}`} at={at} name="sketch-box" volume={0.6} frames={done - at + 2} />)}
      {boxes.map(({ done }, i) => <Sfx key={`d${i}`} at={done - 1} name="sketch-drop" volume={0.55} />)}
      {boxes.map(({ done }, i) => <Sfx key={`w${i}`} at={done} name="sketch-wash" volume={0.35} />)}
      <Sfx at={T.band[0]} name="paper-slide" volume={0.45} />
      <Band day={day} date={date} category={category} grow={band} accent={A.rust} />
    </AbsoluteFill>
  );
};
