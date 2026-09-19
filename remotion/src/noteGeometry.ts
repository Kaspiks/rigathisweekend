// The 3D music notes for BaroqueStory, as plain three.js (no React), so the shapes can also be
// measured outside the render, e.g. to check their collision sizes.
import * as THREE from 'three';

// Every part is an extruded 2D shape with a bevel, which is what rounds the edges and makes a flat
// glyph read as a solid object once it turns. Geometry is built once and shared by every note.
const EXTRUDE = { depth: 0.05, bevelEnabled: true, bevelThickness: 0.035, bevelSize: 0.028, bevelSegments: 4, curveSegments: 40 };
const extrude = (shape: THREE.Shape, opts = EXTRUDE) => {
  const g = new THREE.ExtrudeGeometry(shape, opts);
  g.translate(0, 0, -opts.depth / 2); // centre it front to back
  return g;
};

// Noteheads are ellipses tilted up to the right, as engraved. Half and whole notes are hollow.
const head = (rx: number, ry: number, hole: [number, number] | null) => {
  const s = new THREE.Shape();
  s.absellipse(0, 0, rx, ry, 0, Math.PI * 2, false, 0.38);
  if (hole) {
    const h = new THREE.Path();
    h.absellipse(0, 0, hole[0], hole[1], 0, Math.PI * 2, true, 0.9);
    s.holes.push(h);
  }
  return extrude(s);
};
// A flag hangs off the top of the stem and sweeps down to the right.
const flag = () => {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.bezierCurveTo(0.02, -0.15, 0.27, -0.2, 0.2, -0.48);
  s.bezierCurveTo(0.18, -0.31, 0.07, -0.26, 0, -0.25);
  s.lineTo(0, 0);
  return extrude(s, { ...EXTRUDE, depth: 0.02, bevelThickness: 0.02, bevelSize: 0.012 });
};

let GEO: ReturnType<typeof buildGeometry> | null = null;
export const buildGeometry = () => ({
  filled: head(0.16, 0.112, null),
  half: head(0.16, 0.112, [0.1, 0.045]),
  whole: head(0.2, 0.13, [0.085, 0.07]),
  stem: new THREE.BoxGeometry(0.032, 0.8, 0.045),
  flag: flag(),
  beam: new THREE.BoxGeometry(0.5, 0.075, 0.05),
});
export const geo = () => (GEO ??= buildGeometry());

export type NoteKind = 'whole' | 'half' | 'quarter' | 'eighth' | 'sixteenth' | 'beamed';
const STEM_X = 0.145, STEM_TOP = 0.86;

// Each kind as a list of parts, laid out with the notehead at the origin and then shifted (`offset`)
// so the middle of the note sits at the origin: the collision sphere is centred there. The same list
// draws the note and measures it, so its collision size cannot drift from what is on screen.
type Part = { g: keyof ReturnType<typeof buildGeometry>; pos: [number, number, number]; rotZ?: number };
const stem = (x: number, y0: number): Part => ({ g: 'stem', pos: [x, y0 + 0.4, 0] });
const RISE = 0.1; // the beamed pair's second note sits a step higher
export const PARTS: Record<NoteKind, { offset: [number, number]; parts: Part[] }> = {
  whole: { offset: [0, 0], parts: [{ g: 'whole', pos: [0, 0, 0] }] },
  half: { offset: [-0.08, -0.42], parts: [{ g: 'half', pos: [0, 0, 0] }, stem(STEM_X, 0.04)] },
  quarter: { offset: [-0.08, -0.42], parts: [{ g: 'filled', pos: [0, 0, 0] }, stem(STEM_X, 0.04)] },
  eighth: { offset: [-0.1, -0.36], parts: [{ g: 'filled', pos: [0, 0, 0] }, stem(STEM_X, 0.04), { g: 'flag', pos: [STEM_X, STEM_TOP, 0] }] },
  sixteenth: { offset: [-0.1, -0.36], parts: [{ g: 'filled', pos: [0, 0, 0] }, stem(STEM_X, 0.04), { g: 'flag', pos: [STEM_X, STEM_TOP, 0] }, { g: 'flag', pos: [STEM_X, STEM_TOP - 0.17, 0] }] },
  beamed: { offset: [-0.07, -0.47], parts: [
    { g: 'filled', pos: [-0.22, 0, 0] }, { g: 'filled', pos: [0.22, RISE, 0] },
    stem(-0.22 + STEM_X, 0.04), stem(0.22 + STEM_X, RISE + 0.04),
    { g: 'beam', pos: [STEM_X, 0.84 + RISE / 2, 0], rotZ: Math.atan2(RISE, 0.44) },
  ] },
};

// The radius of a sphere around the origin that holds every vertex of the note, at scale 1.
// Measured from the actual geometry (each part's own bounding sphere, moved to where it sits), so
// two notes whose spheres do not overlap cannot be cutting into each other.
export const noteRadius = (kind: NoteKind) => {
  const g = geo(), { offset, parts } = PARTS[kind];
  let r = 0;
  for (const p of parts) {
    const geom = g[p.g];
    geom.computeBoundingSphere();
    const bs = geom.boundingSphere!;
    const c = bs.center.clone().applyAxisAngle(new THREE.Vector3(0, 0, 1), p.rotZ ?? 0);
    r = Math.max(r, Math.hypot(c.x + p.pos[0] + offset[0], c.y + p.pos[1] + offset[1], c.z + p.pos[2]) + bs.radius);
  }
  return r;
};

