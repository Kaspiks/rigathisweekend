// Autumn story: a sheet of old parchment with a three.js scene laid over it. The parchment is a flat
// baked PNG (see ParchmentPlate); everything that moves lives in <Scene>, which is ordinary
// react-three-fiber — add meshes there.
//
// The one rule that differs from plain r3f: drive animation from useCurrentFrame(), never useFrame().
// Remotion renders frames out of order and in parallel, so anything that accumulates state per tick
// will come out different on every render. Compute each transform as a pure function of the frame.
import { useLoader } from '@react-three/fiber';
import { ThreeCanvas } from '@remotion/three';
import { useLayoutEffect, useMemo } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneRigged } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { type LeafPose, type LeafSpec, PHYS, simulateLeaves } from './leafPhysics';
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';

export type AutumnStoryProps = { holdSeconds: number };

export const AUTUMN_FPS = 30;
export const autumnDuration = (holdSeconds: number) => Math.round(Math.max(1, holdSeconds) * AUTUMN_FPS);

// Palette for the scene, picked to sit on the parchment rather than fight it.
export const AUTUMN = { rust: '#a8431c', ember: '#c8612a', ochre: '#d19a3a', mustard: '#b8862b', umber: '#5a3a1e', ink: '#2e1f12' } as const;

// Full-frame, not a 900px tile like the other stories: the stains are big enough that a repeat shows
// as a hard seam across the sheet. It is baked once, so the size costs nothing at render time.
const tex = (freq: number, oct: number, seed: number, m: string) =>
  `url("data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920"><filter id="f" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="${oct}" seed="${seed}"/><feColorMatrix values="${m}"/></filter><rect width="1080" height="1920" filter="url(#f)"/></svg>`)}")`;

// Parchment is three things at different scales: fibre (fine, faint), mottling where the skin took
// the lime unevenly (medium, warm), and big water-stain blotches (coarse, only the peaks kept so they
// read as patches, not a haze). The edges darken where hands and years got at them.
const FIBRE = tex(0.8, 3, 9, '0 0 0 0 0.42  0 0 0 0 0.3  0 0 0 0 0.16  0 0 0 0.16 0');
const MOTTLE = tex(0.012, 4, 23, '0 0 0 0 0.62  0 0 0 0 0.4  0 0 0 0 0.16  0 0 0 0.5 -0.14');
const STAIN = tex(0.004, 3, 41, '0 0 0 0 0.55  0 0 0 0 0.32  0 0 0 0 0.12  0 0 0 2.2 -1.05');
const PARCHMENT = `${FIBRE}, ${MOTTLE}, ${STAIN}, linear-gradient(172deg, #f1e2bf 0%, #e8d3a4 48%, #d9bd86 100%)`;
const SCORCH = 'radial-gradient(85% 60% at 50% 48%, transparent 50%, rgba(120,62,20,0.28) 82%, rgba(70,34,10,0.62) 100%)';

// Baked for the same reason as ClothPlate: static noise re-rasterised every frame is wasted time.
// Re-bake after touching anything above:
//   npx remotion still src/index.ts ParchmentPlate public/parchment.png
export const ParchmentPlate = () => (
  <AbsoluteFill>
    <AbsoluteFill style={{ background: PARCHMENT }} />
    <AbsoluteFill style={{ background: SCORCH }} />
  </AbsoluteFill>
);

// ---- the rigged leaves -------------------------------------------------------------------------
// public/rigged-leaves: eight photographed leaves, each a 1x1-unit plane (stem at the bottom, facing
// +z) with the photo baked in and an 11-bone skeleton. The midrib is a chain up the centre —
// Stem > Midrib_Lower > Midrib_Center > Midrib_Upper > Tip — and each midrib bone carries a pair of
// side bones, Lobe_{Lower,Mid,Upper}_{L,R}. Rotating a midrib bone about x curls the leaf along its
// length; rotating the lobes about y cups it across.
const LEAVES = [
  'autumn_maple_leaf_cutout', 'autumn_serrated_leaf_cutout', 'dried_russet_oak_leaf_cutout',
  'golden_autumn_aspen_leaf_cutout', 'golden_serrated_autumn_birch_leaf', 'realistic_autumn_oak_leaf_cutout',
  'weathered_autumn_birch_leaf', 'weathered_autumn_maple_leaf',
] as const;
const LEAF_URLS = LEAVES.map((n) => staticFile(`rigged-leaves/${n}.glb`));

// The files ship an unlit, alpha-blended material. Unlit means a tumbling leaf never catches the
// light, so it reads as a sticker; blended means a dozen overlapping leaves depend on draw order and
// pop in front of each other. A lit material with an alpha CUTOUT fixes both, and alphaTest is also
// what lets the shadow pass use the leaf's outline rather than the square plane. The files have no
// normals, which lighting needs. Done once per loaded file: the loader caches, and clones share it.
const prepare = (scene: THREE.Group) => {
  if (scene.userData.prepared) return;
  scene.userData.prepared = true;
  scene.traverse((o) => {
    if (!(o instanceof THREE.SkinnedMesh)) return;
    o.geometry.computeVertexNormals();
    const map = (o.material as THREE.MeshBasicMaterial).map;
    o.material = new THREE.MeshStandardMaterial({ map, side: THREE.DoubleSide, alphaTest: 0.5, roughness: 0.85 });
    o.castShadow = true;
    o.frustumCulled = false; // the bounds are the flat bind pose; a curled leaf can poke outside them
  });
};

type Bones = Record<'Midrib_Lower' | 'Midrib_Center' | 'Midrib_Upper' | 'Tip' | 'Lobe_Lower_L' | 'Lobe_Lower_R' | 'Lobe_Mid_L' | 'Lobe_Mid_R' | 'Lobe_Upper_L' | 'Lobe_Upper_R', THREE.Bone>;

// The motion comes from leafPhysics (simulated once, looked up by frame); this only applies it.
const RiggedLeaf = ({ scene, scale, pose, curl0, cup0 }: { scene: THREE.Group; scale: number; pose: LeafPose; curl0: number; cup0: number }) => {
  // SkeletonUtils, not scene.clone(): a plain clone keeps pointing at the ORIGINAL bones, so every
  // copy of a file would bend as one.
  const leaf = useMemo(() => cloneRigged(scene) as THREE.Group, [scene]);
  const bones = useMemo(() => {
    const b = {} as Bones;
    leaf.traverse((o) => { if (o instanceof THREE.Bone) (b as Record<string, THREE.Bone>)[o.name] = o; });
    return b;
  }, [leaf]);

  // Pose the skeleton before r3f draws: layout effects run ahead of ThreeCanvas's per-frame advance().
  useLayoutEffect(() => {
    // Dried leaves are never flat; the flutter doubles the swing rate, as the air slips off each edge.
    const curl = curl0 + Math.sin(pose.phase * 2) * 0.16;
    const cup = cup0 + Math.sin(pose.phase * 2.3 + 1) * 0.14;
    bones.Midrib_Lower.rotation.x = curl * 0.35;
    bones.Midrib_Center.rotation.x = curl * 0.5;
    bones.Midrib_Upper.rotation.x = curl * 0.6;
    bones.Tip.rotation.x = curl * 0.5;
    for (const [side, k] of [['L', 1], ['R', -1]] as const) {
      bones[`Lobe_Lower_${side}`].rotation.y = cup * k * 0.7;
      bones[`Lobe_Mid_${side}`].rotation.y = cup * k;
      bones[`Lobe_Upper_${side}`].rotation.y = cup * k * 0.8;
    }
  });

  return <primitive object={leaf} position={[pose.x, pose.y, pose.z]} rotation={[pose.rx, pose.ry, pose.rz]} scale={scale} />;
};

// How heavy each model is in the fall. Dry, papery leaves are light: they drift slowly and get
// knocked about; a thick oak leaf falls faster and shoulders the others aside.
const LEAF_WEIGHT: Record<(typeof LEAVES)[number], number> = {
  autumn_maple_leaf_cutout: 1.0, autumn_serrated_leaf_cutout: 0.9, dried_russet_oak_leaf_cutout: 0.75,
  golden_autumn_aspen_leaf_cutout: 0.8, golden_serrated_autumn_birch_leaf: 0.7, realistic_autumn_oak_leaf_cutout: 1.25,
  weathered_autumn_birch_leaf: 0.7, weathered_autumn_maple_leaf: 0.9,
};

const N_LEAVES = 12;
// Everything about leaf i that does not change over the video. Lanes are shuffled with a stride
// coprime to the count, so neighbouring leaves start far apart; pure randomness bunches them up.
const leafSpecs = () => Array.from({ length: N_LEAVES }, (_, i) => {
  const seed = i + 1;
  const rnd = (k: number) => Math.abs(Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453) % 1;
  const model = i % LEAVES.length;
  const scale = 0.85 + rnd(8) * 0.5;
  const spec: LeafSpec = {
    weight: LEAF_WEIGHT[LEAVES[model]] * (0.9 + rnd(3) * 0.2),
    scale,
    x: (((((i * 5) % N_LEAVES) + 0.5) / N_LEAVES) - 0.5) * 2.6,
    y: PHYS.top - rnd(4) * PHYS.span,
    z: (rnd(7) - 0.5) * 2.4,
    swingRate: 1.1 + rnd(1) * 0.7,
    swingAmp: 0.3 + rnd(6) * 0.25,
    spinRate: (rnd(11) - 0.5) * 0.9,
    spin0: rnd(12) * 6,
    lean: (rnd(13) - 0.5) * 0.8,
    phase0: rnd(2) * Math.PI * 2,
  };
  return { model, scale, spec, curl0: 0.12 + rnd(9) * 0.18, cup0: 0.1 + rnd(10) * 0.2 };
});

// ---- the scene -----------------------------------------------------------------------------------
// Camera sits at z=10 with a 30° fov, so the plane z=0 shows roughly 3 units wide by 5.4 tall.
const PAPER_Z = -2.2;
const Scene = () => {
  const frame = useCurrentFrame();
  const { durationInFrames, fps } = useVideoConfig();
  const specs = useMemo(leafSpecs, []);
  const track = useMemo(() => simulateLeaves(specs.map((l) => l.spec), durationInFrames, fps), [specs, durationInFrames, fps]);
  const gltfs = useLoader(GLTFLoader, LEAF_URLS); // suspends; ThreeCanvas holds the frame until loaded
  const scenes = useMemo(() => gltfs.map((g) => { prepare(g.scene); return g.scene; }), [gltfs]);
  // Example of a one-off tween: the key light swings in over the first second.
  const lightX = interpolate(frame, [0, 30], [-3, 2.5], { extrapolateRight: 'clamp' });
  return (
    <>
      <ambientLight intensity={1.3} color="#fff1d6" />
      <directionalLight
        position={[lightX, 3, 7]}
        intensity={1.8}
        color="#ffe2b0"
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-4} shadow-camera-right={4} shadow-camera-top={5} shadow-camera-bottom={-5}
        shadow-camera-near={2} shadow-camera-far={16}
        shadow-bias={-0.001}
        shadow-radius={10}
        shadow-blurSamples={16}
      />
      {/* An invisible sheet level with the parchment that only shows shadow: it is what makes the
          leaves sit ABOVE the paper rather than on it. */}
      <mesh position={[0, 0, PAPER_Z]} receiveShadow>
        <planeGeometry args={[20, 20]} />
        <shadowMaterial opacity={0.2} color="#3a1e08" />
      </mesh>
      {specs.map((l, i) => (
        <RiggedLeaf key={i} scene={scenes[l.model]} scale={l.scale} pose={track[i][Math.min(frame, durationInFrames - 1)]} curl0={l.curl0} cup0={l.cup0} />
      ))}
      {/* Add your meshes here. */}
    </>
  );
};

export const AutumnStory = (_: AutumnStoryProps) => {
  const { width, height } = useVideoConfig();
  return (
    <AbsoluteFill>
      <AbsoluteFill from={-3}>
        <Img src={staticFile('parchment.png')} style={{ width, height }} from={-3} />
      </AbsoluteFill>
      {/* Its own layer, not a sibling in AbsoluteFill's flex column: there the image takes the full
          height and the canvas shrinks to 0, and r3f waits forever for a non-zero size. The canvas is
          transparent, so the parchment shows through wherever the scene is empty. */}
      <AbsoluteFill>
        {/* Variance shadow maps, because they can be blurred (shadow-radius); a leaf a hand above the
            paper throws a soft shadow, and the default PCF edges read as cut paper. */}
        <ThreeCanvas width={width} height={height} shadows="variance" camera={{ position: [0, 0, 10], fov: 30 }}>
          <Scene />
        </ThreeCanvas>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
