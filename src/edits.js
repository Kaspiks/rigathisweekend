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
}).strict()).min(2).max(600).optional()
  .describe('Moves the layer along keyframes {frame,x,y} in 0–1 of the finished frame (or {frame,at:"anchor"}), smoothed into curves; used instead of `at`');
const Facing = () => z.enum(['as-drawn', 'flip', 'path']).default('as-drawn')
  .describe('path: turns to face the way it moves along `path` and leans into turns (draw it facing right); flip: mirrored');
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
  offset: Offset().optional(),
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
  at: Place().optional(), offset: Offset().optional(), path: Path(),
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
  at: Place().optional(), offset: Offset().optional(), path: Path(), facing: Facing(),
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
  at: Place().optional(), offset: Offset().optional(), path: Path(), facing: Facing(),
  size: z.number().min(0.03).max(2).default(0.2).describe('Width of one frame as a fraction of the finished frame'),
  opacity: Unit().default(1),
  enter: z.enum(['pop', 'fade', 'none']).default('fade'),
  exit: z.enum(['pop', 'fade', 'none']).default('fade'),
  motion: z.enum(['none', 'bob', 'sway']).default('none').describe('bob: gentle up and down, like hovering'),
}).strict();

const Zoom = z.object({
  type: z.literal('zoom'), ...Span(),
  scale: z.number().min(1).max(4).describe('1.5 fills the frame with the middle two thirds'),
  focus: Place().describe('Anchor name, or {x,y} in 0–1 of the FOOTAGE (not the screen): the point to move towards'),
}).strict();

const Shake = z.object({ type: z.literal('shake'), ...Span(), strength: Unit().default(0.4) }).strict();
const Flash = z.object({ type: z.literal('flash'), ...Span(), color: Color().default('white') }).strict();

export const Layer = z.discriminatedUnion('type', [Text, Sticker, Illustrate, Image, Sequence, Zoom, Shake, Flash]);

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
// copy's info ({frames, width, height}); `assets` maps asset names to {width, height}. Returns the
// normalised spec (defaults filled in, so a stored version renders the same later), the plan the
// renderer follows and the output↔source mapping to show back.
export function planEdit(input, footage, assets = {}) {
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
    if ((layer.type === 'image' && layer.place === 'screen' || layer.type === 'sequence' || layer.type === 'sticker') && layer.at == null && !layer.path) layer.at = { x: 0.5, y: 0.5 };
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

## Tips
- Layers are drawn in list order, later on top. Illustrate layers are the exception: they redraw the footage itself,
  so they always sit right over it, under all text, stickers and pictures.
- Keep text inside x 0.08–0.92 and, on vertical video, y 0.12–0.80: Instagram covers the edges and the bottom.
- An illustrated moment reads best on a hold, or on a slow part of the clip.
- An image with place "footage" should be drawn over a frame of this clip at the same size (use get_frame without a grid,
  have it illustrated, and upload it on the dashboard as an asset); it then lines up with the footage exactly.
- Use preview_edit on the frames either side of every transition before rendering the video.`;
