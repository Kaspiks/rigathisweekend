// Story opener for hands-on weekends: a cork noticeboard in a community centre. Flyers for classes are put up
// one after another (each comes in toward the board, gets pinned, and swings a little on its pin before it
// settles), then the day's card on top. Then the day's grid cards go up the same way, one by one over the lot,
// each pinned exactly where it sits in the grid, until the board is covered.
import { AbsoluteFill, Easing, Img, useCurrentFrame } from 'remotion';
import { A, AUTUMN_FPS, Band, CardSlice, fit, grain, gridCells, lerp, range, script, serif, sheetSrc, type AutumnOpenerProps } from './autumnOpener';

const T = {
  flyers: [0, 26], // four flyers and the day card go up
  cards: [30, 58],  // the grid's cards go up, one by one
  sheet: [72, 80],  // the gaps between them take the grid's colour
  band: [74, 90],
} as const;
export const PINBOARD_OPEN_FRAMES = T.band[1];
export const pinboardDuration = (holdSeconds: number) => PINBOARD_OPEN_FRAMES + Math.round(Math.max(1, holdSeconds) * AUTUMN_FPS);

const FALL = 7; // frames from a hand's reach to the cork

type Flyer = { x: number; y: number; w: number; h: number; rot: number; paper: string; tack: string; at: number;
  kind: string; title: string; icon: 'brush' | 'note' | 'pencil' | 'hand'; tabs?: boolean };
const FLYERS: Flyer[] = [
  { x: 70, y: 170, w: 400, h: 520, rot: -5, paper: '#f4efe4', tack: '#c0392b', at: 0, kind: 'CLASS', title: 'Painting\nfor beginners', icon: 'brush' },
  { x: 600, y: 120, w: 390, h: 500, rot: 4, paper: '#f2d98a', tack: '#2f5aa0', at: 5, kind: 'EVENING', title: 'Folk dance\nno partner needed', icon: 'note' },
  { x: 60, y: 1230, w: 420, h: 520, rot: 3, paper: '#d3e3d9', tack: '#d39a2a', at: 10, kind: 'WORKSHOP', title: 'Drawing\nbring a pencil', icon: 'pencil', tabs: true },
  { x: 590, y: 1270, w: 400, h: 470, rot: -6, paper: '#f3c6b0', tack: '#2f7f7a', at: 15, kind: 'FAMILIES', title: 'Art morning\nages 4–9', icon: 'hand', tabs: true },
];
const CARD = { x: 130, y: 640, w: 820, h: 660, rot: -1.5, tack: '#c0392b', at: 14 };

// Old pin holes from notices long gone, so the board has been used before.
const HOLES = (() => {
  let s = 17; const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  return Array.from({ length: 70 }, () => [rnd() * 1080, rnd() * 1920, 1.5 + rnd() * 2]);
})();
const CORK = `url("data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="500" height="500"><filter id="c"><feTurbulence type="fractalNoise" baseFrequency="0.22" numOctaves="4" seed="4" result="n"/><feColorMatrix in="n" values="0 0 0 0 0.25  0 0 0 0 0.14  0 0 0 0 0.06  0 0 0 -3.2 2.1"/></filter><filter id="l"><feTurbulence type="fractalNoise" baseFrequency="0.5" numOctaves="2" seed="9"/><feColorMatrix values="0 0 0 0 0.95  0 0 0 0 0.8  0 0 0 0 0.6  0 0 0 -4 2.3"/></filter><rect width="500" height="500" filter="url(#c)"/><rect width="500" height="500" filter="url(#l)" opacity="0.5"/></svg>')}")`;

// Height above the board, 1 at arm's length to 0 on the cork, falling faster as it goes (it's pressed on).
const heightAt = (frame: number, at: number) => 1 - range(frame, [at, at + FALL], Easing.in(Easing.quad));
// After it's pinned at the top it swings on the pin, less each time: a damped pendulum.
const swing = (frame: number, at: number, amp: number) => {
  const dt = frame - (at + FALL);
  return dt <= 0 ? amp : amp * Math.exp(-dt / 5) * Math.cos(dt * 0.75);
};

const Tack = ({ color, press }: { color: string; press: number }) => (
  <div style={{ position: 'absolute', left: -21, top: -21, width: 42, height: 42, transform: `scale(${lerp(1.5, 1, press)})`, opacity: Math.min(1, press * 3) }}>
    <div style={{ position: 'absolute', left: 8 + lerp(20, 4, press), top: 10 + lerp(24, 6, press), width: 38, height: 30, borderRadius: '50%',
      background: 'rgba(30,15,5,0.45)', filter: `blur(${lerp(10, 3, press)}px)` }} />
    <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: `radial-gradient(circle at 35% 30%, rgba(255,255,255,0.75), rgba(255,255,255,0) 30%), radial-gradient(circle at 50% 60%, ${color}, #000 140%)` }} />
  </div>
);

const Icon = ({ icon }: { icon: Flyer['icon'] }) => (
  <svg width={140} height={140} viewBox="0 0 100 100" style={{ opacity: 0.85 }}>
    <g fill="none" stroke={A.bark} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round">
      {icon === 'brush' && <><path d="M70,14 L40,58" strokeWidth={7} /><path d="M40,58 C28,60 22,70 20,86 C34,84 46,78 48,64 Z" fill={A.rust} /></>}
      {icon === 'note' && <><path d="M34,72 L34,22 L76,14 L76,64" /><ellipse cx={26} cy={74} rx={10} ry={8} fill={A.bark} /><ellipse cx={68} cy={66} rx={10} ry={8} fill={A.bark} /></>}
      {icon === 'pencil' && <><path d="M22,78 L70,30 L80,40 L32,88 L18,92 Z" /><path d="M62,38 L72,48" /></>}
      {icon === 'hand' && <path d="M34,90 C22,76 18,62 22,52 L30,40 L34,52 L34,20 C34,14 42,14 42,20 L42,44 L44,14 C44,8 52,8 52,14 L52,44 L56,18 C56,12 64,12 64,18 L62,46 L68,28 C70,22 78,24 76,30 L70,60 C68,76 62,86 54,90 Z" fill={A.amber} />}
    </g>
  </svg>
);

const FlyerFace = ({ f }: { f: Flyer }) => (
  <div style={{ position: 'absolute', inset: 0, background: `${grain(0.12)}, ${f.paper}`, padding: '60px 38px 0', display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
    <div style={serif(24, 700, { letterSpacing: '0.34em', color: A.rust })}>{f.kind}</div>
    {f.title.split('\n').map((line, i) => (
      <div key={i} style={serif(i ? 32 : 58, i ? 500 : 700, { marginTop: i ? 14 : 18, whiteSpace: 'normal' })}>{line}</div>
    ))}
    <div style={{ marginTop: 26 }}><Icon icon={f.icon} /></div>
    {f.tabs && (
      // Tear-off strips along the bottom, one already taken.
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 120, display: 'flex' }}>
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} style={{ flex: 1, borderLeft: i ? `2px dashed rgba(46,27,16,0.35)` : undefined, borderTop: `2px dashed rgba(46,27,16,0.35)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', visibility: i === 5 ? 'hidden' : 'visible' }}>
            <div style={serif(16, 700, { transform: 'rotate(-90deg)', letterSpacing: '0.12em', color: A.barkSoft })}>RĪGA WKND</div>
          </div>
        ))}
      </div>
    )}
  </div>
);

// Paper put up on the board: coming in toward the cork it is bigger and its shadow wide, soft and offset;
// on the cork the shadow is tight. Pinned at the top, the bottom swings on the pin, and the tack goes in last.
const Pinned = ({ frame, x, y, w, h, rot, at, tack, amp = 5, children }: { frame: number; x: number; y: number; w: number; h: number; rot: number; at: number; tack: string; amp?: number; children: React.ReactNode }) => {
  if (frame < at) return null;
  const hgt = heightAt(frame, at);
  const r = rot + swing(frame, at, amp);
  const press = range(frame, [at + FALL, at + FALL + 3], Easing.out(Easing.quad));
  return (
    <div style={{ position: 'absolute', left: x, top: y, width: w, height: h, transformOrigin: '50% 30px',
      transform: `rotate(${r}deg) scale(${1 + 0.24 * hgt})`,
      filter: `drop-shadow(${(8 + 40 * hgt).toFixed(1)}px ${(14 + 60 * hgt).toFixed(1)}px ${(8 + 30 * hgt).toFixed(1)}px rgba(30,15,5,${(0.5 - 0.2 * hgt).toFixed(2)}))` }}>
      {children}
      {/* Pinned only at the top, the paper lifts off the cork a little toward the bottom. */}
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(0,0,0,0) 55%, rgba(40,20,5,0.1))' }} />
      <div style={{ position: 'absolute', left: w / 2, top: 30 }}><Tack color={tack} press={press} /></div>
    </div>
  );
};

export const PinboardStory = ({ day, date, kicker, category, count, sheet }: AutumnOpenerProps) => {
  const frame = useCurrentFrame();
  const band = range(frame, T.band, Easing.bezier(0.2, 0.9, 0.2, 1));
  const sheetIn = range(frame, T.sheet, Easing.inOut(Easing.quad));
  const cells = gridCells(count);
  const per = cells.length > 1 ? (T.cards[1] - T.cards[0]) / (cells.length - 1) : 0;
  const TACKS = ['#c0392b', '#2f5aa0', '#d39a2a', '#2f7f7a', '#6d3b63', '#c0392b'];

  return (
    <AbsoluteFill style={{ background: '#a67a4e', overflow: 'hidden', perspective: 4200, perspectiveOrigin: '50% 0' }}>
      <AbsoluteFill style={{ background: `${CORK}, #b48656` }} />
      <svg width={1080} height={1920} style={{ position: 'absolute', inset: 0 }}>
        {HOLES.map(([x, y, r], i) => <circle key={i} cx={x} cy={y} r={r} fill="#3a2410" opacity={0.55} />)}
      </svg>
      <AbsoluteFill style={{ background: 'radial-gradient(120% 90% at 40% 30%, rgba(255,230,190,0.18), rgba(30,15,5,0.4))' }} />

      {FLYERS.map((f, i) => (
        <Pinned key={i} frame={frame} {...f}>
          <FlyerFace f={f} />
        </Pinned>
      ))}
      <Pinned frame={frame} {...CARD}>
        <div style={{ position: 'absolute', inset: 0, background: `${grain(0.12)}, ${A.cream}`, border: `3px solid ${A.rust}`, outline: `10px solid ${A.cream}`,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <div style={serif(30, 700, { letterSpacing: '0.34em', marginRight: '-0.34em', color: A.rust })}>RĪGA · THIS WEEKEND</div>
          <div style={serif(fit(day, 130, 720), 700, { marginTop: 30, letterSpacing: '0.08em', marginRight: '-0.08em' })}>{day}</div>
          <div style={serif(52, 600, { marginTop: 18, letterSpacing: '0.2em', marginRight: '-0.2em' })}>{date}</div>
          <div style={{ ...script(116), marginTop: 36 }}>{kicker}</div>
          <div style={serif(fit(category, 56, 960), 500, { marginTop: 10 })}>{category}</div>
          <div style={serif(26, 700, { marginTop: 40, letterSpacing: '0.3em', marginRight: '-0.3em', color: A.barkSoft })}>{count} {count === 1 ? 'THING' : 'THINGS'} TO JOIN IN</div>
        </div>
      </Pinned>

      {/* Once the cards are all up, the gaps between them take the grid's own colour. */}
      {sheetIn > 0 && (
        <AbsoluteFill style={{ opacity: sheetIn }}>
          <Img src={sheetSrc(sheet)} style={{ width: 1080, height: 1920 }} />
        </AbsoluteFill>
      )}
      {cells.map((c, i) => (
        // Cards hang straight but still swing a little on their pin, the wide ones less.
        <Pinned key={i} frame={frame} x={c.left} y={c.top} w={c.width} h={c.height} rot={0} at={T.cards[0] + i * per}
          tack={TACKS[i % TACKS.length]} amp={c.width > 600 ? 1.6 : 3}>
          <CardSlice sheet={sheet} cell={c} />
        </Pinned>
      ))}
      <Band day={day} date={date} category={category} grow={band} accent={A.rust} />
    </AbsoluteFill>
  );
};
