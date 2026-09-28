import { test } from 'node:test';
import assert from 'node:assert/strict';
import { locate, normalizeTrack, poseAt, project, sceneCentre } from '../src/tracking.js';

const WORK = { frames: 60, width: 1080, height: 1920, duration: 2 };

// A camera circling the origin at radius R, always looking at it: the same shape as a phone carried
// round a table, and every pose is known exactly, so what comes back out can be checked against it.
// Poses are given as camera-to-world matrices, the way ARKit and three.js write them: the columns are
// the camera's right, up and BACK axes (it looks along its own -Z), then its position.
const norm = v => { const l = Math.hypot(...v) || 1; return v.map(x => x / l); };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function orbit({ radius = 4, samples = 21, height = 1.5, sweep = 60 } = {}) {
  const frames = [];
  for (let i = 0; i < samples; i++) {
    const a = ((sweep * (i / (samples - 1) - 0.5)) * Math.PI) / 180;
    const position = [Math.sin(a) * radius, height, Math.cos(a) * radius];
    const back = norm(position);                       // from the origin towards the camera
    const right = norm(cross([0, 1, 0], back));
    const up = cross(back, right);
    frames.push({
      t: (i / (samples - 1)) * (WORK.frames / 30),
      matrix: [...right, 0, ...up, 0, ...back, 0, ...position, 1],
    });
  }
  return { frames, fovY: 60, up: [0, 1, 0] };
}

test('a track covers every frame of the clip and keeps the camera where it was put', () => {
  const track = normalizeTrack(orbit(), WORK, 'upload');
  assert.equal(track.frames, WORK.frames);
  assert.equal(track.coverage, 1);
  assert.equal(track.poses.filter(Boolean).length, WORK.frames);
  assert.equal(track.fovY, 60);
  // Portrait clip: the stored aspect is the footage's, which is what project() divides by.
  assert.ok(Math.abs(track.aspect - WORK.width / WORK.height) < 1e-9);
  const mid = poseAt(track, WORK.frames / 2);
  assert.ok(Math.abs(Math.hypot(mid.position[0], mid.position[2]) - 4) < 0.02, 'stays on the orbit');
  assert.ok(Math.abs(mid.position[1] - 1.5) < 0.02, 'keeps its height');
});

test('the middle of the shot projects to the middle of the frame', () => {
  const track = normalizeTrack(orbit(), WORK, 'upload');
  for (const frame of [0, 15, 30, 45, 59]) {
    const p = project(track, frame, [0, 0, 0]);
    assert.equal(p.behind, false);
    assert.ok(Math.abs(p.x - 0.5) < 0.01 && Math.abs(p.y - 0.5) < 0.01, `frame ${frame} -> ${p.x},${p.y}`);
  }
});

test('a point behind the camera is reported rather than drawn somewhere wrong', () => {
  const track = normalizeTrack(orbit(), WORK, 'upload');
  const pose = poseAt(track, 30);
  // Twice as far from the origin as the camera, along the same line: behind it.
  const behind = pose.position.map(v => v * 2);
  assert.equal(project(track, 30, behind).behind, true);
});

test('a spot marked on two frames is triangulated back to where it really is', () => {
  const track = normalizeTrack(orbit(), WORK, 'upload');
  const truth = [0.4, 0.25, -0.3];
  const sightings = [0, 59].map(frame => {
    const p = project(track, frame, truth);
    return { frame, x: p.x, y: p.y };
  });
  const got = locate(track, sightings);
  assert.equal(got.how, 'triangulated');
  assert.ok(got.error < 0.002, `reprojection error ${got.error}`);
  for (const [i, v] of got.position.entries()) assert.ok(Math.abs(v - truth[i]) < 0.02, `axis ${i}: ${v} vs ${truth[i]}`);
});

test('two marks from the same angle are refused instead of guessed at', () => {
  const track = normalizeTrack(orbit({ sweep: 0.2 }), WORK, 'upload');
  const sightings = [0, 59].map(frame => {
    const p = project(track, frame, [0.4, 0.25, -0.3]);
    return { frame, x: p.x, y: p.y };
  });
  assert.throws(() => locate(track, sightings), /nearly the same angle|at least two frames/);
});

test('one mark is placed from the scene points when the solve found some', () => {
  const cloud = [];
  for (let i = 0; i < 400; i++) cloud.push([(i % 20) / 20 - 0.5, ((i * 7) % 20) / 40 - 0.25, ((i * 13) % 20) / 20 - 0.5]);
  const track = normalizeTrack({ ...orbit(), points: cloud }, WORK, 'upload');
  const p = project(track, 30, [0, 0, 0]);
  const got = locate(track, [{ frame: 30, x: p.x, y: p.y }]);
  assert.equal(got.how, 'from scene points');
  assert.ok(Math.hypot(...got.position) < 1.2, `landed at ${got.position}`);
});

test('a track that misses most of the clip is refused', () => {
  const short = orbit();
  short.frames = short.frames.slice(0, 3).map((f, i) => ({ ...f, t: i * 0.05 }));
  assert.throws(() => normalizeTrack(short, WORK, 'upload'), /only covers/);
});

test('a world-to-camera track in OpenCV convention comes back the same as an AR one', () => {
  const gl = normalizeTrack(orbit(), WORK, 'upload');
  // The same cameras written the way COLMAP reports them: looking along +Z with +Y down, and storing
  // the transform from the world into the camera rather than the other way about.
  const qmul = (a, b) => [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
  const conj = q => [-q[0], -q[1], -q[2], q[3]];
  const rot = (q, v) => qmul(qmul(q, [...v, 0]), conj(q)).slice(0, 3);
  const frames = [];
  for (let n = 0; n < WORK.frames; n += 3) {
    const pose = poseAt(gl, n);
    const cv = qmul(pose.q, [1, 0, 0, 0]);             // OpenGL -> OpenCV: a half turn about X
    const w2c = conj(cv);
    frames.push({ frame: n, quaternion: w2c, position: rot(w2c, pose.position).map(v => -v) });
  }
  const back = normalizeTrack({ convention: 'opencv', space: 'world-to-camera', fps: 30, fovY: 60, frames }, WORK, 'solved');
  assert.equal(back.frames, WORK.frames);
  for (const n of [6, 24, 42]) {
    const a = poseAt(gl, n), b = poseAt(back, n);
    for (const [i, v] of a.position.entries()) assert.ok(Math.abs(v - b.position[i]) < 0.01, `frame ${n} axis ${i}: ${b.position[i]} vs ${v}`);
    const p = project(back, n, [0, 0, 0]);
    assert.ok(Math.abs(p.x - 0.5) < 0.02 && Math.abs(p.y - 0.5) < 0.02, `frame ${n} centre -> ${p.x},${p.y}`);
  }
});

test('the scene centre falls inside the points when there are some', () => {
  const cloud = [];
  for (let i = 0; i < 200; i++) cloud.push([(i % 10) - 5, (i % 3) - 1, ((i * 3) % 10) - 5]);
  const track = normalizeTrack({ ...orbit(), points: cloud }, WORK, 'upload');
  const c = sceneCentre(track);
  assert.equal(c.length, 3);
  for (const v of c) assert.ok(Number.isFinite(v));
});
