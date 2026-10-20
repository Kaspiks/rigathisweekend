// Shot 5, APPARATUS: the machine of power. A train of gears turns heavily on a monumental stone wall above
// a stepped dais: a carved stone wheel drives bronze gears, a compound gear carries the motion forward
// to a second layer, and a crank works a piston. As the camera orbits low and looks up, cracks spread
// through the stone. The gears truly mesh: each turns at the ratio of its teeth and is phased tooth-to-gap.
import { useThree } from '@react-three/fiber';
import { ThreeCanvas } from '@remotion/three';
import { useMemo } from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import * as THREE from 'three';
import { CameraRig, Dust, Exposure, SceneFog, blend, canvasTexture, clamp, easeInOut, hex, lerp, noiseField, rng, smoothstep, studioEnvironment } from './common';

const MODULE = 0.32;
const WALL_Z = -5.2;

// A spur gear: teeth centred on angle 0, 2π/N, ..., an axle hole and spoke windows, extruded with a bevel.
function gearGeometry(teeth: number, thickness: number, spokes = 6) {
  const r = (MODULE * teeth) / 2, tip = r + MODULE, root = r - MODULE * 1.25, step = (Math.PI * 2) / teeth;
  const shape = new THREE.Shape();
  for (let i = 0; i < teeth; i++) {
    const c = i * step;
    const pts: [number, number][] = [[root, c - 0.5 * step], [root, c - 0.27 * step], [tip, c - 0.12 * step], [tip, c + 0.12 * step], [root, c + 0.27 * step], [root, c + 0.5 * step]];
    pts.forEach(([rad, a], k) => (i === 0 && k === 0 ? shape.moveTo(rad * Math.cos(a), rad * Math.sin(a)) : shape.lineTo(rad * Math.cos(a), rad * Math.sin(a))));
  }
  const hub = new THREE.Path(); hub.absarc(0, 0, r * 0.1, 0, Math.PI * 2, true); shape.holes.push(hub);
  const inner = r * 0.3, outer = root - r * 0.16;
  if (outer - inner > r * 0.15) for (let k = 0; k < spokes; k++) {
    const a0 = (k / spokes) * Math.PI * 2 + 0.16, a1 = ((k + 1) / spokes) * Math.PI * 2 - 0.16, w = new THREE.Path();
    w.absarc(0, 0, outer, a0, a1, false); w.absarc(0, 0, inner, a1, a0, true); shape.holes.push(w);
  }
  const g = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: true, bevelThickness: thickness * 0.08, bevelSize: MODULE * 0.12, bevelSegments: 2, curveSegments: 10 });
  g.translate(0, 0, -thickness / 2);
  return g;
}

// Where each gear sits and how it turns. B meshes with A along angle φ, so its angle follows A's at the
// ratio of their teeth and is offset so a tooth of one always meets a gap of the other.
type Gear = { teeth: number; x: number; y: number; z: number; thickness: number; material: 'stone' | 'bronze'; drive?: number; from?: number; phi?: number; coaxial?: number };
// Stacked upwards, a tower rather than a frieze, so it fills a vertical frame.
const PLAN: Gear[] = [
  { teeth: 44, x: 1.5, y: 10, z: WALL_Z + 1.0, thickness: 1.5, material: 'stone', drive: 1 },
  { teeth: 22, x: 0, y: 0, z: WALL_Z + 1.0, thickness: 1.0, material: 'bronze', from: 0, phi: 0.95 },
  { teeth: 14, x: 0, y: 0, z: WALL_Z + 1.0, thickness: 1.0, material: 'bronze', from: 1, phi: 2.15 },
  { teeth: 30, x: 0, y: 0, z: WALL_Z + 2.4, thickness: 0.8, material: 'bronze', coaxial: 2 },
  { teeth: 20, x: 0, y: 0, z: WALL_Z + 2.4, thickness: 0.8, material: 'bronze', from: 3, phi: 2.75 },
  { teeth: 16, x: 0, y: 0, z: WALL_Z + 1.0, thickness: 1.0, material: 'bronze', from: 0, phi: 2.55 },
  { teeth: 26, x: 0, y: 0, z: WALL_Z + 2.4, thickness: 0.8, material: 'stone', from: 4, phi: 1.45 },
];
const pitch = (g: Gear) => (MODULE * g.teeth) / 2;
function layout(baseAngle: number) {
  const gears = PLAN.map((g) => ({ ...g, angle: 0 }));
  gears.forEach((g, i) => {
    if (g.drive) { g.angle = baseAngle; return; }
    if (g.coaxial != null) { const c = gears[g.coaxial]; g.x = c.x; g.y = c.y; g.angle = c.angle * 1.0 + 0.1; return; }
    const a = gears[g.from!], phi = g.phi!, d = pitch(a) + pitch(g);
    g.x = a.x + Math.cos(phi) * d; g.y = a.y + Math.sin(phi) * d;
    g.angle = phi + Math.PI + (phi - a.angle) * (a.teeth / g.teeth) - Math.PI / g.teeth;
    void i;
  });
  return gears;
}

// Ashlar masonry: courses of dressed blocks with dark joints, each block a slightly different tone.
function masonry(seed: number, repeat: [number, number]) {
  const size = 1024, n = noiseField(size, seed, 10, 5), rows = 8, cols = 4, r = rng(seed);
  const tones = Array.from({ length: rows * cols * 2 }, () => r());
  return canvasTexture(size, (x, y) => {
    const row = Math.floor((y / size) * rows), off = row % 2 ? 0.5 : 0, cx = (x / size) * cols + off, col = Math.floor(cx);
    const fy = (y / size) * rows - row, fx = cx - col, joint = Math.min(fy, 1 - fy) * (size / rows) < 3 || Math.min(fx, 1 - fx) * (size / cols) < 3;
    if (joint) return hex('#1a1612');
    const v = n[y * size + x] * 0.7 + tones[(row * cols + ((col % cols) + cols) % cols) % tones.length] * 0.3;
    return blend(hex('#4f463b'), hex('#b2a389'), Math.pow(v, 1.2));
  }, repeat);
}
// Dressed stone for the stone gears: fine tooling marks rather than courses.
function carved(seed: number) {
  const size = 512, n = noiseField(size, seed, 12, 5);
  return canvasTexture(size, (x, y) => blend(hex('#6a6052'), hex('#c4b598'), Math.pow(n[y * size + x], 1.1)), [3, 3]);
}

// Cracks as a texture: random walks that branch, red = line, green = how far along the walk (its age),
// so a threshold on green grows them over the shot.
export function crackTexture(seeds: [number, number][]) {
  const size = 1024, canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, size, size); ctx.lineCap = 'round';
  const r = rng(404);
  const walk = (x: number, y: number, a: number, age: number, len: number, width: number) => {
    for (let i = 0; i < len && age < 250; i++) {
      a += (r() - 0.5) * 0.7;
      const nx = x + Math.cos(a) * 6, ny = y + Math.sin(a) * 6;
      ctx.strokeStyle = `rgb(255, ${Math.floor(age)}, 0)`; ctx.lineWidth = width;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(nx, ny); ctx.stroke();
      x = nx; y = ny; age += 1.4;
      if (r() < 0.05 && width > 0.8) walk(x, y, a + (r() < 0.5 ? 1 : -1) * (0.5 + r() * 0.8), age, len * 0.55, width * 0.65);
    }
  };
  for (const [sx, sy] of seeds) for (let k = 0; k < 3; k++) walk(sx * size, sy * size, r() * Math.PI * 2, r() * 20, 70, 3.2);
  const t = new THREE.CanvasTexture(canvas); t.colorSpace = THREE.NoColorSpace;
  return t;
}
export const crackMaterial = (map: THREE.Texture) => new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, fog: true,
  uniforms: { map: { value: map }, progress: { value: 0 }, ...THREE.UniformsLib.fog },
  vertexShader: '#include <fog_pars_vertex>\nvarying vec2 vUv; void main(){ vUv = uv; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;\n#include <fog_vertex>\n}',
  fragmentShader: '#include <fog_pars_fragment>\nuniform sampler2D map; uniform float progress; varying vec2 vUv; void main(){ vec4 t = texture2D(map, vUv); float shown = t.r * (1.0 - smoothstep(progress - 0.02, progress, t.g)); gl_FragColor = vec4(vec3(0.015, 0.012, 0.01), shown * 0.92);\n#include <fog_fragment>\n}',
});

const Machine = ({ frame }: { frame: number }) => {
  const gl = useThree((s) => s.gl);
  const env = useMemo(() => studioEnvironment(gl, [
    { color: '#ffd2a0', intensity: 4, position: [10, 14, 10], size: [6, 4] },
    { color: '#8fb0d8', intensity: 1.5, position: [-12, 6, 4], size: [3, 9] },
  ], '#0b0907'), [gl]);
  const bronze = useMemo(() => {
    const size = 512, n = noiseField(size, 19, 6, 5), m = noiseField(size, 20, 3, 3);
    const map = canvasTexture(size, (x, y) => {
      const v = n[y * size + x], patina = smoothstep(0.62, 0.78, m[y * size + x]) * 0.55;
      return blend(blend(hex('#4a2c14'), hex('#a5733e'), v * 0.9), hex('#365a4c'), patina);
    }, [2, 2]);
    const rough = canvasTexture(size, (x, y) => { const v = 60 + n[y * size + x] * 90 + smoothstep(0.62, 0.78, m[y * size + x]) * 90; return [v, v, v]; }, [2, 2], false);
    return new THREE.MeshStandardMaterial({ map, roughnessMap: rough, roughness: 1, metalness: 0.95, envMap: env, envMapIntensity: 1.6 });
  }, [env]);
  const stone = useMemo(() => new THREE.MeshStandardMaterial({ map: carved(31), roughness: 0.82, envMap: env, envMapIntensity: 0.25 }), [env]);
  const wallStone = useMemo(() => new THREE.MeshStandardMaterial({ map: masonry(32, [5, 4]), roughness: 0.9 }), []);
  const daisStone = useMemo(() => new THREE.MeshStandardMaterial({ map: masonry(34, [6, 1]), roughness: 0.85 }), []);
  const geometries = useMemo(() => PLAN.map((g) => gearGeometry(g.teeth, g.thickness, g.teeth > 30 ? 8 : 6)), []);
  const cracks = useMemo(() => crackMaterial(crackTexture([[0.36, 0.42], [0.62, 0.62], [0.2, 0.75], [0.8, 0.3]])), []);
  cracks.uniforms.progress.value = smoothstep(50, 310, frame) * 0.98 + 0.01;

  // Heavy and slow: the stone wheel turns about a fifth of a revolution over the shot.
  const gears = layout(frame * 0.0042);
  const b = gears[1], crank = { x: b.x + Math.cos(b.angle) * 2.3, y: b.y + Math.sin(b.angle) * 2.3 }, rod = 6.2;
  const pistonX = b.x + 0.4, pistonY = crank.y - Math.sqrt(Math.max(0.1, rod * rod - (crank.x - pistonX) ** 2));
  const rodAngle = Math.atan2(crank.y - pistonY, crank.x - pistonX);
  return (
    <>
      <mesh material={wallStone} position={[2, 14, WALL_Z - 1]} receiveShadow castShadow><boxGeometry args={[40, 32, 2]} /></mesh>
      <mesh material={cracks} position={[2, 14, WALL_Z + 0.01]} renderOrder={3}><planeGeometry args={[40, 32]} /></mesh>
      {[[44, 1.2, 14], [38, 1.2, 11], [32, 1.2, 8]].map(([w, h, d], i) => (
        <mesh key={i} material={daisStone} position={[2, h / 2 + i * h, WALL_Z + d / 2 + 0.2]} receiveShadow castShadow><boxGeometry args={[w, h, d]} /></mesh>
      ))}
      {gears.map((g, i) => (
        <group key={i} position={[g.x, g.y, g.z]}>
          <mesh geometry={geometries[i]} material={g.material === 'stone' ? stone : bronze} rotation={[0, 0, g.angle]} castShadow receiveShadow />
          <mesh material={bronze} rotation={[Math.PI / 2, 0, 0]} position={[0, 0, -(g.z - WALL_Z) / 2]} castShadow><cylinderGeometry args={[pitch(g) * 0.11, pitch(g) * 0.11, g.z - WALL_Z + g.thickness, 24]} /></mesh>
          <mesh material={bronze} rotation={[Math.PI / 2, 0, 0]} position={[0, 0, g.thickness / 2 + 0.15]}><cylinderGeometry args={[pitch(g) * 0.17, pitch(g) * 0.2, 0.3, 24]} /></mesh>
        </group>
      ))}
      {/* Crank, connecting rod and piston, driven by the first bronze gear. */}
      <mesh material={bronze} position={[crank.x, crank.y, b.z + 0.75]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.22, 0.22, 0.6, 16]} /></mesh>
      <mesh material={bronze} position={[(crank.x + pistonX) / 2, (crank.y + pistonY) / 2, b.z + 0.95]} rotation={[0, 0, rodAngle - Math.PI / 2]} castShadow><boxGeometry args={[0.32, rod, 0.25]} /></mesh>
      <mesh material={bronze} position={[pistonX, pistonY - 1.1, b.z + 0.95]} castShadow><cylinderGeometry args={[0.55, 0.55, 2.2, 32]} /></mesh>
      <mesh material={stone} position={[pistonX, pistonY - 4.2, b.z + 0.95]} castShadow receiveShadow><cylinderGeometry args={[0.8, 0.9, 4.2, 32]} /></mesh>
    </>
  );
};

export const Apparatus = () => {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames } = useVideoConfig();
  const t = easeInOut(frame / (durationInFrames - 1));
  const angle = lerp(-0.42, 0.3, t), radius = lerp(52, 37, t);
  const centre = new THREE.Vector3(1.5, 12, WALL_Z);
  const position: THREE.Vector3Tuple = [centre.x + Math.sin(angle) * radius, lerp(2.6, 5.5, t), centre.z + Math.cos(angle) * radius];
  const target: THREE.Vector3Tuple = [centre.x, lerp(13, 15, t), centre.z];
  return (
    <AbsoluteFill style={{ background: '#080605' }}>
      <ThreeCanvas width={width} height={height} shadows gl={{ antialias: true }}>
        <Exposure value={1.05} />
        <SceneFog color="#17120e" density={0.016} />
        <color attach="background" args={['#0b0907']} />
        <CameraRig position={position} target={target} fov={42} />
        <spotLight position={[34, 28, 10]} angle={0.78} penumbra={0.5} intensity={17000} color="#ffcf98" castShadow shadow-mapSize={[4096, 4096]} shadow-bias={-0.0002} target-position={[0, 16, WALL_Z]} />
        <directionalLight position={[-20, 12, 14]} intensity={0.7} color="#7f9fc8" />
        <hemisphereLight args={['#4c5a68', '#140e0a', 0.35]} />
        <Machine frame={frame} />
        <Dust frame={frame} count={3000} box={[[-16, 20], [0.5, 30], [-4, 14]]} seed={33} color="#ffd8a8" size={0.05} opacity={0.45} wind={[0.0015, -0.003, 0.0006]} />
      </ThreeCanvas>
    </AbsoluteFill>
  );
};
