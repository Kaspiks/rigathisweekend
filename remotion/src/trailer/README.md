# "Of the Empire" trailer plates and master

Six 3D plates for the trailer, made with three.js through Remotion and rendered on a Mac's GPU, then cut,
titled, graded and mixed by ChatGPT as a normal Riga edit (footage `266306b463cf03a52583ea69`, version 15).
Nothing here is part of the render service: `src/trailer/index.ts` is its own Remotion entry.

| Shot | Composition | Source | Riga footage |
| --- | --- | --- | --- |
| 1 Empire | `TrailerEmpire` (437 f) | `Empire.tsx` | `08527388416b30d0f2647473` |
| 2 Wealth | `TrailerWealth` (174 f) | `Wealth.tsx` | `18af97e09a16be6bf81c591f` |
| 3 River | `TrailerRiver` (261 f) | `River.tsx` | `53ac75ba5ea2254c18b05042` |
| 4 Commodity | `TrailerCommodity` (164 f) | `Commodity.tsx` | `77565360ded6d6400d87069e` |
| 5 Apparatus | `TrailerApparatus` (322 f) | `Apparatus.tsx` | `e9ac0074e6908f059a94ade8` |
| 6 Heart | `TrailerHeart` (367 f) | `Heart.tsx` | `f40df5bb0fa2550734355861` |

Every plate has 15 frames of handle at each end. Shared pieces (textures, sky, dust, camera, depth of
field) are in `common.tsx`.

## Rebuild a plate

```sh
cd remotion
node src/trailer/render.mjs TrailerHeart stills 0,180,366   # check frames, half size
node src/trailer/render.mjs TrailerHeart video               # out/trailer/TrailerHeart.mp4
```

Upload with the plugin's `create_upload_link` (kind `video`) and `curl -T`.

## Rebuild the master (Riga footage `04210a4cd81ca8ec2480b921`)

1. Planned props for the edit, from the app's own code, on the server:
   `ssh <vps> 'cd /opt/riga-weekend && docker compose exec -T -e FOOTAGE=266306b463cf03a52583ea69 -e VERSION=15 app node --input-type=module -' < src/trailer/props.server.mjs > props-v15.json`
2. Render the edit locally, muted, with the plates served from local files (`clips.json` maps footage ids
   to files): `node src/trailer/master.mjs props-v15.json src/trailer/clips.json video out/trailer/master.mp4`
3. Send it to the server and mix the edit's sound cues under it there, from the server's own sound files
   (`mux.server.mjs`: each cue through the app's `processedSound`, then trim, length, fades, volume and
   start frame; summed, not normalised). Env: `VIDEO`, `OUT`, `FOOTAGE`, `FRAMES`, `FPS`, `CUES` (base64
   JSON of the `cues` in step 1's output).
4. Import the result as a Riga video through an upload link.

The full-rendered native pipeline does the same at about 1 s a frame; this route took 2.5 minutes.
