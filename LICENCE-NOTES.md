# Licence notes: oil paint

Code MIT. Art CC0 1.0. Checked 2026-11-11 for Patch's parts; the rows for this repository's own parts were added and checked 2026-11-24.

| Part | Where it came from | Licence | In this repo? |
|---|---|---|---|
| `src/hwadam/data/` (the ground's heights `near.bin` and the real skyline `horizon.bin`) | Terrain Tiles on AWS Open Data (Tilezen / Mapzen), baked by `tools/fetch-dem.mjs`. Source data SRTM and GMTED2010 (each tile's header is checked; `meta.json` lists them per band). Credit: "global GMTED2010 and SRTM terrain data courtesy of the U.S. Geological Survey" | Public domain (SRTM and GMTED2010, U.S. Government work) | Yes |
| `src/hwadam/` (the Hwadam walk: the four stretches of the way, moss, maples, birches, the ridge view, the hiker's clothes) | Written for this repository, starting from a copy of Patch's autumn scene. Every stroke is made in code; no picture or model is loaded for it | MIT; what it draws CC0 | Yes |
| `src/hwadam/data/way.json` | The walked way, made by `tools/make-way.mjs` as a least-cost path over the heights. Its centre is one point of OpenStreetMap way 486063098 | ODbL for that point: © OpenStreetMap contributors | Yes |
| `lib/block-shim.js`, `tools/fetch-dem.mjs`, `tools/make-way.mjs`, `tools/horizon-layers.mjs`, `tools/fetch-upstream.mjs`, `tools/with-gpu-lock.sh`; the changes to `src/boot.js`, `src/scenes.js`, `src/figure/figure.js`, `index.html` and the capture tools | Written for this repository | MIT | Yes |
| `shots/hwadam-*.jpg` | Stills of the Hwadam walk, captured from this repository | CC0 1.0 | Yes |
| `src/oilpaint/` (dabs, brush, ground, pins, shade, canvas) | Written by Patch for this block | MIT | Yes |
| `src/world/` (land, floor, trees, sky, leaves) | Written by Patch for this demo. Every tree, leaf and brush mark is made in code; no picture or model is loaded for them | MIT; what it draws CC0 | Yes |
| `src/night/` (the ridge, snow, spruces, sky and aurora, water and ranges, the cabin and all in it, the lantern, tracks, snow in the air) | Written by Patch for this demo. Every stroke of it is made in code; no picture, model or sound is loaded for it | MIT; what it draws CC0 | Yes |
| `src/scenes.js`, `src/boot.js`, `src/world/noise.js` | Written by Patch for this demo | MIT | Yes |
| `src/figure/cloak.js`, `figure.js`, `camera.js` | Written by Patch for this demo | MIT; what it draws CC0 | Yes |
| `src/figure/man.js`, `animator.js`, `player.js`, `input.js`, `hands-anymove.json` | Patch's starter man (patch-lab, `starter-character-combined`), copied with three small changes: the three.js import, a loading-progress callback, and a caught pointer-lock refusal | CC0 1.0, Patch | Yes |
| `public/figure/starter-man.glb` | Patch's starter man: built with MPFB2 from MakeHuman system assets (the body, `male_casualsuit06`, `shoes05`, `short01` hair), rigged by Patch onto the Universal Animation Library's skeleton. Its pictures are taken out here, since the demo paints him | CC0 1.0 (MakeHuman's system assets are released as CC0) | Yes |
| `public/figure/starter-man-clips.glb` | Quaternius' Universal Animation Library 1 and 2 (idle, walk, jog, strafes, turns, jumps), and Patch's own clips made with anymove (run, sprint, starts, stops, the tired idle). The file is rewritten by `tools/compact-glb.mjs`, which leaves out data no clip reads; the clips themselves are unchanged, byte for byte | CC0 1.0 (Quaternius); CC0 1.0, Patch | Yes |
| `src/figure/rapier/` | Rapier 0.21.0, `@dimforge/rapier3d-compat`, as vendored in patch-lab | Apache-2.0, `src/figure/rapier/LICENSE`, shipped as `RAPIER-LICENSE.txt` | Yes |
| `lib/patch-block.js` | Patch's block helper, from staging.patch.gg/patch-block.js | No licence is stated for it | No. `lib/block-shim.js`, written for this repository, stands in for it |
| `shots/` | Stills of this demo | CC0 1.0, Patch | Yes |
| `src/travel/` (the map start screen, the walk's HUD, the mist at the boundary) and `src/hwadam/world/bake.js`, `place.js`, `src/hwadam/start-panel.js` | Written for this repository | MIT | Yes |
| maplibre-gl 6.17.0 (the map, lazy-loaded) | npm, pinned exactly (published 2026-11-07, two weeks before the pin) | BSD-3-Clause | Installed by npm; its licence ships in `node_modules` |
| OpenFreeMap map style and vector tiles (`https://tiles.openfreemap.org/styles/liberty`) | OpenFreeMap, no key; loaded at run time, not stored | Tiles from OpenMapTiles and OpenStreetMap data (ODbL): © OpenStreetMap contributors, © OpenMapTiles, OpenFreeMap | No, loaded at run time. Attribution is on the map |
| OpenFreeMap vector tiles for the land cover of a place (`?place=`, T2): water, landcover, landuse and building layers, rasterised to a 512 m square at run time | OpenFreeMap, no key; read at run time, not stored | Tiles from OpenMapTiles and OpenStreetMap data (ODbL): © OpenMapTiles © OpenStreetMap contributors | No, read at run time. Its classes are kept only as the 256 x 256 cover grid of the page |
| `@mapbox/vector-tile` 2.0.5 and `pbf` 4.0.2 (decode the tiles; the decoder is loaded only for a place) | npm, pinned by the lockfile | BSD-3-Clause | Installed by npm; licences ship in `node_modules` |
| Place search (`nominatim.openstreetmap.org`) | OpenStreetMap Nominatim, one query per submitted search; no autocomplete | ODbL: © OpenStreetMap contributors | No, a query at run time. Its answer is not stored |
| Terrain for any place picked at run time (`?place=`) | AWS Terrain Tiles, the same tiles as the baked data; each tile's imagery source is checked (SRTM or GMTED2010 only) and not stored | Public domain (SRTM, GMTED2010); see the attribution list in `public/CREDITS.md` | No, read at run time. Its output is not stored |
| three.js 0.186.1 | npm | MIT | Installed by npm; its notice ships as `THIRD-PARTY-NOTICES.md` |

No picture is stored or copied, and there is no sound. The Hwadam walk is an impression of a real arboretum, not a copy of it: no photograph, logo or map of the place was used, and the way does not follow its real paths. The aurora scene began from one photograph its author showed as a mood: a small figure with a light under a snowy peak and a green aurora. Nothing of that photograph is in the repo, and its place was not reproduced: the ridge, the horns, the fjord, the cabin and the sky here are this demo's own, made in code.

**Nothing here has no stated source.**
