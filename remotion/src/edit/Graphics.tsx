// Graphics ChatGPT defines itself: SVG shapes in the graphic's own coordinates, each with keyframed
// position, rotation (around a pivot), scale, opacity and stroke draw-on, optionally copied into a
// staggered row of particles. It is data, never code, so it can only draw what these shapes can.
import type { CSSProperties, ReactNode } from 'react';
import { Easing } from 'remotion';
import type { GraphicElement, GraphicLayer, Track } from './model';
import { PALETTE, colour, motionStyle, phase } from './model';

const EASE = { linear: (t: number) => t, smooth: Easing.inOut(Easing.cubic), in: Easing.in(Easing.cubic), out: Easing.out(Easing.cubic), back: Easing.out(Easing.back(1.7)), bounce: Easing.bounce };

// A property's value at a frame: eased between keys, held before the first and after the last.
function valueAt(track: Track | undefined, frame: number, fallback: number, ease: (t: number) => number) {
  if (!track?.length) return fallback;
  if (frame <= track[0].frame) return track[0].value;
  const last = track[track.length - 1];
  if (frame >= last.frame) return last.value;
  const i = track.findIndex((k, n) => frame >= k.frame && frame < track[n + 1].frame);
  const a = track[i], b = track[i + 1];
  return a.value + (b.value - a.value) * ease((frame - a.frame) / (b.frame - a.frame));
}

const FONTS = { serif: '"Cormorant Garamond", Georgia, serif', script: '"Great Vibes", cursive' };

function drawShape(el: GraphicElement, draw: number, key: string): ReactNode {
  const paint = {
    fill: el.fill === 'none' ? 'none' : colour(el.fill, el.shape === 'line' ? 'none' : PALETTE.paper),
    stroke: el.stroke ? colour(el.stroke, PALETTE.ink) : undefined,
    strokeWidth: el.strokeWidth, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
    // Draw-on works on any outline: the stroke is dashed to its own length and uncovered as `draw` grows.
    ...(draw < 1 ? { pathLength: 1, strokeDasharray: '1 1', strokeDashoffset: 1 - Math.max(0, draw) } : {}),
  };
  switch (el.shape) {
    case 'path': return <path key={key} d={el.d} {...paint} />;
    case 'circle': return <circle key={key} cx={el.cx ?? 0} cy={el.cy ?? 0} r={Math.max(0, el.r ?? 0)} {...paint} />;
    case 'ellipse': return <ellipse key={key} cx={el.cx ?? 0} cy={el.cy ?? 0} rx={Math.max(0, el.rx ?? 0)} ry={Math.max(0, el.ry ?? 0)} {...paint} />;
    case 'rect': return <rect key={key} x={el.x ?? 0} y={el.y ?? 0} width={Math.max(0, el.width ?? 0)} height={Math.max(0, el.height ?? 0)} rx={el.rx} {...paint} />;
    case 'line': return <line key={key} x1={el.x ?? 0} y1={el.y ?? 0} x2={el.x2 ?? 0} y2={el.y2 ?? 0} {...paint} stroke={paint.stroke ?? PALETTE.ink} />;
    case 'text': return (
      <text key={key} x={el.x ?? 0} y={el.y ?? 0} fontFamily={FONTS[el.font ?? 'serif']} fontWeight={el.font === 'script' ? 400 : 700}
        fontSize={el.fontSize ?? 12} textAnchor={el.anchor ?? 'start'} {...paint} fill={el.fill === 'none' ? 'none' : colour(el.fill, PALETTE.ink)}>{el.text}</text>
    );
    default: return null;
  }
}

export const GraphicView = ({ layer, x, y, frame, turn }: { layer: GraphicLayer; x: number; y: number; frame: number; turn: string }) => {
  const p = phase(layer, frame);
  if (!p.on || !layer.elements?.length) return null;
  const m = motionStyle(layer.enter, layer.exit, p.enter, p.exit);
  const vw = layer.viewBox?.width ?? 100, vh = layer.viewBox?.height ?? 100;
  const width = layer.size, height = (layer.size * vh) / vw;
  const shapes: ReactNode[] = [];
  layer.elements.forEach((el, i) => {
    const ease = EASE[el.ease ?? 'smooth'] ?? EASE.smooth;
    const copies = el.repeat?.count ?? 1;
    for (let c = 0; c < copies; c++) {
      let t = p.local - c * (el.repeat?.delay ?? 0);
      if (t < 0 && el.repeat) continue; // a delayed copy has not started yet
      if (layer.loop) t = ((t % layer.loop) + layer.loop) % layer.loop;
      const k = el.keys ?? {};
      const v = (track: keyof NonNullable<GraphicElement['keys']>, fallback: number) => valueAt(k[track], t, fallback, ease);
      const ox = el.origin?.x ?? 0, oy = el.origin?.y ?? 0;
      const s = v('scale', 1) * (el.repeat ? el.repeat.scale ** c : 1);
      const dx = v('x', 0) + c * (el.repeat?.dx ?? 0), dy = v('y', 0) + c * (el.repeat?.dy ?? 0);
      const rot = v('rotate', 0) + c * (el.repeat?.rotate ?? 0);
      const transform = `translate(${dx} ${dy}) translate(${ox} ${oy}) rotate(${rot}) scale(${s * v('scaleX', 1)} ${s * v('scaleY', 1)}) translate(${-ox} ${-oy})`;
      const opacity = Math.max(0, Math.min(1, v('opacity', 1))) * (el.opacity ?? 1);
      shapes.push(<g key={`${i}-${c}`} transform={transform} opacity={opacity}>{drawShape(el, v('draw', 1), `${i}-${c}-s`)}</g>);
    }
  });
  const style: CSSProperties = { position: 'absolute', left: x - width / 2, top: y - height / 2, overflow: 'visible', opacity: m.opacity * layer.opacity,
    transform: `translate(${m.dx}px, ${m.dy}px) scale(${m.scale}) ${turn}` };
  return <svg viewBox={`0 0 ${vw} ${vh}`} width={width} height={height} style={style}>{shapes}</svg>;
};
