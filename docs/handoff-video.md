# Handoff: animated edits over footage (state as of 2026-09-28)

Paste into a new chat: "Read docs/handoff-video.md, then continue the camera-tracking work."

Branch `claude/wonderful-lovelace-wddojs` in `Kaspiks/rigathisweekend`. Deploy: `git pull`, then
`scripts/remote.sh deploy`, then Refresh the plugin in ChatGPT and enable any new tools.
Commit style the owner asked for: short one-line messages, no co-author lines.

## What exists and works (tested, pushed)
ChatGPT (GPT-6 Astra, Work mode) drives Remotion animation over the owner's own footage through the
app's MCP plugin. `docs/chatgpt-video.md` describes it for the owner; `src/edits.js` holds the edit
schema and `GUIDE`, the text ChatGPT reads through `get_edit_guide`.

- Footage: upload → 30 fps working copy; contact sheets, gridded frames, anchors, zooms, timeline cuts,
  holds and speed changes (`src/footage.js`, `src/edits.js`, `src/animate.js`).
- Layers: text, stickers, drawn/illustrated footage (SVG filters), images, sprite sequences (grid sheets,
  ranges, pingpong, tint, glow, blend), particles, ChatGPT-defined graphics (saved library), 3D models
  (GLB with animations, `depth: "auto"`, `stride`, `front`, `follow`, `soften`, `node`), depth effects
  (blur, fog, parallax, occlusion), zoom, shake, flash.
- Text: five fonts, letter/word/line reveals and exits, loops, highlights, counting numbers, stroke,
  glow, gradient, path (`remotion/src/edit/Texts.tsx`).
- Sound: uploaded sounds on exact frames with volume, keys, fades, loop, ducking, pan, pitch, reverse,
  filters, echo, reverb; loudness report in `get_render` (`src/sounds.js`).
- Depth made on the server with Depth Anything V2 Small via onnxruntime (`src/depth.js`, `src/depth-worker.js`).
- House rules: `save_guide_note` / `delete_guide_note` append rules to `get_edit_guide` (table `guide_notes`).
- `build_sprite` lays out uploaded single frames as a grid sprite sheet.
- Render service: `remotion/server.mjs` (POST /clip), composition `remotion/src/FootageEdit.tsx`.
- Tests: `npm test` (73 pass at the last full run). Scratch helpers were kept out of the repo.

## In progress: camera tracking (not finished, not wired into edits yet)
Goal: a 3D element stays put in the room when the camera looks away and comes back. Priority order the
owner asked for: (1) an AR track recorded while filming (ARKit/ARCore app export) is used when present;
(2) otherwise the server solves the camera with COLMAP; (3) if that fails, fall back to the 2D anchors.

Done so far:
- `src/tracking.js`: `normalizeTrack(json, work, source)` turns an uploaded or solved track into one pose
  per working-copy frame (OpenGL convention: camera looks −Z, +Y up; quaternions [x,y,z,w]); accepts
  `convention` opengl|opencv, `space` camera-to-world|world-to-camera, `fps` or per-sample `t`/`frame`,
  `fovY` or `intrinsics`, `roll` (portrait ARKit video may need 90 or -90), `up`, `points`.
  `estimateUp` (RANSAC floor plane, else camera average), `poseAt`, `project` (world point → 0–1 of the
  footage), `locate` (triangulate a spot marked on ≥2 frames; one sighting uses the solve's scene points),
  `solveTrack` (runs the worker, rejects if <60% of sampled frames register), `saveTrack`/`loadTrack`
  (`footage/<id>/track.json`), `trackOverlay` (draws a ground grid and world points on a frame, for checking).
- `src/track-worker.py`: pycolmap 4.2 (CPU): samples ≤~120 frames, SIFT, exhaustive matching (so coming
  back to a place joins up), incremental mapping; prints JSON lines `{stage}` and `{result}`.
  Trial on the espresso clip: 40/40 frames registered, ~8000 points, 0.47 px error, ~70 s on 4 cores.
- `src/animate.js`: imports tracking; `clipInfo` now carries `track`; `storeTrack()`; upload links accept
  `kind: "track"` (JSON body) — but `create_upload_link` does not offer `track` yet.

Still to do:
1. `animate.js`: add `track` to `create_upload_link`'s kind enum; `make_track` tool + background job like
   `queueDepth` (state in `info.trackJob`, restart recovery, `TRACK_MAX_SECONDS` default 60,
   `TRACK_PYTHON`); `get_track` tool (status, quality, overlay sheet via `trackOverlay`, optional
   sightings to test); summary fields `track`/`trackJob`; dashboard upload/solve/delete routes and UI.
2. Edit schema (`src/edits.js`): top-level `world: [{name, sightings: [{frame, x, y}]}]` (SOURCE frames,
   0–1 footage coords; names share the anchor namespace); model layer `world: "<name>"` and
   `worldPath: [{frame, world}]`; planEdit errors when world is used without a track. Resolve positions in
   animate.js with `locate()` (warn if error > ~0.02) and report them from save_edit/get_edit.
3. Render props: pass `track` (poses, fovY, aspect, up, scale — not points) and resolved `world` positions
   through `runRender` → `remotion/server.mjs` → composition.
4. Renderer: in `Model3D.tsx`, a world mode: camera from `poseAt` at the fractional source frame
   (`sourceAt`), `setViewOffset` to map the footage rect (zoom/crop) onto the canvas, model at the world
   point oriented to `up`, facing the camera at the layer's first frame, size from `size` at that frame,
   shadow floor perpendicular to `up`, lights relative to that basis; `worldPath` in 3D with stride by
   world distance. In `model.ts`, let `at: "<world point>"` project for 2D layers (hidden when behind the
   camera).
5. Dockerfile: install python3 + pycolmap (e.g. a venv with `pycolmap==4.2.0`), `PYTHONDONTWRITEBYTECODE=1`.
6. Tests (synthetic AR track JSON: normalize, locate, project; skip the COLMAP test if pycolmap is missing),
   GUIDE section, `docs/chatgpt-video.md`.

## Other notes
- `remotion/src/PinboardStory.tsx` (owner's) imports `./autumnOpener`, which is not in the repo. Nothing
  imports PinboardStory yet, so renders are unaffected, but `tsc` reports it.
- The owner's thesis (adaptive music for running) is unrelated to this codebase; see the chat for the analysis.
