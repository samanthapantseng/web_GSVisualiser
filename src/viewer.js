import * as THREE from "three";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";
import { createLoadingWheel } from "./loader.js";
import { createControls } from "./controls.js";
import { createHotspots } from "./hotspots.js";
import { createOverlayManager } from "./overlay/OverlayManager.js";
import { createMaskDebugView } from "./debug/maskDebugView.js";
import { bindKeyboard, overlayActions } from "./overlay/overlayInput.js";
import { createAligner, createPicker } from "./align.js";

// ---------------------------------------------------------------------------
// The viewer. One capture, handed in from src/main.js.
//
// Tunables come from the scene entry first and the query string second, so a
// framing or an up axis can be found live (?upAxis=-z&heading=90) and only
// then baked into src/scene.js.
// ---------------------------------------------------------------------------

export function startViewer(scene) {
    const params = new URLSearchParams(location.search);

    // "12,1.6,-0.4" to [12, 1.6, -0.4]; anything malformed is ignored.
    function vec(text) {
        if (!text) return null;
        const parts = text.split(",").map(Number);
        return parts.length === 3 && parts.every(Number.isFinite) ? parts : null;
    }

    function num(name, fallback) {
        const value = parseFloat(params.get(name));
        return Number.isFinite(value) ? value : fallback;
    }

    const CONFIG = {
        url: params.get("url") || scene.url,
        // Which axis of the splat data points up. A capture that comes in
        // tilted is rotated here rather than at the camera, so that world up
        // stays +Y for everything downstream — the orbit poles, the walk
        // mode's rise and sink, and eventually the compartment boxes.
        upAxis: params.get("upAxis") || scene.upAxis || "+y",
        heading: num("heading", scene.heading ?? 0),
        // The capture is scaled so its full vertical extent spans this many
        // metres. 0 skips rescaling and treats one data unit as one metre.
        worldHeight: num("worldHeight", scene.worldHeight ?? 0),
        // "data" keeps the file's own origin as the world origin; "floor"
        // recentres the capture on it instead. See src/scene.js.
        origin: params.get("origin") || scene.origin || "floor",
        // What the orbit turns around: "centre" of the capture, or the file's
        // "origin". Independent of where the capture sits.
        pivot: params.get("pivot") || scene.pivot || "centre",

        // Where the viewer opens — a first-person pose or an orbit framing.
        // See src/scene.js.
        start: {
            mode: params.get("start") || scene.start?.mode || "orbit",
            // ?from=x,y,z and ?to=x,y,z stand the camera somewhere specific
            // and point it somewhere specific, in world metres. For getting
            // back to a spot that looked wrong without walking there.
            position: vec(params.get("from")) ?? scene.start?.position ?? [0, 0, 0],
            lookAt: vec(params.get("to")) ?? scene.start?.lookAt ?? [1, 0, 0],
            // Lifts the eye and what it looks at by the same amount, so the
            // view stays level. ?eyeHeight=1.6 stands the visitor up.
            eyeHeight: num("eyeHeight", scene.start?.eyeHeight ?? 0),
        },

        framing: {
            distance: num("distance", scene.framing?.distance ?? 0.85),
            elevation: num("elevation", scene.framing?.elevation ?? 22),
            azimuth: num("azimuth", scene.framing?.azimuth ?? 35),
        },

        // Degrees above the horizon the orbit may reach. The floor of this is
        // what holds the tram upright — see src/scene.js.
        pitchRange: [
            num("minPitch", scene.pitchRange?.[0] ?? 0),
            num("maxPitch", scene.pitchRange?.[1] ?? 70),
        ],

        // Walk mode. Metres per second at full push, and the ramp that gets
        // there; 1.4 m/s is a walking pace, which is the right speed for a
        // vehicle you are inspecting rather than crossing.
        walkSpeed: num("walkSpeed", scene.walkSpeed ?? 1.4),
        accel: num("accel", scene.accel ?? 8),
        lookSpeed: num("lookSpeed", scene.lookSpeed ?? 0.0022),
        // Double-tapping forward runs instead of walking: this multiplies
        // walkSpeed, and doubleTapMs is how close the two taps must be.
        sprintMultiplier: num("sprint", scene.sprintMultiplier ?? 3),
        doubleTapMs: num("doubleTapMs", scene.doubleTapMs ?? 300),
        // How far outside the capture's own bounds walk mode may stray.
        roam: num("roam", scene.roam ?? 8),

        // Solid walls. See buildOccupancy below and src/scene.js.
        collision: params.get("collide") !== "0" && scene.collision !== false,
        collisionCell: num("collisionCell", scene.collisionCell ?? 0.2),
        collisionThreshold: num("collisionThreshold", scene.collisionThreshold ?? 4),
        // Splats larger than this are not evidence of a surface: the
        // level-of-detail tree carries merged parents metres across, and one
        // of those in a cell would wall off the aisle.
        collisionMaxSplat: num("collisionMaxSplat", scene.collisionMaxSplat ?? 0.15),
        collisionSamples: num("collisionSamples", scene.collisionSamples ?? 400000),
        // Boxes where the grid is ignored, so a doorway the scan filled in
        // can be walked through. See src/scene.js.
        openings: scene.openings ?? [],
        // How far inside the capture's own bounds walk mode is held when
        // collision is on. The backstop for everything the grid cannot see.
        wallMargin: num("wallMargin", scene.wallMargin ?? 0.25),

        // Render budget: how many splats the LoD tree may hand the GPU per
        // frame. 0 leaves Spark's own per-platform default in place; anything
        // else is a flat count across every device. See src/scene.js.
        splatBudget: num("splatBudget", scene.splatBudget ?? 0),
        // What the budget climbs to once the view stops moving, and the
        // stillness required first. See src/scene.js. 0 disables it.
        idleSplatBudget: num("idleSplatBudget", scene.idleSplatBudget ?? 0),
        idleDelay: num("idleDelay", scene.idleDelay ?? 0.35),
        // Multiplies that count. Left as a separate knob because it is the
        // one to sweep when hunting for the budget, with ?lodScale=0.5.
        lodScale: num("lodScale", scene.lodScale ?? 1),
        // Extended encoding for the splats Spark passes through its own
        // accumulator and pager. Spark's compact default encoding loses
        // precision in proportion to how far a splat sits from the capture's
        // origin, which is exactly the failure this scan would show: its
        // coordinates run from one end of a forty-three metre vehicle to the
        // other, so the far end is quantised far more coarsely than the near
        // end. Spark's own note calls this "large internal position
        // coordinates". ?ext=0 turns it off to compare.
        extEncoding: params.get("ext") !== "0" && scene.extEncoding !== false,
        // How splats are depth-sorted for blending. Spark defaults to radial
        // — geometric distance from the viewpoint — which is stable as the
        // view turns, but most captures are trained against Z-depth, and
        // sorting by a different metric than the one a scene was trained with
        // puts splats in the wrong blend order. 0 selects Z-depth.
        sortRadial: params.get("sortRadial") !== "0" && scene.sortRadial !== false,
        // Minimum on-screen size, in pixels, of a splat the tree will pick.
        // Raising it towards 5 spends nothing on splats too small to see;
        // Spark's own note is that it is often indistinguishable.
        lodRenderScale: num("lodRenderScale", scene.lodRenderScale ?? 1),
        // The export carries shDegree 0, so there is no view-dependent colour
        // to evaluate and nothing to turn down. Kept as a knob for whenever a
        // capture does arrive with harmonics.
        maxSh: num("maxSh", scene.maxSh ?? 0),
        // Redraw only when something has changed — see the frame loop. 1
        // forces a redraw every frame instead, which is what to pass if the
        // view ever goes stale.
        always: params.get("always") === "1",
        // Ceiling on redraws per second while something is changing. The
        // scene is static, so a display offering 120 Hz buys nothing beyond
        // smoother dragging and costs the difference in heat.
        maxFps: num("maxFps", scene.maxFps ?? 60),
        // Device pixels per CSS pixel. Cost scales with the square of this,
        // so 2 on a Retina panel is four times the fill of 1. Dropping to 1.5
        // is the biggest single saving after the two above.
        pixelRatio: num("pixelRatio", scene.pixelRatio ?? 2),
        // Seconds between frame-timing lines on the console; 0 silences them.
        fpsLog: num("fpsLog", 0),
        // Draw the world origin as a set of axes. Off by default — it is a
        // working tool, not part of the demo — but the one way to see where
        // the file's origin actually sits, and what the compartment scans
        // will be aligned against.
        axes: params.get("axes") === "1",

        // The circles. Things in the capture worth a second look, each one a
        // point in world metres and, usually, a second .spz to lay over it.
        // See src/scene.js. ?hotspots=0 takes them away.
        hotspots: params.get("hotspots") === "0" ? [] : (scene.hotspots ?? []),
        // Authoring tools, both off unless asked for. See src/align.js.
        // Seven mask fetches per splat instead of one, for a feathered cut
        // edge. Off by default: it is a Quest-visible cost for a
        // difference you only see at a cell boundary. ?softCut=1.
        softCut: params.get("softCut") === "1",
        pick: params.get("pick") === "1",
        align: params.get("align") || "",
    };

    const statusEl = document.getElementById("status");
    const hudEl = document.getElementById("hud");
    const hudHeadEl = document.getElementById("hudHead");
    const hudDetailEl = document.getElementById("hudDetail");
    const hintEl = document.getElementById("hint");
    const detailEl = document.getElementById("detail");
    const detailTitleEl = document.getElementById("detailTitle");
    const detailNoteEl = document.getElementById("detailNote");
    const detailCloseEl = document.getElementById("detailClose");

    document.title = scene.title;

    // Up before anything is fetched, so the page has an answer on the first
    // frame rather than showing black for the length of an 86 MB download.
    const loadingLabel = scene.loading || `Loading ${scene.title}…`;
    const wheel = createLoadingWheel(statusEl);
    wheel.progress(0, loadingLabel);

    hintEl.innerHTML = scene.hint || "";

    // -----------------------------------------------------------------------
    // Renderer, scene, camera
    // -----------------------------------------------------------------------

    // antialias must be off: WebGL MSAA does nothing for Gaussian splats and
    // costs fill rate, which is the budget that runs out first.
    let renderer;
    try {
        renderer = new THREE.WebGLRenderer({ antialias: false });
    } catch (err) {
        // No context, no scene — and the wheel would otherwise sit at 0% for
        // ever with nothing to say.
        console.error("WebGL unavailable:", err);
        wheel.fail(`Could not start the viewer — ${err.message || err}`);
        return;
    }
    // Splats are fill-bound, so this is a quadratic lever: every extra device
    // pixel per CSS pixel costs its square in fragments.
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, CONFIG.pixelRatio));
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.getElementById("app").appendChild(renderer.domElement);

    const world3 = new THREE.Scene();
    world3.background = new THREE.Color(0x0b0f12);

    const camera = new THREE.PerspectiveCamera(
        60,
        window.innerWidth / window.innerHeight,
        0.05,
        500,
    );
    world3.add(camera);

    // Shared timer, so Spark's time-based work and the controls agree on dt.
    const timer = new THREE.Timer();

    const spark = new SparkRenderer({
        renderer,
        timer,
        accumExtSplats: CONFIG.extEncoding,
        pagedExtSplats: CONFIG.extEncoding,
    });
    // Assigned only when asked for: Spark picks its own per-platform count
    // when lodSplatCount is left undefined, and writing a 0 over it would be
    // read as a budget of none.
    if (CONFIG.splatBudget > 0) spark.lodSplatCount = CONFIG.splatBudget;
    spark.lodSplatScale = CONFIG.lodScale;
    spark.lodRenderScale = CONFIG.lodRenderScale;
    spark.sortRadial = CONFIG.sortRadial;
    world3.add(spark);

    // -----------------------------------------------------------------------
    // The capture, rotated upright and dropped onto the floor
    // -----------------------------------------------------------------------

    const UP_VECTORS = {
        "+x": [1, 0, 0],
        "-x": [-1, 0, 0],
        "+y": [0, 1, 0],
        "-y": [0, -1, 0],
        "+z": [0, 0, 1],
        "-z": [0, 0, -1],
    };

    // Rotation that brings the data's up axis onto world +Y.
    function worldOrientation(upAxis) {
        const axis = UP_VECTORS[String(upAxis).toLowerCase()] || UP_VECTORS["+y"];
        return new THREE.Quaternion().setFromUnitVectors(
            new THREE.Vector3(...axis),
            new THREE.Vector3(0, 1, 0),
        );
    }

    const world = new THREE.Group();
    {
        const orientation = worldOrientation(CONFIG.upAxis);
        if (CONFIG.heading) {
            // premultiply, not multiply: the yaw is about world up, so it has
            // to happen after the data has been stood upright, not before.
            orientation.premultiply(
                new THREE.Quaternion().setFromAxisAngle(
                    new THREE.Vector3(0, 1, 0),
                    THREE.MathUtils.degToRad(CONFIG.heading),
                ),
            );
        }
        world.quaternion.copy(orientation);
    }
    world3.add(world);

    if (CONFIG.axes) {
        // Red is +x, green +y, blue +z, two metres each, drawn at the world
        // origin — which under origin: "data" is the file's own origin.
        world3.add(new THREE.AxesHelper(2));
    }

    // Where the capture sits, in world metres, filled in by fitWorld once its
    // extent is known. The controls hold this by reference, because it is an
    // empty box until the file has loaded.
    //
    // `focus` is what the orbit turns around and what the opening shot is
    // framed on — the middle of the capture or the file's own origin, set by
    // the scene's pivot. Not the same question as where the capture sits:
    // this scan's origin is at one end of the vehicle, so keeping the file's
    // coordinates and pivoting on the middle is the combination that wants.
    // `solidAt(x, y, z)` is filled in by fitWorld when collision is on, and
    // stays undefined when it is off — walk mode treats that as "all air".
    const bounds = { box: new THREE.Box3(), focus: new THREE.Vector3() };

    const controls = createControls({
        camera,
        renderer,
        bounds,
        config: CONFIG,
    });

    const splats = new SplatMesh({
        url: CONFIG.url,
        // Extended encoding. Spark's compact default stores splat centres as
        // half floats, whose precision is relative to the magnitude of the
        // coordinate — so it degrades with distance from the capture's own
        // origin. Measured on this scan: a 0.98 mm grid two metres from the
        // origin, a 31 mm grid thirty-five metres away, both exact powers of
        // two. At the far end of the tram that snaps every splat centre onto a
        // three-centimetre lattice, which is what smears the posters there
        // into stripes while the same posters near the door stay legible.
        extSplats: CONFIG.extEncoding,
        // Build the level-of-detail tree in a background worker after loading.
        // This is the whole reason for Spark here: the capture is 6.2M splats
        // and a laptop draws a few hundred thousand of them, selected per
        // frame from the tree rather than sorted out of the whole set.
        lod: true,
        onProgress: (event) => {
            // No Content-Length — a proxy that re-encodes the response, say —
            // means no percentage to show, so the wheel sweeps instead.
            if (!event || !event.lengthComputable || !event.total) {
                wheel.spin(loadingLabel);
                return;
            }
            const pct = (event.loaded / event.total) * 100;
            if (pct >= 100) {
                // The last byte is not the last of the wait: the LoD tree is
                // built after this, and on six million splats that is seconds
                // more with nothing to count.
                wheel.spin("Building detail levels…");
            } else {
                wheel.progress(pct, loadingLabel);
            }
        },
        onLoad: () => {
            // fitWorld samples 50k centres on the main thread, so the wheel
            // comes down after it rather than before — nothing paints in
            // between, and a frozen first frame reads as a crash.
            fitWorld();
            wheel.done();
            hintEl.hidden = false;
            hudEl.hidden = false;
            // The markers' sight lines are tested against the collision grid,
            // which fitWorld has only just built. Showing them before it
            // exists would show every one of them through the bodywork.
            hotspots.setEnabled(!CONFIG.align);
            // Align mode always wants the picker: fitting two captures is
            // mostly a matter of picking the same feature on each and reading
            // off how far apart they landed.
            if (CONFIG.pick || CONFIG.align) {
                picker = createPicker({
                    renderer,
                    camera,
                    bounds,
                    targets: () => [
                        { name: "vehicle", mesh: splats },
                        {
                            name: "detail",
                            mesh: overlays?.entry(CONFIG.align || openId)?.mesh,
                        },
                    ],
                });
            }
            if (CONFIG.align) startAligning();
        },
    });
    world.add(splats);

    // maxSh is a field on the mesh rather than a constructor option; set here,
    // it is in place before the loaded data builds its generator.
    splats.maxSh = CONFIG.maxSh;

    // A capture whose file is not in public/data/ should say so, rather than
    // sitting on "Loading…" for ever.
    splats.initialized?.catch((err) => {
        console.error("Splat load failed:", err);
        wheel.fail(`Could not load ${CONFIG.url} — ${err.message || err}`);
    });

    // -----------------------------------------------------------------------
    // Things worth a second look
    //
    // A circle on the capture says there is more here than the scan in front
    // of you shows, and clicking it lays the detail scan over the spot it
    // belongs to. The vehicle stays where it is and the camera does not move:
    // the hatch opens in front of you, in the cab you are standing in.
    //
    // Three pieces, kept apart because they fail separately:
    //   hotspots  the markers, and whether you can see one from here
    //   overlay   the second capture, its placement and the crossfade
    //   here      the caption and the one key that shuts it again
    // -----------------------------------------------------------------------

    // Filled in once overlays.config.json and the baked mask have arrived.
    // Everything that touches it is either a user action (which cannot happen
    // before the vehicle has loaded, which takes far longer) or guarded.
    let overlays = null;
    let debugView = null;
    let openId = null;

    const hotspots = createHotspots({
        camera,
        renderer,
        bounds,
        hotspots: CONFIG.hotspots,
        onActivate: openHotspot,
    });
    // Off until the capture has loaded: see the mesh's onLoad above.
    hotspots.setEnabled(false);

    let picker = null;
    let aligner = null;

    const overlaysReady = (async () => {
        const config = await fetch("overlays.config.json").then((r) => {
            if (!r.ok) throw new Error(`${r.status} fetching overlays.config.json`);
            return r.json();
        });
        overlays = await createOverlayManager({
            world3,
            base: splats,
            config,
            softEdge: CONFIG.softCut,
            onChange: () => invalidate(),
        });
        debugView = createMaskDebugView({
            scene: world3,
            mask: overlays.mask,
            onChange: () => invalidate(),
        });
        bindKeyboard(
            overlayActions({
                overlays,
                debugView,
                onStatus: (text) => console.log(`[overlays] ${text}`),
            }),
        );
        console.log(
            `Overlays: ${overlays.ids.length} (${overlays.ids.join(", ")}) · ` +
                `mask ${overlays.mask.dimensions.toArray().join("x")} cells of ` +
                `${overlays.mask.cellSize} m, ` +
                `${(overlays.mask.bytes / 1024).toFixed(0)} KB, dilation ` +
                `${overlays.mask.dilation} · base splat budget ` +
                `${CONFIG.splatBudget > 0 ? CONFIG.splatBudget.toLocaleString() : "Spark default"}` +
                `${CONFIG.softCut ? " · soft cut edge on" : ""}`,
        );
        return overlays;
    })().catch((err) => {
        // A missing mask must not take the viewer down with it: without the
        // cutout the overlays still open, they just do not hide what is
        // underneath them.
        console.error(
            "Overlays are off — " + (err.message || err) +
                "\nIf the mask is missing or stale: npm run build:masks",
        );
        return null;
    });

    function openHotspot(hotspot) {
        const id = hotspot.overlayId;
        if (!id || !overlays) return;
        hotspots.setEnabled(false);
        openId = id;
        overlays.fadeIn(id);
        showDetail(hotspot);
    }

    function closeDetail() {
        if (!openId || CONFIG.align || !overlays) return;
        overlays.fadeOut(openId);
        openId = null;
        hotspots.setEnabled(true);
        if (detailEl) detailEl.hidden = true;
    }

    // The caption under an open detail capture. A 14 MB capture is seconds of
    // waiting, and silence in those seconds reads as a click that did nothing,
    // so the caption goes up on the click and the note catches up.
    function showDetail(hotspot) {
        if (!detailEl) return;
        detailEl.hidden = false;
        detailTitleEl.textContent = hotspot?.label ?? "";
        detailCloseEl.hidden = Boolean(CONFIG.align);
        detailNoteEl.textContent = "Opening…";
        detailEl.classList.add("is-busy");
    }

    // Swaps "Opening…" for the caption once the capture is actually there.
    // Called from the frame loop, which is the only place that knows.
    function refreshDetailNote() {
        if (!openId || !detailEl || detailEl.hidden) return;
        if (!detailEl.classList.contains("is-busy")) return;
        const entry = overlays?.entry(openId);
        if (!entry?.mesh?.isInitialized) return;
        detailEl.classList.remove("is-busy");
        const hotspot = CONFIG.hotspots.find((h) => h.overlayId === openId);
        detailNoteEl.textContent = hotspot?.detail ?? "";
    }

    detailCloseEl?.addEventListener("click", closeDetail);
    window.addEventListener("keydown", (event) => {
        if (event.key === "Escape") closeDetail();
    });

    // ?align=<overlay id>. Opens that overlay straight away and binds the keys
    // that move it, so the fit can be found by looking at it. See
    // src/align.js.
    async function startAligning() {
        if (!(await overlaysReady)) return;
        const hotspot =
            CONFIG.hotspots.find((h) => h.overlayId === CONFIG.align) ?? {
                id: CONFIG.align,
                overlayId: CONFIG.align,
                // Without a hotspot there is nothing to turn and grow about
                // but the capture's own origin, which is a poor pivot. Align
                // from a hotspot where there is one.
                position: overlays.placementOf(CONFIG.align)?.position,
            };
        if (!overlays.placementOf(CONFIG.align)) {
            console.warn(
                `No overlay "${CONFIG.align}" in overlays.config.json. Known: ` +
                    overlays.ids.join(", "),
            );
            return;
        }

        // The mask was baked for the placement in the config, so every nudge
        // makes it wrong. More to the point, you cannot fit a detail capture
        // onto a hatch that has been erased from the vehicle — the cutout has
        // to be off to align against what is underneath.
        overlays.setCutEnabled(false);
        console.log(
            "Align mode: base cutout off (the mask is baked for the saved " +
                "placement). Run `npm run build:masks` after saving new numbers.",
        );

        overlays.holdFade(CONFIG.align);
        aligner = createAligner({
            overlay: overlays,
            hotspot,
            invalidate: () => invalidate(),
        });
        window.__align = aligner;
        // The placement panel is drawn before the capture exists, so it has to
        // be told once it does.
        const poll = setInterval(() => {
            aligner.refresh();
            if (overlays.entry(CONFIG.align)?.mesh?.isInitialized) {
                clearInterval(poll);
            }
        }, 400);
    }

    // Where the splat data actually lives depends on two options. With
    // lod: true it moves off packedSplats onto its .lodSplats, and
    // packedSplats.numSplats reads 0; with extSplats: true it is on
    // .extSplats instead. Miss one and fitWorld measures nothing, the bounds
    // stay an empty box, and the framing and the roam limits quietly fall
    // back to defaults — which is a hard failure to spot, because the capture
    // still renders perfectly.
    function resolvePackedSplats(mesh) {
        const candidates = [
            mesh.extSplats,
            mesh.extSplats && mesh.extSplats.lodSplats,
            mesh.packedSplats,
            mesh.packedSplats && mesh.packedSplats.lodSplats,
        ];
        for (const packed of candidates) {
            if (!packed || typeof packed.getSplat !== "function") continue;
            const count =
                typeof packed.getNumSplats === "function"
                    ? packed.getNumSplats()
                    : packed.numSplats;
            if (count > 0) return { packed, count };
        }
        return null;
    }

    // Sample the splat centres to find the capture's extent. Sampling rather
    // than walking all 6.2M keeps this to ~20 ms instead of a visible stall.
    function measureDataBounds(mesh) {
        const resolved = resolvePackedSplats(mesh);
        if (!resolved) return null;

        const { packed, count } = resolved;
        const box = new THREE.Box3();
        const stride = Math.max(1, Math.floor(count / 50000));
        for (let i = 0; i < count; i += stride) {
            const centre = packed.getSplat(i).center;
            // Merged LoD parents can land on NaN if a node ends up degenerate.
            if (!Number.isFinite(centre.x)) continue;
            box.expandByPoint(centre);
        }
        return box.isEmpty() ? null : box;
    }

    // Rotate the measured box into world orientation, then scale and offset the
    // capture so it sits centred on the origin with its floor at y = 0.
    function fitWorld() {
        const dataBox = measureDataBounds(splats);
        if (!dataBox) {
            console.warn("Could not measure splat bounds; leaving the capture where it is.");
            controls.reset();
            return;
        }

        const rotation = new THREE.Matrix4().makeRotationFromQuaternion(
            world.quaternion,
        );
        const box = dataBox.clone().applyMatrix4(rotation);
        const size = box.getSize(new THREE.Vector3());
        const centre = box.getCenter(new THREE.Vector3());

        // worldHeight 0 means "leave the capture's own scale alone", which is
        // what a metric vehicle scan wants.
        const scale =
            CONFIG.worldHeight > 0
                ? CONFIG.worldHeight / Math.max(size.y, 1e-6)
                : 1;
        world.scale.setScalar(scale);
        // Applied after rotation and scale, so these are world metres.
        if (CONFIG.origin === "data") {
            // Leave the capture where the file puts it. Its own origin is
            // then the world origin, and a coordinate read off the viewer is
            // a coordinate in the scan.
            world.position.set(0, 0, 0);
        } else {
            // The horizontal centre goes to the origin and the lowest splat to
            // y = 0, which puts the tram on a floor whatever the file thinks.
            world.position.set(
                -scale * centre.x,
                -scale * box.min.y,
                -scale * centre.z,
            );
        }

        // Read the final placement back off the transform rather than
        // recomputing it, so the two can never disagree.
        world.updateMatrixWorld(true);
        bounds.box.copy(dataBox).applyMatrix4(world.matrixWorld);

        // Where the file's own origin landed in world metres. Under
        // origin: "data" that is (0, 0, 0) by construction, but reading it off
        // the transform keeps the two modes answering the same question.
        const dataOrigin = new THREE.Vector3().applyMatrix4(world.matrixWorld);
        if (CONFIG.collision) bounds.solidAt = buildOccupancy();

        bounds.focus.copy(
            CONFIG.pivot === "origin"
                ? dataOrigin
                : bounds.box.getCenter(new THREE.Vector3()),
        );
        controls.reset();

        const boxCentre = bounds.box.getCenter(new THREE.Vector3());
        console.log(
            `Splat extent (data units): ${size.x.toFixed(1)} x ${size.y.toFixed(1)} x ${size.z.toFixed(1)}\n` +
                `Scale: 1 data unit = ${scale.toFixed(4)} m\n` +
                `World: ${(size.x * scale).toFixed(1)} x ${(size.y * scale).toFixed(1)} x ${(size.z * scale).toFixed(1)} m` +
                ` (up axis ${CONFIG.upAxis}, heading ${CONFIG.heading}°)\n` +
                `Origin mode: ${CONFIG.origin}, pivot ${CONFIG.pivot} · file origin at ` +
                `(${dataOrigin.x.toFixed(2)}, ${dataOrigin.y.toFixed(2)}, ${dataOrigin.z.toFixed(2)}) m` +
                `, capture centre at ` +
                `(${boxCentre.x.toFixed(2)}, ${boxCentre.y.toFixed(2)}, ${boxCentre.z.toFixed(2)}) m\n` +
                `Splat budget: ${
                    CONFIG.splatBudget > 0
                        ? (CONFIG.splatBudget * CONFIG.lodScale).toLocaleString()
                        : `Spark's platform default x ${CONFIG.lodScale}`
                }`,
        );
    }

    // -----------------------------------------------------------------------
    // Where the solid parts of the vehicle are
    //
    // Splats describe surfaces, so a coarse occupancy grid built from their
    // centres is a serviceable set of walls: a cell holding enough small
    // splats is solid, everything else is air. The aisle, being air, stays
    // walkable; the bodywork, the partitions and the seats do not.
    //
    // Only small splats count. The level-of-detail tree carries merged parent
    // splats metres across — the first one in this capture is 12.8 m long —
    // and a single one of those would wall off the whole saloon.
    //
    // Built once, after the capture has been measured. Reading it is three
    // divides and an array lookup, so walking costs nothing per frame.
    // -----------------------------------------------------------------------

    function buildOccupancy() {
        const resolved = resolvePackedSplats(splats);
        if (!resolved || bounds.box.isEmpty()) return null;

        const { packed, count } = resolved;
        const cell = CONFIG.collisionCell;
        const min = bounds.box.min.clone().subScalar(cell);
        const size = bounds.box.getSize(new THREE.Vector3()).addScalar(cell * 2);
        const nx = Math.ceil(size.x / cell);
        const ny = Math.ceil(size.y / cell);
        const nz = Math.ceil(size.z / cell);
        if (nx * ny * nz > 8e6) {
            console.warn("Collision grid would be too large; walls are off.");
            return null;
        }

        const counts = new Uint16Array(nx * ny * nz);
        const matrix = world.matrixWorld;
        const centre = new THREE.Vector3();
        const stride = Math.max(1, Math.floor(count / CONFIG.collisionSamples));
        const started = performance.now();

        for (let i = 0; i < count; i += stride) {
            const splat = packed.getSplat(i);
            const scales = splat.scales;
            const biggest = Math.max(scales.x, scales.y, scales.z);
            if (!(biggest < CONFIG.collisionMaxSplat)) continue;

            centre.copy(splat.center).applyMatrix4(matrix);
            if (!Number.isFinite(centre.x)) continue;

            const ix = Math.floor((centre.x - min.x) / cell);
            const iy = Math.floor((centre.y - min.y) / cell);
            const iz = Math.floor((centre.z - min.z) / cell);
            if (ix < 0 || iy < 0 || iz < 0 || ix >= nx || iy >= ny || iz >= nz) {
                continue;
            }
            const k = (iz * ny + iy) * nx + ix;
            if (counts[k] < 65535) counts[k] += 1;
        }

        // Doorways. The grid is built from what the scan saw, and what it
        // saw of the cab doorway is a 35 cm slot offset 40 cm off the
        // centreline — passable in principle and impossible to find by
        // walking into it. An opening is a box where the grid is ignored.
        const openings = CONFIG.openings.map(
            (o) =>
                new THREE.Box3(
                    new THREE.Vector3(...o.min),
                    new THREE.Vector3(...o.max),
                ),
        );
        const probe = new THREE.Vector3();

        const threshold = CONFIG.collisionThreshold;
        let solid = 0;
        for (let k = 0; k < counts.length; k += 1) {
            if (counts[k] >= threshold) solid += 1;
        }

        console.log(
            `Collision grid: ${nx} x ${ny} x ${nz} cells of ${cell} m, ` +
                `${solid.toLocaleString()} solid of ${counts.length.toLocaleString()} ` +
                `(${((100 * solid) / counts.length).toFixed(1)}%), ` +
                `built in ${Math.round(performance.now() - started)} ms` +
                (openings.length ? `, ${openings.length} opening(s)` : ""),
        );

        return function solidAt(x, y, z) {
            if (openings.length) {
                probe.set(x, y, z);
                for (const box of openings) {
                    if (box.containsPoint(probe)) return false;
                }
            }
            const ix = Math.floor((x - min.x) / cell);
            if (ix < 0 || ix >= nx) return false;
            const iy = Math.floor((y - min.y) / cell);
            if (iy < 0 || iy >= ny) return false;
            const iz = Math.floor((z - min.z) / cell);
            if (iz < 0 || iz >= nz) return false;
            return counts[(iz * ny + iy) * nx + ix] >= threshold;
        };
    }

    // -----------------------------------------------------------------------
    // Readout
    // -----------------------------------------------------------------------

    // H hides it. Worth having while the framing and the up axis are still
    // being settled, and worth hiding before the link goes to anyone.
    window.addEventListener("keydown", (event) => {
        if (event.key.toLowerCase() === "h") hudEl.hidden = !hudEl.hidden;
    });

    let frames = 0;
    let lastHud = 0;
    let lastLog = 0;

    function updateHud(now) {
        if (now - lastHud < 0.5) return;

        const fps = frames / (now - lastHud);
        frames = 0;
        lastHud = now;

        // activeSplats is what the LoD tree actually handed the GPU this
        // frame, which is the number worth watching: the file's own count
        // never changes and tells you nothing about the budget.
        const drawn = spark.activeSplats ?? 0;
        // Redraws per second, not display refresh rate. A still view redraws
        // nothing, so this reads 0 when nobody is touching it. That is the
        // optimisation working, not a stall.
        hudHeadEl.textContent = fps < 1 ? "idle" : `${fps.toFixed(0)} fps`;
        hudDetailEl.textContent =
            `${drawn.toLocaleString()} of ${(scene.totalSplats ?? 0).toLocaleString()} splats\n` +
            controls.readout();

        if (CONFIG.fpsLog && now - lastLog >= CONFIG.fpsLog) {
            lastLog = now;
            console.log(`${fps.toFixed(1)} fps · ${drawn.toLocaleString()} splats drawn`);
        }
    }

    // -----------------------------------------------------------------------
    // Frame loop
    //
    // The scene is static: a tram that does not move, lit by light baked into
    // the splats. Redrawing it sixty times a second while nobody touches it
    // pins the GPU at full load for an image identical to the last one, which
    // is where a laptop's heat and fan noise come from — the renderer has no
    // idea the picture has not changed.
    //
    // So redraw only on a reason to:
    //
    //   the camera moved     compared against the last frame actually drawn,
    //                        which covers dragging, walking, zooming, and the
    //                        tail of orbit damping settling
    //   Spark has new splats the level-of-detail tree streams and refines in
    //                        the background, and says so through onDirty
    //   the window resized
    //
    // Controls still update every animation frame, because that is cheap and
    // damping needs the steps; it is the render that is skipped. ?always=1
    // puts the old behaviour back if something ever fails to ask for a redraw.
    // -----------------------------------------------------------------------

    let needsRender = true;
    let lastRender = -Infinity;
    const lastPosition = new THREE.Vector3();
    const lastOrientation = new THREE.Quaternion();

    // How far the camera has to move from the last frame actually drawn before
    // the picture is worth drawing again. Not an optimisation — a correctness
    // fix. OrbitControls' damping decays asymptotically and never reaches
    // zero, so the camera goes on twitching in its last floating-point bits
    // long after the view has visibly stopped. Compared exactly, an orbited
    // scene is never still: it redraws for ever and never refines.
    //
    // The thresholds are OrbitControls' own, which runs this exact test
    // internally against _EPS = 1e-6 on squared displacement to decide whether
    // to emit a change event. Matching it means the view settles no later than
    // the library thinks it has: a millimetre of travel, and under a pixel of
    // rotation at this field of view.
    //
    // Both are measured against the last frame actually drawn rather than the
    // last animation frame, so a drift too slow to trip the test on any single
    // frame still accumulates into a redraw.
    const STILL_DISTANCE = 1e-3;
    const STILL_ANGLE = 7e-4;

    function cameraMoved() {
        return (
            camera.position.distanceToSquared(lastPosition) >
                STILL_DISTANCE * STILL_DISTANCE ||
            camera.quaternion.angleTo(lastOrientation) > STILL_ANGLE
        );
    }

    function invalidate() {
        needsRender = true;
    }

    // -----------------------------------------------------------------------
    // Refining while still
    //
    // Redrawing on change leaves the frame budget unspent whenever nobody is
    // touching anything. This spends it: after a moment of stillness the
    // level-of-detail tree is handed a far larger budget, descends deeper into
    // the capture, and draws one expensive frame — which then costs nothing at
    // all to keep on screen, because the next frame is not drawn.
    //
    // Only movement drops it back. Spark's own dirty flag must not, or raising
    // the budget would immediately undo itself: the refinement is exactly what
    // makes Spark dirty.
    // -----------------------------------------------------------------------

    const canRefine =
        CONFIG.splatBudget > 0 && CONFIG.idleSplatBudget > CONFIG.splatBudget;
    let refined = false;
    let lastChange = 0;
    let changes = 0;

    function setBudget(count) {
        spark.lodSplatCount = count;
        // The tree re-selects on its next update; without this the change
        // would not be noticed until something else asked for a frame.
        invalidate();
    }

    // Something the viewer did: the camera moved, the window changed shape.
    // Distinct from invalidate(), which only means "the picture is stale".
    function markChanged(now) {
        lastChange = now;
        changes += 1;
        if (refined) {
            refined = false;
            setBudget(CONFIG.splatBudget);
        }
        invalidate();
    }

    // Spark refines the capture in the background for a while after it loads,
    // and streams in detail as the camera settles. Without this the first
    // frames would be all it ever drew.
    spark.onDirty = invalidate;

    window.addEventListener("resize", () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
        markChanged(timer.getElapsed());
    });

    // Exposed for measuring from the console. An embedded preview pane can
    // run requestAnimationFrame at a trickle while reporting itself visible,
    // which makes a frame counter read 1 fps on a renderer that is perfectly
    // fast — timing a render directly is the way to tell the two apart.
    window.__gs = {
        // three.js itself, so a console session can build a Raycaster or a
        // Vector3 without importing anything.
        THREE,
        renderer,
        camera,
        spark,
        scene: world3,
        splats,
        world,
        controls,
        bounds,
        get overlays() {
            return overlays;
        },
        hotspots,
        invalidate,
        get state() {
            return { refined, lastChange, changes, elapsed: timer.getElapsed() };
        },
    };

    const minInterval = CONFIG.maxFps > 0 ? 1 / CONFIG.maxFps : 0;

    renderer.setAnimationLoop(() => {
        timer.update();
        const dt = Math.min(timer.getDelta(), 0.1);
        const now = timer.getElapsed();

        controls.update(dt);
        // Cheap, and it has to run on every animation frame rather than every
        // rendered one: the markers are DOM, so they are not redrawn by the
        // renderer and would otherwise lag a frame behind the view.
        hotspots.update();
        // Returns true while a detail capture is still fading, which is a
        // change nothing else in the loop knows about.
        overlays?.update(dt);
        refreshDetailNote();

        if (cameraMoved()) markChanged(now);
        // Belt and braces: onDirty is the signal, this is the state behind it.
        // Deliberately invalidate() and not markChanged(): Spark goes dirty as
        // a *result* of refining, and treating that as movement would drop the
        // budget again on the next frame, for ever.
        if (spark.dirty) invalidate();

        if (canRefine && !refined && now - lastChange >= CONFIG.idleDelay) {
            refined = true;
            setBudget(CONFIG.idleSplatBudget);
        }

        updateHud(now);

        if (!CONFIG.always && !needsRender) return;
        if (now - lastRender < minInterval) return;

        lastPosition.copy(camera.position);
        lastOrientation.copy(camera.quaternion);
        needsRender = false;
        lastRender = now;
        frames += 1;

        renderer.render(world3, camera);
    });
}
