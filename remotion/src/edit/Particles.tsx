// Particles: many small copies of a shape or sprite, emitted over time from a point, an area or a moving
// path. Every particle's start, direction, speed, size, spin and colour come from a seeded random number,
// so any frame renders on its own and the same every time: Remotion can render frames in any order.
import type { ReactNode } from 'react';
import { random } from 'remotion';
import type { Asset, ParticlesLayer, Point } from './model';
import { PALETTE, blendMode, colour, glowFilter, phase } from './model';

const FPS = 30;

function shape(kind: NonNullable<ParticlesLayer['shape']>, fill: string, key: string): ReactNode {
  // Drawn in a box from -1 to 1, scaled per particle.
  switch (kind) {
    case 'soft': return <circle key={key} r={1} fill={`url(#soft-${key})`} />;
    case 'spark': return <path key={key} d="M0,-1 L0.14,-0.14 L1,0 L0.14,0.14 L0,1 L-0.14,0.14 L-1,0 L-0.14,-0.14Z" fill={fill} />;
    case 'star': return <path key={key} d="M0,-1 L0.24,-0.32 L0.95,-0.31 L0.38,0.12 L0.59,0.81 L0,0.4 L-0.59,0.81 L-0.38,0.12 L-0.95,-0.31 L-0.24,-0.32Z" fill={fill} />;
    case 'ring': return <circle key={key} r={0.8} fill="none" stroke={fill} strokeWidth={0.3} />;
    case 'streak': return <ellipse key={key} rx={1} ry={0.12} fill={fill} />;
    case 'heart': return <path key={key} d="M0,0.9 C-1.2,0 -1,-1 0,-0.45 C1,-1 1.2,0 0,0.9Z" fill={fill} />;
    case 'confetti': return <rect key={key} x={-1} y={-0.5} width={2} height={1} fill={fill} />;
    case 'square': return <rect key={key} x={-1} y={-1} width={2} height={2} fill={fill} />;
    case 'dot':
    default: return <circle key={key} r={1} fill={fill} />;
  }
}

export const ParticlesView = ({ layer, frame, emitter, width, height, sheet, uid }: {
  layer: ParticlesLayer; frame: number; emitter: (frame: number) => Point; width: number; height: number; sheet?: Asset; uid: string;
}) => {
  const p = phase(layer, frame);
  if (!p.on) return null;
  const local = p.local, colours = (layer.colors?.length ? layer.colors : ['paper']).map((c) => colour(c, PALETTE.paper));
  const gap = layer.rate > 0 ? FPS / layer.rate : Infinity; // frames between two emitted particles
  const nodes: ReactNode[] = [];
  const cols = layer.columns ?? layer.count, rows = Math.ceil(layer.count / cols);
  const fw = sheet ? sheet.width / cols : 1, fh = sheet ? sheet.height / rows : 1;
  // Only the particles that can still be alive: burst ones, and those emitted in the last `life` frames.
  const firstRated = gap === Infinity ? 0 : Math.max(0, Math.floor((local - layer.life) / gap));
  const lastRated = gap === Infinity ? -1 : Math.floor(local / gap);
  const ids: number[] = [];
  if (local < layer.life) for (let k = 0; k < layer.burst; k++) ids.push(k);
  for (let k = firstRated; k <= lastRated; k++) ids.push(layer.burst + k);
  for (const k of ids) {
    const born = k < layer.burst ? 0 : (k - layer.burst) * gap;
    const age = local - born;
    if (age < 0 || age >= layer.life) continue;
    const r = (n: number) => random(`${layer.seed}-${k}-${n}`);
    const origin = emitter(layer.from + Math.floor(born));
    const ax = (r(1) - 0.5) * (layer.area?.width ?? 0) * width, ay = (r(2) - 0.5) * (layer.area?.height ?? 0) * height;
    const angle = ((layer.direction + (r(3) - 0.5) * layer.spread) * Math.PI) / 180;
    const v = layer.speed * width * (0.6 + 0.8 * r(4)), t = age / FPS;
    const travelled = layer.drag > 0 ? (v * (1 - Math.exp(-layer.drag * t))) / layer.drag : v * t;
    const x = origin.x + ax + Math.cos(angle) * travelled;
    const y = origin.y + ay + Math.sin(angle) * travelled + 0.5 * layer.gravity * width * t * t;
    const life = age / layer.life;
    const size = (layer.size * width * (1 - layer.sizeRandom * r(5)) * (1 + (layer.grow - 1) * life)) / 2;
    const fade = layer.fade === 'none' ? 1 : layer.fade === 'out' ? 1 - life : Math.min(1, age / 4, (1 - life) / 0.35);
    // Streaks point along their motion; everything else starts at a random angle and turns.
    const decay = layer.drag > 0 ? Math.exp(-layer.drag * t) : 1;
    const heading = layer.shape === 'streak' ? (Math.atan2(Math.sin(angle) * v * decay + layer.gravity * width * t, Math.cos(angle) * v * decay) * 180) / Math.PI : r(6) * 360;
    const rot = heading + (r(7) - 0.5) * 2 * layer.spin * t;
    const flip = layer.shape === 'confetti' ? Math.cos(t * (4 + r(8) * 8)) : 1; // tumbling paper
    const key = `${uid}:${k}`, ci = Math.floor(r(9) * colours.length) % colours.length;
    if (sheet) {
      const index = Math.floor((age * layer.fps) / FPS) % layer.count, col = index % cols, row = Math.floor(index / cols);
      const w = size * 2, h = (w * fh) / fw;
      nodes.push(
        <g key={key} transform={`translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${rot.toFixed(1)})`} opacity={Math.max(0, fade)}>
          <svg x={-w / 2} y={-h / 2} width={w} height={h} viewBox={`${col * fw} ${row * fh} ${fw} ${fh}`} overflow="hidden">
            <image href={sheet.src} width={sheet.width} height={sheet.height} />
          </svg>
        </g>,
      );
    } else {
      nodes.push(
        <g key={key} transform={`translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${rot.toFixed(1)}) scale(${size.toFixed(2)} ${(size * flip).toFixed(2)})`} opacity={Math.max(0, fade)}>
          {shape(layer.shape ?? 'dot', colours[ci], `${uid}-${ci}`)}
        </g>,
      );
    }
  }
  return (
    <svg width={width} height={height} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', opacity: layer.opacity * (1 - p.exit) * Math.min(1, p.enter * 3 || 1),
      mixBlendMode: blendMode(layer.blend), filter: glowFilter(layer.glow, colours[0]) }}>
      <defs>
        {colours.map((c, i) => (
          <radialGradient key={i} id={`soft-${uid}-${i}`}>
            <stop offset="0%" stopColor={c} stopOpacity={0.9} /><stop offset="100%" stopColor={c} stopOpacity={0} />
          </radialGradient>
        ))}
      </defs>
      {nodes}
    </svg>
  );
};
