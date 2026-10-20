// Builds `story-book.glb`: the open storybook the 2D scene is printed on, and pops out of.
//
// The source art (painted-game-page.png) is a PHOTOGRAPH of an open book, so it already carries
// perspective, a cover border and a crease. Pasting that on a flat quad and then tilting the quad
// applies perspective twice, which is why it used to read as a squashed tray. So this tool undoes the
// photo's perspective first, and lets real geometry supply the depth instead:
//
//   1. flatten   - the three fitted cover edges plus the image's own left boundary give a quad; a
//                  projective map takes it back to a rectangle.
//   2. atlas     - page art on top, a strip of page-block striations underneath, in one texture.
//                  The crop starts past the photographed book's own crease, 12% in from the left,
//                  because this book's gutter is in the middle and two creases read as a mistake.
//   3. geometry  - cover boards, a page block, and a page surface that dips into the gutter.
//
// Run: node tools/book/make-book.mjs [src.png] [out.glb]
import sharp from 'sharp';
import { writeFileSync, statSync } from 'node:fs';

const SRC = process.argv[2] || '/tmp/foxassets/painted-game-page.png';
const OUT = process.argv[3] || '/tmp/foxassets/story-book.glb';

// ---------------------------------------------------------------- 1. flatten
// Lines fitted to the pink cover border in the source photo (tools/book/README.md records how).
const TOP = (x) => 0.011976 * x + 151.89, BOT = (x) => -0.0052 * x + 1360.2, RIGHT = (y) => 0.0936 * y + 2332.4;
const meet = (f, g) => { let x = 2400; for (let i = 0; i < 40; i++) x = g(f(x)); return [x, f(x)]; };
const FLAT_W = 2048, FLAT_H = 1170;

const { data: src, info: si } = await sharp(SRC).raw().toBuffer({ resolveWithObject: true });
const flat = (() => {
  const [x0, y0] = [0, TOP(0)], [x1, y1] = meet(TOP, RIGHT), [x2, y2] = meet(BOT, RIGHT), [x3, y3] = [0, BOT(0)];
  const dx1 = x1 - x2, dx2 = x3 - x2, sx = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2, dy2 = y3 - y2, sy = y0 - y1 + y2 - y3;
  const den = dx1 * dy2 - dx2 * dy1;
  const g = (sx * dy2 - dx2 * sy) / den, h = (dx1 * sy - sx * dy1) / den;
  const a = x1 - x0 + g * x1, b = x3 - x0 + h * x3, c = x0;
  const d = y1 - y0 + g * y1, e = y3 - y0 + h * y3, f = y0;
  const { width: W, height: H, channels: C } = si;
  const out = Buffer.alloc(FLAT_W * FLAT_H * 4);
  for (let v = 0; v < FLAT_H; v++) for (let u = 0; u < FLAT_W; u++) {
    const uu = u / (FLAT_W - 1), vv = v / (FLAT_H - 1), w = g * uu + h * vv + 1;
    const fx = Math.min(W - 1.001, Math.max(0, (a * uu + b * vv + c) / w));
    const fy = Math.min(H - 1.001, Math.max(0, (d * uu + e * vv + f) / w));
    const ix = fx | 0, iy = fy | 0, tx = fx - ix, ty = fy - iy, o = (v * FLAT_W + u) * 4;
    for (let k = 0; k < 4; k++) {
      const p = (yy, xx) => src[(yy * W + xx) * C + k];
      out[o + k] = Math.round(p(iy, ix) * (1 - tx) * (1 - ty) + p(iy, ix + 1) * tx * (1 - ty)
        + p(iy + 1, ix) * (1 - tx) * ty + p(iy + 1, ix + 1) * tx * ty);
    }
  }
  return out;
})();

// ---------------------------------------------------------------- 2. atlas
// The illustration, without the cover border the photo included (measured from the flattened image).
const ART = { left: 320, top: 5, width: 1720, height: 1150 };
const ART_W = 2048, ART_H = Math.round(ART_W * ART.height / ART.width);   // 1369
const EDGE_H = 128, ATLAS_H = ART_H + EDGE_H;
const page = await sharp(Buffer.from(flat), { raw: { width: FLAT_W, height: FLAT_H, channels: 4 } })
  .extract(ART).resize(ART_W, ART_H).removeAlpha().toBuffer();

// The gutter and the paper grain, applied arithmetically rather than through blend modes. The page
// material is unlit - it is printed artwork, not a surface - so the fold modelled in the geometry casts
// no shading of its own and the texture has to carry the whole cue. What reads as a fold is a narrow
// dark valley with the pages lifting into the light on either side of it, and that needs a profile that
// both darkens and brightens. Compositing it by hand keeps the result exactly this profile: measured
// against a build with the gutter off, sharp's multiply/screen put the darkest point 20px off-centre
// and left a pair of bands down the page instead of one crease.
let seed = 7;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
for (let x = 0; x < ART_W; x++) {
  const t = (x - (ART_W - 1) / 2) / (ART_W * 0.020);
  const valley = Math.exp(-t * t);
  const lift = Math.exp(-((Math.abs(t) - 2.2) ** 2) / 1.8) * (1 - valley);
  const fold = (1 - 0.17 * valley) * (1 + 0.055 * lift);
  for (let y = 0; y < ART_H; y++) {
    const i = (y * ART_W + x) * 3;
    const tooth = (rnd() - 0.5) * 13;
    for (let k = 0; k < 3; k++) page[i + k] = Math.max(0, Math.min(255, Math.round(page[i + k] * fold + tooth)));
  }
}

// The page block: fine striations, one faint line per sheet, with the top edge catching the light.
const edge = Buffer.alloc(ART_W * EDGE_H * 4);
for (let y = 0; y < EDGE_H; y++) {
  const t = y / (EDGE_H - 1);                                   // 0 bottom of the block, 1 the top sheet
  const line = 0.5 + 0.5 * Math.cos(t * Math.PI * 2 * 26);
  const shade = 0.80 + 0.20 * t - 0.10 * line;
  for (let x = 0; x < ART_W; x++) {
    const n = (rnd() - 0.5) * 0.05, k = Math.max(0, Math.min(1, shade + n));
    const i = ((EDGE_H - 1 - y) * ART_W + x) * 4;
    edge[i] = Math.round(247 * k); edge[i + 1] = Math.round(240 * k); edge[i + 2] = Math.round(216 * k); edge[i + 3] = 255;
  }
}
const artLayer = await sharp(page, { raw: { width: ART_W, height: ART_H, channels: 3 } }).png().toBuffer();
const atlas = await sharp({ create: { width: ART_W, height: ATLAS_H, channels: 3, background: '#f7f1df' } })
  .composite([
    { input: artLayer, top: 0, left: 0 },
    { input: edge, raw: { width: ART_W, height: EDGE_H, channels: 4 }, top: ART_H, left: 0 },
  ]).png({ compressionLevel: 9 }).toBuffer();
console.log(`atlas: ${ART_W}x${ATLAS_H} (art ${ART_W}x${ART_H}, block edge ${EDGE_H}px)  ${(atlas.length / 1e6).toFixed(2)}MB`);

// ---------------------------------------------------------------- 3. geometry
const PW = 2.0, PD = +(PW * ART.height / ART.width).toFixed(4);   // page, matching the art's aspect
const OVER = 0.052, COVER_Y = 0.034, BLOCK_Y = 0.035, PAGE_Y = 0.132;
const DIP = 0.024, SIG = 0.14;                                    // how deep the gutter folds, and how wide
const CW = PW + OVER * 2, CD = PD + OVER * 2;
const NX = 96, NZ = 8;
const VART = ART_H / ATLAS_H, V0 = (ART_H + 3) / ATLAS_H, V1 = (ATLAS_H - 0.5) / ATLAS_H;

// The page surface: flat except where it folds into the gutter, with a touch of curl at the outer edges.
const curl = (x) => 0.005 * (Math.abs(x) / (PW / 2)) ** 4;
const pageY = (x) => PAGE_Y - DIP * Math.exp(-((x / SIG) ** 2)) - curl(x);
const slope = (x) => DIP * (2 * x / SIG ** 2) * Math.exp(-((x / SIG) ** 2)) - 0.02 * Math.sign(x) * (Math.abs(x) / (PW / 2)) ** 3 / (PW / 2);

const pos = [], nrm = [], uv = [];
const idx = { art: [], edge: [], cover: [] };
const vert = (p, n, t) => { pos.push(...p); nrm.push(...n); uv.push(...t); return pos.length / 3 - 1; };
// A quad, wound so its face points along `n` (counter-clockwise seen from that side, as glTF wants).
const quad = (into, a, b, c, d) => into.push(a, b, c, a, c, d);

// Page top. Walking z outwards before x keeps the winding counter-clockwise seen from above.
const grid = [];
for (let i = 0; i <= NX; i++) {
  const x = -PW / 2 + (PW * i) / NX, m = slope(x), len = Math.hypot(m, 1);
  const row = [];
  for (let j = 0; j <= NZ; j++) {
    const z = -PD / 2 + (PD * j) / NZ;
    row.push(vert([x, pageY(x), z], [-m / len, 1 / len, 0], [i / NX, VART * (j / NZ)]));
  }
  grid.push(row);
}
for (let i = 0; i < NX; i++) for (let j = 0; j < NZ; j++) quad(idx.art, grid[i][j], grid[i][j + 1], grid[i + 1][j + 1], grid[i + 1][j]);

// The page block's four sides, rising from the cover to whatever height the page has there.
for (const [zSide, n] of [[PD / 2, [0, 0, 1]], [-PD / 2, [0, 0, -1]]]) {
  for (let i = 0; i < NX; i++) {
    const xa = -PW / 2 + (PW * i) / NX, xb = -PW / 2 + (PW * (i + 1)) / NX;
    const ua = i / NX, ub = (i + 1) / NX;
    const lo = (x, u) => vert([x, BLOCK_Y, zSide], n, [u, V0]), hi = (x, u) => vert([x, pageY(x), zSide], n, [u, V1]);
    if (zSide > 0) quad(idx.edge, lo(xa, ua), lo(xb, ub), hi(xb, ub), hi(xa, ua));
    else quad(idx.edge, lo(xb, ub), lo(xa, ua), hi(xa, ua), hi(xb, ub));
  }
}
for (const [xSide, n] of [[PW / 2, [1, 0, 0]], [-PW / 2, [-1, 0, 0]]]) {
  const y = pageY(xSide), za = -PD / 2, zb = PD / 2;
  const lo = (z, u) => vert([xSide, BLOCK_Y, z], n, [u, V0]), hi = (z, u) => vert([xSide, y, z], n, [u, V1]);
  if (xSide > 0) quad(idx.edge, lo(za, 0), hi(za, 0), hi(zb, 1), lo(zb, 1));
  else quad(idx.edge, lo(zb, 1), hi(zb, 1), hi(za, 0), lo(za, 0));
}

// The cover boards: a shallow slab the page block sits on, showing as a border all the way round.
const C0 = [-CW / 2, 0, -CD / 2], C1 = [CW / 2, COVER_Y, CD / 2];
const corner = (i, j, k) => [i ? C1[0] : C0[0], j ? C1[1] : C0[1], k ? C1[2] : C0[2]];
const face = (n, pts) => quad(idx.cover, ...pts.map((p) => vert(corner(...p), n, [0, V0])));
face([0, 1, 0], [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]]);        // top (the visible border)
face([0, -1, 0], [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]]);       // bottom
face([0, 0, 1], [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]]);        // front
face([0, 0, -1], [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]]);       // back
face([1, 0, 0], [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]]);        // right
face([-1, 0, 0], [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]]);       // left

// ---------------------------------------------------------------- glTF
const P = new Float32Array(pos), N = new Float32Array(nrm), U = new Float32Array(uv);
const all = [...idx.art, ...idx.edge, ...idx.cover];
const I = new Uint32Array(all);
const pad4 = (n) => (4 - (n % 4)) % 4;
const parts = [], views = [];
let off = 0;
const add = (buf, target) => {
  const b = Buffer.from(buf.buffer ?? buf);
  views.push({ buffer: 0, byteOffset: off, byteLength: b.length, ...(target ? { target } : {}) });
  const padded = Buffer.concat([b, Buffer.alloc(pad4(b.length))]);
  parts.push(padded); off += padded.length;
  return views.length - 1;
};
const vP = add(P, 34962), vN = add(N, 34962), vU = add(U, 34962), vI = add(I, 34963), vImg = add(atlas);
const bin = Buffer.concat(parts);
const axis = (k) => { let lo = Infinity, hi = -Infinity; for (let i = k; i < P.length; i += 3) { if (P[i] < lo) lo = P[i]; if (P[i] > hi) hi = P[i]; } return [lo, hi]; };
const [xl, xh] = axis(0), [yl, yh] = axis(1), [zl, zh] = axis(2);

const prim = (material, count, first) => ({ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3 + material, material });
const gltf = {
  asset: { version: '2.0', generator: 'riga-weekend story book' },
  extensionsUsed: ['KHR_materials_unlit'],
  scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: 'StoryBook' }],
  meshes: [{ name: 'StoryBook', primitives: [prim(0), prim(1), prim(2)] }],
  accessors: [
    { bufferView: vP, componentType: 5126, count: P.length / 3, type: 'VEC3', min: [xl, yl, zl], max: [xh, yh, zh] },
    { bufferView: vN, componentType: 5126, count: N.length / 3, type: 'VEC3' },
    { bufferView: vU, componentType: 5126, count: U.length / 2, type: 'VEC2' },
    { bufferView: vI, componentType: 5125, count: idx.art.length, type: 'SCALAR', byteOffset: 0 },
    { bufferView: vI, componentType: 5125, count: idx.edge.length, type: 'SCALAR', byteOffset: idx.art.length * 4 },
    { bufferView: vI, componentType: 5125, count: idx.cover.length, type: 'SCALAR', byteOffset: (idx.art.length + idx.edge.length) * 4 },
  ],
  bufferViews: views, buffers: [{ byteLength: bin.length }],
  images: [{ bufferView: vImg, mimeType: 'image/png' }],
  samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }],
  textures: [{ sampler: 0, source: 0 }],
  materials: [
    // The printed page is unlit: it is artwork, and shading it twice (here and in the 2D layer over it)
    // is what makes a pop-out book read as a photograph of a book.
    { name: 'PageArt', doubleSided: true, alphaMode: 'OPAQUE',
      pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 1 },
      extensions: { KHR_materials_unlit: {} } },
    { name: 'PageBlock', doubleSided: true,
      pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 0.92 } },
    { name: 'Cover', doubleSided: true,
      pbrMetallicRoughness: { baseColorFactor: [0.62, 0.17, 0.47, 1], metallicFactor: 0, roughnessFactor: 0.6 } },
  ],
};
const json = Buffer.from(JSON.stringify(gltf));
const jsonPad = Buffer.concat([json, Buffer.alloc(pad4(json.length), 0x20)]);
const binPad = Buffer.concat([bin, Buffer.alloc(pad4(bin.length))]);
const header = Buffer.alloc(12);
header.write('glTF', 0); header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + jsonPad.length + 8 + binPad.length, 8);
const chunk = (d, t) => { const h = Buffer.alloc(8); h.writeUInt32LE(d.length, 0); h.writeUInt32LE(t, 4); return Buffer.concat([h, d]); };
writeFileSync(OUT, Buffer.concat([header, chunk(jsonPad, 0x4E4F534A), chunk(binPad, 0x004E4942)]));
console.log(`${OUT}  ${(statSync(OUT).size / 1e6).toFixed(2)}MB  ${P.length / 3} verts  ${all.length / 3} tris`);
console.log(`bounds  x ${xl.toFixed(3)}..${xh.toFixed(3)}  y ${yl.toFixed(3)}..${yh.toFixed(3)}  z ${zl.toFixed(3)}..${zh.toFixed(3)}`);
console.log(`HEIGHT ${(yh - yl).toFixed(4)} -> on a 1920-tall frame, size s makes the book ${(CW / (yh - yl) * 1920).toFixed(0)} * s px wide`);
