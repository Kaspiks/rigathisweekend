// A test bench for the mosaic pieces (public/mosaic-pieces, built by scripts/build-mosaic-pieces.mjs):
// all eight in a grid, each turning slowly to show its back and its thickness, with the corner and
// edge bones lifting so the skinning is visible. Not a story.
import { useLoader } from '@react-three/fiber';
import { ThreeCanvas } from '@remotion/three';
import { useLayoutEffect, useMemo } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneRigged } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { AbsoluteFill, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';

export const MOSAIC_PIECES = [
  'rust_herringbone_wool', 'indigo_denim_twill', 'mustard_knit', 'oatmeal_linen',
  'forest_tartan', 'burgundy_crushed_velvet', 'latvian_auseklis_weave', 'brown_houndstooth',
] as const;
const URLS = MOSAIC_PIECES.map((n) => staticFile(`mosaic-pieces/${n}.glb`));

const Piece = ({ scene, i, position }: { scene: THREE.Group; i: number; position: [number, number, number] }) => {
  const frame = useCurrentFrame();
  const piece = useMemo(() => {
    const c = cloneRigged(scene) as THREE.Group;
    c.traverse((o) => { if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
    return c;
  }, [scene]);
  const bone = (name: string) => piece.getObjectByName(name) as THREE.Bone;
  const t = frame / 30 + i * 0.7;
  useLayoutEffect(() => {
    // Lift a corner and let the opposite edge flutter: translation in z is all it takes.
    bone('Corner_TR').position.z = 0.12 * (0.5 + 0.5 * Math.sin(t * 1.6));
    bone('Corner_BL').position.z = 0.06 * Math.sin(t * 1.3 + 1);
    bone('Edge_L').position.z = 0.05 * Math.sin(t * 2.1);
  });
  // Swings far enough past side-on to show the back, and slows at the ends so each side reads.
  const turn = Math.sin(frame / 30 * 0.8 + i * 0.4) * 2.1;
  return <primitive object={piece} position={position} rotation={[-0.25, turn, 0.05]} />;
};

const Scene = () => {
  const gltfs = useLoader(GLTFLoader, URLS);
  return (
    <>
      <ambientLight intensity={0.5} />
      <hemisphereLight args={['#fff4e0', '#3a2a1a', 0.6]} />
      <directionalLight position={[3, 4, 6]} intensity={2.4} castShadow shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-3} shadow-camera-right={3} shadow-camera-top={4} shadow-camera-bottom={-4} />
      {gltfs.map((g, i) => (
        <Piece key={i} scene={g.scene} i={i} position={[(i % 2 ? 0.62 : -0.62), 1.95 - Math.floor(i / 2) * 1.3, 0]} />
      ))}
    </>
  );
};

export const MosaicDemo = () => {
  const { width, height } = useVideoConfig();
  return (
    <AbsoluteFill style={{ background: 'linear-gradient(180deg, #3b2f26 0%, #1e1712 100%)' }}>
      <AbsoluteFill>
        <ThreeCanvas width={width} height={height} shadows camera={{ position: [0, 0, 9], fov: 34 }}>
          <Scene />
        </ThreeCanvas>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
