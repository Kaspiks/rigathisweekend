// Structural check on a hand-written GLB: chunk lengths, accessor sizes against their bufferViews,
// the embedded texture, and the winding of the first triangle of each primitive (a face wound the
// wrong way is invisible with backface culling, which is hard to tell from "the model did not load").
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
const b = readFileSync(process.argv[2] || '/tmp/foxassets/story-book.glb');
console.log(`magic=${b.toString('utf8', 0, 4)} version=${b.readUInt32LE(4)} declared=${b.readUInt32LE(8)} actual=${b.length} ${b.readUInt32LE(8) === b.length ? 'MATCH' : 'MISMATCH'}`);
let off = 12; const chunks = [];
while (off < b.length) { const len = b.readUInt32LE(off), type = b.readUInt32LE(off + 4); chunks.push({ type: type === 0x4E4F534A ? 'JSON' : 'BIN', len, off: off + 8 }); off += 8 + len; }
console.log('chunks:', chunks.map((c) => `${c.type}(${c.len})`).join(' '));
const j = JSON.parse(b.toString('utf8', chunks[0].off, chunks[0].off + chunks[0].len));
const bin = b.subarray(chunks[1].off, chunks[1].off + chunks[1].len);
const SIZE = { 5126: 4, 5125: 4, 5123: 2 }, COMP = { VEC3: 3, VEC2: 2, SCALAR: 1 };
for (const [i, a] of j.accessors.entries()) {
  const want = a.count * COMP[a.type] * SIZE[a.componentType], view = j.bufferViews[a.bufferView];
  const have = view.byteLength - (a.byteOffset || 0);
  console.log(`accessor ${i} ${a.type} count=${a.count} needs ${want}B, view has ${have}B ${want <= have ? 'OK' : 'SHORT'}`);
}
const read = (ai, i) => {
  const a = j.accessors[ai], v = j.bufferViews[a.bufferView], n = COMP[a.type];
  const base = v.byteOffset + (a.byteOffset || 0) + i * n * SIZE[a.componentType];
  return Array.from({ length: n }, (_, k) => a.componentType === 5126 ? bin.readFloatLE(base + k * 4) : a.componentType === 5125 ? bin.readUInt32LE(base + k * 4) : bin.readUInt16LE(base + k * 2));
};
for (const p of j.meshes[0].primitives) {
  const m = j.materials[p.material], count = j.accessors[p.indices].count;
  let backwards = 0, degenerate = 0, worst = 1;
  for (let t = 0; t < count; t += 3) {
    const vi = [0, 1, 2].map((k) => read(p.indices, t + k)[0]);
    const tri = vi.map((v) => read(p.attributes.POSITION, v));
    const e1 = tri[1].map((v, k) => v - tri[0][k]), e2 = tri[2].map((v, k) => v - tri[0][k]);
    const nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0];
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-12) { degenerate++; continue; }
    const s = read(p.attributes.NORMAL, vi[0]);
    const dot = (nx * s[0] + ny * s[1] + nz * s[2]) / len;
    if (dot < worst) worst = dot;
    if (dot < 0) backwards++;
  }
  const tag = backwards ? `${backwards}/${count / 3} BACKWARDS` : 'all agree';
  console.log(`primitive "${m.name}" ${count / 3} tris: ${tag}, worst dot ${worst.toFixed(3)}${degenerate ? `, ${degenerate} degenerate` : ''}  doubleSided=${!!m.doubleSided}`);
}
const iv = j.bufferViews[j.images[0].bufferView];
const png = bin.subarray(iv.byteOffset, iv.byteOffset + iv.byteLength);
const meta = await sharp(png).metadata();
console.log(`texture ${meta.width}x${meta.height} ${meta.format} alpha=${meta.hasAlpha} ${png.subarray(0, 4).toString('hex') === '89504e47' ? 'valid PNG' : 'BAD SIGNATURE'}`);
