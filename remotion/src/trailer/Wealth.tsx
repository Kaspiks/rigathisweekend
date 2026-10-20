// Shot 2, WEALTH: a slow macro push across heaped gold on dark stone, from the coins at the lip of the
// heap to a goblet behind it, the focus pulling with the camera. A few coins slip down the heap. Units
// are coin diameters: the heap is about six across, the goblet seven tall.
import { useThree } from '@react-three/fiber';
import { ThreeCanvas } from '@remotion/three';
import { useMemo } from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CameraRig, Dust, Exposure, Lens, SceneFog, blend, canvasTexture, clamp, easeInOut, hex, mix3, noiseField, rng, smoothstep, studioEnvironment } from './common';

const mound = (r: number) => 2.6 * Math.exp(-Math.pow(r / 3.4, 2));
const slope = (r: number) => -2 * r / (3.4 * 3.4) * mound(r);

// A coin: a turned rim, and two flat faces with their own square UVs so a struck design can be pressed
// into them with a normal map.
function coinGeometry() {
  const rim = new THREE.LatheGeometry([[0.4, 0.032], [0.43, 0.048], [0.5, 0.046], [0.505, 0], [0.5, -0.046], [0.43, -0.048], [0.4, -0.032]].map(([x, y]) => new THREE.Vector2(x, y)), 64);
  const top = new THREE.CircleGeometry(0.4, 64); top.rotateX(-Math.PI / 2); top.translate(0, 0.032, 0);
  const bottom = new THREE.CircleGeometry(0.4, 64); bottom.rotateX(Math.PI / 2); bottom.translate(0, -0.032, 0);
  return mergeGeometries([rim, top, bottom].map((g) => g.toNonIndexed()))!;
}

// The struck design as a height field, turned into a normal map: a raised border, a ring of beads, a
// band of tiny ticks that reads as lettering at this size, and an embossed boss in the middle.
function coinNormals() {
  const size = 512, n = noiseField(size, 77, 5, 4), h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = (x / (size - 1)) * 2 - 1, v = (y / (size - 1)) * 2 - 1, r = Math.hypot(u, v), a = Math.atan2(v, u);
    let z = r > 0.93 ? 1 : 0;
    const bead = Math.round((a / (Math.PI * 2)) * 72) / 72 * Math.PI * 2;
    z += 0.8 * smoothstep(0.045, 0, Math.hypot(u - Math.cos(bead) * 0.86, v - Math.sin(bead) * 0.86));
    z += 0.6 * Math.exp(-Math.pow((r - 0.77) / 0.014, 2));
    const tick = ((a / (Math.PI * 2)) * 46 % 1 + 1) % 1, gap = Math.floor(((a / (Math.PI * 2)) * 46 + 46)) % 7 === 0;
    if (r > 0.64 && r < 0.72 && tick < 0.55 && !gap) z += 0.45;
    z += 0.75 * smoothstep(0.6, 0.38, r) * (0.45 + 0.55 * n[y * size + x]);
    h[y * size + x] = z;
  }
  const at = (x: number, y: number) => h[Math.min(size - 1, Math.max(0, y)) * size + Math.min(size - 1, Math.max(0, x))];
  const tex = canvasTexture(size, (x, y) => {
    const dx = (at(x + 1, y) - at(x - 1, y)) * 3, dy = (at(x, y + 1) - at(x, y - 1)) * 3, l = Math.hypot(dx, dy, 1);
    return [(-dx / l * 0.5 + 0.5) * 255, (dy / l * 0.5 + 0.5) * 255, (1 / l * 0.5 + 0.5) * 255];
  }, [1, 1], false);
  return tex;
}

// A brilliant cut: flat table, sloping crown, a pointed pavilion, eight facets around.
function gemGeometry() {
  return new THREE.LatheGeometry([[0, 0.16], [0.3, 0.16], [0.48, 0.05], [0.5, 0], [0.02, -0.42], [0, -0.42]].map(([x, y]) => new THREE.Vector2(x, y)), 8);
}

function gobletGeometry() {
  const profile = [[0, 0], [1.35, 0], [1.4, 0.1], [1.2, 0.28], [0.5, 0.5], [0.3, 0.9], [0.24, 1.3], [0.52, 1.62], [0.24, 1.95], [0.24, 2.5], [0.5, 2.8], [1.05, 3.2], [1.5, 3.9], [1.72, 4.8], [1.78, 5.8], [1.76, 6.6], [1.84, 6.7], [1.7, 6.74], [1.62, 6.0], [1.55, 4.9], [1.3, 4.0], [0.9, 3.5], [0, 3.4]];
  return new THREE.LatheGeometry(profile.map(([x, y]) => new THREE.Vector2(x, y)), 96);
}

function ingotGeometry() {
  const s = new THREE.Shape(); s.moveTo(-0.95, 0); s.lineTo(0.95, 0); s.lineTo(0.75, 0.9); s.lineTo(-0.75, 0.9); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 3.6, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.06, bevelSegments: 3 });
  g.translate(0, 0, -1.8);
  return g;
}

// Coins lying on the heap: each sits on the mound surface, partly sunk, tilted with the slope and then
// jumbled, so the heap reads as poured rather than stacked.
function heap(count: number, seed: number) {
  const r = rng(seed), list: { p: THREE.Vector3; q: THREE.Quaternion; tint: number }[] = [];
  for (let i = 0; i < count; i++) {
    const rad = Math.sqrt(r()) * 6.4, a = r() * Math.PI * 2;
    const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
    const y = Math.max(0.045, mound(rad) - r() * 0.22);
    const tilt = Math.atan(-slope(rad)) + (r() - 0.5) * 1.1;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt, -a + Math.PI / 2 + (r() - 0.5) * 0.6, (r() - 0.5) * 0.9, 'YXZ'));
    list.push({ p: new THREE.Vector3(x, y, z), q, tint: r() });
  }
  return list;
}

// Coins that let go during the shot and slide off the heap, tumbling once they reach the floor.
const SLIDERS = [
  { a: 0.35, r0: 1.4, r1: 7.4, start: 26, dur: 70 },
  { a: 1.05, r0: 2.0, r1: 7.8, start: 58, dur: 64 },
  { a: -0.2, r0: 1.0, r1: 6.9, start: 92, dur: 60 },
  { a: 0.7, r0: 2.6, r1: 8.2, start: 118, dur: 50 },
];

const Gold = ({ frame }: { frame: number }) => {
  const gl = useThree((s) => s.gl);
  const env = useMemo(() => studioEnvironment(gl, [
    // A broad warm softbox overhead: faces that lie flat on the heap mirror it, so they read as gold, not black.
    { color: '#ffcf96', intensity: 1.7, position: [0, 11, -1], size: [16, 12] },
    { color: '#ffd9a8', intensity: 7, position: [-5, 9, -7], size: [7, 3] },
    { color: '#ffb46a', intensity: 3.5, position: [-8, 2.5, 3], size: [2, 5] },
    { color: '#9fc0e6', intensity: 1.6, position: [8, 3, 2], size: [1.2, 7] },
    { color: '#ffe7c4', intensity: 1.2, position: [2, 6, 9], size: [5, 2] },
  ], '#1a1108'), [gl]);
  const coin = useMemo(() => coinGeometry(), []);
  const gold = useMemo(() => new THREE.MeshPhysicalMaterial({ color: '#f4c46a', metalness: 1, roughness: 0.34, envMap: env, envMapIntensity: 1.5, clearcoat: 0.25, clearcoatRoughness: 0.3, normalMap: coinNormals(), normalScale: new THREE.Vector2(1.3, 1.3) }), [env]);
  const darkGold = useMemo(() => new THREE.MeshStandardMaterial({ color: '#6b4a1c', metalness: 1, roughness: 0.55, envMap: env, envMapIntensity: 0.5 }), [env]);
  const goblet = useMemo(() => new THREE.MeshPhysicalMaterial({ color: '#e9b75e', metalness: 1, roughness: 0.22, envMap: env, envMapIntensity: 1.7 }), [env]);
  const gem = (c: string) => new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.04, metalness: 0.15, clearcoat: 1, envMap: env, envMapIntensity: 3, flatShading: true, sheen: 0.4, sheenColor: new THREE.Color(c) });
  const cut = useMemo(() => gemGeometry(), []);
  const gems = useMemo(() => ({ red: gem('#8a0f1a'), green: gem('#0d5a37'), blue: gem('#173a7a') }), [env]); // eslint-disable-line react-hooks/exhaustive-deps
  const coins = useMemo(() => {
    const list = heap(1150, 7), mesh = new THREE.InstancedMesh(coin, gold, list.length), m = new THREE.Matrix4(), c = new THREE.Color();
    list.forEach(({ p, q, tint }, i) => {
      mesh.setMatrixAt(i, m.compose(p, q, new THREE.Vector3(1, 1, 1)));
      mesh.setColorAt(i, c.setRGB(...blend([255, 255, 255], [214, 168, 120], tint * tint).map((v) => v / 255) as [number, number, number]));
    });
    mesh.castShadow = mesh.receiveShadow = true;
    return mesh;
  }, [coin, gold]);
  // Under the coins, a darker gold mound fills the gaps so the heap never shows the floor through it.
  const body = useMemo(() => {
    const g = new THREE.LatheGeometry(Array.from({ length: 40 }, (_, i) => new THREE.Vector2(i * 0.17, Math.max(0, mound(i * 0.17) - 0.2))), 64);
    return g;
  }, []);
  const ingot = useMemo(() => ingotGeometry(), []);
  const goblets = useMemo(() => gobletGeometry(), []);
  const r = rng(31);
  const scattered = useMemo(() => Array.from({ length: 26 }, () => ({ x: (r() - 0.5) * 18, z: 3 + r() * 6, a: r() * 6.28, tilt: (r() - 0.5) * 0.15 })), []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <mesh geometry={body} material={darkGold} receiveShadow />
      <primitive object={coins} />
      {scattered.map((s, i) => <mesh key={i} geometry={coin} material={gold} position={[s.x, 0.046, s.z - 4]} rotation={[s.tilt, s.a, 0]} castShadow receiveShadow />)}
      {SLIDERS.map((s, i) => {
        const t = clamp((frame - s.start) / s.dur), e = t * t;
        const rad = s.r0 + (s.r1 - s.r0) * e, y = Math.max(0.046, mound(rad) + 0.05);
        const settle = smoothstep(0.75, 1, t);
        return <mesh key={i} geometry={coin} material={gold} castShadow position={[Math.cos(s.a) * rad, y, Math.sin(s.a) * rad]}
          rotation={[Math.atan(-slope(rad)) * (1 - settle) + e * 9 * (1 - settle), -s.a + Math.PI / 2, e * 2.5 * (1 - settle)]} />;
      })}
      <group position={[2.9, 0, -5.2]}>
        <mesh geometry={goblets} material={goblet} castShadow receiveShadow />
        <mesh material={goblet} position={[0, 6.7, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[1.8, 0.055, 12, 96]} /></mesh>
        <mesh material={goblet} position={[0, 4.75, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[1.72, 0.09, 12, 96]} /></mesh>
        {Array.from({ length: 6 }, (_, i) => (
          <mesh key={i} geometry={cut} material={[gems.red, gems.green, gems.blue][i % 3]} scale={0.42} position={[Math.cos(i * Math.PI / 3) * 1.8, 4.75, Math.sin(i * Math.PI / 3) * 1.8]} rotation={[0, -i * Math.PI / 3, Math.PI / 2]} />
        ))}
      </group>
      {[[-0.95, 0], [0.95, 0], [0, 0], [-0.5, 1], [0.5, 1], [0, 2]].map(([x, row], i) => (
        <mesh key={i} geometry={ingot} material={goblet} position={[-5.2 + x * 1.9 + (row === 1 ? 0 : 0), 0.06 + row * 0.96, -3.2]} rotation={[0, 0.35 + (row % 2) * Math.PI, 0]} castShadow receiveShadow />
      ))}
      {[[1.4, 0.9, 2.1, 'red'], [-1.8, 1.4, 1.2, 'green'], [0.4, 2.2, -0.6, 'blue'], [3.1, 0.5, 2.4, 'red'], [-0.6, 0.6, 3.5, 'green']].map(([x, y, z, k], i) => (
        <mesh key={i} geometry={cut} material={gems[k as 'red']} scale={0.7 + (i % 2) * 0.25} position={[x as number, mound(Math.hypot(x as number, z as number)) + 0.15, z as number]} rotation={[0.6 * i, 0.9 * i, 0.3]} castShadow>
        </mesh>
      ))}
    </>
  );
};

const Slab = () => {
  const material = useMemo(() => {
    const size = 1024, n = noiseField(size, 44, 6, 6);
    return new THREE.MeshStandardMaterial({ map: canvasTexture(size, (x, y) => blend(hex('#0d0b09'), hex('#3b342c'), Math.pow(n[y * size + x], 1.4) * 1.3), [3, 3]), roughness: 0.62, metalness: 0 });
  }, []);
  return <mesh material={material} rotation={[-Math.PI / 2, 0, 0]} receiveShadow><planeGeometry args={[80, 80]} /></mesh>;
};

export const Wealth = () => {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames } = useVideoConfig();
  const t = easeInOut(frame / (durationInFrames - 1));
  const position = mix3([-6.2, 2.0, 12.5], [-1.6, 3.9, 9.4], t);
  const target = mix3([0.2, 1.2, -0.5], [2.2, 3.4, -4.6], t);
  const focus = new THREE.Vector3(...position).distanceTo(new THREE.Vector3(...mix3([-1.2, 1.6, 2.6], [2.9, 3.8, -5.2], smoothstep(0.1, 0.9, frame / (durationInFrames - 1)))));
  return (
    <AbsoluteFill style={{ background: '#050403' }}>
      <ThreeCanvas width={width} height={height} shadows gl={{ antialias: true }}>
        <Exposure value={1.0} />
        <SceneFog color="#070605" density={0.035} />
        <color attach="background" args={['#050403']} />
        <CameraRig position={position} target={target} fov={30} />
        <spotLight position={[-7, 11, -9]} angle={0.55} penumbra={0.8} intensity={2600} color="#ffd29a" castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0003} />
        <spotLight position={[-4, 14, 10]} angle={0.5} penumbra={1} intensity={1100} color="#ffe2bd" />
        <spotLight position={[8, 4, 6]} angle={0.6} penumbra={1} intensity={120} color="#7f9cc8" />
        <ambientLight intensity={0.05} color="#405060" />
        <Gold frame={frame} />
        <Slab />
        <Dust frame={frame} count={1200} box={[[-8, 8], [0.2, 9], [-10, 8]]} seed={9} color="#ffd9a8" size={0.035} opacity={0.4} wind={[0.002, 0.001, 0.0008]} />
        <Lens focus={focus} aperture={0.0035} maxblur={0.014} />
      </ThreeCanvas>
    </AbsoluteFill>
  );
};
