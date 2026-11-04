#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { installNodeWorker } from "./lib/node-worker-shim.js";
import { upQuaternion } from "../src/overlay/placement.js";
import { TRAM } from "../src/scene.js";

// ---------------------------------------------------------------------------
// Delete the base splats that an overlay permanently hides.
//
//   npm run bake:base -- [--in public/data/flexity_tram.spz] [--out <path>]
//
// The runtime cutout in src/overlay/baseCutoutModifier.js multiplies hidden
// splats down to zero alpha. That is what makes a fade possible, and it is
// also what makes it cost something: a splat at zero alpha is still selected
// by the level-of-detail tree, still sorted and still rasterised. On a desktop
// that is invisible; on a Quest it is budget spent on nothing.
//
// So once a layout has stopped moving, the overlays that will never fade back
// out — `bakeCut: true` in overlays.config.json — can have their holes cut
// into the base capture for good. The runtime cutout then has nothing to do
// for them, and the splats are gone rather than transparent.
//
// This never overwrites its input. The original stays; a new file appears
// beside it.
//
// It does not produce a .rad. Spark's own `build-lod` is a script inside
// Spark's repository, not something the published package exposes — there is
// no `bin` entry — so there is nothing here to call. It does not matter for
// this project: src/viewer.js loads the capture with `lod: true` and Spark
// builds the tree in a worker at load time, from whatever .spz it is given.
// A project that genuinely needs .rad has to run build-lod from a checkout of
// Spark itself, with this file's output as the input.
// ---------------------------------------------------------------------------

installNodeWorker();

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

const { PackedSplats, writeSpz } = await import(
    resolve(ROOT, "node_modules/@sparkjsdev/spark/dist/spark.module.js")
);

function arg(name, fallback) {
    const at = process.argv.indexOf(`--${name}`);
    return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
}

async function main() {
    const config = JSON.parse(
        readFileSync(resolve(ROOT, "public/overlays.config.json"), "utf8"),
    );
    const meta = JSON.parse(
        readFileSync(resolve(ROOT, "public/masks/overlay-mask.json"), "utf8"),
    );
    const bits = new Uint8Array(
        readFileSync(resolve(ROOT, "public/masks/overlay-mask.bin")),
    );

    // Only the overlays marked permanent. An overlay that can be faded out
    // again must keep its base splats, or closing it leaves a hole.
    let wanted = 0;
    const baked = [];
    meta.overlays.forEach((id, index) => {
        const spec = config.overlays.find((o) => o.id === id);
        if (!spec?.bakeCut) return;
        wanted |= 1 << index;
        baked.push(id);
    });

    if (!wanted) {
        console.log(
            'No overlays have "bakeCut": true in overlays.config.json, so there ' +
                "is nothing permanent to cut. Set it on the ones that will never " +
                "fade back out, then run this again.",
        );
        return;
    }

    const inPath = resolve(ROOT, arg("in", "public/data/flexity_tram.spz"));
    const outPath = resolve(
        ROOT,
        arg("out", inPath.replace(/\.spz$/i, "") + "-cut.spz"),
    );
    if (outPath === inPath) throw new Error("Refusing to overwrite the input");

    console.log(
        `Cutting [${baked.join(", ")}] out of ${inPath}\n` +
            `Mask: ${meta.dimensions.join(" x ")} cells of ${meta.cellSize} m\n`,
    );

    const source = new PackedSplats({
        fileBytes: new Uint8Array(readFileSync(inPath)),
        fileType: "spz",
    });
    await source.initialized;

    const [nx, ny, nz] = meta.dimensions;
    const origin = new THREE.Vector3().fromArray(meta.origin);
    const inv = 1 / meta.cellSize;

    // The base capture's own data space is NOT world space, and forgetting
    // that cuts nothing at all — which is exactly what the first version of
    // this did. src/viewer.js stands the capture upright before anything else
    // sees it, and this scan is -y up: a 180 degree turn about Z. A centre
    // read straight out of the file is therefore up to forty metres away from
    // where the mask expects it, every test misses, and the tool reports a
    // clean run having done nothing.
    //
    // The runtime has the same problem and solves it by running the cutout as
    // a worldModifier, after Spark has applied the transform. Here there is
    // no Spark to do it, so it is applied by hand — from src/scene.js, so the
    // two cannot disagree.
    const baseMatrix = new THREE.Matrix4().makeRotationFromQuaternion(
        upQuaternion(TRAM.upAxis),
    );
    if (TRAM.heading) {
        baseMatrix.premultiply(
            new THREE.Matrix4().makeRotationY(
                THREE.MathUtils.degToRad(TRAM.heading),
            ),
        );
    }
    if ((TRAM.origin ?? "floor") !== "data" || (TRAM.worldHeight ?? 0) > 0) {
        throw new Error(
            `This tool only handles a base capture left at its own origin and ` +
                `scale (origin: "data", worldHeight: 0), which is what ` +
                `src/scene.js has. Yours is origin: "${TRAM.origin}", ` +
                `worldHeight: ${TRAM.worldHeight}. Those modes need the capture's ` +
                `measured bounds to place it, which means a pass over the splats ` +
                `before this one.`,
        );
    }

    const out = new PackedSplats({ maxSplats: source.numSplats });
    const world = new THREE.Vector3();
    let kept = 0;
    let cut = 0;

    source.forEachSplat((_i, centre, scales, quaternion, opacity, colour) => {
        world.copy(centre).applyMatrix4(baseMatrix);
        const ix = Math.floor((world.x - origin.x) * inv);
        const iy = Math.floor((world.y - origin.y) * inv);
        const iz = Math.floor((world.z - origin.z) * inv);
        const inside =
            ix >= 0 && iy >= 0 && iz >= 0 && ix < nx && iy < ny && iz < nz;
        if (inside && bits[(iz * ny + iy) * nx + ix] & wanted) {
            cut += 1;
            return;
        }
        // Written back in the capture's own coordinates, not world: the file
        // this produces is a drop-in replacement for the one it read, and
        // src/viewer.js will stand it upright exactly as before.
        out.pushSplat(centre, scales, quaternion, opacity, colour);
        kept += 1;
    });

    console.log(
        `${source.numSplats.toLocaleString()} splats in, ` +
            `${cut.toLocaleString()} cut (${((100 * cut) / source.numSplats).toFixed(2)}%), ` +
            `${kept.toLocaleString()} kept`,
    );

    // Spherical harmonics are not carried through pushSplat. This export is
    // shDegree 0 — there are none — so nothing is lost here; a capture with
    // harmonics would come out flat-shaded and this would need rewriting
    // against the packed arrays directly.
    // getNumSh() is how many coefficients the file actually carries. maxSh is
    // the ceiling Spark is willing to decode, which defaults to 3 whatever
    // the file holds — reading that instead warns about losing harmonics on
    // every capture, including the ones that have none.
    const numSh = source.getNumSh?.() ?? 0;
    if (numSh > 0) {
        console.warn(
            `  WARNING: the input carries ${numSh} SH coefficients, which this ` +
                `does not preserve. The output will have no view-dependent colour.`,
        );
    }

    const { fileBytes } = await writeSpz(out);
    writeFileSync(outPath, fileBytes);
    console.log(
        `\nWrote ${outPath} (${(fileBytes.byteLength / 1048576).toFixed(1)} MB)\n` +
            `Point src/scene.js at it, and set "bakeCut" overlays' runtime cutout ` +
            `aside: their splats are gone now, not hidden.`,
    );
}

await main();
process.exit(0);
