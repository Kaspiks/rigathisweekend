// Story opener: the day's grid is buried under a drift of real autumn leaves (the eight rigged models in
// public/rigged-leaves), with a label card lying on top. A gust comes through from the left: each leaf
// trembles as it arrives, then lifts, tumbles and flies off, and the grid is uncovered behind the gust.
// The card slides down into the strip the grid leaves clear and becomes the footer band.
//
// The motion is written as a function of the frame for every leaf, not simulated: a leaf's whole flight
// follows from when the gust reaches it, so any frame can be drawn on its own, as Remotion requires.
import { useLoader } from '@react-three/fiber';
import { ThreeCanvas } from '@remotion/three';
import { useLayoutEffect, useMemo } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneRigged } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { AbsoluteFill, Easing, Img, staticFile, useCurrentFrame } from 'remotion';
import { A, AUTUMN_FPS, BAR_H, Band, fit, grain, lerp, range, script, serif, sheetSrc, type AutumnOpenerProps } from './autumnOpener';
import { Sfx } from './sfx';

const T = {
  gust: [14, 66],   // the gust front crosses the screen, left to right
  card: [40, 70],   // the gust reaches the label card and carries it off, like the leaves
  band: [60, 76],   // the footer band slides up once the card has gone
} as const;
export const GUST_OPEN_FRAMES = T.band[1];
export const gustDuration = (holdSeconds: number) => GUST_OPEN_FRAMES + Math.round(Math.max(1, holdSeconds) * AUTUMN_FPS);

// The camera sits at z = 10 with a 30 degree field of view, so the screen is 5.36 units tall and 3.02 wide:
// one unit is about 358 pixels. A leaf model is a 1 x 1 unit plane with its stem at the bottom.
const LEAVES = [
  'autumn_maple_leaf_cutout', 'autumn_serrated_leaf_cutout', 'dried_russet_oak_leaf_cutout',
  'golden_autumn_aspen_leaf_cutout', 'golden_serrated_autumn_birch_leaf', 'realistic_autumn_oak_leaf_cutout',
  'weathered_autumn_birch_leaf', 'weathered_autumn_maple_leaf',
] as const;
const LEAF_URLS = LEAVES.map((n) => staticFile(`rigged-leaves/${n}.glb`));

// The same preparation as the autumn story: lit material with an alpha cutout, so the leaves catch the
// light and overlap cleanly instead of popping in front of each other.
const prepare = (scene: THREE.Group) => {
  if (scene.userData.prepared) return;
  scene.userData.prepared = true;
  scene.traverse((o) => {
    if (!(o instanceof THREE.SkinnedMesh)) return;
    o.geometry.computeVertexNormals();
    const map = (o.material as THREE.MeshBasicMaterial).map;
    o.material = new THREE.MeshStandardMaterial({ map, side: THREE.DoubleSide, alphaTest: 0.5, roughness: 0.85 });
    // Every leaf throws a shadow onto the leaves under it and onto the poster: without that a pile of photos
    // reads as a collage of stickers. alphaTest makes the shadow leaf-shaped rather than square.
    o.castShadow = true;
    o.receiveShadow = true;
    // Leaves are drawn strictly bottom to top (renderOrder, set per frame from the stack), never by depth
    // testing: a tilted, curled leaf lying on another would otherwise poke its edges through it. Like real
    // layers of paper, one can only ever lie on another. Shadows still come from the true 3D positions.
    // They go in the transparent pass (still cut out by alphaTest, so no blending), which is ordered by
    // renderOrder: the shadow sheet under them (renderOrder 0) is drawn first. Without depth testing nothing
    // writes depth, so a sheet drawn afterwards would lay the pile's whole shadow over the leaves themselves.
    const m = o.material as THREE.MeshStandardMaterial;
    m.transparent = true; m.depthTest = false; m.depthWrite = false;
    o.frustumCulled = false;
  });
};

// The drift: leaves on a jittered 5 x 8 lattice so the pile covers the screen without bald patches, each
// with its own turn, tilt, size and how it will fly. Layered in depth by index, so they overlap in order.
// How much each model resists the wind: a thick oak leaf lifts later and travels slower than papery birch.
const WEIGHT = [1.0, 0.9, 0.8, 0.75, 0.7, 1.3, 0.7, 0.95];
// How bright each model reads, 0 to 1: the golden and red leaves sit towards the top of the pile, the way the
// freshest fall lies on the older, browner ones, so the pile reads as autumn rather than as mulch.
const FRESH = [0.8, 0.7, 0.1, 1.0, 0.9, 0.45, 0.25, 0.35];
const COLS = 6, ROWS = 9, N = COLS * ROWS; // thick enough that the poster never shows through until the wind uncovers it
const rnd = (seed: number, k: number) => Math.abs(Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453) % 1;
type Leaf = { model: number; x: number; y: number; z: number; rz: number; rx: number; ry: number; scale: number;
  release: number; vx: number; vy: number; spin: number; tumble: number; phase: number; curl: number; cup: number; weight: number };
const DRIFT: Leaf[] = Array.from({ length: N }, (_, i) => {
  const c = i % COLS, r = Math.floor(i / COLS), s = i + 1;
  const x = -1.55 + (c + 0.5) * (3.1 / COLS) + (rnd(s, 1) - 0.5) * 0.3;
  const y = -2.8 + (r + 0.5) * (5.6 / ROWS) + (rnd(s, 2) - 0.5) * 0.3;
  return {
    // Its layer in the pile: shuffled with a stride coprime to N, so lattice neighbours sit at different depths.
    model: (i * 3) % LEAVES.length, x, y, z: ((i * 23) % N) * 0.012 + FRESH[(i * 3) % LEAVES.length] * 0.5,
    // Lying in a pile a leaf is pressed nearly flat by the ones on top of it: only a slight tilt.
    rz: rnd(s, 4) * Math.PI * 2, rx: (rnd(s, 5) - 0.5) * 0.14, ry: (rnd(s, 6) - 0.5) * 0.14, scale: 1.1 + rnd(s, 7) * 0.5,
    // When the gust reaches this leaf: the front's crossing time at its x, give or take a little.
    release: 0, vx: 0.09 + rnd(s, 8) * 0.07, vy: 0.02 + rnd(s, 9) * 0.05, spin: (rnd(s, 10) - 0.35) * 0.35,
    tumble: 0.08 + rnd(s, 11) * 0.12, phase: rnd(s, 12) * 6.28, curl: 0.1 + rnd(s, 13) * 0.18, cup: 0.06 + rnd(s, 14) * 0.14,
    weight: WEIGHT[(i * 3) % LEAVES.length] * (0.9 + rnd(s, 16) * 0.2),
  };
});
// Leaves the gust brings with it from off-screen: they cross first, so the wind is visible before the pile moves.
const CARRIED: Leaf[] = Array.from({ length: 9 }, (_, i) => {
  const s = 100 + i;
  return {
    model: (i * 5 + 2) % LEAVES.length, x: -2.3 - rnd(s, 1) * 0.6, y: -2.2 + rnd(s, 2) * 4.4, z: 0.9 + rnd(s, 3) * 0.6,
    rz: rnd(s, 4) * 6.28, rx: rnd(s, 5) * 1.2, ry: rnd(s, 6) * 1.2, scale: 0.8 + rnd(s, 7) * 0.4,
    release: T.gust[0] - 10 + Math.round(rnd(s, 8) * 26), vx: 0.07 + rnd(s, 9) * 0.04, vy: (rnd(s, 10) - 0.5) * 0.03,
    spin: (rnd(s, 11) - 0.5) * 0.3, tumble: 0.1 + rnd(s, 12) * 0.12, phase: rnd(s, 13) * 6.28, curl: 0.3, cup: 0.25, weight: 0.8,
  };
});
const gustX = (frame: number) => lerp(-2.1, 2.3, range(frame, T.gust, Easing.bezier(0.45, 0, 0.55, 1)));
for (const [i, l] of DRIFT.entries()) {
  let f = T.gust[0];
  while (f < T.gust[1] + 20 && gustX(f) < l.x + (rnd(i + 1, 15) - 0.5) * 0.5) f++;
  l.release = f + Math.round((l.weight - 0.7) * 14);
}

type Pose = { x: number; y: number; z: number; rx: number; ry: number; rz: number; flutter: number; gone: boolean };
const poseAt = (l: Leaf, frame: number): Pose => {
  const t = frame - l.release;
  if (t < 0) {
    // Waiting: a shiver that grows as the gust gets close.
    const near = Math.max(0, 1 - (l.x - gustX(frame)) / 0.8);
    const shiver = near * near * Math.sin(frame * 1.7 + l.phase) * 0.08;
    return { x: l.x, y: l.y, z: l.z, rx: l.rx + shiver, ry: l.ry, rz: l.rz + shiver, flutter: 0, gone: false };
  }
  // Caught. First the edge nearest the wind lifts and the leaf peels up off the pile, standing on edge;
  // then the air carries it: slow to start, faster as it catches more wind, wobbling up and down as it
  // rides the eddies, and tumbling end over end. Heavier leaves are pushed less hard.
  const airborne = l.x < -2;
  const peel = airborne ? 0 : Math.min(1, t / 8), push = 1 / l.weight;
  const air = airborne ? t + 8 : Math.max(0, t - 5);
  const x = l.x + (l.vx * 0.35 * air + 0.0024 * air * air) * push;
  // Gravity never stops: the wind lifts a leaf a little, then its weight brings it down in an arc, so a heavy
  // oak leaf skids low and drops out while a light birch leaf rides further. Pressed-flat leaves open up in the air.
  const y = l.y + l.vy * air * push + Math.sin(air * 0.22 + l.phase) * 0.16 * Math.min(1, air / 10) + 0.08 * peel
    - 0.0011 * air * air * l.weight;
  const z = l.z + 0.32 * peel + 0.004 * air; // up off the pile, but low: a leaf in the wind skims, it does not fly at you
  return {
    x, y, z,
    rx: l.rx + 1.1 * peel * Math.sign(Math.sin(l.phase) || 1) + l.tumble * air * 0.8 * push,
    ry: l.ry + 0.6 * peel + l.tumble * 0.5 * air * push,
    rz: l.rz + l.spin * air * push,
    flutter: t, gone: x > 2.6,
  };
};

type Bones = Record<'Midrib_Lower' | 'Midrib_Center' | 'Midrib_Upper' | 'Tip' | 'Lobe_Lower_L' | 'Lobe_Lower_R' | 'Lobe_Mid_L' | 'Lobe_Mid_R' | 'Lobe_Upper_L' | 'Lobe_Upper_R', THREE.Bone>;
const GustLeaf = ({ scene, leaf, frame }: { scene: THREE.Group; leaf: Leaf; frame: number }) => {
  const obj = useMemo(() => cloneRigged(scene) as THREE.Group, [scene]);
  const bones = useMemo(() => {
    const b = {} as Bones;
    obj.traverse((o) => { if (o instanceof THREE.Bone) (b as Record<string, THREE.Bone>)[o.name] = o; });
    return b;
  }, [obj]);
  const pose = poseAt(leaf, frame);
  useLayoutEffect(() => {
    // Draw order follows height above the pile, so a leaf lifted by the wind is drawn over those still lying.
    obj.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.renderOrder = 1 + Math.round(pose.z * 1000); });
    // Lying in the pile a leaf is curled and cupped as it dried; in the air it flutters, faster as it goes.
    const curl = leaf.curl + Math.sin(pose.flutter * 0.9 + leaf.phase) * 0.22 * Math.min(1, pose.flutter / 4);
    const cup = leaf.cup + Math.sin(pose.flutter * 1.1 + leaf.phase + 1) * 0.18 * Math.min(1, pose.flutter / 4);
    bones.Midrib_Lower.rotation.x = curl * 0.35; bones.Midrib_Center.rotation.x = curl * 0.5;
    bones.Midrib_Upper.rotation.x = curl * 0.6; bones.Tip.rotation.x = curl * 0.5;
    for (const [side, k] of [['L', 1], ['R', -1]] as const) {
      bones[`Lobe_Lower_${side}`].rotation.y = cup * k * 0.7;
      bones[`Lobe_Mid_${side}`].rotation.y = cup * k;
      bones[`Lobe_Upper_${side}`].rotation.y = cup * k * 0.8;
    }
  });
  if (pose.gone) return null;
  return <primitive object={obj} position={[pose.x, pose.y, pose.z]} rotation={[pose.rx, pose.ry, pose.rz]} scale={leaf.scale} />;
};

const Drift = ({ frame }: { frame: number }) => {
  const gltfs = useLoader(GLTFLoader, LEAF_URLS); // suspends; ThreeCanvas holds the frame until they load
  const scenes = useMemo(() => gltfs.map((g) => { prepare(g.scene); return g.scene; }), [gltfs]);
  return (
    <>
      {/* Late-afternoon light: a warm low sun from the upper left doing most of the work, a sky/ground fill
          so the shadowed sides are not black, and little flat ambient, which is what made the pile look painted. */}
      <ambientLight intensity={0.45} color="#fff0d6" />
      <hemisphereLight args={['#fff4e2', '#6a4428', 1.0]} />
      <directionalLight position={[-2.6, 3.4, 8]} intensity={2.8} color="#ffdcaa" castShadow
        shadow-mapSize={[2048, 2048]} shadow-camera-left={-2.4} shadow-camera-right={2.4} shadow-camera-top={3.4} shadow-camera-bottom={-3.4}
        shadow-camera-near={2} shadow-camera-far={16} shadow-bias={-0.0004} shadow-normalBias={0.02} />
      {/* The poster lies on the ground under the leaves; this invisible sheet over it only shows the shadows
          falling on it, so the grid underneath (drawn in the page, behind the canvas) keeps its exact colours. */}
      <mesh position={[0, 0, -0.02]} receiveShadow renderOrder={0}>
        <planeGeometry args={[4.2, 6.4]} />
        <shadowMaterial transparent opacity={0.42} />
      </mesh>
      {DRIFT.map((l, i) => <GustLeaf key={i} scene={scenes[l.model]} leaf={l} frame={frame} />)}
      {CARRIED.map((l, i) => frame >= l.release ? <GustLeaf key={`c${i}`} scene={scenes[l.model]} leaf={l} frame={frame} /> : null)}
    </>
  );
};

// The label card resting on the leaves: cream card stock with a deckled border.
const CW = 760, CH = 640;
const Card = ({ day, date, kicker, category, count }: Omit<AutumnOpenerProps, 'sheet' | 'holdSeconds'>) => (
  <div style={{ width: CW, height: CH, background: `${grain(0.12)}, ${A.cream}`, borderRadius: 8, position: 'relative',
    display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 58 }}>
    <div style={{ position: 'absolute', inset: 22, border: `2px solid ${A.rust}55`, borderRadius: 4 }} />
    <div style={serif(30, 700, { letterSpacing: '0.34em', color: A.rust })}>RĪGA · THIS WEEKEND</div>
    <div style={serif(fit(day, 138, 820), 700, { marginTop: 34, letterSpacing: '0.08em', marginRight: '-0.08em' })}>{day}</div>
    <div style={serif(54, 600, { marginTop: 14, letterSpacing: '0.2em', marginRight: '-0.2em' })}>{date}</div>
    <div style={{ ...script(104), marginTop: 30 }}>{kicker}</div>
    <div style={serif(fit(category, 56, 900), 500, { marginTop: 10, letterSpacing: '0.04em' })}>{category}</div>
    <div style={serif(24, 700, { marginTop: 30, letterSpacing: '0.3em', color: A.barkSoft })}>{count} {count === 1 ? 'EVENT' : 'EVENTS'}</div>
  </div>
);

export const LeafGustStory = ({ day, date, kicker, category, count, sheet }: AutumnOpenerProps) => {
  const frame = useCurrentFrame();
  // The card is paper lying on the leaves: the gust lifts its near edge, then carries it off to the right,
  // turning and rising a little as it catches the air, gone before the band arrives. It never changes size.
  const band = range(frame, T.band, Easing.bezier(0.2, 0.9, 0.2, 1));
  const t = Math.max(0, frame - T.card[0]), lift = Math.min(1, t / 8);
  const cardX = (1080 - CW) / 2 + 0.9 * t * t + 6 * t;
  const cardY = 560 - 70 * lift - 1.2 * t + Math.sin(t * 0.3) * 18 * lift;
  const cardTurn = -4 + 10 * lift + 0.9 * t;
  const cardTilt = 22 * lift + Math.sin(t * 0.45) * 10 * lift; // the lifted edge, seen in perspective
  // Resting: a tight contact shadow where it touches the leaves and a soft wide one; lifted, the shadow spreads.
  const shadowNear = `drop-shadow(0 ${lerp(3, 26, lift).toFixed(0)}px ${lerp(4, 30, lift).toFixed(0)}px rgba(20,10,4,${lerp(0.55, 0.3, lift).toFixed(2)}))`;
  const shadowFar = `drop-shadow(0 ${lerp(18, 60, lift).toFixed(0)}px ${lerp(40, 80, lift).toFixed(0)}px rgba(20,10,4,0.3))`;

  return (
    <AbsoluteFill
      style={{
        background: A.soil,
        overflow: 'hidden'
      }}
      from={-35}
    >
      <Img src={sheetSrc(sheet)} style={{ position: 'absolute', width: 1080, height: 1920, objectFit: 'cover' }} />
      {/* The poster is simply there, under the leaves, from the first frame: it shows wherever they are not. */}
      <AbsoluteFill from={-3}>
        {/* Soft (PCF) shadows rather than variance ones, which smear shadow across leaves lying almost on top of
            each other and muddy the pile. Tone mapping stays on: without it the photographed leaves come out dull. */}
        <ThreeCanvas width={1080} height={1920} shadows="soft" camera={{ position: [0, 0, 10], fov: 30 }} gl={{ antialias: true, alpha: true }}>
          <Drift frame={frame} />
        </ThreeCanvas>
      </AbsoluteFill>
      {cardX < 1300 && (
        <div style={{ position: 'absolute', left: cardX, top: cardY, width: CW, height: CH, perspective: 1600,
          filter: `${shadowNear} ${shadowFar}` }}>
          <div style={{ width: CW, height: CH, transformOrigin: '100% 50%', transform: `rotate(${cardTurn}deg) rotateY(${cardTilt}deg)` }}>
            <Card day={day} date={date} kicker={kicker} category={category} count={count} />
            {/* Card stock is never perfectly flat: a faint bow in the light, stronger as the edge lifts. */}
            <div style={{ position: 'absolute', inset: 0, borderRadius: 8, background: `linear-gradient(100deg, rgba(255,250,235,${(0.18 + 0.1 * lift).toFixed(2)}) 0%, rgba(0,0,0,0) 38%, rgba(60,30,10,${(0.08 + 0.18 * lift).toFixed(2)}) 100%)` }} />
          </div>
        </div>
      )}
      {/* Sound: a swell of wind under the gust front with its leaves, the card carried off, the band. */}
      <Sfx at={T.gust[0] - 8} name="leaf-swell" volume={0.45} />
      <Sfx at={T.gust[0] - 2} name="leaf-gust" volume={0.85} />
      <Sfx at={T.card[0]} name="leaf-woosh" volume={0.55} />
      <Sfx at={T.band[0]} name="paper-slide" volume={0.45} />
      <Band day={day} date={date} category={category} grow={band} />
    </AbsoluteFill>
  );
};
