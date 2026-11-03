# web_GSVisualiser

A Gaussian splat scan of a VBZ Flexity tram, navigable in an ordinary browser.
Built for a demo: someone at VBZ is sent a link, opens it on a laptop or a
phone, and can turn the vehicle over and walk through it without installing
anything.

Clickable compartments — a second scan of an opened panel fading in where the
closed one was — are the point of the exercise and are **not** in yet. This is
the viewer they will hang off.

## Run it

```
npm install
npm run dev
```

Then open <http://localhost:5175>. The dev server also listens on the LAN, so
a phone on the same wifi can open `http://<your-ip>:5175` — worth doing early,
because the phone is where the budget problem below shows up first.

## Navigating

| | |
|---|---|
| drag | orbit |
| scroll | zoom, towards the pointer |
| right-drag | pan |
| **F** | walk mode — mouse-look, `WASD`, `E`/`space` up, `Q`/`shift` down |
| **R** | back to the opening frame, and back to orbit |
| **H** | frame rate and splat count |

The tram stays upright. OrbitControls pins the camera's own up to +Y, so the
vehicle never rolls, and `pitchRange` stops the orbit at the horizon so it
cannot carry on underneath and round the other side — which is what made it
look as though the tram had tipped over. The default range is 0° to 70° above
the horizon; `?minPitch=-20` lets you get under the bogies if an engineering
question ever wants it.

Walk mode takes the pointer when it can. Embedded in an iframe it cannot —
pointer lock is refused across documents — so it falls back to look-while-
dragging, which is worse but works.

## The capture

`public/data/flexity_tram.spz`: 6,246,086 splats, 86 MB, no spherical
harmonics, measuring **43.0 × 3.6 × 2.8 m** — length, height, width: a
Flexity, life-sized, so the
viewer leaves its scale alone (`worldHeight: 0`) and one data unit is one
metre.

It is **−y up**, the usual INRIA/COLMAP convention and the same as the bubble
and the earlier tram.

Two wrong answers preceded that one, and they failed differently — which is the
useful part, because each compartment scan will arrive needing the same two
checks.

`+z` laid the tram on its side. **The extent catches that.** A Flexity is
42.9 m long, 2.4 m wide and 3.6 m high; under `+z` the capture measured
43.0 × 2.8 × 3.6 with the 3.6 across its *width*. Height and width had
swapped places.

`+y` put the height back where it belonged — 43.0 × 3.6 × 2.8 — and stood the
tram on its roof. **The extent cannot catch that at all**, because an upright
capture and an inverted one have identical bounds. Only looking does: seats
resting on the floor rather than hanging off the ceiling, and the blue skirt
of the livery along the bottom rather than the top.

So: the extent settles which axis is up, whenever the thing scanned has known
dimensions. Looking settles up from down. Run both.

Standing −Y up is a 180° rotation about Z, so the tram also faces the other way
along X. Nothing depends on that yet; `?heading=` aims it when something does.

### Its origin

The file carries a deliberate origin and the viewer keeps it: `origin: "data"`
leaves the capture exactly where the file puts it, so a coordinate read off the
viewer is a coordinate in the scan. That matters for what comes next — the
compartment boxes get written in these numbers, and they stay meaningful back
in the scanning software.

Measured against it, the capture's centre is at **(18.97, 1.45, −0.04) m**. So
the origin sits at one end of the vehicle, on its lateral centreline to within
4 cm, and at floor level — 0.35 m above the lowest splat, 3.25 m below the
highest. Deliberate, in other words, and worth keeping.
`?axes=1` draws it: red +x, green +y, blue +z, two metres each.

That makes it a fine thing to measure from and a bad thing to pivot a camera
around: orbiting about the end of the tram swings forty metres of vehicle
through an arc. So the two are separate settings. `origin` decides where the
capture sits; `pivot` decides what the orbit turns around, and defaults to the
middle of the capture. `?pivot=origin` swaps it if you ever want to see the
file's origin directly.

## Tuning

Everything in `src/scene.js` can be overridden from the query string, so a
framing or an up axis is found live and only then baked in:

```
?upAxis=-z&heading=90           stand it up differently
?distance=1.3&elevation=5&azimuth=90   broadside, further out
?walkSpeed=3&lookSpeed=0.004    faster walk mode
?minPitch=-20&maxPitch=85       how far under and over the orbit may go
?pivot=origin                   turn around the file's origin, not the middle
?splatBudget=500000             a flat budget; 0 restores Spark's own tiering
?lodScale=0.5                   same, as a multiplier — the one to sweep
?lodRenderScale=3               skip splats under 3 pixels; often invisible, cheaper
?axes=1                         draw the world origin
?fpsLog=1                       frame timing on the console
```

`distance` is a multiple of the reach at which the whole capture just fills the
frame — the controls fit the box's eight corners against the window's own field
of view, so the opening shot is right on a laptop and on a phone held upright.
A narrow window also swings the view towards end-on by itself, because
forty-three metres laid across a portrait screen is either tiny or clipped;
`?azimuth=` overrides that. The framing is computed once, at load: rotating the
phone afterwards does not re-frame, but **R** does.

## What it costs to draw

The level-of-detail tree picks **2,500,000 splats per frame** out of the file's
6.2M (`splatBudget` in `src/scene.js`), and holds 100–120 fps doing it.

1M was tried first and looked it. The arithmetic is unkind: a forty-three metre
tram across a laptop screen is a couple of thousand pixels for the whole
vehicle, so the tree thins the capture hard, and the bodywork goes grainy well
before anything else does. 2.5M is where it holds together.

`splatBudget: 0` means "leave Spark's own default alone", which is tiered by
platform — 2.5M on desktop, 1–1.5M on mobile, 500–750K in a headset. **Worth
switching to before the link is tested on a phone**, since a flat 2.5M asks a
handset for what a laptop gets. On a desktop the two are the same number.

If it ever needs to come down, `lodScale` is the multiplier to sweep, and
`lodRenderScale` is the cheaper lever: raising it towards 3–5 drops splats too
small to see, which Spark's own note calls often indistinguishable.

## Hosting

`.github/workflows/deploy-pages.yml` builds and publishes to GitHub Pages on
every push to `main`. Nothing is deployed until that first push.

**The 86 MB file is the thing to watch.** It is under GitHub's 100 MB per-file
hard limit, but not by much, and it is the whole demo's weight:

- every visitor downloads all 86 MB before seeing anything
- Spark then spends **9–21 seconds** building the level-of-detail tree, on a
  laptop — this is CPU-bound and a phone will be worse
- git keeps every version of it for ever, so a re-export doubles the repo

None of that is fatal for a demo sent to one person. All of it gets better with
a decimated capture: the LOD pyramid the scan was exported as already has
levels at half and a quarter of the splats, and 1.5–2M splats would cut the
download and the tree build by roughly four with very little visible loss at
the distances this viewer is used from. Worth doing before the link goes out
widely.

## Layout

```
index.html         three divs: canvas, loading overlay, readout
src/main.js        picks the capture, starts the viewer
src/scene.js       the capture's own facts — url, up axis, framing
src/viewer.js      renderer, Spark, up-axis correction, fitWorld, frame loop
src/controls.js    orbit and walk modes over one camera
src/loader.js      the two-phase loading wheel (ported from vr_GSVisualiser)
src/style.css
public/data/       the .spz
```

## Lineage

The up-axis correction, `fitWorld`, the loading wheel and the scene-table
discipline come from
[vr_GSVisualiser](https://github.com/samanthapantseng/vr_GSVisualiser); the
orbit-and-reset shell comes from the ThreeJS_Gaussian_Splat visualiser. The
headset rig, the soundscape and the gaze-pitch locomotion are gone, and
mkkellogg's renderer was passed over for Spark because 6.2M splats need a
level-of-detail tree.

## Next

1. Register `VBZ_DriverPanel` and `VBZ_BackPanel` against this capture — they
   are separate sessions with their own origins, so this is a manual alignment
   and the biggest unknown left.
2. Compartment hotspots: `SplatMesh.raycast()` for the hit, named boxes for the
   region.
3. The opening effect: fade the base capture's splats out inside the
   compartment box while the opened scan fades in, so the closed panel is not
   still sitting there behind it.
