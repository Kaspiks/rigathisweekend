// Hand-drawn stickers, animated by frame: steam that keeps rising, sparkles that twinkle, a circle or
// arrow that draws itself on. Each is drawn in a 100×100 box and scaled to the sticker's size.
import type { ReactNode } from 'react';
import { Easing } from 'remotion';
import type { StickerLayer } from './model';
import { PALETTE, colour, motionStyle, phase } from './model';

const TAU = Math.PI * 2;
const DRAWN = new Set(['circle', 'arrow', 'underline', 'squiggle']);
// Where the point `at` sits inside the 100×100 box. An arrow's tip lands on the point, so it points at it.
const PIN: Record<string, [number, number]> = { arrow: [88, 46] };

const fourPoint = 'M0,-10 C1,-2 2,-1 10,0 C2,1 1,2 0,10 C-1,2 -2,1 -10,0 C-2,-1 -1,-2 0,-10 Z';
const fivePoint = Array.from({ length: 10 }, (_, i) => {
  const r = i % 2 ? 4.2 : 10, a = (i * Math.PI) / 5 - Math.PI / 2;
  return `${i ? 'L' : 'M'}${(Math.cos(a) * r).toFixed(2)},${(Math.sin(a) * r).toFixed(2)}`;
}).join(' ') + ' Z';
const heart = 'M0,6 C-12,-4 -8,-14 0,-7 C8,-14 12,-4 0,6 Z';

// A stroke that draws itself on as `p` goes 0 → 1.
const Drawn = ({ d, p, color, width }: { d: string; p: number; color: string; width: number }) => (
  <path d={d} pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - p} fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" />
);

function shape(layer: StickerLayer, t: number, draw: number, color: string, uid: string): ReactNode {
  const outline = PALETTE.ink;
  switch (layer.shape) {
    case 'sparkles':
      return [[30, 34, 1], [72, 24, 0.7], [64, 70, 0.85], [22, 74, 0.6], [50, 52, 0.45]].map(([x, y, s], i) => {
        const k = s * (0.55 + 0.45 * (0.5 + 0.5 * Math.sin(TAU * (t / 22 + i * 0.23))));
        return <path key={i} d={fourPoint} transform={`translate(${x} ${y}) rotate(${(t * 1.5 + i * 40) % 360}) scale(${(k * 2.4).toFixed(3)})`} fill={color} stroke={outline} strokeOpacity={0.35} strokeWidth={0.8} />;
      });
    case 'stars':
      return [[28, 40, 1], [70, 30, 0.8], [56, 72, 0.65]].map(([x, y, s], i) => (
        <path key={i} d={fivePoint} transform={`translate(${x} ${y + 3 * Math.sin(TAU * (t / 40 + i / 3))}) rotate(${Math.sin(TAU * (t / 60 + i / 5)) * 18}) scale(${(s * 1.5).toFixed(3)})`} fill={color} stroke={outline} strokeOpacity={0.4} strokeWidth={0.8} />
      ));
    case 'steam':
      return [0, 1, 2].map((i) => {
        const x0 = 30 + i * 20, pts: string[] = [];
        for (let y = 96; y >= 4; y -= 4) pts.push(`${(x0 + 6 * Math.sin(y / 13 + t / 7 + i * 1.7) * (1 - y / 140)).toFixed(2)},${y}`);
        // A faint dark edge under each wisp keeps white steam visible over milk foam or a pale cup.
        const wisp = { points: pts.join(' '), fill: 'none', strokeLinecap: 'round' as const, strokeDasharray: '34 22', strokeDashoffset: -(t * 1.6 + i * 19), mask: `url(#${uid}-fade)` };
        return (<g key={i}>
          <polyline {...wisp} stroke={outline} strokeOpacity={0.3} strokeWidth={11} />
          <polyline {...wisp} stroke={color} strokeWidth={7.5} />
        </g>);
      });
    case 'hearts':
      return [0, 1, 2].map((i) => {
        const p = ((t + i * 17) % 50) / 50, x = 26 + i * 24 + 6 * Math.sin(p * TAU);
        return <path key={i} d={heart} transform={`translate(${x.toFixed(2)} ${(88 - 76 * p).toFixed(2)}) scale(${(1 + 0.6 * p).toFixed(3)})`} fill={color} stroke={outline} strokeOpacity={0.35} strokeWidth={0.8} opacity={Math.sin(p * Math.PI)} />;
      });
    case 'circle':
      return <Drawn d="M82,36 C92,62 64,90 38,85 C12,80 5,52 18,31 C31,11 66,7 80,24 C86,31 88,38 83,46" p={draw} color={color} width={4.5} />;
    case 'arrow':
      return (<>
        <Drawn d="M6,64 C28,18 58,20 86,45" p={Math.min(1, draw * 1.25)} color={color} width={5} />
        <Drawn d="M70,33 L88,46 L72,59" p={Math.max(0, draw * 5 - 4)} color={color} width={5} />
      </>);
    case 'underline':
      return <Drawn d="M6,62 C26,52 40,68 58,58 S86,52 94,57" p={draw} color={color} width={6} />;
    case 'squiggle':
      return <Drawn d="M4,50 q8,-16 16,0 t16,0 t16,0 t16,0 t16,0 t16,0" p={draw} color={color} width={5} />;
    case 'burst': {
      // One burst at the start: the lines shoot out and are gone within a second.
      const out = Easing.out(Easing.cubic)(Math.min(1, t / 10)), gone = Easing.in(Easing.cubic)(Math.min(1, Math.max(0, (t - 4) / 12)));
      return Array.from({ length: 12 }, (_, i) => {
        const a = (i / 12) * TAU + (i % 2) * 0.12, r1 = 16 + 32 * out, r0 = 16 + 30 * gone;
        if (r1 - r0 < 0.5) return null;
        return <line key={i} x1={50 + Math.cos(a) * r0} y1={50 + Math.sin(a) * r0} x2={50 + Math.cos(a) * r1} y2={50 + Math.sin(a) * r1} stroke={color} strokeWidth={i % 2 ? 3 : 5} strokeLinecap="round" />;
      });
    }
    case 'pulse':
      return [0, 15].map((o) => {
        const p = ((t + o) % 30) / 30;
        return <circle key={o} cx={50} cy={50} r={8 + 40 * Easing.out(Easing.quad)(p)} fill="none" stroke={color} strokeWidth={4 * (1 - p) + 1} opacity={1 - p} />;
      });
    default:
      return null;
  }
}

export const Sticker = ({ layer, x, y, frame, uid }: { layer: StickerLayer; x: number; y: number; frame: number; uid: string }) => {
  const p = phase(layer, frame);
  if (!p.on) return null;
  const drawn = DRAWN.has(layer.shape) && layer.enter === 'draw';
  const m = motionStyle(drawn ? 'draw' : layer.enter === 'draw' ? 'pop' : layer.enter, layer.exit, p.enter, p.exit);
  const color = colour(layer.color, PALETTE.lime);
  const [px, py] = PIN[layer.shape] ?? [50, 50];
  const size = layer.size;
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} style={{
      position: 'absolute', left: x - (px / 100) * size, top: y - (py / 100) * size, overflow: 'visible', opacity: m.opacity,
      transformOrigin: `${px}% ${py}%`, transform: `translate(${m.dx}px, ${m.dy}px) rotate(${layer.rotate}deg) scale(${m.scale})`,
      filter: 'drop-shadow(0 3px 6px rgba(0,0,0,0.35))',
    }}>
      <defs>
        <linearGradient id={`${uid}-grad`} x1="0" y1="1" x2="0" y2="0"><stop offset="0" stopColor="#fff" /><stop offset="0.6" stopColor="#fff" stopOpacity={0.7} /><stop offset="1" stopColor="#fff" stopOpacity={0} /></linearGradient>
        <mask id={`${uid}-fade`} maskUnits="userSpaceOnUse" x={-20} y={-20} width={140} height={140}><rect x={-20} y={-20} width={140} height={140} fill={`url(#${uid}-grad)`} /></mask>
      </defs>
      {shape(layer, p.local, drawn ? Easing.inOut(Easing.cubic)(p.enter) : 1, color, uid)}
    </svg>
  );
};
