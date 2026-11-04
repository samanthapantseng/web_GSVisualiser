import * as THREE from "three";
import { dyno } from "@sparkjsdev/spark";

const {
    Dyno,
    Gsplat,
    dynoUsampler3D,
    dynoVec3,
    dynoVec4,
    dynoIvec3,
    dynoFloat,
    unindentLines,
} = dyno;

// ---------------------------------------------------------------------------
// Hiding the base splats under an overlay.
//
// A Spark `worldModifier` on the base capture. One texture fetch per splat
// into the baked occupancy grid, and the splat's alpha is multiplied down by
// however visible the overlays occupying that cell are.
//
// It has to be a worldModifier rather than an objectModifier. Spark runs
// object modifiers before `transform.applyGsplat` and world modifiers after
// it, so only the world modifier sees a centre in the coordinates the mask
// was baked in. An object modifier would be reading the mask with the
// capture's own untransformed coordinates and cutting nothing, or cutting
// somewhere arbitrary.
//
// Running per splat in the generator also means it follows the level-of-detail
// tree for free: whatever splats Spark picks this frame, near or far, coarse
// or fine, each is tested on its own centre. There is no separate path for the
// merged parent splats that stand in for a whole region at distance — which
// matters, because those are exactly the ones that bleed past a cut edge, and
// why `dilation` exists in the mask builder.
//
// The cut is a per-overlay maximum rather than a sum, so where two overlays
// share a cell the base stays hidden until both have faded out. A sum would
// take the alpha past zero and back, and two overlapping overlays at half
// visibility would erase the base entirely.
//
// What this does not do is reclaim the hidden splats' cost. They are still
// selected, still sorted, still rasterised — at zero alpha. tools/bake-base-cut.js
// is the answer for a layout that has stopped moving.
// ---------------------------------------------------------------------------

// Bits per cell. Raising it means a wider texture format here, in
// src/overlay/maskLoader.js and in tools/build-overlay-masks.js.
export const MAX_OVERLAYS = 8;

const CUT_GLSL = `
float overlayCutAt(
    usampler3D maskTex, vec3 pos, vec3 maskOrigin, float invCell, ivec3 dims,
    vec4 visLow, vec4 visHigh
) {
    ivec3 cell = ivec3(floor((pos - maskOrigin) * invCell));
    // Outside the baked volume the base capture is untouched. Most of a
    // forty-metre vehicle is outside it, so this is the common path.
    if (any(lessThan(cell, ivec3(0))) || any(greaterThanEqual(cell, dims))) {
        return 0.0;
    }
    uint bits = texelFetch(maskTex, cell, 0).r;
    if (bits == 0u) {
        return 0.0;
    }
    float cut = 0.0;
    if ((bits & 1u) != 0u) { cut = max(cut, visLow.x); }
    if ((bits & 2u) != 0u) { cut = max(cut, visLow.y); }
    if ((bits & 4u) != 0u) { cut = max(cut, visLow.z); }
    if ((bits & 8u) != 0u) { cut = max(cut, visLow.w); }
    if ((bits & 16u) != 0u) { cut = max(cut, visHigh.x); }
    if ((bits & 32u) != 0u) { cut = max(cut, visHigh.y); }
    if ((bits & 64u) != 0u) { cut = max(cut, visHigh.z); }
    if ((bits & 128u) != 0u) { cut = max(cut, visHigh.w); }
    return cut;
}
`;

// Seven fetches instead of one, averaged over the cell and its six face
// neighbours. Compiled in or out rather than branched on a uniform, because a
// uniform branch costs the fetches on every splat whether or not it is taken.
// Switching it recompiles the generator, so it is a startup setting.
const SOFT_GLSL = `
float overlayCutSoft(
    usampler3D maskTex, vec3 pos, vec3 maskOrigin, float invCell, ivec3 dims,
    vec4 visLow, vec4 visHigh, float cellSize
) {
    float total = overlayCutAt(maskTex, pos, maskOrigin, invCell, dims, visLow, visHigh);
    total += overlayCutAt(maskTex, pos + vec3( cellSize, 0.0, 0.0), maskOrigin, invCell, dims, visLow, visHigh);
    total += overlayCutAt(maskTex, pos + vec3(-cellSize, 0.0, 0.0), maskOrigin, invCell, dims, visLow, visHigh);
    total += overlayCutAt(maskTex, pos + vec3(0.0,  cellSize, 0.0), maskOrigin, invCell, dims, visLow, visHigh);
    total += overlayCutAt(maskTex, pos + vec3(0.0, -cellSize, 0.0), maskOrigin, invCell, dims, visLow, visHigh);
    total += overlayCutAt(maskTex, pos + vec3(0.0, 0.0,  cellSize), maskOrigin, invCell, dims, visLow, visHigh);
    total += overlayCutAt(maskTex, pos + vec3(0.0, 0.0, -cellSize), maskOrigin, invCell, dims, visLow, visHigh);
    return total / 7.0;
}
`;

export function createBaseCutout({ mask, softEdge = false }) {
    const uniforms = {
        maskTex: dynoUsampler3D(mask.texture, "overlayMask"),
        origin: dynoVec3(mask.origin.clone(), "overlayMaskOrigin"),
        invCell: dynoFloat(1 / mask.cellSize, "overlayMaskInvCell"),
        cellSize: dynoFloat(mask.cellSize, "overlayMaskCellSize"),
        dims: dynoIvec3(
            new THREE.Vector3(
                mask.dimensions.x,
                mask.dimensions.y,
                mask.dimensions.z,
            ),
            "overlayMaskDims",
        ),
        // Two vec4s rather than a float[8]: no array indexing in the shader,
        // no uniform-array quirks across drivers, and the whole visibility
        // state is two uniform writes.
        visLow: dynoVec4(new THREE.Vector4(0, 0, 0, 0), "overlayVisLow"),
        visHigh: dynoVec4(new THREE.Vector4(0, 0, 0, 0), "overlayVisHigh"),
        // The debug kill switch (M). A uniform, not a recompile: one multiply
        // on a value that is almost always 1.
        enabled: dynoFloat(1, "overlayCutEnabled"),
    };

    const modifier = new Dyno({
        inTypes: {
            gsplat: Gsplat,
            maskTex: "usampler3D",
            origin: "vec3",
            invCell: "float",
            cellSize: "float",
            dims: "ivec3",
            visLow: "vec4",
            visHigh: "vec4",
            enabled: "float",
        },
        outTypes: { gsplat: Gsplat },
        globals: () => (softEdge ? [CUT_GLSL, SOFT_GLSL] : [CUT_GLSL]),
        inputs: uniforms,
        statements: ({ inputs, outputs }) => {
            const g = outputs.gsplat;
            const call = softEdge
                ? `overlayCutSoft(${inputs.maskTex}, ${g}.center, ${inputs.origin}, ` +
                  `${inputs.invCell}, ${inputs.dims}, ${inputs.visLow}, ` +
                  `${inputs.visHigh}, ${inputs.cellSize})`
                : `overlayCutAt(${inputs.maskTex}, ${g}.center, ${inputs.origin}, ` +
                  `${inputs.invCell}, ${inputs.dims}, ${inputs.visLow}, ${inputs.visHigh})`;
            return unindentLines(`
                ${g} = ${inputs.gsplat};
                if (isGsplatActive(${g}.flags)) {
                    float overlayCut = ${call} * ${inputs.enabled};
                    ${g}.rgba.a *= (1.0 - overlayCut);
                }
            `);
        },
    });

    const slot = new Map(mask.overlays.map((id, index) => [id, index]));

    // Only ever writes into the two Vector4s already bound to the uniforms,
    // and only tells the mesh when something actually changed. The mesh has
    // to be told: Spark syncs a DynoUniform's value into its GLSL uniform on
    // the generator's update pass, and that pass does not run unless the
    // generator's version has moved. Bumping the version is not a recompile —
    // only `generatorDirty` is, and nothing here touches it.
    function setVisibility(id, value, mesh) {
        const index = slot.get(id);
        if (index === undefined) return false;
        const target = index < 4 ? uniforms.visLow : uniforms.visHigh;
        const key = ["x", "y", "z", "w"][index % 4];
        if (target.value[key] === value) return false;
        target.value[key] = value;
        if (mesh) mesh.needsUpdate = true;
        return true;
    }

    function setEnabled(on, mesh) {
        const next = on ? 1 : 0;
        if (uniforms.enabled.value === next) return false;
        uniforms.enabled.value = next;
        if (mesh) mesh.needsUpdate = true;
        return true;
    }

    return {
        modifier,
        uniforms,
        setVisibility,
        setEnabled,
        get enabled() {
            return uniforms.enabled.value === 1;
        },
        knows: (id) => slot.has(id),
    };
}
