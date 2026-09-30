// Story opener: an event ticket for the day. Readable from the first frame; the stub tears off, the
// ticket flies away and the day's grid is full screen before two seconds, with a day band that stays.
import '@fontsource/cormorant-garamond/500.css';
import '@fontsource/cormorant-garamond/600.css';
import '@fontsource/cormorant-garamond/700.css';
import '@fontsource/great-vibes/400.css';
import type { CSSProperties } from 'react';
import { AbsoluteFill, Easing, Img, continueRender, delayRender, interpolate, staticFile, useCurrentFrame } from 'remotion';

const fonts = delayRender('Loading ticket fonts');
Promise.all([
  document.fonts.load('700 158px "Cormorant Garamond"'),
  document.fonts.load('600 64px "Cormorant Garamond"'),
  document.fonts.load('500 36px "Cormorant Garamond"'),
  document.fonts.load('64px "Great Vibes"'),
]).then(() => continueRender(fonts));

// `sheet` is a file in public/ or a full URL. `date` reads like "18 SEPTEMBER", `number` like "0918".
export type TicketStoryProps = { day: string; date: string; number: string; kicker: string; category: string; count: number; sheet: string; holdSeconds: number };

export const TICKET_FPS = 30;
const T = {
  settle: [0, 18],   // the ticket lands with a wobble: already legible on frame 0
  tug: [16, 23],     // a small pull on the ticket before the paper gives
  tear: [20, 42],    // the rip travels across the paper, in full view
  fall: [42, 62],    // the freed stub drops to the strip the grid keeps clear
  lift: [44, 64],    // the ticket flies up and off
  reveal: [42, 66],  // the backdrop gives way to the grid
  band: [56, 70],    // the landed stub turns into the full-width footer bar
} as const;
export const TICKET_OPEN_FRAMES = T.band[1];
export const ticketDuration = (holdSeconds: number) => TICKET_OPEN_FRAMES + Math.round(Math.max(1, holdSeconds) * TICKET_FPS);

const GREEN = '#17352d', DEEP = '#0f241e', LIME = '#d4ed86', CREAM = '#f7f4ec', INKSOFT = '#2d5a4c';
const serif = (size: number, weight = 600, extra: CSSProperties = {}): CSSProperties => ({ fontFamily: '"Cormorant Garamond"', fontWeight: weight, fontSize: size, lineHeight: 1, color: GREEN, fontVariantNumeric: 'lining-nums', whiteSpace: 'nowrap', ...extra });
const script = (size: number): CSSProperties => ({ fontFamily: '"Great Vibes"', fontSize: size, lineHeight: 1, color: INKSOFT, whiteSpace: 'nowrap' });
const grain = `url("data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 0.35  0 0 0 0 0.32  0 0 0 0 0.25  0 0 0 0.09 0"/></filter><rect width="300" height="300" filter="url(#n)"/></svg>')}")`;
// Long words shrink to fit the ticket instead of running past its border.
const fit = (text: string, max: number, budget: number) => Math.min(max, budget / Math.max(1, text.length));

const W = 800, H = 1360, LEFT = (1080 - W) / 2, TOP = 280, STUB_Y = 1020;
// The grid leaves this strip clear (see BAR_H in src/grids.js): the stub lands there and stays,
// so the day is readable under the cards without covering any of them.
const BAR_H = 190, STUB_REST = 1920 - BAR_H - (TOP + STUB_Y) + (H - STUB_Y - BAR_H) / 2;
// The tear. One jagged line, generated from a fixed seed so every frame rips along the same one.
// The rip has a front that travels left to right: left of it the paper is parted (both edges ragged),
// right of it the ticket is still whole, so nothing gives the tear away before it happens.
const TEAR_OVER = 16, TEAR_AMP = 7, TEAR_STEP = 14;
const tearJag = (w: number, seed = 7) => {
  let s = seed;
  const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  const pts: [number, number][] = [];
  for (let x = 0; x <= w + TEAR_STEP; x += TEAR_STEP) pts.push([Math.min(x, w), (rnd() - 0.5) * 2 * TEAR_AMP]);
  return pts;
};
const maskUrl = (w: number, h: number, d: string) =>
  `url("data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><path d="${d}" fill="#fff"/></svg>`)}")`;
const MAIN_H = STUB_Y + TEAR_OVER, STUB_H = H - STUB_Y + TEAR_OVER;
const TEAR_PTS = tearJag(W);
// The ragged line, sampled anywhere along the rip.
const jagAt = (x: number) => {
  const i = Math.min(TEAR_PTS.length - 2, Math.max(0, Math.floor(x / TEAR_STEP)));
  const [x0, y0] = TEAR_PTS[i], [x1, y1] = TEAR_PTS[i + 1];
  return x1 === x0 ? y0 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
};
// Points along the ragged line from 0 up to the rip's front, ending exactly on the front.
const jagTo = (front: number, y: number) => {
  const pts: string[] = [];
  for (let x = 0; x < front; x += TEAR_STEP) pts.push(`${x.toFixed(1)},${(y + jagAt(x)).toFixed(1)}`);
  pts.push(`${front.toFixed(1)},${(y + jagAt(front)).toFixed(1)}`);
  return pts;
};
// The ticket keeps everything above the rip; to the right of the front it keeps its full depth,
// which is what makes the paper look untouched until the rip reaches it.
const upperMask = (front: number) => maskUrl(W, MAIN_H,
  `M0,0 L${W},0 L${W},${MAIN_H} L${front.toFixed(1)},${MAIN_H} L${jagTo(front, STUB_Y).reverse().join(' L')} L0,0 Z`);
// The freed flap: left of the front, below the rip. It keeps a straight tab past the rip's front so
// that when it swings away it slides under the piece still attached, instead of opening a visible slit.
const flapMask = (front: number, tab: number) => front <= 0 ? 'none' : maskUrl(W, STUB_H,
  `M0,${STUB_H} L${(front + tab).toFixed(1)},${STUB_H} L${(front + tab).toFixed(1)},${(TEAR_OVER + jagAt(front)).toFixed(1)} L${jagTo(front, TEAR_OVER).reverse().join(' L')} L0,${STUB_H} Z`);
// The part still attached to the ticket: right of the front.
const joinedMask = (front: number) => front >= W ? 'none' : maskUrl(W, STUB_H,
  `M${front.toFixed(1)},0 L${W},0 L${W},${STUB_H} L${front.toFixed(1)},${STUB_H} Z`);
const notches = (y: number, r = 38) => `radial-gradient(circle at 0 ${y}px, transparent ${r}px, #000 ${(r + 0.5).toFixed(1)}px) left / 51% 100% no-repeat, radial-gradient(circle at 100% ${y}px, transparent ${r}px, #000 ${(r + 0.5).toFixed(1)}px) right / 51% 100% no-repeat`;

const range = (frame: number, [a, b]: readonly [number, number], easing = Easing.bezier(0.65, 0, 0.35, 1)) =>
  interpolate(frame, [a, b], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing });
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const Main = ({ day, date, kicker, category, height = MAIN_H }: Pick<TicketStoryProps, 'day' | 'date' | 'kicker' | 'category'> & { height?: number }) => (
  <div style={{ position: 'relative', width: W, height, background: `${grain}, ${CREAM}`, borderRadius: '26px 26px 0 0' }}>
    <div style={{ position: 'absolute', inset: '30px 30px 0', borderTop: `2px solid ${GREEN}40`, borderLeft: `2px solid ${GREEN}40`, borderRight: `2px solid ${GREEN}40`, borderRadius: '14px 14px 0 0' }} />
    <div style={{ position: 'absolute', left: 0, right: 0, top: 70, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ background: GREEN, padding: '14px 34px', borderRadius: 40, ...serif(34, 700, { color: LIME, letterSpacing: '0.34em' }) }}>ADMIT ONE</div>
      <div style={serif(36, 600, { marginTop: 46, letterSpacing: '0.3em', color: INKSOFT })}>RĪGA · THIS WEEKEND</div>
      <div style={serif(fit(day, 158, 950), 700, { marginTop: 44, height: 158, display: 'flex', alignItems: 'center', letterSpacing: '0.1em', marginRight: '-0.1em' })}>{day}</div>
      <div style={serif(64, 600, { marginTop: 18, letterSpacing: '0.2em', marginRight: '-0.2em' })}>{date}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 24, marginTop: 56 }}>
        <span style={{ width: 90, height: 2, background: `${GREEN}66` }} /><span style={{ width: 14, height: 14, transform: 'rotate(45deg)', background: LIME, border: `2px solid ${GREEN}` }} /><span style={{ width: 90, height: 2, background: `${GREEN}66` }} />
      </div>
      <div style={{ ...script(120), marginTop: 44 }}>{kicker}</div>
      <div style={serif(fit(category, 76, 1250), 500, { marginTop: 10, letterSpacing: '0.04em' })}>{category}</div>
    </div>
  </div>
);

const Stub = ({ day, date, category, number, count, morph }: Pick<TicketStoryProps, 'day' | 'date' | 'category' | 'number' | 'count'> & { morph: number }) => (
  // `morph` stretches the ticket stub into the full-width footer: the box, the padding and the type all
  // grow into their new size, so the piece of paper becomes the bar rather than dissolving into it.
  <div style={{
    position: 'relative', width: '100%', height: '100%', background: `${grain}, ${CREAM}`,
    borderRadius: `0 0 ${lerp(26, 0, morph)}px ${lerp(26, 0, morph)}px`,
    borderTop: `${(4 * morph).toFixed(1)}px solid ${LIME}`,
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: `${lerp(TEAR_OVER, 0, morph).toFixed(1)}px ${lerp(74, 64, morph).toFixed(1)}px 0`,
  }}>
    <div style={{ position: 'absolute', inset: `${TEAR_OVER}px 30px 30px`, opacity: 1 - morph, borderBottom: `2px solid ${GREEN}40`, borderLeft: `2px solid ${GREEN}40`, borderRight: `2px solid ${GREEN}40`, borderRadius: '0 0 14px 14px' }} />
    {/* Left side: the ticket's serial while it is a stub, the day once it is the footer. The two never
        overlap: the serial is gone by halfway, and the day only arrives after that. */}
    <div style={{ position: 'relative', flex: 1, height: lerp(200, 120, morph) }}>
      <div style={{ position: 'absolute', left: 0, top: 0, opacity: Math.max(0, 1 - morph * 2.2) }}>
        <div style={serif(28, 600, { letterSpacing: '0.28em', color: INKSOFT })}>NO.</div>
        <div style={serif(84, 700, { letterSpacing: '0.06em' })}>{number}</div>
        <div style={serif(26, 600, { letterSpacing: '0.24em', color: INKSOFT, marginTop: 6 })}>{count} {count === 1 ? 'EVENT' : 'EVENTS'} INSIDE</div>
      </div>
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', opacity: Math.max(0, morph * 2.2 - 1.2) }}>
        <div style={serif(fit(day, 64, 620), 700, { letterSpacing: '0.12em' })}>{day}</div>
        <div style={serif(30, 600, { letterSpacing: '0.2em', color: INKSOFT, marginTop: 8 })}>{date} · {category.toUpperCase()}</div>
      </div>
    </div>
    <div style={{ display: 'flex', gap: lerp(5, 4, morph), height: lerp(170, 92, morph) }}>
      {[6, 2, 4, 2, 8, 3, 2, 6, 2, 4, 7, 2, 3, 5, 2, 6, 3, 2, 8, 2, 4].map((w, i) => <span key={i} style={{ width: w, background: GREEN }} />)}
    </div>
  </div>
);

export const TicketStory = ({ day, date, number, kicker, category, count, sheet, holdSeconds: _hold }: TicketStoryProps) => {
  const frame = useCurrentFrame();
  const src = /^https?:\/\//.test(sheet) ? sheet : staticFile(sheet);

  const settle = range(frame, T.settle, Easing.elastic(0.8)); // the ticket wobbles as it lands
  const tug = range(frame, T.tug) * (1 - range(frame, T.lift));
  // The rip accelerates as it runs across the paper, the way a real tear gives way.
  const tear = range(frame, T.tear, Easing.bezier(0.76, 0, 0.24, 1)); // easeInOutQuart: resists, gives, settles
  const front = W * tear;
  const fall = range(frame, T.fall, Easing.bezier(0.3, 0, 0.2, 1));
  const lift = range(frame, T.lift, Easing.bezier(0.55, 0, 0.9, 0.45));
  const reveal = range(frame, T.reveal, Easing.bezier(0.4, 0, 0.2, 1));
  const morph = range(frame, T.band, Easing.bezier(0.2, 0.9, 0.2, 1)); // the stub stretching into the footer
  const torn = frame >= T.tear[0];
  const tilt = lerp(-6, -3, settle);
  const landScale = lerp(1.05, 1, settle);
  const ticketY = -14 * tug + lerp(0, -1700, lift);
  const ticketTilt = tilt + lerp(0, -1.2, tear) * (1 - lift) + lerp(0, -10, lift);
  // While tearing, the stub hinges on its right corner: the left lifts first and the gap is a wedge.
  const flapAngle = lerp(0, 5, tear) * (1 - fall);
  // How far the swinging flap must reach past the rip to stay tucked under the attached piece.
  const flapTab = Math.min(W - front, STUB_H * Math.tan((flapAngle * Math.PI) / 180) + 6);
  // The very end of the rip: the last sliver still attached cannot hide the flap's edge any more, so
  // the flap takes over the full width while that sliver fades, instead of leaving a tab sticking out.
  const tail = interpolate(front, [W - 90, W], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const flapFront = lerp(front, W, tail);
  const stubY = lerp(0, STUB_REST, fall), stubTilt = lerp(tilt, 0, fall);
  const shadow = 'drop-shadow(0 40px 60px rgba(0,0,0,0.45))';
  // While the rip is travelling the halves are still one sheet of paper, so they cast ONE shadow:
  // giving each its own draws a shadow line along the tear and makes them look like separate cards.
  const joined = torn && fall === 0;
  const stubShadow = joined ? undefined : `drop-shadow(0 ${lerp(40, 10, morph).toFixed(0)}px ${lerp(60, 24, morph).toFixed(0)}px rgba(0,0,0,${lerp(0.45, 0.18, morph).toFixed(2)}))`;

  return (
    <AbsoluteFill style={{ background: DEEP, overflow: 'hidden' }}>
      {/* The grid waits underneath, pushed in a little so it settles as it is revealed. */}
      <AbsoluteFill style={{ transform: `scale(${lerp(1.08, 1, reveal)})` }}>
        <Img src={src} style={{ width: 1080, height: 1920, objectFit: 'cover' }} />
      </AbsoluteFill>
      <AbsoluteFill style={{ background: `radial-gradient(120% 80% at 50% 42%, #21473c 0%, ${GREEN} 55%, ${DEEP} 100%)`, opacity: 1 - reveal }} />

      {!torn && (
        // Still whole: one element with one shadow, so there is no seam where the stub begins.
        <div style={{ position: 'absolute', left: LEFT, top: TOP + ticketY, filter: shadow, transformOrigin: `${W / 2}px ${H / 2}px`, transform: `scale(${landScale}) rotate(${ticketTilt}deg)` }}>
          <div style={{ WebkitMask: notches(STUB_Y) }}>
            <Main day={day} date={date} kicker={kicker} category={category} height={STUB_Y} />
            <div style={{ marginTop: -TEAR_OVER, width: W, height: STUB_H }}>
              <Stub day={day} date={date} category={category} number={number} count={count} morph={0} />
            </div>
            <div style={{ position: 'absolute', left: 48, right: 48, top: STUB_Y - 2, borderTop: `4px dashed ${GREEN}66` }} />
          </div>
        </div>
      )}

      <AbsoluteFill style={{ filter: joined ? shadow : undefined }}>
      {torn && frame < T.lift[1] && (
        <div style={{ position: 'absolute', left: LEFT, top: TOP + ticketY, filter: joined ? undefined : shadow, transformOrigin: `${W / 2}px ${H / 2}px`, transform: `scale(${landScale * lerp(1, 1.06, lift)}) rotate(${ticketTilt}deg)` }}>
          <div style={{ WebkitMaskImage: upperMask(front), WebkitMaskSize: '100% 100%' }}>
            <div style={{ WebkitMask: notches(STUB_Y) }}>
              <Main day={day} date={date} kicker={kicker} category={category} />
            </div>
          </div>
        </div>
      )}
      {torn && (
        // Two pieces while the rip travels: the freed flap hanging from the rip's front, and the part
        // still joined to the ticket. The joined piece is drawn last, so the flap's straight cut edge
        // stays hidden behind it and the paper reads as tearing rather than being sliced.
        // The outer element carries the ticket's own tilt and scale, pivoted on the ticket's centre, so
        // the two halves stay locked together while the rip travels. The inner one adds only what the
        // freed piece does on its own: straightening up and shrinking into the footer.
        <div style={{ position: 'absolute',
          left: lerp(LEFT, 0, morph), top: lerp(TOP + STUB_Y - TEAR_OVER + stubY, 1920 - BAR_H - TEAR_OVER, morph),
          width: lerp(W, 1080, morph), height: lerp(STUB_H, BAR_H + TEAR_OVER, morph),
          transformOrigin: `${W / 2}px ${H / 2 - STUB_Y + TEAR_OVER}px`, transform: `scale(${lerp(landScale, 1, morph)}) rotate(${lerp(tilt, 0, morph)}deg)` }}>
        <div style={{ position: 'absolute', inset: 0, filter: stubShadow,
          transformOrigin: `${W / 2}px ${STUB_H / 2}px`, transform: `rotate(${(stubTilt - tilt) * (1 - morph)}deg)` }}>
          <div style={{ position: 'absolute', inset: 0, WebkitMaskImage: morph > 0 ? 'none' : flapMask(flapFront, flapTab), WebkitMaskSize: '100% 100%',
            transformOrigin: `${flapFront.toFixed(1)}px ${TEAR_OVER}px`, transform: `rotate(${flapAngle}deg)` }}>
            <div style={{ width: '100%', height: '100%', WebkitMask: notches(TEAR_OVER, lerp(38, 0, morph)) }}>
              <Stub day={day} date={date} category={category} number={number} count={count} morph={morph} />
            </div>
          </div>
          {tail < 1 && (
            <div style={{ position: 'absolute', inset: 0, opacity: 1 - tail, WebkitMaskImage: joinedMask(front), WebkitMaskSize: '100% 100%' }}>
              <div style={{ width: '100%', height: '100%', WebkitMask: notches(TEAR_OVER) }}>
                <Stub day={day} date={date} category={category} number={number} count={count} morph={0} />
              </div>
            </div>
          )}
        </div>
        </div>
      )}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
