// Story opener: a notebook page with a leaf pressed in it and the day written beside it. The corner lifts,
// the page turns over like a book's, and the day's grid is the page underneath. The leaf was only lying there:
// as the page goes it slides off, drifts down, and lands in the strip the grid leaves clear, where the
// footer band grows out from under it.
import { AbsoluteFill, Easing, Img, useCurrentFrame } from 'remotion';
import { A, AUTUMN_FPS, BAR_H, Band, fit, grain, lerp, range, script, serif, sheetSrc, MAPLE, MAPLE_VEINS, type AutumnOpenerProps } from './autumnOpener';
import { Sfx } from './sfx';

const T = {
  settle: [0, 14],  // the page is still; the leaf settles onto it
  lift: [12, 26],   // the right edge lifts off the table a little
  turn: [24, 58],   // the page turns over about its left edge
  reveal: [26, 58], // the grid underneath comes up to full
  slip: [30, 66],   // the loose leaf slides off and drifts down
  band: [60, 76],   // the band grows in under it
} as const;
export const PRESSED_OPEN_FRAMES = T.band[1];
export const pressedDuration = (holdSeconds: number) => PRESSED_OPEN_FRAMES + Math.round(Math.max(1, holdSeconds) * AUTUMN_FPS);

const LEAF = 360; // the pressed leaf's size on the page
const LEAF_AT = { x: 540 - LEAF / 2 + 40, y: 360 };

// The page: laid paper, a ruled block, a margin, and the day written in two hands.
const Page = ({ day, date, kicker, category, count }: Omit<AutumnOpenerProps, 'sheet' | 'holdSeconds'>) => (
  <div style={{ position: 'absolute', inset: 0, background: `${grain(0.12)}, linear-gradient(90deg, #e6d6b8 0%, ${A.paper} 7%, ${A.paper} 100%)` }}>
    {Array.from({ length: 30 }, (_, i) => (
      <div key={i} style={{ position: 'absolute', left: 0, right: 0, top: 260 + i * 56, height: 2, background: 'rgba(90,110,140,0.14)' }} />
    ))}
    <div style={{ position: 'absolute', top: 0, bottom: 0, left: 150, width: 3, background: 'rgba(168,67,28,0.28)' }} />
    <div style={{ position: 'absolute', left: 190, right: 90, top: 820, display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
      <div style={{ ...script(72, A.barkSoft) }}>pressed on</div>
      <div style={serif(fit(day, 150, 860), 700, { marginTop: 24, letterSpacing: '0.06em' })}>{day}</div>
      <div style={serif(58, 600, { marginTop: 18, letterSpacing: '0.18em' })}>{date}</div>
      <div style={{ width: 120, height: 4, background: A.rust, marginTop: 44 }} />
      <div style={{ ...script(112), marginTop: 36 }}>{kicker}</div>
      <div style={serif(fit(category, 60, 980), 500, { marginTop: 12, letterSpacing: '0.04em' })}>{category}</div>
      <div style={serif(28, 700, { marginTop: 56, letterSpacing: '0.3em', color: A.barkSoft })}>RĪGA · {count} {count === 1 ? 'EVENT' : 'EVENTS'} THIS DAY</div>
    </div>
  </div>
);

// A pressed maple leaf: flat, a little translucent, darker at the edges where it dried first.
const PressedLeaf = ({ size }: { size: number }) => (
  <svg width={size} height={size} viewBox="0 0 200 200">
    <defs>
      <radialGradient id="pl" cx="50%" cy="55%" r="60%">
        <stop offset="0" stopColor={A.amber} />
        <stop offset="0.65" stopColor="#c0561f" />
        <stop offset="1" stopColor="#7a2a10" />
      </radialGradient>
    </defs>
    <path d={MAPLE} fill="url(#pl)" opacity={0.93} />
    <path d={MAPLE_VEINS} stroke="#f6d28a" strokeOpacity={0.55} strokeWidth={2.2} fill="none" strokeLinecap="round" />
    <path d="M100,190 L100,158" stroke="#6b3a1a" strokeWidth={4} strokeLinecap="round" />
  </svg>
);

export const PressedLeafStory = ({ day, date, kicker, category, count, sheet }: AutumnOpenerProps) => {
  const frame = useCurrentFrame();
  const lift = range(frame, T.lift, Easing.bezier(0.4, 0, 0.6, 1));
  const turn = range(frame, T.turn, Easing.bezier(0.55, 0, 0.35, 1));
  const reveal = range(frame, T.reveal, Easing.bezier(0.4, 0, 0.2, 1));
  const slip = range(frame, T.slip, Easing.bezier(0.45, 0, 0.3, 1));
  const band = range(frame, T.band, Easing.bezier(0.2, 0.9, 0.2, 1));
  const settle = range(frame, T.settle, Easing.out(Easing.cubic));
  // The page hinges on its left edge: a small lift first, then over. Past 90 degrees you see its back.
  const angle = lerp(0, -8, lift) + lerp(0, -172, turn);
  const edgeOn = Math.abs(Math.sin((angle * Math.PI) / 180)); // how side-on the page is: shade grows with it
  // The leaf: it rides the page for the first few degrees, then slides off to the right and falls, swinging
  // side to side as a flat thing falling through air does, and lands centred on the footer strip.
  const drift = Math.sin(slip * Math.PI * 2.4) * 110 * (1 - slip);
  const leafX = lerp(LEAF_AT.x, 540 - 60, slip) + drift;
  const leafY = lerp(LEAF_AT.y + (1 - settle) * -30, 1920 - BAR_H + 26, slip * slip);
  const leafTurn = lerp(-14, 160 + 18, slip) + Math.sin(slip * Math.PI * 3) * 20;
  const leafSize = lerp(LEAF, 120, slip);

  return (
    <AbsoluteFill
  style={{ background: '#1a120b', overflow: 'hidden', perspective: 2600 }}
  from={-11}>
      <AbsoluteFill style={{ transform: `scale(${lerp(1.06, 1, reveal)})` }}>
        <Img src={sheetSrc(sheet)} style={{ width: 1080, height: 1920, objectFit: 'cover' }} />
      </AbsoluteFill>
      {/* The shadow the turning page casts on the grid underneath it. */}
      <AbsoluteFill style={{ background: 'linear-gradient(90deg, rgba(0,0,0,0.55), rgba(0,0,0,0) 70%)', opacity: (1 - turn) * (turn > 0 ? 1 : 0) }} />

      {turn < 1 && (
        <div style={{ position: 'absolute', inset: 0, transformOrigin: '0 50%', transform: `rotateY(${angle}deg)`, transformStyle: 'preserve-3d' }}>
          {/* Front of the page. */}
          <div style={{ position: 'absolute', inset: 0, backfaceVisibility: 'hidden' }}>
            <Page day={day} date={date} kicker={kicker} category={category} count={count} />
            <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(90deg, rgba(0,0,0,0) 40%, rgba(40,20,5,${(0.45 * edgeOn).toFixed(2)}))` }} />
          </div>
          {/* Back of the page: plain paper, shaded as it comes round. */}
          <div style={{ position: 'absolute', inset: 0, backfaceVisibility: 'hidden', transform: 'rotateY(180deg)', background: `${grain(0.12)}, #e8dcc2` }}>
            <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(270deg, rgba(0,0,0,0) 40%, rgba(40,20,5,${(0.5 * edgeOn).toFixed(2)}))` }} />
          </div>
        </div>
      )}

      {band < 1 && (
        <div style={{ position: 'absolute', left: leafX, top: leafY, width: leafSize, height: leafSize,
          transform: `rotate(${leafTurn}deg)`, filter: `drop-shadow(0 ${lerp(6, 18, slip).toFixed(0)}px ${lerp(6, 14, slip).toFixed(0)}px rgba(0,0,0,0.35))`, opacity: 1 - band }}>
          <PressedLeaf size={leafSize} />
        </div>
      )}
      {/* Sound: the page turning, the leaf drifting off it, the band. */}
      <Sfx at={T.turn[0] - 4} name="book-turn" volume={0.85} />
      <Sfx at={T.slip[0] + 2} name="book-leaf" volume={0.45} />
      <Sfx at={T.band[0]} name="paper-slide" volume={0.45} />
      <Band day={day} date={date} category={category} grow={band} />
    </AbsoluteFill>
  );
};
