# The storybook asset

`make-book.mjs` builds `story-book.glb`: the open book the 2D harvest scene is printed on, and that the
fox pops out of. Run it from the repo root:

```
node tools/book/make-book.mjs [src.png] [out.glb]     # defaults: /tmp/foxassets/painted-game-page.png -> story-book.glb
node tools/book/check.mjs [out.glb]                   # validate before uploading
```

Then upload it with the dashboard, or `create_upload_link` / `add_model` over MCP, under the name
`story-book`. `list_footage` reports its bounds, which is what a model layer's `size` is worked out
from — see "A flat 2D world that something pops out of" in `get_edit_guide`.

## Why it is built rather than drawn

The source art (`painted-game-page.png`) is a **photograph of an open book**, already carrying
perspective, a cover border and a page crease. Mapping that onto a flat quad and then tilting the quad
applies perspective twice, which is why the first version read as a squashed tray rather than a book.

So the tool undoes the photo's perspective and lets real geometry supply the depth instead:

1. **Flatten.** Three of the four cover edges were fitted to the pink border in the photo; the image's
   own left boundary stands in for the fourth, which runs off-frame. A projective map takes that quad
   back to a rectangle. The fitted lines are constants at the top of the file — re-fit them if the
   source art is ever replaced.
2. **Crop.** Past the photographed book's own crease, 12% in from the left. This book's gutter is in
   the middle, and two creases read as a mistake.
3. **Atlas.** Page art on top, a strip of page-block striations underneath, in one texture.
4. **Geometry.** Cover boards, a page block, and a page surface that dips into the gutter.

## Things that were not obvious

- **Winding.** glTF front faces are counter-clockwise seen from the outside. The first box had its top
  face wound clockwise and vanished completely under backface culling, which looks exactly like a model
  that failed to load. `check.mjs` now tests every triangle against its own normal.
- **The page is unlit** (`KHR_materials_unlit`) because it is printed artwork — shading it as a surface,
  on top of the lighting already baked into the illustration, is what makes a book read as a photo of a
  book. The consequence is that the modelled fold casts **no shading at all**: the gutter has to be
  painted into the texture, and it has to both darken (the valley) and brighten (the pages lifting
  either side), or it reads as a smudge down the middle of the art.
- **Compositing is done arithmetically**, not with sharp's blend modes. Measured against a build with
  the gutter switched off, `multiply` + `screen` put the darkest point 20px off-centre and left a pair
  of bands down the page instead of one crease.
- **Alpha.** The page art's top face is `BLEND`, not `OPAQUE`: the source PNG has a transparent border
  and `OPAQUE` fills it solid black.
