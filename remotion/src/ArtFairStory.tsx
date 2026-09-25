// Reel for Art Riga Fair: a brush paints on a canvas, rinses between colours, knocks the rinse cup over,
// and the spilled water spreads across the canvas and develops the poster out of it.
//
// The camera looks straight down at a canvas lying flat, so the spill runs outwards in every direction
// rather than down one edge, and can cover the whole frame. The brush and the cup are 3D objects standing on
// that canvas (the same camera trick as the flask story: the plane z = 0 maps to the screen pixel for pixel,
// so the 3D brush tip meets the flat stroke it is painting).
//
// The water is a few hundred particles, simulated once and looked up by frame, in the same shape as
// leafPhysics and mosaicPhysics. Three forces make a puddle out of them:
//   drag        the canvas slows the water: without it the spill would never stop
//   cohesion    each particle pulls on its neighbours, which is what holds a liquid together
//   pressure    at very close range they push apart instead, so the puddle spreads rather than clumping
// They are drawn as overlapping blobs through a blur-and-sharpen filter, which fuses them into one wet shape
// with a proper edge, and that same shape is the mask the poster is revealed through.
import { useMemo } from 'react';
import { Sfx } from './sfx';
import { AbsoluteFill, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { ThreeCanvas } from '@remotion/three';
import { useLoader, useThree } from '@react-three/fiber';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { useLayoutEffect } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export type ArtFairStoryProps = {
  title: string[];
  when: string;
  time: string;
  venue: string[];
  price: string;
  accent: string;
  ink: string; // the type, printed on the washed paper
  rinse: string; // the water in the cup: every colour mixed, murky but still light enough to read as water
  canvas: string;
  paints: string[]; // one colour per stroke
  holdSeconds: number;
};
export const ARTFAIR_FPS = 30;
const REVEAL_DONE = 215; // the wash has covered the canvas and the poster is readable
const LOOP_FADE = 15;
export const artFairDuration = (holdSeconds: number) => REVEAL_DONE + Math.round(holdSeconds * ARTFAIR_FPS) + LOOP_FADE;

const W = 1080, H = 1920;
// Instagram covers the top ~250 px, bottom ~420 px and right ~150 px of a Reel, so the poster sits inside that.
const SAFE_TOP = 300, SAFE_RIGHT = 170;
const CUP = { x: 840, y: 1430, r: 95, h: 150 }; // where the rinse cup stands on the canvas

// ─── Timing ───────────────────────────────────────────────────────────────────────────────────────
const T = {
  stroke1: [10, 52], dip1: [54, 72], stroke2: [74, 114],
  toCup: [116, 128], knock: 128, topple: [128, 148], spill: 134,
  details: [205, 225],
} as const;

// ─── The strokes the brush paints ─────────────────────────────────────────────────────────────────
type P = { x: number; y: number };
const bezier = (a: P, b: P, c: P, d: P, t: number): P => {
  const u = 1 - t, k0 = u * u * u, k1 = 3 * u * u * t, k2 = 3 * u * t * t, k3 = t * t * t;
  return { x: k0 * a.x + k1 * b.x + k2 * c.x + k3 * d.x, y: k0 * a.y + k1 * b.y + k2 * c.y + k3 * d.y };
};
const STROKES: [P, P, P, P][] = [
  [{ x: 150, y: 1180 }, { x: 420, y: 900 }, { x: 640, y: 1340 }, { x: 900, y: 1020 }],
  [{ x: 190, y: 1330 }, { x: 480, y: 1500 }, { x: 700, y: 1120 }, { x: 890, y: 1290 }],
];
const strokePath = (s: [P, P, P, P]) => `M ${s[0].x} ${s[0].y} C ${s[1].x} ${s[1].y} ${s[2].x} ${s[2].y} ${s[3].x} ${s[3].y}`;
// A cubic's length, near enough: walk it in small steps. Used for the drawn-so-far dash and the brush's speed.
const strokeLength = (s: [P, P, P, P]) => {
  let len = 0, prev = s[0];
  for (let i = 1; i <= 60; i++) { const p = bezier(s[0], s[1], s[2], s[3], i / 60); len += Math.hypot(p.x - prev.x, p.y - prev.y); prev = p; }
  return len;
};

const ease = (x: number) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };
const span = (frame: number, [a, b]: readonly [number, number]) => Math.min(1, Math.max(0, (frame - a) / (b - a)));
const lerp = (a: P, b: P, t: number): P => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

// Where the brush is, and how it is turned, at any frame: painting, crossing to the cup, rinsing, or leaving.
function brushAt(frame: number) {
  const rim = { x: CUP.x - 40, y: CUP.y - 30 };
  const strokeTip = (i: number, t: number) => bezier(...STROKES[i], ease(t));
  const heading = (i: number, t: number) => {
    const a = bezier(...STROKES[i], Math.max(0, ease(t) - 0.02)), b = bezier(...STROKES[i], Math.min(1, ease(t) + 0.02));
    return Math.atan2(b.y - a.y, b.x - a.x);
  };
  if (frame < T.stroke1[0]) { const t = span(frame, [0, T.stroke1[0]]); return { p: lerp({ x: 120, y: 1700 }, strokeTip(0, 0), ease(t)), lift: 120 * (1 - ease(t)), angle: heading(0, 0), paint: 0 }; }
  if (frame <= T.stroke1[1]) { const t = span(frame, T.stroke1); return { p: strokeTip(0, t), lift: 0, angle: heading(0, t), paint: 0 }; }
  if (frame <= T.dip1[1]) { // over to the cup, a swirl in the water, and back
    const t = span(frame, T.dip1), swirl = Math.sin(t * Math.PI * 4) * 22;
    const p = t < 0.5 ? lerp(strokeTip(0, 1), rim, ease(t * 2)) : lerp(rim, strokeTip(1, 0), ease(t * 2 - 1));
    return { p: { x: p.x + (t > 0.3 && t < 0.7 ? swirl : 0), y: p.y + (t > 0.3 && t < 0.7 ? Math.cos(t * Math.PI * 4) * 16 : 0) }, lift: Math.sin(t * Math.PI) * 90, angle: heading(1, 0), paint: 1 };
  }
  if (frame <= T.stroke2[1]) { const t = span(frame, T.stroke2); return { p: strokeTip(1, t), lift: 0, angle: heading(1, t), paint: 1 }; }
  // The swing back towards the cup that clips it, and the follow-through out of frame.
  const t = span(frame, [T.toCup[0], T.toCup[1] + 20]);
  const target = { x: CUP.x + 40, y: CUP.y - 120 }, out = { x: 1180, y: 900 };
  const p = t < 0.55 ? lerp(strokeTip(1, 1), target, ease(t / 0.55)) : lerp(target, out, ease((t - 0.55) / 0.45));
  return { p, lift: 40 * ease(t), angle: -0.9, paint: 1 };
}

// ─── The paint ────────────────────────────────────────────────────────────────────────────────────
// Watercolour is not a line: where a loaded brush touches damp paper the pigment creeps outwards, the edge
// dries darker than the middle, and it keeps moving after the brush has gone. So a stroke here is not drawn
// as a path at all. The brush drops pigment as it travels, and every drop then spreads on its own:
//   bloom    a push outwards from where it landed, strongest just after it lands, fading as the paper takes it
//   jitter   a small random wander, which is what gives the ragged edge instead of a clean outline
//   drag     the paper holding the pigment, so it settles rather than drifting for ever
// Each drop is drawn as a soft disc that is darker at its rim, and they are laid over one another so the
// colour builds up where the brush lingered, exactly as washes do.
const PIGMENT_PER_FRAME = 5;
const BLOOM = 0.5, BLOOM_FOR = 18, JITTER = 0.3, PAINT_DRAG = 0.86;
const PAINT_GROW = 1.3, PAINT_GROW_OVER = 55;
const WETTED_GROW = 0.9; // the spilled water reaches the paint and moves it on again
type Grain = { born: number; colour: number; path: P[]; r0: number };

function simulatePaint(frames: number): Grain[] {
  let seed = 4242; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const grains: { born: number; colour: number; x: number; y: number; vx: number; vy: number; ox: number; oy: number; r0: number; path: P[] }[] = [];
  const spans: [readonly [number, number], number][] = [[T.stroke1, 0], [T.stroke2, 1]];
  for (const [[from, to], colour] of spans)
    for (let f = from; f <= to; f++) {
      const tip = brushAt(f).p;
      for (let k = 0; k < PIGMENT_PER_FRAME; k++) {
        const a = rnd() * Math.PI * 2, spread = rnd() * 16;
        const x = tip.x + Math.cos(a) * spread, y = tip.y + Math.sin(a) * spread;
        grains.push({ born: f, colour, x, y, vx: 0, vy: 0, ox: x, oy: y, r0: 13 + rnd() * 11, path: [] });
      }
    }
  for (let f = 0; f < frames; f++)
    for (const g of grains) {
      if (g.born > f) continue;
      const age = f - g.born;
      if (age > 0) {
        // Outwards from where it landed, hardest at first: the paper drawing the pigment along its fibres.
        const dx = g.x - g.ox, dy = g.y - g.oy, d = Math.hypot(dx, dy) || 0.001;
        const push = BLOOM * Math.max(0, 1 - age / BLOOM_FOR);
        g.vx += (dx / d) * push + (rnd() * 2 - 1) * JITTER;
        g.vy += (dy / d) * push + (rnd() * 2 - 1) * JITTER;
        g.vx *= PAINT_DRAG; g.vy *= PAINT_DRAG;
        g.x += g.vx; g.y += g.vy;
      }
      g.path.push({ x: g.x, y: g.y });
    }
  return grains.map(g => ({ born: g.born, colour: g.colour, path: g.path, r0: g.r0 }));
}

// ─── The spill ────────────────────────────────────────────────────────────────────────────────────
// Tuned by running the simulation on its own (no rendering) until the wash covers the canvas by REVEAL_DONE:
// it reaches 83% of the frame by 180 and all of it by 215.
const SPILL_COUNT = 420;
const PRESSURE = 1.2, PRESSURE_R = 150; // how hard, and how close, the water pushes itself apart
const COHESION = 0.12, COHESION_R = 210; // the stronger pull that keeps it one puddle instead of islands
const DRAG = 0.95, SPREAD = 1.15; // the canvas slowing it, and how much each blob thins as it spreads
type Drop = { born: number; path: P[]; r0: number; colour: number };

function simulateSpill(frames: number) {
  let seed = 99; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  // Everything leaves the cup's mouth in the direction it fell, over the frames the cup is going over.
  const parts = Array.from({ length: SPILL_COUNT }, (_, i) => {
    const born = T.spill + Math.round((i / SPILL_COUNT) ** 0.7 * 26);
    const a = -2.5 + rnd() * 1.9, speed = 10 + rnd() * 16;
    // The rinse water is every colour the brush has been in: mostly the muddy mix, with streaks of each
    // pigment that never blended, which is why the spill spreads multicoloured rather than as one flat tone.
    const colour = rnd() < 0.45 ? Math.floor(rnd() * 3) : 3;
    return { born, colour, x: CUP.x - 30 + (rnd() * 2 - 1) * 40, y: CUP.y - 40 + (rnd() * 2 - 1) * 30, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed * 0.8, r0: 62 + rnd() * 46, path: [] as P[] };
  });
  const CELL = COHESION_R; // neighbours are looked up in a grid; comparing all 420 with all 420 every frame is needless work
  for (let f = 0; f < frames; f++) {
    const live = parts.filter(p => p.born <= f);
    const grid = new Map<string, typeof live>();
    for (const p of live) { const k = `${Math.floor(p.x / CELL)},${Math.floor(p.y / CELL)}`; (grid.get(k) ?? grid.set(k, []).get(k)!).push(p); }
    for (const p of live) {
      let fx = 0, fy = 0;
      const gx = Math.floor(p.x / CELL), gy = Math.floor(p.y / CELL);
      for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) for (const q of grid.get(`${gx + ox},${gy + oy}`) ?? []) {
        if (q === p) continue;
        const dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy) || 0.001;
        if (d > COHESION_R) continue;
        // Close in: push apart, so the puddle spreads instead of collapsing to a dot. Further out: pull
        // together, which is the surface tension that keeps the spill one body of water with a clean edge.
        const force = d < PRESSURE_R ? -PRESSURE * (1 - d / PRESSURE_R) : COHESION * (1 - (d - PRESSURE_R) / (COHESION_R - PRESSURE_R));
        fx += (dx / d) * force; fy += (dy / d) * force;
      }
      p.vx = (p.vx + fx) * DRAG; p.vy = (p.vy + fy) * DRAG; // the canvas dragging on the water
      p.x += p.vx; p.y += p.vy;
      // The canvas edges: the water banks up rather than running off the screen.
      if (p.x < 40) { p.x = 40; p.vx = Math.abs(p.vx) * 0.25; }
      if (p.x > W - 40) { p.x = W - 40; p.vx = -Math.abs(p.vx) * 0.25; }
      if (p.y < 40) { p.y = 40; p.vy = Math.abs(p.vy) * 0.25; }
      if (p.y > H - 40) { p.y = H - 40; p.vy = -Math.abs(p.vy) * 0.25; }
    }
    for (const p of parts) if (p.born <= f) p.path.push({ x: p.x, y: p.y });
  }
  return parts.map(p => ({ born: p.born, colour: p.colour, path: p.path, r0: p.r0 } as Drop));
}

// ─── The 3D brush and cup ─────────────────────────────────────────────────────────────────────────
const CAMERA_DISTANCE = 2600, CAMERA_Y = H / 2;
const CAMERA_FOV = (2 * Math.atan(CAMERA_Y / CAMERA_DISTANCE) * 180) / Math.PI;

function Studio() {
  const { gl, scene } = useThree();
  useLayoutEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env; scene.environmentIntensity = 0.5;
    return () => { env.dispose(); pmrem.dispose(); };
  }, [gl, scene]);
  return null;
}

// The brush model (public/models/paintbrush.glb). Its parts are named, so the tip can be tinted with the
// colour being painted. In the file the brush lies on a diagonal, tip at (1.37, 1.97, 0.28) and the end of the
// handle at (-1.41, -2.02, -0.30), about 4.9 units long. It is moved so the tip sits at the group's origin,
// turned so the handle rises back over the painter's hand, and scaled to about 380 px long on screen.
const MODEL_TIP = new THREE.Vector3(1.37, 1.97, 0.28);
const MODEL_AXIS = new THREE.Vector3(2.78, 3.99, 0.58).normalize(); // handle end towards tip
const HANDLE_DIR = new THREE.Vector3(-Math.cos(0.78), 0, Math.sin(0.78)).normalize(); // back along the stroke and up
const BRUSH_SCALE = 112; // seen from above the brush foreshortens, so it is drawn generously

function Brush({ paint }: { paint: string }) {
  const gltf = useLoader(GLTFLoader, staticFile('models/paintbrush.glb')); // suspends; ThreeCanvas waits for it
  const model = useMemo(() => {
    const root = gltf.scene.clone(true);
    root.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.material = (mesh.material as THREE.Material).clone();
      // The bristles carry whatever colour the brush is loaded with.
      if (/bristle|glaze/.test(mesh.name)) {
        const m = mesh.material as THREE.MeshStandardMaterial;
        m.color = new THREE.Color(paint);
        m.roughness = 0.65;
      }
    });
    const quat = new THREE.Quaternion().setFromUnitVectors(MODEL_AXIS.clone().negate(), HANDLE_DIR);
    const holder = new THREE.Group();
    const centred = new THREE.Group();
    centred.position.copy(MODEL_TIP.clone().multiplyScalar(-1));
    centred.add(root);
    holder.quaternion.copy(quat);
    holder.scale.setScalar(BRUSH_SCALE);
    holder.add(centred);
    return holder;
  }, [gltf, paint]);
  return <primitive object={model} />;
}

function Scene({ frame, paint, rinse }: { frame: number; paint: string; rinse: string }) {
  const brush = brushAt(frame);
  // The cup goes over about its foot: it tips, then settles on its side.
  const tip = ease(span(frame, T.topple)) * (Math.PI / 2) * 1.02;
  const cupProfile = useMemo(() => {
    const pts: THREE.Vector2[] = [new THREE.Vector2(0, 0)];
    for (let i = 0; i <= 8; i++) pts.push(new THREE.Vector2(CUP.r * (0.72 + 0.28 * (i / 8)), (CUP.h * i) / 8));
    return new THREE.LatheGeometry(pts, 64);
  }, []);
  const waterLevel = CUP.h * 0.62;
  return (
    <group position={[-W / 2, CAMERA_Y, 0]}>
      <Studio />
      <ambientLight intensity={0.5} />
      <directionalLight position={[-600, 500, 1200]} intensity={1.4} />
      {/* The cup stands on the canvas (z is up out of it) and falls towards the lower left. */}
      <group position={[CUP.x, -CUP.y, 0]} rotation={[0, 0, -0.5]}>
        <group rotation={[tip, 0, 0]}>
          <group rotation={[-Math.PI / 2, 0, 0]}>
            <mesh geometry={cupProfile}>
              <meshPhysicalMaterial color="#f4f9ff" roughness={0.04} transmission={0.85} thickness={8} ior={1.5} envMapIntensity={2.2} clearcoat={1} transparent opacity={0.5} side={THREE.DoubleSide} depthWrite={false} />
            </mesh>
            <mesh position={[0, CUP.h, 0]} rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[CUP.r, 7, 16, 64]} />
              <meshPhysicalMaterial color="#f4f9ff" roughness={0.05} metalness={0.1} envMapIntensity={2.4} clearcoat={1} transparent opacity={0.85} />
            </mesh>
            {/* The rinse water, which drains as it pours out. */}
            <mesh position={[0, (waterLevel * Math.max(0, 1 - span(frame, [T.spill, T.spill + 26]))) / 2, 0]} scale={[1, Math.max(0.001, 1 - span(frame, [T.spill, T.spill + 26])), 1]}>
              <cylinderGeometry args={[CUP.r * 0.93, CUP.r * 0.7, waterLevel, 48]} />
              <meshPhysicalMaterial color={rinse} roughness={0.12} metalness={0} envMapIntensity={0.8} transparent opacity={0.95} />
            </mesh>
          </group>
        </group>
      </group>
      {/* The brush, tip on the canvas, turned to follow the stroke it is painting. */}
      <group position={[brush.p.x, -brush.p.y, 6 + brush.lift]} rotation={[0, 0, -brush.angle]}>
        <Brush paint={paint} />
      </group>
    </group>
  );
}

export const ArtFairStory = ({ title, when, time, venue, price, accent, ink, rinse, canvas, paints, holdSeconds }: ArtFairStoryProps) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const frames = artFairDuration(holdSeconds);
  const spill = useMemo(() => simulateSpill(frames), [frames]);
  const paint2 = useMemo(() => simulatePaint(frames), [frames]);
  const brush = brushAt(frame);
  const paint = paints[Math.min(paints.length - 1, brush.paint)];
  // Pigment colours: the paints the brush used, then the muddy rinse water they mixed into.
  const palette = [...paints, rinse];
  const CENTRE = (W - SAFE_RIGHT + 80) / 2;
  const details = ease(span(frame, T.details));
  const fadeOut = ease((frame - (durationInFrames - LOOP_FADE)) / (LOOP_FADE - 1));
  const label = { fontFamily: 'DejaVu Sans, Arial, sans-serif', letterSpacing: 4, textAlign: 'center' as const, position: 'absolute' as const, left: 80, right: SAFE_RIGHT };

  return (
    <AbsoluteFill style={{ background: canvas }} from={-35}>
      <svg width={W} height={H} style={{ position: 'absolute', inset: 0 }}>
        <defs>
          {/* Each pigment colour as a soft disc that is darker at its rim: watercolour dries towards its edge,
              and that ring is most of what makes a wash read as paint rather than ink. */}
          {palette.map((c, i) => (
            <radialGradient key={c} id={`pig${i}`}>
              <stop offset="0" stopColor={c} stopOpacity={0.3} />
              <stop offset="0.62" stopColor={c} stopOpacity={0.34} />
              <stop offset="0.93" stopColor={c} stopOpacity={0.6} />
              <stop offset="1" stopColor={c} stopOpacity={0} />
            </radialGradient>
          ))}
          {/* The same colours as thin rinse water: faint, so hundreds of them lay up into one wash rather
              than reading as separate discs, with just a hint of the dried rim. */}
          {palette.map((c, i) => (
            <radialGradient key={`w${c}`} id={`wash${i}`}>
              <stop offset="0" stopColor={c} stopOpacity={0.12} />
              <stop offset="0.7" stopColor={c} stopOpacity={0.15} />
              <stop offset="0.94" stopColor={c} stopOpacity={0.26} />
              <stop offset="1" stopColor={c} stopOpacity={0} />
            </radialGradient>
          ))}
          {/* Masking fluid: the type is painted out before the wash goes on, so the water flows around the
              letters and they surface as bare paper. Nothing is drawn on top; the poster is what is left. */}
          <mask id="resist">
            <rect width={W} height={H} fill="#fff" />
            <g fill="#000" fontFamily="DejaVu Sans, Arial, sans-serif" textAnchor="middle">
              {title.map((line, i) => (
                <text key={line} x={CENTRE} y={SAFE_TOP + 180 + i * 132} fontSize={118} fontWeight="bold" letterSpacing={-2}>{line}</text>
              ))}
              <rect x={CENTRE - 60} y={SAFE_TOP + 232 + (title.length - 1) * 132} width={120} height={10} />
              <text x={CENTRE} y={920} fontSize={46} fontWeight="bold" letterSpacing={2}>{when}</text>
              <text x={CENTRE} y={978} fontSize={40} letterSpacing={2}>{time}</text>
              {venue.map((line, i) => <text key={line} x={CENTRE} y={1048 + i * 42} fontSize={28} letterSpacing={2}>{line}</text>)}
              <text x={CENTRE} y={1048 + venue.length * 42 + 16} fontSize={30} letterSpacing={1}>{price}</text>
            </g>
          </mask>
          {/* Pushes every edge about with a noise field, so nothing has a machine-made outline. */}
          <filter id="ragged" x="-10%" y="-10%" width="120%" height="120%">
            <feTurbulence type="fractalNoise" baseFrequency="0.012" numOctaves="3" seed="7" result="n" />
            <feDisplacementMap in="SourceGraphic" in2="n" scale="26" />
          </filter>
          {/* The grain of the paper, laid over everything. */}
          <filter id="paper" x="0" y="0" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="4" seed="3" result="g" />
            <feColorMatrix in="g" type="saturate" values="0" />
          </filter>
          {/* Blur the drops together, then sharpen the alpha: separate circles become one wet shape with an edge. */}
          <filter id="goo">
            <feGaussianBlur in="SourceGraphic" stdDeviation="22" result="b" />
            <feColorMatrix in="b" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 26 -11" />
          </filter>
          <mask id="wet">
            <g filter="url(#goo)">
              {spill.map((d, i) => {
                const at = d.path[frame - d.born];
                if (!at) return null;
                const age = frame - d.born;
                return <circle key={i} cx={at.x} cy={at.y} r={d.r0 * (1 + SPREAD * ease(age / 70))} fill="#fff" />;
              })}
            </g>
          </mask>
        </defs>
        <rect width={W} height={H} fill={canvas} />
        {/* The paint: every drop the brush has left, still creeping. */}
        <g filter="url(#ragged)" style={{ mixBlendMode: 'multiply' }}>
          {paint2.map((g, i) => {
            const at = g.path[frame - g.born];
            if (!at) return null;
            const age = frame - g.born;
            // Once the spilled water reaches the paint, it starts moving again and spreads further.
            const wetted = 1 + WETTED_GROW * ease((frame - T.spill - 20) / 90);
            return <circle key={i} cx={at.x} cy={at.y} r={g.r0 * (1 + PAINT_GROW * ease(age / PAINT_GROW_OVER)) * wetted} fill={`url(#pig${g.colour})`} />;
          })}
        </g>
        {/* The spill: the same kind of drop, in the colours the rinse water was carrying, flowing around
            the type that was masked out before the painting started. */}
        <g mask="url(#resist)" filter="url(#ragged)" style={{ mixBlendMode: 'multiply' }}>
          {spill.map((d, i) => {
            const at = d.path[frame - d.born];
            if (!at) return null;
            const age = frame - d.born;
            return <circle key={i} cx={at.x} cy={at.y} r={d.r0 * (1 + SPREAD * ease(age / 70))} fill={`url(#wash${d.colour})`} />;
          })}
        </g>
        <rect width={W} height={H} filter="url(#paper)" opacity={0.12} style={{ mixBlendMode: 'multiply' }} />
      </svg>
      <ThreeCanvas width={W} height={H} camera={{ position: [0, 0, CAMERA_DISTANCE], fov: CAMERA_FOV, near: 10, far: 9000 }} gl={{ antialias: true, alpha: true }}>
        <Scene frame={frame} paint={paint} rinse={rinse} />
      </ThreeCanvas>
      {/* The masthead is printed on the paper, not painted, so it is there from the first frame. */}
      <div style={{ ...label, top: SAFE_TOP - 60, fontSize: 28, letterSpacing: 6, color: ink, fontWeight: 700, opacity: 0.75 }}>RĪGA / WEEKEND</div>
      <AbsoluteFill style={{ background: '#000', opacity: fadeOut }} />
      {/* Sound: the two brush strokes (cut to their length), rinsing in the cup, the knock, the spill and the
          water running out over the canvas. */}
      <Sfx at={T.stroke1[0]} name="fair-brush-1" volume={0.75} frames={T.stroke1[1] - T.stroke1[0]} />
      <Sfx at={T.dip1[0] + 2} name="fair-drop" volume={0.5} />
      <Sfx at={T.dip1[0] + 9} name="fair-drop" volume={0.35} />
      <Sfx at={T.stroke2[0]} name="fair-brush-2" volume={0.75} frames={T.stroke2[1] - T.stroke2[0]} />
      <Sfx at={T.knock} name="fair-knock" volume={0.8} />
      <Sfx at={T.spill} name="fair-splash" volume={0.9} />
      <Sfx at={T.spill + 8} name="fair-wet" volume={0.4} />
    </AbsoluteFill>
  );
};
