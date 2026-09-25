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
  return { animations, triangles, skinned: !!gltf.skins?.length, bytes: buffer.length };
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
  const names = (await readdir(folder).catch(() => [])).filter(f => /^[a-z0-9][a-z0-9-]{0,31}\.json$/.test(f)).sort();
  const list = await Promise.all(names.map(async f => {
    try { return { name: f.slice(0, -5), ...JSON.parse(await readFile(join(folder, f), 'utf8')) }; } catch { return null; }
  }));
  return list.filter(Boolean).map(({ name, animations, triangles, skinned, bytes }) => ({ name, animations, triangles, skinned, mb: Math.round(bytes / 104857.6) / 10 }));
}
