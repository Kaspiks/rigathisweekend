// Story opener: a kraft market bag with the day stamped on it. It lands, gets a tug, rips down the middle
// and the two halves fall away, and the grid is underneath. Its paper tag drops into the strip the grid
// leaves clear and becomes the footer band. Readable from the first frame, grid full screen by two seconds.
import { AbsoluteFill, Easing, Img, useCurrentFrame } from 'remotion';
import { A, AUTUMN_FPS, BAR_H, Band, fit, grain, lerp, range, script, serif, sheetSrc, MAPLE, MAPLE_VEINS, type AutumnOpenerProps } from './autumnOpener';
import { Sfx } from './sfx';

const T = {
  settle: [0, 16],  // the bag drops in and settles
  tug: [14, 22],    // a squeeze as the paper takes the strain
  rip: [20, 40],    // the rip runs from the top of the bag to the bottom
  fall: [40, 66],   // the halves fall away, left and right
  reveal: [38, 62], // the grid comes up underneath
  tag: [40, 64],    // the tag drops into the footer strip
  band: [58, 74],   // and becomes the band
} as const;
export const BAG_OPEN_FRAMES = T.band[1];
export const bagDuration = (holdSeconds: number) => BAG_OPEN_FRAMES + Math.round(Math.max(1, holdSeconds) * AUTUMN_FPS);

const BW = 880, BH = 1420, LEFT = (1080 - BW) / 2, TOP = 190, FOLD = 120;
// The rip: one jagged line down the middle, from a fixed seed so every frame tears along the same one.
const RIP = (() => {
  let s = 11; const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  const pts: [number, number][] = [];
  for (let y = 0; y <= BH; y += 26) pts.push([BW / 2 + (rnd() - 0.5) * 34, Math.min(y, BH)]);
  pts[pts.length - 1][1] = BH;
  return pts;
})();
const ripPath = RIP.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y}`).join(' ');
const halfClip = (side: 'left' | 'right') => side === 'left'
  ? `polygon(0 0, ${RIP.map(([x, y]) => `${x.toFixed(1)}px ${y}px`).join(', ')}, 0 ${BH}px)`
  : `polygon(${BW}px 0, ${RIP.map(([x, y]) => `${x.toFixed(1)}px ${y}px`).join(', ')}, ${BW}px ${BH}px)`;

// The bag's front. What makes kraft read as paper rather than a brown rectangle is relief: a crumple
// texture lit from the upper left (noise turned into a height map, then shaded), gusset creases as paired
// light and dark lines, a folded serrated top with its own shadow, and ink that sits in the paper - printed
// with multiply so the fibres show through, and speckled the way a rubber stamp takes on a rough surface.
const RELIEF = (seed: number) => `url("data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${BW}" height="${BH}"><filter id="c" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.0045 0.009" numOctaves="4" seed="${seed}" result="n"/><feDiffuseLighting in="n" surfaceScale="7" lighting-color="#fff" result="l"><feDistantLight azimuth="225" elevation="52"/></feDiffuseLighting><feComponentTransfer in="l"><feFuncR type="linear" slope="1.25" intercept="-0.12"/><feFuncG type="linear" slope="1.25" intercept="-0.12"/><feFuncB type="linear" slope="1.25" intercept="-0.12"/></feComponentTransfer></filter><rect width="${BW}" height="${BH}" filter="url(#c)"/></svg>`)}")`;
const SPECKLE = `url("data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><filter id="s"><feTurbulence type="fractalNoise" baseFrequency="0.55" numOctaves="2" seed="4"/><feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -2.6 2.15"/></filter><rect width="400" height="400" filter="url(#s)"/></svg>')}")`;
const crease = (x: number) => [
  <div key={`d${x}`} style={{ position: 'absolute', top: FOLD, bottom: 0, left: x, width: 3, background: 'linear-gradient(90deg, rgba(60,35,15,0.28), rgba(60,35,15,0))' }} />,
  <div key={`l${x}`} style={{ position: 'absolute', top: FOLD, bottom: 0, left: x + 3, width: 3, background: 'linear-gradient(90deg, rgba(255,240,210,0.35), rgba(255,240,210,0))' }} />,
];
const Bag = ({ day, date, kicker, category, count }: Omit<AutumnOpenerProps, 'sheet' | 'holdSeconds'>) => (
  <div style={{ position: 'relative', width: BW, height: BH, background: A.kraft, overflow: 'hidden' }}>
    {/* The paper: kraft colour, lit crumples multiplied over it, fine fibre grain on top. */}
    <div style={{ position: 'absolute', inset: 0, backgroundImage: RELIEF(9), mixBlendMode: 'multiply', opacity: 0.85 }} />
    <div style={{ position: 'absolute', inset: 0, background: grain(0.2), mixBlendMode: 'multiply' }} />
    {/* Light from the upper left, falling off across the bag and darker into the side gussets. */}
    <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(115deg, rgba(255,235,200,0.22) 0%, rgba(0,0,0,0) 45%, rgba(40,20,5,0.28) 100%)' }} />
    <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg, rgba(40,20,5,0.35) 0%, rgba(0,0,0,0) 8%, rgba(0,0,0,0) 92%, rgba(40,20,5,0.4) 100%)' }} />
    {crease(70)}{crease(BW - 76)}
    {/* The folded top: serrated edge, the fold's own shading, and the shadow it throws on the bag below. */}
    <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: FOLD,
      background: `linear-gradient(180deg, rgba(40,20,5,0.1), rgba(255,235,200,0.18) 70%, rgba(40,20,5,0.3)), ${A.kraftDark}`,
      WebkitMaskImage: `url("data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${BW}" height="${FOLD}"><path d="M0,14 ${Array.from({ length: 45 }, (_, i) => `L${(i + 0.5) * (BW / 44)},${i % 2 ? 14 : 0}`).join(' ')} L${BW},14 L${BW},${FOLD} L0,${FOLD} Z" fill="#fff"/></svg>`)}")` }}>
      <div style={{ position: 'absolute', inset: 0, backgroundImage: RELIEF(3), mixBlendMode: 'multiply', opacity: 0.7 }} />
    </div>
    <div style={{ position: 'absolute', left: 0, right: 0, top: FOLD, height: 22, background: 'linear-gradient(rgba(30,15,5,0.4), transparent)' }} />
    {/* The stamp. */}
    <div style={{ position: 'absolute', left: 0, right: 0, top: FOLD + 120, display: 'flex', flexDirection: 'column', alignItems: 'center',
      mixBlendMode: 'multiply', opacity: 0.9, WebkitMaskImage: SPECKLE, transform: 'rotate(-1.2deg)' }}>
      <div style={{ border: `5px solid ${A.bark}`, borderRadius: 18, padding: '16px 38px', ...serif(34, 700, { letterSpacing: '0.32em' }) }}>RĪGA · MARKET DAY</div>
      <svg width="170" height="170" viewBox="0 0 200 200" style={{ marginTop: 58, transform: 'rotate(-8deg)' }}>
        <path d={MAPLE} fill={A.rust} />
        <path d={MAPLE_VEINS} stroke={A.kraft} strokeWidth={5} fill="none" strokeLinecap="round" />
      </svg>
      <div style={serif(fit(day, 150, 900), 700, { marginTop: 40, letterSpacing: '0.08em', marginRight: '-0.08em' })}>{day}</div>
      <div style={serif(58, 600, { marginTop: 22, letterSpacing: '0.2em', marginRight: '-0.2em' })}>{date}</div>
      <div style={{ ...script(118), marginTop: 56 }}>{kicker}</div>
      <div style={serif(fit(category, 64, 1100), 500, { marginTop: 14, letterSpacing: '0.04em' })}>{category}</div>
      <div style={serif(30, 700, { marginTop: 70, letterSpacing: '0.3em', color: A.barkSoft })}>{count} {count === 1 ? 'EVENT' : 'EVENTS'} INSIDE</div>
    </div>
  </div>
);

// Torn paper is not cut paper: the tear exposes the pale fibres inside the sheet, so each torn edge carries
// a ragged light rim, with a few loose fibres standing off it.
const FIBRES = (() => {
  let s = 23; const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  return RIP.slice(1, -1).flatMap(([x, y]) => Array.from({ length: 2 }, () => {
    const a = (rnd() - 0.5) * 2.4, len = 6 + rnd() * 12;
    return `M${x.toFixed(1)},${(y + rnd() * 20).toFixed(1)} l${(Math.cos(a) * len).toFixed(1)},${(Math.sin(a) * len).toFixed(1)}`;
  })).join(' ');
})();
const TornEdge = () => (
  <svg width={BW} height={BH} style={{ position: 'absolute', inset: 0 }}>
    <path d={ripPath} stroke="#ecdcbc" strokeWidth={13} fill="none" strokeLinejoin="round" />
    <path d={ripPath} stroke="#f6ead2" strokeWidth={5} fill="none" strokeLinejoin="round" strokeDasharray="9 5" />
    <path d={FIBRES} stroke="#efe0c2" strokeWidth={1.4} fill="none" opacity={0.85} />
  </svg>
);

// The paper tag tied to the bag with twine: a small cream label with the day on it.
const TAG_W = 250, TAG_H = 130;
const Tag = ({ day, date }: { day: string; date: string }) => (
  <div style={{ width: TAG_W, height: TAG_H, background: `${grain(0.12)}, ${A.cream}`, borderRadius: 10, position: 'relative',
    clipPath: 'polygon(14% 0, 100% 0, 100% 100%, 14% 100%, 0 50%)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', paddingLeft: 30 }}>
    <div style={{ position: 'absolute', left: 30, top: TAG_H / 2 - 11, width: 22, height: 22, borderRadius: 11, background: A.soil, opacity: 0.8 }} />
    <div style={serif(fit(day, 44, 280), 700, { letterSpacing: '0.1em' })}>{day.slice(0, 3)}</div>
    <div style={serif(24, 600, { letterSpacing: '0.16em', color: A.barkSoft, marginTop: 6 })}>{date.split(' ').map(w => w.slice(0, 3)).join(' ')}</div>
  </div>
);

export const HarvestBagStory = ({ day, date, kicker, category, count, sheet }: AutumnOpenerProps) => {
  const frame = useCurrentFrame();
  const settle = range(frame, T.settle, Easing.elastic(0.9));
  const tug = Math.sin(range(frame, T.tug) * Math.PI);
  const rip = range(frame, T.rip, Easing.bezier(0.7, 0, 0.3, 1));
  const fall = range(frame, T.fall, Easing.bezier(0.5, 0, 0.9, 0.6)); // gravity: slow to start, then gone
  const reveal = range(frame, T.reveal, Easing.bezier(0.4, 0, 0.2, 1));
  const tagFall = range(frame, T.tag, Easing.bezier(0.3, 0, 0.2, 1));
  const band = range(frame, T.band, Easing.bezier(0.2, 0.9, 0.2, 1));
  const bagY = lerp(-70, 0, settle) + tug * 12, squash = 1 - tug * 0.02;
  const split = frame >= T.fall[0];
  const shadow = 'drop-shadow(0 40px 60px rgba(0,0,0,0.5))';
  // The tag hangs off the bag's top right on its twine, then drops into the footer and stretches into the band.
  const tagX = lerp(LEFT + BW - 170, 1080 / 2 - TAG_W / 2, tagFall), tagY = lerp(TOP + bagY + 40, 1920 - BAR_H + 20, tagFall);
  const tagSpin = lerp(14 + tug * 8, 0, tagFall);

  return (
    <AbsoluteFill style={{ background: A.soil, overflow: 'hidden' }}>
      <AbsoluteFill style={{ transform: `scale(${lerp(1.08, 1, reveal)})` }}>
        <Img src={sheetSrc(sheet)} style={{ width: 1080, height: 1920, objectFit: 'cover' }} />
      </AbsoluteFill>
      <AbsoluteFill style={{ background: `radial-gradient(110% 80% at 50% 40%, #3a2413 0%, ${A.soil} 70%)`, opacity: 1 - reveal }} />

      {!split ? (
        <div style={{ position: 'absolute', left: LEFT, top: TOP + bagY, filter: shadow, transformOrigin: '50% 100%', transform: `scale(${squash}, ${2 - squash})` }}>
          <Bag day={day} date={date} kicker={kicker} category={category} count={count} />
          {/* The rip travelling down the bag: pale fibres open first, then the dark gap between them. */}
          <svg width={BW} height={BH} style={{ position: 'absolute', inset: 0 }}>
            <path d={ripPath} stroke="#ecdcbc" strokeWidth={4 + rip * 12} fill="none" strokeLinejoin="round" pathLength={1} strokeDasharray={`${rip} 1`} />
            <path d={ripPath} stroke={A.soil} strokeWidth={1 + rip * 5} fill="none" strokeLinejoin="round" pathLength={1} strokeDasharray={`${Math.max(0, rip - 0.04)} 1`} />
          </svg>
        </div>
      ) : (
        // The halves peel apart: each swings out about its outer edge like a door, curling away from the
        // camera (rotateY), leaning out (rotateZ), and then gravity takes it. The torn rims stay on them.
        (['left', 'right'] as const).map(side => {
          const k = side === 'left' ? -1 : 1;
          const swing = lerp(0, 62, Math.min(1, fall * 1.6)), lean = lerp(1, 18, fall);
          return (
            <div key={side} style={{ position: 'absolute', left: LEFT, top: TOP + bagY, perspective: 1800,
              transform: `translate(${k * lerp(8, 260, fall)}px, ${lerp(0, 1650, fall * fall)}px) rotate(${k * lean}deg)`,
              transformOrigin: `${side === 'left' ? 0 : BW}px ${BH}px` }}>
              <div style={{ filter: shadow, transformOrigin: `${side === 'left' ? 0 : BW}px 50%`, transform: `rotateY(${-k * swing}deg)` }}>
                <div style={{ clipPath: halfClip(side), position: 'relative' }}>
                  <Bag day={day} date={date} kicker={kicker} category={category} count={count} />
                  <TornEdge />
                  {/* The half turns away from the light as it swings: shade it with the angle. */}
                  <div style={{ position: 'absolute', inset: 0, background: '#1c0f06', opacity: 0.45 * Math.sin((swing * Math.PI) / 180) }} />
                </div>
              </div>
            </div>
          );
        })
      )}

      {/* The twine, from the bag's corner to the tag, while they are still together. */}
      {tagFall < 0.3 && (
        <svg width={1080} height={1920} style={{ position: 'absolute', inset: 0, opacity: 1 - tagFall / 0.3 }}>
          <path d={`M${LEFT + BW - 70},${TOP + bagY + 30} Q${LEFT + BW - 110},${TOP + bagY + 70} ${tagX + 36},${tagY + TAG_H / 2}`} stroke="#8a6a44" strokeWidth={4} fill="none" />
        </svg>
      )}
      {band < 1 && (
        <div style={{ position: 'absolute', left: tagX, top: tagY, filter: 'drop-shadow(0 16px 20px rgba(0,0,0,0.35))',
          transform: `rotate(${tagSpin}deg) scale(${lerp(1, 1.25, band)})`, opacity: 1 - band }}>
          <Tag day={day} date={date} />
        </div>
      )}
      {/* Sound: the bag landing, the strain, the rip down it, the halves fluttering away, the band. */}
      <Sfx at={3} name="bag-land" volume={0.6} />
      <Sfx at={T.tug[0]} name="bag-tug" volume={0.6} />
      <Sfx at={T.rip[0] - 2} name="bag-rip" volume={0.9} />
      <Sfx at={T.fall[0]} name="pin-flutter-1" volume={0.45} />
      <Sfx at={T.fall[0] + 5} name="pin-flutter-2" volume={0.35} />
      <Sfx at={T.band[0]} name="paper-slide" volume={0.45} />
      <Band day={day} date={date} category={category} grow={band} />
    </AbsoluteFill>
  );
};
