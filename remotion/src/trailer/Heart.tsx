// Shot 6, HEART: "small, and hard". An anatomical heart carved in dark stone sits on a plinth in the dark
// under a single shaft of light. The camera pushes in slowly; cracks creep through the stone; the light
// dies towards the end so the edit can fade out of near-black. Built from deformed spheres and tubes:
// the ventricles with the apex down and to the left and a groove between them, the atria and their
// auricles, the aortic arch and its three branches, the pulmonary trunk dividing, the venae cavae and
// the coronary arteries raised over the surface.
import { useThree } from '@react-three/fiber';
import { ThreeCanvas } from '@remotion/three';
import { useMemo } from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { crackMaterial, crackTexture } from './Apparatus';
import { CameraRig, Dust, Exposure, Lens, SceneFog, blend, canvasTexture, easeInOut, hex, lerp, mix3, noiseField, smoothstep, studioEnvironment } from './common';

const hash3 = (x: number, y: number, z: number) => { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); };
function noise3(x: number, y: number, z: number) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z), fx = x - ix, fy = y - iy, fz = z - iz;
  const s = (t: number) => t * t * (3 - 2 * t), sx = s(fx), sy = s(fy), sz = s(fz), c = (a: number, b: number, d: number) => hash3(ix + a, iy + b, iz + d);
  return lerp(lerp(lerp(c(0, 0, 0), c(1, 0, 0), sx), lerp(c(0, 1, 0), c(1, 1, 0), sx), sy), lerp(lerp(c(0, 0, 1), c(1, 0, 1), sx), lerp(c(0, 1, 1), c(1, 1, 1), sx), sy), sz);
}
const fbm3 = (x: number, y: number, z: number) => { let v = 0, a = 0.5, f = 1; for (let i = 0; i < 4; i++) { v += a * noise3(x * f, y * f, z * f); a *= 0.5; f *= 2.1; } return v; };

// The ventricles: a unit sphere direction s becomes a point on a lopsided, tapering, grooved mass.
const grooveX = (y: number) => lerp(-0.12, 0.3, (0.65 - y) / 1.7);
function ventricle(s: THREE.Vector3) {
  const p = new THREE.Vector3(s.x * 1.0, s.y * 1.18, s.z * 0.82);
  if (p.y < 0) { const k = 1 + (p.y / 1.18) * 0.5; p.x *= k; p.z *= k; }
  const below = Math.max(0, -p.y);
  p.x -= 0.34 * below * below; p.z += 0.1 * below * below;
  p.x += 0.09 * Math.max(0, s.z) * Math.max(0, s.x + 0.3);
  if (s.y > 0.55) p.multiplyScalar(1 - 0.12 * (s.y - 0.55));
  const d = Math.abs(p.x - grooveX(p.y));
  if (s.z > 0) p.multiplyScalar(1 - 0.05 * Math.exp(-Math.pow(d / 0.075, 2)) * Math.min(1, s.z * 2));
  const ring = Math.abs(p.y - 0.62);
  p.multiplyScalar(1 - 0.035 * Math.exp(-Math.pow(ring / 0.06, 2)));
  p.multiplyScalar(1 + (fbm3(s.x * 3 + 1, s.y * 3, s.z * 3) - 0.5) * 0.06);
  return p;
}
function ventricleGeometry() {
  const g = new THREE.SphereGeometry(1, 160, 120), p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).normalize(); const q = ventricle(v); p.setXYZ(i, q.x, q.y, q.z); }
  g.computeVertexNormals();
  return g;
}
// A point on the ventricle surface in front of (x, y), for laying the coronary arteries on it.
const onSurface = (x: number, y: number, side = 1, lift = 1.012) => ventricle(new THREE.Vector3(x / 1.0, y / 1.18, side * 0.8).normalize()).multiplyScalar(lift);

function lobe(position: THREE.Vector3Tuple, scale: THREE.Vector3Tuple, seed: number, rotation: THREE.Vector3Tuple = [0, 0, 0]) {
  const g = new THREE.SphereGeometry(1, 64, 48), p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); v.multiplyScalar(1 + (fbm3(v.x * 2.5 + seed, v.y * 2.5, v.z * 2.5) - 0.5) * 0.18); p.setXYZ(i, v.x, v.y, v.z); }
  g.scale(...scale); g.rotateX(rotation[0]); g.rotateY(rotation[1]); g.rotateZ(rotation[2]); g.translate(...position);
  return g;
}
// A vessel: a tube along control points, with a flat cut face at each open end like a carved specimen.
function vessel(points: THREE.Vector3Tuple[], radius: number, taper = 1) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  const tube = new THREE.TubeGeometry(curve, 64, radius, 28, false);
  if (taper !== 1) {
    const p = tube.attributes.position, centre = new THREE.Vector3(), v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      const ring = Math.floor(i / 29), t = ring / 64; curve.getPointAt(Math.min(1, t), centre);
      v.fromBufferAttribute(p, i).sub(centre).multiplyScalar(lerp(1, taper, t)).add(centre); p.setXYZ(i, v.x, v.y, v.z);
    }
  }
  const caps = [0, 1].map((t) => {
    const disc = new THREE.CircleGeometry(radius * (t ? taper : 1), 28), tangent = curve.getTangentAt(t);
    disc.lookAt(t ? tangent : tangent.clone().negate());
    disc.translate(...curve.getPointAt(t).toArray());
    return disc;
  });
  const merged = mergeGeometries([tube, ...caps].map((g) => (g.index ? g.toNonIndexed() : g)))!;
  merged.computeVertexNormals();
  return merged;
}

function anatomy() {
  const aortaPts: THREE.Vector3Tuple[] = [[0.05, 0.75, 0.05], [0.12, 1.45, 0.1], [0.08, 2.1, 0.0], [-0.22, 2.42, -0.22], [-0.58, 2.28, -0.52], [-0.74, 1.7, -0.72], [-0.8, 0.9, -0.84]];
  const arch = new THREE.CatmullRomCurve3(aortaPts.map((p) => new THREE.Vector3(...p)));
  const branch = (t: number, dx: number) => { const a = arch.getPointAt(t); return vessel([a.toArray(), [a.x + dx * 0.4, a.y + 0.45, a.z + 0.05], [a.x + dx, a.y + 0.95, a.z + 0.1]], 0.1, 0.8); };
  const parts = [
    lobe([0.62, 0.92, -0.08], [0.56, 0.48, 0.5], 1),
    lobe([-0.28, 0.98, -0.46], [0.52, 0.42, 0.46], 2),
    lobe([-0.58, 0.9, 0.24], [0.36, 0.17, 0.24], 3, [0.3, 0.4, -0.5]),
    lobe([0.58, 1.12, 0.32], [0.32, 0.16, 0.22], 4, [-0.2, -0.5, 0.4]),
    vessel(aortaPts, 0.27),
    branch(0.36, 0.12), branch(0.44, -0.05), branch(0.52, -0.22),
    vessel([[-0.3, 0.72, 0.42], [-0.38, 1.3, 0.38], [-0.3, 1.72, 0.12]], 0.24),
    vessel([[-0.3, 1.72, 0.12], [-0.72, 1.85, -0.04], [-1.12, 1.74, -0.22]], 0.16, 0.85),
    vessel([[-0.3, 1.72, 0.12], [0.1, 1.92, -0.28], [0.5, 1.86, -0.58]], 0.16, 0.85),
    vessel([[0.66, 1.15, -0.12], [0.69, 1.7, -0.14], [0.67, 2.2, -0.16]], 0.19),
    vessel([[0.56, 0.45, -0.36], [0.62, 0.05, -0.48], [0.62, -0.25, -0.52]], 0.17),
    vessel([[-0.55, 1.0, -0.7], [-0.9, 1.05, -0.85]], 0.1), vessel([[-0.45, 0.85, -0.78], [-0.8, 0.75, -1.0]], 0.1),
  ];
  // Coronaries: the anterior descending artery down the groove, its diagonal branches, and the ring of the
  // coronary sulcus around the base. Thin raised tubes lying on the surface.
  const lad = Array.from({ length: 12 }, (_, i) => { const y = lerp(0.6, -1.0, i / 11); return onSurface(grooveX(y), y).toArray(); });
  parts.push(vessel(lad as THREE.Vector3Tuple[], 0.034, 0.5));
  for (const [y0, dir] of [[0.25, -1], [-0.2, -1], [0.05, 1]] as const) {
    const pts = Array.from({ length: 6 }, (_, i) => { const y = y0 - i * 0.09, x = grooveX(y0) + dir * i * 0.09; return onSurface(x, y).toArray(); });
    parts.push(vessel(pts as THREE.Vector3Tuple[], 0.022, 0.5));
  }
  const ring = Array.from({ length: 16 }, (_, i) => { const a = (i / 15) * Math.PI * 1.6 - 0.3; return ventricle(new THREE.Vector3(Math.cos(a) * 0.79, 0.62 / 1.18 + 0.02, Math.sin(a) * 0.79).normalize()).multiplyScalar(1.015).toArray(); });
  parts.push(vessel(ring as THREE.Vector3Tuple[], 0.04));
  return mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)))!;
}

const Specimen = ({ frame }: { frame: number }) => {
  const gl = useThree((s) => s.gl);
  const env = useMemo(() => studioEnvironment(gl, [
    { color: '#ffe6c4', intensity: 3, position: [-6, 10, 4], size: [3, 3] },
    { color: '#7f9cc8', intensity: 0.8, position: [8, 3, -4], size: [2, 6] },
  ], '#050404'), [gl]);
  const stone = useMemo(() => {
    const size = 1024, n = noiseField(size, 52, 10, 6), fleck = noiseField(size, 53, 128, 2);
    const map = canvasTexture(size, (x, y) => {
      const v = n[y * size + x], f = smoothstep(0.62, 0.7, fleck[y * size + x]);
      return blend(blend(hex('#2a2621'), hex('#5a5249'), Math.pow(v, 1.3) * 1.15), hex('#8a8276'), f * 0.28);
    }, [2, 2]);
    const rough = canvasTexture(size, (x, y) => { const v = 120 + n[y * size + x] * 100; return [v, v, v]; }, [2, 2], false);
    return new THREE.MeshStandardMaterial({ map, roughnessMap: rough, roughness: 1, envMap: env, envMapIntensity: 0.45 });
  }, [env]);
  const body = useMemo(() => ventricleGeometry(), []);
  const rest = useMemo(() => anatomy(), []);
  const cracks = useMemo(() => crackMaterial(crackTexture([[0.3, 0.45], [0.55, 0.6], [0.72, 0.4]])), []);
  cracks.uniforms.progress.value = smoothstep(40, 330, frame) * 0.75 + 0.04;
  const plinth = useMemo(() => {
    const size = 512, n = noiseField(size, 54, 6, 5);
    return new THREE.MeshStandardMaterial({ map: canvasTexture(size, (x, y) => blend(hex('#100e0c'), hex('#2e2924'), n[y * size + x]), [1, 1]), roughness: 0.55, envMap: env, envMapIntensity: 0.3 });
  }, [env]);
  return (
    <>
      {/* Mirrored in x: modelled from the patient's side, this puts the apex, the aortic arch and the left
          auricle on the viewer's right, as in a front view of a real heart. */}
      <group position={[0, 3.42, 0]} rotation={[0.1, 0.3, 0.2]} scale={[-0.95, 0.95, 0.95]}>
        <mesh geometry={body} material={stone} castShadow receiveShadow />
        <mesh geometry={body} material={cracks} scale={1.003} renderOrder={3} />
        <mesh geometry={rest} material={stone} castShadow receiveShadow />
      </group>
      <mesh material={plinth} position={[0, 1.25, 0]} castShadow receiveShadow><boxGeometry args={[3.4, 2.5, 3.4]} /></mesh>
    </>
  );
};

// The shaft of light, as in the commodity shot: a cone that fades towards its edges.
const beam = () => new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  uniforms: { color: { value: new THREE.Color('#ffe2b8') }, strength: { value: 0.06 } },
  vertexShader: 'varying vec3 vN; varying vec3 vV; varying float vY; void main(){ vY = uv.y; vec4 wp = modelMatrix * vec4(position,1.0); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - wp.xyz); gl_Position = projectionMatrix * viewMatrix * wp; }',
  fragmentShader: 'uniform vec3 color; uniform float strength; varying vec3 vN; varying vec3 vV; varying float vY; void main(){ float edge = pow(abs(dot(vN, vV)), 2.0); gl_FragColor = vec4(color * edge * strength * mix(0.3, 1.0, vY) * smoothstep(0.0, 0.55, vY), 1.0); }',
});

export const Heart = () => {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames } = useVideoConfig();
  const t = easeInOut(frame / (durationInFrames - 1));
  const position = mix3([-2.0, 4.8, 16], [0.9, 4.4, 8.8], t);
  const target: THREE.Vector3Tuple = [0, lerp(3.6, 4.0, t), 0];
  const focus = new THREE.Vector3(...position).distanceTo(new THREE.Vector3(0, 4.0, 0.4));
  // The light goes in the last two seconds, leaving the heart a dim shape for the edit's fade.
  const light = 1 - 0.88 * smoothstep(durationInFrames - 75, durationInFrames - 8, frame);
  const shaft = useMemo(() => beam(), []);
  shaft.uniforms.strength.value = 0.06 * light;
  const lamp: THREE.Vector3Tuple = [-3.5, 16, 2.5];
  const coneLength = new THREE.Vector3(...lamp).distanceTo(new THREE.Vector3(0, 3.5, 0));
  const coneDir = new THREE.Vector3(0, 3.5, 0).sub(new THREE.Vector3(...lamp)).normalize();
  const coneQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), coneDir);
  return (
    <AbsoluteFill style={{ background: '#020202' }}>
      <ThreeCanvas width={width} height={height} shadows gl={{ antialias: true }}>
        <Exposure value={1.0} />
        <SceneFog color="#050404" density={0.05} />
        <color attach="background" args={['#030302']} />
        <CameraRig position={position} target={target} fov={30} />
        <spotLight position={lamp} angle={0.24} penumbra={0.6} intensity={2400 * light} decay={2} color="#ffe6c4" castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0002} target-position={[0, 3.2, 0]} />
        <spotLight position={[5, 7, -8]} angle={0.24} penumbra={0.8} intensity={260 * light} color="#7f9cc8" target-position={[0, 4.6, 0]} />
        {/* A low soft fill from the front, so the ventricles and the apex keep their shape under the top light. */}
        <pointLight position={[1.5, 3.2, 8]} intensity={60 * light} distance={20} color="#d8c2a6" />
        <Specimen frame={frame} />
        <mesh material={shaft} position={new THREE.Vector3(...lamp).addScaledVector(coneDir, coneLength / 2).toArray()} quaternion={coneQuat}>
          <cylinderGeometry args={[0.12, 2.6, coneLength, 48, 1, true]} />
        </mesh>
        <Dust frame={frame} count={900} box={[[-2.2, 2.2], [2.5, 15], [-1.5, 3]]} seed={61} color="#ffe6c4" size={0.022} opacity={0.5 * light} wind={[0.0008, -0.0015, 0.0003]} />
        <Lens focus={focus} aperture={0.0022} maxblur={0.011} />
      </ThreeCanvas>
    </AbsoluteFill>
  );
};
