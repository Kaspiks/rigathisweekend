// Runs inside the app container: the props the render service would get for one edit version, planned by
// the app's own code. Sounds are left out (the video renders muted; the mix is made on the server).
const FOOTAGE = process.env.FOOTAGE, VERSION = process.env.VERSION ? Number(process.env.VERSION) : null;
const { Store } = await import('/app/src/store.js');
const { planEdit } = await import('/app/src/edits.js');
const { footageFiles } = await import('/app/src/footage.js');
const { assetList } = await import('/app/src/animate.js');
const { soundList } = await import('/app/src/sounds.js');
const { modelList } = await import('/app/src/models.js');
const store = new Store(process.env.DATA_DIR || 'data');
const f = store.footage(FOOTAGE), edit = store.edit(f.id, VERSION);
const clipInfo = x => ({ ...x.info.work, depth: x.info.depth ?? null, track: x.info.track ?? null, blank: !!x.info.blank });
const assets = Object.fromEntries((await assetList(store.dir, f.id)).map(a => [a.name, { width: a.width, height: a.height }]));
const sounds = Object.fromEntries((await soundList(footageFiles(store.dir, f.id).sounds)).map(x => [x.name, { seconds: x.seconds }]));
const models = Object.fromEntries((await modelList(footageFiles(store.dir, f.id).models)).map(m => [m.name, { animations: m.animations.map(a => a.name) }]));
const clips = Object.fromEntries(store.footageList().filter(x => x.status === 'ready' && x.info?.work).map(x => [x.id, { frames: x.info.work.frames, width: x.info.work.width, height: x.info.work.height, blank: !!x.info.blank }]));
const planned = planEdit(edit.spec, clipInfo(f), assets, store.graphics(), models, sounds, clips);
if (planned.spec.layers.some(l => l.world || l.worldPath)) throw new Error('This edit places layers in the room; that needs the camera track too');
const videos = Object.fromEntries(planned.spec.clips.map(c => { const w = store.footage(c.footage).info.work; return [c.name, { footage: c.footage, width: w.width, height: w.height, frames: w.frames }]; }));
const work = f.info.work;
process.stdout.write(JSON.stringify({ footage: f.id, version: edit.version, note: edit.note, cues: planned.spec.sounds, warnings: planned.warnings,
  props: { spec: { ...planned.spec, sounds: [] }, plan: planned.plan, assets, source: { width: work.width, height: work.height, frames: work.frames }, depth: f.info.depth ?? null, models, sounds: {}, track: null, world: null, videos, blank: !!f.info.blank } }));
store.close();
