import * as THREE from "three";
import { SplatMesh } from "@sparkjsdev/spark";
import {
    overlayIds,
    overlayMatrix,
    placementQuaternion,
    upQuaternion,
} from "./placement.js";
import { loadOverlayMask } from "./maskLoader.js";
import { createBaseCutout } from "./baseCutoutModifier.js";

// ---------------------------------------------------------------------------
// The detail captures, their fades, and the hole each one cuts in the vehicle.
//
// One object owns both halves because they are one thing: an overlay's
// visibility is simultaneously how strongly its splats are drawn and how
// strongly the base splats underneath it are erased. Split across two
// owners they drift, and the drift is visible — a frame where both are drawn
// reads as a double image, a frame where neither is reads as a hole.
//
// So there is a single number per overlay, written to both places in the same
// statement. See setVisibility.
// ---------------------------------------------------------------------------

const DEFAULT_FADE = 1.0;

// Fades are eased rather than linear; alpha is not perceived linearly and a
// straight ramp reads as a pause at each end.
function easeInOut(t) {
    return t * t * (3 - 2 * t);
}

export async function createOverlayManager({
    world3,
    base,
    config,
    maskBase = "masks/",
    softEdge = false,
    onChange,
}) {
    const specs = config.overlays ?? [];

    // The mask is baked against this exact overlay list, in this order. The
    // loader refuses a mask baked against a different one rather than letting
    // the wrong overlay's cells fade.
    const mask = await loadOverlayMask({
        base: maskBase,
        expectIds: overlayIds(config),
    });
    const cutout = createBaseCutout({ mask, softEdge });

    // The base capture is the only mesh that gets the modifier. An overlay
    // carrying it would cut itself out of its own hole.
    base.worldModifier = cutout.modifier;

    const overlays = new Map();

    for (const spec of specs) {
        // Two nested groups rather than one composed matrix, so the two
        // rotations stay separately readable: the inner one is a property of
        // the export (which way is up in the file), the outer one a property
        // of the fit (where that upright capture then goes). The flattened
        // equivalent is placement.js's overlayMatrix, which the mask builder
        // uses — the two must agree, which is why both come from the same
        // config and the same helpers.
        const outer = new THREE.Group();
        const inner = new THREE.Group();
        outer.add(inner);

        overlays.set(spec.id, {
            spec,
            outer,
            inner,
            mesh: null,
            loading: null,
            // A live, mutable copy of the config's placement. Align mode edits
            // this; everything else reads the config. Kept per entry rather
            // than mutating `spec` so that what was loaded stays legible next
            // to what is being tried.
            place: {
                position: [...(spec.position ?? [0, 0, 0])],
                rotation: [...(spec.rotation ?? [0, 0, 0])],
                scale: spec.scale ?? 1,
                upAxis: spec.upAxis ?? "+y",
            },
            // 0 shut, 1 open. The single number both halves read.
            visibility: 0,
            target: 0,
            duration: DEFAULT_FADE,
            elapsed: 0,
            from: 0,
        });
        applyPlacement(overlays.get(spec.id));
    }

    function applyPlacement(entry) {
        const { position, rotation, scale, upAxis } = entry.place;
        entry.outer.position.fromArray(position);
        entry.outer.quaternion.copy(placementQuaternion({ rotation }));
        entry.outer.scale.setScalar(scale);
        entry.inner.quaternion.copy(upQuaternion(upAxis));
        onChange?.();
    }

    let fadeDuration = DEFAULT_FADE;

    // Both halves of a visibility change, together.
    function applyVisibility(entry, value) {
        entry.visibility = value;
        if (entry.mesh) entry.mesh.opacity = value;
        cutout.setVisibility(entry.spec.id, value, base);

        // A fully faded overlay leaves the scene. `visible = false` is not
        // enough: Spark gathers splats by walking the scene with
        // traverseVisible, so an invisible mesh is never visited and never
        // withdraws the splats it already contributed — it stays on screen
        // over a scene that thinks it is gone. Leaving the graph is what
        // actually removes it, and what stops it costing LoD budget and sort
        // time while shut.
        if (value <= 0) {
            entry.outer.removeFromParent();
        } else if (!entry.outer.parent) {
            world3.add(entry.outer);
        }
    }

    // Captures are fetched the first time they are asked for, or by
    // preload() once the vehicle has loaded — whichever comes first. Not at
    // startup: they would compete with the vehicle's 86 MB for bandwidth and
    // the decode worker, and the vehicle is what the visitor is waiting for.
    function ensureLoaded(entry) {
        if (entry.mesh || entry.loading) return entry.loading;
        entry.loading = new Promise((resolve) => {
            const mesh = new SplatMesh({
                url: entry.spec.url,
                extSplats: entry.spec.extEncoding !== false,
                lod: true,
                // Nothing edits an overlay, and `editable` adds a per-splat
                // SDF evaluation to its shader.
                editable: false,
                onLoad: () => {
                    entry.mesh.opacity = entry.visibility;
                    onChange?.();
                    resolve(mesh);
                },
            });
            mesh.maxSh = 0;
            mesh.opacity = 0;
            entry.inner.add(mesh);
            entry.mesh = mesh;
            mesh.initialized?.catch((err) => {
                console.error(`Overlay ${entry.spec.id} failed to load:`, err);
                resolve(null);
            });
        });
        return entry.loading;
    }

    function startFade(entry, to, duration) {
        if (to > 0) {
            ensureLoaded(entry);
            if (!entry.outer.parent) world3.add(entry.outer);
        }
        entry.from = entry.visibility;
        entry.target = to;
        entry.duration = Math.max(0, duration ?? fadeDuration);
        entry.elapsed = 0;
        if (entry.duration === 0) applyVisibility(entry, to);
        onChange?.();
    }

    const api = {
        get ids() {
            return [...overlays.keys()];
        },
        get mask() {
            return mask;
        },
        get cutEnabled() {
            return cutout.enabled;
        },
        get fadeDuration() {
            return fadeDuration;
        },

        visibilityOf(id) {
            return overlays.get(id)?.visibility ?? 0;
        },

        fadeIn(id, duration) {
            const entry = overlays.get(id);
            if (entry) startFade(entry, 1, duration);
        },

        fadeOut(id, duration) {
            const entry = overlays.get(id);
            if (entry) startFade(entry, 0, duration);
        },

        toggle(id, duration) {
            const entry = overlays.get(id);
            if (!entry) return;
            // Mid-fade, the target is what "already going there" means.
            startFade(entry, entry.target > 0.5 ? 0 : 1, duration);
        },

        setVisibility(id, value) {
            const entry = overlays.get(id);
            if (!entry) return;
            const clamped = THREE.MathUtils.clamp(value, 0, 1);
            entry.target = clamped;
            entry.from = clamped;
            entry.elapsed = entry.duration;
            if (clamped > 0) ensureLoaded(entry);
            applyVisibility(entry, clamped);
            onChange?.();
        },

        toggleAll(duration) {
            const anyOpen = [...overlays.values()].some((e) => e.target > 0.5);
            for (const entry of overlays.values()) {
                startFade(entry, anyOpen ? 0 : 1, duration);
            }
        },

        // Load every overlay in the background, one after another, so the
        // first open is a crossfade rather than a wait. A loaded overlay
        // stays out of the scene graph until it is opened, so it costs
        // memory but no draw time. Overlays already loaded or loading are
        // skipped, and one that fails does not stop the rest.
        async preload() {
            for (const entry of overlays.values()) {
                await ensureLoaded(entry);
            }
        },

        setCutEnabled(on) {
            if (cutout.setEnabled(on, base)) onChange?.();
        },

        setFadeDuration(seconds) {
            fadeDuration = THREE.MathUtils.clamp(seconds, 0, 10);
            return fadeDuration;
        },

        // Called every animation frame. Returns true while anything is still
        // moving, which is the viewer's cue to keep drawing: the scene is
        // otherwise redrawn only when the camera moves, and a crossfade is a
        // change the camera knows nothing about.
        update(dt) {
            let busy = false;
            for (const entry of overlays.values()) {
                if (entry.visibility === entry.target) continue;
                busy = true;
                if (entry.duration <= 0) {
                    applyVisibility(entry, entry.target);
                    continue;
                }
                entry.elapsed += dt;
                const t = Math.min(1, entry.elapsed / entry.duration);
                const eased = easeInOut(t);
                applyVisibility(
                    entry,
                    t >= 1
                        ? entry.target
                        : entry.from + (entry.target - entry.from) * eased,
                );
            }
            return busy;
        },

        entry(id) {
            return overlays.get(id);
        },

        // ------------------------------------------------------------------
        // Align mode (src/align.js)
        //
        // Moving an overlay invalidates the baked mask, which was cut for the
        // placement in overlays.config.json. src/viewer.js turns the cutout
        // off for the duration — not only because the mask would be stale,
        // but because you cannot fit a detail capture onto a hatch that has
        // been erased from the vehicle. Rebuild with `npm run build:masks`
        // once the numbers are back in the config.
        // ------------------------------------------------------------------
        placementOf(id) {
            return overlays.get(id)?.place ?? null;
        },

        // `pivot` is a world point to turn and grow about. Without it both act
        // about the capture's own file origin, which is somewhere off in the
        // middle of the scan: growing the thing by a tenth then slides it a
        // hand's width sideways, and every size change costs three position
        // changes to undo.
        nudge(id, change, pivot) {
            const entry = overlays.get(id);
            if (!entry) return null;
            const p = entry.place;

            let anchor = null;
            if (pivot && (change.rotation || change.scale)) {
                anchor = new THREE.Vector3()
                    .fromArray(pivot)
                    .sub(new THREE.Vector3().fromArray(p.position))
                    .applyQuaternion(
                        placementQuaternion({ rotation: p.rotation }).invert(),
                    )
                    .divideScalar(p.scale);
            }

            if (change.position) {
                p.position = p.position.map((v, i) => v + change.position[i]);
            }
            if (change.rotation) {
                p.rotation = p.rotation.map((v, i) => v + change.rotation[i]);
            }
            if (change.scale) p.scale *= change.scale;

            if (anchor) {
                const moved = anchor
                    .multiplyScalar(p.scale)
                    .applyQuaternion(placementQuaternion({ rotation: p.rotation }));
                p.position = new THREE.Vector3()
                    .fromArray(pivot)
                    .sub(moved)
                    .toArray();
            }

            applyPlacement(entry);
            return p;
        },

        set(id, values) {
            const entry = overlays.get(id);
            if (!entry) return null;
            Object.assign(entry.place, values);
            applyPlacement(entry);
            return entry.place;
        },

        // The flattened data-to-world matrix for the current placement, which
        // is what the mask builder bakes against. Handy from the console for
        // checking that a hand-aligned fit matches the config.
        matrixOf(id) {
            const entry = overlays.get(id);
            return entry ? overlayMatrix(entry.place) : null;
        },

        // How visible each capture is while a fit is being found. Raycasting
        // follows the mix, because Spark tests the splats themselves: a
        // capture faded out of sight is still the nearest thing under the
        // pointer and still wins the hit, and by the time a fit is nearly
        // right the two are within centimetres of each other.
        setMix(id, { overlay: overlayAlpha, vehicle }) {
            const entry = overlays.get(id);
            if (entry?.mesh && overlayAlpha !== undefined) {
                entry.mesh.opacity = overlayAlpha;
                entry.mesh.raycastable = overlayAlpha > 0.2;
            }
            if (vehicle !== undefined) {
                base.opacity = vehicle;
                base.raycastable = vehicle > 0.2;
            }
            onChange?.();
        },

        // Pin an overlay open so the fade loop stops overwriting setMix.
        holdFade(id) {
            const entry = overlays.get(id);
            if (!entry) return;
            ensureLoaded(entry);
            if (!entry.outer.parent) world3.add(entry.outer);
            entry.visibility = 1;
            entry.target = 1;
            entry.from = 1;
            entry.elapsed = entry.duration;
        },

        dispose() {
            for (const entry of overlays.values()) {
                entry.outer.removeFromParent();
                entry.mesh?.dispose();
            }
            base.worldModifier = undefined;
            mask.texture.dispose();
        },
    };

    return api;
}
