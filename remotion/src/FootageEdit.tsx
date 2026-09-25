// An animated edit over your own footage, rendered from the JSON edit the app has checked (src/edits.js).
// The clip plays through its timeline (cuts, freezes, speed changes) under a camera that can zoom towards
// or follow an anchor; layers are drawn over it in order: text, stickers, pictures, flashes, and moments
// where the footage itself is redrawn as a drawing.
import '@fontsource/cormorant-garamond/500.css';
import '@fontsource/cormorant-garamond/600.css';
import '@fontsource/cormorant-garamond/700.css';
import '@fontsource/great-vibes/400.css';
import type { CSSProperties } from 'react';
import { AbsoluteFill, Easing, Freeze, Img, OffthreadVideo, Sequence, continueRender, delayRender, random, useCurrentFrame } from 'remotion';
import { BoilFilter, IllustrationFilter } from './edit/filters';
import type { BlurLayer, FogLayer, FootageEditProps, IllustrateLayer, ImageLayer, Layer, ParallaxLayer, SequenceLayer } from './edit/model';
import { PALETTE, baseScale, cameraAt, colour, depthSource, envelope, footageRect, heading, layerDepth, layerPoint, motionStyle, nearRow, phase, screenPlace } from './edit/model';
import { useLocalImage } from './edit/depth';
import { GraphicView } from './edit/Graphics';
import { Sticker } from './edit/Stickers';
import { DEFAULT_AT, TextBox } from './edit/Texts';

const fonts = delayRender('Loading edit fonts');
Promise.all([
  document.fonts.load('700 60px "Cormorant Garamond"'),
  document.fonts.load('600 60px "Cormorant Garamond"'),
  document.fonts.load('60px "Great Vibes"'),
]).then(() => continueRender(fonts));

type Rect = { left: number; top: number; width: number; height: number };

// The clip through its timeline. Rendered once as the picture and again, muted, under each drawing layer.
const Footage = ({ props, rect, muted, style }: { props: FootageEditProps; rect: Rect; muted: boolean; style?: CSSProperties }) => {
  if (!props.video) return null;
  const place: CSSProperties = { position: 'absolute', left: rect.left, top: rect.top, width: rect.width, height: rect.height, objectFit: 'fill', maxWidth: 'none' };
  return (
    <AbsoluteFill style={{ overflow: 'hidden', ...style }}>
      {props.plan.segments.map((s, i) => (
        <Sequence key={i} from={s.from} durationInFrames={s.to - s.from} layout="none">
          {s.hold
            // Remotion keeps a video's frame inside its sequence, so a freeze stops at the sequence's first
            // frame and the trim picks the source frame to show.
            ? <Freeze frame={0}><OffthreadVideo src={props.video} trimBefore={s.source || undefined} muted style={place} /></Freeze>
            : <OffthreadVideo src={props.video} trimBefore={s.source || undefined} playbackRate={s.speed ?? 1} muted={muted || (s.speed ?? 1) !== 1} style={place} />}
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};

// How much of the drawing shows during its entrance and exit: a fade, a wipe from the left, or an iris.
function reveal(layer: IllustrateLayer, frame: number, centre: { x: number; y: number }, w: number, h: number): CSSProperties {
  const p = phase(layer, frame);
  const e = Easing.inOut(Easing.cubic)(p.enter), x = Easing.inOut(Easing.cubic)(p.exit);
  if (layer.transition === 'fade') return { opacity: e * (1 - x) };
  if (layer.transition === 'wipe') return { clipPath: `inset(0 ${((1 - e) * 100).toFixed(2)}% 0 ${(x * 100).toFixed(2)}%)` };
  const far = Math.hypot(Math.max(centre.x, w - centre.x), Math.max(centre.y, h - centre.y));
  return { clipPath: `circle(${(far * e * (1 - x)).toFixed(1)}px at ${centre.x.toFixed(1)}px ${centre.y.toFixed(1)}px)` };
}

type Turn = { flip: boolean; tilt: number };
const turned = (t: Turn) => `rotate(${t.tilt.toFixed(2)}deg)${t.flip ? ' scaleX(-1)' : ''}`;

const Picture = ({ layer, props, rect, x, y, frame, boilId, turn }: { layer: ImageLayer; props: FootageEditProps; rect: Rect; x: number; y: number; frame: number; boilId: string; turn: Turn }) => {
  const asset = props.assets[layer.asset];
  const p = phase(layer, frame);
  if (!asset || !p.on) return null;
  const m = motionStyle(layer.enter, layer.exit, p.enter, p.exit);
  const t = p.local;
  const motion = layer.motion === 'float' ? `translateY(${(Math.sin(t / 14) * 12).toFixed(2)}px)`
    : layer.motion === 'sway' ? `rotate(${(Math.sin(t / 18) * 3).toFixed(2)}deg)`
      : layer.motion === 'pulse' ? `scale(${(1 + Math.sin(t / 8) * 0.04).toFixed(4)})`
        : layer.motion === 'spin' ? `rotate(${(t * 6) % 360}deg)` : '';
  const wipe = layer.enter === 'wipe' ? { clipPath: `inset(0 ${((1 - Easing.inOut(Easing.cubic)(p.enter)) * 100).toFixed(2)}% 0 0)` } : {};
  const common: CSSProperties = { position: 'absolute', opacity: m.opacity * layer.opacity, filter: layer.motion === 'boil' ? `url(#${boilId})` : undefined, ...wipe };
  if (layer.place === 'footage')
    return <Img src={asset.src} style={{ ...common, left: rect.left, top: rect.top, width: rect.width, height: rect.height, objectFit: 'cover', transform: `scale(${m.scale}) ${motion}` }} />;
  const width = layer.size * props.plan.width, height = (width * asset.height) / asset.width;
  return <Img src={asset.src} style={{ ...common, left: x - width / 2, top: y - height / 2, width, height, transform: `translate(${m.dx}px, ${m.dy}px) scale(${m.scale}) ${motion} ${turned(turn)}` }} />;
};

// Frame-by-frame animation from a sprite sheet: the sheet slides behind a one-frame window.
const Sprite = ({ layer, props, x, y, frame, turn }: { layer: SequenceLayer; props: FootageEditProps; x: number; y: number; frame: number; turn: Turn }) => {
  const sheet = props.assets[layer.asset];
  const p = phase(layer, frame);
  if (!sheet || !p.on) return null;
  const m = motionStyle(layer.enter, layer.exit, p.enter, p.exit);
  const step = Math.floor((p.local * layer.fps) / props.plan.fps);
  const index = layer.loop ? step % layer.count : Math.min(step, layer.count - 1);
  const width = layer.size * props.plan.width, height = (width * sheet.height * layer.count) / sheet.width;
  const motion = layer.motion === 'bob' ? `translateY(${(Math.sin(p.local / 9) * 10).toFixed(2)}px)` : layer.motion === 'sway' ? `rotate(${(Math.sin(p.local / 16) * 4).toFixed(2)}deg)` : '';
  return (
    <div style={{ position: 'absolute', left: x - width / 2, top: y - height / 2, width, height, overflow: 'hidden', opacity: m.opacity * layer.opacity,
      transform: `translate(${m.dx}px, ${m.dy}px) scale(${m.scale}) ${motion} ${turned(turn)}` }}>
      <Img src={sheet.src} style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${layer.count * 100}%`, maxWidth: 'none', transform: `translateX(${(-100 * index) / layer.count}%)` }} />
    </div>
  );
};

export const FootageEdit = (props: FootageEditProps) => {
  const frame = useCurrentFrame();
  const { spec, plan } = props;
  const base = baseScale(props);
  const cam = cameraAt(props, frame, base, (seed) => random(seed));
  const rect = footageRect(props, cam, base);
  const at = (layer: Layer & { at?: unknown; offset?: { x: number; y: number } }, fallback: { x: number; y: number }) =>
    layerPoint(props, cam, base, frame, layer as never, fallback);
  const active = (l: Layer) => frame >= l.from && frame < l.to;
  const drawings = spec.layers.map((l, i) => [l, i] as const).filter(([l]) => l.type === 'illustrate' && active(l));
  const boils = spec.layers.some((l) => l.type === 'image' && l.motion === 'boil' && active(l));

  // Depth: one greyscale picture for this frame, laid exactly over the footage (so it follows zooms), turned
  // by colour matrices into masks and maps. A soft edge K wide keeps the cut-outs from looking jagged.
  const depthSrc = useLocalImage(depthSource(props, frame)), near = spec.depth?.near, K = 25;
  const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16) / 255);
  const grey = (row: string) => `${row}  ${row}  ${row}  0 0 0 0 1`;
  const depthImage = (filter: string) => depthSrc ? <image href={depthSrc} x={rect.left} y={rect.top} width={rect.width} height={rect.height} preserveAspectRatio="none" filter={`url(#${filter})`} /> : null;
  const flat = (id: string, values: string) => (
    <filter id={id} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB"><feColorMatrix type="matrix" values={values} /></filter>
  );
  const nearness = spec.layers.map((l, i) => (depthSrc && active(l) ? layerDepth(l as never, frame) : undefined));
  const blurs = depthSrc ? spec.layers.map((l, i) => [l, i] as const).filter(([l]) => l.type === 'blur' && active(l)) as (readonly [BlurLayer, number])[] : [];
  const fogs = depthSrc ? spec.layers.map((l, i) => [l, i] as const).filter(([l]) => l.type === 'fog' && active(l)) as (readonly [FogLayer, number])[] : [];
  const parallax = depthSrc ? spec.layers.find((l): l is ParallaxLayer => l.type === 'parallax' && active(l)) : undefined;
  let shift: { ux: number; uy: number; scale: number } | null = null;
  if (parallax) {
    const e = envelope(parallax, frame), t = (frame - parallax.from) / Math.max(1, parallax.to - parallax.from - 1);
    const u = parallax.move === 'orbit' ? { ux: Math.cos(2 * Math.PI * t), uy: 0.6 * Math.sin(2 * Math.PI * t) }
      : parallax.move === 'tilt' ? { ux: 0, uy: 2 * t - 1 } : { ux: 2 * t - 1, uy: 0 };
    shift = { ux: u.ux * e, uy: u.uy * e, scale: 2 * parallax.amount * plan.width };
  }

  return (
    <AbsoluteFill style={{ background: colour(spec.background, PALETTE.ink), overflow: 'hidden' }}>
      <svg width={0} height={0} style={{ position: 'absolute' }} aria-hidden>
        <defs>
          {drawings.map(([l, i]) => <IllustrationFilter key={i} id={`drawn-${i}`} layer={l as IllustrateLayer} frame={frame} />)}
          {boils ? <BoilFilter id="boil-img" frame={frame} /> : null}
          {/* Hidden where the scene is nearer than the layer: white (shown) where layer depth > scene nearness. */}
          {nearness.map((d, i) => d == null ? null : (
            <g key={`occ-${i}`}>
              {flat(`occf-${i}`, grey(nearRow(near, -K, K * d + 0.5)))}
              <mask id={`occ-${i}`} maskUnits="userSpaceOnUse" x={0} y={0} width={plan.width} height={plan.height}>
                <rect width={plan.width} height={plan.height} fill="#fff" />{depthImage(`occf-${i}`)}
              </mask>
            </g>
          ))}
          {blurs.map(([l, i]) => (
            <g key={`blur-${i}`}>
              {flat(`blurf-${i}`, grey(nearRow(near, -K, K * (l.focus - l.range) + 0.5)))}
              <mask id={`blur-${i}`} maskUnits="userSpaceOnUse" x={0} y={0} width={plan.width} height={plan.height}>{depthImage(`blurf-${i}`)}</mask>
              {flat(`blurn-f-${i}`, grey(nearRow(near, K, -K * (l.focus + l.range) + 0.5)))}
              <mask id={`blurn-${i}`} maskUnits="userSpaceOnUse" x={0} y={0} width={plan.width} height={plan.height}>{depthImage(`blurn-f-${i}`)}</mask>
            </g>
          ))}
          {fogs.map(([l, i]) => {
            const [r, g, b] = hex(colour(l.color, PALETTE.paper)), s = l.strength * envelope(l, frame), st = Math.max(0.01, l.start);
            return <g key={`fog-${i}`}>{flat(`fogf-${i}`, `0 0 0 0 ${r}  0 0 0 0 ${g}  0 0 0 0 ${b}  ${nearRow(near, -s / st, s)}`)}</g>;
          })}
          {shift ? (
            <filter id="parallax" x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
              <feImage href={depthSrc!} x={rect.left} y={rect.top} width={rect.width} height={rect.height} preserveAspectRatio="none" result="depth" />
              <feColorMatrix in="depth" type="matrix" result="map"
                values={`${nearRow(near, shift.ux, 0.5 - 0.5 * shift.ux)}  ${nearRow(near, shift.uy, 0.5 - 0.5 * shift.uy)}  0 0 0 0 0  0 0 0 0 1`} />
              <feDisplacementMap in="SourceGraphic" in2="map" scale={shift.scale} xChannelSelector="R" yChannelSelector="G" />
            </filter>
          ) : null}
        </defs>
      </svg>
      <AbsoluteFill style={shift ? { filter: 'url(#parallax)', transform: `scale(${1 + shift.scale / plan.width})` } : undefined}>
        <Footage props={props} rect={rect} muted={spec.audio === 'mute'} />
        {/* Drawings replace the footage, so they sit right over it and under everything else, whatever their
            place in the list. The filter works on a screen-sized layer: a zoomed-in picture costs no more. */}
        {drawings.map(([l, i]) => (
          <Footage key={`drawn-${i}`} props={props} rect={rect} muted style={{ filter: `url(#drawn-${i})`, ...reveal(l as IllustrateLayer, frame, at(l, { x: 0.5, y: 0.5 }), plan.width, plan.height) }} />
        ))}
        {/* Depth of field: blurred copies of the footage, shown only where it is out of focus. */}
        {blurs.map(([l, i]) => {
          const px = l.amount * envelope(l, frame);
          return (
            <AbsoluteFill key={`blur-${i}`}>
              <Footage props={props} rect={rect} muted style={{ filter: `blur(${px.toFixed(2)}px)`, mask: `url(#blur-${i})` }} />
              {l.near ? <Footage props={props} rect={rect} muted style={{ filter: `blur(${(px * 0.7).toFixed(2)}px)`, mask: `url(#blurn-${i})` }} /> : null}
            </AbsoluteFill>
          );
        })}
        {fogs.map(([, i]) => (
          <svg key={`fog-${i}`} width={plan.width} height={plan.height} style={{ position: 'absolute', left: 0, top: 0 }}>{depthImage(`fogf-${i}`)}</svg>
        ))}
      </AbsoluteFill>
      {spec.layers.map((l, i) => {
        if (!active(l)) return null;
        const node = drawLayer(l, i);
        // A layer with a depth is cut away wherever the scene is nearer.
        return node && nearness[i] != null ? <AbsoluteFill key={i} style={{ mask: `url(#occ-${i})` }}>{node}</AbsoluteFill> : node;
      })}
    </AbsoluteFill>
  );

  function drawLayer(l: Layer, i: number) {
        switch (l.type) {
          case 'text': {
            const p = at(l, DEFAULT_AT[l.style]);
            const anchor = typeof l.at === 'string' ? screenPlace(props, cam, base, frame, l.at, undefined, { x: 0.5, y: 0.5 }) : null;
            return <TextBox key={i} layer={l} x={p.x} y={p.y} anchor={anchor} frame={frame} width={plan.width} />;
          }
          case 'sticker': {
            const p = at(l, { x: 0.5, y: 0.5 });
            return <Sticker key={i} uid={`sticker-${i}`} layer={l} x={p.x} y={p.y} frame={frame} />;
          }
          case 'image': {
            const p = at(l, { x: 0.5, y: 0.5 });
            return <Picture key={i} layer={l} props={props} rect={rect} x={p.x} y={p.y} frame={frame} boilId="boil-img" turn={heading(props, cam, base, frame, l)} />;
          }
          case 'graphic': {
            const p = at(l, { x: 0.5, y: 0.5 });
            return <GraphicView key={i} layer={l} x={p.x} y={p.y} frame={frame} turn={turned(heading(props, cam, base, frame, l))} />;
          }
          case 'sequence': {
            const p = at(l, { x: 0.5, y: 0.5 });
            return <Sprite key={i} layer={l} props={props} x={p.x} y={p.y} frame={frame} turn={heading(props, cam, base, frame, l)} />;
          }
          case 'flash': {
            // Full strength two frames in, gone by the end of the layer.
            const t = frame - l.from, len = l.to - l.from;
            const o = t < 2 ? (t + 1) / 3 : 1 - Easing.out(Easing.quad)(Math.min(1, (t - 2) / Math.max(1, len - 2)));
            return <AbsoluteFill key={i} style={{ background: colour(l.color, PALETTE.white), opacity: o }} />;
          }
          default:
            return null; // drawings and depth effects are above; zoom and shake move the camera
        }
  }
};

// Shown in the Studio, where there is no uploaded footage.
export const emptyEdit: FootageEditProps = {
  spec: { format: 'vertical', fit: 'cover', background: 'ink', audio: 'source', anchors: {}, layers: [
    { type: 'text', from: 0, to: 90, in: 10, out: 10, text: 'Upload footage on\nthe dashboard', style: 'title', pointer: false, align: 'center', enter: 'rise', exit: 'fade' },
    { type: 'sticker', from: 10, to: 90, in: 12, out: 8, shape: 'sparkles', at: { x: 0.5, y: 0.5 }, size: 320, color: 'lime', rotate: 0, enter: 'pop', exit: 'fade' },
  ] },
  plan: { width: 1080, height: 1920, fps: 30, durationInFrames: 90, segments: [{ from: 0, to: 90, source: 0, sourceTo: 90, speed: 1 }] },
  video: '', assets: {}, source: { width: 1080, height: 1920, frames: 90 },
};
