import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

// ---------------------------------------------------------------------------
// Navigation. Two modes over one camera, swapped with F.
//
//   orbit   the default, and the only one a visitor needs to find. Drag to
//           turn the tram, scroll to close in, right-drag to slide the centre
//           of rotation.
//   walk    mouse-look and WASD, for getting inside the vehicle. Orbit can be
//           coaxed in there by panning and zooming, but badly: the centre of
//           rotation ends up in a wall and every drag swings the camera
//           through the bodywork.
//
// The VR project solved this with a rig that WebXR moved for it. There is no
// rig here — nothing overwrites camera.matrix on a flat page — so both modes
// drive the camera directly and the mode owns the camera while it is active.
//
// `bounds` is filled in by the viewer once the capture has loaded, and is held
// by reference: it is an empty box until then, so reading it per frame rather
// than capturing its values is what keeps the first few frames sane.
// ---------------------------------------------------------------------------

// Degrees of pitch either side of level that mouse-look allows. Short of
// straight up and down, where the view rolls and a mouse cannot recover it.
const PITCH_LIMIT = THREE.MathUtils.degToRad(88);

// Horizontal field of view, which the vertical one and the window's shape
// decide between them. On a wide window it is the roomier of the two, which
// is what lets a forty-three metre vehicle fit across the frame.
function hFov(camera) {
    const vFov = THREE.MathUtils.degToRad(camera.fov);
    return 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
}

// The camera's right and up axes for a view from `dir` towards the origin.
function cameraBasis(dir) {
    const right = new THREE.Vector3()
        .crossVectors(new THREE.Vector3(0, 1, 0), dir)
        .normalize();
    // Looking straight down leaves the cross product degenerate; any
    // horizontal axis will do there, since every azimuth looks the same.
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
    const up = new THREE.Vector3().crossVectors(dir, right).normalize();
    return { right, up };
}

// The box's eight corners, relative to a point.
function boxCorners(box, origin) {
    if (box.isEmpty()) return [new THREE.Vector3()];
    const corners = [];
    for (const x of [box.min.x, box.max.x]) {
        for (const y of [box.min.y, box.max.y]) {
            for (const z of [box.min.z, box.max.z]) {
                corners.push(new THREE.Vector3(x, y, z).sub(origin));
            }
        }
    }
    return corners;
}

export function createControls({ camera, renderer, bounds, config }) {
    const canvas = renderer.domElement;

    const orbit = new OrbitControls(camera, canvas);
    // Damping is what makes a drag feel like it has weight; it needs
    // orbit.update() every frame, which the viewer's loop does.
    orbit.enableDamping = true;
    orbit.dampingFactor = 0.08;
    // Zoom towards the pointer rather than the centre of rotation, so closing
    // in on a coupling or a door seam does not also re-aim the view.
    orbit.zoomToCursor = true;
    // How far up and down the orbit may be taken. The floor of this range is
    // what keeps the tram upright: OrbitControls already pins the camera's own
    // up to +Y, so the vehicle never rolls, but without a limit the orbit
    // carries on under the floor and round the other side, and a tram seen
    // from beneath reads as having tipped over. Set from pitchRange, which is
    // in degrees above the horizon — the opposite sense to a polar angle, and
    // the one easier to reason about.
    applyPitchRange();
    orbit.mouseButtons = {
        LEFT: THREE.MOUSE.ROTATE,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.PAN,
    };

    // walk mode state. Kept out here so switching modes can hand the camera
    // from one to the other without a jump.
    let mode = "orbit";
    let yaw = 0;
    let pitch = 0;
    const keys = new Set();
    const velocity = new THREE.Vector3();
    const desired = new THREE.Vector3();
    const forward = new THREE.Vector3();
    const right = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const limit = new THREE.Box3();

    function applyPitchRange() {
        const [minPitch, maxPitch] = config.pitchRange;
        // Straight down the vertical axis the azimuth is undefined and the
        // view snaps, so stop just short of the pole however high the range
        // is allowed to go.
        orbit.minPolarAngle = Math.max(
            THREE.MathUtils.degToRad(90 - maxPitch),
            0.02,
        );
        orbit.maxPolarAngle = Math.min(
            THREE.MathUtils.degToRad(90 - minPitch),
            Math.PI - 0.02,
        );
    }

    // -----------------------------------------------------------------------
    // Framing
    // -----------------------------------------------------------------------

    // How far the capture reaches, for the near and far planes and for the
    // orbit's own travel limits. Taken off the box rather than written down,
    // so it still holds if the scan is re-exported at a different crop.
    function span() {
        return bounds.box.isEmpty() ? 10 : bounds.box.getSize(desired).length();
    }

    function setClipPlanes(reach) {
        // Near plane tight enough to stand inside the bodywork without the
        // nearest splats being clipped away, far plane loose enough that
        // backing right off still shows the whole vehicle.
        camera.near = 0.05;
        camera.far = Math.max(reach * 8, 200);
        camera.updateProjectionMatrix();
    }

    // Where the camera sits when the page opens and when R is pressed.
    function reset() {
        if (config.start.mode === "pov") resetPov();
        else resetOrbit();
    }

    // Standing at a point, looking in a direction — the capture's own origin
    // looking down the corridor, in the tram's case. Walk mode, so WASD moves
    // off from there without pressing anything first.
    //
    // The orbit target is parked on the point being looked at, so F hands over
    // to an orbit that turns around what is already in front of you rather
    // than snapping back to wherever the target was last left.
    function resetPov() {
        const { position, lookAt, eyeHeight } = config.start;
        const eye = new THREE.Vector3().fromArray(position);
        const at = new THREE.Vector3().fromArray(lookAt);
        eye.y += eyeHeight;
        at.y += eyeHeight;

        camera.position.copy(eye);
        camera.lookAt(at);
        setClipPlanes(span());

        orbit.target.copy(at);
        orbit.minDistance = 0.25;
        orbit.maxDistance = span() * 3;
        applyPitchRange();

        syncWalkFromCamera();
        enterWalk();
    }

    function resetOrbit() {
        // What the orbit turns around and what the opening shot is framed on.
        // The viewer sets it to the file's own origin or to the middle of the
        // capture, depending on the scene's origin mode.
        const centre = bounds.focus.clone();

        const { elevation, azimuth } = config.framing;
        // Azimuth is three.js's spherical theta, measured from +Z — so 0 is
        // broadside to a vehicle lying along X and 90 is end-on, which is the
        // opposite of what the name suggests.
        const phi = THREE.MathUtils.degToRad(90 - elevation);
        const theta = THREE.MathUtils.degToRad(azimuth);
        // Unit vector from the centre of the capture towards the camera.
        const dir = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);

        // How far back the camera has to stand for the whole capture to fit
        // the frame, from this direction, at this window shape.
        //
        // The obvious answer — fit the bounding sphere — is badly wrong for a
        // tram: forty-three metres long and under three wide means the sphere
        // is mostly empty air, and fitting it leaves the vehicle a thin streak
        // across the middle of the frame. So fit the eight corners of the box
        // instead, which is exact and costs nothing at this frequency.
        const basis = cameraBasis(dir);
        const tanH = Math.tan(hFov(camera) / 2);
        const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);

        let fits = 2;
        for (const corner of boxCorners(bounds.box, centre)) {
            // Depth in front of the camera is (reach - corner·dir), so the
            // half-width available to a corner grows with how far behind the
            // centre plane it sits. Solving each constraint for the reach and
            // taking the largest is what makes every corner land inside.
            const along = corner.dot(dir);
            const x = Math.abs(corner.dot(basis.right));
            const y = Math.abs(corner.dot(basis.up));
            fits = Math.max(fits, x / tanH + along, y / tanV + along);
        }

        // distance is a multiple of that just-fits reach: 1 touches the edges
        // of the frame, above it leaves a margin.
        const reach = Math.max(fits * config.framing.distance, 2);

        applyPitchRange();
        orbit.target.copy(centre);
        camera.position.copy(centre).addScaledVector(dir, reach);
        camera.lookAt(centre);

        setClipPlanes(fits);

        orbit.minDistance = 0.25;
        orbit.maxDistance = fits * 3;
        orbit.update();

        syncWalkFromCamera();
        if (mode === "walk") enterOrbit();
    }

    // -----------------------------------------------------------------------
    // Mode switching
    // -----------------------------------------------------------------------

    // Read the camera's current facing into the yaw/pitch pair walk mode
    // integrates, so entering walk mode keeps the view you were already
    // looking at.
    function syncWalkFromCamera() {
        camera.getWorldDirection(forward);
        yaw = Math.atan2(-forward.x, -forward.z);
        pitch = Math.asin(THREE.MathUtils.clamp(forward.y, -1, 1));
    }

    // Taking the camera, and handing it back. Split from setMode because the
    // opening pose needs to enter walk mode without asking for pointer lock:
    // there has been no user gesture at that point, and a refused lock is an
    // uncaught promise rejection for nothing.
    function enterWalk({ lock = false } = {}) {
        mode = "walk";
        orbit.enabled = false;
        if (lock) lockPointer();
    }

    function enterOrbit({ aimAhead = false } = {}) {
        mode = "orbit";
        document.exitPointerLock?.();
        orbit.enabled = true;
        if (aimAhead) {
            // Put the centre of rotation somewhere plausible ahead of wherever
            // walking ended up, or the first drag swings the camera back to
            // wherever the target was left.
            camera.getWorldDirection(forward);
            const reach = Math.min(8, span() * 0.2);
            orbit.target.copy(camera.position).addScaledVector(forward, reach);
            orbit.update();
        }
        keys.clear();
        dragLooking = false;
        velocity.set(0, 0, 0);
    }

    // What F does.
    function setMode(next) {
        if (next === mode) return;
        if (next === "walk") {
            syncWalkFromCamera();
            enterWalk({ lock: true });
        } else {
            enterOrbit({ aimAhead: true });
        }
    }

    // -----------------------------------------------------------------------
    // Input
    // -----------------------------------------------------------------------

    const onKeyDown = (event) => {
        const key = event.key.toLowerCase();
        if (key === "f") {
            setMode(mode === "walk" ? "orbit" : "walk");
            return;
        }
        if (key === "r") {
            // Back to the opening pose, whichever mode that is.
            reset();
            return;
        }
        keys.add(key);
    };
    const onKeyUp = (event) => keys.delete(event.key.toLowerCase());
    // Losing focus mid-push leaves a key down and the camera sliding away on
    // its own.
    const onBlur = () => {
        keys.clear();
        velocity.set(0, 0, 0);
    };

    // Pointer lock is refused outright in a cross-document iframe, which is
    // where this ends up whenever the viewer is embedded rather than opened in
    // a tab of its own. Dragging to look is the fallback: worse than lock,
    // because the mouse runs out of desk, but it keeps walk mode usable
    // instead of leaving it moving with no way to turn.
    function lockPointer() {
        try {
            const result = canvas.requestPointerLock?.();
            // Newer browsers return a promise; a refusal there is expected, so
            // swallow it rather than letting it surface as an uncaught error.
            result?.catch?.(() => {});
        } catch {
            // Older browsers throw synchronously instead.
        }
    }

    let dragLooking = false;
    const onMouseDown = () => {
        if (mode === "walk") dragLooking = true;
    };
    const onMouseUp = () => {
        dragLooking = false;
    };

    const onMouseMove = (event) => {
        if (mode !== "walk") return;
        const locked = document.pointerLockElement === canvas;
        if (!locked && !dragLooking) return;
        yaw -= event.movementX * config.lookSpeed;
        pitch = THREE.MathUtils.clamp(
            pitch - event.movementY * config.lookSpeed,
            -PITCH_LIMIT,
            PITCH_LIMIT,
        );
    };

    // Clicking the canvas in walk mode takes the pointer back after Escape has
    // released it, which is how anyone will expect to resume.
    const onCanvasClick = () => {
        if (mode === "walk" && document.pointerLockElement !== canvas) {
            lockPointer();
        }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    canvas.addEventListener("mousedown", onMouseDown);
    canvas.addEventListener("click", onCanvasClick);

    // -----------------------------------------------------------------------
    // Per-frame
    // -----------------------------------------------------------------------

    function held(...names) {
        return names.some((name) => keys.has(name));
    }

    function updateWalk(dt) {
        camera.quaternion.setFromEuler(new THREE.Euler(pitch, yaw, 0, "YXZ"));

        camera.getWorldDirection(forward);
        right.crossVectors(forward, up).normalize();

        desired.set(0, 0, 0);
        if (held("w", "arrowup")) desired.add(forward);
        if (held("s", "arrowdown")) desired.sub(forward);
        if (held("d", "arrowright")) desired.add(right);
        if (held("a", "arrowleft")) desired.sub(right);
        if (held("e", " ")) desired.y += 1;
        if (held("q", "shift")) desired.y -= 1;

        if (desired.lengthSq() > 0) {
            desired.normalize().multiplyScalar(config.walkSpeed);
        }

        // Ramp towards the stick rather than snapping to it: a hard start and
        // stop on a mouse-look camera is unpleasant to watch, let alone to use.
        velocity.lerp(desired, Math.min(1, config.accel * dt));
        camera.position.addScaledVector(velocity, dt);

        // Hold the camera within reach of the capture. Outside it there is
        // nothing to see and no landmark to get back by.
        if (!bounds.box.isEmpty()) {
            limit.copy(bounds.box).expandByScalar(config.roam);
            camera.position.clamp(limit.min, limit.max);
        }
    }

    return {
        get mode() {
            return mode;
        },

        update(dt) {
            if (mode === "walk") updateWalk(dt);
            else orbit.update();
        },

        reset,
        setMode,

        readout() {
            const distance = camera.position.distanceTo(orbit.target);
            return mode === "walk"
                ? `walk · ${velocity.length().toFixed(1)} m/s`
                : `orbit · ${distance.toFixed(1)} m out`;
        },

        dispose() {
            window.removeEventListener("keydown", onKeyDown);
            window.removeEventListener("keyup", onKeyUp);
            window.removeEventListener("blur", onBlur);
            window.removeEventListener("mousemove", onMouseMove);
            window.removeEventListener("mouseup", onMouseUp);
            canvas.removeEventListener("mousedown", onMouseDown);
            canvas.removeEventListener("click", onCanvasClick);
            orbit.dispose();
        },
    };
}
