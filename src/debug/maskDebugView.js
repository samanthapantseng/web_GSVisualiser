import * as THREE from "three";

// ---------------------------------------------------------------------------
// The occupancy grid, drawn.
//
// Toggled with G. Draws the occupied cells and, over them, each hull-mode
// overlay's convex hull as a wireframe (from public/masks/overlay-hulls.json,
// fetched on first use). The one way to answer "is the cut where I think it is?"
// without guessing from a hole in the scene — and the thing to reach for when
// a coarse distant splat bleeds past an edge, because it shows directly
// whether `dilation` reaches far enough.
//
// Desktop only, and not because of the draw cost. The boxes are ordinary
// triangles, which means they write depth, which means in a headset they
// occlude the splats around them and the scene stops making sense. On a flat
// screen you can turn them off again; in a headset you have put a wall of
// cubes between yourself and everything else.
//
// One InstancedMesh, built once on first use. A grid of 50k cells with 20k
// occupied is one draw call.
// ---------------------------------------------------------------------------

// Per-overlay colours, so touching overlays are told apart. Cycled if there
// are more overlays than entries.
const COLOURS = [
    0x62b6ff, 0xffb347, 0x7ddf64, 0xff6b9d, 0xc792ea, 0xffd166, 0x4ecdc4, 0xf25c54,
];

// The hull meshes the mask builder writes beside the mask, as wireframes.
// Lines rather than faces, and drawn over everything, because the question
// they answer is "where does the hull reach?" and the answer is usually
// inside or behind a wall.
async function loadHullWireframes({ base, mask }) {
    const response = await fetch(`${base}overlay-hulls.json`);
    if (!response.ok) {
        console.warn(
            `${response.status} fetching overlay-hulls.json; no hulls to draw. ` +
                `Rebuild the mask: npm run build:masks`,
        );
        return [];
    }
    const data = await response.json();
    const same =
        data.overlays.length === mask.overlays.length &&
        data.overlays.every((id, i) => id === mask.overlays[i]);
    if (!same) {
        console.warn(
            `overlay-hulls.json is for [${data.overlays.join(", ")}] but the mask ` +
                `is for [${mask.overlays.join(", ")}]; not drawing hulls. ` +
                `Rebuild: npm run build:masks`,
        );
        return [];
    }

    const lines = [];
    data.hulls.forEach((hull, index) => {
        if (!hull) return;
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute(
            "position",
            new THREE.Float32BufferAttribute(hull.vertices, 3),
        );
        geometry.setIndex(hull.triangles);
        const wire = new THREE.LineSegments(
            new THREE.WireframeGeometry(geometry),
            new THREE.LineBasicMaterial({
                // The overlay's colour washed toward white: the stacked cells
                // underneath are the full colour and close to opaque, and
                // lines of the same hue vanish into them.
                color: new THREE.Color(COLOURS[index % COLOURS.length]).lerp(
                    new THREE.Color(0xffffff),
                    0.75,
                ),
                transparent: true,
                opacity: 1,
                depthTest: false,
                depthWrite: false,
            }),
        );
        geometry.dispose();
        wire.renderOrder = 1000;
        wire.frustumCulled = false;
        wire.name = `hull:${data.overlays[index]}`;
        lines.push(wire);
        console.log(
            `Hull ${data.overlays[index]}: ${hull.vertices.length / 3} vertices, ` +
                `${hull.triangles.length / 3} faces, ${hull.volume} m³`,
        );
    });
    return lines;
}

export function createMaskDebugView({ scene, mask, base = "masks/", onChange }) {
    let mesh = null;
    let built = false;
    // Cells and hulls toggle together.
    const group = new THREE.Group();
    group.name = "mask-debug";
    group.visible = false;
    scene.add(group);

    function build() {
        built = true;
        if (!group.parent) scene.add(group);
        loadHullWireframes({ base, mask })
            .then((lines) => {
                for (const line of lines) group.add(line);
                if (lines.length) onChange?.();
            })
            .catch((error) => console.warn("Could not draw the hulls:", error));

        const [nx, ny, nz] = [
            mask.dimensions.x,
            mask.dimensions.y,
            mask.dimensions.z,
        ];
        const data = mask.texture.image.data;

        const cells = [];
        for (let z = 0; z < nz; z += 1) {
            for (let y = 0; y < ny; y += 1) {
                for (let x = 0; x < nx; x += 1) {
                    const bits = data[(z * ny + y) * nx + x];
                    if (bits) cells.push([x, y, z, bits]);
                }
            }
        }
        if (!cells.length) {
            console.warn("Mask has no occupied cells; nothing to draw.");
            return;
        }

        // Slightly under the cell so the faces of neighbouring cells do not
        // z-fight into a solid grey block.
        const size = mask.cellSize * 0.9;
        const geometry = new THREE.BoxGeometry(size, size, size);
        const material = new THREE.MeshBasicMaterial({
            transparent: true,
            opacity: 0.25,
            depthWrite: false,
            wireframe: false,
        });
        mesh = new THREE.InstancedMesh(geometry, material, cells.length);
        mesh.frustumCulled = false;

        const matrix = new THREE.Matrix4();
        const colour = new THREE.Color();
        const half = mask.cellSize / 2;
        cells.forEach(([x, y, z, bits], i) => {
            matrix.makeTranslation(
                mask.origin.x + x * mask.cellSize + half,
                mask.origin.y + y * mask.cellSize + half,
                mask.origin.z + z * mask.cellSize + half,
            );
            mesh.setMatrixAt(i, matrix);
            // The lowest set bit decides the colour; a shared cell takes the
            // first overlay's, which is enough to see a boundary.
            const first = Math.log2(bits & -bits) | 0;
            mesh.setColorAt(i, colour.setHex(COLOURS[first % COLOURS.length]));
        });
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        group.add(mesh);

        console.log(
            `Mask debug view: ${cells.length.toLocaleString()} occupied cells of ` +
                `${(nx * ny * nz).toLocaleString()}`,
        );
    }

    return {
        toggle() {
            if (!built) build();
            group.visible = !group.visible;
            return group.visible;
        },
        get visible() {
            return group.visible;
        },
        dispose() {
            group.removeFromParent();
            group.traverse((object) => {
                object.geometry?.dispose();
                object.material?.dispose();
            });
            group.clear();
            mesh = null;
            built = false;
        },
    };
}
