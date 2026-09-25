// 3D models (GLB) over footage: a model uploaded for the clip, played through its own animations
// (walk, idle, sit…) frame-exactly, turned, tilted and lit to sit in the shot, with a soft shadow on an
// invisible floor under it. Each model layer is a transparent canvas over the whole frame, where one unit
// at the model's depth is one pixel of the finished frame, so it lands exactly on `at` or its path.
import { ThreeCanvas } from '@remotion/three';
import { useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { cancelRender, continueRender, delayRender } from 'remotion';
import type { ModelLayer, Track } from './model';
import { PALETTE, colour, motionStyle, phase } from './model';

const FOV = 20;
const loaded = new Map<string, GLTF>();
const loading = new Map<string, Promise<GLTF>>();
const load = (url: string) => {
  if (!loading.has(url)) loading.set(url, fetch(url)
    .then((r) => { if (!r.ok) throw new Error(`3D model ${url}: HTTP ${r.status}`); return r.arrayBuffer(); })
    .then((buffer) => new Promise<GLTF>((ok, fail) => new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parse(buffer, '', ok, fail)))
    .then((gltf) => { loaded.set(url, gltf); return gltf; }));
  return loading.get(url)!;
};

// Each model file is fetched and parsed once per page; every layer showing it gets its own copy. A view
// holds the frame until its model is on screen, and lets go if it is taken away before that.
function useGltf(url: string | null): GLTF | null {
  const [gltf, setGltf] = useState<GLTF | null>(() => (url ? loaded.get(url) ?? null : null));
  const hold = useRef<number | null>(null);
  if (url && !gltf && hold.current == null) hold.current = delayRender(`Loading 3D model ${url}`, { timeoutInMilliseconds: 120000 });
  const release = () => { if (hold.current != null) { continueRender(hold.current); hold.current = null; } };
  useEffect(() => {
    if (!url || gltf) return;
    let live = true;
    load(url).then((g) => { if (live) setGltf(g); }).catch((err) => cancelRender(err));
    return () => { live = false; };
  }, [url, gltf]);
  useLayoutEffect(() => { if (gltf) release(); }, [gltf]);
  useEffect(() => release, []);
  return gltf;
}

// A value from a track of keys (frames from the layer's start), eased, held before the first and after the last.
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
function valueAt(track: Track | undefined, frame: number, fallback: number) {
  if (!track?.length) return fallback;
  if (frame <= track[0].frame) return track[0].value;
  const last = track[track.length - 1];
  if (frame >= last.frame) return last.value;
  const i = track.findIndex((k, n) => frame >= k.frame && frame < track[n + 1].frame);
  const a = track[i], b = track[i + 1];
  return a.value + (b.value - a.value) * ease((frame - a.frame) / (b.frame - a.frame));
}

// Which animations play at an output frame and how strongly: the layer's own from its start, then each
// action from its frame, cross-fading over `blend` frames.
type Play = { name: string; start: number; speed: number; loop: boolean; stride?: number };
function playing(layer: ModelLayer, frame: number) {
  const plays: Play[] = [];
  if (layer.animation) plays.push({ name: layer.animation, start: layer.from, speed: layer.speed, loop: layer.loop, stride: layer.stride });
  for (const a of layer.actions ?? []) plays.push({ name: a.animation, start: a.frame, speed: a.speed ?? layer.speed, loop: a.loop ?? true, stride: a.stride });
  const started = plays.filter((p) => frame >= p.start);
  const now = started[started.length - 1], before = started[started.length - 2];
  if (!now) return [];
  const w = layer.blend > 0 && before ? Math.min(1, (frame - now.start) / layer.blend) : 1;
  return w < 1 ? [{ play: now, weight: w }, { play: before!, weight: 1 - w }] : [{ play: now, weight: 1 }];
}

const LIGHT: Record<ModelLayer['light'], [number, number, number]> = { left: [-1, 1.2, 0.8], right: [1, 1.2, 0.8], front: [0.2, 0.9, 1.4], top: [0.1, 2, 0.3], back: [0.3, 1, -1.2] };

function toonRamp() {
  const data = new Uint8Array([90, 170, 255]);
  const t = new THREE.DataTexture(data, 3, 1, THREE.RedFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true;
  return t;
}
// The drawn look: flat bands of shade and an ink outline (the model's back faces pushed out a little).
function makeToon(root: THREE.Object3D, outline: number) {
  const ramp = toonRamp();
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
  const worldScale = new THREE.Vector3();
  for (const mesh of meshes) {
    const toon = (m: THREE.Material) => {
      const s = m as THREE.MeshStandardMaterial;
      return new THREE.MeshToonMaterial({ color: s.color ?? new THREE.Color('#fff'), map: s.map ?? null, gradientMap: ramp, transparent: s.transparent, opacity: s.opacity, alphaTest: s.alphaTest, side: s.side, vertexColors: s.vertexColors });
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(toon) : toon(mesh.material);
    if (!mesh.geometry.getAttribute('normal')) continue;
    mesh.getWorldScale(worldScale);
    const width = outline / Math.max(1e-6, (worldScale.x + worldScale.y + worldScale.z) / 3);
    const ink = new THREE.MeshBasicMaterial({ color: PALETTE.ink, side: THREE.BackSide });
    ink.onBeforeCompile = (shader) => {
      shader.uniforms.outline = { value: width };
      shader.vertexShader = `uniform float outline;\n${shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += normalize(normal) * outline;')}`;
    };
    const skinned = mesh as THREE.SkinnedMesh;
    let hull: THREE.Mesh;
    if (skinned.isSkinnedMesh) { const s = new THREE.SkinnedMesh(mesh.geometry, ink); s.bind(skinned.skeleton, skinned.bindMatrix); hull = s; }
    else hull = new THREE.Mesh(mesh.geometry, ink);
    hull.morphTargetInfluences = mesh.morphTargetInfluences;
    hull.frustumCulled = false;
    mesh.add(hull);
  }
}

// walked(frame): pixels moved along the path by then, for walk cycles tied to distance (stride).
export type ModelPose = { x: number; y: number; frame: number; dir: number; lean: number; walked: (frame: number) => number };
// The turn that makes a model face the camera, from the way it faces as made.
const FRONT: Record<ModelLayer['front'], number> = { camera: 0, away: 180, right: -90, left: 90 };

// Inside the canvas: the model, its light and floor, posed for the current frame before the canvas draws.
const Stage = ({ gltf, layer, pose, width, height }: { gltf: GLTF; layer: ModelLayer; pose: ModelPose; width: number; height: number }) => {
  const { gl, scene } = useThree();
  const rig = useMemo(() => {
    const model = cloneSkinned(gltf.scene);
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model, true);
    const size = box.getSize(new THREE.Vector3()), centre = box.getCenter(new THREE.Vector3());
    const fit = (layer.size * height) / Math.max(1e-6, size.y || size.x);
    // A tint gets its own copies of the materials: the loaded model is shared with other layers.
    if (layer.color) {
      const tint = new THREE.Color(colour(layer.color, PALETTE.paper));
      model.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const recolour = (m: THREE.Material) => { const c = m.clone() as THREE.MeshStandardMaterial; c.color?.copy(tint); return c; };
        mesh.material = Array.isArray(mesh.material) ? mesh.material.map(recolour) : recolour(mesh.material);
      });
    }
    if (layer.look === 'toon') makeToon(model, (3.2 * height) / 1920 / fit);
    model.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.frustumCulled = false; } });
    const pivot = new THREE.Group();
    pivot.position.set(-centre.x, layer.pin === 'feet' ? -box.min.y : -centre.y, -centre.z);
    pivot.add(model);
    const yaw = new THREE.Group(); yaw.add(pivot);
    const tilt = new THREE.Group(); tilt.add(yaw);
    const place = new THREE.Group(); place.add(tilt);
    // The floor catches only the shadow; it sits at the model's feet and tilts with it.
    const reach = Math.max(size.x, size.y, size.z);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(reach * 6, reach * 6), new THREE.ShadowMaterial({ opacity: layer.shadow }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = layer.pin === 'feet' ? 0 : box.min.y - centre.y;
    floor.receiveShadow = true;
    floor.visible = layer.shadow > 0;
    tilt.add(floor);
    const sun = new THREE.DirectionalLight('#fff8ee', 2.2 * layer.brightness);
    const [lx, ly, lz] = LIGHT[layer.light];
    sun.position.set(lx * reach * 2, ly * reach * 2 + floor.position.y, lz * reach * 2);
    sun.target.position.set(0, floor.position.y, 0);
    sun.castShadow = layer.shadow > 0;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.radius = 4; sun.shadow.bias = -0.0005;
    tilt.add(sun, sun.target);
    tilt.add(new THREE.HemisphereLight('#ffffff', '#8a7d6b', 0.9 * layer.brightness));
    // A soft fill from the camera's side, as a room's bounce light would give: a model lit from behind
    // should read as backlit, not as a black cut-out.
    const fill = new THREE.DirectionalLight('#fff6ea', (layer.light === 'back' ? 1.1 : 0.6) * layer.brightness);
    fill.position.set(0, reach * 1.2 + floor.position.y, reach * 3);
    fill.target.position.set(0, floor.position.y, 0);
    tilt.add(fill, fill.target);
    const mixer = new THREE.AnimationMixer(model);
    const actions = new Map<string, THREE.AnimationAction>();
    for (const clip of gltf.animations) {
      if (actions.has(clip.name)) continue;
      const a = mixer.clipAction(clip);
      a.play(); a.setEffectiveWeight(0);
      actions.set(clip.name, a);
    }
    return { place, tilt, yaw, fit, mixer, actions, sun, reach };
  }, [gltf, layer, height]);

  useLayoutEffect(() => {
    scene.add(rig.place);
    // Soft reflections, so metal and gloss look like they do in a modelling program rather than black.
    const pmrem = new THREE.PMREMGenerator(gl);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env; scene.environmentIntensity = 0.5 * layer.brightness;
    return () => { scene.remove(rig.place); env.dispose(); pmrem.dispose(); rig.mixer.stopAllAction(); };
  }, [rig, scene, gl, layer.brightness]);

  // Posed during React's layout pass, which comes before the canvas draws this frame.
  const p = phase(layer, pose.frame);
  const m = motionStyle(layer.enter, layer.exit, p.enter, p.exit);
  const k = layer.keys ?? {};
  rig.place.position.set(pose.x + m.dx - width / 2, height / 2 - (pose.y + m.dy), 0);
  rig.place.rotation.z = (-pose.lean * Math.PI) / 180;
  rig.tilt.rotation.x = (valueAt(k.tilt, p.local, layer.tilt) * Math.PI) / 180;
  const scale = rig.fit * valueAt(k.scale, p.local, 1) * m.scale;
  rig.tilt.scale.setScalar(scale);
  // The shadow camera is not inside the scaled group, so its box is sized in pixels around the model.
  const box = rig.reach * scale * 2.5, shadow = rig.sun.shadow;
  Object.assign(shadow.camera, { left: -box, right: box, top: box, bottom: -box, near: box * 0.01, far: box * 4 });
  shadow.camera.updateProjectionMatrix();
  shadow.normalBias = rig.reach * scale * 0.004;
  const facing = (layer.facing === 'path' ? pose.dir * layer.angle : 0) + FRONT[layer.front ?? 'camera'];
  rig.yaw.rotation.set(0, ((valueAt(k.turn, p.local, layer.turn) + facing + valueAt(k.spin, p.local, 0)) * Math.PI) / 180, (valueAt(k.roll, p.local, 0) * Math.PI) / 180);
  for (const a of rig.actions.values()) a.setEffectiveWeight(0);
  for (const { play, weight } of playing(layer, pose.frame)) {
    const a = rig.actions.get(play.name);
    if (!a) continue;
    const d = a.getClip().duration;
    // With a stride the animation runs on distance: one loop per stride (a multiple of its height) moved.
    const t = play.stride
      ? (Math.max(0, pose.walked(pose.frame) - pose.walked(play.start)) / (play.stride * layer.size * height)) * d
      : Math.max(0, ((pose.frame - play.start) / 30) * play.speed);
    a.enabled = true; a.paused = false;
    a.time = d > 0 ? (play.loop ? t % d : Math.min(t, d)) : 0;
    a.setEffectiveWeight(weight);
  }
  rig.mixer.update(0);
  return null;
};

export const ModelView = ({ layer, src, pose, width, height, filter }: { layer: ModelLayer; src: string | null; pose: ModelPose; width: number; height: number; filter?: string }) => {
  const gltf = useGltf(src);
  const p = phase(layer, pose.frame);
  if (!gltf || !p.on) return null;
  const m = motionStyle(layer.enter, layer.exit, p.enter, p.exit);
  const distance = height / 2 / Math.tan((FOV * Math.PI) / 360);
  return (
    <ThreeCanvas width={width} height={height} flat shadows="percentage" gl={{ alpha: true, antialias: true, preserveDrawingBuffer: true }}
      camera={{ fov: FOV, position: [0, 0, distance], near: distance / 20, far: distance * 20 }}
      style={{ position: 'absolute', left: 0, top: 0, opacity: m.opacity * layer.opacity, filter }}>
      <Stage gltf={gltf} layer={layer} pose={pose} width={width} height={height} />
    </ThreeCanvas>
  );
};
