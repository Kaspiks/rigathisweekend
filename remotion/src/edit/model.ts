// The edit as the app hands it over: already checked and normalised (see src/edits.js in the app), with
// the timeline worked out. Everything here is plain arithmetic on frames, so every frame renders the same
// way on its own, which is what Remotion needs.
import { Easing, interpolate } from 'remotion';

export type Point = { x: number; y: number };
export type Place = string | Point;
type Span = { from: number; to: number; in: number; out: number };
export type TextLayer = Span & { type: 'text'; text: string; style: 'title' | 'callout' | 'caption' | 'label' | 'script' | 'band'; at?: Place; offset?: Point; pointer: boolean; size?: number; color?: string; background?: string; align: 'left' | 'center' | 'right'; enter: 'pop' | 'fade' | 'rise' | 'type' | 'slide' | 'none'; exit: 'fade' | 'pop' | 'sink' | 'none' };
export type PathKey = { frame: number; x?: number; y?: number; at?: string; depth?: number };
export type Facing = 'as-drawn' | 'flip' | 'path';
export type StickerLayer = Span & { type: 'sticker'; shape: 'sparkles' | 'steam' | 'hearts' | 'stars' | 'circle' | 'arrow' | 'burst' | 'pulse' | 'underline' | 'squiggle'; at?: Place; offset?: Point; path?: PathKey[]; size: number; color: string; rotate: number; enter: 'draw' | 'pop' | 'fade' | 'none'; exit: 'fade' | 'pop' | 'none' };
export type IllustrateLayer = Span & { type: 'illustrate'; style: 'cel' | 'ink' | 'sketch' | 'watercolor' | 'duotone' | 'posterize'; transition: 'fade' | 'wipe' | 'iris'; at?: Place; boil: boolean; colors?: [string, string] };
export type ImageLayer = Span & { type: 'image'; asset: string; place: 'footage' | 'screen'; at?: Place; offset?: Point; path?: PathKey[]; facing?: Facing; size: number; opacity: number; enter: 'pop' | 'fade' | 'wipe' | 'none'; exit: 'pop' | 'fade' | 'none'; motion: 'none' | 'float' | 'boil' | 'sway' | 'pulse' | 'spin' };
export type ZoomLayer = Span & { type: 'zoom'; scale: number; focus: Place };
export type ShakeLayer = Span & { type: 'shake'; strength: number };
export type FlashLayer = Span & { type: 'flash'; color: string };
export type SequenceLayer = Span & { type: 'sequence'; asset: string; count: number; fps: number; loop: boolean; at?: Place; offset?: Point; path?: PathKey[]; facing: Facing; size: number; opacity: number; enter: 'pop' | 'fade' | 'none'; exit: 'pop' | 'fade' | 'none'; motion: 'none' | 'bob' | 'sway' };
export type Track = { frame: number; value: number }[];
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
export type ModelLayer = Span & { type: 'model'; asset: string; animation?: string; speed: number; loop: boolean; actions?: { frame: number; animation: string; speed?: number; loop?: boolean }[]; blend: number;
  at?: Place; offset?: Point; path?: PathKey[]; facing: 'as-made' | 'path'; angle: number; pin: 'feet' | 'center'; size: number; turn: number; tilt: number;
  keys?: Partial<Record<'turn' | 'tilt' | 'spin' | 'roll' | 'scale', Track>>; light: 'left' | 'right' | 'front' | 'top' | 'back'; brightness: number; shadow: number;
  color?: string; follow?: string; look: 'as-made' | 'toon'; boil: boolean; opacity: number; enter: 'pop' | 'fade' | 'none'; exit: 'pop' | 'fade' | 'none' };
export type BlurLayer = Span & { type: 'blur'; focus: number; range: number; amount: number; near: boolean };
export type FogLayer = Span & { type: 'fog'; color: string; strength: number; start: number };
export type ParallaxLayer = Span & { type: 'parallax'; move: 'pan' | 'tilt' | 'orbit'; amount: number };
export type Layer = TextLayer | StickerLayer | IllustrateLayer | ImageLayer | SequenceLayer | GraphicLayer | ModelLayer | BlurLayer | FogLayer | ParallaxLayer | ZoomLayer | ShakeLayer | FlashLayer;
export type Keyframe = { frame: number; x: number; y: number };
export type DepthSpec = { video: boolean; stills?: { from: number; to: number; asset: string }[]; near: 'white' | 'black' };
export type Spec = { format: string; fit: 'cover' | 'contain'; background: string; audio: 'source' | 'mute'; anchors: Record<string, Keyframe[]>; layers: Layer[]; depth?: DepthSpec };
export type Segment = { from: number; to: number; source: number; hold?: boolean; sourceTo?: number; speed?: number };
export type Plan = { width: number; height: number; fps: number; durationInFrames: number; segments: Segment[] };
export type Asset = { src: string; width: number; height: number };
export type DepthFrames = { base: string; frames: number };
export type FootageEditProps = { spec: Spec; plan: Plan; video: string; assets: Record<string, Asset>; source: { width: number; height: number; frames: number }; depth?: DepthFrames | null; models?: Record<string, { src: string }> };

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
export const baseScale = (props: FootageEditProps) => {
  const { plan, source, spec } = props;
  const sx = plan.width / source.width, sy = plan.height / source.height;
  return spec.fit === 'contain' ? Math.min(sx, sy) : Math.max(sx, sy);
};

// The footage rectangle on screen, and where a footage point lands on screen, for a camera.
export function footageRect(props: FootageEditProps, cam: Camera, base: number) {
  const { plan, source } = props;
  const w = source.width * base * cam.zoom, h = source.height * base * cam.zoom;
  return { left: plan.width / 2 - cam.cx * w + cam.dx, top: plan.height / 2 - cam.cy * h + cam.dy, width: w, height: h };
}
export function toScreen(props: FootageEditProps, cam: Camera, base: number, p: Point): Point {
  const r = footageRect(props, cam, base);
  return { x: r.left + p.x * r.width, y: r.top + p.y * r.height };
}
// Screen position (pixels) of a layer's `at` plus offset: anchors follow the footage, points stay put.
export function screenPlace(props: FootageEditProps, cam: Camera, base: number, frame: number, at: Place | undefined, offset: Point | undefined, fallback: Point): Point {
  const { plan, spec } = props;
  const p = at == null ? { x: fallback.x * plan.width, y: fallback.y * plan.height }
    : typeof at === 'string' ? toScreen(props, cam, base, footagePoint(spec, at, sourceAt(plan.segments, frame)))
      : { x: at.x * plan.width, y: at.y * plan.height };
  return { x: p.x + (offset?.x ?? 0) * plan.width, y: p.y + (offset?.y ?? 0) * plan.height };
}

// Where a layer is at a frame: along its path when it has one (smoothed through the keys, and a key
// naming an anchor sits wherever that anchor is at this frame), otherwise at `at`.
type Moving = { at?: Place; offset?: Point; path?: PathKey[]; follow?: string };
function pathPoint(props: FootageEditProps, cam: Camera, base: number, frame: number, path: PathKey[]): Point {
  const key = (k: PathKey) => screenPlace(props, cam, base, frame, k.at ?? { x: k.x ?? 0.5, y: k.y ?? 0.5 }, undefined, { x: 0.5, y: 0.5 });
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
    return { x: p.x + shift.x, y: p.y + shift.y };
  }
  const p = pathPoint(props, cam, base, frame, layer.path);
  return { x: p.x + shift.x + (layer.offset?.x ?? 0) * props.plan.width, y: p.y + shift.y + (layer.offset?.y ?? 0) * props.plan.height };
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
