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

## Camera tracking (works end to end; not yet proved in a render)
Goal: a 3D element stays put in the room when the camera looks away and comes back. Priority order the
owner asked for: (1) an AR track recorded while filming (ARKit/ARCore app export) is used when present;
(2) otherwise the server solves the camera with COLMAP; (3) if that fails, fall back to the 2D anchors.
All three are in place, in that order: `storeTrack` refuses to let a solve overwrite an uploaded track,
`make_track` solves one, and a clip with no track keeps working exactly as before on anchors.

Proved on the espresso clip (`ec5ddb0d08915e54d2ee2224`, IMG_9861.mov, 1080x1920, 253 frames), through
the real MCP tools on the server, not in a harness:
- `make_track` -> background job -> 85/85 sampled frames registered, 0.76 px reprojection error, coverage
  1.0, fovY 60.16 deg, about 3 minutes on the 4-core VPS. `list_footage` shows `track` and clears `trackJob`.
- `get_track` with two sightings triangulated the crema at 11.2 deg baseline, 0.0199 reprojection error,
  and drew a ground grid that sticks to the table right through the orbit.

Done since the last handoff:
- `src/tracking.js`: `sceneCentre` (a default middle for the checking grid). Fixed `trackOverlay`, which
  never worked: sharp resizes before it composites whatever order the calls are in, so the frame was
  shrunk and then the full-size overlay refused as too big. Two passes now.
- `src/animate.js`: `queueTrack` background job with restart recovery (`info.trackJob`, stages from the
  worker), `make_track`, `get_track` (status, quality, sightings, overlay sheet), `track`/`trackJob` in
  every clip summary, `track` in `create_upload_link`'s kinds, and `resolveWorld` turning each spot's
  sightings into a 3D position before an edit is saved (a spot a layer stands on that cannot be placed
  is an error at save time, not a surprise mid-render).
- `src/edits.js`: top-level `world: [{name, sightings}]`; model layers take `world` and `worldPath`; a
  flat layer's `at` may name a spot too. planEdit refuses world without a track, refuses world together
  with at/path/follow, keeps world names out of the anchor namespace, and warns about unused spots.
  New GUIDE section "Putting something in the room, not on the screen".
- Render props carry `track` (poses, fovY, aspect, up, scale - not the points) and the resolved `world`
  positions, only when a layer actually uses them.
- `remotion/src/edit/model.ts`: `cameraPoseAt`, `projectWorld`, `worldAt`, and `screenPlace` resolving a
  world spot for flat layers (put far off screen when it is behind the camera).
- `remotion/src/edit/Model3D.tsx`: world mode. The camera takes the tracked pose and `setViewOffset` maps
  the footage rect onto the canvas; the model stands on the track's up, faces where the camera was on its
  first frame, and `size` fixes its real size from that frame so perspective takes over afterwards. The
  existing screen-space path is untouched.
- `Dockerfile`: python3 + pycolmap 4.2.0 in `/opt/pycolmap`, `TRACK_PYTHON`. Adds ~360 MB. Verified in the
  running container. Without it the app still runs; `make_track` just says tracks cannot be solved here.
- `test/tracking.test.js`: 9 tests on a synthetic orbit - coverage, projection, behind-the-camera,
  triangulation against a known point, refusing a too-narrow baseline, single-sighting placement, and an
  OpenCV world-to-camera round trip. No COLMAP needed. `npm test`: 68 pass.

Still to do:
1. **Render a world-placed model and look at it.** Everything above is checked except the last step: no
   edit with `world` has been rendered yet, so `setViewOffset`, the up/facing basis and the size rule are
   unproven in a picture. Do this first - put a model on the espresso clip's cup and render frames either
   side of the camera moving. Expect the sign of `up` to need checking: a COLMAP solve has no gravity, so
   `estimateUp` guesses from the biggest flat surface, and on this clip it returned a vector whose meaning
   is only clear from the overlay.
2. Dashboard: upload/solve/delete routes and UI for tracks (the MCP side is done, the dashboard is not).
3. `worldPath` stride: walking between spots should pace the animation by distance in the room, as
   `stride` does on screen. Not wired.
4. `docs/chatgpt-video.md`: describe tracks for the owner.
5. Scale: a solved track has no real-world size, so `size` is relative to the frame it starts on. If the
   owner wants real metres, that needs a calibration step (mark two points a known distance apart).
6. Anchors and path keys are still clamped to 0-1, so a 2D anchor cannot be followed off screen and back.
   That only limits the last-resort path; world spots do not care.

## Animations with no clip, and cutting several clips together
- `new_animation` (MCP) / `POST /api/animations` / "Start an animation" on the dashboard makes a BLANK
  CANVAS: a size and a length with no video behind it. It is a footage row carrying `info.blank`, not a
  second kind of thing, so versions, previews, renders, pictures, models, sounds and the dashboard all
  work on it unchanged and only the video underneath is missing. This is what stops ChatGPT reaching for
  a random clip as a base when the owner just asks for an animation.
  planEdit refuses what needs a clip on one (illustrate, blur, fog, parallax, zoom, anchors, world,
  depth, image place "footage") with the reason, at save time rather than mid-render.
  Verified: a canvas rendered text, a caption, a sticker and looping particles on a plain background.
- An edit can now cut between several videos. Name them in `clips: [{name, footage}]` and give a timeline
  entry a `clip`; an entry with none plays the edit's own clip, so a trailer can be built on a blank
  canvas that holds nothing but the cuts. Each entry is bounded by the length of the clip IT plays.
  Clips keep their own shape (`clipRect`), so a portrait and a landscape clip each fill the frame the way
  `fit` says instead of being squeezed into the host's shape.
  Anchors, depth, world spots and the camera track stay the edit's OWN clip's: they are read in that
  clip's source frames and mean nothing during a part playing a different video.
- Render history: `store.allRenders`, `GET /api/renders`, a `list_renders` MCP tool, and a "Render
  history" section on the dashboard showing every render ever made across all clips and animations.
  Each clip card also lists all its edit versions, newest first.

## Grading, dissolves and speed ramps
- `src/grade.js` is the colour grading board: ten named film looks, each with what it is for, the knobs
  it sets, and the colours it pulls a picture towards. `list_looks` hands ChatGPT the board; `get_colors`
  reads a frame's main colours and scores every look against them in Lab space (RGB distance does not
  match what the eye calls "the same colour"), so a look can be chosen to suit the shot rather than
  fought against it. A warm/cyan shot scores teal-orange 100; a grey one scores bleach-bypass 100.
- A `grade` layer colours the PICTURES and leaves text and graphics alone. It names a look, mixes it in
  at `strength`, and may override any knob (exposure, contrast, saturation, temperature, tint, lift,
  gain, fade, vignette, grain) plus letterbox `bars` at 2.39/2.00/1.85. One grade at a time.
  The look is resolved to plain numbers by planEdit and stored with the edit, so the renderer needs no
  copy of the board and tuning a look later cannot change an edit that was already approved. Because of
  that, `knobs` MUST stay declared on the Grade schema: a saved spec is read back through it, and when
  it was missing every preview and render of a perfectly-saved edit failed on `unrecognized_keys`.
- `dissolve` on a timeline entry overlaps it with the shot before, so the edit gets shorter; the first
  shot has nothing to dissolve from and a too-long dissolve is clamped. For a dip to black, cut and put
  a `flash` with `color: black` over the join.
- `ramp` is the speed a shot ENDS at, eased from `speed`. It is built as ten stepped constant-rate
  pieces, not a curve, because one video element plays at one rate. Split by SOURCE frames so the shot
  still ends exactly where it was asked to.
- `test/grade.test.js` covers the board, the matching, the save/re-read round trip, dissolve arithmetic
  and ramp monotonicity. `npm test`: 78 pass.
- Verified in pictures: six looks side by side on one frame, all clearly distinct, vignette and grain
  visible; and a trailer cutting three clips with dissolves, a slow-down ramp and 2.39 bars.

## Lens effects, shot matching and transitions
- `halation` (warm bloom out of the highlights) and `aberration` (colour fringing) are grade knobs, and
  some looks carry them: neon-night 0.42/0.2, vintage-film 0.3/0.16, golden-hour 0.26 halation.
  Halation isolates the bright parts with a steep transfer curve, blurs them wide, pushes them red and
  adds that back; aberration splits R and B apart with feOffset and recombines them.
- A grade may name a `clip`, and then it only touches the parts playing that clip. That is SHOT
  MATCHING: one grade per camera, several live at once, because they can never cover the same frame.
  The overlap rule allows that and still refuses two grades for one clip, or two covering everything.
  This needed the filter to move off the Footage wrapper and onto each segment.
- A shot arrives by `dissolve`, `wipe`, `slide` or `push`, from left/right/up/down, given as
  `transition: {kind, frames, from}` (`dissolve: N` stays as shorthand). Freezes can arrive the same
  ways - before this the Hold schema had no dissolve field at all, so `{hold, dissolve}` was silently
  ignored. The segment carries `enter: {kind, frames, from}`; `dissolve` as a segment field is gone.
- Two bugs worth not repeating, both found by rendering the exact midpoint of each transition rather
  than a frame either side of it:
  1. `from` was inverted - `shove(t - 1)` negated the offset, so everything arrived from the opposite
     side to the one asked for. It is `shove(1 - t)`.
  2. A push moved the OUTGOING shot the same way as the incoming, so nothing covered the space behind
     them and a black band opened up. A push is two shots travelling together: incoming d→0, outgoing
     0→−d. Checked arithmetically over all four directions, not by eye.

## Bringing clips in
Until now nothing could add a clip except the dashboard: there were `add_picture`, `add_model` and
`add_sound` but no video equivalent, so multi-clip editing could only ever use footage the owner had
uploaded by hand. Two doors now:
- `add_video`: a file from the conversation or a public HTTPS link to the video FILE (not a page it is
  embedded in). It goes through `fetchPublic`, so it keeps the SSRF, redirect and size guards the other
  fetches use. Capped at 220 MB because the body is held in memory while it is checked.
- `create_upload_link` kind `video`: for anything larger. The link MAKES the clip row (there is no clip
  to attach to yet) and the upload streams straight to disk. `footage` is optional for this kind.
Both share `intakeVideo`, which the dashboard route now uses too, so there is one probe-and-queue path
rather than three. The upload-link route is mounted before createAnimator, so it reaches the transcoder
through `app.locals.queueProcessing` rather than through an argument.
Verified live: an upload link streamed a file to ready (464x832, 100f), and a URL import fetched,
transcoded and came up ready (320x176, 299f).
Known: some CDNs answer the fetch with 403 because of the User-Agent `fetchPublic` sends
("RigaWeekend/0.1 (+event listing preview)") - Google's gtv-videos-bucket does. The failure is clean and
says to use an upload link instead. Worth revisiting if it turns up often, but it is shared with photos.

## Other notes
- `remotion/src/PinboardStory.tsx` (owner's) imports `./autumnOpener`, which is not in the repo. Nothing
  imports PinboardStory yet, so renders are unaffected, but `tsc` reports it.
- The owner's thesis (adaptive music for running) is unrelated to this codebase; see the chat for the analysis.
