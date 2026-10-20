// Shot 1, EMPIRE: a low dolly down a colossal colonnade at dusk. The sun is low and ahead, so the columns
// stand against it, their shadows run back towards the camera, and the light comes through the gaps as
// slanted shafts in the haze. At the far end a temple front waits in the fog; the camera cranes up to it.
import { ThreeCanvas } from '@remotion/three';
import { useMemo } from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { CameraRig, Dust, Exposure, SceneFog, SkyDome, blend, canvasTexture, easeInOut, hex, mix3, noiseField, smoothstep } from './common';

const SUN = new THREE.Vector3(0.62, 0.2, -1).normalize();
const ROW_X = 4.6, PITCH = 6.2, FIRST_Z = 16, COUNT = 22;
const COLUMN_TOP = 11.75;

// One column: square plinth, moulded base, a fluted shaft that swells slightly (entasis), and a capital.
export function columnGeometry(scale = 1) {
  const shaft = new THREE.CylinderGeometry(0.56, 0.64, 10, 120, 30, true);
  const p = shaft.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), a = Math.atan2(z, x), r = Math.hypot(x, z);
    const flute = 1 - 0.045 * Math.pow(Math.max(0, Math.cos(a * 20)), 0.5);
    const swell = 1 + 0.025 * Math.sin(Math.PI * (y / 10 + 0.5));
    p.setXYZ(i, Math.cos(a) * r * flute * swell, y, Math.sin(a) * r * flute * swell);
  }
  shaft.translate(0, 0.9 + 5, 0);
  const base = new THREE.LatheGeometry([[0.0, 0], [0.82, 0], [0.84, 0.08], [0.8, 0.2], [0.72, 0.27], [0.7, 0.36], [0.76, 0.45], [0.7, 0.53], [0.64, 0.55], [0, 0.55]].map(([x, y]) => new THREE.Vector2(x, y)), 64);
  base.translate(0, 0.35, 0);
  const plinth = new THREE.BoxGeometry(1.8, 0.35, 1.8); plinth.translate(0, 0.175, 0);
  const echinus = new THREE.LatheGeometry([[0, 0], [0.56, 0], [0.6, 0.06], [0.7, 0.16], [0.82, 0.3], [0.9, 0.42], [0, 0.42]].map(([x, y]) => new THREE.Vector2(x, y)), 64);
  echinus.translate(0, 10.9, 0);
  const abacus = new THREE.BoxGeometry(2.0, 0.42, 2.0); abacus.translate(0, 10.9 + 0.42 + 0.21, 0);
  const parts = [plinth, base, shaft, echinus, abacus].map((g) => (g.index ? g.toNonIndexed() : g));
  const merged = mergeGeometries(parts)!;
  merged.computeVertexNormals();
  merged.scale(scale, scale, scale);
  return merged;
}

export const Stone = (seed: number, dark: string, light: string, cells = 6, repeat: [number, number] = [1, 3]) => {
  const size = 512, n = noiseField(size, seed, cells, 5), streak = noiseField(size, seed + 1, 2, 3);
  return canvasTexture(size, (x, y) => {
    const v = n[y * size + x] * 0.75 + streak[y * size + ((x * 7) % size)] * 0.25;
    return blend(hex(dark), hex(light), Math.pow(v, 1.3) * 1.25);
  }, repeat);
};

// Light coming through one gap in the right-hand row: a vertical sheet that leans with the sun and fades
// as it crosses the nave. Additive and soft-edged, so a dozen of them read as haze lit from the side.
const shaftMaterial = () => new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
  uniforms: { color: { value: new THREE.Color('#ffb46e') }, strength: { value: 0.24 }, time: { value: 0 } },
  vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vView; varying float vDist;
    void main(){ vUv = uv; vec4 wp = modelMatrix * vec4(position, 1.0); vN = normalize(mat3(modelMatrix) * normal); vView = normalize(cameraPosition - wp.xyz); vDist = distance(cameraPosition, wp.xyz); gl_Position = projectionMatrix * viewMatrix * wp; }`,
  fragmentShader: `uniform vec3 color; uniform float strength, time; varying vec2 vUv; varying vec3 vN; varying vec3 vView; varying float vDist;
    float h(float n){ return fract(sin(n) * 43758.5453); }
    void main(){
      float along = vUv.x, up = vUv.y;
      float body = smoothstep(0.0, 0.08, up) * smoothstep(1.0, 0.75, up) * exp(-along * 2.6) * smoothstep(0.0, 0.03, along);
      float flicker = 0.85 + 0.15 * sin(time * 0.9 + vUv.x * 9.0 + h(floor(vUv.y * 40.0)) * 6.0);
      // Seen edge-on a sheet would be a hard line, and right in front of the lens it would be a wash: fade both.
      float face = pow(abs(dot(vN, vView)), 1.6);
      float near = smoothstep(4.0, 14.0, vDist);
      gl_FragColor = vec4(color * body * flicker * face * near * strength, 1.0);
    }`,
});

function shaftGeometry(z: number) {
  // A triangle in the plane of the light: from the gap (floor to column top) to where the top ray lands.
  const horizontal = new THREE.Vector3(-SUN.x, 0, -SUN.z).normalize();
  const reach = COLUMN_TOP / (SUN.y / Math.hypot(SUN.x, SUN.z));
  const g = new THREE.BufferGeometry();
  const at = (s: number, y: number) => [ROW_X + horizontal.x * s, y, z + horizontal.z * s];
  const quad = [at(0, 0), at(0, COLUMN_TOP), at(reach, 0), at(reach, 0)];
  // Two triangles; the far top corner sits on the floor, so the sheet thins out along its length.
  g.setAttribute('position', new THREE.Float32BufferAttribute([...quad[0], ...quad[1], ...quad[2], ...quad[1], ...at(reach * 0.55, COLUMN_TOP * 0.45), ...quad[3]], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 0, 1, 1, 0, 0, 1, 0.55, 0.45, 1, 0], 2));
  g.computeVertexNormals();
  return g;
}

const Temple = ({ material, column }: { material: THREE.Material; column: THREE.BufferGeometry }) => {
  const z = -150, scale = 1.9, n = 8, spread = 26;
  const pediment = useMemo(() => {
    const s = new THREE.Shape(); s.moveTo(-17, 0); s.lineTo(17, 0); s.lineTo(0, 7.5); s.closePath();
    return new THREE.ExtrudeGeometry(s, { depth: 4, bevelEnabled: false });
  }, []);
  const top = COLUMN_TOP * scale + 4.2;
  return (
    <group position={[0, 0, z]}>
      {[0, 1, 2].map((i) => <mesh key={i} material={material} position={[0, 0.6 * i + 0.3, 6 - i * 1.2]} receiveShadow><boxGeometry args={[42 - i * 3, 0.6, 14]} /></mesh>)}
      {Array.from({ length: n }, (_, i) => <mesh key={i} geometry={column} material={material} position={[-spread / 2 + (spread / (n - 1)) * i, 1.8, 2]} scale={scale} castShadow />)}
      <mesh material={material} position={[0, top - 2.6, 2]}><boxGeometry args={[34, 2.6, 5]} /></mesh>
      <mesh geometry={pediment} material={material} position={[0, top - 0.1, -0.2]} />
    </group>
  );
};

const Colonnade = ({ frame }: { frame: number }) => {
  const column = useMemo(() => columnGeometry(), []);
  const stone = useMemo(() => new THREE.MeshStandardMaterial({ map: Stone(11, '#7a6d5a', '#e2d3b6'), roughness: 0.78, color: '#ffffff' }), []);
  const farStone = useMemo(() => new THREE.MeshStandardMaterial({ map: Stone(12, '#5d5246', '#a99a80', 4, [2, 2]), roughness: 0.9 }), []);
  const columns = useMemo(() => {
    const mesh = new THREE.InstancedMesh(column, stone, COUNT * 2);
    const m = new THREE.Matrix4();
    for (let i = 0; i < COUNT; i++) for (const [k, x] of [[0, -ROW_X], [1, ROW_X]] as const) {
      m.makeTranslation(x, 0, FIRST_Z - i * PITCH);
      mesh.setMatrixAt(i * 2 + k, m);
    }
    mesh.castShadow = mesh.receiveShadow = true;
    return mesh;
  }, [column, stone]);
  const length = COUNT * PITCH, midZ = FIRST_Z - length / 2 + PITCH / 2;
  const shafts = useMemo(() => {
    const material = shaftMaterial();
    return { material, geometries: Array.from({ length: COUNT - 1 }, (_, i) => shaftGeometry(FIRST_Z - i * PITCH - PITCH / 2)) };
  }, []);
  shafts.material.uniforms.time.value = frame / 30;
  return (
    <>
      <primitive object={columns} />
      {[-ROW_X, ROW_X].map((x) => (
        <mesh key={x} material={stone} position={[x, COLUMN_TOP + 0.75, midZ]} castShadow receiveShadow><boxGeometry args={[2.1, 1.5, length]} /></mesh>
      ))}
      {shafts.geometries.map((g, i) => <mesh key={i} geometry={g} material={shafts.material} renderOrder={5} />)}
      <Temple material={farStone} column={column} />
    </>
  );
};

// Polished stone: a mirror underneath, the slabs drawn over it at most of their opacity, so the columns
// show in the floor as a dim, broken reflection rather than a mirror.
const Floor = () => {
  const mirror = useMemo(() => {
    const r = new Reflector(new THREE.PlaneGeometry(80, 400), { textureWidth: 1080, textureHeight: 1920, color: new THREE.Color('#7d7064'), clipBias: 0.003 });
    r.rotation.x = -Math.PI / 2; r.position.set(0, -0.002, -100);
    return r;
  }, []);
  const slabs = useMemo(() => {
    const size = 1024, n = noiseField(size, 21, 8, 5), cell = size / 4;
    const tex = canvasTexture(size, (x, y) => {
      const gx = x % cell, gy = y % cell, joint = Math.min(gx, gy, cell - gx, cell - gy) < 2.5;
      const tone = ((Math.floor(x / cell) * 7 + Math.floor(y / cell) * 13) % 5) / 5;
      return joint ? hex('#17120d') : blend(hex('#2a231c'), hex('#5c5044'), n[y * size + x] * 0.8 + tone * 0.25);
    }, [80 / 18, 400 / 18]);
    return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.42, transparent: true, opacity: 0.88 });
  }, []);
  return (
    <>
      <primitive object={mirror} />
      <mesh material={slabs} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, -100]} receiveShadow><planeGeometry args={[80, 400]} /></mesh>
    </>
  );
};

// The sun follows the camera down the nave, so its shadow map always covers what is in front of the lens.
const Sun = ({ z }: { z: number }) => {
  const light = useMemo(() => {
    const l = new THREE.DirectionalLight('#ffb978', 7.5);
    l.castShadow = true;
    l.shadow.mapSize.set(4096, 4096);
    Object.assign(l.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 320 });
    l.shadow.bias = -0.0004; l.shadow.normalBias = 0.03; l.shadow.radius = 4;
    return l;
  }, []);
  const target = new THREE.Vector3(0, 0, z - 22);
  light.target.position.copy(target);
  light.position.copy(target).addScaledVector(SUN, 150);
  light.target.updateMatrixWorld();
  return <><primitive object={light} /><primitive object={light.target} /></>;
};

export const Empire = () => {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames } = useVideoConfig();
  const t = easeInOut(frame / (durationInFrames - 1));
  const rise = smoothstep(0.3, 1, frame / (durationInFrames - 1));
  const position = mix3([0.5, 1.45, 15], [-0.35, 1.45, -36], t);
  position[1] += rise * 4.8;
  position[0] += Math.sin(t * Math.PI) * 0.5;
  const target = mix3([0, 3.2, -60], [0, 17, -150], smoothstep(0.15, 1, frame / (durationInFrames - 1)));
  return (
    <AbsoluteFill style={{ background: '#0c0a08' }}>
      <ThreeCanvas width={width} height={height} shadows gl={{ antialias: true }}>
        <Exposure value={1.05} />
        <SceneFog color="#2c241e" density={0.0072} />
        <CameraRig position={position} target={target} fov={48 - rise * 4} />
        <SkyDome zenith="#07111a" horizon="#5e3b24" ground="#120d09" glow="#ffcf8a" sunDir={SUN} glowPower={22} glowStrength={1.9} />
        <hemisphereLight args={['#5f7f9c', '#140e09', 0.9]} />
        {/* A cool fill from behind the camera, so the faces turned away from the sun are blue-grey, not brown. */}
        <directionalLight position={[-6, 9, 40]} intensity={0.55} color="#8fb2d6" />
        <Sun z={position[2]} />
        <Colonnade frame={frame} />
        <Floor />
        <Dust frame={frame} count={7000} box={[[-9, 9], [0.1, 12], [-110, 18]]} seed={5} color="#ffd29a" size={0.045} opacity={0.55} />
      </ThreeCanvas>
    </AbsoluteFill>
  );
};
