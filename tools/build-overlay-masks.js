#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { installNodeWorker } from "./lib/node-worker-shim.js";
import {
    gridSettings,
    overlayIds,
    overlayMatrix,
} from "../src/overlay/placement.js";

// ---------------------------------------------------------------------------
// Bake the occupancy mask that tells the runtime which base splats to hide.
//
//   npm run build:masks
//
// For each overlay in overlays.config.json: decode its capture, throw away the
// faint splats, put every remaining centre through the overlay's world
// transform, and mark the grid cell it lands in. One shared grid covers the
// union of every overlay's bounds, and each cell holds a bitmask of which
// overlays reach it — so two overlays that touch can still be faded
// independently, which a single occupied/empty flag could not express.
//
// Why a grid and not a box: the whole point is that nothing is measured by
// hand. The cut follows whatever the detail capture actually contains.
//
// Why offline and not at load: the runtime would otherwise walk a million
// splat centres on the CPU every time the page opens, which on a Quest is the
// difference between a scene that starts and one that hangs. The cost here is
// that the mask goes stale if a placement changes — hence the transform
// living in overlays.config.json and being read by both sides, and the
// fingerprint written into the mask's JSON.
// ---------------------------------------------------------------------------

installNodeWorker();

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

// Imported after the shim is installed. Spark captures no globals at module
// scope, but keeping the order explicit means the next person does not have
// to know that.
const { PackedSplats } = await import(
    resolve(ROOT, "node_modules/@sparkjsdev/spark/dist/spark.module.js")
);

// Uint8 cells, so eight overlays. Going past that means Uint16 cells and a
// second texture channel at the other end; the loader and the modifier both
// read the width out of the JSON rather than assuming, so the change is
// contained, but it is not free and nothing here does it for you.
const MAX_OVERLAYS = 8;

// Refuse to write something that will not fit in a Quest's texture budget.
const SIZE_WARN_MB = 16;

function fileTypeOf(path) {
    const ext = path.toLowerCase().split(".").pop();
    if (ext === "spz") return "spz";
    if (ext === "ply") return "ply";
    if (ext === "splat") return "splat";
    if (ext === "ksplat") return "ksplat";
    if (ext === "rad") return "rad";
    throw new Error(`Don't know how to read ${path}`);
}

async function readCentres(spec, minOpacity) {
    const path = resolve(ROOT, spec.source);
    const bytes = new Uint8Array(readFileSync(path));
    const splats = new PackedSplats({
        fileBytes: bytes,
        fileType: fileTypeOf(path),
    });
    await splats.initialized;

    const matrix = overlayMatrix(spec);
    const centres = new Float32Array(splats.numSplats * 3);
    const point = new THREE.Vector3();
    let kept = 0;
    let faint = 0;

    splats.forEachSplat((_index, centre, _scales, _quaternion, opacity) => {
        // Faint splats are the haze a close-range capture leaves around
        // itself. They carry no surface and they are everywhere, so counting
        // them would inflate the cut far past the thing being scanned.
        if (opacity < minOpacity) {
            faint += 1;
            return;
        }
        point.copy(centre).applyMatrix4(matrix);
        if (!Number.isFinite(point.x)) return;
        centres[kept * 3 + 0] = point.x;
        centres[kept * 3 + 1] = point.y;
        centres[kept * 3 + 2] = point.z;
        kept += 1;
    });

    return {
        centres: centres.subarray(0, kept * 3),
        kept,
        faint,
        total: splats.numSplats,
    };
}

// Grow the set by `cells` in every direction, so that a coarse LoD splat whose
// centre sits just outside the capture still gets cut. Done as three 1D passes
// rather than one 3D neighbourhood: the result is identical for a box kernel
// and it is O(n * r) instead of O(n * r^3).
function dilate(bits, nx, ny, nz, cells) {
    if (cells <= 0) return bits;
    let source = bits;
    const at = (x, y, z) => (z * ny + y) * nx + x;

    for (const axis of [0, 1, 2]) {
        const out = new Uint8Array(source.length);
        const limit = [nx, ny, nz][axis];
        for (let z = 0; z < nz; z += 1) {
            for (let y = 0; y < ny; y += 1) {
                for (let x = 0; x < nx; x += 1) {
                    const here = [x, y, z];
                    let acc = 0;
                    const from = Math.max(0, here[axis] - cells);
                    const to = Math.min(limit - 1, here[axis] + cells);
                    for (let i = from; i <= to; i += 1) {
                        const probe = [...here];
                        probe[axis] = i;
                        acc |= source[at(probe[0], probe[1], probe[2])];
                    }
                    out[at(x, y, z)] = acc;
                }
            }
        }
        source = out;
    }
    return source;
}

async function main() {
    const configPath = resolve(ROOT, "overlays.config.json");
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    const { cellSize, dilation, minOpacity } = gridSettings(config);
    const overlays = config.overlays ?? [];

    if (!overlays.length) throw new Error("No overlays in overlays.config.json");
    if (overlays.length > MAX_OVERLAYS) {
        throw new Error(
            `${overlays.length} overlays, but a Uint8 cell holds ${MAX_OVERLAYS}. ` +
                `Widen the cell to Uint16 in this script, in src/overlay/maskLoader.js ` +
                `and in src/overlay/baseCutoutModifier.js.`,
        );
    }

    console.log(
        `Reading ${overlays.length} overlay(s) · cell ${cellSize} m · ` +
            `dilation ${dilation} cell(s) · minOpacity ${minOpacity}\n`,
    );

    // Pass one: decode everything and find the union of the bounds. The grid
    // cannot be sized until every capture has been read, and the captures are
    // small enough to hold all at once — if that ever stops being true this
    // becomes two passes over the files instead of one.
    const read = [];
    const union = new THREE.Box3();
    for (const spec of overlays) {
        const result = await readCentres(spec, minOpacity);
        read.push({ spec, ...result });
        for (let i = 0; i < result.kept; i += 1) {
            union.expandByPoint(
                new THREE.Vector3(
                    result.centres[i * 3],
                    result.centres[i * 3 + 1],
                    result.centres[i * 3 + 2],
                ),
            );
        }
        console.log(
            `  ${spec.id}: ${result.total.toLocaleString()} splats, ` +
                `${result.faint.toLocaleString()} too faint, ` +
                `${result.kept.toLocaleString()} kept`,
        );
    }

    // A margin of the dilation plus one cell, so growing the set never runs
    // off the edge of the grid and quietly clips the cut.
    const pad = cellSize * (dilation + 1);
    union.min.subScalar(pad);
    union.max.addScalar(pad);

    const origin = union.min.clone();
    const size = union.getSize(new THREE.Vector3());
    const nx = Math.max(1, Math.ceil(size.x / cellSize));
    const ny = Math.max(1, Math.ceil(size.y / cellSize));
    const nz = Math.max(1, Math.ceil(size.z / cellSize));
    const cells = nx * ny * nz;

    // Count first, then threshold. A cell holding one splat is not evidence
    // of a surface.
    //
    // This is the knob that decides whether the cut is the thing you scanned
    // or the room around it. A close-range capture of a hatch is not only the
    // hatch: it carries the panel hanging open, and a halo of thin, badly
    // reconstructed haze reaching a metre or more in every direction. Faint
    // splats are already gone by `minOpacity`, but the haze is not all faint —
    // it is sparse. On this scan, counting every occupied cell cuts a block
    // 2.8 x 2.6 x 3.0 m reaching from the roof down past the driver's seat;
    // asking for a few splats per cell leaves the panel and drops the haze,
    // because a real surface puts dozens of splats through an 8 cm cell and
    // haze puts one or two.
    //
    // 1 is the behaviour you get without a threshold at all, and it is the
    // default so that this does nothing you did not ask for.
    const minCellSplats = Math.max(1, gridSettings(config).minCellSplats ?? 1);
    let bits = new Uint8Array(cells);
    const counts = new Uint16Array(cells);
    for (const [index, entry] of read.entries()) {
        const bit = 1 << index;
        counts.fill(0);
        for (let i = 0; i < entry.kept; i += 1) {
            const ix = Math.floor((entry.centres[i * 3] - origin.x) / cellSize);
            const iy = Math.floor((entry.centres[i * 3 + 1] - origin.y) / cellSize);
            const iz = Math.floor((entry.centres[i * 3 + 2] - origin.z) / cellSize);
            if (ix < 0 || iy < 0 || iz < 0) continue;
            if (ix >= nx || iy >= ny || iz >= nz) continue;
            const k = (iz * ny + iy) * nx + ix;
            if (counts[k] < 65535) counts[k] += 1;
        }
        let dropped = 0;
        for (let k = 0; k < cells; k += 1) {
            if (counts[k] === 0) continue;
            if (counts[k] >= minCellSplats) bits[k] |= bit;
            else dropped += 1;
        }
        if (minCellSplats > 1) {
            console.log(
                `  ${entry.spec.id}: dropped ${dropped.toLocaleString()} cells ` +
                    `under ${minCellSplats} splats`,
            );
        }
    }

    const beforeDilation = bits.reduce((n, v) => n + (v ? 1 : 0), 0);
    bits = dilate(bits, nx, ny, nz, dilation);

    // -----------------------------------------------------------------------
    // Stats
    //
    // The occupied bounds per overlay are not decoration. A detail capture
    // carries more than the thing it was pointed at — a hinged panel hanging
    // open, a halo of badly reconstructed surroundings — and all of it cuts.
    // These numbers are how you notice that the cut reaches somewhere it
    // should not before you notice it as a hole in the scene.
    // -----------------------------------------------------------------------
    console.log(
        `\nGrid: ${nx} x ${ny} x ${nz} = ${cells.toLocaleString()} cells ` +
            `of ${cellSize} m\n` +
            `Origin: (${origin.toArray().map((v) => v.toFixed(3)).join(", ")}) m\n` +
            `Occupied: ${beforeDilation.toLocaleString()} cells, ` +
            `${bits.reduce((n, v) => n + (v ? 1 : 0), 0).toLocaleString()} after ` +
            `dilation (${((100 * bits.reduce((n, v) => n + (v ? 1 : 0), 0)) / cells).toFixed(1)}%)`,
    );

    for (const [index, entry] of read.entries()) {
        const bit = 1 << index;
        const box = new THREE.Box3();
        let count = 0;
        for (let z = 0; z < nz; z += 1) {
            for (let y = 0; y < ny; y += 1) {
                for (let x = 0; x < nx; x += 1) {
                    if (!(bits[(z * ny + y) * nx + x] & bit)) continue;
                    count += 1;
                    box.expandByPoint(
                        new THREE.Vector3(
                            origin.x + x * cellSize,
                            origin.y + y * cellSize,
                            origin.z + z * cellSize,
                        ),
                    );
                }
            }
        }
        const extent = box.getSize(new THREE.Vector3());
        console.log(
            `  ${entry.spec.id}: ${count.toLocaleString()} cells, cutting ` +
                `${extent.x.toFixed(2)} x ${extent.y.toFixed(2)} x ${extent.z.toFixed(2)} m ` +
                `from (${box.min.toArray().map((v) => v.toFixed(2)).join(", ")}) ` +
                `to (${box.max.toArray().map((v) => v.toFixed(2)).join(", ")})`,
        );
    }

    const megabytes = bits.byteLength / (1024 * 1024);
    console.log(`\nMask: ${megabytes.toFixed(2)} MB`);
    if (megabytes > SIZE_WARN_MB) {
        const wanted = cellSize * Math.cbrt(megabytes / SIZE_WARN_MB);
        console.warn(
            `  WARNING: over the ${SIZE_WARN_MB} MB target. A cellSize of about ` +
                `${wanted.toFixed(3)} m would bring it under; coarser cells mean a ` +
                `blockier cut edge, which dilation cannot undo.`,
        );
    }

    const outDir = resolve(ROOT, "public/masks");
    mkdirSync(outDir, { recursive: true });
    writeFileSync(resolve(outDir, "overlay-mask.bin"), bits);
    writeFileSync(
        resolve(outDir, "overlay-mask.json"),
        `${JSON.stringify(
            {
                version: 1,
                origin: origin.toArray(),
                cellSize,
                dilation,
                minOpacity,
                dimensions: [nx, ny, nz],
                // Positional: bit i belongs to overlays[i]. The loader checks
                // this against overlays.config.json and refuses a mask that
                // was baked against a different list, because the failure is
                // otherwise invisible — the wrong overlay's cells fade.
                overlays: overlayIds(config),
                bits: 8,
            },
            null,
            4,
        )}\n`,
    );
    console.log(`Wrote public/masks/overlay-mask.{bin,json}`);
}

await main();
// Spark's worker pool keeps its threads alive, and node will not exit while
// they are up.
process.exit(0);
