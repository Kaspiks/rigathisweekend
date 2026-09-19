// Single-event story for a textile exhibition: sixteen squares of cloth tumble down over linen, knock
// into each other, and settle one by one into a 4x4 mosaic, corners fluttering as each one lands.
// The pieces are public/mosaic-pieces (scripts/build-mosaic-pieces.mjs); the motion is
// mosaicPhysics.ts, simulated once and read by frame.
import '@fontsource/cormorant-garamond/500.css';
import '@fontsource/cormorant-garamond/600.css';
import '@fontsource/cormorant-garamond/700.css';
import '@fontsource/great-vibes/400.css';
import { useLoader } from '@react-three/fiber';
import { ThreeCanvas } from '@remotion/three';
import type { CSSProperties } from 'react';
import { useLayoutEffect, useMemo } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneRigged } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { AbsoluteFill, Audio, Img, Sequence, continueRender, delayRender, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { MOSAIC_LAYOUT, type MosaicPose, type MosaicSpec, mosaicSpecs, simulateMosaic } from './mosaicPhysics';

const fonts = delayRender('Loading mosaic fonts');
Promise.all([
  document.fonts.load('700 104px "Cormorant Garamond"'),
  document.fonts.load('600 44px "Cormorant Garamond"'),
  document.fonts.load('500 34px "Cormorant Garamond"'),
  document.fonts.load('84px "Great Vibes"'),
]).then(() => continueRender(fonts));

export type MosaicStoryProps = { title: string[]; kicker: string; when: string; venue: string; price: string; holdSeconds: number };

export const MOSAIC_FPS = 30;
// Every piece has landed by frame 153 (checked numerically); the hold starts after that.
export const MOSAIC_OPEN_FRAMES = 160;
export const mosaicDuration = (holdSeconds: number) => MOSAIC_OPEN_FRAMES + Math.round(Math.max(1, holdSeconds) * MOSAIC_FPS);

const INK = '#3b2a20', RUST = '#9a3a1c', LINEN = '#efe7d5';

// The same order as the files; the weights make velvet fall heavy and linen drift.
const FABRICS = [
  ['rust_herringbone_wool', 1.1], ['indigo_denim_twill', 1.0], ['mustard_knit', 0.9], ['oatmeal_linen', 0.8],
  ['forest_tartan', 1.0], ['burgundy_crushed_velvet', 1.3], ['latvian_auseklis_weave', 0.95], ['brown_houndstooth', 1.05],
] as const;
const URLS = FABRICS.map(([name]) => staticFile(`mosaic-pieces/${name}.glb`));

// One piece: a skinned clone of its fabric, placed by the simulation. `flap` lifts the corners
// through the bones; each corner by a slightly different amount, so the cloth never moves as a plate.
const CORNERS = [['Corner_TL', 1], ['Corner_TR', 0.8], ['Corner_BL', 0.65], ['Corner_BR', 0.9]] as const;
const EDGES = ['Edge_T', 'Edge_B', 'Edge_L', 'Edge_R'] as const;

const Piece = ({ scene, pose, lean }: { scene: THREE.Group; pose: MosaicPose; lean: number }) => {
  const piece = useMemo(() => {
    const c = cloneRigged(scene) as THREE.Group;
    c.traverse((o) => { if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
    return c;
  }, [scene]);
  const bones = useMemo(() => {
    const b: Record<string, THREE.Bone> = {};
    piece.traverse((o) => { if (o instanceof THREE.Bone) b[o.name] = o; });
    return b;
  }, [piece]);
  useLayoutEffect(() => {
    CORNERS.forEach(([name, k], i) => { bones[name].position.z = pose.flap * k * (1 + 0.35 * Math.sin(pose.phase * 2 + i * 1.7)); });
    EDGES.forEach((name, i) => { bones[name].position.z = pose.flap * 0.35 * (1 + 0.3 * Math.sin(pose.phase * 2 + i)); });
  });
  return (
    <primitive
      object={piece}
      visible={pose.mode !== 'waiting'}
      position={[pose.x, pose.y, pose.z]}
      rotation={[pose.rx, pose.ry, pose.rz + lean]}
      scale={MOSAIC_LAYOUT.tile}
    />
  );
};

type Pieces = ReturnType<typeof mosaicSpecs>;

// The simulation, run once for the story and shared by the picture and the sound. Starts two
// seconds early (the first pieces set off at -1.2 s, MOSAIC_LAYOUT.lead), so frame 0 already has
// cloth in the air rather than an empty sheet.
const useMosaic = () => {
  const { durationInFrames, fps } = useVideoConfig();
  const pieces = useMemo(() => mosaicSpecs(FABRICS.map(([, w]) => w)), []);
  const track = useMemo(() => simulateMosaic(pieces.map((p) => p.spec), durationInFrames, fps, -2), [pieces, durationInFrames, fps]);
  return { pieces, track };
};

const Scene = ({ pieces, track }: { pieces: Pieces; track: MosaicPose[][] }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const gltfs = useLoader(GLTFLoader, URLS); // suspends; ThreeCanvas holds the frame until loaded
  const f = Math.min(frame, durationInFrames - 1);
  return (
    <>
      <ambientLight intensity={0.55} color="#fff4e2" />
      <hemisphereLight args={['#fff6e6', '#6b5540', 0.45]} />
      <directionalLight
        position={[2.5, 3.5, 7]}
        intensity={2.1}
        color="#ffe9c8"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-3} shadow-camera-right={3} shadow-camera-top={4} shadow-camera-bottom={-4}
        shadow-camera-near={2} shadow-camera-far={16}
        shadow-bias={-0.0006}
        shadow-radius={6}
        shadow-blurSamples={16}
      />
      {/* Shadow-only sheet just behind the mosaic: the pieces in the air throw shadows on the ones
          already in place and on the linen around them. */}
      <mesh position={[0, 0, -0.03]} receiveShadow>
        <planeGeometry args={[20, 20]} />
        <shadowMaterial opacity={0.22} color="#3a2412" />
      </mesh>
      {pieces.map((p, i) => <Piece key={i} scene={gltfs[p.fabric].scene} pose={track[i][f]} lean={p.lean} />)}
    </>
  );
};

// ---- the sound ------------------------------------------------------------------------------------
// public/sfx, cut and levelled from two Freesound recordings:
//   cloth-rustle.wav  41.5–47.5 s of 204016 "clothing_shirtsandpants_rustling" by duckduckpony (lively from its
//                     first moment, tapering as the mosaic fills), levelled to -28 dB RMS, soft-limited
//   cloth-impact.wav  446066 "cloth2" by sophiemezam, normalised to -3 dBFS
// Both are driven by the simulation, not placed by hand: change the physics and the sound follows.
const IMPACT_PEAK = 0.17; // seconds into cloth-impact.wav where the hit peaks

// A piece "lands" the first frame it is within a hair of its slot. (Its mode only turns to 'landed'
// later, once the corners have finished fluttering: that is too late for the sound of the hit.)
const impactFrame = (track: MosaicPose[], spec: MosaicSpec) =>
  track.findIndex((p) => p.mode === 'settling' && Math.hypot(p.x - spec.slotX, p.y - spec.slotY, p.z) < 0.04);

const MosaicSound = ({ pieces, track }: { pieces: Pieces; track: MosaicPose[][] }) => {
  const { fps, durationInFrames } = useVideoConfig();
  // The rustle follows how much cloth is in the air: every falling piece counts fully, a piece
  // gliding into its slot counts half. Smoothed so pieces arriving and leaving don't step the level.
  const rustle = useMemo(() => {
    const out: number[] = [];
    const air = (f: number) => Math.min(1, track.reduce((n, t) => n + (t[f].mode === 'falling' ? 1 : t[f].mode === 'settling' ? 0.5 : 0), 0) / 5);
    let level = air(0); // cloth is already falling at frame 0, so the rustle starts there too, not from silence
    for (let f = 0; f < durationInFrames; f++) {
      level += (air(f) - level) * 0.15;
      out.push(level * Math.min(1, (f + 1) / 3)); // a three-frame fade in, just enough to avoid a click
    }
    return out;
  }, [track, durationInFrames]);
  return (
    <>
      <Audio src={staticFile('sfx/cloth-rustle.wav')} volume={(f) => rustle[Math.min(f, rustle.length - 1)]} />
      {pieces.map((p, i) => {
        const at = impactFrame(track[i], p.spec);
        if (at < 0) return null;
        // Heavier cloth lands lower and louder, lighter cloth higher and softer. The sound is started
        // early by the time its peak takes to arrive (at this playback rate), so the peak is on the frame.
        const rate = 1.18 - 0.2 * p.spec.weight;
        const from = Math.max(0, at - Math.round((IMPACT_PEAK / rate) * fps));
        return (
          <Sequence key={i} from={from} durationInFrames={Math.ceil(fps * 0.6)} layout="none">
            <Audio src={staticFile('sfx/cloth-impact.wav')} playbackRate={rate} volume={Math.min(1, 0.55 + 0.35 * p.spec.weight)} />
          </Sequence>
        );
      })}
    </>
  );
};

// ---- the page -------------------------------------------------------------------------------------
const GLOW = `radial-gradient(closest-side, ${LINEN}f0 0%, ${LINEN}d0 55%, ${LINEN}00 100%)`;
const HALO = `0 0 16px ${LINEN}, 0 0 6px ${LINEN}`;
const serif = (size: number, weight: number, extra: CSSProperties = {}): CSSProperties => ({
  fontFamily: '"Cormorant Garamond"', fontWeight: weight, fontSize: size, lineHeight: 1.02, color: INK,
  fontVariantNumeric: 'lining-nums', textAlign: 'center', textShadow: HALO, ...extra,
});

export const MosaicStory = ({ title, kicker, when, venue, price }: MosaicStoryProps) => {
  const { width, height } = useVideoConfig();
  const { pieces, track } = useMosaic();
  return (
    <AbsoluteFill>
      <MosaicSound pieces={pieces} track={track} />
      <AbsoluteFill>
        <Img src={staticFile('cloth.png')} style={{ width, height }} />
      </AbsoluteFill>
      <AbsoluteFill>
        <ThreeCanvas width={width} height={height} shadows="variance" camera={{ position: [0, 0, 10], fov: 30 }}>
          <Scene pieces={pieces} track={track} />
        </ThreeCanvas>
      </AbsoluteFill>
      {/* Above the canvas: pieces fall behind the type, which fades them out as they pass. */}
      <AbsoluteFill>
        <div style={{ position: 'absolute', left: -60, right: -60, top: 110, height: 420, background: GLOW }} />
      </AbsoluteFill>
      <AbsoluteFill style={{ alignItems: 'center', paddingTop: 150 }}>
        <div style={{ fontFamily: '"Great Vibes"', fontSize: 84, lineHeight: 1, color: RUST, textShadow: HALO }}>{kicker}</div>
        <div style={{ height: 26 }} />
        {title.map((line) => <div key={line} style={serif(104, 700, { letterSpacing: 4 })}>{line}</div>)}
      </AbsoluteFill>
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 170 }}>
        <div style={serif(44, 600, { letterSpacing: 5 })}>{when}</div>
        <div style={{ height: 20 }} />
        <div style={serif(34, 500, { letterSpacing: 4 })}>{venue}</div>
        <div style={{ height: 20 }} />
        <div style={serif(44, 700, { color: RUST, letterSpacing: 3 })}>{price}</div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
