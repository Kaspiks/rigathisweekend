// Single-event story for a baroque concert: 3D music notes falling across a sheet of old score paper.
// The paper is the same baked parchment as AutumnStory, with staves printed on it; the notes are
// built here from three.js shapes (no model files) and fall with the same collision simulation as
// the leaves (leafPhysics.ts), so they knock into each other rather than passing through.
import '@fontsource/cormorant-garamond/500.css';
import '@fontsource/cormorant-garamond/600.css';
import '@fontsource/cormorant-garamond/700.css';
import '@fontsource/great-vibes/400.css';
import { useThree } from '@react-three/fiber';
import { ThreeCanvas } from '@remotion/three';
import type { CSSProperties } from 'react';
import { useMemo } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { AbsoluteFill, Img, continueRender, delayRender, staticFile, useCurrentFrame, useVideoConfig, Audio, interpolate } from 'remotion';
import { type LeafSpec, PHYS, simulateLeaves } from './leafPhysics';
import { type NoteKind, PARTS, geo, noteRadius } from './noteGeometry';

const fonts = delayRender('Loading baroque fonts');
Promise.all([
  document.fonts.load('700 120px "Cormorant Garamond"'),
  document.fonts.load('600 44px "Cormorant Garamond"'),
  document.fonts.load('500 36px "Cormorant Garamond"'),
  document.fonts.load('96px "Great Vibes"'),
]).then(() => continueRender(fonts));

export type BaroqueStoryProps = { title: string[]; kicker: string; when: string; venue: string; price: string; holdSeconds: number };

export const BAROQUE_FPS = 30;
export const baroqueDuration = (holdSeconds: number) => Math.round(Math.max(1, holdSeconds) * BAROQUE_FPS);

const INK = '#2e1f12', RUST = '#8a3415', PAPER = '#efe0bd';

// ---- the notes ------------------------------------------------------------------------------------
const NoteShape = ({ kind, material }: { kind: NoteKind; material: THREE.Material }) => {
  const g = geo(), { offset, parts } = PARTS[kind];
  return (
    <group position={[offset[0], offset[1], 0]}>
      {parts.map((p, i) => (
        <mesh key={i} geometry={g[p.g]} material={material} position={p.pos} rotation={[0, 0, p.rotZ ?? 0]} castShadow />
      ))}
    </group>
  );
};

// How heavy each kind is in the fall. Musically backwards on purpose: the quick notes (sixteenths)
// fall fastest and shove the others about, the long notes (whole, half) drift.
const NOTE_WEIGHT: Record<NoteKind, number> = { whole: 0.7, half: 0.8, quarter: 0.95, eighth: 1.05, beamed: 1.15, sixteenth: 1.2 };
// The notes that just keep falling, wrapping from the bottom back to the top.
const KINDS: NoteKind[] = ['quarter', 'eighth', 'half', 'beamed', 'sixteenth', 'whole', 'eighth', 'quarter', 'beamed', 'sixteenth'];

// Notes fall in a thin layer, not through the full depth of the scene. The camera looks straight
// down z, so two notes a unit apart in depth can cross on screen without ever touching: correct in
// 3D, but on screen it reads as one passing straight through the other. Kept this thin, any two
// notes that overlap on screen are close enough in z to collide.
const NOTE_Z = 0.25;
const noteSpecs = () => KINDS.map((kind, i) => {
  const seed = i + 1;
  const rnd = (k: number) => Math.abs(Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453) % 1;
  const n = KINDS.length;
  const scale = 0.6 + rnd(8) * 0.3;
  const spec: LeafSpec = {
    weight: NOTE_WEIGHT[kind] * (0.9 + rnd(3) * 0.2),
    scale,
    radius: noteRadius(kind) * scale,
    x: (((((i * 5) % n) + 0.5) / n) - 0.5) * 2.6,
    y: PHYS.top - rnd(4) * PHYS.span,
    z: (rnd(7) - 0.5) * 2 * NOTE_Z,
    swingRate: 1.1 + rnd(1) * 0.7,
    swingAmp: 0.25 + rnd(6) * 0.2,
    spinRate: (rnd(11) - 0.5) * 1.2,
    spin0: (rnd(12) - 0.5) * 1.6, // mostly facing the camera at the start
    lean: (rnd(13) - 0.5) * 0.6,
    phase0: rnd(2) * Math.PI * 2,
  };
  return { kind, spec, gold: i % 4 === 1, landScale: 0 };
});

// ---- the invisible grid: the score ----------------------------------------------------------------
// Staves are printed on the page (see <Staves>): four of them, tops at STAVES px, lines 22 px apart.
// A pitch position `p` counts half-spaces down from the top line: even p is a line, odd p a space,
// 0..8 is inside the staff. Each staff has three beats across. So a slot is (staff, beat, p), which
// is an exact pixel on the page.
const STAVES = [700, 930, 1160, 1390];
const LINE_GAP = 22;
const BEATS = [250, 540, 830];
const PAPER_Z = -2.2;
// Landed notes lie on the paper itself (just in front of the shadow plane), far behind the falling
// layer, so a falling note can never cut through one that has landed.
const LAND_Z = PAPER_Z + 0.04;
// Pixels per scene unit at a depth, for the camera at z=10 with a 30° vertical field of view.
const pxPerUnit = (z: number) => 1920 / (2 * (10 - z) * Math.tan((15 * Math.PI) / 180));
// Landed notes keep the size they fell at. Moving back to the paper's depth would shrink them on
// screen by (10 - 0) / (10 - LAND_Z), so they grow by exactly that much as they go.
const DEPTH_GROW = (10 - LAND_Z) / 10;

// The big notes that come to rest on the staves: [staff, beat, p, kind]. At this size a stem is about
// as tall as the gap between two staves, so they alternate beats from staff to staff and a landed
// note never covers another.
const MELODY: [number, number, number, NoteKind][] = [
  [0, 0, 6, 'quarter'], [0, 2, 3, 'eighth'],
  [1, 1, 4, 'half'],
  [2, 0, 2, 'eighth'], [2, 2, 5, 'quarter'],
  [3, 1, 7, 'whole'],
];
const FIRST_CALL = 0.4, CALL_EVERY = 0.75; // seconds: when each note leaves the fall for its place

const landerSpecs = () => MELODY.map(([staff, beat, p, kind], k) => {
  const seed = 100 + k;
  const rnd = (j: number) => Math.abs(Math.sin(seed * 12.9898 + j * 78.233) * 43758.5453) % 1;
  // Where the notehead goes on the page, in scene units at the paper's depth...
  const ppu = pxPerUnit(LAND_Z), hx = (BEATS[beat] - 540) / ppu, hy = (960 - (STAVES[staff] + p * LINE_GAP / 2)) / ppu;
  // ...and so where the note's centre goes: the head sits at an offset from the centre (PARTS), and
  // for a beamed pair it is the left head that marks the pitch.
  const { offset } = PARTS[kind], headX = offset[0] + (kind === 'beamed' ? -0.22 : 0), headY = offset[1];
  const at = FIRST_CALL + k * CALL_EVERY;
  const weight = NOTE_WEIGHT[kind] * (0.9 + rnd(3) * 0.2);
  const scale = 0.7 + rnd(8) * 0.2;
  const landScale = scale * DEPTH_GROW;
  // Start high enough that, falling at about its terminal speed through the 3 s warm-up and up to its
  // call, it is just coming onto the screen above its staff when its moment arrives.
  const fall = PHYS.fallSpeed * weight * 1.07;
  const spec: LeafSpec = {
    weight, scale, radius: noteRadius(kind) * scale,
    x: Math.max(-1.2, Math.min(1.2, ((BEATS[beat] - 540) / pxPerUnit(0)) + (rnd(5) - 0.5) * 0.6)),
    y: 2.1 + fall * (at + PHYS.warmupSeconds),
    z: (rnd(7) - 0.5) * 2 * NOTE_Z,
    swingRate: 1.1 + rnd(1) * 0.7, swingAmp: 0.25 + rnd(6) * 0.2,
    spinRate: (rnd(11) - 0.5) * 1.2, spin0: (rnd(12) - 0.5) * 1.6, lean: (rnd(13) - 0.5) * 0.6, phase0: rnd(2) * Math.PI * 2,
    land: { x: hx - headX * landScale, y: hy - headY * landScale, z: LAND_Z, at },
  };
  return { kind, spec, gold: k === MELODY.length - 1, landScale };
});

// ---- the scene ------------------------------------------------------------------------------------

const Scene = () => {
  const frame = useCurrentFrame();
  const { durationInFrames, fps } = useVideoConfig();
  const gl = useThree((s) => s.gl);
  // Glossy materials show what they reflect; with nothing around them they come out flat. A room
  // environment, prefiltered once, gives the lacquer and the gilt something to catch.
  const env = useMemo(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const tex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    return tex;
  }, [gl]);
  // The env map goes on each material, not on the scene: envMapIntensity only applies to a
  // material's own envMap (scene.environment has one intensity for everything).
  const materials = useMemo(() => ({
    // Engraver's ink, lacquered: black on the page, with a highlight when it turns. The reflection is
    // turned well down: at full strength a flat face turned to the bright side of the room reflects
    // so much of it that black lacquer reads as chrome.
    ink: new THREE.MeshPhysicalMaterial({ color: '#1b120b', roughness: 0.4, clearcoat: 0.6, clearcoatRoughness: 0.2, envMap: env, envMapIntensity: 0.25 }),
    // Gilt, for the few that should catch the eye.
    gold: new THREE.MeshStandardMaterial({ color: '#d4a64a', metalness: 1, roughness: 0.28, envMap: env }),
  }), [env]);

  const notes = useMemo(() => [...noteSpecs(), ...landerSpecs()], []);
  const track = useMemo(() => simulateLeaves(notes.map((n) => n.spec), durationInFrames, fps, { boundZ: NOTE_Z }), [notes, durationInFrames, fps]);
  const f = Math.min(frame, durationInFrames - 1);

  return (
    <>
      <ambientLight intensity={0.5} color="#fff1d6" />
      <directionalLight
        position={[2.5, 3, 7]}
        intensity={1.6}
        color="#ffe2b0"
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-4} shadow-camera-right={4} shadow-camera-top={5} shadow-camera-bottom={-5}
        shadow-camera-near={2} shadow-camera-far={16}
        shadow-bias={-0.001}
        shadow-radius={10}
        shadow-blurSamples={16}
      />
      <mesh position={[0, 0, PAPER_Z]} receiveShadow>
        <planeGeometry args={[20, 20]} />
        <shadowMaterial opacity={0.2} color="#3a1e08" />
      </mesh>
      {notes.map((n, i) => {
        const p = track[i][f];
        // A leaf can spin right round; a note seen edge-on stops being a note. So the simulated spin
        // becomes a rock of at most ~40° either way (collision kicks still show as a lurch), and the
        // tip back towards the camera is halved.
        return (
          // A lander grows as it settles back onto the page, by just enough to cancel the perspective.
          <group key={i} position={[p.x, p.y, p.z]} rotation={[p.rx * 0.5, 0.7 * Math.sin(p.ry), p.rz]} scale={n.spec.scale + (n.landScale - n.spec.scale) * p.landing}>
            <NoteShape kind={n.kind} material={n.gold ? materials.gold : materials.ink} />
          </group>
        );
      })}
    </>
  );
};

// ---- the page -------------------------------------------------------------------------------------
// Staves printed faintly on the paper, so it reads as a score before a single note arrives.
const Staves = () => (
  <svg width={1080} height={1920} style={{ position: 'absolute', inset: 0 }}>
    {STAVES.flatMap((top) => Array.from({ length: 5 }, (_, l) => (
      <line key={`${top}-${l}`} x1={70} x2={1010} y1={top + l * LINE_GAP} y2={top + l * LINE_GAP} stroke="#5a3a1e" strokeOpacity={0.22} strokeWidth={2} />
    )))}
  </svg>
);

// Behind each block of type, the paper fades back in: a note passing under it dims to a ghost
// instead of cutting through the letters.
const GLOW = `radial-gradient(closest-side, ${PAPER}f2 0%, ${PAPER}d9 55%, ${PAPER}00 100%)`;
const Backing = ({ top, h }: { top: number; h: number }) => (
  <div style={{ position: 'absolute', left: -60, right: -60, top, height: h, background: GLOW }} />
);
// A paper-coloured halo behind the ink sharpens the edge of each letter against whatever is under it.
const HALO = `0 0 18px ${PAPER}, 0 0 8px ${PAPER}, 0 0 3px ${PAPER}`;
const serif = (size: number, weight: number, extra: CSSProperties = {}): CSSProperties => ({
  fontFamily: '"Cormorant Garamond"', fontWeight: weight, fontSize: size, lineHeight: 1.02, color: INK,
  fontVariantNumeric: 'lining-nums', textAlign: 'center', textShadow: HALO, ...extra,
});

const pianoVolume = (f: number, total: number) => {
  return interpolate(f, [0, 15, total - 45, total], [0, 0.8, 0.8, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
};

export const BaroqueStory = ({ title, kicker, when, venue, price }: BaroqueStoryProps) => {
  const { width, height, durationInFrames } = useVideoConfig();
  return (
    <AbsoluteFill>
      <Audio src={staticFile('sfx/piano.mp3')} trimBefore={150} volume={(f) => pianoVolume(f, durationInFrames)} />
      <AbsoluteFill>
        <Img src={staticFile('parchment.png')} style={{ width, height }} />
      </AbsoluteFill>
      <AbsoluteFill><Staves /></AbsoluteFill>
      <AbsoluteFill>
        <ThreeCanvas width={width} height={height} shadows="variance" camera={{ position: [0, 0, 10], fov: 30 }}>
          <Scene />
        </ThreeCanvas>
      </AbsoluteFill>
      {/* Above the canvas: the notes fall behind the type, never over it. */}
      <AbsoluteFill>
        <Backing top={110} h={540} />
        <Backing top={1500} h={300} />
      </AbsoluteFill>
      <AbsoluteFill style={{ alignItems: 'center', paddingTop: 170 }}>
        <div style={{ fontFamily: '"Great Vibes"', fontSize: 92, lineHeight: 1, color: RUST, textShadow: HALO }}>{kicker}</div>
        <div style={{ height: 34 }} />
        {title.map((line) => <div key={line} style={serif(118, 700, { letterSpacing: 4 })}>{line}</div>)}
      </AbsoluteFill>
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 190 }}>
        <div style={serif(46, 600, { letterSpacing: 5 })}>{when}</div>
        <div style={{ height: 22 }} />
        <div style={serif(36, 500, { letterSpacing: 4 })}>{venue}</div>
        <div style={{ height: 22 }} />
        <div style={serif(46, 700, { color: RUST, letterSpacing: 3 })}>{price}</div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
