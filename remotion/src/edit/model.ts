// The edit as the app hands it over: already checked and normalised (see src/edits.js in the app), with
// the timeline worked out. Everything here is plain arithmetic on frames, so every frame renders the same
// way on its own, which is what Remotion needs.
import { Easing, interpolate } from 'remotion';

export type Point = { x: number; y: number };
export type Place = string | Point;
type Span = { from: number; to: number; in: number; out: number };
export type TextMotion = { by: 'letter' | 'word' | 'line'; style: 'fade' | 'rise' | 'drop' | 'pop' | 'blur' | 'slide' | 'scramble' | 'typewriter' | 'flip'; stagger: number; duration: number };
export type TextLayer = Span & { type: 'text'; text: string; style: 'title' | 'callout' | 'caption' | 'label' | 'script' | 'band'; at?: Place; offset?: Point; path?: PathKey[]; pointer: boolean; size?: number; color?: string; background?: string; align: 'left' | 'center' | 'right'; enter: 'pop' | 'fade' | 'rise' | 'type' | 'slide' | 'none'; exit: 'fade' | 'pop' | 'sink' | 'none';
  font?: 'serif' | 'script' | 'sans' | 'display' | 'mono'; reveal?: TextMotion; hide?: TextMotion; loop?: 'none' | 'wave' | 'bounce' | 'pulse' | 'shake' | 'flicker' | 'glow';
  highlight?: { words: string[]; color: string; style: 'marker' | 'underline' | 'box'; delay: number }; count?: { from: number; to: number; decimals: number; frames: number };
  stroke?: { color: string; width: number }; glow?: string; gradient?: [string, string]; tracking?: number; rotate?: number; blend?: Blend };
export type PathKey = { frame: number; x?: number; y?: number; at?: string; depth?: number };
export type Facing = 'as-drawn' | 'flip' | 'path';
export type StickerLayer = Span & { type: 'sticker'; shape: 'sparkles' | 'steam' | 'hearts' | 'stars' | 'circle' | 'arrow' | 'burst' | 'pulse' | 'underline' | 'squiggle'; at?: Place; offset?: Point; path?: PathKey[]; size: number; color: string; rotate: number; enter: 'draw' | 'pop' | 'fade' | 'none'; exit: 'fade' | 'pop' | 'none' };
export type IllustrateLayer = Span & { type: 'illustrate'; style: 'cel' | 'ink' | 'sketch' | 'watercolor' | 'duotone' | 'posterize'; transition: 'fade' | 'wipe' | 'iris'; at?: Place; boil: boolean; colors?: [string, string] };
export type Blend = 'normal' | 'screen' | 'add' | 'multiply' | 'overlay' | 'soft-light' | 'lighten';
export type ImageLayer = Span & { type: 'image'; asset: string; place: 'footage' | 'screen'; at?: Place; offset?: Point; path?: PathKey[]; facing?: Facing; size: number; opacity: number; enter: 'pop' | 'fade' | 'wipe' | 'none'; exit: 'pop' | 'fade' | 'none'; motion: 'none' | 'float' | 'boil' | 'sway' | 'pulse' | 'spin';
  blend?: Blend; glow?: number; tint?: string };
export type ZoomLayer = Span & { type: 'zoom'; scale: number; focus: Place };
export type ShakeLayer = Span & { type: 'shake'; strength: number };
export type FlashLayer = Span & { type: 'flash'; color: string };
export type GradeKnobs = { exposure: number; contrast: number; saturation: number; temperature: number; tint: number; lift: string; gain: string; fade: number; vignette: number; grain: number };
// A grade's look is already resolved to plain numbers by the time the renderer sees it (src/grade.js).
export type GradeLayer = Span & { type: 'grade'; look?: string; strength: number; knobs: GradeKnobs; bars: 'none' | '2.39' | '2.00' | '1.85' | number };
export type SequenceLayer = Span & { type: 'sequence'; asset: string; count: number; columns?: number; range?: { from: number; to: number }; playback?: 'loop' | 'once' | 'pingpong'; rotate?: number; spin?: number; blend?: Blend; glow?: number; tint?: string; fps: number; loop: boolean; at?: Place; offset?: Point; path?: PathKey[]; facing: Facing; size: number; opacity: number; enter: 'pop' | 'fade' | 'none'; exit: 'pop' | 'fade' | 'none'; motion: 'none' | 'bob' | 'sway' };
export type Track = { frame: number; value: number }[];
export type ParticlesLayer = Span & { type: 'particles'; shape?: 'dot' | 'soft' | 'spark' | 'star' | 'ring' | 'streak' | 'heart' | 'confetti' | 'square'; asset?: string; count: number; columns?: number; fps: number;
  at?: Place; offset?: Point; path?: PathKey[]; area?: { width: number; height: number }; rate: number; burst: number; life: number; speed: number; direction: number; spread: number;
  gravity: number; drag: number; size: number; sizeRandom: number; grow: number; spin: number; colors?: string[]; fade: 'in-out' | 'out' | 'none'; opacity: number; blend?: Blend; glow?: number; seed: number };
export type GraphicElement = {
  shape: 'path' | 'circle' | 'ellipse' | 'rect' | 'line' | 'text'; d?: string; cx?: number; cy?: number; r?: number; rx?: number; ry?: number;
  x?: number; y?: number; width?: number; height?: number; x2?: number; y2?: number; text?: string; font?: 'serif' | 'script'; fontSize?: number;
  anchor?: 'start' | 'middle' | 'end'; fill?: string; stroke?: string; strokeWidth?: number; opacity?: number; origin?: Point;
  keys?: Partial<Record<'x' | 'y' | 'rotate' | 'scale' | 'scaleX' | 'scaleY' | 'opacity' | 'draw', Track>>;
  ease?: 'linear' | 'smooth' | 'in' | 'out' | 'back' | 'bounce';
  repeat?: { count: number; delay: number; dx: number; dy: number; rotate: number; scale: number };
};
export type GraphicLayer = Span & { type: 'graphic'; use?: string; viewBox?: { width: number; height: number }; loop?: number; elements?: GraphicElement[];
  at?: Place; offset?: Point; path?: PathKey[]; facing: Facing; size: number; opacity: number; enter: 'pop' | 'fade' | 'none'; exit: 'pop' | 'fade' | 'none' };
export type ModelLayer = Span & { type: 'model'; asset: string; node?: string; soften: number; animation?: string; speed: number; loop: boolean; actions?: { frame: number; animation: string; speed?: number; loop?: boolean; stride?: number }[]; blend: number;
  depth?: number | 'auto'; stride?: number; front: 'camera' | 'away' | 'right' | 'left';
  at?: Place; offset?: Point; path?: PathKey[]; facing: 'as-made' | 'path'; angle: number; pin: 'feet' | 'center'; size: number; turn: number; tilt: number;
  world?: string; worldPath?: { frame: number; world: string }[];
  keys?: Partial<Record<'turn' | 'tilt' | 'spin' | 'roll' | 'scale', Track>>; light: 'left' | 'right' | 'front' | 'top' | 'back'; brightness: number; shadow: number;
  color?: string; follow?: string; look: 'as-made' | 'toon'; boil: boolean; opacity: number; enter: 'pop' | 'fade' | 'none'; exit: 'pop' | 'fade' | 'none' };
export type BlurLayer = Span & { type: 'blur'; focus: number; range: number; amount: number; near: boolean };
export type FogLayer = Span & { type: 'fog'; color: string; strength: number; start: number };
export type ParallaxLayer = Span & { type: 'parallax'; move: 'pan' | 'tilt' | 'orbit'; amount: number };
export type Layer = GradeLayer | TextLayer | StickerLayer | IllustrateLayer | ImageLayer | SequenceLayer | ParticlesLayer | GraphicLayer | ModelLayer | BlurLayer | FogLayer | ParallaxLayer | ZoomLayer | ShakeLayer | FlashLayer;
export type Keyframe = { frame: number; x: number; y: number };
export type DepthSpec = { video: boolean; stills?: { from: number; to: number; asset: string }[]; near: 'white' | 'black' };
export type Level = { frame: number; value: number }[];
export type SoundCue = { sound: string; file?: string; at: number; length: number; volume: number; from: number; loop: boolean; fadeIn: number; fadeOut: number; speed: number; volumeKeys?: Level; duck?: number };
export type Spec = { format: string; fit: 'cover' | 'contain'; background: string; audio: 'source' | 'mute'; anchors: Record<string, Keyframe[]>; layers: Layer[]; depth?: DepthSpec;
  sounds?: SoundCue[]; sourceVolume?: number; sourceKeys?: Level };
export type Segment = { from: number; to: number; source: number; hold?: boolean; sourceTo?: number; speed?: number; clip?: string; dissolve?: number };
export type Plan = { width: number; height: number; fps: number; durationInFrames: number; segments: Segment[] };
export type Asset = { src: string; width: number; height: number };
export type DepthFrames = { base: string; frames: number };
// A camera track: where the camera was and which way it looked on every frame of the clip, so a layer
// can be put in the room instead of on the screen. Poses are [x, y, z, qx, qy, qz, qw] in OpenGL
// convention (the camera looks along −Z, +Y up), or null on frames the track does not cover.
export type Pose = [number, number, number, number, number, number, number];
export type CameraTrack = { frames: number; fovY: number; aspect: number; up: [number, number, number]; scale: number; poses: (Pose | null)[] };
export type ClipVideo = { src: string; width: number; height: number; frames: number };
export type FootageEditProps = { spec: Spec; plan: Plan; video: string; videos?: Record<string, ClipVideo> | null; assets: Record<string, Asset>; source: { width: number; height: number; frames: number }; depth?: DepthFrames | null; models?: Record<string, { src: string }>; sounds?: Record<string, { src: string }>; track?: CameraTrack | null; world?: Record<string, [number, number, number]> | null };

export const PALETTE: Record<string, string> = { ink: '#17352d', lime: '#d4ed86', paper: '#f4f0e6', white: '#ffffff', black: '#111111', coral: '#ff6b5b', gold: '#f5c542', sky: '#7cc6fe' };
export const colour = (c: string | undefined, fallback: string) => (c ? PALETTE[c] ?? c : fallback);

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = Easing.inOut(Easing.cubic);

// The source frame on screen at an output frame. Fractional in slow motion, which keeps anchors smooth.
export function sourceAt(segments: Segment[], frame: number): number {
  const s = segments.find((x) => frame >= x.from && frame < x.to) ?? segments[segments.length - 1];
  if (!s) return 0;
  if (s.hold) return s.source;
  return Math.min((s.sourceTo ?? s.source + 1) - 1, s.source + (frame - s.from) * (s.speed ?? 1));
}

// Where a keyframed point is at a (source) frame: straight lines between keyframes, held at both ends.
export function anchorAt(keys: Keyframe[], frame: number): Point {
  if (frame <= keys[0].frame) return keys[0];
  const last = keys[keys.length - 1];
  if (frame >= last.frame) return last;
  const i = keys.findIndex((k, n) => frame >= k.frame && frame < keys[n + 1].frame);
  const a = keys[i], b = keys[i + 1], t = (frame - a.frame) / (b.frame - a.frame);
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
}

// How far a layer is into its entrance (enter: 0→1) and exit (exit: 0→1), and whether it is on at all.
export function phase(layer: Span, frame: number) {
  const on = frame >= layer.from && frame < layer.to;
  const enter = layer.in > 0 ? clamp((frame - layer.from) / layer.in) : 1;
  const exit = layer.out > 0 ? clamp((frame - (layer.to - layer.out)) / layer.out) : 0;
  return { on, enter, exit, local: frame - layer.from, length: layer.to - layer.from };
}
// 0 → 1 → 0 over a layer, eased: how strongly a zoom or shake applies.
export const envelope = (layer: Span, frame: number) => {
  const p = phase(layer, frame);
  return p.on ? smooth(p.enter) * (1 - smooth(p.exit)) : 0;
};

export type Camera = { zoom: number; cx: number; cy: number; dx: number; dy: number };
// The camera: which point of the footage is at the centre of the screen, and how far in. With cover fit
// it never moves so far that the edge of the footage shows.
export function cameraAt(props: FootageEditProps, frame: number, base: number, rand: (seed: string) => number): Camera {
  const { spec, plan, source } = props;
  const s = sourceAt(plan.segments, frame);
  let zoom = 1, cx = 0.5, cy = 0.5;
  const z = spec.layers.find((l): l is ZoomLayer => l.type === 'zoom' && frame >= l.from && frame < l.to);
  if (z) {
    const t = envelope(z, frame);
    const f = footagePoint(spec, z.focus, s);
    zoom = lerp(1, z.scale, t); cx = lerp(0.5, f.x, t); cy = lerp(0.5, f.y, t);
  }
  const hw = plan.width / 2 / (source.width * base * zoom), hh = plan.height / 2 / (source.height * base * zoom);
  cx = hw < 0.5 ? clamp(cx, hw, 1 - hw) : 0.5;
  cy = hh < 0.5 ? clamp(cy, hh, 1 - hh) : 0.5;
  let dx = 0, dy = 0;
  for (const l of spec.layers) {
    if (l.type !== 'shake' || frame < l.from || frame >= l.to) continue;
    const k = envelope(l, frame) * l.strength * 28;
    dx += (rand(`shake-x-${frame}`) - 0.5) * 2 * k; dy += (rand(`shake-y-${frame}`) - 0.5) * 2 * k;
  }
  return { zoom, cx, cy, dx, dy };
}

// A point in footage coordinates (0–1 of the clip), from an anchor name or a literal point.
export function footagePoint(spec: Spec, place: Place, sourceFrame: number): Point {
  if (typeof place !== 'string') return place;
  const keys = spec.anchors[place];
  return keys?.length ? anchorAt(keys, sourceFrame) : { x: 0.5, y: 0.5 };
}

// Pixels per source pixel at zoom 1: cover fills the frame, contain shows all of the clip.
// How much a picture of this size is scaled to fill (or fit inside) the finished frame.
export const scaleFor = (plan: Plan, size: { width: number; height: number }, fit: Spec['fit']) => {
  const sx = plan.width / size.width, sy = plan.height / size.height;
  return fit === 'contain' ? Math.min(sx, sy) : Math.max(sx, sy);
};
export const baseScale = (props: FootageEditProps) => scaleFor(props.plan, props.source, props.spec.fit);

// The footage rectangle on screen, and where a footage point lands on screen, for a camera.
export function footageRect(props: FootageEditProps, cam: Camera, base: number) {
  const { plan, source } = props;
  const w = source.width * base * cam.zoom, h = source.height * base * cam.zoom;
  return { left: plan.width / 2 - cam.cx * w + cam.dx, top: plan.height / 2 - cam.cy * h + cam.dy, width: w, height: h };
}
// The same, for a clip cut in from somewhere else: it has its own shape, so it fills the frame its own
// way rather than borrowing the edit's clip's.
export function clipRect(props: FootageEditProps, cam: Camera, size: { width: number; height: number }) {
  const { plan, spec } = props;
  const base = scaleFor(plan, size, spec.fit);
  const w = size.width * base * cam.zoom, h = size.height * base * cam.zoom;
  return { left: plan.width / 2 - cam.cx * w + cam.dx, top: plan.height / 2 - cam.cy * h + cam.dy, width: w, height: h };
}
export function toScreen(props: FootageEditProps, cam: Camera, base: number, p: Point): Point {
  const r = footageRect(props, cam, base);
  return { x: r.left + p.x * r.width, y: r.top + p.y * r.height };
}
// Screen position (pixels) of a layer's `at` plus offset: anchors follow the footage, points stay put.
export function screenPlace(props: FootageEditProps, cam: Camera, base: number, frame: number, at: Place | undefined, offset: Point | undefined, fallback: Point): Point {
  const { plan, spec } = props;
  // A name can be a spot in the room as well as an anchor in the picture. World spots win: they are
  // only defined when the clip has a camera track, and planEdit keeps the two from sharing a name.
  const spot = typeof at === 'string' && props.track ? props.world?.[at] : null;
  const p = spot ? worldOnScreen(props, cam, base, frame, spot)
    : at == null ? { x: fallback.x * plan.width, y: fallback.y * plan.height }
      : typeof at === 'string' ? toScreen(props, cam, base, footagePoint(spec, at, sourceAt(plan.segments, frame)))
        : { x: at.x * plan.width, y: at.y * plan.height };
  return { x: p.x + (offset?.x ?? 0) * plan.width, y: p.y + (offset?.y ?? 0) * plan.height };
}
// Where a spot in the room lands on screen. Once it is behind the camera there is no such place, so it
// is put far outside the frame, which keeps it out of the picture without every layer having to ask.
const BEHIND = { x: -1e6, y: -1e6 };
function worldOnScreen(props: FootageEditProps, cam: Camera, base: number, frame: number, point: [number, number, number]): Point {
  const s = props.track ? projectWorld(props.track, sourceAt(props.plan.segments, frame), point) : null;
  if (!s || s.behind || !Number.isFinite(s.x) || !Number.isFinite(s.y)) return BEHIND;
  return toScreen(props, cam, base, { x: s.x, y: s.y });
}

// Where a layer is at a frame: along its path when it has one (smoothed through the keys, and a key
// naming an anchor sits wherever that anchor is at this frame), otherwise at `at`.
type Moving = { at?: Place; offset?: Point; path?: PathKey[]; follow?: string };
// `shift` (from follow) moves the x/y keys only: a key on an anchor already moves with the footage.
function pathPoint(props: FootageEditProps, cam: Camera, base: number, frame: number, path: PathKey[], shift: Point = { x: 0, y: 0 }): Point {
  const key = (k: PathKey) => {
    if (k.at) return screenPlace(props, cam, base, frame, k.at, undefined, { x: 0.5, y: 0.5 });
    const p = screenPlace(props, cam, base, frame, { x: k.x ?? 0.5, y: k.y ?? 0.5 }, undefined, { x: 0.5, y: 0.5 });
    return { x: p.x + shift.x, y: p.y + shift.y };
  };
  if (frame <= path[0].frame) return key(path[0]);
  const last = path.length - 1;
  if (frame >= path[last].frame) return key(path[last]);
  const i = path.findIndex((k, n) => frame >= k.frame && frame < path[n + 1].frame);
  const p0 = key(path[Math.max(0, i - 1)]), p1 = key(path[i]), p2 = key(path[i + 1]), p3 = key(path[Math.min(last, i + 2)]);
  const t = (frame - path[i].frame) / (path[i + 1].frame - path[i].frame);
  // Catmull-Rom: a curve through every key, so a flight path bends instead of zig-zagging.
  const cr = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
  return { x: cr(p0.x, p1.x, p2.x, p3.x), y: cr(p0.y, p1.y, p2.y, p3.y) };
}
export function layerPoint(props: FootageEditProps, cam: Camera, base: number, frame: number, layer: Moving, fallback: Point): Point {
  const shift = followShift(props, cam, base, frame, layer.follow);
  if (!layer.path?.length) {
    const p = screenPlace(props, cam, base, frame, layer.at, layer.offset, fallback);
    return typeof layer.at === 'string' ? p : { x: p.x + shift.x, y: p.y + shift.y };
  }
  const p = pathPoint(props, cam, base, frame, layer.path, shift);
  return { x: p.x + (layer.offset?.x ?? 0) * props.plan.width, y: p.y + (layer.offset?.y ?? 0) * props.plan.height };
}
// How far, on screen, the followed anchor has moved since its first keyframe: the camera's drift, which
// the layer then shares so it stays put on the table instead of on the screen.
function followShift(props: FootageEditProps, cam: Camera, base: number, frame: number, follow: string | undefined): Point {
  const keys = follow ? props.spec.anchors[follow] : undefined;
  if (!keys?.length) return { x: 0, y: 0 };
  const now = anchorAt(keys, sourceAt(props.plan.segments, frame)), r = footageRect(props, cam, base);
  return { x: (now.x - keys[0].x) * r.width, y: (now.y - keys[0].y) * r.height };
}
// Which way a thing on a path faces, and how much it leans: it looks the way it is going (drawn facing
// right), keeps its last direction while hovering, and tilts up to 20° into climbs and dives.
export function heading(props: FootageEditProps, cam: Camera, base: number, frame: number, layer: Moving & { facing?: Facing }) {
  if (layer.facing === 'flip') return { flip: true, tilt: 0 };
  if (layer.facing !== 'path' || !layer.path?.length) return { flip: false, tilt: 0 };
  const at = (f: number) => pathPoint(props, cam, base, f, layer.path!);
  for (let back = 0; back < 30; back++) {
    const a = at(frame - back - 2), b = at(frame - back + 2), dx = b.x - a.x, dy = b.y - a.y;
    if (Math.abs(dx) + Math.abs(dy) < 1) continue;
    const flip = dx < 0;
    const lean = Math.max(-20, Math.min(20, (Math.atan2(dy, Math.abs(dx)) * 180) / Math.PI));
    return { flip, tilt: back ? 0 : flip ? -lean : lean };
  }
  return { flip: false, tilt: 0 };
}

// For a 3D model on a path: which way it travels across the screen (-1 left … 1 right, eased over a few
// frames so it turns round through facing the camera) and how much it leans into climbs and dives.
export function travel(props: FootageEditProps, cam: Camera, base: number, frame: number, layer: Moving & { facing?: string }) {
  if (layer.facing !== 'path' || !layer.path?.length) return { dir: 0, lean: 0 };
  const TURN = 8;
  let sum = 0;
  for (let back = 0; back < TURN; back++) sum += heading(props, cam, base, frame - back, { ...layer, facing: 'path' }).flip ? -1 : 1;
  const now = heading(props, cam, base, frame, { ...layer, facing: 'path' });
  return { dir: sum / TURN, lean: now.tilt };
}

// How far along its path (in pixels of the finished frame) a layer has moved by each frame, for walk
// cycles that keep pace with the walking. Worked out once per layer, from the path alone (not camera
// shake or `follow`), the same in every render tab, so frames rendered apart still agree.
const walkedCache = new WeakMap<object, Float64Array>();
export function walked(props: FootageEditProps, base: number, layer: Span & Moving, frame: number, rand: (seed: string) => number): number {
  if (!layer.path?.length) return 0;
  let table = walkedCache.get(layer);
  if (!table) {
    table = new Float64Array(Math.max(1, layer.to - layer.from));
    let last: Point | null = null;
    for (let i = 0; i < table.length; i++) {
      const f = layer.from + i, cam = { ...cameraAt(props, f, base, rand), dx: 0, dy: 0 };
      const p = pathPoint(props, cam, base, f, layer.path);
      table[i] = (i ? table[i - 1] : 0) + (last ? Math.hypot(p.x - last.x, p.y - last.y) : 0);
      last = p;
    }
    walkedCache.set(layer, table);
  }
  return table[Math.min(table.length - 1, Math.max(0, Math.round(frame - layer.from)))];
}

// Entrance and exit as style: opacity, scale and movement.
export function motionStyle(enterKind: string, exitKind: string, enter: number, exit: number) {
  let opacity = 1, scale = 1, dx = 0, dy = 0;
  const e = Easing.out(Easing.cubic)(enter), back = Easing.out(Easing.back(1.8))(enter);
  switch (enterKind) {
    case 'pop': scale *= interpolate(back, [0, 1], [0.55, 1]); opacity *= clamp(enter * 2.5); break;
    case 'fade': opacity *= e; break;
    case 'rise': dy += (1 - e) * 60; opacity *= e; break;
    case 'slide': dx -= (1 - e) * 90; opacity *= e; break;
    case 'draw': case 'wipe': opacity *= clamp(enter * 4); break;
    default: break;
  }
  const x = Easing.in(Easing.cubic)(exit);
  switch (exitKind) {
    case 'fade': opacity *= 1 - x; break;
    case 'pop': scale *= interpolate(Easing.in(Easing.back(1.8))(exit), [0, 1], [1, 0.5]); opacity *= 1 - clamp((exit - 0.5) * 2); break;
    case 'sink': dy += x * 60; opacity *= 1 - x; break;
    default: break;
  }
  return { opacity, scale, dx, dy };
}

// The depth picture for an output frame: a still where one covers the frame, otherwise the clip's
// per-frame depth at the source frame on screen, so it follows cuts and freezes like the footage.
export function depthSource(props: FootageEditProps, frame: number): string | null {
  const d = props.spec.depth;
  if (!d) return null;
  const still = d.stills?.find((st) => frame >= st.from && frame < st.to);
  if (still) return props.assets[still.asset]?.src ?? null;
  if (!d.video || !props.depth) return null;
  const n = Math.min(props.depth.frames - 1, Math.max(0, Math.floor(sourceAt(props.plan.segments, frame))));
  return `${props.depth.base}/${String(n).padStart(5, '0')}.jpg`;
}
// How near a layer is at a frame: eased between path keys that carry a depth, else its own depth.
export function layerDepth(layer: { depth?: number; path?: PathKey[] }, frame: number): number | undefined {
  const keys = layer.path?.filter((k) => k.depth != null) ?? [];
  if (!keys.length) return layer.depth;
  if (frame <= keys[0].frame) return keys[0].depth;
  const last = keys[keys.length - 1];
  if (frame >= last.frame) return last.depth;
  const i = keys.findIndex((k, n) => frame >= k.frame && frame < keys[n + 1].frame);
  const a = keys[i], b = keys[i + 1];
  return lerp(a.depth!, b.depth!, smooth((frame - a.frame) / (b.frame - a.frame)));
}
// A colour-matrix row turning the depth picture's grey into a*nearness + b, whichever end is near.
export function nearRow(near: 'white' | 'black' | undefined, a: number, b: number) {
  return near === 'black' ? `${-a} 0 0 0 ${a + b}` : `${a} 0 0 0 ${b}`;
}

// A level from keys, eased between them and held before the first and after the last.
export function levelAt(keys: Level | undefined, frame: number, fallback = 1): number {
  if (!keys?.length) return fallback;
  if (frame <= keys[0].frame) return keys[0].value;
  const last = keys[keys.length - 1];
  if (frame >= last.frame) return last.value;
  const i = keys.findIndex((k, n) => frame >= k.frame && frame < keys[n + 1].frame);
  return lerp(keys[i].value, keys[i + 1].value, smooth((frame - keys[i].frame) / (keys[i + 1].frame - keys[i].frame)));
}
// A sound cue's volume `f` frames into it: its level, its volume keys, and its fades.
export function cueVolume(c: SoundCue, f: number): number {
  const fadeIn = c.fadeIn > 0 ? clamp(f / c.fadeIn) : 1, fadeOut = c.fadeOut > 0 ? clamp((c.length - f) / c.fadeOut) : 1;
  return Math.max(0, c.volume * levelAt(c.volumeKeys, f) * fadeIn * fadeOut);
}
// The clip's own sound at an output frame: its volume and keys, lowered under any cue that ducks it
// (easing down over the 6 frames before the cue and back up over the 6 after).
export function sourceVolumeAt(spec: Spec, frame: number): number {
  let v = (spec.sourceVolume ?? 1) * levelAt(spec.sourceKeys, frame);
  for (const c of spec.sounds ?? []) {
    if (c.duck == null) continue;
    const w = clamp((frame - (c.at - 6)) / 6) * clamp((c.at + c.length + 6 - frame) / 6);
    v *= 1 - (1 - c.duck) * smooth(w);
  }
  return Math.max(0, v);
}

// CSS for how a layer mixes with the picture under it, and a soft glow around it.
export const blendMode = (b?: Blend) => (b === 'add' ? 'plus-lighter' : b && b !== 'normal' ? b : undefined) as import('react').CSSProperties['mixBlendMode'];
export const glowFilter = (px?: number, color = 'rgba(255,244,214,0.9)') => (px ? `drop-shadow(0 0 ${(px / 2).toFixed(1)}px ${color}) drop-shadow(0 0 ${px}px ${color})` : undefined);

// ---- Looking through a tracked camera ---------------------------------------------------------------
// The same arithmetic as src/tracking.js on the server, so a spot resolved there lands here.
type Quat = [number, number, number, number];
const qdot = (a: Quat, b: Quat) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
function qslerp(a: Quat, b: Quat, t: number): Quat {
  let d = qdot(a, b), c = b;
  if (d < 0) { c = b.map((v) => -v) as Quat; d = -d; }
  if (d > 0.9995) {
    const m = a.map((v, i) => v + (c[i] - v) * t) as Quat;
    const l = Math.hypot(...m) || 1;
    return m.map((v) => v / l) as Quat;
  }
  const th = Math.acos(d), s = Math.sin(th);
  return a.map((v, i) => (v * Math.sin((1 - t) * th) + c[i] * Math.sin(t * th)) / s) as Quat;
}
export const qrotate = (q: Quat, v: [number, number, number]): [number, number, number] => {
  const [x, y, z, w] = q, [vx, vy, vz] = v;
  // t = 2 * (q.xyz x v); v' = v + w t + q.xyz x t
  const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx);
  return [vx + w * tx + y * tz - z * ty, vy + w * ty + z * tx - x * tz, vz + w * tz + x * ty - y * tx];
};
export type CameraPose = { position: [number, number, number]; q: Quat };
// The camera at a (possibly fractional) SOURCE frame; null where the track does not reach.
export function cameraPoseAt(track: CameraTrack, frame: number): CameraPose | null {
  const n = Math.max(0, Math.min(track.frames - 1, frame));
  const a = Math.floor(n), b = Math.min(track.frames - 1, a + 1), k = n - a;
  const pa = track.poses[a], pb = track.poses[b];
  if (!pa && !pb) return null;
  if (!pa || !pb || k === 0) {
    const p = (pa ?? pb) as Pose;
    return { position: [p[0], p[1], p[2]], q: [p[3], p[4], p[5], p[6]] };
  }
  return {
    position: [pa[0] + (pb[0] - pa[0]) * k, pa[1] + (pb[1] - pa[1]) * k, pa[2] + (pb[2] - pa[2]) * k],
    q: qslerp([pa[3], pa[4], pa[5], pa[6]], [pb[3], pb[4], pb[5], pb[6]], k),
  };
}
// Where a point in the room shows in the footage, in 0–1 of the clip picture.
export function projectWorld(track: CameraTrack, frame: number, point: [number, number, number]) {
  const pose = cameraPoseAt(track, frame);
  if (!pose) return null;
  const d: [number, number, number] = [point[0] - pose.position[0], point[1] - pose.position[1], point[2] - pose.position[2]];
  const inv: Quat = [-pose.q[0], -pose.q[1], -pose.q[2], pose.q[3]];
  const v = qrotate(inv, d);
  if (v[2] >= -1e-9) return { x: NaN, y: NaN, behind: true, depth: 0 };
  const f = 1 / Math.tan((track.fovY * Math.PI) / 360);
  return { x: 0.5 + ((v[0] / -v[2]) * f) / track.aspect / 2, y: 0.5 - ((v[1] / -v[2]) * f) / 2, behind: false, depth: -v[2] };
}
// A layer's spot in the room at an output frame: one spot, or eased along a worldPath between spots.
export function worldAt(props: FootageEditProps, layer: { world?: string; worldPath?: { frame: number; world: string }[] }, frame: number): [number, number, number] | null {
  const named = (name: string) => props.world?.[name] ?? null;
  const keys = layer.worldPath;
  if (!keys?.length) return layer.world ? named(layer.world) : null;
  if (frame <= keys[0].frame) return named(keys[0].world);
  const last = keys[keys.length - 1];
  if (frame >= last.frame) return named(last.world);
  const i = keys.findIndex((k, n) => frame >= k.frame && frame < keys[n + 1].frame);
  const a = named(keys[i].world), b = named(keys[i + 1].world);
  if (!a || !b) return a ?? b;
  const t = smooth((frame - keys[i].frame) / (keys[i + 1].frame - keys[i].frame));
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
