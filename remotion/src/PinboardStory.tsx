// Story opener for hands-on weekends: a cork noticeboard in a community centre. The day's card goes up first,
// then flyers for the day's events are pinned up over it across the whole board, one after another (each comes
// in toward the board, gets pinned, and swings a little on its pin before it settles), and the board holds there.
import { Fragment } from 'react';
import { AbsoluteFill, Easing, Img, staticFile, useCurrentFrame } from 'remotion';
import { A, AUTUMN_FPS, fit, grain, lerp, range, script, serif, type AutumnOpenerProps } from './autumnOpener';
import { Sfx } from './sfx';

const FALL = 7; // frames from a hand's reach to the cork
// The day card lands at frame 7 and is left on its own long enough to read (1.5 s) before the first flyer
// comes in. The flyers are then 15 frames apart at most, and the last one takes ~16 frames to stop swinging.
const READ = 45;
const LEAD = FALL + READ;
export const PINBOARD_OPEN_FRAMES = LEAD + 15 + FALL + 16;
export const pinboardDuration = (holdSeconds: number) => PINBOARD_OPEN_FRAMES + Math.round(Math.max(1, holdSeconds) * AUTUMN_FPS);

// The flyers carry the day's events. Without any, the board falls back to generic notices.
type Glyph = 'music' | 'theatre' | 'frame' | 'pencil' | 'brush' | 'dance' | 'balloon' | 'film' | 'fork' | 'star';
// `photo` is the event's picture (a URL, or a file in public/); the flyer shows it in its corner in place of the line picture.
// `languages` are the ones the event suits (EN, LV, RU), stamped beside its label like the grid cards' tag.
export type PinEvent = { title: string; when: string; price?: string; venue?: string; kind?: string; icon?: Glyph; photo?: string; languages?: string[] };
export type PinboardProps = AutumnOpenerProps & { events?: PinEvent[] };

const PLACEHOLDERS: PinEvent[] = [
  { kind: 'CLASS', title: 'Painting', when: 'for beginners', icon: 'brush' },
  { kind: 'EVENING', title: 'Folk dance', when: 'no partner needed', icon: 'dance' },
  { kind: 'WORKSHOP', title: 'Drawing', when: 'bring a pencil', icon: 'pencil' },
  { kind: 'FAMILIES', title: 'Art morning', when: 'ages 4–9', icon: 'balloon' },
];

// Where the flyers hang. `top` and `bottom` are the flyer's own margins (the tack sits in the top one; on the
// bottom row `bottom` also keeps the room the tear-off strips take, while they're switched on).
type Slot = { x: number; y: number; w: number; h: number; rot: number; paper: string; tack: string; at: number; tabs?: boolean; top: number; bottom: number };
// Three or four flyers hang round the day card in the middle, over its blank margin only, so it stays readable.
const AROUND: Slot[] = [
  { x: 70, y: 140, w: 400, h: 520, rot: -5, paper: '#f4efe4', tack: '#c0392b', at: 0, top: 58, bottom: 40 },
  { x: 600, y: 150, w: 390, h: 500, rot: 4, paper: '#f2d98a', tack: '#2f5aa0', at: 5, top: 58, bottom: 40 },
  { x: 60, y: 1280, w: 420, h: 520, rot: 3, paper: '#d3e3d9', tack: '#d39a2a', at: 10, tabs: true, top: 58, bottom: 130 },
  { x: 590, y: 1290, w: 400, h: 470, rot: -6, paper: '#f3c6b0', tack: '#2f7f7a', at: 15, tabs: true, top: 58, bottom: 130 },
];
// Any other number go up across the whole board, over the day card (which went up first and has been read by
// then): one column for one or two flyers, two columns for five or six, an odd one out centred on its row, each
// flyer shifted and turned a little so they look pinned up by hand rather than laid out on a grid.
const PAPERS = ['#f4efe4', '#f2d98a', '#dde6ee', '#d3e3d9', '#e9d8e6', '#f3c6b0'];
const TACKS = ['#c0392b', '#2f5aa0', '#6d3b63', '#d39a2a', '#c0392b', '#2f7f7a'];
const TILT = [-4, 3, -2.5, 4, -3, 2.5];
const NUDGE: [number, number][] = [[-10, 14], [12, -10], [8, 18], [-14, -8], [10, 10], [-8, -14]];
const slotsFor = (n: number): Slot[] => {
  if (n === 3) return [AROUND[0], AROUND[1], { ...AROUND[2], x: 330 }];
  if (n === 4) return AROUND;
  const M = 40, G = 26, cols = n <= 2 ? 1 : 2, rows = Math.ceil(n / cols);
  const cw = (1080 - 2 * M - (cols - 1) * G) / cols, ch = (1920 - 2 * M - (rows - 1) * G) / rows;
  // Each flyer fills its cell (so together they cover the board and the card under it), up to a sensible size.
  const w = Math.min(cw, 880), h = Math.min(ch, w * 2);
  return Array.from({ length: n }, (_, i) => {
    const row = Math.floor(i / cols), inRow = Math.min(cols, n - row * cols), col = i % cols;
    const x0 = (1080 - (inRow * w + (inRow - 1) * G)) / 2 + col * (w + G), y0 = M + row * (ch + G) + (ch - h) / 2;
    return { x: Math.round(x0 + NUDGE[i][0]), y: Math.round(y0 + NUDGE[i][1]), w: Math.round(w), h: Math.round(h), rot: TILT[i],
      paper: PAPERS[i], tack: TACKS[i], at: i * (n <= 4 ? 5 : 3), tabs: row === rows - 1, top: 62, bottom: 130 };
  });
};
// Bigger flyers take a bigger photo, wider margins and bigger type; narrow ones a smaller photo and a tighter
// margin, so the title still has room beside it. `scaleOf` is the type size against a 400 px flyer.
const photoOf = (s: Slot) => s.w >= 460 ? 200 : s.w >= 380 ? 150 : 104;
const padOf = (s: Slot) => s.w >= 460 ? 46 : s.w >= 380 ? 38 : 28;
const scaleOf = (s: Slot) => Math.min(1.35, Math.max(0.9, s.w / 400));
// Titles can grow into whatever height the flyer has, up to this.
const titleMax = (s: Slot) => Math.round(64 * scaleOf(s));

// A picture and a label for an event that doesn't bring its own, read off its title, kind and venue.
// Music comes before theatre: concerts are often held in halls with "theatre" in the name.
const GUESS: [RegExp, Glyph][] = [
  [/concert|orchestra|trio|quartet|choir|jazz|baroque|opera|music|\bband\b/, 'music'],
  [/paint/, 'brush'],
  [/workshop|class|drawing|craft/, 'pencil'],
  [/danc|folk/, 'dance'],
  [/theat|\bplay|drama|comedy|stand-?up/, 'theatre'],
  [/exhibit|gallery|museum|mosaic|textile|\bart\b/, 'frame'],
  [/kids|child|famil|ages/, 'balloon'],
  [/film|cinema|movie|screening/, 'film'],
  [/market|food|tasting|fair|harvest/, 'fork'],
];
const LABEL: Record<Glyph, string> = { music: 'CONCERT', theatre: 'THEATRE', frame: 'EXHIBITION', pencil: 'WORKSHOP', brush: 'CLASS',
  dance: 'DANCE', balloon: 'FAMILIES', film: 'FILM', fork: 'MARKET', star: 'EVENT' };
const glyphFor = (e: PinEvent): Glyph => {
  const text = `${e.kind ?? ''} ${e.title} ${e.venue ?? ''}`.toLowerCase();
  return e.icon ?? GUESS.find(([re]) => re.test(text))?.[1] ?? 'star';
};

// The largest title size whose lines fit the height left for it. Cormorant runs a little under half an em
// per character; the first lines are shorter because the corner picture sits beside them (a photo is bigger
// than a line picture, so it takes more width and more lines). `photo` is the photo's size, 0 for none.
const titleSize = (text: string, width: number, height: number, photo = 0, max = 54): { size: number; below: boolean } => {
  // Lines needed at a size, and whether a word had to drop below the picture (which leaves a gap beside it).
  // Bold Cormorant runs about half an em a character; a word wider than the flyer can't be set at all.
  const lines = (size: number) => {
    const beside = photo ? Math.ceil((photo - 36) / (size * 1.04)) : 2;
    const roomOn = (n: number) => n <= beside ? width - (photo ? photo + 24 : 84) : width;
    let n = 1, used = 0, dropped = false;
    for (const word of text.split(/\s+/)) {
      const w = word.length * size * 0.5, gap = used ? size * 0.5 : 0;
      if (w > width) return { n: Infinity, dropped };
      if (used && used + gap + w > roomOn(n)) { n += 1; used = 0; }
      // Words are kept whole, so one too long to fit beside the picture drops below it.
      while (!used && w > roomOn(n) && n <= beside) { n += 1; dropped = true; }
      used += (used ? gap : 0) + w;
    }
    return { n, dropped };
  };
  const fits = (size: number, allowDrop: boolean) => { const l = lines(size); return l.n * size * 1.04 <= height && (allowDrop || !l.dropped); };
  // Two ways to set it: beside the picture (the largest size at which every word fits there), or under the
  // picture at full width, with the height the picture takes off it. Whichever gives the bigger type wins; if
  // neither is readable, the largest size that fits at all, even with a word dropping below the picture.
  let beside = 0;
  for (let size = max; size >= 30; size -= 2) if (fits(size, false)) { beside = size; break; }
  const under = photo ? titleSize(text, width, height - (photo - 36), 0, max).size : 0;
  if (under > beside && under >= 30) return { size: under, below: true };
  if (beside) return { size: beside, below: false };
  for (let size = max; size > 26; size -= 2) if (fits(size, true)) return { size, below: false };
  return { size: 26, below: false };
};
// The day card: up first, in the middle; taller than its text, so the flyers hung round it only reach its blank
// margin (and with one, two, five or six flyers they cover it).
const CARD = { x: 130, y: 620, w: 820, h: 700, rot: -1.5, tack: '#c0392b', at: 0 };

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

// Small line pictures for the corner of a flyer, drawn with one thin stroke like a quick pen sketch.
const CornerGlyph = ({ glyph }: { glyph: Glyph }) => (
  <svg width={62} height={62} viewBox="0 0 48 48" style={{ float: 'right', margin: '-4px -6px 10px 14px', opacity: 0.8 }}>
    <g fill="none" stroke={A.barkSoft} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      {glyph === 'music' && <><path d="M18,34 V13 L36,9 V30" /><path d="M18,17 L36,13" /><ellipse cx={14} cy={34} rx={4.5} ry={3.4} /><ellipse cx={32} cy={30} rx={4.5} ry={3.4} /></>}
      {glyph === 'theatre' && <><path d="M10,10 C18,13 30,13 38,10 C39,25 33,36 24,39 C15,36 9,25 10,10 Z" /><path d="M15,20 Q18,18 21,20 M27,20 Q30,18 33,20 M17,28 Q24,33 31,28" /></>}
      {glyph === 'frame' && <><rect x={8} y={10} width={32} height={28} rx={1.5} /><path d="M12,33 L20,24 L26,30 L30,26 L36,33" /><circle cx={31} cy={17} r={2.4} /></>}
      {glyph === 'pencil' && <><path d="M12,36 L32,16 L36,20 L16,40 L10,42 Z" /><path d="M28,20 L32,24" /></>}
      {glyph === 'brush' && <><path d="M36,8 L22,28" /><path d="M22,28 C16,29 12,34 11,40 C17,39 23,36 24,31 Z" /></>}
      {glyph === 'dance' && <><ellipse cx={17} cy={27} rx={4.5} ry={8} transform="rotate(-12 17 27)" /><ellipse cx={31} cy={19} rx={4.5} ry={8} transform="rotate(12 31 19)" /><path d="M15,39 L19,39 M29,31 L33,31" /></>}
      {glyph === 'balloon' && <><ellipse cx={24} cy={18} rx={9} ry={11} /><path d="M22,29 L26,29 L24,32 Z M24,32 C21,36 27,38 24,42" /></>}
      {glyph === 'film' && <><rect x={9} y={12} width={30} height={24} rx={2} /><path d="M9,17 H39 M9,31 H39 M21,20 L28,24 L21,28 Z" /></>}
      {glyph === 'fork' && <><path d="M15,8 V19 C15,23 21,23 21,19 V8 M18,8 V40" /><path d="M31,40 V8 C36,11 36,21 31,24" /></>}
      {glyph === 'star' && <path d="M24,8 L28.5,19 L40,19.5 L31,27 L34,39 L24,32 L14,39 L17,27 L8,19.5 L19.5,19 Z" />}
    </g>
  </svg>
);

// The event's photo, printed small and stuck in the flyer's corner: a white border, a slight tilt, and
// a soft shadow where it sits on the paper.
const CornerPhoto = ({ src, tilt, size }: { src: string; tilt: number; size: number }) => (
  <div style={{ float: 'right', width: size, height: size, margin: '-10px -14px 12px 20px', padding: 6, background: '#fbf8f1',
    boxShadow: '0 3px 8px rgba(40,20,5,0.3)', transform: `rotate(${tilt}deg)` }}>
    <Img src={/^https?:\/\//.test(src) ? src : staticFile(src)} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
  </div>
);

const FlyerFace = ({ s, e }: { s: Slot; e: PinEvent }) => {
  const glyph = glyphFor(e);
  // Height left for the title once the label, rule and details are placed.
  // Above the tear-off strips there's room for one line of venue; elsewhere two.
  // The tear-off strips are off for now (commented out below), so the room they kept at the bottom is text room again.
  const tabs = false, bottom = tabs ? s.bottom : Math.min(s.bottom, 40);
  const pad = padOf(s), inner = s.w - 2 * pad, k = scaleOf(s);
  const venueLines = e.venue ? Math.min(tabs ? 1 : 2, Math.ceil((e.venue.length * 20 * k * 0.46) / inner)) : 0;
  const details = (34 + (e.price ? 38 : 0) + (venueLines ? 10 + venueLines * 24 : 0)) * k;
  const { size, below } = titleSize(e.title, inner, s.h - s.top - bottom - 38 * k - 39 - details, e.photo ? photoOf(s) : 0, titleMax(s));
  return (
  <div style={{ position: 'absolute', inset: 0, background: `${grain(0.12)}, ${s.paper}`, padding: `${s.top}px ${pad}px 0` }}>
    {e.photo ? <CornerPhoto src={e.photo} tilt={-s.rot * 0.6 + 2} size={photoOf(s)} /> : <CornerGlyph glyph={glyph} />}
    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10 * k }}>
      <div style={serif(22 * k, 700, { letterSpacing: '0.3em', color: A.rust })}>{(e.kind ?? LABEL[glyph]).toUpperCase()}</div>
      {/* The languages, as a small rubber-stamped box in the label's ink. */}
      {!!e.languages?.length && (
        <div style={serif(17 * k, 700, { letterSpacing: '0.14em', color: A.rust, border: `${Math.max(1.5, 2 * k)}px solid ${A.rust}`, borderRadius: 5 * k,
          padding: `${3 * k}px ${7 * k}px ${2 * k}px`, opacity: 0.85, transform: 'rotate(-2deg)' })}>{e.languages.join(' · ')}</div>
      )}
    </div>
    {/* Each word unbreakable (no splitting "Hide-and-Seek" at its hyphens), so a long one moves below the picture. */}
    <div style={serif(size, 700, { marginTop: 16, whiteSpace: 'normal', lineHeight: 1.04, clear: below ? 'both' : undefined })}>
      {e.title.split(/\s+/).map((word, i) => <Fragment key={i}>{i ? ' ' : ''}<span style={{ whiteSpace: 'nowrap' }}>{word}</span></Fragment>)}
    </div>
    <div style={{ width: 56, height: 3, background: A.rust, margin: '20px 0 16px' }} />
    <div style={serif(28 * k, 600, { whiteSpace: 'normal', lineHeight: 1.15 })}>{e.when}</div>
    {e.price && <div style={serif(26 * k, 500, { marginTop: 10, color: A.barkSoft, overflow: 'hidden', textOverflow: 'ellipsis' })}>{e.price}</div>}
    {e.venue && (
      <div style={serif(20 * k, 500, { marginTop: 10, whiteSpace: 'normal', lineHeight: 1.2, color: A.barkSoft,
        display: '-webkit-box', WebkitLineClamp: tabs ? 1 : 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' })}>{e.venue}</div>
    )}
    {/* Tear-off strips along the bottom, off for now. To bring them back, uncomment this and set `tabs` above back to s.tabs.
    {s.tabs && (
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 120, display: 'flex' }}>
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} style={{ flex: 1, borderLeft: i ? `2px dashed rgba(46,27,16,0.35)` : undefined, borderTop: `2px dashed rgba(46,27,16,0.35)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', visibility: i === 5 ? 'hidden' : 'visible' }}>
            <div style={serif(16, 700, { transform: 'rotate(-90deg)', letterSpacing: '0.12em', color: A.barkSoft })}>RĪGA WKND</div>
          </div>
        ))}
      </div>
    )}
    */}
  </div>
  );
};

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

export const PinboardStory = ({ day, date, kicker, category, count, events }: PinboardProps) => {
  const frame = useCurrentFrame();
  const list = (events?.length ? events : PLACEHOLDERS).slice(0, 6);
  // The card first, from frame 0; the flyers start once it has landed.
  const slots = slotsFor(list.length).map(s => ({ ...s, at: s.at + LEAD }));
  const flyers = list.slice(0, slots.length);
  const card = { ...CARD, at: 0 };

  return (
      <AbsoluteFill style={{ background: '#a67a4e', overflow: 'hidden', perspective: 4200, perspectiveOrigin: '50% 0' }}>
        <AbsoluteFill style={{ background: `${CORK}, #b48656` }} />
        <svg width={1080} height={1920} style={{ position: 'absolute', inset: 0 }}>
          {HOLES.map(([x, y, r], i) => <circle key={i} cx={x} cy={y} r={r} fill="#3a2410" opacity={0.55} />)}
        </svg>
        <AbsoluteFill style={{ background: 'radial-gradient(120% 90% at 40% 30%, rgba(255,230,190,0.18), rgba(30,15,5,0.4))' }} />

        {/* The day card goes up first, so it's read almost at once; then the flyers are pinned up over it. */}
        <Pinned frame={frame} {...card}>
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
        {flyers.map((e, i) => (
          <Pinned key={i} frame={frame} {...slots[i]}>
            <FlyerFace s={slots[i]} e={e} />
          </Pinned>
        ))}
        {/* Sound: the day card, then each flyer, flutters as it's put up and its tack goes in as it lands. */}
        {[...flyers.map((_, i) => slots[i]), card].map((p, i) => (
          <Fragment key={`snd${i}`}>
            <Sfx at={p.at} name={`pin-flutter-${(i % 3) + 1}`} volume={p === card ? 0.7 : 0.5} />
            <Sfx at={p.at + FALL} name={`pin-tack-${(i % 2) + 1}`} volume={0.85} />
          </Fragment>
        ))}
      </AbsoluteFill>
  );
};
