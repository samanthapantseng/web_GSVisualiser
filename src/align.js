import * as THREE from "three";

// ---------------------------------------------------------------------------
// Authoring tools. Neither of these is part of the demo; both are switched on
// by the query string and off by default.
//
//   ?pick=1            click the capture and get the world point you clicked,
//                      which is where a hotspot's `position` comes from
//   ?align=<id>        open that hotspot's detail capture and move it about
//                      until it lands on what it belongs to
//
// They exist because the two numbers this feature needs — where a marker goes,
// and where a second capture goes — cannot be computed. The first is a
// judgement about what is worth marking. The second is a fit between two scans
// that were trained apart and share no coordinate system at all, only a
// subject. Both are found by looking, so both need something to look with.
// ---------------------------------------------------------------------------

// What a tap of a movement key is worth, in metres, degrees and proportion.
// Shift divides all three by ten, which is the difference between finding the
// panel and seating it.
//
// The scale step is 4% because scale is the one that starts out furthest
// wrong: the two captures are not even at the same magnification, so the
// first thing anybody does here is get the detail scan roughly life-size, and
// a step small enough to seat it is far too small to find it. Held down, the
// key repeats, so 4% a tap doubles the size in about half a second.
const STEP_M = 0.02;
const STEP_DEG = 1;
const STEP_SCALE = 1.04;
const FINE = 0.1;

// Click a capture, get the point. Spark raycasts the splats themselves — in
// WASM, against whatever the level-of-detail tree currently has loaded — so
// this is a real surface hit on the bodywork, not a guess off the collision
// grid.
//
// `targets()` returns the captures to test, nearest hit winning, each with a
// name. In align mode that is the vehicle and the detail capture both, which
// is the whole trick for fitting them: with the vehicle hidden you pick a
// feature on the detail scan, with the detail scan hidden you pick the same
// feature on the vehicle, and the difference between the two world points is
// the error — measured rather than judged.
export function createPicker({ renderer, camera, targets, bounds }) {
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    // Picks pair up: the last two are the ones worth differencing, and
    // printing the difference saves doing it by hand every time.
    const recent = [];

    const readout = document.createElement("div");
    readout.id = "pick";
    readout.textContent = "Pick: click a capture";
    document.getElementById("app").appendChild(readout);

    function onClick(event) {
        const rect = renderer.domElement.getBoundingClientRect();
        ndc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        ndc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(ndc, camera);

        let best = null;
        for (const { name, mesh } of targets()) {
            if (!mesh) continue;
            const hits = [];
            mesh.raycast(raycaster, hits);
            for (const hit of hits) {
                if (!best || hit.distance < best.distance) {
                    best = { ...hit, name };
                }
            }
        }
        if (!best) {
            readout.textContent = "Pick: nothing under the pointer";
            return;
        }

        const p = best.point;
        const f = (v) => v.toFixed(3);
        const line = `[${f(p.x)}, ${f(p.y)}, ${f(p.z)}]`;
        recent.push({ name: best.name, point: p.clone() });
        if (recent.length > 2) recent.shift();

        let delta = "";
        if (recent.length === 2) {
            const [a, b] = recent;
            const d = b.point.clone().sub(a.point);
            delta =
                `\n${a.name} → ${b.name}: ` +
                `[${f(d.x)}, ${f(d.y)}, ${f(d.z)}]  |d| ${d.length().toFixed(3)} m`;
        }

        readout.textContent =
            `Pick (${best.name}): ${line} · ${best.distance.toFixed(2)} m away` + delta;
        console.log(`pick ${best.name} ${line}${delta}`);
    }

    renderer.domElement.addEventListener("click", onClick);
    // The collision grid is the other thing worth knowing about a point, and
    // the only one that explains why a marker will or will not show up.
    console.log(
        "Pick mode. Click a capture to print a world point; two picks in a " +
            "row also print the vector between them." +
            (bounds.solidAt ? "" : " (No collision grid; sight lines are off.)"),
    );

    return {
        dispose() {
            renderer.domElement.removeEventListener("click", onClick);
            readout.remove();
        },
    };
}

// Move a detail capture until it sits on the thing it is a detail of.
export function createAligner({ overlay, hotspot, invalidate }) {
    const panel = document.createElement("div");
    panel.id = "align";
    document.getElementById("app").appendChild(panel);

    // Three ways to look at the same moment: what the detail scan contains,
    // what it is meant to land on, and the two together — which is the one the
    // fit is actually judged in, but the hardest to read when it is badly out.
    const MIXES = [
        { name: "both", overlay: 1, vehicle: 0.55 },
        { name: "detail only", overlay: 1, vehicle: 0.04 },
        { name: "vehicle only", overlay: 0.06, vehicle: 1 },
        { name: "detail ghosted", overlay: 0.45, vehicle: 1 },
    ];
    let mix = 0;

    function applyMix() {
        overlay.holdFade(hotspot.id);
        overlay.setMix(hotspot.id, MIXES[mix]);
    }

    // Printed in the shape overlays.config.json wants, because that is where
    // it goes: the mask builder reads the same file, so a fit pasted into the
    // wrong place leaves the cutout cutting where the overlay used to be.
    function snippet(place) {
        const m = (v) => v.toFixed(3);
        const d = (v) => v.toFixed(2);
        return (
            `"upAxis": "${place.upAxis}",\n` +
            `"position": [${place.position.map(m).join(", ")}],\n` +
            `"rotation": [${place.rotation.map(d).join(", ")}],\n` +
            `"scale": ${place.scale.toFixed(4)}`
        );
    }

    let copied = 0;

    function draw() {
        const place = overlay.placementOf(hotspot.id);
        if (!place) {
            panel.textContent = "Align: waiting for the detail capture…";
            return;
        }
        // The numbers are shown as the src/scene.js block rather than as a
        // readout, because that is what they are for. Nothing has to be
        // transcribed: select it, or press P and it is on the clipboard.
        panel.innerHTML =
            `<strong>Aligning ${hotspot.id}</strong>` +
            `<p class="align-view">base cutout off while aligning</p>` +
            `<pre id="alignSnippet">${snippet(place)}</pre>` +
            `<p class="align-view">view: ${MIXES[mix].name}` +
            (copied ? ` · <em>copied</em>` : "") +
            `</p>` +
            `<p><kbd>I</kbd><kbd>K</kbd> along the tram · ` +
            `<kbd>J</kbd><kbd>L</kbd> across it · <kbd>U</kbd><kbd>O</kbd> up ` +
            `and down · <kbd>N</kbd><kbd>M</kbd> turn · ` +
            `<kbd>,</kbd><kbd>.</kbd> tip · <kbd>T</kbd><kbd>Y</kbd> roll · ` +
            `<kbd>-</kbd><kbd>=</kbd> size (hold them) · <kbd>Shift</kbd> for ` +
            `a tenth of a step · <kbd>B</kbd> switches between the two ` +
            `captures · <kbd>P</kbd> copies the block above</p>` +
            `<p>Size and turn act about the circle, so the panel stays put ` +
            `while it grows. <code>__align.set({ scale: 0.8 })</code> in the ` +
            `console for an exact number. Paste the block into ` +
            `<code>overlays.config.json</code>, then ` +
            `<code>npm run build:masks</code>.</p>` +
            `<p>Walk about with <kbd>WASD</kbd> and drag to look, as usual — ` +
            `check the fit from more than one place before trusting it.</p>`;
    }

    const onKeyDown = (event) => {
        if (event.metaKey || event.ctrlKey || event.altKey) return;
        const key = event.key.toLowerCase();
        const fine = event.shiftKey ? FINE : 1;
        const m = STEP_M * fine;
        const deg = STEP_DEG * fine;

        let change = null;
        switch (key) {
            case "i": change = { position: [m, 0, 0] }; break;
            case "k": change = { position: [-m, 0, 0] }; break;
            case "l": change = { position: [0, 0, m] }; break;
            case "j": change = { position: [0, 0, -m] }; break;
            case "u": change = { position: [0, m, 0] }; break;
            case "o": change = { position: [0, -m, 0] }; break;
            case "m": change = { rotation: [0, deg, 0] }; break;
            case "n": change = { rotation: [0, -deg, 0] }; break;
            case ".": change = { rotation: [deg, 0, 0] }; break;
            case ",": change = { rotation: [-deg, 0, 0] }; break;
            case "y": change = { rotation: [0, 0, deg] }; break;
            case "t": change = { rotation: [0, 0, -deg] }; break;
            case "=":
            case "+": change = { scale: STEP_SCALE ** fine }; break;
            case "-":
            case "_": change = { scale: STEP_SCALE ** -fine }; break;
            case "b":
                mix = (mix + 1) % MIXES.length;
                applyMix();
                draw();
                return;
            case "p": {
                const place = overlay.placementOf(hotspot.id);
                if (!place) return;
                const text = snippet(place);
                console.log(text);
                // Clipboard access can be refused — an insecure origin, or a
                // browser that wants a user gesture it does not count a
                // keypress as. The block is on screen either way, so a
                // refusal costs a selection rather than the work.
                navigator.clipboard?.writeText(text).then(
                    () => {
                        copied = Date.now();
                        draw();
                    },
                    () => {},
                );
                return;
            }
            default:
                return;
        }

        event.preventDefault();
        // Turn and grow about the hotspot, not about the detail capture's own
        // origin — so the panel stays under the cursor while its size
        // changes. See overlay.nudge.
        overlay.nudge(hotspot.id, change, hotspot.position);
        applyMix();
        draw();
        invalidate();
    };

    window.addEventListener("keydown", onKeyDown);
    draw();
    console.log(
        `Align mode on ${hotspot.id}. IJKL/UO move, N/M yaw, -/= scale, ` +
            `Shift for a tenth of a step, B cycles the view, P prints the ` +
            `scene.js block. window.__align.print() does the same.`,
    );

    return {
        // The detail capture arrives seconds after the page does, so the first
        // draw has nothing to show and this is how the panel catches up.
        refresh() {
            applyMix();
            draw();
        },
        print() {
            const place = overlay.placementOf(hotspot.id);
            if (place) console.log(snippet(place));
            return place;
        },
        // __align.set({ scale: 0.8 }) and the like, for a number you already
        // know. Scale and rotation go about the hotspot, as the keys do.
        set(values) {
            const place = overlay.placementOf(hotspot.id);
            if (!place) return null;
            if (values.scale !== undefined || values.rotation !== undefined) {
                overlay.nudge(
                    hotspot.id,
                    {
                        scale:
                            values.scale !== undefined
                                ? values.scale / place.scale
                                : undefined,
                        rotation:
                            values.rotation !== undefined
                                ? values.rotation.map((v, i) => v - place.rotation[i])
                                : undefined,
                    },
                    hotspot.position,
                );
            }
            if (values.position !== undefined) {
                overlay.set(hotspot.id, { position: values.position.slice() });
            }
            applyMix();
            draw();
            invalidate();
            return overlay.placementOf(hotspot.id);
        },
        dispose() {
            window.removeEventListener("keydown", onKeyDown);
            panel.remove();
        },
    };
}
