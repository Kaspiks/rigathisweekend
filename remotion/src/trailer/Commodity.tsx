// Shot 4, COMMODITY: the Earth as a product. The globe turns on a pedestal under one hard spotlight in a
// dark vault, and a gold cage, meridians and latitude rings, swings in and locks shut around it.
import { useThree } from '@react-three/fiber';
import { ThreeCanvas } from '@remotion/three';
import { useMemo } from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import * as THREE from 'three';
import { CameraRig, Dust, Exposure, Lens, SceneFog, blend, canvasTexture, clamp, easeInOut, hex, lerp, noiseField, smoothstep, studioEnvironment } from './common';

const R = 2;

// 3D value noise, so the continents wrap the sphere without a seam.
const hash3 = (x: number, y: number, z: number) => { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); };
function noise3(x: number, y: number, z: number) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z), fx = x - ix, fy = y - iy, fz = z - iz;
  const s = (t: number) => t * t * (3 - 2 * t), sx = s(fx), sy = s(fy), sz = s(fz);
  const c = (dx: number, dy: number, dz: number) => hash3(ix + dx, iy + dy, iz + dz);
  return lerp(lerp(lerp(c(0, 0, 0), c(1, 0, 0), sx), lerp(c(0, 1, 0), c(1, 1, 0), sx), sy), lerp(lerp(c(0, 0, 1), c(1, 0, 1), sx), lerp(c(0, 1, 1), c(1, 1, 1), sx), sy), sz);
}
const fbm3 = (x: number, y: number, z: number) => { let v = 0, a = 0.5, f = 1; for (let i = 0; i < 6; i++) { v += a * noise3(x * f, y * f, z * f); a *= 0.5; f *= 2.02; } return v; };

// Equirectangular maps of an invented Earth: colour, and roughness (glossy sea, matt land).
function planetMaps() {
  const w = 1024, h = 512, land = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const lon = (x / w) * Math.PI * 2, lat = (0.5 - y / h) * Math.PI;
    const px = Math.cos(lat) * Math.cos(lon), py = Math.sin(lat), pz = Math.cos(lat) * Math.sin(lon);
    land[y * w + x] = fbm3(px * 1.7 + 3, py * 1.7, pz * 1.7);
  }
  const make = (paint: (x: number, y: number, v: number, lat: number) => [number, number, number], color: boolean) => {
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d')!, img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const [r, g, b] = paint(x, y, land[y * w + x], Math.abs(0.5 - y / h) * 2), i = (y * w + x) * 4;
      img.data.set([r, g, b, 255], i);
    }
    ctx.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(canvas); t.anisotropy = 8; if (color) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const sea = 0.5;
  const map = make((_x, _y, v, lat) => {
    if (lat > 0.86) return hex('#e8ecef');
    if (v < sea) return blend(hex('#06182a'), hex('#14435e'), smoothstep(sea - 0.18, sea, v));
    const k = smoothstep(sea, sea + 0.2, v), dry = smoothstep(0.3, 0.6, 1 - lat) * smoothstep(0.6, 0.7, v) * 0.7;
    return blend(blend(hex('#2f4a22'), hex('#556036'), k), hex('#8a7550'), dry);
  }, true);
  const rough = make((_x, _y, v) => { const r = v < sea ? 60 : 225; return [r, r, r]; }, false);
  return { map, rough };
}

// A blue rim where the air is: brightest at the edge of the disc, nothing facing the camera.
const atmosphere = () => new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide,
  vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vec4 wp = modelMatrix * vec4(position,1.0); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - wp.xyz); gl_Position = projectionMatrix * viewMatrix * wp; }',
  fragmentShader: 'varying vec3 vN; varying vec3 vV; void main(){ float f = pow(1.0 - abs(dot(vN, vV)), 4.0); gl_FragColor = vec4(vec3(0.22, 0.48, 1.0) * f * 0.55, 1.0); }',
});

// The light you can see: a cone from the lamp down to the pool on the floor, fading at its edges and with
// distance from the lamp.
const beam = () => new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  uniforms: { color: { value: new THREE.Color('#ffe2b8') } },
  vertexShader: 'varying vec3 vN; varying vec3 vV; varying float vY; void main(){ vY = uv.y; vec4 wp = modelMatrix * vec4(position,1.0); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - wp.xyz); gl_Position = projectionMatrix * viewMatrix * wp; }',
  fragmentShader: 'uniform vec3 color; varying vec3 vN; varying vec3 vV; varying float vY; void main(){ float edge = pow(abs(dot(vN, vV)), 2.0); gl_FragColor = vec4(color * edge * 0.075 * mix(0.35, 1.0, vY), 1.0); }',
});

const Vault = ({ frame }: { frame: number }) => {
  const gl = useThree((s) => s.gl);
  const env = useMemo(() => studioEnvironment(gl, [
    { color: '#fff0d8', intensity: 6, position: [0, 12, 0], size: [3, 3] },
    { color: '#ffb46a', intensity: 1.6, position: [-9, 3, 4], size: [3, 8] },
    { color: '#86a8d4', intensity: 1.2, position: [9, 2, -3], size: [2, 8] },
  ], '#0a0806'), [gl]);
  const maps = useMemo(() => planetMaps(), []);
  const planet = useMemo(() => new THREE.MeshPhysicalMaterial({ map: maps.map, roughnessMap: maps.rough, roughness: 1, metalness: 0, clearcoat: 0.25, clearcoatRoughness: 0.4, envMap: env, envMapIntensity: 0.6 }), [maps, env]);
  const gold = useMemo(() => new THREE.MeshPhysicalMaterial({ color: '#f0bd60', metalness: 1, roughness: 0.24, envMap: env, envMapIntensity: 1.6 }), [env]);
  const stone = useMemo(() => {
    const size = 512, n = noiseField(size, 5, 6, 5);
    return new THREE.MeshStandardMaterial({ map: canvasTexture(size, (x, y) => blend(hex('#161412'), hex('#4a443c'), Math.pow(n[y * size + x], 1.6) * 1.4), [2, 2]), roughness: 0.45, envMap: env, envMapIntensity: 0.4 });
  }, [env]);
  const pedestal = useMemo(() => new THREE.LatheGeometry([[0, 0], [1.9, 0], [1.9, 0.35], [1.6, 0.45], [1.6, 0.6], [1.1, 0.8], [0.95, 1.2], [0.85, 3.6], [1.05, 3.85], [1.35, 4.05], [1.35, 4.3], [0, 4.3]].map(([x, y]) => new THREE.Vector2(x, y)), 96), []);
  const floor = useMemo(() => {
    const size = 1024, n = noiseField(size, 8, 8, 5);
    return new THREE.MeshStandardMaterial({ map: canvasTexture(size, (x, y) => blend(hex('#0c0b0a'), hex('#2a2622'), n[y * size + x] * 1.2), [6, 6]), roughness: 0.3, envMap: env, envMapIntensity: 0.5 });
  }, [env]);
  const cone = useMemo(() => beam(), []);
  const air = useMemo(() => atmosphere(), []);

  // The cage closes over the shot: bars swing in from fanned out to tight around the globe, rings drop
  // and shrink into place, and it locks a little before the end.
  const close = easeInOut(clamp((frame - 12) / 118));
  const centre = 4.3 + R + 0.1;
  const meridians = 12;
  return (
    <>
      <mesh geometry={pedestal} material={stone} castShadow receiveShadow />
      <mesh material={gold} position={[0, 4.32, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[1.3, 0.07, 16, 96]} /></mesh>
      <group position={[0, centre, 0]}>
        <mesh material={planet} rotation={[0.41, frame * 0.0045, 0]} castShadow><sphereGeometry args={[R, 128, 64]} /></mesh>
        <mesh material={air} scale={1.012}><sphereGeometry args={[R, 64, 32]} /></mesh>
        {Array.from({ length: meridians }, (_, i) => {
          const a = (i / meridians) * Math.PI * 2, open = 1 - close;
          return (
            <group key={i} rotation={[0, a, 0]}>
              <mesh material={gold} position={[open * 2.6, open * 1.4, 0]} rotation={[0, 0, -Math.PI / 2 - open * 1.1]} castShadow>
                <torusGeometry args={[R + 0.32, 0.035, 10, 96, Math.PI]} />
              </mesh>
            </group>
          );
        })}
        {[-0.62, -0.3, 0, 0.3, 0.62].map((lat, i) => {
          const y = Math.sin(lat * Math.PI / 2 * 1.4) * (R + 0.32), rr = Math.sqrt(Math.max(0.01, (R + 0.32) ** 2 - y * y));
          const k = clamp(close * 1.4 - i * 0.08);
          return <mesh key={i} material={gold} position={[0, lerp(y + 3.5, y, k), 0]} rotation={[Math.PI / 2, 0, 0]} scale={lerp(1.5, 1, k)} castShadow>
            <torusGeometry args={[rr, 0.045, 10, 128]} />
          </mesh>;
        })}
        <mesh material={gold} position={[0, lerp(5.5, R + 0.45, close), 0]} castShadow><sphereGeometry args={[0.16, 24, 16]} /></mesh>
      </group>
      <mesh material={floor} rotation={[-Math.PI / 2, 0, 0]} receiveShadow><planeGeometry args={[120, 120]} /></mesh>
      <mesh material={cone} position={[0, 9, 0]}><cylinderGeometry args={[0.35, 4.6, 18, 64, 1, true]} /></mesh>
    </>
  );
};

export const Commodity = () => {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames } = useVideoConfig();
  const t = easeInOut(frame / (durationInFrames - 1));
  const angle = lerp(-0.55, 0.15, t), dist = lerp(15.5, 11.5, t), y = lerp(3.2, 4.6, t);
  const position: THREE.Vector3Tuple = [Math.sin(angle) * dist, y, Math.cos(angle) * dist];
  const target: THREE.Vector3Tuple = [0, 5.6, 0];
  const focus = new THREE.Vector3(...position).distanceTo(new THREE.Vector3(0, 6.4, 0));
  return (
    <AbsoluteFill style={{ background: '#040303' }}>
      <ThreeCanvas width={width} height={height} shadows gl={{ antialias: true }}>
        <Exposure value={1.0} />
        <SceneFog color="#060505" density={0.04} />
        <color attach="background" args={['#040303']} />
        <CameraRig position={position} target={target} fov={34} />
        <spotLight position={[0, 18, 0]} angle={0.27} penumbra={0.45} intensity={2600} decay={2} color="#fff0d8" castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0002} />
        <spotLight position={[-10, 5, 6]} angle={0.5} penumbra={1} intensity={90} color="#ffb36a" />
        {/* A low soft fill from the camera side, so the globe's lower half keeps its seas and coasts. */}
        <pointLight position={[2, 4, 14]} intensity={45} distance={40} color="#9fb6d8" />
        <spotLight position={[9, 4, -6]} angle={0.5} penumbra={1} intensity={70} color="#7fa2d6" />
        <Vault frame={frame} />
        <Dust frame={frame} count={1500} box={[[-3.5, 3.5], [0.3, 17], [-3.5, 3.5]]} seed={21} color="#fff0d8" size={0.03} opacity={0.5} wind={[0.0008, -0.002, 0.0005]} />
        <Lens focus={focus} aperture={0.0018} maxblur={0.01} />
      </ThreeCanvas>
    </AbsoluteFill>
  );
};
