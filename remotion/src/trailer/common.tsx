// Shared pieces for the "Of the Empire" trailer plates: seeded randomness (every frame must render the
// same way twice), procedural textures drawn on a canvas, a gradient sky, drifting dust and a camera
// that is placed from the frame number rather than animated.
import { useFrame, useThree } from '@react-three/fiber';
import { useLayoutEffect, useMemo } from 'react';
import * as THREE from 'three';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';

export const TRAILER_FPS = 30;
export const WIDTH = 1080, HEIGHT = 1920;
// Every plate carries this many frames before and after its shot, for the edit's cuts and dissolves.
export const HANDLE = 15;

export const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const smoothstep = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const mix3 = (a: THREE.Vector3Tuple, b: THREE.Vector3Tuple, t: number): THREE.Vector3Tuple => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

// mulberry32: small, fast and the same on every machine.
export const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// Tileable value noise, summed over octaves, in 0-1.
export function noiseField(size: number, seed: number, cells: number, octaves = 4) {
  const r = rng(seed), out = new Float32Array(size * size);
  let amp = 1, total = 0;
  for (let o = 0; o < octaves; o++) {
    const n = cells << o, grid = Array.from({ length: n * n }, () => r());
    const at = (x: number, y: number) => grid[((y % n) + n) % n * n + ((x % n) + n) % n];
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const fx = (x / size) * n, fy = (y / size) * n, ix = Math.floor(fx), iy = Math.floor(fy);
      const tx = fx - ix, ty = fy - iy, sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const v = lerp(lerp(at(ix, iy), at(ix + 1, iy), sx), lerp(at(ix, iy + 1), at(ix + 1, iy + 1), sx), sy);
      out[y * size + x] += v * amp;
    }
    total += amp; amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

// A colour texture from a noise field: `paint` turns a noise value (and the pixel) into RGB.
export function canvasTexture(size: number, paint: (x: number, y: number) => [number, number, number], repeat: [number, number] = [1, 1], color = true) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!, img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const [r, g, b] = paint(x, y), i = (y * size + x) * 4;
    img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(...repeat);
  tex.anisotropy = 8;
  if (color) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
export const hex = (c: string): [number, number, number] => { const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
export const blend = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

// A soft round sprite for dust and glints.
export function softDot(size = 64) {
  return canvasTexture(size, (x, y) => {
    const d = Math.hypot(x - size / 2 + 0.5, y - size / 2 + 0.5) / (size / 2);
    const v = Math.pow(clamp(1 - d), 2.2) * 255;
    return [v, v, v];
  }, [1, 1], false);
}

// The sky as a sphere around everything: dark overhead, warm at the horizon, a glow where the sun is.
// It ignores fog on purpose, so it reads as the light the haze is lit by.
export const SkyDome = ({ zenith, horizon, ground, glow, sunDir, glowPower = 24, glowStrength = 1.2 }: { zenith: string; horizon: string; ground: string; glow: string; sunDir: THREE.Vector3; glowPower?: number; glowStrength?: number }) => {
  const material = useMemo(() => new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { zenith: { value: new THREE.Color(zenith) }, horizon: { value: new THREE.Color(horizon) }, ground: { value: new THREE.Color(ground) }, glow: { value: new THREE.Color(glow) }, sun: { value: sunDir.clone().normalize() }, power: { value: glowPower }, strength: { value: glowStrength } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 zenith, horizon, ground, glow, sun; uniform float power, strength; varying vec3 vDir;
      float h21(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void main(){ float h = vDir.y; vec3 c = h > 0.0 ? mix(horizon, zenith, pow(clamp(h * 1.8, 0.0, 1.0), 0.45)) : mix(horizon, ground, pow(clamp(-h, 0.0, 1.0), 0.4));
        float s = max(dot(normalize(vDir), sun), 0.0); c += glow * (pow(s, power) * strength + pow(s, 4.0) * 0.25 * strength);
        // A little noise breaks up the banding a smooth 8-bit gradient shows.
        c += (h21(gl_FragCoord.xy) - 0.5) / 255.0 * 2.0;
        gl_FragColor = vec4(c, 1.0); }`,
  }), [zenith, horizon, ground, glow, sunDir, glowPower, glowStrength]);
  return <mesh material={material} renderOrder={-10} frustumCulled={false}><sphereGeometry args={[900, 48, 24]} /></mesh>;
};

// Dust hanging in the air, drifting with a slow breeze. Positions come from the frame, not from state.
export const Dust = ({ frame, count, box, seed, color, size, opacity, wind = [0.004, 0.0015, 0.002] }: { frame: number; count: number; box: [[number, number], [number, number], [number, number]]; seed: number; color: string; size: number; opacity: number; wind?: THREE.Vector3Tuple }) => {
  const base = useMemo(() => { const r = rng(seed); return Float32Array.from({ length: count * 4 }, () => r()); }, [count, seed]);
  const geometry = useMemo(() => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3)); return g; }, [count]);
  const material = useMemo(() => new THREE.PointsMaterial({ size, map: softDot(), color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }), [size, color, opacity]);
  const pos = geometry.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < count; i++) {
    const [u, v, w, p] = [base[i * 4], base[i * 4 + 1], base[i * 4 + 2], base[i * 4 + 3]];
    const wrap = (a: number, [lo, hi]: [number, number]) => lo + ((((a - lo) % (hi - lo)) + (hi - lo)) % (hi - lo));
    pos.setXYZ(i,
      wrap(lerp(box[0][0], box[0][1], u) + frame * wind[0] * (0.5 + p) + Math.sin(frame * 0.02 + p * 40) * 0.08, box[0]),
      wrap(lerp(box[1][0], box[1][1], v) + frame * wind[1] * (p - 0.3) + Math.sin(frame * 0.015 + p * 70) * 0.06, box[1]),
      wrap(lerp(box[2][0], box[2][1], w) + frame * wind[2], box[2]));
  }
  pos.needsUpdate = true;
  return <points geometry={geometry} material={material} frustumCulled={false} />;
};

// The camera for this frame: where it is, what it looks at, how wide it sees.
export const CameraRig = ({ position, target, fov, roll = 0 }: { position: THREE.Vector3Tuple; target: THREE.Vector3Tuple; fov: number; roll?: number }) => {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  useLayoutEffect(() => {
    camera.position.set(...position);
    camera.up.set(Math.sin(roll), Math.cos(roll), 0);
    camera.lookAt(...target);
    camera.fov = fov; camera.near = 0.1; camera.far = 2000;
    camera.updateProjectionMatrix();
  });
  return null;
};

// Renderer settings every plate shares: filmic tone mapping at a chosen exposure, soft shadows.
export const Exposure = ({ value }: { value: number }) => {
  const gl = useThree((s) => s.gl);
  useLayoutEffect(() => { gl.toneMapping = THREE.ACESFilmicToneMapping; gl.toneMappingExposure = value; gl.shadowMap.type = THREE.PCFShadowMap; }, [gl, value]);
  return null;
};

// A fog that every standard material in the scene picks up.
export const SceneFog = ({ color, density }: { color: string; density: number }) => {
  const scene = useThree((s) => s.scene);
  useLayoutEffect(() => { scene.fog = new THREE.FogExp2(color, density); }, [scene, color, density]);
  return null;
};

// Reflections for metal and glaze: a dark room lit by a few glowing panels, prefiltered once. Gold and
// polished stone show these panels as long soft highlights, which is what makes them read as real.
export type Panel = { color: string; intensity: number; position: THREE.Vector3Tuple; size: [number, number] };
export function studioEnvironment(gl: THREE.WebGLRenderer, panels: Panel[], background = '#050403') {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(background);
  for (const p of panels) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(...p.size), new THREE.MeshBasicMaterial({ color: new THREE.Color(p.color).multiplyScalar(p.intensity), side: THREE.DoubleSide }));
    mesh.position.set(...p.position);
    mesh.lookAt(0, 0, 0);
    scene.add(mesh);
  }
  const pmrem = new THREE.PMREMGenerator(gl);
  const texture = pmrem.fromScene(scene, 0.02).texture;
  pmrem.dispose();
  return texture;
}

// A lens with real depth of field, for the close shots: the scene renders into a multisampled target,
// a bokeh pass blurs what is off the focus distance, and the output pass applies tone mapping.
// Taking over rendering (useFrame with a priority) stops the canvas drawing the frame a second time.
export const Lens = ({ focus, aperture, maxblur = 0.012 }: { focus: number; aperture: number; maxblur?: number }) => {
  const { gl, scene, camera, size } = useThree();
  const lens = useMemo(() => {
    const target = new THREE.WebGLRenderTarget(size.width, size.height, { samples: 4, type: THREE.HalfFloatType });
    const composer = new EffectComposer(gl, target);
    composer.setPixelRatio(1);
    composer.addPass(new RenderPass(scene, camera));
    const bokeh = new BokehPass(scene, camera, { focus, aperture, maxblur });
    composer.addPass(bokeh);
    composer.addPass(new OutputPass());
    composer.setSize(size.width, size.height);
    return { composer, bokeh };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, scene, camera, size.width, size.height]);
  const u = lens.bokeh.uniforms as Record<string, { value: number }>;
  u.focus.value = focus; u.aperture.value = aperture; u.maxblur.value = maxblur;
  useFrame(() => {
    const cam = camera as THREE.PerspectiveCamera;
    u.nearClip.value = cam.near; u.farClip.value = cam.far;
    lens.composer.render();
  }, 1);
  return null;
};
