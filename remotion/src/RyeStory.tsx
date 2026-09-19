// Story opener for a single event: a slice of rye, buttered. The knife sweeps across the face and the
// spread it leaves behind is the reveal — the card is under the butter. The bottom crust never gets
// buttered, so it stays, drops to the strip the grid keeps clear and stretches into the footer bar,
// the same move the ticket stub makes.
import '@fontsource/cormorant-garamond/500.css';
import '@fontsource/cormorant-garamond/600.css';
import '@fontsource/cormorant-garamond/700.css';
import '@fontsource/great-vibes/400.css';
import type { CSSProperties } from 'react';
import { AbsoluteFill, Easing, Img, continueRender, delayRender, interpolate, staticFile, useCurrentFrame } from 'remotion';

const fonts = delayRender('Loading rye fonts');
Promise.all([
  document.fonts.load('700 130px "Cormorant Garamond"'),
  document.fonts.load('600 64px "Cormorant Garamond"'),
  document.fonts.load('500 34px "Cormorant Garamond"'),
  document.fonts.load('96px "Great Vibes"'),
]).then(() => continueRender(fonts));

// `sheet` is a file in public/ or a full URL: the 1080x1920 card the butter uncovers.
export type RyeStoryProps = { day: string; date: string; number: string; title: string; kicker: string; time: string; price: string; sheet: string; holdSeconds: number };

export const RYE_FPS = 30;
const T = {
  settle: [0, 18],  // the slice drops onto the board and wobbles: legible on frame 0
  knife:  [8, 22],  // the knife comes in from the left and lays down on the crumb
  smear:  [22, 52], // the sweep. Behind its front the crumb is butter, and the butter is the card
  exit:   [48, 62], // the knife carries on off the right edge
  reveal: [36, 56], // the backdrop gives way once the sweep is most of the way across
  fall:   [50, 68], // the bare crust drops to the strip the grid keeps clear
  band:   [62, 78], // the landed crust stretches into the full-width footer
} as const;
export const RYE_OPEN_FRAMES = T.band[1];
export const ryeDuration = (holdSeconds: number) => RYE_OPEN_FRAMES + Math.round(Math.max(1, holdSeconds) * RYE_FPS);

const GREEN = '#17352d', DEEP = '#0f241e', LIME = '#d4ed86', CREAM = '#f7f4ec';
const CRUST = '#2b1a0f', BUTTER = '#f4e6b4';

const serif = (size: number, weight = 600, extra: CSSProperties = {}): CSSProperties => ({ fontFamily: '"Cormorant Garamond"', fontWeight: weight, fontSize: size, lineHeight: 1, color: CREAM, fontVariantNumeric: 'lining-nums', whiteSpace: 'nowrap', ...extra });
const script = (size: number): CSSProperties => ({ fontFamily: '"Great Vibes"', fontSize: size, lineHeight: 1, color: LIME, whiteSpace: 'nowrap' });
// Long words shrink to fit the slice instead of running past the crust.
const fit = (text: string, max: number, budget: number) => Math.min(max, budget / Math.max(1, text.length));

const TEX = 900;
const tex = (freq: number, oct: number, seed: number, m: string) =>
  `url("data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${TEX}" height="${TEX}"><filter id="f"><feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="${oct}" seed="${seed}"/><feColorMatrix values="${m}"/></filter><rect width="${TEX}" height="${TEX}" filter="url(#f)"/></svg>`)}")`;
// The crumb. A hole in rye crumb is a shadow with a lit rim just below it, so every pore here is two
// turbulence layers from the same seed — a dark one and a pale one nudged down and right. The alpha
// row of the colour matrix is what makes them pores at all: a steep slope with a large negative offset
// keeps only the peaks of the noise, so the result is scattered holes and not an even speckle.
const speck = (freq: number, seed: number, m: string) => tex(freq, 4, seed, m);
const DARK = '0 0 0 0 0.05  0 0 0 0 0.032  0 0 0 0 0.016  0 0 0 2.6 -1.12';
const LITE = '0 0 0 0 0.74  0 0 0 0 0.57  0 0 0 0 0.38  0 0 0 1.05 -0.62';
const PORE_D = speck(0.05, 21, DARK), PORE_L = speck(0.05, 21, LITE);
const HOLE_D = speck(0.022, 7, '0 0 0 0 0.04  0 0 0 0 0.025  0 0 0 0 0.012  0 0 0 3.4 -1.72');
const HOLE_L = speck(0.022, 7, '0 0 0 0 0.72  0 0 0 0 0.55  0 0 0 0 0.38  0 0 0 1.3 -0.86');
const GRAIN = tex(0.9, 3, 4, '0 0 0 0 0.9  0 0 0 0 0.8  0 0 0 0 0.6  0 0 0 0.18 0');
const BAKE = tex(0.006, 2, 15, '0 0 0 0 0.10  0 0 0 0 0.07  0 0 0 0 0.04  0 0 0 0.3 -0.12');
const layers = (grad: string) => `${HOLE_D} 0 0, ${HOLE_L} 5px 7px, ${PORE_D} 0 0, ${PORE_L} 3px 4px, ${GRAIN} 0 0, ${BAKE} 0 0, ${grad}`;
const CRUMB = layers('linear-gradient(158deg, #7d5333 0%, #674229 46%, #50311c 100%)');
// The bottom crust of a tin loaf is almost black, which is also what makes the footer bar legible.
const CRUST_FILL = layers('linear-gradient(160deg, #40261a 0%, #2a180e 55%, #190e07 100%)');

const W = 840, H = 1180, LEFT = (1080 - W) / 2, TOP = 300;
const FACE_H = 980, STRIP_H = H - FACE_H;
// The grid leaves this strip clear (BAR_H in src/grids.js): the crust lands there and stays.
const BAR_H = 190, STRIP_REST = 1920 - BAR_H - (STRIP_H - BAR_H) / 2;

const maskUrl = (w: number, h: number, d: string) =>
  `url("data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><path d="${d}" fill="#fff"/></svg>`)}")`;

// The slice outline. A rounded rect walked from the bottom-left corner up, over the top and down the
// right, with every point nudged along its outward normal by a smooth seeded wobble — a tin loaf is
// square-ish but never straight. The base rect is inset by AMP so the wobble cannot clip on the edges.
const AMP = 17, INSET = AMP, CORNER = 76, CTRL = 13;
const WOB = (() => { let s = 11; return Array.from({ length: CTRL }, () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648 - 0.5) * 2); })();
const wobbleAt = (u: number) => {
  const x = ((u % 1) + 1) * CTRL, i = Math.floor(x), f = x - i;
  const a = WOB[i % CTRL], b = WOB[(i + 1) % CTRL];
  return a + (b - a) * (1 - Math.cos(f * Math.PI)) / 2; // cosine blend keeps the crust smooth, not spiky
};
const facePath = (() => {
  const l = INSET, r = W - INSET, t = INSET, pts: string[] = [];
  const at = (x: number, y: number, nx: number, ny: number, u: number) => {
    const d = AMP * wobbleAt(u);
    pts.push(`${(x + nx * d).toFixed(1)},${(y + ny * d).toFixed(1)}`);
  };
  for (let i = 0; i <= 24; i++) { const k = i / 24; at(l, FACE_H - k * (FACE_H - t - CORNER), -1, 0, k * 0.28); }
  for (let i = 1; i <= 9; i++) { const a = Math.PI + (i / 9) * (Math.PI / 2); at(l + CORNER + Math.cos(a) * CORNER, t + CORNER + Math.sin(a) * CORNER, Math.cos(a), Math.sin(a), 0.28 + (i / 9) * 0.06); }
  for (let i = 1; i <= 24; i++) { const k = i / 24; at(l + CORNER + k * (r - l - 2 * CORNER), t, 0, -1, 0.34 + k * 0.3); }
  for (let i = 1; i <= 9; i++) { const a = -Math.PI / 2 + (i / 9) * (Math.PI / 2); at(r - CORNER + Math.cos(a) * CORNER, t + CORNER + Math.sin(a) * CORNER, Math.cos(a), Math.sin(a), 0.64 + (i / 9) * 0.06); }
  for (let i = 1; i <= 24; i++) { const k = i / 24; at(r, t + CORNER + k * (FACE_H - t - CORNER), 1, 0, 0.7 + k * 0.28); }
  return `M${pts.join(' L')} L${W},${FACE_H} L0,${FACE_H} Z`;
})();
const FACE_MASK = maskUrl(W, FACE_H, facePath);

// The butter's leading edge: a wavy vertical line at the sweep's front. Two sines, so it reads as a
// ridge of spread being pushed along rather than a straight wipe.
const frontEdge = (front: number) => {
  const pts: string[] = [];
  for (let i = 0; i <= 26; i++) {
    const k = i / 26;
    pts.push(`${(front + 30 * Math.sin(k * 7.4 + 1.3) + 13 * Math.sin(k * 19.7 + 0.4)).toFixed(1)},${(k * FACE_H).toFixed(1)}`);
  }
  return pts;
};
// What is still crumb: everything right of the front. Left of it the face is gone and the card shows.
const dryMask = (front: number) => front <= 0 ? 'none' : maskUrl(W, FACE_H, `M${frontEdge(front).join(' L')} L${W + 80},${FACE_H} L${W + 80},0 Z`);
const wetMask = (front: number) => maskUrl(W, FACE_H, `M${frontEdge(front).join(' L')} L-80,${FACE_H} L-80,0 Z`);

const range = (frame: number, [a, b]: readonly [number, number], easing = Easing.bezier(0.65, 0, 0.35, 1)) =>
  interpolate(frame, [a, b], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing });
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const Face = ({ title, kicker, time, price }: Pick<RyeStoryProps, 'title' | 'kicker' | 'time' | 'price'>) => (
  <div style={{ position: 'relative', width: W, height: FACE_H, background: CRUMB }}>
    {/* The crust, drawn as a stroke on the outline: the mask clips its outer half, leaving a rim that
        follows every wobble instead of a border that follows the box. */}
    <svg width={W} height={FACE_H} style={{ position: 'absolute', inset: 0 }}>
      <path d={facePath} fill="none" stroke="#000" strokeOpacity={0.3} strokeWidth={90} style={{ filter: 'blur(26px)' }} />
      <path d={facePath} fill="none" stroke={CRUST} strokeWidth={58} />
      <path d={facePath} fill="none" stroke="#b07c4f" strokeOpacity={0.45} strokeWidth={7} style={{ transform: 'scale(0.962)', transformOrigin: '50% 50%' }} />
    </svg>
    <div style={{ position: 'absolute', left: 0, right: 0, top: 96, display: 'flex', flexDirection: 'column', alignItems: 'center', textShadow: '0 3px 10px rgba(0,0,0,0.55)' }}>
      <div style={{ background: GREEN, padding: '13px 32px', borderRadius: 40, ...serif(32, 700, { color: LIME, letterSpacing: '0.34em', marginRight: '-0.34em', textShadow: 'none' }) }}>TASTE ONE</div>
      <div style={serif(34, 600, { marginTop: 42, letterSpacing: '0.3em', marginRight: '-0.3em', color: '#e6d9bd' })}>RĪGA · THIS WEEKEND</div>
      <div style={serif(fit(title, 138, 880), 700, { marginTop: 40, height: 148, display: 'flex', alignItems: 'center', letterSpacing: '0.06em', marginRight: '-0.06em' })}>{title}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 22, marginTop: 30 }}>
        <span style={{ width: 88, height: 2, background: '#e6d9bd66' }} /><span style={{ width: 14, height: 14, transform: 'rotate(45deg)', background: LIME }} /><span style={{ width: 88, height: 2, background: '#e6d9bd66' }} />
      </div>
      <div style={{ ...script(104), marginTop: 34 }}>{kicker}</div>
      <div style={serif(62, 600, { marginTop: 40, letterSpacing: '0.16em', marginRight: '-0.16em' })}>{time}</div>
      <div style={serif(46, 600, { marginTop: 20, letterSpacing: '0.22em', marginRight: '-0.22em', color: LIME })}>{price}</div>
    </div>
  </div>
);

// `morph` stretches the bare crust into the footer: the box, the padding and the type all grow into
// their new size, so the crust becomes the bar rather than dissolving into it.
const Crust = ({ day, date, number, morph }: Pick<RyeStoryProps, 'day' | 'date' | 'number'> & { morph: number }) => (
  <div style={{
    position: 'relative', width: '100%', height: '100%', background: CRUST_FILL,
    boxShadow: `inset 0 ${lerp(26, 0, morph).toFixed(0)}px 34px rgba(0,0,0,0.5), inset 0 -20px 30px rgba(0,0,0,0.45)`,
    borderRadius: `0 0 ${lerp(34, 0, morph).toFixed(0)}px ${lerp(34, 0, morph).toFixed(0)}px`,
    borderTop: `${(4 * morph).toFixed(1)}px solid ${LIME}`,
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: `0 ${lerp(72, 64, morph).toFixed(1)}px`,
  }}>
    {/* Left: the serial while it is still a piece of crust, the day once it is the footer. The two
        never overlap — the serial is gone by halfway and the day only arrives after that. */}
    <div style={{ position: 'relative', flex: 1, height: lerp(150, 118, morph) }}>
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', opacity: Math.max(0, 1 - morph * 2) }}>
        <div style={serif(26, 600, { letterSpacing: '0.28em', color: '#e6d9bd' })}>NO.</div>
        <div style={serif(76, 700, { letterSpacing: '0.06em', marginTop: 6 })}>{number}</div>
      </div>
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', opacity: Math.max(0, morph * 2 - 1.04) }}>
        <div style={serif(fit(day, 62, 600), 700, { letterSpacing: '0.12em' })}>{day}</div>
        <div style={serif(29, 600, { letterSpacing: '0.2em', color: '#e6d9bd', marginTop: 8 })}>{date} · FOOD & HUMOUR</div>
      </div>
    </div>
    <div style={{ display: 'flex', gap: lerp(5, 4, morph), height: lerp(110, 88, morph) }}>
      {[6, 2, 4, 2, 8, 3, 2, 6, 2, 4, 7, 2, 3, 5, 2, 6, 3, 2, 8, 2, 4].map((w, i) => <span key={i} style={{ width: w, background: CREAM }} />)}
    </div>
  </div>
);

export const RyeStory = ({ day, date, number, title, kicker, time, price, sheet, holdSeconds: _hold }: RyeStoryProps) => {
  const frame = useCurrentFrame();
  const src = /^https?:\/\//.test(sheet) ? sheet : staticFile(sheet);

  const settle = range(frame, T.settle, Easing.elastic(0.8));
  const knifeIn = range(frame, T.knife);
  // The sweep resists, gives, then eases out — the way a cold pat of butter actually spreads.
  const smear = range(frame, T.smear, Easing.bezier(0.5, 0, 0.3, 1));
  const front = smear * (W + 90);
  const exit = range(frame, T.exit, Easing.bezier(0.4, 0, 0.9, 0.5));
  const reveal = range(frame, T.reveal, Easing.bezier(0.4, 0, 0.2, 1));
  const fall = range(frame, T.fall, Easing.bezier(0.3, 0, 0.2, 1));
  const morph = range(frame, T.band, Easing.bezier(0.2, 0.9, 0.2, 1));

  // The slice settles before the butter opens any window on the card, so by the time the two layers
  // have to line up this transform is already the identity and nothing drifts out of register.
  const landY = lerp(-60, 0, settle), landScale = lerp(1.05, 1, settle), landTilt = lerp(-4.5, 0, settle);
  const faceT = `translateY(${landY.toFixed(1)}px) scale(${landScale.toFixed(4)}) rotate(${landTilt.toFixed(2)}deg)`;

  const knifeX = lerp(LEFT - 820, LEFT, knifeIn) + front + lerp(0, 560, exit);
  const knifeY = TOP + FACE_H * 0.46 + lerp(120, 0, knifeIn) + lerp(0, -260, exit);
  const knifeA = lerp(46, 21, knifeIn) + lerp(0, 16, exit);
  // The ridge is butter being pushed along; once there is no crumb left in front of it, there is no ridge.
  const ridge = 1 - range(frame, [T.smear[0] + (T.smear[1] - T.smear[0]) * 0.72, T.smear[1]]);

  return (
    <AbsoluteFill style={{ background: DEEP, overflow: 'hidden' }}>
      {/* The card waits underneath, pushed in a little so it settles as the butter uncovers it. */}
      <AbsoluteFill style={{ transform: `scale(${lerp(1.07, 1, reveal)})` }}>
        <Img src={src} style={{ width: 1080, height: 1920, objectFit: 'cover' }} />
      </AbsoluteFill>
      <AbsoluteFill style={{ background: `radial-gradient(120% 80% at 50% 40%, #21473c 0%, ${GREEN} 55%, ${DEEP} 100%)`, opacity: 1 - reveal }} />

      {/* Buttered: the card again, cut to the slice and to the part the knife has already passed. Two
          nested masks intersect, which one path with even-odd cannot do without tearing at the corners. */}
      {smear > 0 && smear < 1 && (
        <div style={{ position: 'absolute', left: LEFT, top: TOP, width: W, height: FACE_H, transform: faceT, WebkitMaskImage: wetMask(front), WebkitMaskSize: '100% 100%' }}>
          <div style={{ position: 'absolute', inset: 0, WebkitMaskImage: FACE_MASK, WebkitMaskSize: '100% 100%' }}>
            <Img src={src} style={{ position: 'absolute', left: -LEFT, top: -TOP, width: 1080, height: 1920, objectFit: 'cover' }} />
          </div>
        </div>
      )}

      {/* Still dry: the crumb the knife has not reached. */}
      {smear < 1 && (
        <div style={{ position: 'absolute', left: LEFT, top: TOP, width: W, height: FACE_H, transform: faceT, WebkitMaskImage: dryMask(front), WebkitMaskSize: '100% 100%' }}>
          <div style={{ position: 'absolute', inset: 0, WebkitMaskImage: FACE_MASK, WebkitMaskSize: '100% 100%' }}>
            <Face title={title} kicker={kicker} time={time} price={price} />
          </div>
        </div>
      )}

      {/* The ridge of spread riding the front, clipped to the slice so it never laps over the crust. */}
      {smear > 0 && ridge > 0 && (
        <div style={{ position: 'absolute', left: LEFT, top: TOP, width: W, height: FACE_H, transform: faceT, WebkitMaskImage: FACE_MASK, WebkitMaskSize: '100% 100%' }}>
          <svg width={W} height={FACE_H}>
            <path d={`M${frontEdge(front).join(' L')}`} fill="none" stroke={BUTTER} strokeWidth={30} strokeLinecap="round" opacity={0.95 * ridge} />
            <path d={`M${frontEdge(front - 26).join(' L')}`} fill="none" stroke={BUTTER} strokeWidth={12} strokeLinecap="round" opacity={0.4 * ridge} />
          </svg>
        </div>
      )}

      {/* The crust: never buttered, so it is still there when the face is gone. It drops to the strip
          the grid keeps clear, then stretches into the footer. */}
      <div style={{
        position: 'absolute',
        left: lerp(LEFT, 0, morph),
        top: lerp(lerp(TOP + FACE_H + landY, STRIP_REST, fall), 1920 - BAR_H, morph),
        width: lerp(W, 1080, morph), height: lerp(STRIP_H, BAR_H, morph),
        transformOrigin: '50% 0',
        transform: `scale(${lerp(landScale, 1, Math.max(fall, morph))}) rotate(${lerp(landTilt, 0, fall).toFixed(2)}deg)`,
        filter: `drop-shadow(0 ${lerp(34, 8, morph).toFixed(0)}px ${lerp(54, 20, morph).toFixed(0)}px rgba(0,0,0,${lerp(0.5, 0.22, morph).toFixed(2)}))`,
      }}>
        <Crust day={day} date={date} number={number} morph={morph} />
      </div>

      {frame >= T.knife[0] && frame <= T.exit[1] && (
        // Anchored on the blade's tip, so the tip sits on the front of the sweep whatever the angle is.
        <div style={{ position: 'absolute', left: knifeX, top: knifeY, opacity: 1 - exit }}>
          <div style={{ position: 'absolute', left: -586, top: -56, width: 620, height: 112, transformOrigin: '586px 56px', transform: `rotate(${knifeA.toFixed(1)}deg)`, filter: 'drop-shadow(0 26px 30px rgba(0,0,0,0.5))' }}>
            <svg width={620} height={112}>
              <defs>
                <linearGradient id="steel" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#f2f5f6" /><stop offset="0.45" stopColor="#c3cbd0" /><stop offset="0.55" stopColor="#98a2a8" /><stop offset="1" stopColor="#d6dde0" />
                </linearGradient>
                <linearGradient id="wood" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#3a2517" /><stop offset="0.5" stopColor="#24160d" /><stop offset="1" stopColor="#140c07" />
                </linearGradient>
              </defs>
              <rect x="4" y="30" width="212" height="52" rx="26" fill="url(#wood)" />
              <rect x="30" y="40" width="150" height="5" rx="3" fill="#ffffff" opacity="0.14" />
              <rect x="206" y="26" width="30" height="60" rx="12" fill="#9aa4aa" />
              <path d="M232,30 L512,36 Q586,56 512,76 L232,82 Q222,56 232,30 Z" fill="url(#steel)" />
              <path d="M248,44 L508,48 Q548,56 508,64 L248,68 Q242,56 248,44 Z" fill="#ffffff" opacity="0.28" />
            </svg>
          </div>
        </div>
      )}
    </AbsoluteFill>
  );
};
