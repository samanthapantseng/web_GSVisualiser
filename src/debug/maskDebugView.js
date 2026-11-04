import * as THREE from "three";

// ---------------------------------------------------------------------------
// The occupancy grid, drawn.
//
// Toggled with G. The one way to answer "is the cut where I think it is?"
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

export function createMaskDebugView({ scene, mask }) {
    let mesh = null;
    let built = false;

    function build() {
        built = true;
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
        mesh.visible = false;
        scene.add(mesh);

        console.log(
            `Mask debug view: ${cells.length.toLocaleString()} occupied cells of ` +
                `${(nx * ny * nz).toLocaleString()}`,
        );
    }

    return {
        toggle() {
            if (!built) build();
            if (!mesh) return false;
            mesh.visible = !mesh.visible;
            return mesh.visible;
        },
        get visible() {
            return mesh?.visible ?? false;
        },
        dispose() {
            if (!mesh) return;
            mesh.removeFromParent();
            mesh.geometry.dispose();
            mesh.material.dispose();
            mesh = null;
            built = false;
        },
    };
}
