// Camera tracks: where the camera was and which way it looked on every frame of a clip, so things can be
// placed in the room rather than on the screen and stay put when the camera looks away and back.
// Two sources, in order of preference:
//  1. A track recorded while filming by an AR app (ARKit/ARCore), uploaded as JSON: real-time, gravity-
//     aligned and usually exact.
//  2. A track solved on this server from the footage itself with COLMAP (src/track-worker.py): works on
//     any clip with some camera movement and texture, but can fail and has no real-world scale.
// Everything here is plain arithmetic on the stored track, the same in the app and in tests.
import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { availableParallelism, setPriority } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { FPS } from './footage.js';

const fail = (message, httpStatus = 400) => Object.assign(new Error(message), { httpStatus });
const WORKER = join(dirname(fileURLToPath(import.meta.url)), 'track-worker.py');

// ---- Small vector and quaternion helpers (quaternions as [x, y, z, w]) ------------------------------
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = a => Math.hypot(a[0], a[1], a[2]);
const unit = a => { const l = len(a) || 1; return mul(a, 1 / l); };
function qnorm(q) { const l = Math.hypot(...q) || 1; return q.map(v => v / l); }
function qmul(a, b) {
  const [ax, ay, az, aw] = a, [bx, by, bz, bw] = b;
  return [aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx, aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz];
}
const qconj = q => [-q[0], -q[1], -q[2], q[3]];
export const qrotate = (q, v) => qmul(qmul(q, [...v, 0]), qconj(q)).slice(0, 3);
function qslerp(a, b, t) {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  if (d < 0) { b = b.map(v => -v); d = -d; }
  if (d > 0.9995) return qnorm(a.map((v, i) => v + (b[i] - v) * t));
  const th = Math.acos(d), s = Math.sin(th);
  return a.map((v, i) => (v * Math.sin((1 - t) * th) + b[i] * Math.sin(t * th)) / s);
}
function qfromMatrix(m) { // m: 3x3 row-major [[r00,r01,r02],[r10..],[r20..]]
  const [[a, b, c], [d, e, f], [g, h, i]] = m, tr = a + e + i;
  let q;
  if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; q = [(h - f) / s, (c - g) / s, (d - b) / s, s / 4]; }
  else if (a > e && a > i) { const s = Math.sqrt(1 + a - e - i) * 2; q = [s / 4, (b + d) / s, (c + g) / s, (h - f) / s]; }
  else if (e > i) { const s = Math.sqrt(1 + e - a - i) * 2; q = [(b + d) / s, s / 4, (f + h) / s, (c - g) / s]; }
  else { const s = Math.sqrt(1 + i - a - e) * 2; q = [(c + g) / s, (f + h) / s, s / 4, (d - b) / s]; }
  return qnorm(q);
}
const qaxis = (axis, deg) => { const h = (deg * Math.PI) / 360, s = Math.sin(h); return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(h)]; };
// Turning a camera from OpenCV's convention (looks along +Z, +Y down) to OpenGL's (looks along −Z, +Y up):
// a half turn about its own X axis.
const CV_TO_GL = [1, 0, 0, 0];

// ---- Normalising a track to one pose per clip frame -----------------------------------------------
// The stored form: for every frame of the working copy, the camera's position and camera-to-world rotation
// in OpenGL convention (looks along −Z, +Y up), or null where nothing is known; the vertical field of view;
// which way is up in the world; a typical distance to the scene (for clipping planes and sizes); and a
// sample of scene points when the source had them (for placing things with a single sighting).
export function normalizeTrack(input, work, source = 'upload') {
  if (!input || typeof input !== 'object' || !Array.isArray(input.frames) || input.frames.length < 2) throw fail('A camera track needs a "frames" list with at least two poses');
  if (input.frames.length > 100000) throw fail('That track has too many poses');
  const convention = input.convention ?? 'opengl';
  if (!['opengl', 'opencv'].includes(convention)) throw fail('convention must be "opengl" (ARKit, three.js) or "opencv" (COLMAP)');
  const space = input.space ?? 'camera-to-world';
  if (!['camera-to-world', 'world-to-camera'].includes(space)) throw fail('space must be "camera-to-world" (ARKit camera.transform) or "world-to-camera" (COLMAP)');
  const fps = Number(input.fps) || FPS;
  const workPortrait = work.height > work.width;
  // Field of view: given directly, or from intrinsics, turned to the working copy's orientation.
  let fovY = Number(input.fovY);
  if (!(fovY > 1 && fovY < 170)) {
    const k = input.intrinsics;
    if (!k || !(k.fx > 0 && k.fy > 0 && k.width > 0 && k.height > 0)) throw fail('Give the camera\'s vertical field of view as "fovY" in degrees, or "intrinsics" {fx, fy, width, height}');
    const vertical = (2 * Math.atan(k.height / 2 / k.fy) * 180) / Math.PI, horizontal = (2 * Math.atan(k.width / 2 / k.fx) * 180) / Math.PI;
    fovY = (k.height > k.width) === workPortrait ? vertical : horizontal;
  }
  const roll = Number(input.roll) || 0;
  if (![0, 90, -90, 180, 270].includes(roll)) throw fail('roll must be 0, 90, -90 or 180');
  const rollQ = qaxis([0, 0, 1], roll);
  const samples = [];
  for (const [i, s] of input.frames.entries()) {
    let position, q;
    if (Array.isArray(s.matrix) && s.matrix.length === 16) {
      const m = s.matrix.map(Number); // column-major 4x4, as ARKit's simd_float4x4 and three.js store it
      q = qfromMatrix([[m[0], m[4], m[8]], [m[1], m[5], m[9]], [m[2], m[6], m[10]]]);
      position = [m[12], m[13], m[14]];
    } else if (Array.isArray(s.position) && Array.isArray(s.quaternion) && s.position.length === 3 && s.quaternion.length === 4) {
      position = s.position.map(Number); q = qnorm(s.quaternion.map(Number));
    } else throw fail(`frames.${i}: give "position" [x,y,z] and "quaternion" [x,y,z,w], or a 16-number "matrix"`);
    if (![...position, ...q].every(Number.isFinite)) throw fail(`frames.${i}: not a number`);
    if (space === 'world-to-camera') { const inv = qconj(q); position = mul(qrotate(inv, position), -1); q = inv; }
    if (convention === 'opencv') q = qmul(q, CV_TO_GL);
    if (roll) q = qmul(q, rollQ);
    const t = s.t != null ? Number(s.t) : s.frame != null ? Number(s.frame) / fps : i / fps;
    if (!Number.isFinite(t)) throw fail(`frames.${i}: t or frame is not a number`);
    samples.push({ t, position, q });
  }
  samples.sort((a, b) => a.t - b.t);
  // One pose per clip frame, interpolated between the nearest samples; frames outside the samples hold on
  // to the nearest one for up to half a second, and are unknown beyond that.
  const poses = [];
  let j = 0, known = 0;
  for (let n = 0; n < work.frames; n++) {
    const t = n / FPS;
    while (j < samples.length - 2 && samples[j + 1].t <= t) j++;
    const a = samples[j], b = samples[Math.min(samples.length - 1, j + 1)];
    let pose = null;
    if (t <= samples[0].t) pose = samples[0].t - t <= 0.5 ? samples[0] : null;
    else if (t >= samples.at(-1).t) pose = t - samples.at(-1).t <= 0.5 ? samples.at(-1) : null;
    else if (b.t - a.t <= 1.5) {
      const k = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0;
      pose = { position: add(a.position, mul(sub(b.position, a.position), k)), q: qslerp(a.q, b.q, k) };
    }
    if (pose) known++;
    poses.push(pose ? [...pose.position.map(v => +v.toFixed(6)), ...pose.q.map(v => +v.toFixed(7))] : null);
  }
  if (known < work.frames * 0.5) throw fail(`The track only covers ${known} of the clip's ${work.frames} frames; check its times (t in seconds from the start of the video, or frame with fps)`);
  const points = Array.isArray(input.points) ? input.points.filter(p => Array.isArray(p) && p.length >= 3 && p.slice(0, 3).every(Number.isFinite)).map(p => p.slice(0, 3)) : [];
  const centres = poses.filter(Boolean).map(p => p.slice(0, 3));
  let up = Array.isArray(input.up) && input.up.length === 3 ? unit(input.up.map(Number)) : null;
  if (!up) up = convention === 'opengl' && source === 'upload' ? [0, 1, 0] : estimateUp(points, poses);
  const scale = typicalDistance(points, poses, centres);
  return { source, frames: work.frames, fovY: +fovY.toFixed(4), aspect: work.width / work.height, up: up.map(v => +v.toFixed(6)), scale, poses,
    points: sample(points, 6000).map(p => p.map(v => +v.toFixed(5))), coverage: +(known / work.frames).toFixed(3), ...(input.quality ? { quality: input.quality } : {}) };
}

function sample(list, max) {
  if (list.length <= max) return list;
  const step = list.length / max;
  return Array.from({ length: max }, (_, i) => list[Math.floor(i * step)]);
}

// A typical camera-to-scene distance, from points in front of the cameras, or the camera path's size.
function typicalDistance(points, poses, centres) {
  const d = [];
  const known = poses.filter(Boolean);
  for (const p of sample(points, 800)) {
    const pose = known[Math.floor((d.length * 7919) % known.length)];
    d.push(len(sub(p, pose.slice(0, 3))));
  }
  if (d.length) return +d.sort((a, b) => a - b)[Math.floor(d.length / 2)].toFixed(6);
  let spread = 0;
  for (const c of centres) spread = Math.max(spread, len(sub(c, centres[0])));
  return +Math.max(1, spread * 3).toFixed(6);
}

// Which way is up, when the source does not say (a COLMAP solve has no gravity). The table or floor is
// usually the biggest flat surface under the cameras, so its normal is up; failing that, the cameras' own
// average up direction, which is right for a phone held upright.
export function estimateUp(points, poses) {
  const known = poses.filter(Boolean);
  let camUp = [0, 0, 0], centre = [0, 0, 0];
  for (const p of known) { camUp = add(camUp, qrotate(p.slice(3), [0, 1, 0])); centre = add(centre, p.slice(0, 3)); }
  camUp = unit(camUp); centre = mul(centre, 1 / Math.max(1, known.length));
  const pts = sample(points, 3000);
  if (pts.length < 50) return camUp;
  const scale = typicalDistance(pts, poses, []);
  const tol = scale * 0.015;
  let best = null, bestCount = 0, seed = 12345;
  const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (let it = 0; it < 400; it++) {
    const [a, b, c] = [0, 1, 2].map(() => pts[Math.floor(rand() * pts.length)]);
    const n = cross(sub(b, a), sub(c, a));
    if (len(n) < 1e-12) continue;
    const nu = unit(n);
    if (Math.abs(dot(nu, camUp)) < 0.5) continue; // walls and the like are not the floor
    let count = 0;
    for (const p of pts) if (Math.abs(dot(sub(p, a), nu)) < tol) count++;
    if (count > bestCount) { bestCount = count; best = { nu, a }; }
  }
  if (!best || bestCount < pts.length * 0.12) return camUp;
  // Point it from the surface towards the cameras.
  return dot(sub(centre, best.a), best.nu) < 0 ? mul(best.nu, -1) : best.nu;
}

// ---- Looking through the tracked camera -------------------------------------------------------------
export function poseAt(track, frame) {
  const n = Math.max(0, Math.min(track.frames - 1, frame));
  const a = Math.floor(n), b = Math.min(track.frames - 1, a + 1), k = n - a;
  const pa = track.poses[a], pb = track.poses[b];
  if (!pa && !pb) return null;
  if (!pa || !pb || k === 0) { const p = pa ?? pb; return { position: p.slice(0, 3), q: p.slice(3) }; }
  return { position: add(pa.slice(0, 3), mul(sub(pb.slice(0, 3), pa.slice(0, 3)), k)), q: qslerp(pa.slice(3), pb.slice(3), k) };
}
// Where a world point shows in a frame, in 0–1 of the footage, and whether it is in front of the camera.
export function project(track, frame, point) {
  const pose = poseAt(track, frame);
  if (!pose) return null;
  const v = qrotate(qconj(pose.q), sub(point, pose.position));
  if (v[2] >= -1e-9) return { x: NaN, y: NaN, behind: true };
  const f = 1 / Math.tan((track.fovY * Math.PI) / 360);
  return { x: 0.5 + ((v[0] / -v[2]) * f) / track.aspect / 2, y: 0.5 - ((v[1] / -v[2]) * f) / 2, behind: false, depth: -v[2] };
}
// The ray from the camera through a point of the footage (0–1), in the world.
function ray(track, frame, x, y) {
  const pose = poseAt(track, frame);
  if (!pose) return null;
  const f = 1 / Math.tan((track.fovY * Math.PI) / 360);
  const dir = unit(qrotate(pose.q, [((x - 0.5) * 2 * track.aspect) / f, ((0.5 - y) * 2) / f, -1]));
  return { origin: pose.position, dir };
}

// Where a spot marked on frames of the clip is in the world. Two or more sightings from different angles
// are triangulated (the point nearest to every ray); a single sighting uses the scene points the solve
// found near that ray. Answers with the reprojection error, so a careless mark shows up.
export function locate(track, sightings) {
  const rays = sightings.map(s => ({ s, r: ray(track, s.frame, s.x, s.y) })).filter(x => x.r);
  if (!rays.length) throw fail('None of the sightings is on a frame the camera track covers');
  let position, how;
  const widest = Math.max(0, ...rays.flatMap(a => rays.map(b => (Math.acos(Math.min(1, Math.abs(dot(a.r.dir, b.r.dir))))) * 180 / Math.PI)));
  if (rays.length >= 2 && widest >= 1.5) {
    // Solve (Σ I − d dᵀ) p = Σ (I − d dᵀ) o for the point nearest every ray.
    const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], b = [0, 0, 0];
    for (const { r } of rays) {
      const d = r.dir;
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
        const m = (i === j ? 1 : 0) - d[i] * d[j];
        A[i][j] += m; b[i] += m * r.origin[j];
      }
    }
    position = solve3(A, b); how = 'triangulated';
  } else if (track.points?.length) {
    // The scene points close to the ray; the nearest cluster of them is the surface that was marked.
    const { r } = rays[0], near = [];
    for (const p of track.points) {
      const v = sub(p, r.origin), along = dot(v, r.dir);
      if (along <= 0) continue;
      const off = len(sub(v, mul(r.dir, along)));
      if (off < along * 0.012) near.push(along);
    }
    if (near.length < 3) throw fail(`No scene points were found under the sighting on frame ${rays[0].s.frame}; mark the spot on a second frame from a different angle`);
    near.sort((a, b) => a - b);
    const depth = near[Math.floor(near.length * 0.2)];
    position = add(r.origin, mul(r.dir, depth)); how = 'from scene points';
  } else throw fail(rays.length >= 2 ? `The sightings are from nearly the same angle (${widest.toFixed(1)}°); mark the spot on frames where the camera has moved more` : 'Mark the spot on at least two frames from different angles (this track has no scene points to place a single sighting)');
  let err = 0, n = 0;
  for (const { s } of rays) {
    const p = project(track, s.frame, position);
    if (!p || p.behind) continue;
    err += Math.hypot((p.x - s.x) * track.aspect, p.y - s.y); n++;
  }
  return { position: position.map(v => +v.toFixed(6)), how, error: n ? +(err / n).toFixed(4) : null, angle: +widest.toFixed(1) };
}
function solve3(A, b) {
  const det = m => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det(A);
  if (Math.abs(D) < 1e-15) throw fail('The sightings do not meet at a point; check they mark the same spot');
  return [0, 1, 2].map(k => det(A.map((row, i) => row.map((v, j) => (j === k ? b[i] : v)))) / D);
}

// ---- The server solve ---------------------------------------------------------------------------------
export const trackLimits = env => ({ seconds: Number(env.TRACK_MAX_SECONDS) || 60, python: env.TRACK_PYTHON || 'python3' });

// Runs COLMAP on up to ~120 frames spread over the clip (all compared with each other, so coming back to
// a place joins up), then turns its result into a track. onProgress gets a stage name.
export async function solveTrack(video, work, folder, { python = 'python3', onProgress, timeoutMs = 3 * 60 * 60000 } = {}) {
  const step = Math.max(1, Math.ceil(work.frames / 120));
  const scratch = `${folder}.solve`;
  await rm(scratch, { recursive: true, force: true });
  await mkdir(scratch, { recursive: true });
  try {
    const job = { video, dir: scratch, step, frames: work.frames, threads: Math.max(1, availableParallelism() - 1) };
    const raw = await new Promise((resolve, reject) => {
      const child = spawn(python, [WORKER, JSON.stringify(job)], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GLOG_minloglevel: '2', PYTHONDONTWRITEBYTECODE: '1' } });
      if (child.pid) try { setPriority(child.pid, 15); } catch {}
      let pending = '', err = '', result = null;
      child.stdout.on('data', d => {
        pending += d;
        const lines = pending.split('\n'); pending = lines.pop();
        for (const line of lines) { let m; try { m = JSON.parse(line); } catch { continue; } if (m.stage) onProgress?.(m.stage); if (m.result) result = m.result; if (m.error) err = m.error; }
      });
      child.stderr.on('data', d => { err = (err + d).slice(-2000); });
      const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
      child.on('error', e => { clearTimeout(timer); reject(e.code === 'ENOENT' ? new Error(`${python} is not installed, so tracks cannot be solved here`) : e); });
      child.on('close', (code, signal) => {
        clearTimeout(timer);
        if (code === 0 && result) return resolve(result);
        reject(new Error(signal === 'SIGKILL' ? 'Solving the camera took too long' : (err.split('\n').map(l => l.trim()).filter(Boolean).pop() || 'Solving the camera failed').slice(0, 400)));
      });
    });
    if (raw.registered < raw.images * 0.6) throw new Error(`Only ${raw.registered} of ${raw.images} sampled frames could be placed; the clip needs more camera movement (not just turning on the spot), more texture, or less blur. Upload an AR track or use 2D anchors instead`);
    return normalizeTrack({ convention: 'opencv', space: 'world-to-camera', fps: FPS, intrinsics: raw.intrinsics, frames: raw.frames, points: raw.points,
      quality: { registered: raw.registered, images: raw.images, error: raw.error } }, work, 'solved');
  } finally { await rm(scratch, { recursive: true, force: true }); }
}

export async function saveTrack(folder, track) {
  await mkdir(folder, { recursive: true });
  const file = join(folder, 'track.json');
  await writeFile(`${file}.part`, JSON.stringify(track));
  await rename(`${file}.part`, file);
  return { source: track.source, frames: track.frames, coverage: track.coverage, fovY: track.fovY, updated: new Date().toISOString(), ...(track.quality ? { quality: track.quality } : {}) };
}
export const loadTrack = async folder => JSON.parse(await readFile(join(folder, 'track.json'), 'utf8'));

// A point in the middle of what the cameras looked at, for centring the checking grid when no spot has
// been marked: the middle of the scene points, or failing those, a scene-distance ahead of the camera
// half way through the clip.
export function sceneCentre(track) {
  if (track.points?.length >= 8) {
    const mid = axis => { const v = track.points.map(p => p[axis]).sort((a, b) => a - b); return v[v.length >> 1]; };
    return [mid(0), mid(1), mid(2)];
  }
  const pose = poseAt(track, Math.floor(track.frames / 2));
  if (!pose) return [0, 0, 0];
  return add(pose.position, mul(qrotate(pose.q, [0, 0, -1]), track.scale));
}

// ---- A picture to check a track by: a grid on the ground and the world points, drawn into frames ---------
export async function trackOverlay(frameJpeg, track, frame, { centre, points = [], size = 540 }) {
  const img = sharp(frameJpeg), meta = await img.metadata();
  const W = meta.width, H = meta.height;
  const up = track.up, e1 = unit(Math.abs(up[0]) < 0.9 ? cross(up, [1, 0, 0]) : cross(up, [0, 0, 1])), e2 = cross(up, e1);
  const cell = track.scale * 0.08, N = 6, lines = [];
  const at = p => { const s = project(track, frame, p); return s && !s.behind ? [s.x * W, s.y * H] : null; };
  for (let i = -N; i <= N; i++) for (const [ea, eb] of [[e1, e2], [e2, e1]]) {
    const pts = [];
    for (let k = -N; k <= N; k++) pts.push(at(add(centre, add(mul(ea, i * cell), mul(eb, k * cell)))));
    const seg = pts.filter(Boolean);
    if (seg.length > 1) lines.push(`<polyline points="${seg.map(p => p.map(v => v.toFixed(1)).join(',')).join(' ')}" fill="none" stroke="#d4ed86" stroke-width="${W / 400}" opacity="0.8"/>`);
  }
  const upTip = at(add(centre, mul(up, cell * 3))), base = at(centre);
  if (base && upTip) lines.push(`<line x1="${base[0]}" y1="${base[1]}" x2="${upTip[0]}" y2="${upTip[1]}" stroke="#ff6b5b" stroke-width="${W / 200}"/>`);
  for (const p of points) {
    const s = at(p.position);
    if (s) lines.push(`<circle cx="${s[0]}" cy="${s[1]}" r="${W / 90}" fill="#ff6b5b" stroke="#fff" stroke-width="${W / 400}"/><text x="${s[0] + W / 60}" y="${s[1]}" font-size="${W / 28}" font-family="sans-serif" font-weight="700" fill="#fff" stroke="#000" stroke-width="${W / 500}">${p.name}</text>`);
  }
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${lines.join('')}</svg>`);
  // Two passes on purpose: sharp resizes before it composites whatever order the calls are written in,
  // so drawing and shrinking in one pipeline would shrink the frame first and then refuse the
  // full-size overlay as too big.
  const drawn = await img.composite([{ input: svg }]).png().toBuffer();
  return sharp(drawn).resize({ width: size }).jpeg({ quality: 82 }).toBuffer();
}
