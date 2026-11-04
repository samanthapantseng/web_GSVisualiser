import * as THREE from "three";

// ---------------------------------------------------------------------------
// One reading of an overlay's placement, shared by everything that needs it.
//
// Imported by the runtime and by tools/build-overlay-masks.js under Node. The
// mask is baked in world metres from the transform in overlays.config.json,
// and the runtime draws the overlay with the same transform: if the two ever
// computed it differently the mask would sit beside the overlay rather than
// under it, and the symptom — base splats showing along one edge — reads as a
// dilation problem rather than as the mismatch it is.
//
// So there is one function, and both callers use it.
// ---------------------------------------------------------------------------

const UP_VECTORS = {
    "+x": [1, 0, 0],
    "-x": [-1, 0, 0],
    "+y": [0, 1, 0],
    "-y": [0, -1, 0],
    "+z": [0, 0, 1],
    "-z": [0, 0, -1],
};

// Brings a capture's own up axis onto world +Y. The same rotation the base
// capture gets in src/viewer.js, for the same reason: everything downstream
// assumes world up is +Y.
export function upQuaternion(upAxis) {
    const axis = UP_VECTORS[String(upAxis).toLowerCase()] || UP_VECTORS["+y"];
    return new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(...axis),
        new THREE.Vector3(0, 1, 0),
    );
}

// The placement rotation, from euler degrees or from a quaternion. Euler is
// what align mode prints and what a person can read; the quaternion is there
// for anything exported from other tooling.
export function placementQuaternion({ rotation, quaternion }) {
    if (quaternion) return new THREE.Quaternion().fromArray(quaternion);
    const [x = 0, y = 0, z = 0] = rotation ?? [];
    return new THREE.Quaternion().setFromEuler(
        new THREE.Euler(
            THREE.MathUtils.degToRad(x),
            THREE.MathUtils.degToRad(y),
            THREE.MathUtils.degToRad(z),
            "YXZ",
        ),
    );
}

// The full data-space to world-space matrix for an overlay:
//
//     world = T(position) * R(rotation) * S(scale) * R(upAxis)
//
// The up-axis correction is innermost because it is a property of the export
// rather than of the fit — see the note in src/overlay/OverlayManager.js. The
// runtime builds the same thing out of nested Object3Ds so that the two
// rotations stay separately readable; this is the flattened form, which is
// what the mask builder wants for transforming a million splat centres.
export function overlayMatrix(spec) {
    return new THREE.Matrix4()
        .compose(
            new THREE.Vector3().fromArray(spec.position ?? [0, 0, 0]),
            placementQuaternion(spec),
            new THREE.Vector3().setScalar(spec.scale ?? 1),
        )
        .multiply(
            new THREE.Matrix4().makeRotationFromQuaternion(
                upQuaternion(spec.upAxis),
            ),
        );
}

// Overlay ids, in the order their bits appear in the mask. The bit index is
// positional, so reordering the array in overlays.config.json invalidates
// every baked mask — which is why the mask's own JSON carries this list back,
// and the loader checks it.
export function overlayIds(config) {
    return config.overlays.map((o) => o.id);
}

export const GRID_DEFAULTS = {
    cellSize: 0.08,
    dilation: 2,
    minOpacity: 0.05,
};

export function gridSettings(config) {
    return { ...GRID_DEFAULTS, ...(config.grid ?? {}) };
}
