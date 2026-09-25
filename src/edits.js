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
  .describe('An anchor name (sticks to that thing in the footage, following its movement and any zoom) or {x,y} in 0–1 of the finished frame (fixed on screen)');
const Offset = () => z.object({ x: z.number().min(-1).max(1), y: z.number().min(-1).max(1) }).strict()
  .describe('Shift from `at`, in fractions of the finished frame (x: -0.2 is a fifth of the width to the left)');
// A flight path in OUTPUT frames, so things can move even during a freeze. Positions between keys are
// smoothed into curves. A key can name an anchor instead of x/y, to land exactly on something in the shot.
const Path = () => z.array(z.object({
  frame: Frame().describe('OUTPUT frame'),
  x: Unit().optional(), y: Unit().optional(),
  at: z.string().regex(ANCHOR).optional().describe('Instead of x/y: an anchor name, to arrive exactly on it'),
  depth: Unit().optional().describe('Depth at this key (0 far – 1 near), eased between keys; overrides the layer depth'),
}).strict()).min(2).max(600).optional()
  .describe('Moves the layer along keyframes {frame,x,y} in 0–1 of the finished frame (or {frame,at:"anchor"}), smoothed into curves; used instead of `at`');
const Facing = () => z.enum(['as-drawn', 'flip', 'path']).default('as-drawn')
  .describe('path: turns to face the way it moves along `path` and leans into turns (draw it facing right); flip: mirrored');
const Depth = () => Unit().optional().describe('How near it is, 0 far – 1 near (get_depth): it is hidden wherever the scene is nearer, so it can pass behind things. Needs depth on the edit');
const Span = () => ({
  from: Frame().describe('First OUTPUT frame the layer is on'),
  to: Frame().describe('OUTPUT frame the layer is gone by (exclusive)'),
  in: z.number().int().min(0).max(90).default(8).describe('Frames the entrance takes'),
  out: z.number().int().min(0).max(90).default(8).describe('Frames the exit takes'),
});

const Text = z.object({
  type: z.literal('text'), ...Span(),
  text: z.string().trim().min(1).max(140).refine(t => t.split('\n').length <= 3, 'Up to three lines').describe('Up to three lines; use \\n to break'),
  style: z.enum(['title', 'callout', 'caption', 'label', 'script', 'band']).default('caption')
    .describe('title: big serif headline; callout: paper card, pairs with pointer; caption: bold subtitle; label: small tag; script: handwritten accent; band: full-width bar'),
  at: Place().optional().describe('Where the text sits. Defaults: title near the top, caption and band near the bottom, others at the centre'),
  offset: Offset().optional(), depth: Depth(),
  pointer: z.boolean().default(false).describe('Draw a line from the text back to `at`; use with an anchor and an offset for a callout'),
  size: z.number().int().min(20).max(220).optional().describe('Type size in pixels on a 1080-wide frame'),
  color: Color().optional(), background: z.union([Color(), z.literal('none')]).optional(),
  align: z.enum(['left', 'center', 'right']).default('center'),
  enter: z.enum(['pop', 'fade', 'rise', 'type', 'slide', 'none']).default('pop'),
  exit: z.enum(['fade', 'pop', 'sink', 'none']).default('fade'),
}).strict();

const Sticker = z.object({
  type: z.literal('sticker'), ...Span(),
  shape: z.enum(['sparkles', 'steam', 'hearts', 'stars', 'circle', 'arrow', 'burst', 'pulse', 'underline', 'squiggle'])
    .describe('Animated drawing. steam rises and sparkles twinkle for as long as they are on; circle, arrow, underline and squiggle draw themselves on; burst and pulse radiate'),
  at: Place().optional(), offset: Offset().optional(), path: Path(), depth: Depth(),
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
  at: Place().optional(), offset: Offset().optional(), path: Path(), facing: Facing(), depth: Depth(),
  size: z.number().min(0.05).max(2).default(0.4).describe('Width as a fraction of the finished frame (screen placement)'),
  opacity: Unit().default(1),
  enter: z.enum(['pop', 'fade', 'wipe', 'none']).default('fade'),
  exit: z.enum(['pop', 'fade', 'none']).default('fade'),
  motion: z.enum(['none', 'float', 'boil', 'sway', 'pulse', 'spin']).default('none'),
}).strict();

// Frame-by-frame animation from a sprite sheet: every frame side by side in one row, equal widths,
// on a transparent background. A flapping bird, a hand-drawn flicker, a turntable of a 3D object.
const Sequence = z.object({
  type: z.literal('sequence'), ...Span(),
  asset: z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/).describe('Name of an uploaded sprite sheet: all frames side by side in one row, equal widths'),
  count: z.number().int().min(2).max(64).describe('How many frames the sheet holds'),
  fps: z.number().int().min(1).max(30).default(12).describe('How fast the frames play; 8–12 feels hand-drawn, 24–30 smooth'),
  loop: z.boolean().default(true).describe('Repeat the frames, or stop on the last one'),
  at: Place().optional(), offset: Offset().optional(), path: Path(), facing: Facing(), depth: Depth(),
  size: z.number().min(0.03).max(2).default(0.2).describe('Width of one frame as a fraction of the finished frame'),
  opacity: Unit().default(1),
  enter: z.enum(['pop', 'fade', 'none']).default('fade'),
  exit: z.enum(['pop', 'fade', 'none']).default('fade'),
  motion: z.enum(['none', 'bob', 'sway']).default('none').describe('bob: gentle up and down, like hovering'),
}).strict();

// Graphics: shapes ChatGPT draws and animates itself, as data. Each element is a path, circle, ellipse,
// rectangle, line or line of text in the graphic's own coordinates (its viewBox), and any of its
// position, rotation, scale, opacity and stroke draw-on can be keyframed. Saved graphics are reused by name.
const PATH_D = /^[MmLlHhVvCcSsQqTtAaZz0-9eE.,\s+-]+$/;
const Num = () => z.number().min(-100000).max(100000);
const Track = () => z.array(z.object({ frame: z.number().int().min(0).max(100000).describe('Frames from the start of the layer (or of the loop)'), value: Num() }).strict()).min(1).max(200);
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
  at: Place().optional(), offset: Offset().optional(), path: Path(), facing: Facing(), depth: Depth(),
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
  animation: AnimationName().optional().describe('Which of the model\'s animations plays from the layer\'s start (names from list_footage); leave out to hold its rest pose'),
  speed: z.number().min(0.1).max(4).default(1).describe('Animation speed; 1 is as made'),
  loop: z.boolean().default(true).describe('Repeat the animation, or stop on its last pose'),
  actions: z.array(z.object({
    frame: Frame().describe('OUTPUT frame this animation takes over'),
    animation: AnimationName(),
    speed: z.number().min(0.1).max(4).optional(), loop: z.boolean().optional().describe('Default true; false plays once and holds the last pose (sitting down, landing)'),
  }).strict()).max(20).optional().describe('Switch animations during the layer, e.g. walk then sit: [{"frame":130,"animation":"Sit","loop":false}]'),
  blend: z.number().int().min(0).max(30).default(8).describe('Frames to cross-fade between animations'),
  at: Place().optional().describe('Where it stands (with pin feet, its feet are here)'), offset: Offset().optional(), path: Path(), depth: Depth(),
  facing: z.enum(['as-made', 'path']).default('as-made').describe('path: turns to walk or fly the way it moves along `path`, turning round through facing the camera'),
  angle: z.number().min(0).max(90).default(65).describe('With facing path: 90 is a side view, less turns it towards the camera'),
  pin: z.enum(['feet', 'center']).default('feet').describe('Which point of the model sits on `at`: its feet (standing on something) or its middle (flying)'),
  size: z.number().min(0.02).max(1.5).default(0.2).describe('Height of the model as a fraction of the finished frame\'s height'),
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

export const Layer = z.discriminatedUnion('type', [Text, Sticker, Illustrate, Image, Sequence, Graphic, Model, Blur, Fog, Parallax, Zoom, Shake, Flash]);

const Play = z.object({
  from: Frame().describe('First SOURCE frame'), to: Frame().describe('SOURCE frame to stop before'),
  speed: z.number().min(0.25).max(4).default(1).describe('0.5 is half-speed slow motion; sound is muted when not 1'),
}).strict();
const Hold = z.object({
  hold: Frame().describe('SOURCE frame to freeze on'),
  frames: z.number().int().min(1).max(30 * FPS).describe('How many OUTPUT frames the freeze lasts (silent)'),
}).strict();

const AnchorKeys = () => z.array(z.object({ frame: Frame().describe('SOURCE frame'), x: Unit(), y: Unit() }).strict()).min(1).max(900);

export const EditSpec = z.object({
  format: z.enum(Object.keys(FORMATS)).default('vertical').describe('vertical 1080×1920 (Reels, Stories), portrait 1080×1350, square 1080×1080, landscape 1920×1080'),
  fit: z.enum(['cover', 'contain']).default('cover').describe('cover fills the frame and crops; contain shows the whole clip on the background'),
  background: Color().default('ink'),
  audio: z.enum(['source', 'mute']).default('source'),
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
// names to {animations: [names]}. Returns the
// normalised spec (defaults filled in, so a stored version renders the same later), the plan the
// renderer follows and the output↔source mapping to show back.
export function planEdit(input, footage, assets = {}, graphics = {}, models = {}) {
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
    if ((layer.type === 'image' && layer.place === 'screen' || ['sequence', 'sticker', 'graphic', 'model'].includes(layer.type)) && layer.at == null && !layer.path) layer.at = { x: 0.5, y: 0.5 };
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
    if (layer.type === 'sequence') {
      const sheet = assets[layer.asset];
      if (!sheet) { errors.push(`${where}: no sprite sheet called '${layer.asset}' has been uploaded for this footage`); continue; }
      if (sheet.width % layer.count) warnings.push(`${where}: '${layer.asset}' is ${sheet.width} px wide, which does not split evenly into ${layer.count} frames; check the count`);
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
- Preview a couple of frames first: size, tilt and light are what make it sit in the shot.

## Depth: things passing behind things, depth of field, fog, 2.5D moves
Depth is a greyscale picture of how far each pixel is (near = white). Two sources:
- Per-frame, for the whole clip: create_download_link, then in your sandbox run a monocular depth model
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

## Tips
- Layers are drawn in list order, later on top. Illustrate layers are the exception: they redraw the footage itself,
  so they always sit right over it, under all text, stickers and pictures.
- Keep text inside x 0.08–0.92 and, on vertical video, y 0.12–0.80: Instagram covers the edges and the bottom.
- An illustrated moment reads best on a hold, or on a slow part of the clip.
- An image with place "footage" should be drawn over a frame of this clip at the same size (use get_frame without a grid,
  have it illustrated, and upload it on the dashboard as an asset); it then lines up with the footage exactly.
- Use preview_edit on the frames either side of every transition before rendering the video.`;
