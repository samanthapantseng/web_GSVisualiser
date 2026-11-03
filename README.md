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
| `F` | switch between walk and orbit; in orbit, drag to turn, scroll to zoom, right-drag to pan |
| `R` | back to the opening pose |
| `H` | show or hide the readout |

Walk mode takes pointer lock when the browser allows it, and falls back to
look-while-dragging when it does not — inside an iframe, for example.

Keystrokes carrying cmd, ctrl or alt are ignored, so system and browser
shortcuts do not drive the camera. Shift is deliberately unbound for the same
reason.

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
src/style.css
public/data/       the .spz
```
