// The edit format: what ChatGPT (or you) writes to animate over a clip, as plain JSON. It describes
// layers on a timeline, never code, so a render can only ever do what the Remotion composition offers.
// Two clocks: anchors use SOURCE frames (the numbers on the contact sheets, where things are in the
// clip); everything else uses OUTPUT frames (the finished video, after trims, holds and speed changes).
import { z } from 'zod';
import { FPS } from './footage.js';

export const FORMATS = { vertical: [1080, 1920], portrait: [1080, 1350], square: [1080, 1080], landscape: [1920, 1080] };
export const MAX_OUTPUT_FRAMES = 180 * FPS; // Instagram Reels run to three minutes
export const PALETTE = { ink: '#17352d', lime: '#d4ed86', paper: '#f4f0e6', white: '#ffffff', black: '#111111', coral: '#ff6b5b', gold: '#f5c542', sky: '#7cc6fe' };
const ANCHOR = /^[a-z][a-z0-9_-]{0,23}$/;

// Factories rather than shared schemas: a schema object used twice becomes a JSON-pointer $ref in the tool
// definition ChatGPT reads, and plain inline JSON Schema is the safest thing to hand a model.
const Frame = () => z.number().int().min(0).max(100000);
const Unit = () => z.number().min(0).max(1);
const Color = () => z.union([z.enum(Object.keys(PALETTE)), z.string().regex(/^#[0-9a-fA-F]{6}$/)]).describe(`A palette name (${Object.keys(PALETTE).join(', ')}) or #rrggbb`);
const Place = () => z.union([z.string().regex(ANCHOR), z.object({ x: Unit(), y: Unit() }).strict()])
  .describe('An anchor name (sticks to it in the footage) or {x,y} in 0–1 of the finished frame');
const Offset = () => z.object({ x: z.number().min(-1).max(1), y: z.number().min(-1).max(1) }).strict()
  .describe('Shift from `at` in fractions of the frame');
// A flight path in OUTPUT frames, so things can move even during a freeze. Positions between keys are
// smoothed into curves. A key can name an anchor instead of x/y, to land exactly on something in the shot.
const Path = () => z.array(z.object({
  frame: Frame().describe('OUTPUT frame'),
  x: Unit().optional(), y: Unit().optional(),
  at: z.string().regex(ANCHOR).optional().describe('Instead of x/y: an anchor name, to arrive exactly on it'),
  depth: Unit().optional().describe('Depth at this key; overrides the layer depth'),
}).strict()).min(2).max(600).optional()
  .describe('Keyframes {frame,x,y} in 0–1 (or {frame,at}), smoothed into curves; used instead of `at`');
const Facing = () => z.enum(['as-drawn', 'flip', 'path']).default('as-drawn')
  .describe('path: turns to face the way it moves along `path` and leans into turns (draw it facing right); flip: mirrored');
const Follow = () => z.string().regex(ANCHOR).optional()
  .describe('An anchor on something fixed in the scene: `at` and `path` move with it, so a handheld shot does not leave the layer sliding. See get_edit_guide');
const Depth = () => Unit().optional().describe('How near, 0 far – 1 near (get_depth): hidden where the scene is nearer. Needs depth on the edit');
const Blend = () => z.enum(['normal', 'screen', 'add', 'multiply', 'overlay', 'soft-light', 'lighten']).default('normal')
  .describe('How it mixes with what is under it: screen or add for light (glints, flares, dust in a sunbeam), multiply for shadows and ink');
const Glow = () => z.number().min(0).max(80).default(0).describe('Soft glow around it, in pixels (0 none); pairs with blend screen for light effects');
const Span = () => ({
  from: Frame().describe('First OUTPUT frame'),
  to: Frame().describe('OUTPUT frame it ends, exclusive'),
  in: z.number().int().min(0).max(90).default(8).describe('Entrance frames'),
  out: z.number().int().min(0).max(90).default(8).describe('Exit frames'),
});

const TextMotion = () => z.object({
  by: z.enum(['letter', 'word', 'line']).default('letter'),
  style: z.enum(['fade', 'rise', 'drop', 'pop', 'blur', 'slide', 'scramble', 'typewriter', 'flip']).default('rise')
    .describe('rise/drop move each piece up into place or down from above, pop springs it, blur focuses it, scramble shows random letters that settle, flip turns it over'),
  stagger: z.number().int().min(0).max(30).default(2).describe('Frames between one piece and the next'),
  duration: z.number().int().min(1).max(60).default(10).describe('Frames each piece takes'),
}).strict();

const Text = z.object({
  type: z.literal('text'), ...Span(),
  text: z.string().trim().min(1).max(140).refine(t => t.split('\n').length <= 3, 'Up to three lines').describe('Up to three lines; use \\n to break'),
  style: z.enum(['title', 'callout', 'caption', 'label', 'script', 'band']).default('caption')
    .describe('title: big serif headline; callout: paper card, pairs with pointer; caption: bold subtitle; label: small tag; script: handwritten accent; band: full-width bar'),
  at: Place().optional().describe('Where the text sits. Defaults: title near the top, caption and band near the bottom, others at the centre'),
  offset: Offset().optional(), path: Path(), follow: Follow(), depth: Depth(),
  pointer: z.boolean().default(false).describe('Draw a line from the text back to `at`; use with an anchor and an offset for a callout'),
  size: z.number().int().min(20).max(220).optional().describe('Type size in pixels on a 1080-wide frame'),
  color: Color().optional(), background: z.union([Color(), z.literal('none')]).optional(),
  align: z.enum(['left', 'center', 'right']).default('center'),
  enter: z.enum(['pop', 'fade', 'rise', 'type', 'slide', 'none']).default('pop'),
  exit: z.enum(['fade', 'pop', 'sink', 'none']).default('fade'),
  font: z.enum(['serif', 'script', 'sans', 'display', 'mono']).optional()
    .describe('serif (Cormorant, the brand), script (handwritten), sans (Inter, heavy), display (Bebas Neue, tall capitals for cinema titles), mono (typewriter). Default by style'),
  reveal: TextMotion().optional().describe('Animates the text in piece by piece (letters, words or lines) instead of all at once'),
  hide: TextMotion().optional().describe('Animates it out piece by piece at the end of the layer'),
  loop: z.enum(['none', 'wave', 'bounce', 'pulse', 'shake', 'flicker', 'glow']).default('none')
    .describe('Keeps moving while on: wave (letters ripple), bounce, pulse (breathes), shake (jitters, for impact), flicker (neon sign), glow (pulsing glow)'),
  highlight: z.object({
    words: z.array(z.string().min(1).max(40)).min(1).max(10).describe('Words to mark, as written in the text'),
    color: Color().default('lime'), style: z.enum(['marker', 'underline', 'box']).default('marker'),
    delay: z.number().int().min(0).max(300).default(8).describe('Frames after the layer starts that the marker sweeps in'),
  }).strict().optional(),
  count: z.object({
    from: z.number().min(-1e9).max(1e9), to: z.number().min(-1e9).max(1e9),
    decimals: z.number().int().min(0).max(3).default(0), frames: z.number().int().min(1).max(600).default(30).describe('How long the count takes'),
  }).strict().optional().describe('Counts a number up or down: put {n} in the text where it goes (or the text is just the number), e.g. "{n} coffees a day"'),
  stroke: z.object({ color: Color(), width: z.number().min(0.5).max(20) }).strict().optional().describe('Outline around the letters'),
  glow: Color().optional().describe('Glowing light around the letters'),
  gradient: z.array(Color()).length(2).optional().describe('Top and bottom colour of the letters'),
  tracking: z.number().min(-0.1).max(1).optional().describe('Letter spacing in em, e.g. 0.3 for wide cinema titles'),
  rotate: z.number().min(-45).max(45).default(0),
  blend: Blend(),
}).strict();

const Sticker = z.object({
  type: z.literal('sticker'), ...Span(),
  shape: z.enum(['sparkles', 'steam', 'hearts', 'stars', 'circle', 'arrow', 'burst', 'pulse', 'underline', 'squiggle'])
    .describe('Animated drawing. steam rises and sparkles twinkle for as long as they are on; circle, arrow, underline and squiggle draw themselves on; burst and pulse radiate'),
  at: Place().optional(), offset: Offset().optional(), path: Path(), follow: Follow(), depth: Depth(),
  size: z.number().int().min(40).max(1200).default(240).describe('Width in pixels on a 1080-wide frame'),
  color: Color().default('lime'),
  rotate: z.number().min(-180).max(180).default(0).describe('Degrees; an arrow points right at 0'),
  enter: z.enum(['draw', 'pop', 'fade', 'none']).default('draw'),
  exit: z.enum(['fade', 'pop', 'none']).default('fade'),
}).strict();

const Illustrate = z.object({
  type: z.literal('illustrate'), ...Span(),
  style: z.enum(['cel', 'ink', 'sketch', 'watercolor', 'duotone', 'posterize'])
    .default('cel').describe('How the footage is redrawn: cel (flat cartoon colours with outlines), ink (comic line art over colour), sketch (pencil on paper), watercolor, duotone (two colours), posterize (flat colours only)'),
  transition: z.enum(['fade', 'wipe', 'iris']).default('wipe').describe('How the drawing takes over and hands back; iris opens from `at`'),
  at: Place().optional().describe('Centre of an iris transition'),
  boil: z.boolean().default(true).describe('Hand-drawn wobble that changes every third frame, like drawn animation'),
  colors: z.array(Color()).length(2).optional().describe('Two colours for duotone: dark, then light'),
}).strict();

const Image = z.object({
  type: z.literal('image'), ...Span(),
  asset: z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/).describe('Name of an image uploaded for this footage (see list_footage)'),
  place: z.enum(['footage', 'screen']).default('screen')
    .describe('footage: cover the video exactly and move with it (an illustration drawn over a frame of this clip); screen: a picture placed at `at`'),
  at: Place().optional(), offset: Offset().optional(), path: Path(), follow: Follow(), facing: Facing(), depth: Depth(),
  size: z.number().min(0.05).max(2).default(0.4).describe('Width as a fraction of the finished frame (screen placement)'),
  opacity: Unit().default(1),
  enter: z.enum(['pop', 'fade', 'wipe', 'none']).default('fade'),
  exit: z.enum(['pop', 'fade', 'none']).default('fade'),
  motion: z.enum(['none', 'float', 'boil', 'sway', 'pulse', 'spin']).default('none'),
  blend: Blend(), glow: Glow(), tint: Color().optional().describe('Recolours the whole picture in one colour, keeping its shape and transparency'),
}).strict();

// Frame-by-frame animation from a sprite sheet: every frame side by side in one row, equal widths,
// on a transparent background. A flapping bird, a hand-drawn flicker, a turntable of a 3D object.
const Sequence = z.object({
  type: z.literal('sequence'), ...Span(),
  asset: z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/).describe('Name of an uploaded sprite sheet: equal-sized frames in one row, or in a grid with columns'),
  count: z.number().int().min(2).max(256).describe('How many frames the sheet holds'),
  columns: z.number().int().min(1).max(64).optional().describe('Frames per row for a grid sheet, read left to right, top to bottom (default: all in one row); build_sprite makes grids'),
  range: z.object({ from: z.number().int().min(0).max(255), to: z.number().int().min(0).max(255) }).strict().optional().describe('Play only sheet frames from..to (inclusive), e.g. just the flash of an impact'),
  playback: z.enum(['loop', 'once', 'pingpong']).optional().describe('loop repeats, once stops on the last frame, pingpong plays forwards then backwards (default from loop)'),
  fps: z.number().int().min(1).max(30).default(12).describe('How fast the frames play; 8–12 feels hand-drawn, 24–30 smooth'),
  loop: z.boolean().default(true).describe('Repeat the frames, or stop on the last one'),
  at: Place().optional(), offset: Offset().optional(), path: Path(), follow: Follow(), facing: Facing(), depth: Depth(),
  size: z.number().min(0.03).max(2).default(0.2).describe('Width of one frame as a fraction of the finished frame'),
  opacity: Unit().default(1),
  enter: z.enum(['pop', 'fade', 'none']).default('fade'),
  exit: z.enum(['pop', 'fade', 'none']).default('fade'),
  motion: z.enum(['none', 'bob', 'sway']).default('none').describe('bob: gentle up and down, like hovering'),
  rotate: z.number().min(-360).max(360).default(0), spin: z.number().min(-1440).max(1440).default(0).describe('Degrees per second'),
  blend: Blend(), glow: Glow(), tint: Color().optional().describe('Recolours every frame in one colour, keeping shape and transparency'),
}).strict();

// Particles: many small copies of a shape or sprite, emitted from a point or area over time, each with its
// own direction, speed, size and spin, drawn the same on every render (seeded). Dust, sparks, confetti,
// embers, steam droplets, bubbles, snow.
const Particles = z.object({
  type: z.literal('particles'), ...Span(),
  shape: z.enum(['dot', 'soft', 'spark', 'star', 'ring', 'streak', 'heart', 'confetti', 'square']).optional()
    .describe('Built-in particle: dot (hard), soft (blurred dust mote), spark (4-point glint), star, ring, streak (a line along its motion), heart, confetti (tumbling paper), square'),
  asset: z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/).optional().describe('Or an uploaded picture or sprite sheet as the particle'),
  count: z.number().int().min(1).max(256).default(1).describe('Frames in the sheet, for an animated particle'),
  columns: z.number().int().min(1).max(64).optional(), fps: z.number().int().min(1).max(30).default(12),
  at: Place().optional().describe('Where they come from'), offset: Offset().optional(), path: Path(), follow: Follow(), depth: Depth(),
  area: z.object({ width: Unit(), height: Unit() }).strict().optional().describe('Spawn box around the emitter, in fractions of the frame (default a single point)'),
  rate: z.number().min(0).max(300).default(20).describe('New particles per second'),
  burst: z.number().int().min(0).max(400).default(0).describe('Particles all at once at the start (an impact, a pop)'),
  life: z.number().int().min(2).max(600).default(45).describe('Frames each particle lives'),
  speed: z.number().min(0).max(3).default(0.15).describe('Frame widths per second'),
  direction: z.number().min(-180).max(180).default(-90).describe('Degrees: 0 right, -90 up, 90 down, 180 left'),
  spread: z.number().min(0).max(360).default(60).describe('Degrees either side of direction, in total; 360 in every direction'),
  gravity: z.number().min(-3).max(3).default(0).describe('Frame widths per second², positive pulls down (confetti 0.4, rising embers -0.1)'),
  drag: z.number().min(0).max(10).default(0).describe('Slows them down over time (a burst that settles: 3)'),
  size: z.number().min(0.001).max(0.5).default(0.015).describe('Width of a particle as a fraction of the frame width'),
  sizeRandom: Unit().default(0.5).describe('How much sizes vary (0 all the same)'),
  grow: z.number().min(0).max(8).default(1).describe('Size at the end of its life relative to the start (0.2 shrinks away, 3 billows)'),
  spin: z.number().min(0).max(1440).default(0).describe('Most degrees per second a particle turns'),
  colors: z.array(Color()).min(1).max(8).optional().describe('Colours picked at random per particle, for shapes (default paper)'),
  fade: z.enum(['in-out', 'out', 'none']).default('in-out'),
  opacity: Unit().default(1), blend: Blend(), glow: Glow(),
  seed: z.number().int().min(0).max(100000).default(1).describe('Change it for a different random pattern'),
}).strict();

// Graphics: shapes ChatGPT draws and animates itself, as data. Each element is a path, circle, ellipse,
// rectangle, line or line of text in the graphic's own coordinates (its viewBox), and any of its
// position, rotation, scale, opacity and stroke draw-on can be keyframed. Saved graphics are reused by name.
const PATH_D = /^[MmLlHhVvCcSsQqTtAaZz0-9eE.,\s+-]+$/;
const Num = () => z.number().min(-100000).max(100000);
const Track = () => z.array(z.object({ frame: z.number().int().min(0).max(100000).describe('Frames from the layer start'), value: Num() }).strict()).min(1).max(200);
const Keys = () => z.object({
  x: Track().optional(), y: Track().optional(),
  rotate: Track().optional().describe('Degrees, around `origin`'),
  scale: Track().optional(), scaleX: Track().optional(), scaleY: Track().optional(),
  opacity: Track().optional().describe('0–1'),
  draw: Track().optional().describe('0–1: how much of the outline is drawn, for strokes that draw themselves on'),
}).strict();
const Element = () => z.object({
  shape: z.enum(['path', 'circle', 'ellipse', 'rect', 'line', 'text']),
  d: z.string().max(4000).regex(PATH_D).optional().describe('SVG path data, for shape path'),
  cx: Num().optional(), cy: Num().optional(), r: Num().optional(), rx: Num().optional(), ry: Num().optional(),
  x: Num().optional(), y: Num().optional(), width: Num().optional(), height: Num().optional(), x2: Num().optional(), y2: Num().optional(),
  text: z.string().max(80).optional(), font: z.enum(['serif', 'script']).optional(), fontSize: z.number().min(1).max(2000).optional(),
  anchor: z.enum(['start', 'middle', 'end']).optional(),
  fill: z.union([Color(), z.literal('none')]).optional(), stroke: Color().optional(), strokeWidth: z.number().min(0).max(500).optional(),
  opacity: z.number().min(0).max(1).optional(),
  origin: z.object({ x: Num(), y: Num() }).strict().optional().describe('Pivot for rotate and scale, e.g. where a wing joins the body'),
  keys: Keys().optional(),
  ease: z.enum(['linear', 'smooth', 'in', 'out', 'back', 'bounce']).default('smooth').describe('Easing between keyframes'),
  repeat: z.object({
    count: z.number().int().min(2).max(60), delay: z.number().int().min(0).max(300).default(0).describe('Frames each copy starts after the previous one'),
    dx: Num().default(0), dy: Num().default(0), rotate: Num().default(0), scale: z.number().min(0.1).max(10).default(1),
  }).strict().optional().describe('Copies of this element, each shifted and delayed: particles, confetti, a row of dots'),
}).strict();
const GraphicFields = () => ({
  viewBox: z.object({ width: z.number().min(1).max(10000), height: z.number().min(1).max(10000) }).strict().optional().describe('The graphic\'s own coordinate space (default 100×100)'),
  loop: z.number().int().min(0).max(900).optional().describe('Repeat every element\'s keyframes every N frames (0 or absent: play once)'),
  elements: z.array(Element()).min(1).max(120).optional(),
});
export const GraphicDef = z.object({ ...GraphicFields(), elements: z.array(Element()).min(1).max(120) }).strict();
const Graphic = z.object({
  type: z.literal('graphic'), ...Span(),
  use: z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/).optional().describe('Name of a saved graphic (list_graphics), instead of elements'),
  ...GraphicFields(),
  at: Place().optional(), offset: Offset().optional(), path: Path(), follow: Follow(), facing: Facing(), depth: Depth(),
  size: z.number().int().min(10).max(4000).default(300).describe('Width in pixels on a 1080-wide frame'),
  opacity: Unit().default(1),
  enter: z.enum(['pop', 'fade', 'none']).default('fade'),
  exit: z.enum(['pop', 'fade', 'none']).default('fade'),
}).strict();

// A 3D model (.glb uploaded for the clip) with its own animations, placed like any other layer. Angles
// are degrees; keys count frames from the layer's start, like a graphic's.
const Degrees = () => z.number().min(-720).max(720);
const AnimationName = () => z.string().min(1).max(80);
const Model = z.object({
  type: z.literal('model'), ...Span(),
  asset: z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/).describe('Name of a 3D model uploaded for this footage (list_footage, under models)'),
  node: z.string().min(1).max(64).optional()
    .describe('Draw only this node of the model and its children (list_footage, under nodes) — e.g. the fox out of a workshop. The rest still animates; size and pin measure the chosen part'),
  animation: AnimationName().optional().describe('Which of the model\'s animations plays from the layer\'s start (names from list_footage); leave out to hold its rest pose'),
  speed: z.number().min(0.1).max(4).default(1).describe('Animation speed; 1 is as made'),
  loop: z.boolean().default(true).describe('Repeat the animation, or stop on its last pose'),
  actions: z.array(z.object({
    frame: Frame().describe('OUTPUT frame this animation takes over'),
    animation: AnimationName(),
    speed: z.number().min(0.1).max(4).optional(), loop: z.boolean().optional().describe('Default true; false plays once and holds the last pose (sitting down, landing)'),
    stride: z.number().min(0.05).max(10).optional().describe('Like the layer\'s stride, for this animation (a run after a walk)'),
  }).strict()).max(20).optional().describe('Switch animations during the layer, e.g. walk then sit: [{"frame":130,"animation":"Sit","loop":false}]'),
  blend: z.number().int().min(0).max(30).default(8).describe('Frames to cross-fade between animations'),
  at: Place().optional().describe('Where it stands (with pin feet, its feet are here)'), offset: Offset().optional(), path: Path(), follow: Follow(),
  depth: z.union([Unit(), z.literal('auto')]).optional()
    .describe('"auto" (best for something walking on a surface): each frame it takes the depth of the ground under its feet, so it is never cut off by the table it stands on but still goes behind nearer things. Or a fixed 0 far – 1 near. Needs depth on the edit'),
  stride: z.number().min(0.05).max(10).optional()
    .describe('Distance one loop of the animation covers, in multiples of the model height (~1 walk, 2–3 run), so feet stay planted. get_edit_guide has the fix-up rule'),
  front: z.enum(['camera', 'away', 'right', 'left']).default('camera')
    .describe('Which way the model faces as made, before any turn. glTF models normally face the camera; if a preview with turn 0 shows it facing another way, say which, and facing path will then walk it forwards'),
  facing: z.enum(['as-made', 'path']).default('as-made').describe('path: turns to walk or fly the way it moves along `path`, turning round through facing the camera'),
  angle: z.number().min(0).max(90).default(65).describe('With facing path: 90 is a side view, less turns it towards the camera'),
  pin: z.enum(['feet', 'center']).default('feet').describe('Which point of the model sits on `at`: its feet (standing on something) or its middle (flying)'),
  size: z.number().min(0.02).max(1.5).default(0.2).describe('Height of the model as a fraction of the finished frame\'s height. list_footage gives each model\'s bounds, so for a wide flat one (a book, a sign) work it out from the width you want: size = wantedWidthPx * bounds.height / (bounds.width * frameHeightPx)'),
  turn: Degrees().default(0).describe('Turn around its vertical axis: 0 faces the camera, 90 faces right, -90 faces left, 180 away'),
  tilt: z.number().min(-60).max(80).default(15).describe('How far we look down on it: 0 level, 30 from above like a phone over a table. Match the footage'),
  keys: z.object({
    turn: Track().optional().describe('Degrees, replaces turn over time'), tilt: Track().optional(),
    spin: Track().optional().describe('Degrees added to turn, e.g. a turntable 0→360'), roll: Track().optional().describe('Degrees of sideways lean'),
    scale: Track().optional().describe('Multiplies size'),
  }).strict().optional().describe('Keyframed turns, tilts and scale; frames count from the layer\'s start'),
  light: z.enum(['left', 'right', 'front', 'top', 'back']).default('left').describe('Where the main light comes from; match the light in the footage so it sits in the shot'),
  brightness: z.number().min(0.2).max(3).default(1),
  shadow: Unit().default(0.35).describe('Darkness of the shadow it casts on the ground under it; 0 for none (flying)'),
  color: Color().optional().describe('Tints the whole model; for a plain model without colours of its own'),
  soften: z.number().min(0).max(1).default(0)
    .describe('Blurs and grains the model a touch so it matches phone footage instead of looking sharper than the shot it sits in. 0.3–0.5 for handheld video, 0 for clean footage'),
  look: z.enum(['as-made', 'toon']).default('as-made').describe('toon: flat cartoon shading with an ink outline, to match illustrated moments'),
  boil: z.boolean().default(false).describe('Hand-drawn wobble, with look toon'),
  opacity: Unit().default(1),
  enter: z.enum(['pop', 'fade', 'none']).default('fade'),
  exit: z.enum(['pop', 'fade', 'none']).default('fade'),
}).strict();

// What a graphic needs beyond its schema: each shape has the fields it draws from.
const NEEDS = { path: ['d'], circle: ['r'], ellipse: ['rx', 'ry'], rect: ['width', 'height'], line: ['x2', 'y2'], text: ['text'] };
export function graphicErrors(def, where) {
  const errors = [];
  for (const [i, el] of def.elements.entries()) {
    const missing = NEEDS[el.shape].filter(k => el[k] == null);
    if (missing.length) errors.push(`${where}: elements.${i} (${el.shape}) needs ${missing.join(' and ')}`);
    for (const [prop, track] of Object.entries(el.keys || {})) {
      track.sort((a, b) => a.frame - b.frame);
      if (track.some((k, n) => n && k.frame === track[n - 1].frame)) errors.push(`${where}: elements.${i}.keys.${prop} has two keys on one frame`);
    }
  }
  return errors;
}

// Depth effects: they need a depth source on the edit (per-frame depth for the clip, or a depth picture).
const Blur = z.object({
  type: z.literal('blur'), ...Span(),
  focus: Unit().describe('Depth that stays sharp (read it with get_depth, e.g. the cup)'),
  range: z.number().min(0.01).max(1).default(0.15).describe('How far either side of focus stays sharp'),
  amount: z.number().min(1).max(40).default(12).describe('Blur in pixels on a 1080-wide frame for the farthest parts'),
  near: z.boolean().default(false).describe('Also blur what is nearer than the focus'),
}).strict();
const Fog = z.object({
  type: z.literal('fog'), ...Span(),
  color: Color().default('paper'), strength: Unit().default(0.6).describe('Opacity of the fog at the farthest point'),
  start: Unit().default(0.6).describe('Depth where fog begins; farther parts get more'),
}).strict();
const Parallax = z.object({
  type: z.literal('parallax'), ...Span(),
  move: z.enum(['pan', 'tilt', 'orbit']).default('pan').describe('pan: near things slide sideways more than far ones; tilt: up and down; orbit: a slow circle'),
  amount: z.number().min(0.005).max(0.15).default(0.04).describe('How far the nearest things move, as a fraction of the frame width'),
}).strict();

const Zoom = z.object({
  type: z.literal('zoom'), ...Span(),
  scale: z.number().min(1).max(4).describe('1.5 fills the frame with the middle two thirds'),
  focus: Place().describe('Anchor name, or {x,y} in 0–1 of the FOOTAGE (not the screen): the point to move towards'),
}).strict();

const Shake = z.object({ type: z.literal('shake'), ...Span(), strength: Unit().default(0.4) }).strict();
const Flash = z.object({ type: z.literal('flash'), ...Span(), color: Color().default('white') }).strict();

export const Layer = z.discriminatedUnion('type', [Text, Sticker, Illustrate, Image, Sequence, Particles, Graphic, Model, Blur, Fog, Parallax, Zoom, Shake, Flash]);

const Play = z.object({
  from: Frame().describe('First SOURCE frame'), to: Frame().describe('SOURCE frame to stop before'),
  speed: z.number().min(0.25).max(4).default(1).describe('0.5 is half-speed slow motion; sound is muted when not 1'),
}).strict();
const Hold = z.object({
  hold: Frame().describe('SOURCE frame to freeze on'),
  frames: z.number().int().min(1).max(30 * FPS).describe('How many OUTPUT frames the freeze lasts (silent)'),
}).strict();

// Sound effects and music on the timeline, in OUTPUT frames, from sound files uploaded for the clip.
const Cue = () => z.object({
  sound: z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/).describe('Name of a sound uploaded for this footage (list_footage, under sounds)'),
  at: Frame().describe('OUTPUT frame it starts on, e.g. the frame a cat lands'),
  volume: z.number().min(0).max(2).default(1).describe('1 as recorded; 0.3 for quiet background steps'),
  from: z.number().min(0).max(600).default(0).describe('Seconds into the file to start from, to skip silence or pick one hit from a longer recording'),
  length: z.number().int().min(1).max(100000).optional().describe('OUTPUT frames to play before it is cut (default: to the end of the file); with loop, how long the loop runs'),
  loop: z.boolean().default(false).describe('Repeat the sound for its whole length, e.g. footsteps under a walk'),
  fadeIn: z.number().int().min(0).max(300).default(0).describe('Frames to fade in'),
  fadeOut: z.number().int().min(0).max(300).default(3).describe('Frames to fade out at the end, so a cut never clicks'),
  speed: z.number().min(0.5).max(2).default(1).describe('Playback speed; changes pitch too'),
  volumeKeys: z.array(z.object({ frame: z.number().int().min(0).max(100000).describe('Frames from the cue\'s start'), value: z.number().min(0).max(4) }).strict()).min(1).max(100).optional()
    .describe('Volume over time (multiplies volume), eased between keys: swells, dips, a sound that builds'),
  duck: z.number().min(0).max(1).optional().describe('While this plays, the clip\'s own sound drops to this level (0.3 = 30%), easing down and back up'),
  // Effects are applied to the file first (on the server, with ffmpeg); from, length and loop then apply to the result.
  pan: z.number().min(-1).max(1).default(0).describe('Stereo position: -1 left, 0 centre, 1 right, e.g. following something across the screen'),
  pitch: z.number().min(-12).max(12).default(0).describe('Pitch shift in semitones without changing speed (-12 an octave down, 12 up)'),
  reverse: z.boolean().default(false).describe('Play it backwards'),
  lowpass: z.number().int().min(100).max(20000).optional().describe('Cut frequencies above this many Hz: muffled, through a wall, underwater (e.g. 800)'),
  highpass: z.number().int().min(20).max(10000).optional().describe('Cut frequencies below this many Hz: thin, like a phone or radio (e.g. 1500)'),
  bass: z.number().min(-20).max(20).default(0).describe('Bass boost or cut in dB'),
  treble: z.number().min(-20).max(20).default(0).describe('Treble boost or cut in dB'),
  echo: z.object({ delay: z.number().int().min(20).max(2000).default(250).describe('Milliseconds between repeats'), decay: z.number().min(0.05).max(0.9).default(0.4).describe('How loud each repeat is') }).strict().optional(),
  reverb: z.number().min(0).max(1).default(0).describe('Room sound: 0.2 a small room, 0.6 a hall, 1 a cathedral'),
  normalize: z.boolean().default(false).describe('Even out the loudness first, for sounds recorded too quiet or too loud'),
}).strict();

// Echo and reverb ring on after a sound ends: the processed file gets this much silence added so the
// tail is heard, and the cue's natural length includes it.
export const tailSeconds = cue => Math.min(4, (cue.echo ? (cue.echo.delay / 1000) * 4 : 0) + (cue.reverb ? 0.4 + cue.reverb * 2 : 0));
export const soundEffects = cue => !!(cue.pan || cue.pitch || cue.reverse || cue.lowpass || cue.highpass || cue.bass || cue.treble || cue.echo || cue.reverb || cue.normalize);

const AnchorKeys = () => z.array(z.object({ frame: Frame().describe('SOURCE frame'), x: Unit(), y: Unit() }).strict()).min(1).max(900);

export const EditSpec = z.object({
  format: z.enum(Object.keys(FORMATS)).default('vertical').describe('vertical 1080×1920 (Reels, Stories), portrait 1080×1350, square 1080×1080, landscape 1920×1080'),
  fit: z.enum(['cover', 'contain']).default('cover').describe('cover fills the frame and crops; contain shows the whole clip on the background'),
  background: Color().default('ink'),
  audio: z.enum(['source', 'mute']).default('source').describe('The clip\'s own sound; sound effects in sounds play either way'),
  sourceVolume: z.number().min(0).max(2).default(1).describe('Volume of the clip\'s own sound, e.g. 0.4 to keep the café ambience under the effects'),
  sourceKeys: z.array(z.object({ frame: Frame().describe('OUTPUT frame'), value: z.number().min(0).max(4) }).strict()).min(1).max(200).optional()
    .describe('The clip\'s own sound over time (multiplies sourceVolume), eased between keys: fade it out at the end, swell it on a reveal'),
  sounds: z.array(Cue()).max(60).default([]).describe('Sound effects and music placed on OUTPUT frames: steps, a whoosh on a jump, a poof, a music bed'),
  timeline: z.array(z.union([Play, Hold])).min(1).max(40).optional()
    .describe('The cut, in order: {from,to[,speed]} plays source frames, {hold,frames} freezes one. Leave out to play the whole clip once'),
  // Anchor names are checked in planEdit: a key pattern in the schema becomes propertyNames, which
  // ChatGPT's tool-schema check rejects.
  anchors: z.record(z.array(z.object({ frame: Frame().describe('SOURCE frame'), x: Unit(), y: Unit() }).strict()).min(1).max(900))
    .refine(a => Object.keys(a).length <= 40, 'At most 40 anchors').default({}).describe('Named points on things in the footage, keyframed on SOURCE frames in 0–1 of the footage; positions between keyframes are interpolated, and held before the first and after the last'),
  depth: z.object({
    video: z.boolean().default(false).describe('Use this clip\'s per-frame depth (see create_download_link and create_upload_link kind depth); it follows the timeline like the footage'),
    stills: z.array(z.object({ from: Frame(), to: Frame(), asset: z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/) }).strict()).max(20).optional()
      .describe('A depth picture (uploaded asset, same shape as the footage) for OUTPUT frames from..to, e.g. during a freeze; takes over from the video there'),
    near: z.enum(['white', 'black']).default('white').describe('Which end of the greyscale is near'),
  }).strict().optional().describe('Where depth comes from, for layers with depth and for blur, fog and parallax'),
  layers: z.array(Layer).max(80).default([]).describe('Drawn in order, later layers on top; illustrate layers always sit right over the footage, under every other layer'),
}).strict();

// MCP tool importers do not consistently accept open-ended object keys. Keep the stored edit format
// unchanged, but advertise anchors as a named list on the MCP boundary.
export const McpEditSpec = EditSpec.omit({ anchors: true }).extend({
  anchors: z.array(z.object({
    name: z.string().regex(ANCHOR).describe('Anchor name, starting with a lowercase letter'),
    keys: AnchorKeys().describe('Positions on SOURCE frames, in 0–1 of the footage'),
  }).strict()).max(40).superRefine((anchors, ctx) => {
    const seen = new Set();
    for (const [i, anchor] of anchors.entries()) {
      if (seen.has(anchor.name)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [i, 'name'], message: `Duplicate anchor '${anchor.name}'` });
      seen.add(anchor.name);
    }
  }).default([]).describe('Named points on things in the footage; use an empty list when no anchors are needed'),
}).strict();

export const fromMcpEdit = edit => ({ ...edit, anchors: Object.fromEntries(edit.anchors.map(({ name, keys }) => [name, keys])) });
export const toMcpEdit = edit => ({ ...edit, anchors: Object.entries(edit.anchors).map(([name, keys]) => ({ name, keys })) });

const fail = message => Object.assign(new Error(message), { httpStatus: 400 });
const pos = s => typeof s === 'string' ? `anchor '${s}'` : null;

// Checks an edit against the clip it animates and works out its timeline. `footage` is the working
// copy's info ({frames, width, height}); `assets` maps asset names to {width, height}; `models` maps model
// names to {animations: [names]}; `sounds` maps sound names to {seconds}. Returns the
// normalised spec (defaults filled in, so a stored version renders the same later), the plan the
// renderer follows and the output↔source mapping to show back.
export function planEdit(input, footage, assets = {}, graphics = {}, models = {}, sounds = {}) {
  const spec = EditSpec.parse(input);
  const errors = [], warnings = [];
  const last = footage.frames - 1;
  const segments = [];
  let t = 0;
  for (const [i, s] of (spec.timeline ?? [{ from: 0, to: footage.frames, speed: 1 }]).entries()) {
    if ('hold' in s) {
      if (s.hold > last) errors.push(`timeline.${i}: frame ${s.hold} is past the end of the clip (its last frame is ${last})`);
      segments.push({ from: t, to: t + s.frames, source: Math.min(s.hold, last), hold: true });
      t += s.frames;
      continue;
    }
    const to = Math.min(s.to, footage.frames);
    if (s.from > last) { errors.push(`timeline.${i}: frame ${s.from} is past the end of the clip (its last frame is ${last})`); continue; }
    if (s.to > footage.frames) warnings.push(`timeline.${i}: the clip ends at frame ${footage.frames}, so this part stops there`);
    if (to <= s.from) { errors.push(`timeline.${i}: 'to' must be after 'from'`); continue; }
    const length = Math.ceil((to - s.from) / s.speed);
    segments.push({ from: t, to: t + length, source: s.from, sourceTo: to, speed: s.speed });
    t += length;
  }
  const duration = t;
  if (duration > MAX_OUTPUT_FRAMES) errors.push(`The edit runs ${(duration / FPS).toFixed(1)} s; keep it under ${MAX_OUTPUT_FRAMES / FPS} s`);

  for (const [name, keys] of Object.entries(spec.anchors)) {
    if (!ANCHOR.test(name)) { errors.push(`anchors.${name}: use lowercase letters, digits, - and _ (up to 24), starting with a letter`); continue; }
    keys.sort((a, b) => a.frame - b.frame);
    if (keys.some((k, i) => i && k.frame === keys[i - 1].frame)) errors.push(`anchors.${name}: two keyframes on frame ${keys.find((k, i) => i && k.frame === keys[i - 1].frame).frame}`);
    if (keys.at(-1).frame > last) errors.push(`anchors.${name}: frame ${keys.at(-1).frame} is past the end of the clip (its last frame is ${last})`);
  }
  const used = new Set();
  const needAnchor = (where, value) => {
    if (typeof value !== 'string') return;
    used.add(value);
    if (!spec.anchors[value]) errors.push(`${where}: there is no ${pos(value)}; define it under anchors`);
  };
  const zooms = [];
  for (const [i, layer] of spec.layers.entries()) {
    const where = `layers.${i} (${layer.type})`;
    if (layer.to <= layer.from) { errors.push(`${where}: 'to' must be after 'from'`); continue; }
    if (layer.from >= duration) { errors.push(`${where}: starts at frame ${layer.from}, but the edit is only ${duration} frames long`); continue; }
    if (layer.to > duration) { warnings.push(`${where}: runs past the end of the edit, so it is cut at frame ${duration}`); layer.to = duration; }
    const length = layer.to - layer.from;
    if (layer.type !== 'flash' && layer.in + layer.out > length) {
      const k = length / Math.max(1, layer.in + layer.out);
      layer.in = Math.floor(layer.in * k); layer.out = Math.floor(layer.out * k);
      warnings.push(`${where}: entrance and exit were longer than the layer, so they were shortened`);
    }
    needAnchor(where, layer.at);
    needAnchor(`${where}: follow`, layer.follow);
    if (layer.type === 'zoom') { needAnchor(where, layer.focus); zooms.push({ ...layer, i }); }
    if (layer.type === 'text' && layer.pointer && (typeof layer.at !== 'string' || !layer.offset)) warnings.push(`${where}: a pointer needs an anchor in 'at' and an 'offset' to point from`);
    if (layer.path) {
      layer.path.sort((a, b) => a.frame - b.frame);
      for (const [k, key] of layer.path.entries()) {
        const here = `${where}: path.${k}`;
        if (key.at != null ? key.x != null || key.y != null : key.x == null || key.y == null) errors.push(`${here}: give either x and y, or at`);
        needAnchor(here, key.at);
        if (k && key.frame === layer.path[k - 1].frame) errors.push(`${here}: two keys on frame ${key.frame}`);
      }
      if (layer.path[0].frame > layer.from || layer.path.at(-1).frame < layer.to - 1) warnings.push(`${where}: the path does not cover the whole layer, so it waits at its first or last point`);
      if (layer.at != null) warnings.push(`${where}: has both a path and 'at'; the path is used`);
    }
    if ((layer.type === 'image' && layer.place === 'screen' || ['sequence', 'sticker', 'graphic', 'model', 'particles'].includes(layer.type)) && layer.at == null && !layer.path) layer.at = { x: 0.5, y: 0.5 };
    if (layer.type === 'model') {
      const model = models[layer.asset];
      if (!model) { errors.push(`${where}: no 3D model called '${layer.asset}' has been uploaded for this footage (create_upload_link kind model)`); continue; }
      const names = model.animations || [];
      const known = (name, here) => {
        if (!names.includes(name)) errors.push(`${here}: '${layer.asset}' has no animation called '${name}' (${names.length ? `it has ${names.map(n => `'${n}'`).join(', ')}` : 'it has none'})`);
      };
      if (layer.animation) known(layer.animation, `${where}: animation`);
      layer.actions?.sort((a, b) => a.frame - b.frame);
      for (const [k, a] of (layer.actions || []).entries()) {
        known(a.animation, `${where}: actions.${k}`);
        if (a.frame < layer.from || a.frame >= layer.to) warnings.push(`${where}: actions.${k} at frame ${a.frame} is outside the layer (${layer.from}–${layer.to - 1})`);
      }
      if (!layer.animation && !layer.actions?.length && names.length) warnings.push(`${where}: no animation is chosen, so '${layer.asset}' holds still; it has ${names.map(n => `'${n}'`).join(', ')}`);
      if (layer.facing === 'path' && !layer.path) warnings.push(`${where}: facing path needs a path`);
    }
    if (layer.type === 'graphic') {
      // A saved graphic is copied in, so this version keeps rendering the same even if the library changes.
      if (layer.use && layer.elements) { errors.push(`${where}: give either use or elements, not both`); continue; }
      if (layer.use) {
        const def = graphics[layer.use];
        if (!def) { errors.push(`${where}: no saved graphic called '${layer.use}' (see list_graphics)`); continue; }
        Object.assign(layer, { viewBox: layer.viewBox ?? def.viewBox, loop: layer.loop ?? def.loop, elements: structuredClone(def.elements) });
      }
      if (!layer.elements) { errors.push(`${where}: needs elements, or use with a saved graphic's name`); continue; }
      errors.push(...graphicErrors(layer, where));
    }
    if (layer.type === 'particles') {
      if (layer.shape && layer.asset) { errors.push(`${where}: give either shape or asset, not both`); continue; }
      if (!layer.shape && !layer.asset) layer.shape = 'dot';
      if (layer.asset && !assets[layer.asset]) { errors.push(`${where}: no picture called '${layer.asset}' has been uploaded for this footage`); continue; }
      const alive = layer.burst + (layer.rate * layer.life) / FPS;
      if (alive > 600) errors.push(`${where}: up to ${Math.round(alive)} particles would be on screen at once; keep it under 600 (lower rate, life or burst)`);
      if (!layer.rate && !layer.burst) warnings.push(`${where}: rate and burst are both 0, so nothing is emitted`);
    }
    if (layer.type === 'text' && layer.count && !layer.text.includes('{n}') && !/^[\d.,\s-]+$/.test(layer.text)) warnings.push(`${where}: count is set but the text has no {n}, so the number replaces the whole text`);
    if (layer.type === 'sequence') {
      const sheet = assets[layer.asset];
      if (!sheet) { errors.push(`${where}: no sprite sheet called '${layer.asset}' has been uploaded for this footage`); continue; }
      const columns = layer.columns ?? layer.count, rows = Math.ceil(layer.count / columns);
      if (sheet.width % columns) warnings.push(layer.columns ? `${where}: '${layer.asset}' is ${sheet.width} px wide, which does not split evenly into ${columns} columns; check count and columns` : `${where}: '${layer.asset}' is ${sheet.width} px wide, which does not split evenly into ${layer.count} frames; check the count`);
      if (sheet.height % rows) warnings.push(`${where}: '${layer.asset}' is ${sheet.height} px tall, which does not split evenly into ${rows} rows; check count and columns`);
      if (layer.range && (layer.range.to < layer.range.from || layer.range.to >= layer.count)) errors.push(`${where}: range must run from..to within the sheet's ${layer.count} frames (0–${layer.count - 1})`);
    }
    if (layer.type === 'image') {
      const asset = assets[layer.asset];
      if (!asset) { errors.push(`${where}: no image called '${layer.asset}' has been uploaded for this footage`); continue; }
      const ratio = (asset.width / asset.height) / (footage.width / footage.height);
      if (layer.place === 'footage' && Math.abs(ratio - 1) > 0.03) warnings.push(`${where}: '${layer.asset}' is not the shape of the footage (${asset.width}×${asset.height} against ${footage.width}×${footage.height}), so it is cropped to cover it`);
    }
  }
  zooms.sort((a, b) => a.from - b.from);
  for (let k = 1; k < zooms.length; k++)
    if (zooms[k].from < zooms[k - 1].to) errors.push(`layers.${zooms[k].i} (zoom): overlaps the zoom in layers.${zooms[k - 1].i}; one zoom at a time`);
  for (const name of Object.keys(spec.anchors)) if (!used.has(name)) warnings.push(`anchors.${name}: defined but not used by any layer`);
  // Each cue gets its length worked out (to the end of the file unless cut), so the renderer and the
  // answer to ChatGPT agree on when every sound starts and stops.
  const cues = [];
  spec.sounds.sort((a, b) => a.at - b.at);
  for (const [i, cue] of spec.sounds.entries()) {
    const where = `sounds.${i} (${cue.sound})`, file = sounds[cue.sound];
    if (!file) { errors.push(`${where}: no sound called '${cue.sound}' has been uploaded for this footage (create_upload_link kind sound, or add_sound)`); continue; }
    if (cue.at >= duration) { errors.push(`${where}: starts at frame ${cue.at}, but the edit is only ${duration} frames long`); continue; }
    if (cue.from >= file.seconds) { errors.push(`${where}: from ${cue.from} s is past the end of the sound (${file.seconds} s)`); continue; }
    const natural = Math.max(1, Math.floor(((file.seconds + tailSeconds(cue) - cue.from) / cue.speed) * FPS));
    if (cue.volumeKeys) {
      cue.volumeKeys.sort((a, b) => a.frame - b.frame);
      if (cue.volumeKeys.some((k, n) => n && k.frame === cue.volumeKeys[n - 1].frame)) { errors.push(`${where}: volumeKeys has two keys on one frame`); continue; }
    }
    if (cue.loop && cue.length == null) { errors.push(`${where}: a looping sound needs a length in frames`); continue; }
    let length = cue.length ?? natural;
    if (!cue.loop && length > natural) { warnings.push(`${where}: the sound ends after ${natural} frames, before its length of ${length}`); length = natural; }
    if (cue.at + length > duration) { warnings.push(`${where}: runs past the end of the edit, so it is cut at frame ${duration}`); length = duration - cue.at; }
    cue.length = length;
    cue.fadeIn = Math.min(cue.fadeIn, length); cue.fadeOut = Math.min(cue.fadeOut, length - cue.fadeIn);
    cues.push({ sound: cue.sound, output: [cue.at, cue.at + length], seconds: [Math.round((cue.at / FPS) * 100) / 100, Math.round(((cue.at + length) / FPS) * 100) / 100], ...(cue.loop ? { loop: true } : {}) });
  }
  if (spec.sourceKeys) {
    spec.sourceKeys.sort((a, b) => a.frame - b.frame);
    if (spec.sourceKeys.some((k, n) => n && k.frame === spec.sourceKeys[n - 1].frame)) errors.push('sourceKeys: two keys on one frame');
  }
  if (spec.audio === 'mute' && (spec.sourceVolume !== 1 || spec.sourceKeys || spec.sounds.some(c => c.duck != null))) warnings.push('sourceVolume, sourceKeys and duck have no effect while audio is mute');

  const needsDepth = spec.layers.some(l => ['blur', 'fog', 'parallax'].includes(l.type) || l.depth != null || l.path?.some(k => k.depth != null));
  if (spec.depth) {
    if (spec.depth.video && !footage.depth) errors.push('depth.video: this clip has no per-frame depth yet; compute it from create_download_link and upload it with create_upload_link kind depth');
    for (const [i, st] of (spec.depth.stills || []).entries()) {
      if (st.to <= st.from) errors.push(`depth.stills.${i}: 'to' must be after 'from'`);
      const a = assets[st.asset];
      if (!a) errors.push(`depth.stills.${i}: no picture called '${st.asset}' has been uploaded for this footage`);
      else if (Math.abs((a.width / a.height) / (footage.width / footage.height) - 1) > 0.03) warnings.push(`depth.stills.${i}: '${st.asset}' is not the shape of the footage, so it will not line up`);
    }
    if (!spec.depth.video && !spec.depth.stills?.length) errors.push('depth: give video: true or at least one still');
  } else if (needsDepth) errors.push('Some layers use depth (depth values, blur, fog or parallax), but the edit has no depth source; add "depth": {"video": true} or depth stills');
  if (errors.length) throw fail(errors.join('; '));

  const [width, height] = FORMATS[spec.format];
  return {
    spec,
    plan: { width, height, fps: FPS, durationInFrames: duration, segments },
    timeline: segments.map(s => s.hold
      ? { output: [s.from, s.to], hold: s.source }
      : { output: [s.from, s.to], source: [s.source, s.sourceTo], ...(s.speed !== 1 ? { speed: s.speed } : {}) }),
    cues,
    warnings,
  };
}

// The source frame on screen at an output frame, for labelling previews.
export function sourceFrameAt(segments, frame) {
  const s = segments.find(x => frame >= x.from && frame < x.to) || segments.at(-1);
  if (!s) return 0;
  if (s.hold) return s.source;
  return Math.min(s.sourceTo - 1, s.source + Math.floor((frame - s.from) * s.speed));
}

// Frames worth looking at when no particular ones are asked for: the first and last frame and one inside
// each layer once it is fully on, kept apart so no two show nearly the same moment, then filled out to
// `count` with the frames furthest from any already chosen.
export function previewFrames(plan, layers, count = 8) {
  const d = plan.durationInFrames, gap = Math.max(1, Math.floor(d / (count * 2)));
  const marks = [0, d - 1, ...layers.map(l => Math.min(d - 1, Math.max(l.from, Math.min(l.to - 1, l.from + l.in + Math.floor((l.to - l.from - l.in - l.out) / 2)))))];
  const kept = [];
  for (const m of [...new Set(marks)].sort((a, b) => a - b)) if (!kept.some(k => Math.abs(k - m) < gap)) kept.push(m);
  let frames = kept.length > count ? Array.from({ length: count }, (_, i) => kept[Math.round((i * (kept.length - 1)) / (count - 1))]) : kept;
  const distance = f => Math.min(...frames.map(k => Math.abs(k - f)));
  while (frames.length < Math.min(count, d)) {
    let best = -1;
    for (let f = 0; f < d; f++) if (best < 0 || distance(f) > distance(best)) best = f;
    if (distance(best) === 0) break;
    frames = [...frames, best];
  }
  return [...new Set(frames)].sort((a, b) => a - b);
}

export const GUIDE = `# Animating over footage

You direct; the server renders. Work in this order:

1. list_footage: pick a clip whose status is ready. Frame numbers are at 30 fps (frame 90 = 3.00 s).
2. sample_footage: a contact sheet of the clip, each picture labelled with its SOURCE frame and time.
   Narrow in with from/to to find the exact frame something happens (a fork lifting food, a pour, a turn).
3. get_frame with grid (and a region to zoom in): read positions as 0–1 of the footage for anchors.
   An anchor that follows something moving needs keyframes every 3–10 frames while it moves.
4. save_edit: a JSON edit (below). It answers with the output↔source timeline and any warnings.
5. preview_edit: stills of chosen OUTPUT frames, rendered for real. Check alignment and timing, fix, save again.
6. render_edit with quality draft (half size) to check motion, then final. get_render reports progress and shows frames.
Nothing is published from here: the finished MP4 is on the dashboard for the owner to download and post.

## Two clocks
- SOURCE frames: frames of the uploaded clip, as printed on contact sheets. Used by timeline entries and anchors.
- OUTPUT frames: frames of the finished video, after cuts, freezes and speed changes. Used by every layer.
  save_edit returns the mapping, e.g. output [0,88] = source [30,118], output [88,148] = hold on 118.

## Coordinates
- In save_edit and get_edit, anchors are a list of {name,keys}. Each key has {frame,x,y}; x and y are
  in 0–1 of the FOOTAGE picture (0,0 top left). Layers with at: "anchorName" stick to it.
- at: {x,y} on a layer means 0–1 of the FINISHED frame and stays put on screen.
- Zoom focus {x,y} is in footage coordinates, like anchors.

## Example: real → drawn → real, with a callout
{
  "format": "vertical",
  "timeline": [ {"from": 30, "to": 118}, {"hold": 118, "frames": 60}, {"from": 118, "to": 240} ],
  "anchors": [ {"name": "fork", "keys": [ {"frame": 96, "x": 0.52, "y": 0.64}, {"frame": 110, "x": 0.54, "y": 0.52}, {"frame": 118, "x": 0.55, "y": 0.45} ]} ],
  "layers": [
    {"type": "zoom", "from": 60, "to": 150, "scale": 1.35, "focus": "fork", "in": 20, "out": 16},
    {"type": "illustrate", "from": 84, "to": 156, "style": "cel", "transition": "iris", "at": "fork", "in": 10, "out": 10},
    {"type": "sticker", "from": 90, "to": 150, "shape": "steam", "at": "fork", "offset": {"x": 0, "y": -0.08}, "color": "paper"},
    {"type": "text", "from": 94, "to": 148, "text": "Hand-rolled\\ntagliatelle", "style": "callout", "at": "fork", "offset": {"x": -0.22, "y": -0.2}, "pointer": true},
    {"type": "flash", "from": 84, "to": 90},
    {"type": "text", "from": 0, "to": 60, "text": "Best pasta in Rīga?", "style": "title", "enter": "rise"}
  ]
}
Here the clip plays from source 30, freezes on 118 (the forkful) for two seconds while it turns into a cel drawing with
steam and a callout, then carries on. Layer times are OUTPUT frames: the freeze covers output 88–148.

## Moving pictures and frame-by-frame animation
- Upload a sprite sheet (all frames side by side in one row, equal widths, transparent background) with
  create_upload_link, then {"type":"sequence","asset":"bird-flap","count":8,"fps":12,...} plays it as a loop.
  Make every frame on the same canvas with the subject in the same place, or it jitters.
- path moves an image, sequence or sticker through the FINISHED frame, even during a freeze:
  "path": [{"frame":90,"x":0.1,"y":0.3},{"frame":110,"x":0.6,"y":0.2},{"frame":130,"at":"rim"}]
  The last key lands exactly on the "rim" anchor. "facing":"path" turns it to face the way it flies (draw it facing right).
- A bird that lands: a flapping sequence along a path ending on the rim, then an image of it perched at "rim"
  starting on the landing frame (sequence exit "none", out 0; perched image enter "none" or "pop").

## Sprites, particles and light effects
- A sprite sheet can be one row or a grid: "columns" says how many frames per row. build_sprite makes a grid
  sheet from single frames you uploaded (one picture per frame), so you can draw or render frames one by one.
- "range" plays only some frames of a sheet ({"from":4,"to":11}); "playback" is loop, once or pingpong.
  "rotate" and "spin" (degrees per second) turn it; "tint" recolours it; "glow" adds a soft light around it.
- "blend": "screen" or "add" makes a sprite act as light (glints, flares, light wipes, dust in a beam) so its
  dark background disappears; "multiply" for shadows and ink. Images and text take blend too.
- A particles layer emits many copies of a built-in shape (dot, soft, spark, star, ring, streak, heart,
  confetti, square) or of an uploaded picture/sprite, from "at" (or a moving path), over an "area":
  {"type":"particles","from":150,"to":210,"at":"rim","shape":"soft","rate":25,"life":60,"speed":0.04,
   "direction":-90,"spread":50,"size":0.01,"grow":1.6,"colors":["paper","gold"],"blend":"screen","glow":6}
  An impact: "burst": 60, "rate": 0, "drag": 3, "speed": 0.6, "spread": 360, shape "spark". Confetti: shape confetti,
  "gravity": 0.4, many colours. Rising embers: "gravity": -0.1, colours gold and coral, blend add.
  Keep on-screen particles under 600 (burst + rate × life / 30).

## Text animation
- "font": serif (brand), script, sans (heavy Inter), display (tall Bebas Neue capitals, for cinema titles), mono.
- "reveal" animates text in piece by piece: {"by":"letter"|"word"|"line","style":"rise"|"drop"|"pop"|"blur"|"fade"|
  "slide"|"flip"|"scramble"|"typewriter","stagger":2,"duration":10}. "hide" does the same on the way out.
  A cinema title: {"font":"display","tracking":0.25,"size":150,"reveal":{"by":"letter","style":"blur","stagger":2,"duration":14}}.
- "loop" keeps it moving: wave, bounce, pulse, shake (impact), flicker (neon), glow (with "glow" colour).
- "highlight": {"words":["best"],"color":"lime","style":"marker"|"underline"|"box","delay":10} sweeps a marker under words.
- "count": {"from":0,"to":1200,"frames":40} counts up, with {n} in the text where the number goes ("{n} cups a day").
- "stroke" {"color","width"} outlines letters, "glow" lights them, "gradient" [top, bottom] colours them,
  "rotate" tilts the block, "path" moves it like any other layer.

## Graphics: draw and animate your own shapes
A graphic is shapes in its own coordinates (viewBox, default 100×100) with keyframed properties. Keys count
frames from the layer's start; with "loop": N they repeat every N frames. Rotation and scale turn around "origin".
A bird with flapping wings (looping every 8 frames), flown along a path:
{"type":"graphic","from":90,"to":150,"size":260,"facing":"path","loop":8,
 "path":[{"frame":90,"x":0.1,"y":0.2},{"frame":149,"at":"rim"}],
 "elements":[
  {"shape":"path","d":"M50,52 Q30,20 8,30 Q30,45 50,56Z","fill":"#2f6fdb","origin":{"x":50,"y":54},
   "keys":{"rotate":[{"frame":0,"value":-25},{"frame":4,"value":30},{"frame":8,"value":-25}]}},
  {"shape":"ellipse","cx":55,"cy":58,"rx":22,"ry":11,"fill":"#3d86f5","stroke":"ink","strokeWidth":2},
  {"shape":"circle","cx":76,"cy":50,"r":8,"fill":"#3d86f5","stroke":"ink","strokeWidth":2},
  {"shape":"path","d":"M83,48 L92,51 L83,54Z","fill":"gold"}]}
Confetti: one small rect with "repeat":{"count":30,"delay":2,"dx":9,"rotate":40} and keys on y and rotate.
save_graphic stores a graphic by name so later edits use {"type":"graphic","use":"bird"}; list_graphics shows them.

## 3D models: a cat that walks round the cup and sits down
A model layer draws a real 3D model (.glb) in the shot, playing its own animations (walk, run, idle, sit…).
- Get a model: an animated, low-poly GLB with everything embedded and no Draco compression. Free sources:
  Poly Pizza (CC0 animated animals and characters by Quaternius), Sketchfab (download as glTF binary), Mixamo
  (characters with walk cycles, converted to GLB). Or build one in your sandbox (trimesh or pygltflib; for
  animation, export node rotation keyframes, e.g. legs swinging).
- Upload it: create_upload_link with kind "model" and a name, then curl -T cat.glb "<url>". If your sandbox has
  no network, use add_model with the file instead (or ask the owner to add it on the dashboard). The answer (and
  list_footage under models) lists its animations by name and length; use those names exactly.
- Place it like any layer: "at" (its feet stand there with the default pin "feet"), or a path. "size" is its
  height as a fraction of the frame height. "turn" 0 faces the camera, 90 faces right; "facing":"path" turns
  it to walk the way it moves, turning round through facing you. "tilt" is how far we look down on it: match
  the footage (a phone above a table is about 25). "light" says where the key light comes from: match the shot.
  It casts a soft shadow under itself ("shadow" 0 for none).
- Animations: "animation" plays from the layer's start; "actions" switch at OUTPUT frames, cross-fading.
{"type":"model","asset":"cat","from":90,"to":210,"animation":"Walk","facing":"path","size":0.14,"tilt":25,"light":"right",
 "path":[{"frame":90,"x":0.15,"y":0.62},{"frame":130,"x":0.5,"y":0.66},{"frame":160,"at":"rim"}],
 "actions":[{"frame":160,"animation":"Sit","loop":false},{"frame":180,"animation":"Idle"}],"depth":0.72}
  It walks across the table, turns towards the cup, reaches the rim anchor at 160, sits and idles. With depth
  it passes behind anything nearer than 0.72.
- "look":"toon" gives flat cartoon shading and an ink outline (add "boil":true), to match illustrated moments.
- keys turn, tilt, spin, roll and scale animate the model itself, e.g. a product turntable: "keys":{"spin":[{"frame":0,"value":0},{"frame":90,"value":360}]}.
- Make it sit in the shot, or it looks pasted on:
  - Handheld footage drifts: add an anchor on a spot of the table that stays put (keyframed through the clip)
    and give the model "follow": "table". Its at and path then move with the table instead of the screen.
  - Light: look where the light comes from in the footage (a window behind the cup is "back") and match it.
  - During an illustrate layer, use a second model layer with "look":"toon" for that stretch, so it is drawn too.
  - A plain model without colours of its own renders grey; give it "color", or better, use a textured model.
  - With depth (make_depth), use "depth":"auto": it takes the depth of the ground under its feet each frame,
    so the table never cuts off its legs, yet it goes behind anything nearer (the cup). A fixed number only
    suits something that does not move towards or away from the camera.
  - Walking: "stride" ties the steps to the distance moved ("stride":1 for a walk, 2–3 for a run), so the feet
    do not slide and stepping stops when it stops. Switch to an idle or sit animation where the path ends.
  - Check which way it faces: preview with turn 0 and facing as-made. If it is not facing you, set "front"
    ("away", "right" or "left") to the way it faces as made; otherwise facing path walks it backwards or sideways.
- Preview a couple of frames first: size, tilt and light are what make it sit in the shot.

## Depth: things passing behind things, depth of field, fog, 2.5D moves
Depth is a greyscale picture of how far each pixel is (near = white). Sources:
- Easiest: make_depth. The server runs a depth model over every frame in the background (a few minutes;
  list_footage shows depthJob progress, then depth). Then "depth": {"video": true}.
- Per-frame, computed by you instead: create_download_link, then in your sandbox run a monocular depth model
  (e.g. Depth Anything V2) on every frame, normalise the whole clip with one min/max (per-frame
  normalising flickers), encode a greyscale MP4 with exactly the clip's frame count, and upload it with
  create_upload_link kind "depth". Then "depth": {"video": true}. It follows cuts and freezes like the footage.
- A still, for a freeze: depth of that one frame uploaded as a picture, then
  "depth": {"stills": [{"from": 88, "to": 148, "asset": "cup-depth"}]}.
Use get_depth to read values at points (the rim might be 0.72, the window 0.15).
- "depth": 0.6 on an image, sequence, graphic, model, sticker or text hides it wherever the scene is nearer
  than 0.6: a bird at 0.5 flies behind a cup at 0.7 and in front of a window at 0.2. Path keys can carry
  their own depth, so it can come from behind and land in front ({"frame":130,"at":"rim","depth":0.75}).
- {"type":"blur","focus":0.7,"range":0.12,"amount":14}: depth of field, sharp around the focus.
- {"type":"fog","strength":0.6,"start":0.5}: haze that thickens with distance.
- {"type":"parallax","move":"pan","amount":0.04}: a 2.5D camera move; best on a freeze.

## Sound effects and music
Upload sounds for the clip (create_upload_link kind "sound", add_sound with a file or a public link to the
audio file, or the owner adds them on the dashboard under Sounds): MP3, WAV, OGG, FLAC or M4A, up to 3 minutes.
list_footage shows each with its length. Place them in "sounds", on OUTPUT frames:
"sounds": [
  {"sound":"paw-steps","at":0,"length":140,"loop":true,"volume":0.35,"fadeIn":6,"fadeOut":10},
  {"sound":"whoosh","at":138,"volume":0.8,"pan":0.3},
  {"sound":"poof","at":163,"volume":1.2,"duck":0.3,"reverb":0.3},
  {"sound":"steam","at":166,"volume":0.5,"fadeOut":20,"lowpass":2500}
]
- Timing: "at" is the frame the sound starts; "from" skips into the file (seconds); "length" cuts it (frames);
  "loop" repeats it for its length (footsteps under a walk). save_edit answers with each sound's frames and seconds.
- Level: "volume" 0–2 (1 as recorded, above 1 louder); "fadeIn"/"fadeOut" in frames; "volumeKeys" for changes
  over time ([{"frame":0,"value":0.2},{"frame":30,"value":1}], frames from the sound's start).
- The clip's own sound: "sourceVolume" (0.4 keeps café ambience low), "sourceKeys" to change it over OUTPUT
  frames (fade it out at the end), and "duck" on a sound to dip the clip's sound while that sound plays.
  "audio":"mute" silences the clip but still plays the sounds.
- Effects (made on the server before rendering): "pan" -1 left … 1 right (follow something across the screen),
  "pitch" in semitones (a smaller cat: +4), "speed" (changes pitch too), "reverse", "lowpass"/"highpass" in Hz
  (muffled / tinny), "bass"/"treble" in dB, "echo" {"delay":ms,"decay"}, "reverb" 0–1, "normalize" for quiet files.
  Echo and reverb ring on after the sound ends; the length allows for it.
- You cannot hear the render, but get_render on a video gives its loudness every quarter second: check each sound
  starts where you placed it (a jump from about -60 dB) and nothing is far louder than the rest.
- Credit CC-BY sounds in the post caption; CC0 needs no credit.

## Tips
- Layers are drawn in list order, later on top. Illustrate layers are the exception: they redraw the footage itself,
  so they always sit right over it, under all text, stickers and pictures.
- Keep text inside x 0.08–0.92 and, on vertical video, y 0.12–0.80: Instagram covers the edges and the bottom.
- An illustrated moment reads best on a hold, or on a slow part of the clip.
- An image with place "footage" should be drawn over a frame of this clip at the same size (use get_frame without a grid,
  have it illustrated, and upload it on the dashboard as an asset); it then lines up with the footage exactly.
- Use preview_edit on the frames either side of every transition before rendering the video.

Layer timing and fit
- from/to are OUTPUT frames; to is exclusive. in/out are the entrance and exit lengths in frames.
- stride: if the feet slide backwards raise it, if they slide forwards lower it.
- follow: positions are as they are when the anchor sits at its first keyframe; path keys that name
  an anchor already move with it, so they need no follow of their own.
- node (model layers): draws one named part of a model and its children, e.g. the fox out of a whole
  workshop. Names come from list_footage under models[].nodes. The rest of the model still animates,
  it is simply not drawn, and size/pin measure the part you chose rather than the whole scene.
  Every model layer renders in its own canvas, so two layers never occlude each other or share light:
  use node to split one model across layers only when they do not need to overlap.

## A flat 2D world that something pops out of (the storybook shot)
Three layers stacked in order: a book, the drawn scene printed on its page, and the 3D character that
breaks out of it. What makes or breaks this one is arithmetic, not taste.
- Size the book from its bounds, not by eye. size is the model's HEIGHT as a fraction of the frame
  height, and a book's height is its thickness, so the number is small and guessing it is hopeless:
  size = wantedWidthPx * bounds.height / (bounds.width * frameHeightPx). A 1023px-wide book whose
  bounds are 2.104 x 0.132 needs size 0.0334 on a 1920-tall frame.
- Then work out where its page actually is on screen, because that is where the drawn scene has to sit.
  With pin "feet" the model's BOTTOM is on \`at\`, and tilt swings the page up and back from there. In
  pixels, with fit = size * frameHeight / bounds.height:
    top of page    = at.y * frameHeight - (bounds.height * cos(tilt) + pageDepth/2 * sin(tilt)) * fit
    bottom of page = at.y * frameHeight + (pageDepth/2 * sin(tilt) - bounds.height * cos(tilt)) * fit
  The page is only pageDepth * sin(tilt) tall on screen: at tilt 42 a book loses a third of its depth,
  which is why a scene that looks like it fits in plan view hangs off the bottom of the page.
- A model's bounds are its REST pose. A scene that paints a title as it plays ends up bigger than its
  bounds say, so size it against what it draws (preview a late frame and read the ink off it), not
  against what list_footage reports. Aim for the drawn scene covering about three quarters of the page.
- Keep the drawn scene and the book at the SAME \`at\` arithmetic but different tilts: the book lies at
  the table's angle (match the tiles, around 40), the drawn scene stands up at 70-80, which is what
  makes it read as a flat world seen inside the book rather than a sticker on it. Give it look "toon"
  and boil true, and shadow 0 - it is printed, so it casts nothing.
- The break-out, all on one frame: tilt and scale keys on the drawn scene (78 to 36, 1 to 1.55 over
  about 13 frames), a flash, a burst sticker, and the paper-scraps graphic. Crossfade the two models
  (exit "fade" with out 7 on the drawn one, enter "fade" with in 7 on the 3D one) or the title the
  character just painted blinks out of existence for a beat.
- Fade the book out over the next second, and let the 3D character stand on the table without it.

## Following a moving shot, and when not to
follow pins a layer to an anchor on the table so it does not slide across a handheld shot. Check the
shot can afford it first: work out how far your anchor travels between the first and last frame you use
it. If the table crosses more than about a third of the frame, a layer pinned to it leaves the shot.
- A whip pan (this clip moves 1.3 frame widths in four seconds) cannot be followed at all: place those
  layers at a fixed \`at\` and let the footage move behind them.
- On a freeze nothing moves, so anything placed during a hold is planted for free.
- Where you do follow, choose a stretch that ENDS near where it started, or the subject drifts out of
  frame by the last second. Pick the cut from the anchor's own numbers: if it runs 0.30 -> 0.15 -> 0.31,
  cutting at the frame it returns to 0.31 costs nothing and keeps the title centred.
- The shift is measured from the anchor's FIRST keyframe, so layers are unshifted before it: keyframe
  the anchor from the frame the move starts and everything earlier stays put on its own.

## Saved graphics you can reuse
list_graphics shows them; use them with {"type":"graphic","use":"<name>","from":…,"to":…,"at":…}.
- "gulls": three birds flapping on a 12-frame loop. Fly them along a path over a BRIGHT part of the
  shot - they are ink silhouettes and vanish against brick or a dark jumper. size 400 makes each bird
  about 100px on a 1080 frame; each bird needs more room than it is wide, which is why the viewBox is
  far wider than one bird.
- "paper-scraps": sixteen torn page fragments bursting out and tumbling, for the frame something breaks
  through a page. Plays once over about 55 frames; size 700-800.
Making your own particles: \`repeat\` cannot fan copies out in different directions. It rotates each copy
on its own pivot but leaves its keyed travel alone, so every copy flies the same way. For a burst, give
each fragment its own element with its own keys; for a flock or a queue, repeat with dx/dy and delay is
exactly right.
`;
