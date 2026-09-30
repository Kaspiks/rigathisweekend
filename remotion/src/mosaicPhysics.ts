// The mosaic story's motion, simulated once and looked up by frame (the same reason as leafPhysics:
// Remotion renders frames out of order, so the sim must be a pure function of its inputs).
//
// Each piece goes through three stages:
//   waiting  — above the screen until its turn
//   falling  — tumbling down in a thin layer in front of the mosaic, swaying, bumping other pieces
//   settling — a spring pulls it into its slot and turns it flat, front side out; when it gets there
//              it counts as landed and takes no further part in collisions
// Everything a piece does is expressed as "the value it wants" plus a spring or a relax towards it,
// so a collision can knock it off course and it finds its way back.

export type MosaicSpec = {
  slotX: number; slotY: number;
  startX: number;      // where it enters above the screen
  startTime: number;   // seconds (can be negative: already falling at frame 0)
  weight: number;      // heavier: falls faster, pushed less
  swingRate: number; swingAmp: number; spinRate: number; phase0: number;
  radius: number;      // collision sphere, scene units
};
export type MosaicPose = { x: number; y: number; z: number; rx: number; ry: number; rz: number; flap: number; phase: number; mode: 'waiting' | 'falling' | 'settling' | 'landed' };

export const MOSAIC_PHYS = {
  spawnY: 3.5,
  fallZ: 0.6,           // the falling layer, in front of the mosaic (at z=0) so they pass over it, never through
  fallSpeed: 1.7,       // units/s at weight 1
  airRate: 3,           // how fast the air settles a falling piece back into its sway, 1/s
  settleAbove: 0.9,     // start settling this far above the slot
  settleAfter: 3.2,     // ...or after this many seconds of falling, whichever comes first
  posOmega: 6.5,        // the slot spring: higher is snappier (critically damped, so no overshoot)
  rotOmega: 7.5,
  flipOmega: 4.5,       // the turn to face front is softer: it can be up to half a turn
  spawnJitter: 0.45,    // how far from above its slot a piece may enter
  flapOmega: 11, flapDamping: 0.28, // corners: under-damped, so they flutter when a piece lands
  bounce: 0.3, pushRate: 0.35,
  landedDist: 0.01,
  substeps: 4,
};

const TAU = Math.PI * 2;

export const simulateMosaic = (specs: MosaicSpec[], frames: number, fps: number, fromTime = 0): MosaicPose[][] => {
  const P = MOSAIC_PHYS, n = specs.length, dt = 1 / (fps * P.substeps);
  const s = specs.map((sp) => ({
    mode: 'waiting' as 'waiting' | 'falling' | 'settling' | 'landed',
    x: sp.startX, y: P.spawnY, z: P.fallZ, vx: 0, vy: -P.fallSpeed * sp.weight, vz: 0,
    rx: -0.3, ry: 0, rz: 0, rxv: 0, ryv: sp.spinRate, rzv: 0, ryTarget: 0,
    flap: 0.06, flapV: 0, phase: sp.phase0, fellFor: 0,
  }));
  const out: MosaicPose[][] = specs.map(() => []);
  // A critically damped spring towards `target`: fastest approach without overshoot.
  const spring = (x: number, v: number, target: number, w: number) => v + (w * w * (target - x) - 2 * w * v) * dt;

  const step = (t: number) => {
    for (let i = 0; i < n; i++) {
      const sp = specs[i], q = s[i];
      if (q.mode === 'waiting') {
        // Its turn has come, but it only enters where there is room: of a few spots above its slot,
        // the one furthest from every piece already in the air, and only if that spot is clear.
        // Entering on top of another piece would mean shoving them apart at once — a visible jolt.
        if (t < sp.startTime) continue;
        let bestX = sp.startX, bestGap = -Infinity;
        for (let c = 0; c < 7; c++) {
          const x = Math.max(-1.1, Math.min(1.1, sp.slotX + (c / 3 - 1) * P.spawnJitter));
          let gap = Infinity;
          for (let j = 0; j < n; j++) {
            const o = s[j];
            if (j === i || o.mode === 'waiting' || o.mode === 'landed') continue;
            gap = Math.min(gap, Math.hypot(x - o.x, P.spawnY - o.y, P.fallZ - o.z) - sp.radius - specs[j].radius);
          }
          if (gap > bestGap) { bestGap = gap; bestX = x; }
        }
        if (bestGap < 0.02) continue;
        q.mode = 'falling'; q.x = bestX;
      }
      if (q.mode === 'landed') continue;
      q.phase += sp.swingRate * dt;
      const c = Math.cos(q.phase);
      let flapTarget: number;
      if (q.mode === 'falling') {
        q.fellFor += dt;
        // Falling: relax towards a swaying descent (exercise 2's target/k), in the thin front layer.
        const k = Math.min(1, dt * P.airRate / sp.weight);
        q.vx += (sp.swingAmp * sp.swingRate * c - q.vx) * k;
        q.vy += (-P.fallSpeed * sp.weight - q.vy) * k;
        q.vz += ((P.fallZ - q.z) * 3 - q.vz) * k;
        // Tumbling: nod with the swing, bank with the sideways speed, spin about the vertical.
        q.rxv = spring(q.rx, q.rxv, -0.3 + 0.55 * Math.sin(q.phase), 5);
        q.rzv = spring(q.rz, q.rzv, -Math.max(-0.7, Math.min(0.7, q.vx * 0.9)), 5);
        q.ryv += (sp.spinRate - q.ryv) * Math.min(1, dt * 1.5);
        flapTarget = 0.05 + 0.04 * Math.sin(q.phase * 2); // the air catching the corners
        if (q.y <= sp.slotY + P.settleAbove || q.fellFor > P.settleAfter) {
          q.mode = 'settling';
          // Flat, front out: the nearest whole turn, so it never spins back the long way.
          q.ryTarget = Math.round(q.ry / TAU) * TAU;
        }
      } else {
        // Settling: springs pull position to the slot and every rotation to flat.
        q.vx = spring(q.x, q.vx, sp.slotX, P.posOmega);
        q.vy = spring(q.y, q.vy, sp.slotY, P.posOmega);
        q.vz = spring(q.z, q.vz, 0, P.posOmega);
        q.rxv = spring(q.rx, q.rxv, 0, P.rotOmega);
        q.ryv = spring(q.ry, q.ryv, q.ryTarget, P.flipOmega);
        q.rzv = spring(q.rz, q.rzv, 0, P.rotOmega);
        // Moving back towards the mosaic, the air presses the corners forward; once it stops, they
        // spring back flat, overshooting a little each way: the flutter on landing.
        flapTarget = Math.max(0, Math.min(0.14, -q.vz * 0.35));
      }
      q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
      q.rx += q.rxv * dt; q.ry += q.ryv * dt; q.rz += q.rzv * dt;
      q.flapV += (P.flapOmega * P.flapOmega * (flapTarget - q.flap) - 2 * P.flapDamping * P.flapOmega * q.flapV) * dt;
      q.flap += q.flapV * dt;
      if (q.mode === 'settling' && Math.hypot(q.x - sp.slotX, q.y - sp.slotY, q.z) < P.landedDist
        && Math.hypot(q.vx, q.vy, q.vz) < 0.02 && Math.abs(q.flap) < 0.002 && Math.abs(q.flapV) < 0.02) {
        q.mode = 'landed';
        Object.assign(q, { x: sp.slotX, y: sp.slotY, z: 0, rx: 0, ry: q.ryTarget, rz: 0, flap: 0 });
      }
    }
    // Contacts between pieces still in the air (exercise 5, in 3D). A settling piece is being steered
    // hard towards its slot, so it counts as much heavier: falling pieces bounce off it, not it off them.
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const a = s[i], b = s[j];
      if (a.mode === 'waiting' || b.mode === 'waiting' || a.mode === 'landed' || b.mode === 'landed') continue;
      // Two settling pieces are both heading into the grid, where neighbours sit edge to edge, closer
      // than two collision spheres allow. Colliding them would keep neighbours from ever arriving.
      if (a.mode === 'settling' && b.mode === 'settling') continue;
      const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z, d = Math.hypot(dx, dy, dz), r = specs[i].radius + specs[j].radius;
      if (d >= r || d < 1e-6) continue;
      const nx = dx / d, ny = dy / d, nz = dz / d;
      const ia = 1 / (specs[i].weight * (a.mode === 'settling' ? 6 : 1)), ib = 1 / (specs[j].weight * (b.mode === 'settling' ? 6 : 1));
      const push = (r - d) * P.pushRate / (ia + ib);
      a.x += nx * push * ia; a.y += ny * push * ia; a.z += nz * push * ia;
      b.x -= nx * push * ib; b.y -= ny * push * ib; b.z -= nz * push * ib;
      const vr = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny + (a.vz - b.vz) * nz;
      if (vr >= 0) continue;
      const J = -(1 + P.bounce) * vr / (ia + ib);
      a.vx += nx * J * ia; a.vy += ny * J * ia; a.vz += nz * J * ia;
      b.vx -= nx * J * ib; b.vy -= ny * J * ib; b.vz -= nz * J * ib;
      a.rzv += 4 * J * ia * nx; b.rzv -= 4 * J * ib * nx; // a knock sets it rocking
    }
  };

  const f0 = Math.round(fromTime * fps);
  for (let f = f0; f < frames; f++) {
    for (let k = 0; k < P.substeps; k++) step((f + k / P.substeps) / fps);
    if (f < 0) continue;
    for (let i = 0; i < n; i++) {
      const q = s[i];
      out[i].push({ x: q.x, y: q.y, z: q.z, rx: q.rx, ry: q.ry, rz: q.rz, flap: q.flap, phase: q.phase, mode: q.mode });
    }
  }
  return out;
};

// ---- layout -----------------------------------------------------------------------------------------
// The grid, which fabric goes where, and the order pieces arrive in. `fabricWeights` has one weight
// per fabric; each slot takes fabric (col + row * 2) % count, which with 8 fabrics in a 4x4 grid puts
// every fabric in twice and never the same one side by side or above/below.
export type MosaicLayout = { cols: number; rows: number; tile: number; gap: number; centerY: number; stagger: number; lead: number };
export const MOSAIC_LAYOUT: MosaicLayout = { cols: 4, rows: 4, tile: 0.6, gap: 0.035, centerY: -0.11, stagger: 0.13, lead: 1.2 };

export const mosaicSpecs = (fabricWeights: number[], L: MosaicLayout = MOSAIC_LAYOUT) => {
  const count = L.cols * L.rows, pitch = L.tile + L.gap;
  const rnd = (seed: number, k: number) => Math.abs(Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453) % 1;
  // Arrival order: a fixed shuffle, so the mosaic fills in scattered rather than row by row.
  const order = Array.from({ length: count }, (_, i) => i).sort((a, b) => rnd(a + 1, 40) - rnd(b + 1, 40));
  return Array.from({ length: count }, (_, i) => {
    const col = i % L.cols, row = Math.floor(i / L.cols), fabric = (col + row * 2) % fabricWeights.length;
    const slotX = (col - (L.cols - 1) / 2) * pitch, slotY = L.centerY - (row - (L.rows - 1) / 2) * pitch;
    const seed = i + 1;
    const spec: MosaicSpec = {
      slotX, slotY,
      startX: Math.max(-1.1, Math.min(1.1, slotX + (rnd(seed, 1) - 0.5) * 0.9)),
      startTime: order.indexOf(i) * L.stagger - L.lead,
      weight: fabricWeights[fabric] * (0.92 + rnd(seed, 2) * 0.16),
      swingRate: 2 + rnd(seed, 3) * 1.2,
      swingAmp: 0.12 + rnd(seed, 4) * 0.12,
      spinRate: (rnd(seed, 5) - 0.5) * 5,
      phase0: rnd(seed, 6) * Math.PI * 2,
      // Half the diagonal of the square, plus a little for the thickness and the lifted corners.
      radius: L.tile * 0.74,
    };
    return { fabric, spec, lean: (rnd(seed, 7) - 0.5) * 0.035 };
  });
};
