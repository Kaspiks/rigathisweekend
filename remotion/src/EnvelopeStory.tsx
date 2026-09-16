import '@fontsource/cormorant-garamond/500.css';
import '@fontsource/cormorant-garamond/600.css';
import '@fontsource/great-vibes/400.css';
import { AbsoluteFill, Easing, Img, continueRender, delayRender, interpolate, staticFile, useCurrentFrame } from 'remotion';

// `sheet` is a file in public/ or a full URL (the render server passes the day's grid over localhost).
export type EnvelopeStoryProps = { day: string; kicker: string; category: string; sheet: string; holdSeconds: number };

export const FPS = 30;

// Web fonts load lazily; hold the first frame until the faces used on the label are ready.
const fontsReady = delayRender('Loading label fonts');
Promise.all([
  document.fonts.load('600 64px "Cormorant Garamond"'),
  document.fonts.load('500 36px "Cormorant Garamond"'),
  document.fonts.load('64px "Great Vibes"'),
]).then(() => continueRender(fontsReady));

const GREEN = '#17352d';
const CREAM = '#f7f4ec';

// Envelope pieces exported by `node src/envelope.js --layers`, in source pixels.
const SRC = { width: 1565, height: 1005, flapHeight: 712, pocketDepth: 38.6 };
const EW = 1000, S = EW / SRC.width;
const EL = (1080 - EW) / 2, ET = 760;
const BODY_H = SRC.height * S, FLAP_H = SRC.flapHeight * S, POCKET = SRC.pocketDepth * S;

// Collage sheet: tucked inside the envelope, then pulled out to fill the story.
const SHEET_W = 860, SHEET_H = (SHEET_W * 16) / 9, SHEET_LEFT = (1080 - SHEET_W) / 2;
const FULL_SCALE = 1080 / SHEET_W;

// Timeline, in frames. Short on purpose: the flap is already moving on the first frames and the
// sheet follows almost at once, so the collage is full screen before two seconds are up.
const T = {
  flap: [3, 22],
  rise: [11, 36],
  drop: [25, 49],
  zoom: [28, 55],
} as const;
export const OPEN_FRAMES = T.zoom[1];
export const durationFor = (holdSeconds: number) => OPEN_FRAMES + Math.round(Math.max(1, holdSeconds) * FPS);

const inOut = Easing.bezier(0.65, 0, 0.35, 1);
const range = (frame: number, [a, b]: readonly [number, number], easing = inOut) =>
  interpolate(frame, [a, b], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing });
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const Label = ({ day, kicker, category }: Pick<EnvelopeStoryProps, 'day' | 'kicker' | 'category'>) => (
  <div
    style={{
      position: 'absolute', left: (EW - 390) / 2, top: 46, width: 390, height: 228,
      background: CREAM, borderRadius: 3,
      boxShadow: `0 1px 2px rgba(0,0,0,0.12), 0 6px 14px rgba(0,0,0,0.10), inset 0 0 0 10px ${CREAM}, inset 0 0 0 11px rgba(23,53,45,0.28)`,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: GREEN,
    }}
  >
    <div style={{ fontFamily: '"Cormorant Garamond"', fontWeight: 600, fontSize: 62, letterSpacing: '0.16em', lineHeight: 1, marginRight: '-0.16em' }}>{day}</div>
    <div style={{ fontFamily: '"Great Vibes"', fontSize: 58, lineHeight: 1, marginTop: -6, color: '#2d5a4c' }}>{kicker}</div>
    <div style={{ fontFamily: '"Cormorant Garamond"', fontWeight: 500, fontSize: 38, letterSpacing: '0.04em', lineHeight: 1, marginTop: 2 }}>{category}</div>
  </div>
);

export const EnvelopeStory = ({ day, kicker, category, sheet }: EnvelopeStoryProps) => {
  const frame = useCurrentFrame();
  const sheetSrc = /^https?:\/\//.test(sheet) ? sheet : staticFile(sheet);
  const flapT = range(frame, T.flap);
  const angle = 180 * flapT;
  const flapOpen = angle > 90;
  const rise = range(frame, T.rise, Easing.bezier(0.45, 0, 0.2, 1));
  const zoom = range(frame, T.zoom, Easing.bezier(0.6, 0, 0.25, 1));
  // Only one face of the flap is drawn at a time, each with its own rotation, so no face is ever mirrored.
  // The envelope falls away (and recedes a little) while the sheet comes forward.
  const dropT = range(frame, T.drop, Easing.bezier(0.55, 0, 0.95, 0.5));
  const drop = lerp(0, 1500, dropT);
  const recede = lerp(1, 0.86, dropT);

  const envY = drop;
  const sheetTop = lerp(lerp(ET + POCKET + 36, 150, rise), 0, zoom);
  const sheetLeft = lerp(SHEET_LEFT, 0, zoom);
  const sheetScale = lerp(1, FULL_SCALE, zoom);
  const sheetTilt = lerp(lerp(0, -1.2, rise), 0, zoom);
  const clipBottom = ET + envY + BODY_H / 2 + (BODY_H / 2 - 26) * recede;
  const sin = Math.sin((angle * Math.PI) / 180);

  // Hinge on the body's top edge, following the envelope as it drops and recedes around its centre.
  const hingeY = ET + envY + (BODY_H / 2) * (1 - recede);
  const faceBox = { position: 'absolute', left: EL, width: EW, height: FLAP_H, transformStyle: 'flat' } as const;
  const flap = (
    <div style={{ position: 'absolute', inset: 0, perspective: 1500, perspectiveOrigin: `540px ${hingeY}px`, zIndex: flapOpen ? 1 : 6 }}>
      {!flapOpen ? (
        // Outer face, folded down over the body, swinging up toward the camera.
        <div style={{ ...faceBox, top: hingeY, transformOrigin: '50% 0%', transform: `scale(${recede}) rotateX(${angle}deg)` }}>
          <Img src={staticFile('envelope/flap-outer.png')} style={{ width: EW, height: FLAP_H, filter: `drop-shadow(0 ${3 + 6 * sin}px ${4 + 8 * sin}px rgba(0,0,0,${0.24 * (1 - sin * 0.6)}))` }} />
          <Label day={day} kicker={kicker} category={category} />
          <div style={{ position: 'absolute', inset: 0, background: `rgba(0,0,0,${0.12 * sin})`, WebkitMaskImage: `url(${staticFile('envelope/flap-outer.png')})`, WebkitMaskSize: '100% 100%' }} />
        </div>
      ) : (
        // Inner face, standing above the hinge, settling back from the camera.
        <div style={{ ...faceBox, top: hingeY - FLAP_H, transformOrigin: '50% 100%', transform: `scale(${recede}) rotateX(${angle - 180}deg)` }}>
          <Img src={staticFile('envelope/flap-inner.png')} style={{ width: EW, height: FLAP_H, filter: 'drop-shadow(0 -6px 14px rgba(0,0,0,0.28))' }} />
          <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(to top, rgba(0,0,0,${0.16 * sin}), rgba(0,0,0,0) 60%)`, WebkitMaskImage: `url(${staticFile('envelope/flap-inner.png')})`, WebkitMaskSize: '100% 100%' }} />
        </div>
      )}
    </div>
  );

  return (
    <AbsoluteFill style={{ background: `radial-gradient(120% 80% at 50% 45%, #21473c 0%, ${GREEN} 55%, #0f241e 100%)`, overflow: 'hidden' }}>
      <AbsoluteFill>
        {flap}

        {/* Inside of the envelope, seen in the shallow notch of the pocket. */}
        <svg width={1080} height={1920} style={{ position: 'absolute', left: 0, top: envY, zIndex: 2, transformOrigin: `540px ${ET + BODY_H / 2}px`, transform: `scale(${recede})` }}>
          <polygon points={`${EL},${ET} ${540},${ET + POCKET} ${EL + EW},${ET}`} fill="#cfcac0" />
        </svg>

        {/* The sheet, hidden below the pocket edge while it is still inside. */}
        <div style={{ position: 'absolute', inset: 0, zIndex: 3, clipPath: `inset(0 0 ${Math.max(0, 1920 - clipBottom)}px 0)` }}>
          <div
            style={{
              position: 'absolute', left: sheetLeft, top: sheetTop, width: SHEET_W, height: SHEET_H,
              transformOrigin: '0 0', transform: `scale(${sheetScale}) rotate(${sheetTilt}deg)`,
              borderRadius: lerp(10, 0, zoom), overflow: 'hidden',
              boxShadow: `0 ${lerp(18, 0, zoom)}px ${lerp(46, 0, zoom)}px rgba(0,0,0,${lerp(0.4, 0, zoom)})`,
              background: CREAM,
            }}
          >
            <Img src={sheetSrc} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </div>
          {/* Shade on the sheet just above the pocket edge. */}
          <div
            style={{
              position: 'absolute', left: SHEET_LEFT, width: SHEET_W, top: ET + envY - 120, height: 120 + POCKET,
              background: 'linear-gradient(to bottom, rgba(0,0,0,0), rgba(0,0,0,0.05) 60%, rgba(0,0,0,0.22))',
              opacity: (1 - zoom) * (sheetTop < ET + envY ? 1 : 0),
            }}
          />
        </div>

        <Img
          src={staticFile('envelope/body.png')}
          style={{ position: 'absolute', left: EL, top: ET + envY, width: EW, height: BODY_H, zIndex: 5, filter: 'drop-shadow(0 22px 30px rgba(0,0,0,0.45))', transformOrigin: '50% 50%', transform: `scale(${recede})` }}
        />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
