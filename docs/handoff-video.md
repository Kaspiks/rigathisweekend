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
0. **Deploy.** The finishing pass, per-shot framing, smoothed slow motion and `match_grade` are pushed
   but not on the server: `scripts/remote.sh deploy` was refused by the tooling as a production deploy.
   Nothing below this line depends on it, but ChatGPT cannot see any of it until it happens, and the
   connector needs reconnecting afterwards to pick up `match_grade`.
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

## The finishing pass, per-shot framing and real slow motion (built, NOT deployed)
ChatGPT's own review of a trailer it had cut named what was missing. Most of the list was sourcing
(better close-ups, real engine sound, a bigger crescendo, fewer title cards) and needed no code. Four
things did, and all four are built, measured and pushed - but the deploy was refused by the tooling, so
**none of this is on the server yet**. Deploy before telling anyone it is there.

- **Highlight roll-off** (`rolloff`, on a grade and on a finish). A sensor clips its highlights to a flat
  wall of white; film bends them over. That flat wall is most of what makes a shot look like video. The
  curve is a knee at 1 − 0.65r rising to 1 − 0.10r, and the exponent is not a taste number: 13/11 is
  whatever makes the slope exactly 1 where the straight part meets the curve, so no bright band shows at
  the knee. Every look now carries some. Written out twice, in `src/grade.js` and
  `remotion/src/edit/filters.tsx`, because the renderer runs in its own container and cannot import the
  app - `test/finish.test.js` compares the two function bodies so they cannot drift apart.
- **A `finish` layer**: one shoulder, one glow and one grain over the WHOLE frame, titles included, after
  everything else is drawn. A grade colours the pictures and is per clip; two clips graded separately
  still sit apart while each keeps its own highlight behaviour and its own texture. The finish is what
  puts them on one print. Knobs: rolloff, grain, bloom (neutral diffusion), halation (warm), aberration,
  vignette. `in`/`out` default to 0, unlike every other layer, because a grain that fades up over eight
  frames is a fault and not an effect.
- **`reframe` and `mirror` on a timeline entry**: the framing of ONE shot, where the `zoom` layer is one
  move over the whole edit. `scale`/`x`/`y` and `scaleTo`/`xTo`/`yTo`, plus `blur` for motion blur while
  it moves. Mirror is the continuity tool (match screen direction across a cut). The framing carries the
  shot's OUTPUT span in `shot`, so a punch-in eases across a speed ramp's ten segments as one move
  instead of restarting on each. Defaults are an exact no-op, and the crop is clamped the way the camera
  is, so it can never uncover the edge of the picture.
- **`smooth` on a slow shot**: below speed 1 a source frame was simply shown two or three output frames
  running. Now each output frame is mixed from the two source frames it falls between, as two frozen
  `OffthreadVideo`s cross-faded. Only carried on segments below 0.9 (a ramp blends its slow end only),
  and save_edit warns when a shot is slow enough to need it and has not asked. Minimum speed dropped
  0.25 -> 0.1.
- **`match_grade` and levels on `get_colors`**: what an editor does by eye when cutting a phone clip
  against stock. `levelsFrom` measures the 1st/50th/99th luma percentiles and the channel means;
  `matchKnobs` turns two measurements into knobs, against the filter's own arithmetic
  (y = e·c·x + (1−c)/2). Temperature and tint are solved from channel RATIOS **after** the levels -
  solving both stages against the raw means was wrong on any clip needing a real contrast correction.
  It reports which knobs hit their limit rather than handing back a number at its stop.
  **The levels are FITTED, not forced, and that was the second thing to get wrong here.** The first
  version solved exposure and contrast so that black and white landed on the reference exactly. On the
  real drift footage that matched both ends and pushed the MIDTONES 0.16 apart - and overall brightness
  is the first thing the eye reads on a cut, so it traded a small fault for a bigger one. Exposure and
  contrast together are one straight line and a line cannot pass through three points. They are now a
  weighted least-squares fit over black, mid and white (weights 2/3/1: the mid matters most, the extreme
  white least, since it is usually one specular and the roll-off deals with it). `match_grade` answers
  with `apart.before` and `apart.after` so the trade is visible rather than hidden.
  What least squares promises is NOT that every level improves - it will move one that already matched
  if that buys the other two - but that the weighted total never gets worse, because leaving the clip
  alone is itself a candidate the fit could have picked. `test/finish.test.js` holds it to that over
  2000 random pairs; an earlier, stronger claim ("no level ever gets worse") is simply false and the
  fuzz found a counterexample in the first pair it tried.

How it was verified without a deploy, which is worth repeating:
- `npx remotion bundle` builds the whole project; `tsc --noEmit` is clean.
- Every filter graph was rendered to markup with react-dom/server and walked: a primitive whose `in`
  names a result nothing produced renders TRANSPARENT BLACK, which over the whole frame means the
  picture disappears. All paths sound, including an old saved edit whose knobs have no `rolloff` key.
- Then a real render, through the same selectComposition/renderStill the render service uses, against a
  test clip built to be MEASURED: a black-to-white ramp down the frame (so the roll-off can be read
  straight off the picture), a blown white square, a red block on the left only, and a dot moving 8 px a
  frame. Results: the rendered ramp follows the curve within 1.2/255 at every sample; grain lifts the
  noise on a flat row from sd 0.00 to 4.09 and leaves the brightness alone; bloom spills 33 levels just
  outside the square and falls off with distance; a reframe puts the square's centre exactly at frame
  centre; a mirror moves the red block from left to right; mid punch-in the sharpest edge in the frame
  drops from 129 to 4; and halfway between two source frames the blend reads 188.7 where the unblended
  one reads 124.9 (predicted 191 and 127).
- The claim that separates a finish from a grade was measured too: on a white title band, a finish takes
  the noise from sd 0.00 to 6.02 and a grade leaves it at 0.00.
- Gotcha: `selectComposition` resolves the props, and `renderStill` handed DIFFERENT props renders the
  ones the composition was selected with. Nine renders came out identical before that was spotted.
- Then, deployed, on the owner's own drift clips - the vertical Latvia one cut against the horizontally
  cropped stock, which is the pair ChatGPT said looked mismatched. Measured off the rendered frames:
  the two shots' black points went from 0.128 apart to 0.013 and their whites from 0.084 to 0.012.
  That render is also what exposed the midtone fault above: with the first solve the mids went from
  0.036 apart to 0.117. Everything new rendered together on real footage without complaint - 0.4x
  smoothed slow motion under a punch-in with motion blur, cutting to a mirrored, reframed shot of the
  other clip, all under a finish.

## Generated sound (built, NOT yet proved against a real key)
Voiceover, sound effects and music from ElevenLabs, driven by ChatGPT. The integration itself is small,
because `saveSound` already took any audio buffer and turned it into the 48 kHz WAV the renderer mixes -
so a generated sound is an ordinary sound, and ducking, looping, fades, pitch and reverb all work on it
without knowing where it came from. What took the thought was everything around the call.
- `src/voice.js` is the board, and it exists for the same reason `src/grade.js` does: "read this sadly"
  is not something a model can hand to an API, but `cinematic-sad` can be a row that says what it is for
  and which knobs it sets. Ten deliveries, each setting stability / style / speed, mixed in by
  `strength` the way a look is. `list_voices` hands ChatGPT the board.
- A style carries the DELIVERY; the VOICE belongs to the account, so it is pinned per style in the
  `voice_styles` table by `set_style_voice`. Without a pin the account's first voice reads everything,
  and `speak` says so in its answer rather than letting that pass silently.
- `src/eleven.js` is the only place the key is used and the only place a URL is built. ChatGPT can ask
  for "a whoosh"; it cannot ask for a URL. A voice id goes through `encodeURIComponent`, which a test
  holds it to.
- **Cost is the whole design.** Two separate guards:
  - The CACHE (`voice_cache`) keys on everything that went into the request. The same words in the same
    delivery are generated once and kept; asking again is a file copy. That is not only money - a line
    regenerated after an edit would otherwise come back a subtly different take and stop matching the
    one beside it.
  - The CAP is enforced against ElevenLabs' OWN `character_count`, not an estimate made here, because a
    cap enforced on a guess is not a cap. An estimate is still made before the call (nothing else can
    decide whether to make it), but what goes in the ledger afterwards is the measured difference in
    the account's counter. `ELEVENLABS_CREDIT_CAP` defaults to 80% of the plan, so the owner always
    keeps some for their own use in the ElevenLabs app.
- `speak` with `captions: true` uses the with-timestamps endpoint and turns character-level alignment
  into word-timed text layers in OUTPUT frames, offset by `at`. Nobody asked for it; it is the best part.
  A caption holds until the next one starts rather than fading on its own, because a gap between
  captions reads as a dropped word.
- Published rates used for the estimate: speech 1 credit a character (half on flash/turbo models), a
  sound effect with a length given 40 credits a second. **The music rate is not documented anywhere I
  found**, so `RATES.musicPerSecond` is a deliberate over-guess; it only ever decides whether to make
  the call, and the ledger corrects it afterwards.
- Verified without a key or a network: 20 tests over the board, the estimates, the word gathering, the
  caption timing and the exact body of every request that leaves (field names checked against the live
  docs - a wrong one costs a deploy and a confusing 422 to find), plus every error status mapped to
  something the owner can act on. All six tools register with MCP-safe schemas; the no-key branch of
  `list_voices` explains itself instead of throwing.
- **Still unproved:** no call has been made against a real key, so nothing has gone through `saveSound`
  end to end. There is no local ffmpeg on the author's machine, so that step cannot be exercised here
  either. First thing after the key is set: `speak` a short line, check the WAV lands and plays, then
  `voice_budget` to see the ledger agree with the account.
- The connector is now 35 tools. Worth watching - ChatGPT's tool lists get unwieldy somewhere past this.

## Other notes
- `remotion/src/PinboardStory.tsx` (owner's) imports `./autumnOpener`, which is not in the repo. Nothing
  imports PinboardStory yet, so renders are unaffected, but `tsc` reports it.
- The owner's thesis (adaptive music for running) is unrelated to this codebase; see the chat for the analysis.
