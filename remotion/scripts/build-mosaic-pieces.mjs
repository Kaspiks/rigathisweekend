// Builds the textile mosaic pieces: public/mosaic-pieces/*.glb
//
//   node scripts/build-mosaic-pieces.mjs
//
// Each piece is a 1x1-unit square of cloth with real thickness: a curved front surface, a curved back
// surface and side walls, tapering thinner at the edges like a sewn patch. The fabric textures are
// procedural — generated here thread by thread, not photographed — with a matching normal map for the
// weave relief. The back texture is the same cloth seen from behind, so where the front shows the
// warp, the back shows the weft. Every piece has a 3x3 lattice of bones under a Root, skinned with
// smooth weights, so moving one control bone curls the cloth without a crease.
//
// No dependencies: the glTF is written by hand, and JPEG encoding goes through Remotion's ffmpeg.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'mosaic-pieces');

// ---- noise --------------------------------------------------------------------------------------
const hash = (x, y, s) => {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const smooth = (t) => t * t * (3 - 2 * t);
const vnoise = (x, y, s) => {
  const ix = Math.floor(x), iy = Math.floor(y), fx = smooth(x - ix), fy = smooth(y - iy);
  const a = hash(ix, iy, s), b = hash(ix + 1, iy, s), c = hash(ix, iy + 1, s), d = hash(ix + 1, iy + 1, s);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
};
const fbm = (x, y, s, oct = 4) => {
  let v = 0, amp = 0.5, f = 1;
  for (let o = 0; o < oct; o++) { v += amp * vnoise(x * f, y * f, s + o * 17); amp *= 0.5; f *= 2; }
  return v / (1 - Math.pow(0.5, oct));
};
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const hex = (h) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
const mod = (a, n) => ((a % n) + n) % n;

// ---- woven cloth --------------------------------------------------------------------------------
// Warp threads run vertically (one per column of cells), weft threads horizontally. `over(i, j)` says
// whether the warp is on top at crossing (i, j); the pattern of that answer is the weave (plain, twill,
// herringbone...). Colours come per thread, which is how tartan and houndstooth are made on a loom.
// Each visible thread is a rounded cross-section with yarn twist and fibre streaks; the gaps between
// threads are low and shaded. Returns an RGB albedo and a height field (0..1) for the normal map.
const weave = ({ size, period, over, warpColor, weftColor, width = 0.84, slub = 0.12, twist = 1, fuzz = 0.18, seed = 1, mottle = 0.08, fade = 0 }) => {
  const rgb = new Float32Array(size * size * 3), height = new Float32Array(size * size);
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    const u = px / period, v = py / period, i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j;
    // Slub: real yarn is thicker in places. Varies along each thread, differently for every thread.
    const hwWarp = (width / 2) * (1 + slub * (vnoise(i * 7.1, v * 0.35, seed) - 0.5) * 2);
    const hwWeft = (width / 2) * (1 + slub * (vnoise(u * 0.35, j * 7.3, seed + 5) - 0.5) * 2);
    const dWarp = Math.abs(fu - 0.5) / hwWarp, dWeft = Math.abs(fv - 0.5) / hwWeft;
    const pWarp = dWarp < 1 ? Math.sqrt(1 - dWarp * dWarp) : 0, pWeft = dWeft < 1 ? Math.sqrt(1 - dWeft * dWeft) : 0;
    const warpTop = over(i, j);
    let h = 0, col, isWarp;
    // The thread on top bulges over the crossing; the one underneath only shows in the gaps beside it.
    if (warpTop ? pWarp > 0 : pWeft > 0) {
      isWarp = warpTop;
      h = 0.35 + (warpTop ? pWarp : pWeft) * (0.4 + 0.25 * Math.sin(Math.PI * (warpTop ? fv : fu)));
    } else if (warpTop ? pWeft > 0 : pWarp > 0) {
      isWarp = !warpTop;
      h = (warpTop ? pWeft : pWarp) * 0.32;
    }
    if (isWarp === undefined) {
      // A gap: no thread at all, nearly black, with a hint of whatever is behind.
      col = weftColor(j).map((c) => c * 0.18);
    } else {
      col = isWarp ? warpColor(i) : weftColor(j);
      const along = isWarp ? py : px, across = (isWarp ? fu : fv) - 0.5;
      // Twist: plied yarn shows diagonal ridges running round it.
      const tw = 0.5 + 0.5 * Math.sin(2 * Math.PI * (along / (period * 0.42) + across * 1.6 * twist));
      // Fibres: fine streaks along the thread, not across it.
      const fib = isWarp ? vnoise(px * 0.9, py * 0.07, seed + 11) : vnoise(px * 0.07, py * 0.9, seed + 13);
      const thread = 0.93 + 0.14 * hash(isWarp ? i : j, isWarp ? 1 : 2, seed + 3); // each thread dyed slightly differently
      h += 0.07 * tw;
      const shade = thread * (1 - fuzz + fuzz * 2 * fib) * (0.9 + 0.1 * tw);
      col = col.map((c) => c * shade);
    }
    // Ambient occlusion from the relief, broad mottling across the cloth, and optional fading (denim).
    const ao = 0.42 + 0.58 * Math.pow(clamp01(h), 0.7);
    const mot = 1 + mottle * (fbm(px / 180, py / 180, seed + 21) - 0.5) * 2;
    const fd = fade * clamp01(fbm(px / 140, py / 140, seed + 31) * 1.6 - 0.45);
    const k = (py * size + px) * 3;
    for (let c = 0; c < 3; c++) rgb[k + c] = clamp01((col[c] * ao * mot) * (1 - fd) + fd * 0.82 * ao);
    height[py * size + px] = clamp01(h);
  }
  return { rgb, height, size };
};

// Knitted stockinette: columns of V-shaped stitches, each V two slanted loops of yarn. The purl side
// (the back) shows horizontal bumps instead.
const knit = ({ size, sw, sh, color, seed, purl = false }) => {
  const rgb = new Float32Array(size * size * 3), height = new Float32Array(size * size);
  const base = hex(color);
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    const cx = Math.floor(px / sw), cy = Math.floor(py / sh), fx = px / sw - cx, fy = py / sh - cy;
    let h = 0, along = 0;
    if (!purl) {
      for (const [ox, ang] of [[0.3, -0.52], [0.7, 0.52]]) {
        const dx = fx - ox, dy = fy - 0.5, ca = Math.cos(ang), sa = Math.sin(ang);
        const a = (dx * ca - dy * sa) / 0.2, b = (dx * sa + dy * ca) / 0.56;
        const d = a * a + b * b;
        if (d < 1 && Math.sqrt(1 - d) > h) { h = Math.sqrt(1 - d); along = b; }
      }
    } else {
      const off = (cx % 2) * 0.5;
      const dx = mod(fx + off, 1) - 0.5, dy = fy - 0.5, d = (dx / 0.46) ** 2 + (dy / 0.3) ** 2;
      if (d < 1) { h = Math.sqrt(1 - d); along = dx; }
    }
    const tw = 0.5 + 0.5 * Math.sin(2 * Math.PI * (along * 2.2 + (purl ? fy : fx) * 1.3));
    const fib = vnoise(px * 0.6, py * 0.6, seed + 7);
    const halo = 0.08 * fbm(px / 3, py / 3, seed + 9); // loose fibres standing off the yarn
    h = clamp01(h * (0.85 + 0.15 * tw) + halo);
    const stitch = 0.94 + 0.12 * hash(cx, cy, seed);
    const ao = 0.35 + 0.65 * Math.pow(h, 0.6);
    const mot = 1 + 0.06 * (fbm(px / 200, py / 200, seed + 3) - 0.5) * 2;
    const k = (py * size + px) * 3;
    for (let c = 0; c < 3; c++) rgb[k + c] = clamp01(base[c] * stitch * (0.82 + 0.3 * fib) * (0.9 + 0.1 * tw) * ao * mot);
    height[py * size + px] = h;
  }
  return { rgb, height, size };
};

// Crushed velvet: no visible weave, just pile. The pile lies in different directions in patches,
// which is what gives velvet its light-and-dark bruising.
const velvet = ({ size, color, seed }) => {
  const rgb = new Float32Array(size * size * 3), height = new Float32Array(size * size);
  const base = hex(color), sc = size / 1024;
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    const crush = fbm(px / (160 * sc), py / (160 * sc), seed, 5);
    const ridge = 1 - Math.abs(fbm(px / (90 * sc), py / (90 * sc), seed + 4, 4) * 2 - 1);
    const pile = vnoise(px * 1.3, py * 1.3, seed + 8);
    const lum = 0.55 + 0.75 * Math.pow(crush, 1.4) + 0.18 * ridge + 0.1 * (pile - 0.5);
    const k = (py * size + px) * 3;
    for (let c = 0; c < 3; c++) rgb[k + c] = clamp01(base[c] * lum);
    height[py * size + px] = clamp01(0.5 + 0.25 * ridge + 0.15 * crush + 0.06 * pile);
  }
  return { rgb, height, size };
};

// ---- the fabrics ----------------------------------------------------------------------------------
// Thread spacing (`period`, in texels of a 1024 texture) is set so a patch has roughly 80-110 threads
// across, as a real 10 cm swatch would: coarser and the weave reads as brickwork, not cloth.
// Twill k/m: the warp goes over k weft threads then under m, shifting by one each row: diagonal lines.
const twill = (k, m) => (i, j) => mod(i - j, k + m) < k;
const plain = (i, j) => (i + j) % 2 === 0;
// A colour sequence repeated across the threads (a "sett" in tartan weaving).
const sett = (seq) => { const list = seq.flatMap(([c, n]) => Array(n).fill(hex(c))); return (i) => list[mod(i, list.length)]; };

// Auseklis, the eight-pointed morning star of Latvian weaving, as a mask over thread cells: two
// squares (one turned 45°) outlined, with a small star at the heart, between zigzag borders.
const ausekis = (cells) => {
  const c = cells / 2, R = cells * 0.3;
  const star = (x, y, r) => Math.abs(x) + Math.abs(y) <= r * 1.25 || Math.max(Math.abs(x), Math.abs(y)) <= r * 0.88;
  return (i, j) => {
    const x = i - c + 0.5, y = j - c + 0.5;
    if (star(x, y, R) && !star(x, y, R * 0.7)) return true;
    if (star(x, y, R * 0.28)) return true;
    const band = (row) => { const t = mod(i, 8); const z = t < 4 ? t : 8 - t; return j === row + z; };
    return band(3) || band(4) || band(cells - 9) || band(cells - 8);
  };
};

const FABRICS = [
  {
    name: 'rust_herringbone_wool', roughness: 0.92, sheen: [0.42, 0.3, 0.24],
    // Herringbone: a 2/2 twill that reverses direction every ten threads.
    tex: (size, back) => {
      const p = 13 * size / 1024, hb = (i, j) => { const d = Math.floor(i / 10) % 2 ? 1 : -1; return mod(d * i - j, 4) < 2; };
      return weave({ size, period: p, over: back ? (i, j) => !hb(i, j) : hb, warpColor: () => hex('#8e3b1b'), weftColor: () => hex('#b0582a'), seed: 3, fuzz: 0.24 });
    },
  },
  {
    name: 'indigo_denim_twill', roughness: 0.88, sheen: [0.25, 0.3, 0.4],
    // 3/1 warp-faced twill: indigo warp on the front, the undyed weft shows through on the back.
    tex: (size, back) => weave({ size, period: 9 * size / 1024, over: back ? (i, j) => !twill(3, 1)(i, j) : twill(3, 1), warpColor: () => hex('#22395e'), weftColor: () => hex('#ddd3bf'), seed: 5, fuzz: 0.2, fade: back ? 0 : 0.35, width: 0.9 }),
  },
  {
    name: 'mustard_knit', roughness: 0.95, sheen: [0.45, 0.38, 0.2],
    tex: (size, back) => knit({ size, sw: 34 * size / 1024, sh: 30 * size / 1024, color: '#c9942c', seed: 7, purl: back }),
  },
  {
    name: 'oatmeal_linen', roughness: 0.9, sheen: [0.4, 0.38, 0.33],
    // Linen: plain weave with heavy slubs and uneven colour, the flax never quite even.
    tex: (size, back) => weave({ size, period: 11 * size / 1024, over: back ? (i, j) => !plain(i, j) : plain, warpColor: (i) => hex('#cdb99a').map((c) => c * (0.9 + 0.12 * hash(i, 9, 2))), weftColor: (j) => hex('#c4ae8c').map((c) => c * (0.88 + 0.15 * hash(j, 8, 2))), seed: 9, slub: 0.35, fuzz: 0.26, mottle: 0.12 }),
  },
  {
    name: 'forest_tartan', roughness: 0.9, sheen: [0.3, 0.32, 0.3],
    tex: (size, back) => {
      const s = sett([['#24452f', 8], ['#1e2645', 4], ['#24452f', 2], ['#141414', 2], ['#9a2c20', 2], ['#141414', 2], ['#24452f', 2], ['#1e2645', 4]]);
      return weave({ size, period: 11 * size / 1024, over: back ? (i, j) => !twill(2, 2)(i, j) : twill(2, 2), warpColor: s, weftColor: s, seed: 11, fuzz: 0.2 });
    },
  },
  {
    name: 'burgundy_crushed_velvet', roughness: 0.62, sheen: [0.85, 0.45, 0.5], sheenRoughness: 0.35,
    // The back of velvet is its ground cloth: a plain weave in the same dye, no pile.
    tex: (size, back) => back
      ? weave({ size, period: 14 * size / 512, over: plain, warpColor: () => hex('#5a1620'), weftColor: () => hex('#4e131c'), seed: 13, fuzz: 0.15 })
      : velvet({ size, color: '#6e1b27', seed: 13 }),
  },
  {
    name: 'latvian_auseklis_weave', roughness: 0.9, sheen: [0.45, 0.35, 0.3],
    // The star is woven, not printed: inside the motif the red weft floats on top, elsewhere the
    // cream warp does. So the back shows the same star in reverse colours.
    tex: (size, back) => {
      const cells = 40, p = size / cells, motif = ausekis(cells);
      const over = (i, j) => (motif(i, j) ? mod(i - j, 4) === 0 : mod(i - j, 4) !== 0) !== back;
      return weave({ size, period: p, over, warpColor: () => hex('#e9ddc4'), weftColor: () => hex('#a3221b'), seed: 17, fuzz: 0.2 });
    },
  },
  {
    name: 'brown_houndstooth', roughness: 0.92, sheen: [0.35, 0.3, 0.25],
    // Houndstooth: a 2/2 twill with four dark and four light threads both ways.
    tex: (size, back) => {
      const s = sett([['#2d1e16', 4], ['#dac9a8', 4]]);
      return weave({ size, period: 11 * size / 1024, over: back ? (i, j) => !twill(2, 2)(i, j) : twill(2, 2), warpColor: s, weftColor: s, seed: 19, fuzz: 0.2 });
    },
  },
];

// ---- textures to JPEG -----------------------------------------------------------------------------
const toBytes = (rgb) => { const b = Buffer.alloc(rgb.length); for (let k = 0; k < rgb.length; k++) b[k] = Math.round(rgb[k] * 255); return b; };
// Tangent-space normal map from the height field (glTF convention: +X right, +Y up the image).
const normalMap = ({ height, size }, strength) => {
  const b = Buffer.alloc(size * size * 3), H = (x, y) => height[mod(y, size) * size + mod(x, size)];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (H(x + 1, y) - H(x - 1, y)) * strength, dy = (H(x, y - 1) - H(x, y + 1)) * strength;
    const l = Math.hypot(dx, dy, 1), k = (y * size + x) * 3;
    b[k] = Math.round((-dx / l * 0.5 + 0.5) * 255);
    b[k + 1] = Math.round((-dy / l * 0.5 + 0.5) * 255);
    b[k + 2] = Math.round((1 / l * 0.5 + 0.5) * 255);
  }
  return b;
};
// Remotion's ffmpeg has no raw-pixel input, but it reads PNG. A minimal PNG (8-bit RGB, no filtering)
// is a signature and three chunks, each with a CRC.
const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4), crc = Buffer.alloc(4), td = Buffer.concat([Buffer.from(type), data]);
  len.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
const png = (raw, size) => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  const rows = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) raw.copy(rows, y * (size * 3 + 1) + 1, y * size * 3, (y + 1) * size * 3);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
};
// Through files, not pipes: this ffmpeg build only reads images from disk.
const TMP = mkdtempSync(join(tmpdir(), 'mosaic-'));
const jpeg = (raw, size, q = 3) => {
  const src = join(TMP, 'in.png'), dst = join(TMP, 'out.jpg');
  writeFileSync(src, png(raw, size));
  const r = spawnSync('npx', ['remotion', 'ffmpeg', '-loglevel', 'error', '-y', '-i', src, '-q:v', String(q), dst], { cwd: ROOT });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr}`);
  return readFileSync(dst);
};

// ---- geometry -------------------------------------------------------------------------------------
const N = 32;              // grid segments per side: 33x33 vertices on each face
const THICK = 0.034;       // at the middle; the edges taper to 55% of this, like a sewn patch

// The piece's shape: a cushion (puffed in the middle), a gentle bend along a random direction and a
// small irregular warp. Returns the mid-surface height and the thickness at (x, y).
const shapeFor = (seed) => {
  const cushion = 0.018 + 0.012 * hash(1, 1, seed), bend = (hash(2, 2, seed) - 0.5) * 0.06, ang = hash(3, 3, seed) * Math.PI;
  return (x, y) => {
    const s = x * Math.cos(ang) + y * Math.sin(ang);
    const mid = cushion * (1 - 4 * x * x) * (1 - 4 * y * y) + bend * 4 * s * s + 0.008 * (fbm(x * 2 + 5, y * 2 + 5, seed, 3) - 0.5);
    const edge = 0.5 - Math.max(Math.abs(x), Math.abs(y));
    return { mid, thick: THICK * (0.55 + 0.45 * smooth(clamp01(edge / 0.06))) };
  };
};

// The skeleton: Root at the centre, and under it a 3x3 lattice of control bones at the corners, the
// edge midpoints and the centre. Each vertex follows the four lattice bones around it, blended with a
// smoothstep, so the weights are smooth across every lattice line (no crease when one bone moves).
const LATTICE = [-0.5, 0, 0.5];
const BONES = [
  ['Root', [0, 0, 0]],
  ['Corner_TL', [-0.5, 0.5, 0]], ['Edge_T', [0, 0.5, 0]], ['Corner_TR', [0.5, 0.5, 0]],
  ['Edge_L', [-0.5, 0, 0]], ['Center', [0, 0, 0]], ['Edge_R', [0.5, 0, 0]],
  ['Corner_BL', [-0.5, -0.5, 0]], ['Edge_B', [0, -0.5, 0]], ['Corner_BR', [0.5, -0.5, 0]],
];
const axisWeights = (t) => {
  const seg = t < 0 ? 0 : 1, f = smooth(clamp01((t - LATTICE[seg]) / 0.5));
  return [[seg, 1 - f], [seg + 1, f]];
};
const skinWeights = (x, y) => {
  const out = [];
  for (const [cx, wx] of axisWeights(x)) for (const [ry, wy] of axisWeights(-y)) {
    const w = wx * wy;
    if (w > 1e-5) out.push([1 + ry * 3 + cx, w]);
  }
  while (out.length < 4) out.push([0, 0]);
  const sum = out.reduce((a, [, w]) => a + w, 0);
  return out.map(([j, w]) => [j, w / sum]);
};

const buildPiece = (seed) => {
  const shape = shapeFor(seed);
  const at = (i, j) => { const x = -0.5 + i / N, y = 0.5 - j / N; return { x, y, ...shape(x, y) }; };
  const prims = { front: { pos: [], nor: [], uv: [], jnt: [], wgt: [], idx: [] }, back: { pos: [], nor: [], uv: [], jnt: [], wgt: [], idx: [] }, sides: { pos: [], nor: [], uv: [], jnt: [], wgt: [], idx: [] } };
  const pushV = (p, pos, nor, uv) => {
    p.pos.push(...pos); p.nor.push(...nor); p.uv.push(...uv);
    const sw = skinWeights(pos[0], pos[1]);
    p.jnt.push(...sw.map(([j]) => j)); p.wgt.push(...sw.map(([, w]) => w));
  };
  const surf = (side) => (i, j) => { const q = at(i, j); return [q.x, q.y, q.mid + side * q.thick / 2]; };
  // Normals from central differences of the actual surface, so the curvature is lit correctly.
  const normal = (P, i, j, side) => {
    const a = P(Math.min(N, i + 1), j), b = P(Math.max(0, i - 1), j), c = P(i, Math.min(N, j + 1)), d = P(i, Math.max(0, j - 1));
    const tx = [a[0] - b[0], a[1] - b[1], a[2] - b[2]], ty = [c[0] - d[0], c[1] - d[1], c[2] - d[2]];
    const n = [ty[1] * tx[2] - ty[2] * tx[1], ty[2] * tx[0] - ty[0] * tx[2], ty[0] * tx[1] - ty[1] * tx[0]];
    const l = Math.hypot(...n) * side;
    return n.map((v) => v / l);
  };
  for (const [key, side] of [['front', 1], ['back', -1]]) {
    const p = prims[key], P = surf(side);
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) pushV(p, P(i, j), normal(P, i, j, side), [i / N, j / N]);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = j * (N + 1) + i, r = k + 1, d = k + N + 1, dr = d + 1;
      // Counter-clockwise seen from outside: from +z for the front, from -z for the back.
      if (side > 0) p.idx.push(k, d, r, r, d, dr); else p.idx.push(k, r, d, r, dr, d);
    }
  }
  // Side walls, walked clockwise round the rim. Each edge gets its own vertices so the corners stay
  // sharp, with a normal facing straight out of that edge.
  const s = prims.sides;
  const edges = [
    { pts: (t) => [t, 0], n: [0, 1, 0] }, { pts: (t) => [N, t], n: [1, 0, 0] },
    { pts: (t) => [N - t, N], n: [0, -1, 0] }, { pts: (t) => [0, N - t], n: [-1, 0, 0] },
  ];
  edges.forEach(({ pts, n }, e) => {
    const base = s.pos.length / 3;
    for (let t = 0; t <= N; t++) {
      const [i, j] = pts(t), q = at(i, j), u = (e + t / N) / 4;
      pushV(s, [q.x, q.y, q.mid + q.thick / 2], n, [u, 0]);
      pushV(s, [q.x, q.y, q.mid - q.thick / 2], n, [u, 0.03]);
    }
    for (let t = 0; t < N; t++) { const a = base + t * 2, b = a + 2; s.idx.push(a, b, b + 1, a, b + 1, a + 1); }
  });
  return prims;
};

// ---- glTF writer ----------------------------------------------------------------------------------
const writeGlb = (file, prims, images, fabric) => {
  const chunks = [], bufferViews = [], accessors = [];
  let offset = 0;
  const addView = (buf, target) => {
    const pad = (4 - (offset % 4)) % 4;
    if (pad) { chunks.push(Buffer.alloc(pad)); offset += pad; }
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: buf.length, ...(target ? { target } : {}) });
    chunks.push(buf); offset += buf.length;
    return bufferViews.length - 1;
  };
  const addAccessor = (arr, type, componentType, target, minmax = false) => {
    const Typed = { 5126: Float32Array, 5123: Uint16Array, 5121: Uint8Array }[componentType];
    const typed = new Typed(arr), n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[type];
    const acc = { bufferView: addView(Buffer.from(typed.buffer), target), componentType, count: arr.length / n, type };
    if (minmax) {
      acc.min = Array.from({ length: n }, (_, c) => Math.min(...arr.filter((_, k) => k % n === c)));
      acc.max = Array.from({ length: n }, (_, c) => Math.max(...arr.filter((_, k) => k % n === c)));
    }
    accessors.push(acc);
    return accessors.length - 1;
  };
  const primitive = (p, material) => ({
    attributes: {
      POSITION: addAccessor(p.pos, 'VEC3', 5126, 34962, true), NORMAL: addAccessor(p.nor, 'VEC3', 5126, 34962),
      TEXCOORD_0: addAccessor(p.uv, 'VEC2', 5126, 34962), JOINTS_0: addAccessor(p.jnt, 'VEC4', 5121, 34962),
      WEIGHTS_0: addAccessor(p.wgt, 'VEC4', 5126, 34962),
    },
    indices: addAccessor(p.idx, 'SCALAR', 5123, 34963), material,
  });
  const meshPrims = [primitive(prims.front, 0), primitive(prims.back, 1), primitive(prims.sides, 1)];
  // Bones are unrotated, so each inverse bind matrix is just the inverse of its bone's translation.
  const ibm = BONES.flatMap(([, [x, y, z]]) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -x, -y, -z, 1]);
  const ibmAcc = addAccessor(ibm, 'MAT4', 5126);
  const imageIdx = images.map((img) => addView(img));
  const sheen = { KHR_materials_sheen: { sheenColorFactor: fabric.sheen, sheenRoughnessFactor: fabric.sheenRoughness ?? 0.55 } };
  const gltf = {
    asset: { version: '2.0', generator: 'riga-weekend build-mosaic-pieces.mjs' },
    extensionsUsed: ['KHR_materials_sheen'],
    scene: 0,
    scenes: [{ nodes: [0, 1] }],
    nodes: [
      { name: 'MosaicPiece', mesh: 0, skin: 0 },
      { name: 'Root', translation: [0, 0, 0], children: BONES.slice(1).map((_, k) => k + 2) },
      ...BONES.slice(1).map(([name, t]) => ({ name, translation: t })),
    ],
    meshes: [{ name: 'MosaicPiece', primitives: meshPrims }],
    skins: [{ name: 'MosaicSkeleton', joints: BONES.map((_, k) => k + 1), inverseBindMatrices: ibmAcc, skeleton: 1 }],
    materials: [
      { name: 'Front', pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: fabric.roughness }, normalTexture: { index: 1, scale: 1 }, extensions: sheen },
      { name: 'Back', pbrMetallicRoughness: { baseColorTexture: { index: 2 }, metallicFactor: 0, roughnessFactor: Math.min(1, fabric.roughness + 0.04) }, normalTexture: { index: 3, scale: 1 }, extensions: sheen },
    ],
    textures: imageIdx.map((_, k) => ({ source: k, sampler: 0 })),
    samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }],
    images: imageIdx.map((bufferView, k) => ({ name: ['front_color', 'front_normal', 'back_color', 'back_normal'][k], bufferView, mimeType: 'image/jpeg' })),
    accessors,
    bufferViews,
    buffers: [{ byteLength: 0 }],
  };
  const bin = Buffer.concat(chunks), binPad = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)]);
  gltf.buffers[0].byteLength = binPad.length;
  const json = Buffer.from(JSON.stringify(gltf)), jsonPad = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
  const header = Buffer.alloc(12), jh = Buffer.alloc(8), bh = Buffer.alloc(8);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + jsonPad.length + 8 + binPad.length, 8);
  jh.writeUInt32LE(jsonPad.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
  bh.writeUInt32LE(binPad.length, 0); bh.writeUInt32LE(0x004e4942, 4);
  writeFileSync(file, Buffer.concat([header, jh, jsonPad, bh, binPad]));
};

// ---- build ----------------------------------------------------------------------------------------
mkdirSync(OUT, { recursive: true });
const manifest = { format: 'glTF 2.0 GLB', size: '1x1 units, centred, front facing +z', bones: BONES.map(([n]) => n), pieces: {} };
FABRICS.forEach((fabric, k) => {
  const t0 = Date.now();
  const front = fabric.tex(1024, false), back = fabric.tex(512, true);
  const images = [jpeg(toBytes(front.rgb), 1024), jpeg(normalMap(front, 6), 1024, 2), jpeg(toBytes(back.rgb), 512), jpeg(normalMap(back, 4), 512, 2)];
  const prims = buildPiece(k + 1);
  const file = join(OUT, `${fabric.name}.glb`);
  writeGlb(file, prims, images, fabric);
  const verts = prims.front.pos.length / 3 + prims.back.pos.length / 3 + prims.sides.pos.length / 3;
  const tris = (prims.front.idx.length + prims.back.idx.length + prims.sides.idx.length) / 3;
  manifest.pieces[fabric.name] = { vertices: verts, triangles: tris, textures: { front: 1024, back: 512 } };
  console.log(`${fabric.name}: ${verts} verts, ${tris} tris, ${(images.reduce((a, b) => a + b.length, 0) / 1024).toFixed(0)} KB textures, ${Date.now() - t0} ms`);
});
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
rmSync(TMP, { recursive: true, force: true });
