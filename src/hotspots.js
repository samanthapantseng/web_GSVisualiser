import * as THREE from "three";

// ---------------------------------------------------------------------------
// The circles.
//
// A ring drawn on something in the capture, meaning "there is more of this
// than the scan in front of you shows". Clicking one hands the hotspot back to
// the viewer, which is what opens the detail scan over it.
//
// They are DOM buttons positioned from a projected world point, rather than
// geometry in the scene. Three reasons, in order of how much they mattered:
//
//   depth    Spark's splats do not write a depth buffer the rest of three.js
//            can test against, so a ring drawn as a mesh either sits in front
//            of the whole capture whatever is between, or vanishes into it.
//            Neither is "on the panel". Occlusion has to be worked out
//            separately whichever way the ring is drawn — see sightLine below
//            — and once it is, the DOM costs nothing extra.
//   input    a button is a click target, a focus stop and a thing a
//            screen reader can announce, for free. A sprite is none of those,
//            and hit-testing one means raycasting on every pointer move.
//   crispness a 1 px ring stays 1 px at any pixel ratio, where the canvas is
//            deliberately rendered at a capped one.
//
// What is given up is tilt: a DOM circle faces the screen and cannot lie flat
// against the panel it marks. For a marker that is the right answer anyway —
// a badge that foreshortens into a line at a glancing angle is a badge nobody
// can click.
// ---------------------------------------------------------------------------

// How close the line-of-sight march steps, in metres. The occupancy grid's own
// cells are 0.2 m, so half of that never steps over a wall.
const SIGHT_STEP = 0.1;

// How far along its own normal a hotspot's sight test starts, in metres. The
// marker sits on a surface, and that surface is solid: tested from the point
// itself every hotspot is occluded by the thing it marks.
const SIGHT_LIFT = 0.25;

// Screen radius, in CSS pixels, that the ring is held between. The ring is
// drawn at the hotspot's true size in metres, which is what makes it read as
// painted on the panel rather than floating over it — but across a saloon that
// is three pixels, and from arm's length it is most of the window.
const MIN_RADIUS_PX = 11;
const MAX_RADIUS_PX = 54;

export function createHotspots({ camera, renderer, bounds, hotspots, onActivate }) {
    const layer = document.createElement("div");
    layer.id = "hotspots";
    // The layer spans the window so the markers can be placed anywhere in it;
    // only the markers themselves take the pointer, or it would swallow every
    // drag meant for the canvas underneath.
    layer.setAttribute("aria-label", "Points of interest");
    document.getElementById("app").appendChild(layer);

    const projected = new THREE.Vector3();
    const toCamera = new THREE.Vector3();
    const march = new THREE.Vector3();
    const start = new THREE.Vector3();

    const entries = hotspots.map((spec) => {
        const el = document.createElement("button");
        el.type = "button";
        el.className = "hotspot";
        el.hidden = true;
        el.setAttribute("aria-label", `${spec.label} — open`);

        const ring = document.createElement("span");
        ring.className = "hotspot-ring";
        ring.setAttribute("aria-hidden", "true");
        el.appendChild(ring);

        const label = document.createElement("span");
        label.className = "hotspot-label";
        label.textContent = spec.label;
        el.appendChild(label);

        el.addEventListener("click", (event) => {
            event.preventDefault();
            // Walk mode looks around on a held primary button. Letting the
            // click bubble leaves the canvas thinking a drag began on it.
            event.stopPropagation();
            onActivate(spec);
        });
        // Same reason: a press that starts on the marker is not a look.
        el.addEventListener("pointerdown", (event) => event.stopPropagation());

        layer.appendChild(el);

        return {
            spec,
            el,
            position: new THREE.Vector3().fromArray(spec.position),
            // Which way the marked surface faces. Used to hide the marker when
            // you are behind the panel rather than in front of it, and to lift
            // the sight test off the surface. Optional: a hotspot with no
            // normal is visible from every side.
            normal: spec.normal ? new THREE.Vector3().fromArray(spec.normal).normalize() : null,
            radius: spec.radius ?? 0.12,
            range: spec.range ?? 8,
            visible: false,
        };
    });

    // Is there anything solid between the camera and a point? The occupancy
    // grid the viewer built from the capture is the only thing in the viewer
    // that knows where the walls are, and it is exactly what this wants: a
    // marker on a panel in the cab should not show through the bulkhead from
    // the other end of the saloon.
    //
    // With collision off there is no grid, and then every marker is in sight —
    // which is the honest answer, since nothing knows otherwise.
    function sightLine(point, normal) {
        if (!bounds.solidAt) return true;

        start.copy(point);
        if (normal) start.addScaledVector(normal, SIGHT_LIFT);

        march.subVectors(start, camera.position);
        const distance = march.length();
        if (distance < SIGHT_STEP) return true;
        march.multiplyScalar(1 / distance);

        // Stop short of the surface itself, which is solid by definition.
        const reach = distance - SIGHT_STEP;
        for (let t = SIGHT_STEP; t < reach; t += SIGHT_STEP) {
            const x = camera.position.x + march.x * t;
            const y = camera.position.y + march.y * t;
            const z = camera.position.z + march.z * t;
            if (bounds.solidAt(x, y, z)) return false;
        }
        return true;
    }

    let enabled = true;
    // Half the vertical field of view, in tangent form — the conversion from
    // metres at a distance to pixels on the screen. Recomputed per frame
    // because the window can change shape under us.
    function pixelsPerRadian() {
        return (
            renderer.domElement.clientHeight /
            2 /
            Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)
        );
    }

    function update() {
        const width = renderer.domElement.clientWidth;
        const height = renderer.domElement.clientHeight;
        const scale = pixelsPerRadian();

        for (const entry of entries) {
            let show = enabled;

            toCamera.subVectors(camera.position, entry.position);
            const distance = toCamera.length();

            // Too far to be worth offering, and far enough that a dozen of
            // them would read as confetti over the whole vehicle.
            if (show && distance > entry.range) show = false;

            // Behind the panel rather than in front of it.
            if (show && entry.normal && toCamera.dot(entry.normal) <= 0) show = false;

            if (show) {
                projected.copy(entry.position).project(camera);
                // project() returns z > 1 for anything behind the near plane,
                // and the x/y it returns there are mirrored nonsense.
                if (projected.z > 1) show = false;
            }

            if (show && !sightLine(entry.position, entry.normal)) show = false;

            if (!show) {
                if (entry.visible) {
                    entry.visible = false;
                    entry.el.hidden = true;
                    entry.el.classList.remove("is-near");
                }
                continue;
            }

            const radiusPx = THREE.MathUtils.clamp(
                (entry.radius / distance) * scale,
                MIN_RADIUS_PX,
                MAX_RADIUS_PX,
            );

            // Fade out over the last fifth of the range, so a marker arrives
            // and leaves rather than blinking on at a step.
            const fade = THREE.MathUtils.clamp(
                (entry.range - distance) / (entry.range * 0.2),
                0,
                1,
            );

            const el = entry.el;
            el.style.setProperty("--r", `${radiusPx.toFixed(1)}px`);
            el.style.opacity = fade.toFixed(3);
            el.style.transform =
                `translate(-50%, -50%) translate(` +
                `${((projected.x * 0.5 + 0.5) * width).toFixed(1)}px, ` +
                `${((-projected.y * 0.5 + 0.5) * height).toFixed(1)}px)`;
            // Close enough that the label is worth the room it takes.
            el.classList.toggle("is-near", distance < entry.range * 0.55);

            if (!entry.visible) {
                entry.visible = true;
                el.hidden = false;
            }
        }
    }

    return {
        update,

        // Switched off while a detail scan is open: the markers belong to the
        // capture underneath it, and leaving them floating over the overlay
        // invites a second click that cannot do anything useful.
        setEnabled(next) {
            if (enabled === next) return;
            enabled = next;
            if (!enabled) {
                for (const entry of entries) {
                    entry.visible = false;
                    entry.el.hidden = true;
                }
            }
        },

        get entries() {
            return entries;
        },

        dispose() {
            layer.remove();
        },
    };
}
