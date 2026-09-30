// Falling leaves that bump into each other, simulated ONCE for the whole video and then looked up by
// frame. Remotion renders frames out of order, in several tabs at once, so a physics world stepped
// per rendered frame would come out different every time. Instead each tab runs this same pure
// function up front (a few milliseconds) and reads frame N from the table. Same inputs, same floats,
// same video.
//
// Each leaf is a sphere around its outline. That is crude for something flat, but it is exactly the
// guarantee wanted: two spheres that never overlap hold leaves that never slice through each other,
// however they happen to be turned.
//
// Weight works the way it does in air. A leaf's `weight` sets how fast it falls (terminal speed) and
// how slowly the air corrects it, and weight x area is its mass in a collision. So a heavy oak leaf
// knocks a birch leaf aside and barely notices; the birch leaf gets shoved, rocks, and the air
// settles it back into its sway.

export type LeafSpec = {
  weight: number;    // ~0.6 (dry, papery) .. ~1.4 (thick, fresh)
  scale: number;     // the model is a 1x1-unit plane; this is its size in the scene
  x: number; y: number; z: number; // start position (the simulation warms up before frame 0)
  swingRate: number; // pendulum rate, rad/s
  swingAmp: number;  // pendulum half-width, units
  spinRate: number;  // slow turn about the stem, rad/s
  spin0: number; lean: number; phase0: number;
  radius?: number;   // collision radius in scene units; defaults to PHYS.radius * scale
  // A spot to land on, if any. From time `at` (seconds from frame 0) the leaf waits until it is on
  // screen and above the spot, then leaves the fall and glides there: position to (x, y, z), every
  // rotation to flat. Leaves without one just keep falling.
  land?: { x: number; y: number; z: number; at: number };
};
export type LeafMode = 'falling' | 'settling' | 'landed';
// `landing` goes 0 -> 1 as a leaf settles, for anything that should change along with it (size, say).
export type LeafPose = { x: number; y: number; z: number; rx: number; ry: number; rz: number; phase: number; mode: LeafMode; landing: number };

export const PHYS = {
  top: 3.9, span: 7.8,          // leaves leave below top - span and re-enter at top, both off screen
  reentry: 0.6,                 // how far above `top` a wrapped leaf comes back in, clear of the screen edge
  boundX: 1.35, boundZ: 1.2,    // soft walls: a leaf past these is steered back, not stopped
  radius: 0.47,                 // of the collision sphere, per unit of scale
  fallSpeed: 0.42,              // terminal speed at weight 1, units/s
  airRate: 2.6,                 // how fast the air pulls a weight-1 leaf back to its sway, 1/s
  bounce: 0.25,                 // restitution: 0 = leaves stop dead against each other, 1 = rubber
  rockKick: 5, spinKick: 3,     // how much of a hit turns into rocking / turning
  // Share of an overlap removed per substep. 1 removes it at once, which is exact but a deep overlap
  // then shows as a one-frame jump; a fraction spreads the correction over a few substeps.
  pushRate: 0.35,
  bankRate: 6,                  // how fast the bank follows sideways speed, 1/s: a shove eases into a tilt

  landOmega: 4.5,               // the landing spring: critically damped, so it arrives without overshooting
  landRotOmega: 5.5,
  onScreenY: 2.3,               // a lander only starts its glide while this close to the middle of the screen...
  landLate: 2.5,                // ...unless it is this many seconds past its time, then it goes from wherever it is

  warmupSeconds: 3,             // settles the starting overlaps before anything is on screen
  substeps: 4,
} as const;

export type Phys = { -readonly [K in keyof typeof PHYS]: number };

// `opts` overrides any PHYS value for one scene, e.g. a thinner boundZ.
export const simulateLeaves = (leaves: LeafSpec[], frames: number, fps: number, opts: Partial<Phys> = {}): LeafPose[][] => {
  const P: Phys = { ...PHYS, ...opts }, n = leaves.length, dt = 1 / (fps * P.substeps);
  const mass = leaves.map((l) => l.weight * l.scale * l.scale);
  const rad = leaves.map((l) => l.radius ?? P.radius * l.scale);
  const s = leaves.map((l) => ({
    x: l.x, y: l.y, z: l.z, vx: 0, vy: -P.fallSpeed * l.weight, vz: 0,
    phase: l.phase0, spin: l.spin0, spinVel: l.spinRate, rock: 0, rockVel: 0, bank: 0,
    mode: 'falling' as LeafMode, rx: 0, ry: 0, rz: 0, rxv: 0, ryv: 0, rzv: 0, ryTarget: 0, settled: 0,
  }));
  // The rotation a falling leaf is drawn with. A lander takes these as its starting values when it
  // begins to settle, so the hand-over from falling to settling is seamless.
  const fallingRot = (i: number) => {
    const q = s[i];
    return { rx: -0.45 + 0.45 * Math.cos(q.phase), ry: q.spin, rz: leaves[i].lean + q.bank + q.rock };
  };
  // A critically damped spring towards `target`, as in mosaicPhysics.
  const spring = (x: number, v: number, target: number, w: number) => v + (w * w * (target - x) - 2 * w * v) * dt;
  // How high a point appears on screen (camera at z=10): what "above the spot" means across depths.
  const screenY = (y: number, z: number) => (y * 10) / (10 - z);

  // Where a wrapped leaf comes back in: of a handful of spots across the width, the one furthest
  // from every other leaf near the top. Dropping it back at its old x would often land it inside
  // another leaf, and the push to separate them would then happen where it can be seen.
  const reenterX = (i: number, y: number) => {
    let best = 0, bestGap = -Infinity;
    for (let c = 0; c < 9; c++) {
      const x = -P.boundX + (2 * P.boundX * c) / 8;
      let gap = Infinity;
      for (let j = 0; j < n; j++) if (j !== i) gap = Math.min(gap, Math.hypot(x - s[j].x, y - s[j].y) - rad[i] - rad[j]);
      if (gap > bestGap) { bestGap = gap; best = x; }
    }
    return best;
  };
  const out: LeafPose[][] = leaves.map(() => []);

  const step = (t: number) => {
    for (let i = 0; i < n; i++) {
      const l = leaves[i], q = s[i];
      if (q.mode === 'landed') continue;
      if (q.mode === 'falling' && l.land && t >= l.land.at && ((Math.abs(q.y) < P.onScreenY
        && screenY(q.y, q.z) > screenY(l.land.y, l.land.z)) || t >= l.land.at + P.landLate)) {
        q.mode = 'settling';
        Object.assign(q, fallingRot(i), { rxv: 0, ryv: q.spinVel, rzv: 0 });
        // Flat means face or back to the camera: the nearest half turn about the vertical.
        q.ryTarget = Math.round(q.ry / Math.PI) * Math.PI;
      }
      if (q.mode === 'settling') {
        const L = l.land!;
        q.vx = spring(q.x, q.vx, L.x, P.landOmega); q.vy = spring(q.y, q.vy, L.y, P.landOmega); q.vz = spring(q.z, q.vz, L.z, P.landOmega);
        q.rxv = spring(q.rx, q.rxv, 0, P.landRotOmega); q.ryv = spring(q.ry, q.ryv, q.ryTarget, P.landRotOmega); q.rzv = spring(q.rz, q.rzv, 0, P.landRotOmega);
        q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
        q.rx += q.rxv * dt; q.ry += q.ryv * dt; q.rz += q.rzv * dt;
        q.settled += dt;
        if (Math.hypot(q.x - L.x, q.y - L.y, q.z - L.z) < 0.002 && Math.hypot(q.vx, q.vy, q.vz) < 0.01) {
          Object.assign(q, { mode: 'landed', x: L.x, y: L.y, z: L.z, rx: 0, ry: q.ryTarget, rz: 0 });
        }
        continue;
      }
      q.phase += l.swingRate * dt;
      const c = Math.cos(q.phase);
      // The velocity the air "wants": a pendulum sway, dropping fastest through the bottom of the arc,
      // plus a pull back inside the walls. The leaf relaxes towards it at a rate set by its weight,
      // which is what lets a collision knock it off course and then fade out.
      let tx = l.swingAmp * l.swingRate * c;
      const ty = -P.fallSpeed * l.weight * (0.75 + 0.5 * Math.abs(c));
      let tz = 0.06 * Math.sin(q.phase * 0.5 + i);
      if (Math.abs(q.x) > P.boundX) tx -= Math.sign(q.x) * (Math.abs(q.x) - P.boundX) * 3;
      if (Math.abs(q.z) > P.boundZ) tz -= Math.sign(q.z) * (Math.abs(q.z) - P.boundZ) * 3;
      const k = Math.min(1, dt * P.airRate / l.weight);
      q.vx += (tx - q.vx) * k; q.vy += (ty - q.vy) * k; q.vz += (tz - q.vz) * k;
      q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;

      q.spinVel += (l.spinRate - q.spinVel) * Math.min(1, dt * 0.8);
      q.spin += q.spinVel * dt;
      q.rockVel += (-12 * q.rock - 2.5 * q.rockVel) * dt; // a damped spring: a hit rocks it, then it settles
      q.rock += q.rockVel * dt;
      q.bank += (-Math.max(-0.8, Math.min(0.8, q.vx * 0.9)) - q.bank) * Math.min(1, dt * P.bankRate);

      if (q.y < P.top - P.span) {
        q.y += P.span + P.reentry;
        q.x = reenterX(i, q.y);
        q.vx = 0; q.vz = 0;
      }
    }
    // Contacts. Push overlapping pairs apart (split by inverse mass, so the heavy one moves less), then
    // take the approach speed out of both with an impulse, and spend some of it on rocking and turning.
    // Only leaves still falling collide: one gliding to its spot, or already on it, is out of the air.
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const a = s[i], b = s[j];
      if (a.mode !== 'falling' || b.mode !== 'falling') continue;
      const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
      const d = Math.hypot(dx, dy, dz), r = rad[i] + rad[j];
      if (d >= r || d < 1e-6) continue;
      const nx = dx / d, ny = dy / d, nz = dz / d;
      const ia = 1 / mass[i], ib = 1 / mass[j], sum = ia + ib, push = (r - d) * P.pushRate / sum;
      a.x += nx * push * ia; a.y += ny * push * ia; a.z += nz * push * ia;
      b.x -= nx * push * ib; b.y -= ny * push * ib; b.z -= nz * push * ib;
      const vr = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny + (a.vz - b.vz) * nz;
      if (vr >= 0) continue; // already separating
      const J = -(1 + P.bounce) * vr / sum;
      a.vx += nx * J * ia; a.vy += ny * J * ia; a.vz += nz * J * ia;
      b.vx -= nx * J * ib; b.vy -= ny * J * ib; b.vz -= nz * J * ib;
      a.rockVel += P.rockKick * J * ia * nx; b.rockVel -= P.rockKick * J * ib * nx;
      a.spinVel += P.spinKick * J * ia * nz; b.spinVel -= P.spinKick * J * ib * nz;
    }
  };

  for (let f = -Math.round(P.warmupSeconds * fps); f < frames; f++) {
    for (let k = 0; k < P.substeps; k++) step((f + k / P.substeps) / fps);
    if (f < 0) continue;
    for (let i = 0; i < n; i++) {
      const q = s[i], l = leaves[i];
      if (q.mode !== 'falling') {
        out[i].push({ x: q.x, y: q.y, z: q.z, rx: q.rx, ry: q.ry, rz: q.rz, phase: q.phase, mode: q.mode, landing: q.mode === 'landed' ? 1 : 1 - Math.exp(-q.settled * 5) });
        continue;
      }
      out[i].push({
        mode: q.mode, landing: 0,
        x: q.x, y: q.y, z: q.z,
        // Tipped back towards the camera (falling flat, a leaf would be edge-on from here) and nodding
        // with the swing; banked by its ACTUAL sideways speed (eased, see bankRate), so a shove shows up
        // as a tilt; plus the rock.
        rx: -0.45 + 0.45 * Math.cos(q.phase),
        ry: q.spin,
        rz: l.lean + q.bank + q.rock,
        phase: q.phase,
      });
    }
  }
  return out;
};
