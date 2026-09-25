// Reel for Researchers' Night: the experiment makes the night sky, and the sky spells the name. Drops fall
// into a flask and turn the liquid a new colour each time; bubbles rise and pop at the surface, each pop
// throws out a handful of sparks, the sparks drift up out of the neck into the dark and hang there like
// stars, and then every star is pulled to its own place in the letters.
//
// The physics is the same toolkit as the practice files and the heart monitor, one idea per phase:
//   bubbles rising          buoyancy (gravity pointing up) and drag from the liquid
//   a bubble popping        an impulse: each spark gets a sudden push outwards
//   sparks leaving the neck a funnel pulling them to the middle, then a second push that spreads them
//   stars into letters      a spring from each star to its own target, with damping so it settles
// Everything is simulated once, frame by frame from the start, and each frame of the video reads its row:
// Remotion renders frames out of order, so nothing may carry state from one rendered frame to the next.
//
// The flask, liquid, bubbles and drops are 3D (three.js): a glass lathe lit by a studio environment, on a
// bench, with the liquid lighting it from inside. The physics still runs in flat screen pixels: the camera
// is placed so that the plane z = 0 lands on the screen pixel for pixel, which is why the stars, drawn flat
// on top, leave the 3D neck exactly where the simulation says. Seen from a little above, the liquid's
// surface and the mouth of the neck show as ellipses, and that is where the depth comes from.
import { useLayoutEffect, useMemo } from 'react';
import { AbsoluteFill, Audio, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { ThreeCanvas } from '@remotion/three';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export type ResearchersStoryProps = {
  title: string[]; // drawn in stars
  when: string;
  time: string;
  where: string;
  accent: string;
  background: [string, string]; // top and bottom of the sky
  liquid: string[]; // the liquid's colour after each drop; its length is the number of drops
  holdSeconds: number;
};
export const RESEARCHERS_FPS = 30;
const GATHER_DONE = 185; // by now every star has reached its letter
const LOOP_FADE = 15;
export const researchersDuration = (holdSeconds: number) => GATHER_DONE + Math.round(holdSeconds * RESEARCHERS_FPS) + LOOP_FADE;

// ─── The scene, laid out inside what Instagram leaves clear on a Reel ─────────────────────────────
const W = 1080, H = 1920, CX = 540;
const NECK_TOP = 990, NECK_BOTTOM = 1110, BASE = 1425, NECK_HALF = 45, BASE_HALF = 205;
const SURFACE = 1262; // the liquid's resting level
// Half the flask's inside width at height y: the neck, then the sloping sides.
const halfWidth = (y: number) => y <= NECK_BOTTOM ? NECK_HALF : NECK_HALF + (BASE_HALF - NECK_HALF) * Math.min(1, (y - NECK_BOTTOM) / (BASE - 20 - NECK_BOTTOM));
const SKY = { left: 90, right: 930, top: 300, bottom: NECK_TOP - 40 };
const TEXT_TOP = 390, TEXT_WIDTH = 760; // where the star letters sit: centred, clear of the Reel's right-hand buttons

// ─── Timing ───────────────────────────────────────────────────────────────────────────────────────
const DROP_FROM = 850, DROP_G = 1.6; // drops fall from above the neck under gravity
const DROP_EVERY = 13, FIRST_DROP = 4;
const BUBBLES_FROM = 26, BUBBLES_TO = 92; // bubbles start at the first splash and get busier with each drop
const SPARKS_PER_POP = 9;
const GATHER_FROM = 118; // stars start heading for their letters, a few at a time

// Small seeded random numbers, so every render of every frame sees the same bubbles.
function rng(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// The dots the letters are made of: the title drawn on a canvas, sampled on a grid.
function letterPoints(lines: string[], max: number): { x: number; y: number }[] {
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = 700;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff'; ctx.textBaseline = 'top';
  let y = 0;
  for (const line of lines) {
    let size = 200;
    ctx.font = `bold ${size}px "DejaVu Sans", Arial, sans-serif`;
    size = Math.min(200, Math.floor(size * TEXT_WIDTH / ctx.measureText(line).width));
    ctx.font = `bold ${size}px "DejaVu Sans", Arial, sans-serif`;
    ctx.fillText(line, (W - ctx.measureText(line).width) / 2, y);
    y += size * 1.08;
  }
  const data = ctx.getImageData(0, 0, W, canvas.height).data, points: { x: number; y: number }[] = [];
  const step = 11;
  for (let py = 0; py < canvas.height; py += step)
    for (let px = (py / step) % 2 ? step / 2 : 0; px < W; px += step)
      if (data[(Math.round(py) * W + Math.round(px)) * 4 + 3] > 128) points.push({ x: px, y: TEXT_TOP + py });
  // Keep an even spread if there are more than we have stars for.
  const r = rng(7);
  while (points.length > max) points.splice(Math.floor(r() * points.length), 1);
  return points;
}

type Drop = { start: number; land: number };
type Bubble = { born: number; x0: number; r: number; depth: number; path: { x: number; y: number }[]; pop: number };
type Star = { born: number; hue: number; target: { x: number; y: number }; gather: number; path: { x: number; y: number }[]; twinkle: number };

function simulate(title: string[], drops: number, frames: number) {
  const r = rng(2026);
  // Drops: fall freely until they reach the surface. y = y0 + ½·g·t², solved for t.
  const dropList: Drop[] = Array.from({ length: drops }, (_, i) => {
    const start = FIRST_DROP + i * DROP_EVERY;
    return { start, land: start + Math.sqrt((2 * (SURFACE - DROP_FROM)) / DROP_G) };
  });

  const targets = letterPoints(title, 560);
  const bubbleCount = Math.ceil(targets.length / SPARKS_PER_POP);

  // Bubbles: buoyancy pushes up (a negative y force), the liquid drags against the speed, and a small
  // sideways sway. Each is simulated until it reaches the surface, where it pops.
  const bubbles: Bubble[] = [];
  for (let i = 0; i < bubbleCount; i++) {
    const born = Math.round(BUBBLES_FROM + (BUBBLES_TO - BUBBLES_FROM) * (i / bubbleCount) ** 0.75);
    const size = 5 + r() * 9;
    let y = BASE - 14 - r() * 40, x = CX + (r() * 2 - 1) * (halfWidth(y) - size - 12), vx = 0, vy = 0;
    const lift = 0.22 + size * 0.02, sway = r() * Math.PI * 2, depth = r() * 2 - 1, path = [];
    let f = born;
    while (y > SURFACE && f < frames) {
      vy += -lift - 0.09 * vy; // buoyancy, then drag
      vx += Math.sin(f * 0.35 + sway) * 0.12 - 0.12 * vx; // sway, damped
      y += vy; x += vx;
      const room = halfWidth(y) - size - 4; x = Math.max(CX - room, Math.min(CX + room, x));
      path.push({ x, y }); f++;
    }
    bubbles.push({ born, x0: x, r: size, depth, path, pop: f });
  }

  // Stars: every pop throws SPARKS_PER_POP sparks outwards (an impulse). Inside the flask they float up and
  // are funnelled to the middle so they leave through the neck; out of the neck each gets one more push
  // that spreads them over the sky, where air drag slows them to a hover. From its gather frame, a spring
  // pulls each one to its own point in the letters, and damping lets it settle without overshooting far.
  const stars: Star[] = [];
  const order = targets.map((t, i) => ({ t, k: r() })).sort((a, b) => a.k - b.k).map(o => o.t); // who goes where: shuffled, so stars cross the sky to reach their letters
  bubbles.forEach(b => {
    for (let s = 0; s < SPARKS_PER_POP && stars.length < order.length; s++) {
      const angle = -Math.PI / 2 + (r() * 2 - 1) * 1.3, kick = 2 + r() * 3.5;
      let x = b.path.at(-1)?.x ?? b.x0, y = SURFACE, vx = Math.cos(angle) * kick, vy = Math.sin(angle) * kick;
      let out = false;
      const target = order[stars.length];
      // Stars gather in a sweep from the top of the text to the bottom, so the words fill in rather than pop in.
      const gather = Math.max(GATHER_FROM + (target.y - TEXT_TOP) * 0.06 + r() * 16, b.pop + 20);
      const path: { x: number; y: number }[] = [];
      for (let f = b.pop; f < frames; f++) {
        if (f < gather) {
          if (!out) {
            vy += -0.42 - 0.05 * vy; // still in the flask: light, rising fast, slowed a little by the glass
            vx += (CX - x) * 0.035 * Math.min(1, (SURFACE - y + 80) / 160) - 0.1 * vx; // the funnel to the neck
            if (y < NECK_TOP) { out = true; const a = -Math.PI / 2 + (r() * 2 - 1) * 1.25, p = 3 + r() * 6; vx += Math.cos(a) * p; vy = Math.sin(a) * p; }
          } else {
            vx += -0.035 * vx + Math.sin(f * 0.05 + target.x) * 0.02; // air drag and a lazy drift
            vy += -0.035 * vy - 0.012;
            if (x < SKY.left || x > SKY.right) vx = -vx * 0.6;
            if (y < SKY.top) vy = Math.abs(vy) * 0.6;
          }
        } else {
          vx += 0.09 * (target.x - x) - 0.34 * vx; // the spring to its letter, and damping
          vy += 0.09 * (target.y - y) - 0.34 * vy;
        }
        x += vx; y += vy;
        if (!out && f < gather) { const room = halfWidth(Math.max(NECK_TOP, y)) - 6; x = Math.max(CX - room, Math.min(CX + room, x)); }
        path.push({ x, y });
      }
      stars.push({ born: b.pop, hue: r(), target, gather, path, twinkle: r() * Math.PI * 2 });
    }
  });
  // Faint background stars, so the sky reads as sky before the sparks arrive.
  const sky = Array.from({ length: 70 }, () => ({ x: r() * W, y: 260 + r() * 700, size: 1 + r() * 1.8, phase: r() * 6.28 }));
  return { drops: dropList, bubbles, stars, sky };
}

// ─── The 3D flask ─────────────────────────────────────────────────────────────────────────────────
// Screen pixels to world units: x stays, y flips (three.js y points up), z is depth towards the viewer.
const CAMERA_DISTANCE = 2400, CAMERA_Y = H / 2;
const CAMERA_FOV = (2 * Math.atan(CAMERA_Y / CAMERA_DISTANCE) * 180) / Math.PI; // makes z = 0 exactly one pixel per unit
const WALL = 6; // glass thickness, in pixels
const BENCH_TOP = 1330; // the back edge of the bench, where it meets the dark
// The flask's outline turned into a lathe profile: (radius, height) pairs from the base up to the rim.
function profile(extra: number, from = BASE, to = NECK_TOP) {
  const pts: THREE.Vector2[] = [new THREE.Vector2(0, -from)];
  const corner = 22;
  if (from >= BASE - 1) for (let a = 0; a <= 6; a++) { const t = (a / 6) * Math.PI / 2; pts.push(new THREE.Vector2(BASE_HALF + extra - corner + Math.sin(t) * corner, -(BASE - corner + Math.cos(t) * corner))); }
  for (let y = Math.min(from, BASE - corner) - 10; y >= to; y -= 8) pts.push(new THREE.Vector2(halfWidth(y) + extra, -y));
  pts.push(new THREE.Vector2(halfWidth(to) + extra, -to));
  return pts;
}

// A studio environment, so the glass has something to reflect: without one, glass renders as nothing.
function Studio() {
  const { gl, scene } = useThree();
  useLayoutEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    scene.environmentIntensity = 0.55; // enough for the glass to catch highlights, not so much it washes out the liquid
    return () => { env.dispose(); pmrem.dispose(); };
  }, [gl, scene]);
  return null;
}

type FlaskProps = { frame: number; sim: ReturnType<typeof simulate>; colour: string; glow: number; surfaceY: number; slosh: number; liquid: string[] };
function Flask({ frame, sim, colour, glow, surfaceY, slosh, liquid }: FlaskProps) {
  const glass = useMemo(() => new THREE.LatheGeometry(profile(WALL / 2), 96), []);
  const liquidBody = useMemo(() => new THREE.LatheGeometry(profile(-2, BASE, SURFACE), 96), []);
  const sphere = useMemo(() => new THREE.SphereGeometry(1, 20, 14), []);
  const surfaceRadius = halfWidth(SURFACE) - 2;
  // react-three-fiber aims its camera at the world origin, so the scene is shifted to put the screen's
  // centre there; the camera then looks straight at it and z = 0 maps onto the screen pixel for pixel.
  return (
    <group position={[-CX, CAMERA_Y, 0]}>
      <Studio />
      <ambientLight intensity={0.25} />
      <directionalLight position={[CX - 900, -300, 1400]} intensity={1.1} />
      {/* The liquid lights the bench and the glass from inside; brighter as the reaction builds. */}
      <pointLight position={[CX, -(SURFACE + 60), 0]} color={colour} intensity={glow * 9} distance={1300} decay={1} />
      {/* The liquid: the inside of the flask up to the surface, with a lid that sloshes when a drop lands. */}
      <group position={[CX, 0, 0]}>
        <mesh geometry={liquidBody}>
          <meshPhysicalMaterial color={colour} emissive={colour} emissiveIntensity={0.12 + glow * 0.35} roughness={0.25} envMapIntensity={0.25} transparent opacity={0.88} side={THREE.FrontSide} />
        </mesh>
        <mesh position={[0, -surfaceY, 0]} rotation={[-Math.PI / 2, slosh * 0.004, 0]}>
          <circleGeometry args={[surfaceRadius, 96]} />
          <meshPhysicalMaterial color={colour} emissive={colour} emissiveIntensity={0.3 + glow * 0.5} roughness={0.1} clearcoat={1} envMapIntensity={0.4} transparent opacity={0.95} />
        </mesh>
        {/* Ripples where each drop lands. */}
        {sim.drops.map((d, i) => {
          const age = frame - d.land;
          return age > 0 && age < 22 ? (
            <mesh key={i} position={[0, -surfaceY + 0.5, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={10 + age * 5}>
              <ringGeometry args={[0.85, 1, 64]} />
              <meshBasicMaterial color="#ffffff" transparent opacity={0.55 * (1 - age / 22)} />
            </mesh>
          ) : null;
        })}
      </group>
      {/* Bubbles: small glassy spheres, spread through the depth of the flask as well as across it. */}
      {sim.bubbles.map((b, i) => {
        const at = b.path[frame - b.born];
        if (!at) return null;
        const room = Math.max(0, halfWidth(at.y) - b.r - 6), z = b.depth * Math.sqrt(Math.max(0, room * room - (at.x - CX) ** 2));
        return (
          <mesh key={i} geometry={sphere} position={[at.x, -at.y, z]} scale={b.r}>
            <meshStandardMaterial color="#ffffff" roughness={0.05} transparent opacity={0.5} emissive="#ffffff" emissiveIntensity={0.25} envMapIntensity={2} />
          </mesh>
        );
      })}
      {/* The drops, falling from above the neck. */}
      {sim.drops.map((d, i) => {
        const t = frame - d.start;
        return t >= 0 && frame < d.land ? (
          <mesh key={i} geometry={sphere} position={[CX, -(DROP_FROM + 0.5 * DROP_G * t * t), 0]} scale={[9, 13, 9]}>
            <meshStandardMaterial color={liquid[i]} emissive={liquid[i]} emissiveIntensity={0.6} roughness={0.1} />
          </mesh>
        ) : null;
      })}
      {/* The glass, and the lip round the mouth of the neck. */}
      <mesh geometry={glass} position={[CX, 0, 0]}>
        <meshPhysicalMaterial color="#eef6ff" roughness={0.03} metalness={0} transmission={1} thickness={WALL * 2} ior={1.5} clearcoat={1} clearcoatRoughness={0.02} envMapIntensity={1.6} transparent opacity={0.35} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <mesh position={[CX, -NECK_TOP, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[NECK_HALF + WALL + 5, 7, 20, 96]} />
        <meshPhysicalMaterial color="#eef6ff" roughness={0.05} transmission={1} thickness={14} ior={1.5} clearcoat={1} envMapIntensity={1.8} transparent opacity={0.6} />
      </mesh>
    </group>
  );
}

// ─── Sound ────────────────────────────────────────────────────────────────────────────────────────
// Three layers, lined up with the picture (the frames were read off renders). All three are CC0, so the post
// needs no credit line.
//   flask-cauldron.wav  magical bubbling from the first splash, fullest as the bubbling peaks, fading as the
//                       sparks leave. 1-7 s of "MagicCauldronBubbling" by katzlbt, freesound 361540.
//   flask-riser.wav     a riser that climbs under the bubbles and peaks on the spark fountain.
//                       "Riser sound effect short" by syntheffects, freesound 685256, end softened.
//   stars-sparkle-1..4  a sparkle flourish layered four times across the gathering, one per wave of stars
//                       landing: each a little higher (0, +3, +5, +7 semitones, in the order they play: 1, 3,
//                       2, 4), alternating left and right, the brightest as the title completes. Each has a
//                       hall reverb (a generated impulse response, 1.6 s decay) and peaks at -3 dB.
//                       "Mysterious Sparkle Flourish" by SkySpeira, freesound 844398, raised 15.5 dB first.
const FOUNTAIN_PEAK = 125; // the frame the spark fountain is at its fullest
const RISER_PEAK_IN_FILE = 75; // frames into flask-riser.wav where it peaks (2.5 s)
// When each sparkle layer starts, and how loud: the waves of stars landing, top of the words to the bottom.
const SPARKLES = [{ file: 1, from: 128, volume: 0.6 }, { file: 3, from: 144, volume: 0.5 }, { file: 2, from: 160, volume: 0.5 }, { file: 4, from: 176, volume: 0.7 }];
const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

// ─── Colour helpers ───────────────────────────────────────────────────────────────────────────────
const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const mix = (a: string, b: string, t: number) => { const A = rgb(a), B = rgb(b); return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(',')})`; };
const smooth = (x: number) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };

export const ResearchersStory = ({ title, when, time, where, accent, background, liquid, holdSeconds }: ResearchersStoryProps) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const sim = useMemo(() => simulate(title, liquid.length, researchersDuration(holdSeconds)), [title.join('|'), liquid.length, holdSeconds]);

  // The liquid: clear-ish to begin with, then each drop turns it towards its colour over a few frames.
  let colour = '#2a3440', landed = 0;
  sim.drops.forEach((d, i) => { const t = smooth((frame - d.land) / 8); if (t > 0) { colour = mix(i ? liquid[i - 1] : '#2a3440', liquid[i], t); landed = i + 1; } });
  const glow = landed ? 0.35 + 0.25 * landed / liquid.length : 0.1;
  const slosh = sim.drops.reduce((s, d) => s + (frame > d.land ? Math.exp(-(frame - d.land) / 10) * Math.sin((frame - d.land) * 0.9) * 6 : 0), 0);
  const surfaceY = SURFACE + slosh;
  const settled = smooth((frame - GATHER_DONE + 25) / 20); // the words underneath fade in as the stars land
  const fadeOut = smooth((frame - (durationInFrames - LOOP_FADE)) / (LOOP_FADE - 1));
  const label = { fontFamily: 'DejaVu Sans, Arial, sans-serif', color: '#f5f1ea', letterSpacing: 4, textAlign: 'center' as const, position: 'absolute' as const, left: 80, right: 80 };

  return (
    <AbsoluteFill style={{ background: `linear-gradient(${background[0]}, ${background[1]})` }}>
      <Sequence from={Math.round(sim.drops[0].land)} name="cauldron">
        <Audio src={staticFile('sfx/flask-cauldron.wav')} volume={1} />
      </Sequence>
      <Sequence from={FOUNTAIN_PEAK - RISER_PEAK_IN_FILE} name="riser">
        <Audio src={staticFile('sfx/flask-riser.wav')} volume={1} />
      </Sequence>
      {SPARKLES.map(sp => (
        <Sequence key={sp.file} from={sp.from} name={`star sparkle ${sp.file}`}>
          <Audio src={staticFile(`sfx/stars-sparkle-${sp.file}.wav`)} volume={sp.volume} />
        </Sequence>
      ))}
      {/* Behind the flask: the faint sky, the glow the liquid throws into the dark, and the bench it stands
          on, painted rather than modelled, with the liquid's light pooling round the base. */}
      <svg width={W} height={H} style={{ position: 'absolute', inset: 0 }}>
        <defs>
          <radialGradient id="liquidGlow"><stop offset="0" stopColor={colour} stopOpacity={glow * 0.8} /><stop offset="1" stopColor={colour} stopOpacity={0} /></radialGradient>
          <radialGradient id="benchGlow"><stop offset="0" stopColor={colour} stopOpacity={glow * 0.9} /><stop offset="0.5" stopColor={colour} stopOpacity={glow * 0.25} /><stop offset="1" stopColor={colour} stopOpacity={0} /></radialGradient>
          <linearGradient id="bench" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#120a06" /><stop offset="1" stopColor="#030201" /></linearGradient>
        </defs>
        {sim.sky.map((s, i) => <circle key={i} cx={s.x} cy={s.y} r={s.size} fill="#fff" opacity={0.12 + 0.12 * Math.sin(frame * 0.08 + s.phase)} />)}
        <ellipse cx={CX} cy={SURFACE} rx={460} ry={330} fill="url(#liquidGlow)" />
        <rect x={0} y={BENCH_TOP} width={W} height={H - BENCH_TOP} fill="url(#bench)" />
        <rect x={0} y={BENCH_TOP} width={W} height={2} fill="#ffffff" opacity={0.06} />
        <ellipse cx={CX} cy={BASE + 4} rx={430} ry={70} fill="url(#benchGlow)" />
      </svg>
      <ThreeCanvas width={W} height={H} camera={{ position: [0, 0, CAMERA_DISTANCE], fov: CAMERA_FOV, near: 10, far: 8000 }} gl={{ antialias: true, alpha: true }}>
        <Flask frame={frame} sim={sim} colour={colour} glow={glow} surfaceY={surfaceY} slosh={slosh} liquid={liquid} />
      </ThreeCanvas>
      {/* In front: the sparks and stars, flat, lined up with the 3D neck by the camera placement. */}
      <svg width={W} height={H} style={{ position: 'absolute', inset: 0 }}>
        <defs>
          <filter id="starGlow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3.5" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
        </defs>
        {/* The stars: tinted like the liquid they came from, cooling to the accent as they rise, twinkling once they settle. */}
        <g filter="url(#starGlow)">
          {sim.stars.map((s, i) => {
            const at = s.path[frame - s.born];
            if (!at) return null;
            const age = frame - s.born, settledHere = smooth((frame - s.gather - 18) / 14);
            const tint = mix(liquid[Math.min(liquid.length - 1, Math.floor(s.hue * liquid.length))], accent, smooth(age / 40));
            const twinkle = 1 + 0.35 * settledHere * Math.sin(frame * 0.22 + s.twinkle);
            return <circle key={i} cx={at.x} cy={at.y} r={(2.6 + 1.4 * settledHere) * twinkle} fill={tint} opacity={Math.min(1, age / 4)} />;
          })}
        </g>
      </svg>
      {/* Under the star letters, once they have formed. */}
      <div style={{ ...label, top: 790, fontSize: 46, color: accent, opacity: settled, textShadow: `0 0 18px ${accent}` }}>{when}</div>
      <div style={{ ...label, top: 856, fontSize: 38, color: accent, opacity: settled }}>{time}</div>
      <div style={{ ...label, top: 916, fontSize: 30, letterSpacing: 3, opacity: settled }}>{where}</div>
      <div style={{ ...label, top: 290, fontSize: 28, letterSpacing: 6, color: accent, opacity: 0.8 * (1 - fadeOut) }}>RĪGA / WEEKEND</div>
      <AbsoluteFill style={{ background: '#000', opacity: fadeOut }} />
    </AbsoluteFill>
  );
};
