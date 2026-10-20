// Shot 3, RIVER: the living world. A low aerial glide downstream along a meandering river at dawn: the
// valley is carved out of noise, wooded in layers with thousands of trees, the water mirrors the sky
// with slow ripples, and mist lies over the river, lit from behind by the low sun ahead.
import { ThreeCanvas } from '@remotion/three';
import { useMemo } from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import * as THREE from 'three';
import { Water } from 'three/examples/jsm/objects/Water.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CameraRig, Exposure, SceneFog, SkyDome, canvasTexture, clamp, easeInOut, lerp, noiseField, rng, smoothstep } from './common';

const SUN = new THREE.Vector3(0.22, 0.075, -1).normalize();

// Smooth 2D value noise and its fractal sum, for the land.
const hash = (x: number, y: number) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
function noise(x: number, y: number) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  return lerp(lerp(hash(ix, iy), hash(ix + 1, iy), sx), lerp(hash(ix, iy + 1), hash(ix + 1, iy + 1), sx), sy);
}
const fbm = (x: number, y: number, octaves = 5) => { let v = 0, a = 0.5, f = 1; for (let i = 0; i < octaves; i++) { v += a * noise(x * f, y * f); a *= 0.5; f *= 2.03; } return v; };

const riverX = (z: number) => 17 * Math.sin(z * 0.017 + 0.6) + 7 * Math.sin(z * 0.046 + 2.1);
const riverSlope = (z: number) => 17 * 0.017 * Math.cos(z * 0.017 + 0.6) + 7 * 0.046 * Math.cos(z * 0.046 + 2.1);
// The land: banks that rise away from the river into rolling, then steeper, hills. Water level is 0.
function ground(x: number, z: number) {
  const d = Math.abs(x - riverX(z)) + (fbm(x * 0.05, z * 0.05, 3) - 0.5) * 5;
  const banks = 24 * smoothstep(8, 90, d);
  const hills = (fbm(x * 0.011 + 3, z * 0.011, 5) - 0.35) * 46 * smoothstep(14, 70, d);
  const bumps = (fbm(x * 0.06, z * 0.06, 3) - 0.5) * 3.2 * smoothstep(6, 20, d);
  // The bank: a wide, uneven slope into the water, not a cut edge.
  const bed = -3 * (1 - smoothstep(3, 15 + (fbm(x * 0.09, z * 0.09, 2) - 0.5) * 9, d));
  return 0.9 + banks + Math.max(hills, -6) + bumps + bed;
}

function terrain() {
  const g = new THREE.PlaneGeometry(520, 760, 360, 520);
  g.rotateX(-Math.PI / 2);
  g.translate(0, 0, -230);
  const p = g.attributes.position, colors = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) p.setY(i, ground(p.getX(i), p.getZ(i)));
  g.computeVertexNormals();
  const n = g.attributes.normal, c = new THREE.Color();
  const shore = new THREE.Color('#6e6450'), mud = new THREE.Color('#2b2c20'), grass = new THREE.Color('#4b5a2c'), moss = new THREE.Color('#2c3b20'), rock = new THREE.Color('#6b675a'), high = new THREE.Color('#58604a');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), steep = 1 - n.getY(i);
    const v = fbm(x * 0.08, z * 0.08, 3);
    c.copy(grass).lerp(moss, clamp(v * 1.4 - 0.2));
    c.lerp(mud, 1 - smoothstep(0.3, 2.6, y));
    c.lerp(shore, (1 - smoothstep(0.05, 0.9, Math.abs(y - 0.35))) * 0.8);
    c.lerp(high, smoothstep(22, 45, y) * 0.6);
    c.lerp(rock, smoothstep(0.18, 0.42, steep));
    colors.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

// Trees: a lumpy broadleaf crown on a trunk, or a two-tier conifer. Placed on land that is not too
// steep, thickest along the banks, never in the water.
function crownGeometry() {
  const g = new THREE.IcosahedronGeometry(1, 2), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(p, i), k = 0.82 + 0.36 * fbm(v.x * 2.2 + 5, v.y * 2.2 + v.z * 1.7, 3);
    p.setXYZ(i, v.x * k, v.y * k * 0.85, v.z * k);
  }
  g.computeVertexNormals();
  return g;
}
// Three ragged tiers: each cone's rim is pulled in and out so the outline is branchy, not a smooth cone.
function coniferGeometry() {
  const tiers = [[1, 1.5, 0.55], [0.78, 1.35, 1.25], [0.52, 1.2, 1.95]].map(([radius, h, y], k) => {
    const g = new THREE.ConeGeometry(radius, h, 11, 2), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i), a = Math.atan2(z, x), j = 1 + 0.22 * Math.sin(a * 5 + k * 1.7) + 0.12 * Math.sin(a * 11 + k);
      if (p.getY(i) < h / 2 - 0.01) { p.setX(i, x * j); p.setZ(i, z * j); p.setY(i, p.getY(i) - 0.12 * Math.abs(Math.sin(a * 5 + k))); }
    }
    g.translate(0, y, 0);
    return g;
  });
  const merged = mergeGeometries(tiers)!;
  merged.computeVertexNormals();
  return merged;
}
// Near the camera the trees get more geometry: a crown of three lumpy lobes with leafy clumps in the
// surface and darker undersides (vertex colours), and a conifer of five ragged, drooping tiers.
function detailedCrown() {
  const lobes = [[0, 0, 0, 1], [0.55, -0.18, 0.22, 0.72], [-0.42, -0.1, -0.3, 0.68], [0.08, 0.38, -0.42, 0.62]].map(([x, y, z, r], k) => {
    const g = new THREE.IcosahedronGeometry(r, 4), p = g.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const n = fbm(v.x * 2.4 + k * 7, v.y * 2.4 + v.z * 1.9, 3) * 0.7 + fbm(v.x * 7 + k, v.y * 7 + v.z * 6, 2) * 0.3;
      v.multiplyScalar(0.78 + 0.42 * n); v.y *= 0.88;
      p.setXYZ(i, v.x + x, v.y + y, v.z + z);
    }
    return g;
  });
  const g = mergeGeometries(lobes)!, p = g.attributes.position, colors = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) { const shade = 0.5 + 0.5 * smoothstep(-0.9, 0.7, p.getY(i)); colors.set([shade, shade, shade], i * 3); }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return g;
}
function detailedConifer() {
  const tiers = [[1.05, 1.2, 0.5], [0.9, 1.1, 1.05], [0.72, 1.0, 1.55], [0.54, 0.9, 2.0], [0.34, 0.8, 2.4]].map(([radius, h, y], k) => {
    const g = new THREE.ConeGeometry(radius, h, 18, 3), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i), a = Math.atan2(z, x), rim = 1 - (p.getY(i) + h / 2) / h;
      const j = 1 + 0.28 * Math.sin(a * 7 + k * 1.9) * rim + 0.14 * Math.sin(a * 13 + k * 3.1) * rim + (hash(i, k) - 0.5) * 0.18 * rim;
      p.setX(i, x * j); p.setZ(i, z * j); p.setY(i, p.getY(i) - 0.18 * rim * Math.abs(Math.sin(a * 7 + k)));
    }
    g.translate(0, y, 0);
    return g;
  });
  const g = mergeGeometries(tiers)!;
  g.computeVertexNormals();
  return g;
}
// Trees within this reach of the camera's path get the detailed geometry.
const nearCamera = (x: number, z: number) => z > -160 && z < 95 && Math.abs(x - (riverX(z) * 0.7 + 9)) < 85;

function forest(count: number, seed: number) {
  const r = rng(seed), broad: THREE.Matrix4[] = [], trunks: THREE.Matrix4[] = [], conifers: THREE.Matrix4[] = [], tones: number[] = [], coneTones: number[] = [], broadNear: boolean[] = [], coneNear: boolean[] = [];
  let tries = 0;
  while (broad.length + conifers.length < count && tries++ < count * 20) {
    const z = 140 - r() * 600, x = (r() - 0.5) * 330, y = ground(x, z), d = Math.abs(x - riverX(z));
    if (y < 1.3 || d < 11.5 || Math.abs(x - riverX(z)) > 170) continue;
    const slope = Math.abs(ground(x + 1, z) - ground(x - 1, z)) + Math.abs(ground(x, z + 1) - ground(x, z - 1));
    if (slope > 2.6 || r() > 0.25 + 0.75 * (1 - smoothstep(10, 90, d)) * (0.5 + fbm(x * 0.03, z * 0.03, 2))) continue;
    const s = 1.0 + r() * 1.3;
    if (r() < 0.7) {
      broad.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y + s * 1.9, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, r() * 6.28, 0)), new THREE.Vector3(s * (0.9 + r() * 0.3), s, s * (0.9 + r() * 0.3))));
      trunks.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y + s * 0.6, z), new THREE.Quaternion(), new THREE.Vector3(s * 0.12, s * 1.2, s * 0.12)));
      tones.push(r()); broadNear.push(nearCamera(x, z));
    } else {
      conifers.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y - 0.2, z), new THREE.Quaternion().setFromEuler(new THREE.Euler((r() - 0.5) * 0.06, r() * 6.28, (r() - 0.5) * 0.06)), new THREE.Vector3(s * 0.85, s * 1.7, s * 0.85)));
      coneTones.push(r()); coneNear.push(nearCamera(x, z));
    }
  }
  return { broad, trunks, conifers, tones, coneTones, broadNear, coneNear };
}

const Land = () => {
  const g = useMemo(() => terrain(), []);
  const detail = useMemo(() => {
    const size = 512, n = noiseField(size, 61, 16, 4);
    return canvasTexture(size, (x, y) => { const v = 150 + n[y * size + x] * 105; return [v, v, v]; }, [60, 90]);
  }, []);
  const material = useMemo(() => new THREE.MeshStandardMaterial({ vertexColors: true, map: detail, roughness: 0.95 }), [detail]);
  const trees = useMemo(() => {
    const size = 256, rn = noiseField(size, 71, 8, 4);
    const leafRough = canvasTexture(size, (x, y) => { const v = 150 + rn[y * size + x] * 105; return [v, v, v]; }, [3, 3], false);
    const f = forest(17000, 3), mats = {
      crown: new THREE.MeshStandardMaterial({ roughness: 0.9, color: '#ffffff' }),
      crownNear: new THREE.MeshStandardMaterial({ roughness: 1, roughnessMap: leafRough, vertexColors: true, color: '#ffffff' }),
      trunk: new THREE.MeshStandardMaterial({ roughness: 1, color: '#2a2018' }),
      conifer: new THREE.MeshStandardMaterial({ roughness: 0.9, color: '#ffffff' }),
      coniferNear: new THREE.MeshStandardMaterial({ roughness: 1, roughnessMap: leafRough, color: '#ffffff' }),
    };
    const make = (geo: THREE.BufferGeometry, mat: THREE.Material, list: THREE.Matrix4[], tone?: (i: number) => THREE.Color) => {
      const m = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((x, i) => { m.setMatrixAt(i, x); if (tone) m.setColorAt(i, tone(i)); });
      m.castShadow = true; m.receiveShadow = true;
      return m;
    };
    const greens = ['#2f4a22', '#3b5626', '#46602b', '#2a3f22', '#556a2e', '#6a6a30'].map((c) => new THREE.Color(c));
    const pick = <T,>(list: T[], flags: boolean[], near: boolean) => list.map((v, i) => [v, i] as const).filter(([, i]) => flags[i] === near);
    const crowns = (near: boolean) => { const l = pick(f.broad, f.broadNear, near); return make(near ? detailedCrown() : crownGeometry(), near ? mats.crownNear : mats.crown, l.map(([m]) => m), (k) => greens[Math.floor(f.tones[l[k][1]] * greens.length)]); };
    const cones = (near: boolean) => { const l = pick(f.conifers, f.coneNear, near); return make(near ? detailedConifer() : coniferGeometry(), near ? mats.coniferNear : mats.conifer, l.map(([m]) => m), (k) => new THREE.Color('#1f3320').lerp(new THREE.Color('#33472a'), f.coneTones[l[k][1]])); };
    return [crowns(true), crowns(false), make(new THREE.CylinderGeometry(0.6, 1, 1, 7), mats.trunk, f.trunks), cones(true), cones(false)];
  }, []);
  return (
    <>
      <mesh geometry={g} material={material} receiveShadow castShadow />
      {trees.map((t, i) => <primitive key={i} object={t} />)}
    </>
  );
};

// The water: a mirror broken by slow ripples (a tileable normal map drawn from noise), tinted dark green.
const River = ({ frame }: { frame: number }) => {
  const water = useMemo(() => {
    const size = 512, n = noiseField(size, 90, 8, 5), at = (x: number, y: number) => n[((y + size) % size) * size + ((x + size) % size)];
    const normals = canvasTexture(size, (x, y) => {
      const dx = (at(x + 1, y) - at(x - 1, y)) * 5, dy = (at(x, y + 1) - at(x, y - 1)) * 5, l = Math.hypot(dx, dy, 1);
      return [(-dx / l * 0.5 + 0.5) * 255, (-dy / l * 0.5 + 0.5) * 255, (1 / l * 0.5 + 0.5) * 255];
    }, [1, 1], false);
    const w = new Water(new THREE.PlaneGeometry(520, 760), { textureWidth: 1080, textureHeight: 1920, waterNormals: normals, sunDirection: SUN.clone(), sunColor: '#ffd7a6', waterColor: '#16282a', distortionScale: 0.45, fog: true, alpha: 1 });
    w.rotation.x = -Math.PI / 2; w.position.set(0, 0, -230);
    return w;
  }, []);
  (water.material as THREE.ShaderMaterial).uniforms.time.value = frame / 30 * 0.2;
  return <primitive object={water} />;
};

// Mist: soft cloud sheets lying over the valley at a few heights, drifting slowly downstream.
const Mist = ({ frame }: { frame: number }) => {
  const sheets = useMemo(() => {
    const size = 512, n = noiseField(size, 13, 3, 5);
    const tex = canvasTexture(size, (x, y) => { const v = smoothstep(0.42, 0.78, n[y * size + x]) * 255; return [v, v, v]; }, [1, 1], false);
    const r = rng(17);
    return Array.from({ length: 14 }, (_, i) => {
      const map = tex.clone(); map.needsUpdate = true; map.offset.set(r(), r());
      const z = 60 - i * 34;
      return { map, z, x: riverX(z) + (r() - 0.5) * 20, y: 1.2 + (i % 3) * 2.2 + r(), w: 90 + r() * 60, h: 70 + r() * 40, opacity: 0.22 + r() * 0.12, speed: 0.00025 + r() * 0.0002 };
    });
  }, []);
  return (
    <>
      {sheets.map((s, i) => {
        s.map.offset.y = (s.map.offset.y + 0) % 1;
        const m = new THREE.Vector2(s.map.offset.x + frame * s.speed, s.map.offset.y);
        return (
          <mesh key={i} position={[s.x, s.y, s.z]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={4}>
            <planeGeometry args={[s.w, s.h]} />
            <meshBasicMaterial alphaMap={s.map} alphaMap-offset={m} color="#e6dfd6" transparent opacity={s.opacity} depthWrite={false} fog />
          </mesh>
        );
      })}
    </>
  );
};

const Sun = ({ z }: { z: number }) => {
  const light = useMemo(() => {
    const l = new THREE.DirectionalLight('#ffc994', 3.2);
    l.castShadow = true; l.shadow.mapSize.set(4096, 4096);
    Object.assign(l.shadow.camera, { left: -110, right: 110, top: 110, bottom: -110, near: 1, far: 600 });
    l.shadow.bias = -0.0005; l.shadow.normalBias = 0.4;
    return l;
  }, []);
  const target = new THREE.Vector3(riverX(z - 70), 0, z - 70);
  light.target.position.copy(target);
  light.position.copy(target).addScaledVector(SUN, 300);
  light.target.updateMatrixWorld();
  return <><primitive object={light} /><primitive object={light.target} /></>;
};

export const RiverScene = () => {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames } = useVideoConfig();
  const t = easeInOut(frame / (durationInFrames - 1)) * 0.8 + (frame / (durationInFrames - 1)) * 0.2;
  const z = lerp(70, -40, t), ahead = z - 120;
  const position: THREE.Vector3Tuple = [riverX(z) * 0.7 + 9, lerp(44, 30, t), z];
  const target: THREE.Vector3Tuple = [riverX(ahead) * 0.9, 0, ahead];
  return (
    <AbsoluteFill style={{ background: '#1b2026' }}>
      <ThreeCanvas width={width} height={height} shadows gl={{ antialias: true }}>
        <Exposure value={1.12} />
        <SceneFog color="#9a9a96" density={0.0042} />
        <CameraRig position={position} target={target} fov={46} roll={-riverSlope(z - 40) * 0.07} />
        <SkyDome zenith="#2f4d6c" horizon="#b9a08f" ground="#3a3a34" glow="#ffd2a0" sunDir={SUN} glowPower={30} glowStrength={1.0} />
        <hemisphereLight args={['#a9c0d6', '#3a3b2c', 1.7]} />
        <Sun z={z} />
        <Land />
        <River frame={frame} />
        <Mist frame={frame} />
      </ThreeCanvas>
    </AbsoluteFill>
  );
};
