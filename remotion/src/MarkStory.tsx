// Story opener for hands-on weekends (workshops, classes, dance): "leave your mark". A sheet of paper on the
// floor with the day printed on it. "Hands-on" is slammed down like a rubber stamp. Painted bare feet dance a
// circle round it, faster every bar, each foot landing heel first and rolling onto the toes; painted hands
// slap down at the corners. Then the day's cards are slammed down one after another, each exactly where it
// sits in the grid, squashing as they hit and filling in from a dry print to the clean card. Every hit throws
// paint: droplets fly out, land and streak away from where they came from. The camera sways with the dance
// and jolts on every hit, and has settled square again by the time the grid is whole.
import { Fragment } from 'react';
import { AbsoluteFill, Easing, Img, useCurrentFrame } from 'remotion';
import { A, AUTUMN_FPS, Band, CardSlice, fit, grain, gridCells, lerp, range, script, serif, sheetSrc, type AutumnOpenerProps } from './autumnOpener';
import { Sfx } from './sfx';

const T = {
  kicker: [3, 8],   // "Hands-on" is stamped down
  steps: [0, 46],   // the dance: six bars of three steps, each bar quicker than the last
  stamps: [50, 70], // the cards are slammed down, one after another
  camera: [0, 76],  // the camera's sway, back to square before the grid is whole
  sheet: [78, 86],  // the gutters between the cards take the grid's colour
  band: [80, 96],   // the band slides in
} as const;
export const MARK_OPEN_FRAMES = T.band[1];
export const markDuration = (holdSeconds: number) => MARK_OPEN_FRAMES + Math.round(Math.max(1, holdSeconds) * AUTUMN_FPS);

// Poster paints. Each print takes the next one, so neighbours never match.
const PAINT = ['#b5471f', '#d39a2a', '#2f7f7a', '#6d3b63', '#2f5aa0'];
// A fresh stamp doesn't take everywhere: paper shows through in dry spots until the print fills in.
const DRY = `url("data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="720" height="720"><filter id="d"><feTurbulence type="fractalNoise" baseFrequency="0.018" numOctaves="3" seed="21"/><feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -4 2.3"/></filter><rect width="720" height="720" filter="url(#d)"/></svg>')}")`;

// The dance path: an oval round the text, walked anticlockwise from the bottom. Steps come in threes (a long
// beat, then two short ones) and every bar is a frame quicker, so the dance gathers pace. Left and right feet
// go either side of the line, each turned along the way it goes.
const BARS = [10, 9, 8, 7, 6, 5];
const STEPS = Array.from({ length: BARS.length * 3 }, (_, i) => {
  const a = Math.PI / 2 + (i / (BARS.length * 3)) * Math.PI * 2 * 0.95;
  const cx = 540 + Math.cos(a) * 390, cy = 960 + Math.sin(a) * 600;
  const tx = -Math.sin(a) * 390, ty = Math.cos(a) * 600; // direction of travel
  const len = Math.hypot(tx, ty), nx = -ty / len, ny = tx / len;
  const side = i % 2 ? 1 : -1;
  const heading = (Math.atan2(ty, tx) * 180) / Math.PI + 90; // prints are drawn toes up
  const bar = Math.floor(i / 3), start = 2 + BARS.slice(0, bar).reduce((x, y) => x + y, 0);
  return { x: cx + nx * 44 * side, y: cy + ny * 44 * side, rot: heading, left: side < 0, accent: i % 3 === 0,
    at: start + [0, 0.34, 0.67][i % 3] * BARS[bar], paint: PAINT[i % PAINT.length] };
});

// Hands, slapped down at the corners over the last bars.
const HANDS = [
  { x: 10, y: 150, rot: -24, at: 26, paint: PAINT[3], flip: false },
  { x: 800, y: 250, rot: 22, at: 32, paint: PAINT[1], flip: true },
  { x: 0, y: 1440, rot: -150, at: 37, paint: PAINT[2], flip: true },
  { x: 810, y: 1400, rot: 158, at: 42, paint: PAINT[0], flip: false },
];
const KICK = { x: 540, y: 1040 }; // where "Hands-on" is stamped

// Splashes. Each hit throws droplets out along the paper: they fly for a few frames (bigger while they're up,
// with their shadow off to one side), slowing as they go, then land and streak away from where they came from,
// with a tiny satellite drop beyond. All from a fixed seed, so every frame agrees.
type Drop = { x: number; y: number; ang: number; dist: number; size: number; at: number; dur: number; color: string };
const seeded = (seed: number) => { let s = seed * 7919 + 13; return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648; };
const splash = (seed: number, at: number, color: string, n: number, reach: number, size: number,
  from: (r: () => number) => { x: number; y: number; ang: number }): Drop[] => {
  const r = seeded(seed);
  return Array.from({ length: n }, () => {
    const o = from(r);
    return { x: o.x, y: o.y, ang: o.ang, dist: reach * (0.35 + r() * 0.9), size: size * (0.45 + r() * 0.9), at: at + r() * 1.5, dur: 4 + r() * 4, color };
  });
};
// From a point, all round.
const around = (x: number, y: number, rad: number) => (r: () => number) => { const ang = r() * Math.PI * 2; return { x: x + Math.cos(ang) * rad, y: y + Math.sin(ang) * rad, ang }; };
// From a card's edges, outward (paint squeezed out from under it).
const fromEdges = (c: { left: number; top: number; width: number; height: number }) => (r: () => number) => {
  const side = Math.floor(r() * 4), t = r(), spread = (r() - 0.5) * 1.2;
  const [x, y, ang] = side === 0 ? [c.left + t * c.width, c.top, -Math.PI / 2] : side === 1 ? [c.left + c.width, c.top + t * c.height, 0]
    : side === 2 ? [c.left + t * c.width, c.top + c.height, Math.PI / 2] : [c.left, c.top + t * c.height, Math.PI];
  return { x, y, ang: ang + spread };
};
const Drops = ({ drops, frame }: { drops: Drop[]; frame: number }) => (
  <svg width={1080} height={1920} style={{ position: 'absolute', inset: 0, overflow: 'visible', mixBlendMode: 'multiply' }}>
    <g filter="url(#mk-drop)">
      {drops.map((d, i) => {
        const t = frame - d.at;
        if (t < 0) return null;
        const u = Math.min(1, t / d.dur), go = d.dist * (1 - (1 - u) * (1 - u)), h = 4 * u * (1 - u);
        const x = d.x + Math.cos(d.ang) * go, y = d.y + Math.sin(d.ang) * go, deg = (d.ang * 180) / Math.PI;
        if (u < 1) return (
          <g key={i}>
            <circle cx={x + h * 22} cy={y + h * 30} r={d.size} fill="#2a1a0e" opacity={0.18} />
            <circle cx={x} cy={y} r={d.size * (1 + 0.6 * h)} fill={d.color} />
          </g>
        );
        const tail = d.size * 3.2;
        return (
          <g key={i} transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${deg.toFixed(1)})`}>
            <ellipse cx={d.size * 0.6} cy={0} rx={d.size * 1.8} ry={d.size * 0.8} fill={d.color} />
            <circle cx={tail} cy={0} r={d.size * 0.38} fill={d.color} />
          </g>
        );
      })}
    </g>
  </svg>
);

// Paint on paper, not a flat shape: the edge wanders (displacement), paint pools darker at the rim where it
// was squeezed out, and the dry spots show the paper through.
const PaintFilter = () => (
  <svg width="0" height="0" style={{ position: 'absolute' }}>
    <filter id="mk-paint" x="-15%" y="-15%" width="130%" height="130%">
      <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="3" seed="3" result="w" />
      <feDisplacementMap in="SourceGraphic" in2="w" scale="12" xChannelSelector="R" yChannelSelector="G" result="d" />
      <feMorphology in="d" operator="erode" radius="4" result="inner" />
      <feGaussianBlur in="inner" stdDeviation="4" result="soft" />
      <feComposite in="d" in2="soft" operator="out" result="rim" />
      <feColorMatrix in="rim" type="matrix" values="0.6 0 0 0 0  0 0.6 0 0 0  0 0 0.6 0 0  0 0 0 0.8 0" result="rimDark" />
      <feMerge result="paint"><feMergeNode in="d" /><feMergeNode in="rimDark" /></feMerge>
      <feTurbulence type="fractalNoise" baseFrequency="0.11" numOctaves="3" seed="8" result="g" />
      <feColorMatrix in="g" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -3.2 2.75" result="dry" />
      <feComposite in="paint" in2="dry" operator="in" />
    </filter>
    <filter id="mk-shadow" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="14" /></filter>
    <filter id="mk-drop" x="-5%" y="-5%" width="110%" height="110%">
      <feTurbulence type="fractalNoise" baseFrequency="0.09" numOctaves="2" seed="5" result="w" />
      <feDisplacementMap in="SourceGraphic" in2="w" scale="5" xChannelSelector="R" yChannelSelector="G" />
    </filter>
  </svg>
);

// A bare right footprint, toes up, 100 x 240: one sole with the arch pinched in on the inside, and five toes.
// A landing foot prints heel first and rolls forward: `roll` uncovers the sole from the heel up, and the toes
// come last.
const SOLE = 'M52,238 C36,238 28,226 28,208 C28,192 38,184 46,172 C52,162 50,146 40,134 C28,120 18,106 18,88 C18,66 34,52 54,52 C74,52 88,64 88,86 C88,110 80,128 78,150 C76,172 76,196 74,214 C72,230 64,238 52,238 Z';
const Foot = ({ id, paint, roll, toes, left }: { id: string; paint: string; roll: number; toes: number; left: boolean }) => (
  <svg width={100} height={240} viewBox="0 0 100 240" style={{ overflow: 'visible', transform: left ? 'scaleX(-1)' : undefined }}>
    <clipPath id={id}><rect x={-20} y={240 - 200 * roll} width={140} height={260} /></clipPath>
    <g filter="url(#mk-paint)" fill={paint}>
      <path d={SOLE} clipPath={`url(#${id})`} />
      <g opacity={toes}>
        <ellipse cx={28} cy={34} rx={13} ry={15} />
        <ellipse cx={50} cy={27} rx={9} ry={10} />
        <ellipse cx={66} cy={30} rx={8} ry={9} />
        <ellipse cx={79} cy={37} rx={7} ry={8} />
        <ellipse cx={89} cy={49} rx={6} ry={7} />
      </g>
    </g>
  </svg>
);

// A right hand, palm down, fingers up, in 240 x 280. Fingers are in two pieces with a gap at the joint: a real
// handprint doesn't print the crease.
const HAND_PARTS = (
  <>
    <path d="M62,150 C60,130 72,120 96,120 L170,122 C188,124 196,140 194,166 C192,208 180,250 140,262 C110,270 76,258 66,228 C60,206 62,176 62,150 Z" />
    {[[70, 34, 26], [104, 16, 28], [138, 26, 26], [170, 60, 22]].map(([x, top, w]) => (
      <g key={x}>
        <rect x={x} y={top} width={w} height={46} rx={w / 2} />
        <rect x={x} y={top + 52} width={w} height={116 - top - 52 + 30} rx={w / 2} />
      </g>
    ))}
    <g transform="translate(74 222) rotate(-52)">
      <rect x={-16} y={-112} width={32} height={46} rx={16} />
      <rect x={-17} y={-60} width={34} height={64} rx={17} />
    </g>
  </>
);
const Hand = ({ paint, press, near, flip }: { paint: string; press: number; near: number; flip: boolean }) => (
  <div style={{ position: 'relative', width: 240, height: 280, transform: flip ? 'scaleX(-1)' : undefined }}>
    {/* The hand's shadow, before it lands: large, faint and blurred while the hand is high, tightening under it. */}
    {near > 0 && press === 0 && (
      <svg width={240} height={280} viewBox="0 0 240 280" style={{ position: 'absolute', inset: 0, overflow: 'visible',
        transform: `translate(${lerp(60, 6, near)}px, ${lerp(90, 8, near)}px) scale(${lerp(1.35, 1.02, near)})`, opacity: lerp(0.05, 0.32, near) }}>
        <g fill="#2a1a0e" filter="url(#mk-shadow)">{HAND_PARTS}</g>
      </svg>
    )}
    {/* The print: squeezed out a little past the hand as it's pressed. */}
    {press > 0 && (
      <svg width={240} height={280} viewBox="0 0 240 280" style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
        <g fill={paint} filter="url(#mk-paint)" transform={`translate(120 150) scale(${lerp(0.94, 1, press)}) translate(-120 -150)`}>{HAND_PARTS}</g>
      </svg>
    )}
  </div>
);

// Heavy drawing paper, lit from the upper left, with a soft relief so it reads as a sheet and not a colour.
const RELIEF = `url("data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920"><filter id="c" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.003 0.005" numOctaves="4" seed="5" result="n"/><feDiffuseLighting in="n" surfaceScale="3" lighting-color="#fff" result="l"><feDistantLight azimuth="225" elevation="60"/></feDiffuseLighting><feComponentTransfer in="l"><feFuncR type="linear" slope="0.5" intercept="0.55"/><feFuncG type="linear" slope="0.5" intercept="0.55"/><feFuncB type="linear" slope="0.5" intercept="0.55"/></feComponentTransfer></filter><rect width="1080" height="1920" filter="url(#c)"/></svg>')}")`;

export const MarkStory = ({ day, date, kicker, category, count, sheet }: AutumnOpenerProps) => {
  const frame = useCurrentFrame();
  const sheetIn = range(frame, T.sheet, Easing.inOut(Easing.quad));
  const band = range(frame, T.band, Easing.bezier(0.2, 0.9, 0.2, 1));
  const cells = gridCells(count);
  const gap = cells.length > 1 ? Math.min(6, (T.stamps[1] - T.stamps[0]) / (cells.length - 1)) : 0;
  const cards = cells.map((c, i) => ({ c, at: T.stamps[0] + i * gap, tilt: (i % 2 ? 1 : -1) * (3 + (i % 3)) }));
  // A foot lands heel first, rolls onto the ball, and the toes print last.
  const land = (at: number, delay: number) => range(frame, [at + delay, at + delay + 3], Easing.out(Easing.quad));

  // Every hit, and how hard: the stamp, the first step of each bar, each hand, each card.
  const hits = [
    { at: T.kicker[1], power: 0.7 },
    ...STEPS.filter(s => s.accent).map(s => ({ at: s.at, power: 0.15 })),
    ...HANDS.map(h => ({ at: h.at, power: 0.5 })),
    ...cards.map(k => ({ at: k.at, power: Math.min(1.1, 0.5 + (k.c.width * k.c.height) / (1080 * 1730) * 1.2) })),
  ];
  const drops = [
    ...splash(1, T.kicker[1], A.rust, 26, 260, 9, around(KICK.x, KICK.y, 120)),
    ...STEPS.filter(s => s.accent).flatMap((s, i) => splash(10 + i, s.at + 1, s.paint, 4, 70, 5, around(s.x, s.y, 50))),
    ...HANDS.flatMap((h, i) => splash(30 + i, h.at, h.paint, 14, 200, 8, around(h.x + 130, h.y + 150, 110))),
    ...cards.flatMap(({ c, at }, i) => splash(50 + i, at, PAINT[(i + 2) % PAINT.length], 18, 150, 8, fromEdges(c))),
  ];

  // The camera: a slow sway and push-in that follows the dance round and comes back square, plus a jolt on
  // every hit that dies away in a few frames (a damped shake, harder for bigger hits).
  const sway = Math.sin(Math.PI * range(frame, T.camera, Easing.inOut(Easing.quad)));
  let dx = 0, dy = 0, punch = 0;
  hits.forEach((h, i) => {
    const t = frame - h.at;
    if (t < 0 || t > 14) return;
    const k = h.power * Math.exp(-t / 2.2);
    dx += k * 16 * Math.sin(t * 2.6 + i); dy += k * 16 * Math.cos(t * 2.1 + i * 1.7); punch += k * 0.014;
  });
  const camera = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) rotate(${(-2.5 * sway).toFixed(2)}deg) scale(${(1 + 0.06 * sway + punch).toFixed(4)})`;

  // The stamp: comes down fast from above the paper (big, soft shadow), hits, and the ink fills in.
  const kDown = range(frame, T.kicker, Easing.in(Easing.cubic));
  const kInk = range(frame, [T.kicker[1], T.kicker[1] + 8], Easing.out(Easing.quad));

  return (
    <AbsoluteFill style={{ background: '#e9dfca', overflow: 'hidden' }}>
      <PaintFilter />
      <div style={{ position: 'absolute', inset: 0, transform: camera }}>
        <div style={{ position: 'absolute', inset: -140, background: `${grain(0.1)}, ${RELIEF}, #f1e8d6`, backgroundBlendMode: 'multiply' }} />
        <div style={{ position: 'absolute', inset: -140, background: 'radial-gradient(120% 90% at 30% 20%, rgba(255,250,235,0.35), rgba(60,35,15,0.18))' }} />

        <div style={{ position: 'absolute', inset: 0, mixBlendMode: 'multiply' }}>
          {STEPS.map((s, i) => {
            const roll = range(frame, [s.at, s.at + 3], Easing.bezier(0.3, 0, 0.5, 1));
            if (roll === 0) return null;
            return (
              <div key={i} style={{ position: 'absolute', left: s.x - 50, top: s.y - 120, transform: `rotate(${s.rot}deg) scale(0.9)` }}>
                <Foot id={`mk-foot-${i}`} paint={s.paint} roll={roll} toes={land(s.at, 2)} left={s.left} />
              </div>
            );
          })}
          {HANDS.map((h, i) => {
            const near = range(frame, [h.at - 6, h.at], Easing.in(Easing.quad));
            const press = range(frame, [h.at, h.at + 3], Easing.out(Easing.cubic));
            if (near === 0) return null;
            return (
              <div key={i} style={{ position: 'absolute', left: h.x, top: h.y, transform: `rotate(${h.rot}deg) scale(1.1)` }}>
                <Hand paint={h.paint} press={press} near={near} flip={h.flip} />
              </div>
            );
          })}
        </div>

        {/* The day, printed on the sheet from the first frame. */}
        <div style={{ position: 'absolute', left: 0, right: 0, top: 690, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div style={serif(34, 700, { letterSpacing: '0.34em', marginRight: '-0.34em', color: A.rust })}>RĪGA · THIS WEEKEND</div>
          <div style={serif(fit(day, 150, 800), 700, { marginTop: 34, letterSpacing: '0.08em', marginRight: '-0.08em' })}>{day}</div>
          <div style={serif(58, 600, { marginTop: 20, letterSpacing: '0.2em', marginRight: '-0.2em' })}>{date}</div>
          <div style={{ height: 124 + 44 }} />
          <div style={serif(fit(category, 64, 1100), 500, { marginTop: 12, letterSpacing: '0.04em' })}>{category}</div>
          <div style={serif(30, 700, { marginTop: 50, letterSpacing: '0.3em', marginRight: '-0.3em', color: A.barkSoft })}>{count} {count === 1 ? 'THING' : 'THINGS'} TO JOIN IN</div>
        </div>
        {frame >= T.kicker[0] && (
          <div style={{ position: 'absolute', left: 0, right: 0, top: KICK.y - 80, display: 'flex', justifyContent: 'center' }}>
            {kDown < 1 && (
              <div style={{ position: 'absolute', ...script(116, '#2a1a0e'), opacity: lerp(0.08, 0.3, kDown), filter: `blur(${lerp(18, 3, kDown)}px)`,
                transform: `translate(${lerp(40, 4, kDown)}px, ${lerp(60, 6, kDown)}px) rotate(-4deg)` }}>{kicker}</div>
            )}
            <div style={{ ...script(116), transform: `rotate(${lerp(-10, -4, kDown)}deg) scale(${lerp(2.2, 1, kDown)})`, opacity: Math.min(1, (frame - T.kicker[0] + 1) / 2) }}>
              <span style={{ opacity: kDown < 1 ? 1 : lerp(0.7, 1, kInk), filter: `blur(${kDown < 1 ? 0 : lerp(1.2, 0, kInk).toFixed(2)}px)` }}>{kicker}</span>
            </div>
          </div>
        )}

        {/* The splashes land on the paper; the cards come down over them. */}
        <Drops drops={drops} frame={frame} />
        {cards.map(({ c, at, tilt }, i) => {
          // Each card comes down fast from above (big, tilted, its shadow wide and soft), slams flat, squashes
          // and springs back, and the print fills in from dry and a little soft to the clean card.
          const down = range(frame, [at - 5, at], Easing.in(Easing.cubic));
          if (down === 0) return null;
          const t = frame - at, hit = t >= 0;
          const squash = hit ? 0.04 * Math.exp(-t / 2) * Math.cos(t * 1.6) : 0;
          const fill = range(frame, [at + 1, at + 11], Easing.out(Easing.quad));
          return (
            <div key={i} style={{ position: 'absolute', left: c.left, top: c.top, width: c.width, height: c.height }}>
              {!hit && (
                <div style={{ position: 'absolute', inset: 0, background: '#2a1a0e', opacity: lerp(0.1, 0.4, down),
                  transform: `translate(${lerp(70, 8, down)}px, ${lerp(100, 10, down)}px) scale(${lerp(1.15, 1.01, down)})`, filter: `blur(${lerp(40, 8, down)}px)` }} />
              )}
              <div style={{ position: 'absolute', inset: 0,
                transform: hit ? `scale(${1 + squash}, ${1 - squash})` : `rotate(${lerp(tilt, 0, down)}deg) scale(${lerp(1.5, 1, down)})`,
                filter: `saturate(${lerp(0.7, 1, fill).toFixed(2)}) blur(${lerp(1.6, 0, fill).toFixed(2)}px)`, boxShadow: '0 4px 10px rgba(40,20,5,0.25)' }}>
                <CardSlice sheet={sheet} cell={c} />
                {hit && (
                  <div style={{ position: 'absolute', inset: 0, background: '#efe5d1', WebkitMaskImage: DRY, WebkitMaskSize: '720px 720px',
                    WebkitMaskPosition: `${(i * 197) % 720}px ${(i * 113) % 720}px`, opacity: 1 - fill }} />
                )}
              </div>
            </div>
          );
        })}
        {/* Last, the grid's own colour comes up in the gutters, and the sheet is exactly the grid. */}
        {sheetIn > 0 && (
          <AbsoluteFill style={{ opacity: sheetIn }}>
            <Img src={sheetSrc(sheet)} style={{ width: 1080, height: 1920 }} />
          </AbsoluteFill>
        )}
      </div>
      {/* Sound: the stamp, every step (the first of each bar a little harder), each slap and each card, with a
          splat on every hit, and the band sliding in. */}
      <Sfx at={T.kicker[1]} name="mark-stamp" volume={0.9} />
      <Sfx at={T.kicker[1]} name="mark-splat-4" volume={0.4} />
      {STEPS.map((s, i) => <Sfx key={`s${i}`} at={s.at} name={`mark-step-${(i % 4) + 1}`} volume={s.accent ? 0.6 : 0.4} />)}
      {HANDS.map((h, i) => <Sfx key={`h${i}`} at={h.at} name={`mark-slap-${(i % 4) + 1}`} volume={0.7} />)}
      {HANDS.map((h, i) => <Sfx key={`hs${i}`} at={h.at} name={i % 2 ? 'mark-splat-3' : 'mark-splat-4'} volume={0.45} />)}
      {/* Each card lands with Seismic Slam and a door thump under it, both ringing in a room, and the wet paint
          under it. The last card's slam is pitched down, so it lands biggest. */}
      {cards.map((k, i) => {
        // The slams ring for over a second and the cards land a fifth of a second apart, so they pile up:
        // the more cards, the quieter each, so the pile never clips.
        const last = i === cards.length - 1, stack = 1 / Math.sqrt(Math.max(1, cards.length / 2));
        return (
          <Fragment key={`c${i}`}>
            <Sfx at={k.at} name={last ? 'mark-slam-2' : 'mark-slam-1'} volume={(last ? 0.7 : 0.5) * stack} />
            <Sfx at={k.at} name="mark-thump" volume={0.45 * stack} />
            <Sfx at={k.at} name={`mark-splat-${(i % 2) + 1}`} volume={0.3} />
          </Fragment>
        );
      })}
      <Sfx at={T.band[0]} name="paper-slide" volume={0.45} />
      <Band day={day} date={date} category={category} grow={band} accent={PAINT[2]} />
    </AbsoluteFill>
  );
};
