// 3D models for edits: binary glTF (.glb) files, one per name for a clip. A model is checked here before
// it is kept: a real GLB, everything inside the one file (no links to other files or the web), nothing
// the renderer cannot decode, and not so heavy that software rendering crawls. Its animations are read
// out so edits can name them and ChatGPT can see what the model can do.
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const fail = (message, httpStatus = 400) => Object.assign(new Error(message), { httpStatus });
export const MAX_MODEL = 50 * 1048576;
export const MAX_TRIANGLES = 400_000;
// Extensions three.js decodes on its own (meshopt with its built-in decoder). Draco and Basis need extra
// decoders, so models using them are turned away with a way to fix it.
const SUPPORTED = new Set([
  'KHR_materials_emissive_strength', 'KHR_materials_clearcoat', 'KHR_materials_ior', 'KHR_materials_specular', 'KHR_materials_transmission',
  'KHR_materials_iridescence', 'KHR_materials_sheen', 'KHR_materials_volume', 'KHR_materials_unlit', 'KHR_materials_anisotropy', 'KHR_materials_dispersion',
  'KHR_materials_bump', 'KHR_texture_transform', 'KHR_mesh_quantization', 'KHR_lights_punctual', 'EXT_meshopt_compression', 'KHR_meshopt_compression',
  'EXT_texture_webp', 'EXT_texture_avif', 'EXT_mesh_gpu_instancing',
]);
const COMPRESSED = { KHR_draco_mesh_compression: 'Draco-compressed', KHR_texture_basisu: 'uses KTX2/Basis textures' };

// Reads a GLB's JSON chunk and checks it. Returns what the model offers: its animations (names as the
// renderer will know them, and lengths), triangles and size.
// Bumped whenever this function starts recording something new, so sidecars written by an older
// version are rebuilt from the GLB on the next listing instead of quietly keeping stale metadata.
export const META = 3;

export function inspectModel(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw fail('Send the model itself as the body');
  if (buffer.length < 4 || buffer.toString('latin1', 0, 4) !== 'glTF') throw fail('That is not a GLB file. Export the model as binary glTF (.glb), with textures embedded');
  if (buffer.length < 20) throw fail('That GLB file is damaged');
  if (buffer.readUInt32LE(4) !== 2) throw fail('Only glTF 2.0 models can be used');
  if (buffer.readUInt32LE(8) > buffer.length) throw fail('That GLB file is cut short; upload it again');
  const jsonLength = buffer.readUInt32LE(12);
  if (buffer.readUInt32LE(16) !== 0x4e4f534a || 20 + jsonLength > buffer.length) throw fail('That GLB file is damaged');
  let gltf;
  try { gltf = JSON.parse(buffer.toString('utf8', 20, 20 + jsonLength)); } catch { throw fail('That GLB file is damaged'); }
  for (const ext of gltf.extensionsRequired || []) {
    if (COMPRESSED[ext]) throw fail(`That model is ${COMPRESSED[ext]}, which the renderer cannot decode. Export it again without that compression (in Blender: glTF export, untick Compression)`);
    if (!SUPPORTED.has(ext)) throw fail(`That model needs the glTF extension ${ext}, which the renderer does not support`);
  }
  // Everything must be inside the file: an external .bin or texture would be fetched from nowhere.
  const external = [...(gltf.buffers || []), ...(gltf.images || [])].find(x => x.uri != null && !/^data:/i.test(x.uri));
  if (external) throw fail(`That model points to a separate file (${String(external.uri).slice(0, 60)}); export it as one .glb with everything embedded`);
  if (!gltf.meshes?.length) throw fail('That model has no meshes, so there is nothing to draw');
  const accessors = gltf.accessors || [];
  let triangles = 0;
  for (const mesh of gltf.meshes) for (const prim of mesh.primitives || []) {
    if (prim.mode != null && prim.mode !== 4) continue;
    const count = prim.indices != null ? accessors[prim.indices]?.count : accessors[prim.attributes?.POSITION]?.count;
    triangles += Math.floor((count || 0) / 3);
  }
  if (triangles > MAX_TRIANGLES) throw fail(`That model has ${triangles.toLocaleString('en')} triangles; keep it under ${MAX_TRIANGLES.toLocaleString('en')} (decimate it, or pick a low-poly version)`);
  // Names as three.js gives them, so edits and the renderer agree; the length is the last key's time.
  const animations = (gltf.animations || []).map((a, i) => ({
    name: a.name || `animation_${i}`,
    seconds: Math.round(Math.max(0, ...(a.samplers || []).map(s => Number(accessors[s.input]?.max?.[0]) || 0)) * 100) / 100,
  }));
  // Names a `node` on a model layer can pick out - the fox inside a whole workshop, say. Only nodes
  // with children are worth listing: leaves are the individual parts a modeller left lying about
  // ("part", "Cube.014"), and naming those would bury the two or three groups anyone actually wants.
  const nodes = [...new Set((gltf.nodes || []).filter(n => n.name && n.children?.length).map(n => n.name))].slice(0, 16);
  return { meta: META, animations, nodes, bounds: modelBounds(gltf), triangles, skinned: !!gltf.skins?.length, bytes: buffer.length };
}

// How big the model is, in its own units, with node transforms applied. `size` on a model layer is its
// HEIGHT as a fraction of the frame height, so without this a flat model (a book, a board, a sign) is
// impossible to size: its height is its thickness, and nothing says how wide that makes it on screen.
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const multiply = (a, b) => {
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let sum = 0;
    for (let k = 0; k < 4; k++) sum += a[k * 4 + r] * b[c * 4 + k];
    out[c * 4 + r] = sum;
  }
  return out;
};
// A node's local transform: glTF gives either a column-major matrix or translation/rotation/scale.
function localMatrix(node) {
  if (Array.isArray(node.matrix) && node.matrix.length === 16) return node.matrix;
  const [x, y, z, w] = node.rotation || [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale || [1, 1, 1];
  const [tx, ty, tz] = node.translation || [0, 0, 0];
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    tx, ty, tz, 1,
  ];
}
const transform = (m, x, y, z) => [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];

function modelBounds(gltf) {
  const accessors = gltf.accessors || [], nodes = gltf.nodes || [], meshes = gltf.meshes || [];
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  const seen = new Set();
  const visit = (index, parent, depth) => {
    const node = nodes[index];
    if (!node || depth > 64 || seen.has(`${index}@${depth}`)) return;
    seen.add(`${index}@${depth}`);
    const world = multiply(parent, localMatrix(node));
    if (node.mesh != null) for (const prim of meshes[node.mesh]?.primitives || []) {
      const a = accessors[prim.attributes?.POSITION];
      if (!a?.min || !a?.max || a.min.length < 3 || a.max.length < 3) continue;
      // Every corner of the primitive's box, because a rotation turns the box into a different box.
      for (let corner = 0; corner < 8; corner++) {
        const p = transform(world, corner & 1 ? a.max[0] : a.min[0], corner & 2 ? a.max[1] : a.min[1], corner & 4 ? a.max[2] : a.min[2]);
        for (let k = 0; k < 3; k++) { if (p[k] < lo[k]) lo[k] = p[k]; if (p[k] > hi[k]) hi[k] = p[k]; }
      }
    }
    for (const child of node.children || []) visit(child, world, depth + 1);
  };
  const roots = gltf.scenes?.[gltf.scene ?? 0]?.nodes ?? nodes.map((_, i) => i);
  for (const root of roots) visit(root, IDENTITY, 0);
  if (!Number.isFinite(lo[0]) || !Number.isFinite(hi[0])) return null;
  const round = v => Math.round(v * 1000) / 1000;
  return { width: round(hi[0] - lo[0]), height: round(hi[1] - lo[1]), depth: round(hi[2] - lo[2]) };
}

export const modelFile = (folder, name) => join(folder, `${name}.glb`);

export async function saveModel(buffer, folder, name) {
  const info = inspectModel(buffer);
  await mkdir(folder, { recursive: true });
  const glb = modelFile(folder, name), meta = join(folder, `${name}.json`);
  await writeFile(`${glb}.part`, buffer);
  await rename(`${glb}.part`, glb);
  await writeFile(meta, JSON.stringify({ ...info, updated: new Date().toISOString() }));
  return { name, ...info };
}

export async function deleteModel(folder, name) {
  await rm(modelFile(folder, name), { force: true });
  await rm(join(folder, `${name}.json`), { force: true });
}

export async function modelList(folder) {
  // Enumerate the GLBs, not the sidecars. The sidecar is derived data: if it is missing or was written
  // by an older version it gets rebuilt here, whereas listing sidecars made a model with no sidecar
  // invisible even though the .glb was sitting right there.
  const names = (await readdir(folder).catch(() => []))
    .filter(f => /^[a-z0-9][a-z0-9-]{0,31}\.glb$/.test(f)).map(f => f.slice(0, -4)).sort();
  const list = await Promise.all(names.map(async name => {
    const meta = join(folder, `${name}.json`);
    let info = null;
    try { info = JSON.parse(await readFile(meta, 'utf8')); } catch {}
    if (!info || info.meta !== META) {
      try {
        info = { ...info, ...inspectModel(await readFile(modelFile(folder, name))) };
        await writeFile(meta, JSON.stringify({ ...info, updated: info.updated || new Date().toISOString() }));
      } catch { return null; }
    }
    return { name, ...info };
  }));
  return list.filter(Boolean).map(({ name, animations, nodes, bounds, triangles, skinned, bytes }) =>
    ({ name, animations, nodes: nodes?.length ? nodes : undefined, bounds: bounds || undefined, triangles, skinned, mb: Math.round(bytes / 104857.6) / 10 }));
}

