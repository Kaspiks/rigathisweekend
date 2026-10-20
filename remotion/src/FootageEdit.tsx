// An animated edit over your own footage, rendered from the JSON edit the app has checked (src/edits.js).
// The clip plays through its timeline (cuts, freezes, speed changes) under a camera that can zoom towards
// or follow an anchor; layers are drawn over it in order: text, stickers, pictures, flashes, and moments
// where the footage itself is redrawn as a drawing.
import '@fontsource/cormorant-garamond/500.css';
import '@fontsource/cormorant-garamond/600.css';
import '@fontsource/cormorant-garamond/700.css';
import '@fontsource/great-vibes/400.css';
import '@fontsource/inter/800.css';
import '@fontsource/bebas-neue/400.css';
import '@fontsource/jetbrains-mono/700.css';
import type { CSSProperties } from 'react';
import { AbsoluteFill, Audio, Easing, Freeze, Img, OffthreadVideo, Sequence, continueRender, delayRender, random, useCurrentFrame } from 'remotion';
import { BoilFilter, FinishFilter, GradeFilter, IllustrationFilter, SoftenFilter, finishes } from './edit/filters';
import type { Asset, BlurLayer, Camera, Enter, FinishLayer, FogLayer, FootageEditProps, GradeLayer, IllustrateLayer, ImageLayer, Layer, ParallaxLayer, Segment, SequenceLayer } from './edit/model';
import { PALETTE, baseScale, blendMode, glowFilter, cameraAt, colour, cueVolume, depthSource, sourceVolumeAt, envelope, footageRect, heading, layerDepth, layerPoint, motionStyle, nearRow, phase, reframeSpeed, reframed, screenPlace, sourceAt, travel, walked, worldAt, clipRect } from './edit/model';
import { ModelView } from './edit/Model3D';
import { ParticlesView } from './edit/Particles';
import { depthNear, useLocalImage } from './edit/depth';
import { GraphicView } from './edit/Graphics';
import { Sticker } from './edit/Stickers';
import { DEFAULT_AT, TextBox } from './edit/Texts';

const fonts = delayRender('Loading edit fonts');
Promise.all([
  document.fonts.load('700 60px "Cormorant Garamond"'),
  document.fonts.load('600 60px "Cormorant Garamond"'),
  document.fonts.load('60px "Great Vibes"'),
  document.fonts.load('800 60px "Inter"'),
  document.fonts.load('60px "Bebas Neue"'),
  document.fonts.load('700 60px "JetBrains Mono"'),
]).then(() => continueRender(fonts));

type Rect = { left: number; top: number; width: number; height: number };

// Slow motion without the judder. At speed 0.4 a source frame would otherwise be shown two or three
// output frames running, which reads as a stutter rather than as slowness - the thing that gives away a
// clip simply played slower. Instead every output frame is mixed from the two source frames it falls
// between: the frame itself where it lands on one, and a cross-fade of the pair where it lands between
// them. That is two frame grabs instead of one, so it is only done on shots that asked for it.
//
// Both copies are frozen: OffthreadVideo pulls one exact frame out of the file, and `trimBefore` chooses
// which. The second is laid over the first at the fraction, so what comes out is a·(1−mix) + b·mix.
const Blended = ({ src, seg, style }: { src: string; seg: Segment; style: CSSProperties }) => {
  const local = useCurrentFrame(); // inside the Sequence, so 0 on the segment's first frame
  const last = (seg.sourceTo ?? seg.source + 1) - 1;
  const exact = Math.min(last, seg.source + local * (seg.speed ?? 1));
  const a = Math.floor(exact), mix = exact - a, b = Math.min(last, a + 1);
  const over = mix * ((style.opacity as number) ?? 1); // a dissolve on this shot still fades the pair
  return (
    <>
      <Freeze frame={0}><OffthreadVideo src={src} trimBefore={a || undefined} muted style={style} /></Freeze>
      {mix > 0.02 && b > a ? <Freeze frame={0}><OffthreadVideo src={src} trimBefore={b} muted style={{ ...style, opacity: over }} /></Freeze> : null}
    </>
  );
};

// The clip through its timeline. Rendered once as the picture and again, muted, under each drawing layer.
const Footage = ({ props, rect, cam, muted, style, gradeFor }: { props: FootageEditProps; rect: Rect; cam: Camera; muted: boolean; style?: CSSProperties; gradeFor?: (clip?: string) => readonly [unknown, number] | null }) => {
  const now = useCurrentFrame();
  const own = props.video;
  const segments = props.plan.segments.filter((s) => (s.clip ? props.videos?.[s.clip] : own));
  if (!segments.length) return null;
  // A cut from another clip brings its own shape, so it gets its own rectangle: a portrait phone clip and
  // a landscape one should each fill the frame the way the edit's fit says, not be squeezed into a shape
  // borrowed from whichever clip the edit happens to belong to.
  // A shot arriving over the one before it. Later segments are drawn last, so the incoming shot is
  // already on top: a dissolve only needs its opacity, a wipe an inset that opens, and a slide a
  // translate. A push also drags the outgoing shot along, which is why a segment looks at whether the
  // NEXT one is pushing it out.
  const ease = (t: number) => t * t * (3 - 2 * t);
  const arriving = (s: (typeof segments)[number]) => (s.enter ? Math.max(0, Math.min(1, (now - s.from + 1) / s.enter.frames)) : 1);
  const leaving = (i: number) => {
    const next = segments[i + 1];
    return next?.enter?.kind === 'push' && now >= next.from ? { t: ease(arriving(next)), from: next.enter.from } : null;
  };
  // `d` is where a shot coming in from that side waits before it arrives. The incoming shot travels d→0
  // as the transition runs; a shot being PUSHED travels 0→−d, the opposite way, so the two always cover
  // the frame between them and no gap opens up behind either of them.
  const offscreen = (from: Enter['from'], w: number, h: number) =>
    (from === 'left' ? [-w, 0] : from === 'right' ? [w, 0] : from === 'up' ? [0, -h] : [0, h]);
  const shove = (k: number, from: Enter['from'], w: number, h: number) => {
    const d = offscreen(from, w, h);
    return `translate(${(d[0] * k).toFixed(1)}px, ${(d[1] * k).toFixed(1)}px)`;
  };
  const box = (s: (typeof segments)[number], i: number) => {
    const v = s.clip ? props.videos![s.clip] : null;
    const r0 = v ? clipRect(props, cam, v) : rect;
    // The shot's own framing. `shot` is the OUTPUT span of the whole shot, which for a speed ramp covers
    // all ten of the segments it became - so a punch-in eases across the shot rather than starting again
    // on each step of the staircase.
    const span = s.shot ? Math.max(1, s.shot[1] - s.shot[0] - 1) : 1;
    const t = s.shot ? (now - s.shot[0]) / span : 0;
    const r = s.reframe ? reframed(props.plan, r0, s.reframe, t, cam.dx, cam.dy) : r0;
    // Motion blur from how far the picture actually moved since the frame before, rather than from how
    // fast it was asked to move: it then covers an ease in and out on its own. Roughly half the
    // displacement, which is about what a 180° shutter leaves. An even blur, not a radial one, so it is
    // capped low enough to read as a smear rather than as a soft frame.
    const px = s.reframe?.blur ? Math.min(20, s.reframe.blur * reframeSpeed(props.plan, r0, s.reframe, t, 1 / span) * 0.5) : 0;
    const g = gradeFor?.(s.clip);
    const effects = [g ? `url(#grade-${g[1]})` : '', px > 0.25 ? `blur(${px.toFixed(2)}px)` : ''].filter(Boolean).join(' ');
    // A mirrored shot flips about its own centre, so it stays exactly where it was, facing the other way.
    const flip = s.mirror ? 'scaleX(-1)' : '';
    const both = (move: string) => ({ transform: flip ? `${move} ${flip}` : move });
    const base = { position: 'absolute' as const, left: r.left, top: r.top, width: r.width, height: r.height, objectFit: 'fill' as const, maxWidth: 'none',
      ...(effects ? { filter: effects } : {}) };
    const out = leaving(i);
    if (out) return { ...base, ...both(shove(-out.t, out.from, props.plan.width, props.plan.height)) };
    if (!s.enter) return flip ? { ...base, transform: flip } : base;
    const t2 = ease(arriving(s));
    if (s.enter.kind === 'dissolve') return { ...base, opacity: t2, ...(flip ? { transform: flip } : {}) };
    if (s.enter.kind === 'wipe') {
      // An inset that opens from the side it comes in on, so the new shot is uncovered rather than moved.
      const gone = `${((1 - t2) * 100).toFixed(2)}%`;
      const inset = s.enter.from === 'left' ? `0 ${gone} 0 0` : s.enter.from === 'right' ? `0 0 0 ${gone}`
        : s.enter.from === 'up' ? `0 0 ${gone} 0` : `${gone} 0 0 0`;
      return { ...base, clipPath: `inset(${inset})`, ...(flip ? { transform: flip } : {}) };
    }
    return { ...base, ...both(shove(1 - t2, s.enter.from, props.plan.width, props.plan.height)) };
  };
  return (
    <AbsoluteFill style={{ overflow: 'hidden', ...style }}>
      {segments.map((s, i) => {
        const src = s.clip ? props.videos![s.clip].src : own;
        return (
          <Sequence key={i} from={s.from} durationInFrames={s.to - s.from} layout="none">
            {s.hold
              // Remotion keeps a video's frame inside its sequence, so a freeze stops at the sequence's first
              // frame and the trim picks the source frame to show.
              ? <Freeze frame={0}><OffthreadVideo src={src} trimBefore={s.source || undefined} muted style={box(s, i)} /></Freeze>
              : s.smooth ? <Blended src={src} seg={s} style={box(s, i)} />
                : <OffthreadVideo src={src} trimBefore={s.source || undefined} playbackRate={s.speed ?? 1} muted={muted || (s.speed ?? 1) !== 1} style={box(s, i)}
                  volume={muted ? undefined : (f) => sourceVolumeAt(props.spec, s.from + f)} />}
          </Sequence>
        );
      })}
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
  const tint = layer.tint ? colour(layer.tint, PALETTE.paper) : null;
  const filter = [layer.motion === 'boil' ? `url(#${boilId})` : null, glowFilter(layer.glow, tint ?? undefined)].filter(Boolean).join(' ') || undefined;
  const common: CSSProperties = { position: 'absolute', opacity: m.opacity * layer.opacity, filter, mixBlendMode: blendMode(layer.blend), ...wipe };
  const draw = (style: CSSProperties) => tint ? <Tinted src={asset.src} colour={tint} style={style} /> : <Img src={asset.src} style={style} />;
  if (layer.place === 'footage')
    return draw({ ...common, left: rect.left, top: rect.top, width: rect.width, height: rect.height, objectFit: 'cover', transform: `scale(${m.scale}) ${motion}` });
  const width = layer.size * props.plan.width, height = (width * asset.height) / asset.width;
  return draw({ ...common, left: x - width / 2, top: y - height / 2, width, height, transform: `translate(${m.dx}px, ${m.dy}px) scale(${m.scale}) ${motion} ${turned(turn)}` });
};

// A picture recoloured in one colour, keeping its shape: the colour is painted through the picture as a
// mask. The hidden copy makes Remotion wait until the picture has loaded.
const Tinted = ({ src, colour: c, style, inner }: { src: string; colour: string; style: CSSProperties; inner?: CSSProperties }) => (
  <div style={{ ...style, overflow: inner ? 'hidden' : style.overflow }}>
    <Img src={src} style={{ display: 'none' }} />
    <div style={{ position: 'absolute', inset: 0, ...inner, backgroundColor: c, WebkitMaskImage: `url("${src}")`, maskImage: `url("${src}")`, WebkitMaskSize: '100% 100%', maskSize: '100% 100%' }} />
  </div>
);

// Which frame of a sheet shows at a point in the layer: a range of it, looped, played once, or back and forth.
export function sheetFrame(layer: SequenceLayer, local: number, fps: number) {
  const first = layer.range?.from ?? 0, last = layer.range?.to ?? layer.count - 1, n = Math.max(1, last - first + 1);
  const step = Math.floor((local * layer.fps) / fps);
  const mode = layer.playback ?? (layer.loop ? 'loop' : 'once');
  if (mode === 'once') return first + Math.min(step, n - 1);
  if (mode === 'pingpong' && n > 1) { const s = step % (2 * n - 2); return first + (s < n ? s : 2 * n - 2 - s); }
  return first + (step % n);
}

// Frame-by-frame animation from a sprite sheet, in one row or a grid: the sheet slides behind a window.
const Sprite = ({ layer, props, x, y, frame, turn }: { layer: SequenceLayer; props: FootageEditProps; x: number; y: number; frame: number; turn: Turn }) => {
  const sheet: Asset | undefined = props.assets[layer.asset];
  const p = phase(layer, frame);
  if (!sheet || !p.on) return null;
  const m = motionStyle(layer.enter, layer.exit, p.enter, p.exit);
  const index = sheetFrame(layer, p.local, props.plan.fps);
  const cols = layer.columns ?? layer.count, rows = Math.ceil(layer.count / cols), col = index % cols, row = Math.floor(index / cols);
  const width = layer.size * props.plan.width, height = (width * (sheet.height / rows)) / (sheet.width / cols);
  const motion = layer.motion === 'bob' ? `translateY(${(Math.sin(p.local / 9) * 10).toFixed(2)}px)` : layer.motion === 'sway' ? `rotate(${(Math.sin(p.local / 16) * 4).toFixed(2)}deg)` : '';
  const angle = (layer.rotate ?? 0) + ((layer.spin ?? 0) * p.local) / props.plan.fps;
  const tint = layer.tint ? colour(layer.tint, PALETTE.paper) : null;
  const outer: CSSProperties = { position: 'absolute', left: x - width / 2, top: y - height / 2, width, height, overflow: 'hidden', opacity: m.opacity * layer.opacity,
    transform: `translate(${m.dx}px, ${m.dy}px) scale(${m.scale}) ${motion} rotate(${angle.toFixed(2)}deg) ${turned(turn)}`, mixBlendMode: blendMode(layer.blend), filter: glowFilter(layer.glow, tint ?? undefined) };
  const inner: CSSProperties = { position: 'absolute', left: 0, top: 0, width: `${cols * 100}%`, height: `${rows * 100}%`, maxWidth: 'none',
    transform: `translate(${(-100 * col) / cols}%, ${(-100 * row) / rows}%)` };
  return tint ? <Tinted src={sheet.src} colour={tint} style={outer} inner={inner} /> : <div style={outer}><Img src={sheet.src} style={inner} /></div>;
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
  // Several grades can be on at once now, as long as they cover different clips: that is how two
  // cameras are matched to each other. A grade naming a clip wins for that clip; one naming none is
  // the fallback for everything else.
  const grades = spec.layers.map((l, i) => [l, i] as const).filter(([l]) => l.type === 'grade' && active(l)) as (readonly [GradeLayer, number])[];
  const gradeFor = (clip?: string) => grades.find(([g]) => g.clip && g.clip === clip) ?? grades.find(([g]) => !g.clip) ?? null;
  // The finishing pass: one shoulder, one glow and one grain over the WHOLE frame, titles included,
  // after everything else is drawn. Two clips graded separately still sit apart while each keeps its own
  // highlight behaviour and its own texture; this is what puts them on the same print.
  const finish = spec.layers.find((l): l is FinishLayer => l.type === 'finish' && active(l));
  const finishAmount = finish ? envelope(finish, frame) : 0;
  const finishing = !!finish && finishes(finish, finishAmount);
  const showing = plan.segments.find((sg) => frame >= sg.from && frame < sg.to) ?? plan.segments[0];
  // Vignette and letterbox belong to the frame, not to one shot, so they come from whatever is grading
  // the picture on screen now.
  const grade = gradeFor(showing?.clip)?.[0] ?? null;
  const boils = spec.layers.some((l) => (l.type === 'image' && l.motion === 'boil' || l.type === 'model' && l.boil) && active(l));

  // Depth: one greyscale picture for this frame, laid exactly over the footage (so it follows zooms), turned
  // by colour matrices into masks and maps. A soft edge K wide keeps the cut-outs from looking jagged.
  const depthSrc = useLocalImage(depthSource(props, frame)), near = spec.depth?.near, K = 25;
  const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16) / 255);
  const grey = (row: string) => `${row}  ${row}  ${row}  0 0 0 0 1`;
  const depthImage = (filter: string) => depthSrc ? <image href={depthSrc} x={rect.left} y={rect.top} width={rect.width} height={rect.height} preserveAspectRatio="none" filter={`url(#${filter})`} /> : null;
  const flat = (id: string, values: string) => (
    <filter id={id} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB"><feColorMatrix type="matrix" values={values} /></filter>
  );
  const depthUrl = depthSource(props, frame);
  const nearness = spec.layers.map((l) => {
    if (!depthSrc || !active(l)) return undefined;
    // depth "auto": the ground under its feet, a little nearer, so the surface it stands on never covers it.
    if (l.type === 'model' && l.depth === 'auto' && !l.path?.some((k) => k.depth != null)) {
      const p = at(l, { x: 0.5, y: 0.5 });
      const g = depthNear(depthUrl, (p.x - rect.left) / rect.width, (p.y - rect.top) / rect.height, near);
      return g == null ? undefined : Math.min(1, g + 0.03);
    }
    return layerDepth(l as never, frame);
  });
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
          {spec.layers.map((l, i) => l.type === 'model' && l.soften > 0
            ? <SoftenFilter key={`sf-${i}`} id={`soften-${i}`} amount={l.soften} frame={frame} /> : null)}
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
          {grades.map(([g, i]) => <GradeFilter key={`grade-${i}`} id={`grade-${i}`} knobs={g.knobs} frame={frame} />)}
          {finishing ? <FinishFilter id="finish" layer={finish!} amount={finishAmount} frame={frame} /> : null}
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
      {/* Everything the finish covers sits inside this one wrapper. It is always here, finish or not, so
          that turning one on never moves a layer: only the filter on it changes. The letterbox bars stay
          outside, because a matte added in post does not carry the print's grain. */}
      <AbsoluteFill style={finishing ? { filter: 'url(#finish)' } : undefined}>
        <AbsoluteFill style={shift ? { filter: 'url(#parallax)', transform: `scale(${1 + shift.scale / plan.width})` } : undefined}>
          <Footage props={props} rect={rect} cam={cam} muted={spec.audio === 'mute'} gradeFor={gradeFor} />
          {/* Drawings replace the footage, so they sit right over it and under everything else, whatever their
              place in the list. The filter works on a screen-sized layer: a zoomed-in picture costs no more. */}
          {drawings.map(([l, i]) => (
            <Footage key={`drawn-${i}`} props={props} rect={rect} cam={cam} muted style={{ filter: `url(#drawn-${i})`, ...reveal(l as IllustrateLayer, frame, at(l, { x: 0.5, y: 0.5 }), plan.width, plan.height) }} />
          ))}
          {/* Depth of field: blurred copies of the footage, shown only where it is out of focus. */}
          {blurs.map(([l, i]) => {
            const px = l.amount * envelope(l, frame);
            return (
              <AbsoluteFill key={`blur-${i}`}>
                <Footage props={props} rect={rect} cam={cam} muted style={{ filter: `blur(${px.toFixed(2)}px)`, mask: `url(#blur-${i})` }} />
                {l.near ? <Footage props={props} rect={rect} cam={cam} muted style={{ filter: `blur(${(px * 0.7).toFixed(2)}px)`, mask: `url(#blurn-${i})` }} /> : null}
              </AbsoluteFill>
            );
          })}
          {fogs.map(([, i]) => (
            <svg key={`fog-${i}`} width={plan.width} height={plan.height} style={{ position: 'absolute', left: 0, top: 0 }}>{depthImage(`fogf-${i}`)}</svg>
          ))}
          {grade && grade.knobs.vignette > 0 ? (
            <AbsoluteFill style={{ background: `radial-gradient(ellipse at 50% 50%, rgba(0,0,0,0) ${Math.round(46 - grade.knobs.vignette * 14)}%, rgba(0,0,0,${(grade.knobs.vignette * 0.72).toFixed(3)}) 100%)` }} />
          ) : null}
        </AbsoluteFill>
        {/* Sound effects and music, each on its own stretch of the timeline. Volume keys count on through
            loops ("extend"), so a swell over a looping sound does not start again every repeat. */}
        {(spec.sounds ?? []).map((c, i) => {
          const src = props.sounds?.[c.file ?? c.sound]?.src;
          return src ? (
            <Sequence key={`sound-${i}`} from={c.at} durationInFrames={c.length} layout="none">
              <Audio src={src} trimBefore={Math.round(c.from * plan.fps) || undefined} playbackRate={c.speed} loop={c.loop} loopVolumeCurveBehavior="extend" volume={(f) => cueVolume(c, f)} />
            </Sequence>
          ) : null;
        })}
        {spec.layers.map((l, i) => {
          if (!active(l)) return null;
          const node = drawLayer(l, i);
          // A layer with a depth is cut away wherever the scene is nearer. Its wrapper is there from the start,
          // before the depth picture has loaded, so the layer is not rebuilt (a 3D view would start over).
          const deep = spec.depth && ((l as { depth?: number }).depth != null || (l as { path?: { depth?: number }[] }).path?.some((k) => k.depth != null));
          return node && deep ? <AbsoluteFill key={i} style={nearness[i] != null ? { mask: `url(#occ-${i})` } : undefined}>{node}</AbsoluteFill> : node;
        })}
        {/* The finish's own vignette darkens the titles too, unlike a grade's, which is under them. */}
        {finish && finish.vignette * finishAmount > 0.002 ? (
          <AbsoluteFill style={{ background: `radial-gradient(ellipse at 50% 50%, rgba(0,0,0,0) ${Math.round(46 - finish.vignette * finishAmount * 14)}%, rgba(0,0,0,${(finish.vignette * finishAmount * 0.72).toFixed(3)}) 100%)` }} />
        ) : null}
      </AbsoluteFill>
      {bars()}
    </AbsoluteFill>
  );

  function bars() {
    if (!grade || grade.bars === 'none') return null;
    // A ratio crops the frame to that shape; a plain number is simply that fraction of the height,
    // which is what a tall video wants - cropping a Reel to 2.39 leaves a strip and little else.
    const h = typeof grade.bars === 'number'
      ? Math.round(plan.height * grade.bars)
      : Math.max(0, Math.round((plan.height - plan.width / Number(grade.bars)) / 2));
    if (!h) return null;
    return (
      <>
        <div style={{ position: 'absolute', left: 0, top: 0, width: plan.width, height: h, background: '#000' }} />
        <div style={{ position: 'absolute', left: 0, top: plan.height - h, width: plan.width, height: h, background: '#000' }} />
      </>
    );
  }

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
          case 'model': {
            const p = at(l, { x: 0.5, y: 0.5 });
            const pose = { x: p.x, y: p.y, frame, ...travel(props, cam, base, frame, l), walked: (f: number) => walked(props, base, l, f, (seed) => random(seed)) };
            // Standing in the room rather than on the screen: the spot now, the spot it started on (which
            // decides which way it faces and how big it is), and where the clip is drawn in the frame.
            const spot = l.world || l.worldPath ? worldAt(props, l, frame) : null;
            const first = spot ? worldAt(props, l, l.from) : null;
            const world = props.track && spot && first
              ? { track: props.track, point: spot, first, rect: footageRect(props, cam, base), source: sourceAt(plan.segments, frame), firstSource: sourceAt(plan.segments, l.from) }
              : null;
            return <ModelView key={i} layer={l} src={props.models?.[l.asset]?.src ?? null} pose={pose} world={world}
              width={plan.width} height={plan.height}
              filter={[l.boil ? 'url(#boil-img)' : null, l.soften > 0 ? `url(#soften-${i})` : null].filter(Boolean).join(' ') || undefined} />;
          }
          case 'particles': {
            const emitter = (f: number) => layerPoint(props, cam, base, f, l as never, { x: 0.5, y: 0.5 });
            return <ParticlesView key={i} uid={`pt${i}`} layer={l} frame={frame} emitter={emitter} width={plan.width} height={plan.height} sheet={l.asset ? props.assets[l.asset] : undefined} />;
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
