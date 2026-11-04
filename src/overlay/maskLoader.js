import * as THREE from "three";

// ---------------------------------------------------------------------------
// The baked occupancy mask, as something the GPU can read.
//
// tools/build-overlay-masks.js writes a raw Uint8 grid and a JSON header. This
// turns the pair into a Data3DTexture that src/overlay/baseCutoutModifier.js
// samples once per splat.
//
// Nearest filtering and no mipmaps, deliberately: the cell values are a
// bitmask, not a quantity. Averaging bit 1 and bit 2 gives bit 0 and bit 3 —
// the two overlays either side of a boundary would cut each other's cells.
// The texture is read with texelFetch, which ignores filtering entirely, but
// the sampler is set up honestly anyway so that a later change to texture()
// does not quietly produce nonsense.
// ---------------------------------------------------------------------------

export async function loadOverlayMask({ base = "masks/", expectIds }) {
    const [meta, bytes] = await Promise.all([
        fetch(`${base}overlay-mask.json`).then((r) => {
            if (!r.ok) throw new Error(`${r.status} fetching the mask header`);
            return r.json();
        }),
        fetch(`${base}overlay-mask.bin`).then((r) => {
            if (!r.ok) throw new Error(`${r.status} fetching the mask grid`);
            return r.arrayBuffer();
        }),
    ]);

    const [nx, ny, nz] = meta.dimensions;
    const expected = nx * ny * nz;
    if (bytes.byteLength !== expected) {
        throw new Error(
            `Mask is ${bytes.byteLength} bytes but its header says ` +
                `${nx}x${ny}x${nz} = ${expected}. Rebuild it: npm run build:masks`,
        );
    }

    // Bit i belongs to overlays[i], positionally. A mask baked before an
    // overlay was added or reordered will fade the wrong one's cells, and
    // nothing about that looks like a stale file — so refuse it here, where
    // the message can say what to do.
    if (expectIds) {
        const same =
            expectIds.length === meta.overlays.length &&
            expectIds.every((id, i) => id === meta.overlays[i]);
        if (!same) {
            throw new Error(
                `Mask was baked for [${meta.overlays.join(", ")}] but the config ` +
                    `has [${expectIds.join(", ")}]. Rebuild it: npm run build:masks`,
            );
        }
    }

    const texture = new THREE.Data3DTexture(
        new Uint8Array(bytes),
        nx,
        ny,
        nz,
    );
    // Unsigned integer sampling: the shader reads a uvec4 and uses .r as the
    // bitmask. RedIntegerFormat with UnsignedByteType is the one combination
    // that survives the trip without being normalised to 0..1.
    texture.format = THREE.RedIntegerFormat;
    texture.type = THREE.UnsignedByteType;
    texture.internalFormat = "R8UI";
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.wrapR = THREE.ClampToEdgeWrapping;
    texture.generateMipmaps = false;
    texture.unpackAlignment = 1;
    texture.needsUpdate = true;

    return {
        texture,
        origin: new THREE.Vector3().fromArray(meta.origin),
        cellSize: meta.cellSize,
        dimensions: new THREE.Vector3(nx, ny, nz),
        overlays: meta.overlays,
        dilation: meta.dilation,
        bytes: bytes.byteLength,
        meta,
    };
}
