# web_GSVisualiser

A browser viewer for a Gaussian splat capture, built on three.js and
[Spark](https://sparkjs.dev/).

Desktop only. It assumes a mouse, a keyboard and a WebGL2 context, and is not
built for phones or tablets.

## Run

```
npm install
npm run dev
```

<http://localhost:5175>. `npm run build` writes a static site to `dist/`.

## Controls

Opens standing inside the capture, in walk mode.

| | |
|---|---|
| drag | look around |
| `W` `A` `S` `D` | walk; `E`/`space` up, `Q`/`C` down |
| double-tap `W` | run, while forward is held — 3x walking pace |
| `F` | switch between walk and orbit; in orbit, drag to turn, scroll to zoom, right-drag to pan |
| `R` | back to the opening pose |
| `H` | show or hide the readout |
| click a circle | open the detail capture behind it |
| `Esc` | close it again |
| `1`–`9` | toggle an overlay directly (by position in `overlays.config.json`) |
| `0` | toggle every overlay |
| `M` | base cutout on/off — debug |
| `G` | show the occupied mask cells — debug, desktop only |
| `[` `]` | shorter / longer fades |

Looking around requires holding the primary mouse button. There is no pointer
lock, deliberately: it would let the view follow the mouse for as long as the
lock was held, with nothing on screen to say so, and full screen makes that
worse rather than better — no window edge to escape to, so a page that looks
still is turning with every stray movement of the hand. Dragging costs some
reach and gives back the thing that matters, which is that the camera only
moves when you ask it to.

Keystrokes carrying cmd, ctrl or alt are ignored, so system and browser
shortcuts do not drive the camera. Shift is deliberately unbound for the same
reason.

Walk mode has solid walls — see **Collision** below. Double-tapping forward
runs at three times walking pace — 1.4 m/s is right for
looking at something and slow for crossing forty-three metres of it. The run
lasts only while forward is held, so it cannot be left switched on, and the
readout says `running` while it is active.

## Configuration

`src/scene.js` holds everything specific to the capture. Every field can be
overridden from the query string, so a value can be found on a running page
and then written into the file.

| field | query | meaning |
|---|---|---|
| `url` | `?url=` | path to the `.spz`, relative to `public/` |
| `upAxis` | `?upAxis=` | which data axis is up: `+x` `-x` `+y` `-y` `+z` `-z` |
| `heading` | `?heading=` | degrees of yaw after the up-axis correction |
| `worldHeight` | `?worldHeight=` | scale so the capture is this many metres tall; 0 keeps its own scale |
| `origin` | `?origin=` | `data` keeps the file's origin as the world origin; `floor` recentres the capture |
| `pivot` | `?pivot=` | what the orbit turns around: `centre` or `origin` |
| `pitchRange` | `?minPitch=` `?maxPitch=` | degrees above the horizon the orbit may reach |
| `start.mode` | `?start=` | `pov` opens inside, `orbit` opens outside |
| `start.eyeHeight` | `?eyeHeight=` | lifts the opening eye above `start.position` |
| `collision` | `?collide=0` | solid walls in walk mode; on by default |
| `collisionCell` | `?collisionCell=` | occupancy grid resolution, metres |
| `collisionThreshold` | `?collisionThreshold=` | small splats per cell before it counts as solid |
| `wallMargin` | `?wallMargin=` | how far inside the capture's bounds walking is held |
| `openings` | — | boxes where the collision grid is ignored |
| `sprintMultiplier` | `?sprint=` | how much faster a double-tapped forward runs |
| `doubleTapMs` | `?doubleTapMs=` | how close the two taps must be |
| `start.position` | `?from=x,y,z` | where the opening eye stands (before `eyeHeight`) |
| `start.lookAt` | `?to=x,y,z` | what it looks at (before `eyeHeight`) |
| `framing` | `?distance=` `?elevation=` `?azimuth=` | the orbit opening shot |
| `extEncoding` | `?ext=0` | extended splat encoding (see below); on by default |
| `sortRadial` | `?sortRadial=0` | sort by Z-depth instead of radial distance |
| `splatBudget` | `?splatBudget=` | splats per frame while moving; 0 uses Spark's own default |
| `idleSplatBudget` | `?idleSplatBudget=` | splats per frame once still; 0 disables refinement |
| `idleDelay` | `?idleDelay=` | seconds of stillness before refining |
| `lodScale` | `?lodScale=` | multiplier on that budget |
| `lodRenderScale` | `?lodRenderScale=` | minimum on-screen splat size, in pixels |
| `maxFps` | `?maxFps=` | ceiling on redraws per second |
| `pixelRatio` | `?pixelRatio=` | cap on device pixels per CSS pixel |
| — | `?always=1` | redraw every frame instead of on change |
| — | `?axes=1` | draw the world origin |
| — | `?fpsLog=` | seconds between frame-timing lines on the console |

## Performance

The scene is static, so **the viewer redraws only when something changes** —
the camera moved, Spark's level-of-detail tree streamed in new splats, or the
window resized. A still view costs nothing: zero draw calls, idle GPU. This is
the difference between a warm laptop and a hot one, and the readout shows
`idle` rather than a frame rate when it applies.

Because a still frame is drawn once and then costs nothing to keep on
screen, the viewer **spends the saving on detail**: after `idleDelay` seconds
without movement the level-of-detail budget climbs from `splatBudget` to
`idleSplatBudget`, the tree descends deeper into the capture, and one
expensive frame is drawn. Any movement drops it straight back.

Measured: **2,500,000 splats while moving**, rising once still to
**5,241,512 inside the vehicle** or **2,903,351 from outside it** — nine
rendered frames to get there, so the transition reads as a flicker of
sharpening rather than a stall.

The idle budget is set above the 7.74M the tree holds, so it is not really a
budget; what the tree actually takes is bounded by `lodRenderScale`, which
stops it descending into splats smaller than a pixel. That is why the two
figures above differ: close up there is a great deal more worth drawing, and
from across the street the capture is already finer than the screen.

**Stillness is measured with a tolerance, and has to be.** `OrbitControls`
damping decays asymptotically and never reaches zero, so a compared-exactly
camera goes on twitching in its last floating-point bits for ever — the view
never counts as still, never refines, and never stops redrawing. The
thresholds in `src/viewer.js` are the library's own (`_EPS`, a millimetre of
travel and under a pixel of rotation), measured against the last frame drawn
rather than the last animation frame.

Levers, in the order worth reaching for:

| | |
|---|---|
| `maxFps` | 60 by default. A static scene gains nothing from 120 beyond smoother dragging. |
| `pixelRatio` | 2 by default. Cost scales with its square, so 1.5 is a large saving and 1 a larger one. |
| `splatBudget` | 2,500,000 by default, while moving. Below about 1M the bodywork visibly thins. |
| `lodRenderScale` | 1 by default. Towards 3–5 it skips splats too small to see. |

Measured: about 70 redraws per second while moving through the interior,
100–120 from outside. Interiors cost more because splats are fill-bound and a
corridor puts the whole capture on screen at close range.

**Frame counters inside an embedded preview pane are meaningless.** One will
report 1 fps on a renderer spending 0.1 ms per frame, because the pane runs
`requestAnimationFrame` at a trickle while `document.hidden` stays `false`.
Read the frame rate in a real browser tab. `window.__gs` exposes the renderer,
camera, scene, SparkRenderer and the `invalidate()` hook for measuring
directly — `renderer.info.render.frame` counts actual draws, and
`window.__gs.state` reports whether the view is currently refined.

## Collision

Walking is blocked by the vehicle, rather than passing through it. Two
mechanisms, because neither is sufficient alone:

**An occupancy grid**, built from the capture once it has loaded. The world is
divided into 0.2 m cells and a cell holding at least `collisionThreshold`
small splats counts as solid; everything else is air. Since splats describe
surfaces, the aisle stays walkable while the bodywork, partitions, seats,
floor and ceiling do not. It needs no authoring and it knows about the
interior, not just the shell. Built in ~50 ms: 217 × 20 × 16 cells, 19% solid.

Only *small* splats count. The level-of-detail tree carries merged parent
splats metres across — the first in this capture is 12.8 m long — and one of
those in a cell would wall off the whole saloon.

**An outer hull**, the capture's own bounds pulled in by `wallMargin`. The grid
cannot be trusted on its own because **glass leaves no splats**: the windows
here are black rectangles with nothing behind them, so to the grid a window is
a doorway. Before the hull was added, strafing sideways from the aisle put the
camera at z = 4.18 m — outside a vehicle 2.8 m wide.

Movement resolves one axis at a time, so walking into a wall at an angle slides
along it rather than stopping dead, and a blocked axis loses its velocity so
pushing into a wall does not store up speed. A camera that somehow ends up
inside solid geometry is not blocked at all, so it can never be trapped.

**Openings** are boxes where the grid is ignored, for doors people are meant
to go through. The grid knows only what the scan saw, and what it saw of the
cab doorway was a 35 cm slot offset 40 cm from the centreline — passable in
principle, impossible to find by walking at it. `openings` in `src/scene.js`
states the doorway outright; the numbers came from probing the grid with
`window.__gs.bounds.solidAt(x, y, z)`.

The limits are otherwise only as good as the scan: a gap it did not resolve is
a gap you can walk through, and a closed door it did resolve is a wall.
`?collide=0` turns the whole thing off and restores free roaming.

### Checking collision

Probe the grid directly rather than trying to walk into things:

```js
window.__gs.bounds.solidAt(x, y, z)   // true where walking is blocked
```

Walk-based tests are unreliable in an embedded preview pane. Simulated time
advances only when `requestAnimationFrame` fires, and a throttled pane delivers
frames in bursts with a tiny delta — holding forward for three seconds can
advance the camera 0.1 m and look exactly like a wall.

## The capture

`public/data/flexity_tram.spz` — SPZ v4, 6,246,086 splats, 86 MB, no spherical
harmonics. Extent **43.0 × 3.6 × 2.8 m**, metric, so `worldHeight` is 0 and one
data unit is one metre.

**Up axis.** `-y`. Two checks settle this for any capture, and they catch
different errors:

- *The extent* catches a capture lying on its side, whenever the subject has
  known dimensions — here a wrong axis put the height across the width.
- *Looking at it* catches a capture standing on its head, which the extent
  cannot: an upright capture and an inverted one have identical bounds.

**Precision falls off with distance from the origin.** Spark's compact
default encoding stores splat centres as half floats, so the quantisation step
is relative to the size of the coordinate, not the distance from the camera.
Measured on this capture:

| distance from origin | position grid |
|---|---|
| 2 m | 0.98 mm |
| 35 m | 31.25 mm |

Both are exact powers of two, which is the half-float signature. At the far end
of a forty-three metre vehicle that snapped every splat centre onto a
three-centimetre lattice: posters there smeared into stripes and their text
became unreadable, while the identical posters by the door stayed sharp.

`extEncoding: true` loads the capture with Spark's extended encoding instead,
which puts the grid at 0.004 mm throughout. Roughly double the position memory,
no measurable change in frame time or LoD build time. `?ext=0` shows the old
behaviour.

Note that this is a property of the viewer's encoding, not of the capture: the
scan's own fine-detail density is near-uniform along the vehicle (86% of splats
under 2 cm at the origin end, 83% at the far end, with the *middle* the
coarsest at 68%).

**Origin.** The file carries a deliberate origin and `origin: "data"` keeps it,
so viewer coordinates are file coordinates. The capture's centre measures
(18.97, 1.45, −0.04) m against it, which puts the origin at one end, on the
lateral centreline, at floor level. `?axes=1` draws it.

**Opening pose.** `start.position` is the origin, `start.lookAt` is 40 m along
`+x`, which is down the length of the capture. `eyeHeight` is 1.6 m and has to
be non-zero: at the origin exactly the camera sits inside the floor, and the
level-of-detail tree resolves that by drawing a single enormous splat — a grey
screen reading `1 of 6,246,086`. `?eyeHeight=0` reproduces it.

## Overlays and the base cutout

A circle on the capture means there is more here than the scan in front of you
shows. Clicking one lays a second capture over the spot it belongs to — the cab
ceiling hatch, scanned again with the panel open — and hides the base splats
underneath it so the two do not blend into a double image.

The hiding is automatic. Nothing is measured by hand and no boxes are placed:
`npm run build:masks` reads each overlay capture, puts every splat centre
through that overlay's world transform, and marks the cells of a shared
occupancy grid. At runtime a Spark `worldModifier` on the base capture reads
that grid once per splat and multiplies the splat's alpha down by however
visible the overlays occupying its cell are. Fading an overlay in therefore
fades the base out underneath it, in the same frame and from the same number,
which is what keeps a crossfade from flashing a hole or a double image.

### Rebuilding the mask

```bash
npm run build:masks
```

Run it whenever anything in `overlays.config.json` changes — a placement, a
capture, a grid setting. The mask is baked against the transforms in that file,
and a mask baked for one placement and drawn against another misaligns
silently: the symptom is base splats bleeding through one edge of the overlay,
which looks like a dilation problem rather than the stale file it is. The
loader refuses a mask whose overlay list no longer matches the config, but it
cannot detect a moved overlay — so rebuild.

### Tuning

| in `overlays.config.json` | what it does |
|---|---|
| `cellSize` (0.08 m) | grid resolution. Finer gives a cleaner cut edge and costs memory as the cube of itself. |
| `dilation` (2 cells) | how far the cut grows outward. Raise it if coarse distant LoD splats bleed past the edge — those are merged parents metres across, standing in for a whole region, and their centres sit outside the capture. |
| `minOpacity` (0.05) | splats fainter than this do not cut. The haze a close-range capture leaves around itself. |
| `minCellSplats` (25) | splats a cell needs before it counts. **The knob that decides whether the cut is the thing you scanned or the room around it.** |

`minCellSplats` is worth understanding before you change it. A detail capture
is never only its subject: this one carries the hatch, the panel hanging open
below it, and a halo of thin, sparse, badly reconstructed surroundings. With no
threshold the cut is a block 2.8 x 2.6 x 3.0 m reaching from the roof down past
the driver's seat. Asking for a couple of dozen splats per cell drops the haze
and keeps the panel, because a real surface puts dozens of splats through an
8 cm cell and haze puts one or two. The builder prints the world-space box each
overlay ends up cutting — read it, and if it reaches somewhere it should not,
that is the number to raise.

`?softCut=1` feathers the cut edge by averaging over a cell and its six
neighbours. Seven texture fetches per splat instead of one, so it is off by
default; the difference only shows at a cell boundary.

### Placement

`overlays.config.json` is the single source of truth for where each overlay
sits. `src/scene.js` names the hotspot that opens it and refers to it by id.
Both the runtime and the mask builder read the config, deliberately — a
transform written down twice is a transform that drifts.

To fit a new capture, open `?align=<overlay id>` and move it until it lands.
The keys are in the panel; `P` copies the block to paste back into the config.
Align mode turns the base cutout off while it runs, because you cannot fit a
detail capture onto a hatch that has been erased from the vehicle — and because
every nudge makes the baked mask wrong. Rebuild the mask afterwards.

### Baking the cut for production

A splat hidden by the runtime cutout is at zero alpha, not gone: the
level-of-detail tree still selects it, Spark still sorts it, the GPU still
rasterises it. That is invisible on a desktop and it is budget spent on nothing
in a headset.

Once a layout has stopped moving, mark the permanent overlays `"bakeCut": true`
and run:

```bash
npm run bake:base
```

It writes a new `.spz` beside the original — never over it — with those splats
deleted. On this capture that is 117,750 of 6.2M, about 1.9%. An overlay that
can still be faded out must *not* be baked: closing it would leave a hole.

This does not produce a `.rad`. Spark's `build-lod` lives inside Spark's own
repository and the published package exposes no `bin`, so there is nothing here
to call — and nothing to miss, because `src/viewer.js` loads with `lod: true`
and Spark builds the tree in a worker at load time from whatever `.spz` it is
given.

### Reading an .spz outside the browser

Both tools need Spark's decoder, and Spark decodes in a `Worker` that Node does
not have. `tools/lib/node-worker-shim.js` bridges the two APIs — Spark's worker
body is a plain IIFE with no DOM in it, so the gap is only message plumbing.
Install it before importing Spark.

## Deployment

`.github/workflows/deploy-pages.yml` builds and publishes to GitHub Pages on
every push to `main`.

The 86 MB capture is the constraint. It is under GitHub's 100 MB per-file
limit, but every visitor downloads all of it before seeing anything, Spark
then spends 8–20 seconds building the level-of-detail tree, and git keeps
every version of the file forever. A decimated capture cuts the download and
the tree build roughly in proportion to the splat count.

## Layout

```
index.html         canvas, loading overlay, readout
src/main.js        entry point
src/scene.js       everything specific to the capture
src/viewer.js      renderer, Spark, up-axis correction, fit, frame loop
src/controls.js    walk and orbit modes over one camera
src/loader.js      two-phase loading wheel
src/hotspots.js    the clickable circles, and whether one is in sight
src/align.js       authoring tools: ?pick=1 and ?align=<id>
src/overlay/       detail captures
  OverlayManager.js  the overlays, their fades, and the cutout they drive
  baseCutoutModifier.js  the Spark worldModifier that hides base splats
  maskLoader.js      the baked grid, as a Data3DTexture
  placement.js       one reading of an overlay transform, shared with the tools
  overlayInput.js    named actions, and the keys bound to them
src/debug/maskDebugView.js   the occupied cells, drawn (G)
src/style.css
tools/build-overlay-masks.js  bake the cutout mask
tools/bake-base-cut.js        delete permanently hidden base splats
tools/lib/node-worker-shim.js enough Worker for Spark to run under Node
overlays.config.json          where each overlay sits; read by both sides
public/data/       the .spz
public/masks/      the baked occupancy mask
```
