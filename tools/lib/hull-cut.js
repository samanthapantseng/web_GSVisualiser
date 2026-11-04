// The package root (dist/index.js) uses extensionless relative imports that
// Node's ESM resolver rejects; the self-contained bundle beside it does not.
import quickhull from "quickhull3d/dist/quickhull3d.js";

// ---------------------------------------------------------------------------
// The geometry behind the "hull" cut mode of tools/build-overlay-masks.js.
//
// A shell cut marks only the cells a capture's splats land in. That is the
// wrong answer whenever the overlay shows *less* than the base in some place:
// the base has a closed door, the overlay is the same door standing open, and
// the doorway in the overlay is air — no splats, no cells, no cut — so the
// base's closed door shows straight through the opening. What has to go is
// the whole volume the overlay spans, empty space included. Its convex hull is
// the simplest volume that says that.
//
// A hull is only as good as its most extreme point, so the centres are
// cleaned before it is built: one stray speck a metre out drags a face of the
// hull with it and cuts a slab out of the wall. Two passes:
//
//   1. statistical outlier removal — per splat, the mean distance to its k
//      nearest neighbours; drop those far above the population's mean. Takes
//      out isolated specks wherever they are.
//   2. keepFraction — keep the given fraction of what is left closest to the
//      median centre. Takes out small, tight clumps far away, which pass 1
//      cannot see because each of their members has close neighbours.
//
// Everything here works on flat Float32Arrays of xyz, the same layout the mask
// builder already holds, and nothing is O(n²): neighbours come from a k-d tree.
// ---------------------------------------------------------------------------

const LEAF = 8;

// Partial sort: after this, idx[k] holds the element that would be there if
// idx[lo..hi] were sorted by coordinate `axis`, with smaller ones before it
// and larger ones after.
function select(idx, pos, lo, hi, k, axis) {
    while (hi > lo) {
        const pivot = pos[idx[(lo + hi) >> 1] * 3 + axis];
        let i = lo;
        let j = hi;
        while (i <= j) {
            while (pos[idx[i] * 3 + axis] < pivot) i += 1;
            while (pos[idx[j] * 3 + axis] > pivot) j -= 1;
            if (i <= j) {
                const t = idx[i];
                idx[i] = idx[j];
                idx[j] = t;
                i += 1;
                j -= 1;
            }
        }
        if (k <= j) hi = j;
        else if (k >= i) lo = i;
        else return;
    }
}

// An implicit, balanced k-d tree: the node for range [lo, hi) is the point at
// its middle, split along the range's widest axis. No node objects, two typed
// arrays, built in O(n log n).
export function buildKdTree(pos, n) {
    const idx = new Uint32Array(n);
    for (let i = 0; i < n; i += 1) idx[i] = i;
    const axisAt = new Uint8Array(n);

    const stack = [0, n];
    while (stack.length) {
        const hi = stack.pop();
        const lo = stack.pop();
        if (hi - lo <= LEAF) continue;
        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
        for (let i = lo; i < hi; i += 1) {
            const p = idx[i] * 3;
            const x = pos[p], y = pos[p + 1], z = pos[p + 2];
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
            if (z < minZ) minZ = z;
            if (z > maxZ) maxZ = z;
        }
        const ex = maxX - minX, ey = maxY - minY, ez = maxZ - minZ;
        const axis = ex >= ey && ex >= ez ? 0 : ey >= ez ? 1 : 2;
        const mid = (lo + hi) >> 1;
        select(idx, pos, lo, hi - 1, mid, axis);
        axisAt[mid] = axis;
        stack.push(lo, mid, mid + 1, hi);
    }
    return { idx, axisAt, pos, n };
}

// Mean Euclidean distance from every point to its k nearest neighbours (the
// point itself excluded). One k-d tree query per point.
export function meanNeighbourDistances(pos, n, k) {
    const tree = buildKdTree(pos, n);
    const { idx, axisAt } = tree;
    const out = new Float32Array(n);
    const kk = Math.min(k, n - 1);
    if (kk <= 0) return out;

    // Max-heap of the k best squared distances so far.
    const heap = new Float64Array(kk);
    let size = 0;
    let qx = 0, qy = 0, qz = 0, self = 0;

    function offer(d) {
        if (size < kk) {
            let i = size;
            size += 1;
            while (i > 0) {
                const parent = (i - 1) >> 1;
                if (heap[parent] >= d) break;
                heap[i] = heap[parent];
                i = parent;
            }
            heap[i] = d;
        } else if (d < heap[0]) {
            let i = 0;
            for (;;) {
                const l = 2 * i + 1;
                if (l >= kk) break;
                const r = l + 1;
                const c = r < kk && heap[r] > heap[l] ? r : l;
                if (heap[c] <= d) break;
                heap[i] = heap[c];
                i = c;
            }
            heap[i] = d;
        }
    }

    function consider(p) {
        if (p === self) return;
        const o = p * 3;
        const dx = pos[o] - qx, dy = pos[o + 1] - qy, dz = pos[o + 2] - qz;
        offer(dx * dx + dy * dy + dz * dz);
    }

    function search(lo, hi) {
        if (hi - lo <= LEAF) {
            for (let i = lo; i < hi; i += 1) consider(idx[i]);
            return;
        }
        const mid = (lo + hi) >> 1;
        const p = idx[mid];
        const axis = axisAt[mid];
        consider(p);
        const q = axis === 0 ? qx : axis === 1 ? qy : qz;
        const diff = q - pos[p * 3 + axis];
        if (diff < 0) {
            search(lo, mid);
            if (size < kk || diff * diff < heap[0]) search(mid + 1, hi);
        } else {
            search(mid + 1, hi);
            if (size < kk || diff * diff < heap[0]) search(lo, mid);
        }
    }

    for (let i = 0; i < n; i += 1) {
        qx = pos[i * 3];
        qy = pos[i * 3 + 1];
        qz = pos[i * 3 + 2];
        self = i;
        size = 0;
        search(0, n);
        let sum = 0;
        for (let j = 0; j < size; j += 1) sum += Math.sqrt(heap[j]);
        out[i] = sum / size;
    }
    return out;
}

function quantile(values, q) {
    if (!values.length) return NaN;
    const sorted = Float32Array.from(values).sort();
    const at = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))));
    return sorted[at];
}

export function medianCentre(pos, n) {
    const axis = new Float32Array(n);
    const out = [0, 0, 0];
    for (let a = 0; a < 3; a += 1) {
        for (let i = 0; i < n; i += 1) axis[i] = pos[i * 3 + a];
        out[a] = quantile(axis, 0.5);
    }
    return out;
}

// Both cleaning passes. Returns the surviving positions, which input index
// each came from (so a hull vertex can be traced back to a splat in the
// capture), and their neighbour distance (so the report can say whether an
// extreme vertex is an isolated speck).
export function cleanCentres(pos, n, { k = 16, outlierStd = 2.0, keepFraction = 0.98 } = {}) {
    // Pass 1: statistical outlier removal.
    const mean = meanNeighbourDistances(pos, n, k);
    let sum = 0;
    let sumSq = 0;
    for (let i = 0; i < n; i += 1) {
        sum += mean[i];
        sumSq += mean[i] * mean[i];
    }
    const mu = sum / n;
    const sigma = Math.sqrt(Math.max(0, sumSq / n - mu * mu));
    const limit = mu + outlierStd * sigma;

    const pass1 = [];
    for (let i = 0; i < n; i += 1) if (mean[i] <= limit) pass1.push(i);

    // Pass 2: keep the closest `keepFraction` to the median centre.
    const m = pass1.length;
    const tmp = new Float32Array(m * 3);
    pass1.forEach((src, j) => {
        tmp[j * 3] = pos[src * 3];
        tmp[j * 3 + 1] = pos[src * 3 + 1];
        tmp[j * 3 + 2] = pos[src * 3 + 2];
    });
    const centre = medianCentre(tmp, m);
    const dist = new Float32Array(m);
    for (let j = 0; j < m; j += 1) {
        const dx = tmp[j * 3] - centre[0];
        const dy = tmp[j * 3 + 1] - centre[1];
        const dz = tmp[j * 3 + 2] - centre[2];
        dist[j] = Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    const radius = keepFraction >= 1 ? Infinity : quantile(dist, keepFraction);

    const keep = [];
    for (let j = 0; j < m; j += 1) if (dist[j] <= radius) keep.push(j);

    const out = new Float32Array(keep.length * 3);
    const source = new Uint32Array(keep.length);
    const neighbourDistance = new Float32Array(keep.length);
    keep.forEach((j, o) => {
        out[o * 3] = tmp[j * 3];
        out[o * 3 + 1] = tmp[j * 3 + 1];
        out[o * 3 + 2] = tmp[j * 3 + 2];
        source[o] = pass1[j];
        neighbourDistance[o] = mean[pass1[j]];
    });

    return {
        positions: out,
        count: keep.length,
        source,
        neighbourDistance,
        centre,
        removedOutliers: n - m,
        removedFar: m - keep.length,
        outlierLimit: limit,
        keepRadius: radius,
    };
}

// The convex hull, as a compact mesh (only the vertices it uses) plus the
// outward face planes the voxelizer tests against. `vertexSource[i]` is the
// index into `pos` of hull vertex i.
export function convexHull(pos, n) {
    if (n < 4) throw new Error(`Need at least 4 points for a hull, have ${n}`);
    const points = new Array(n);
    for (let i = 0; i < n; i += 1) {
        points[i] = [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
    }
    const faces = quickhull(points);
    if (!faces.length) {
        throw new Error("Convex hull is degenerate (the points are coplanar)");
    }

    const remap = new Map();
    const vertexSource = [];
    const triangles = [];
    for (const face of faces) {
        // quickhull3d triangulates by default; fan anything that is not.
        for (let t = 1; t + 1 < face.length; t += 1) {
            for (const v of [face[0], face[t], face[t + 1]]) {
                if (!remap.has(v)) {
                    remap.set(v, vertexSource.length);
                    vertexSource.push(v);
                }
                triangles.push(remap.get(v));
            }
        }
    }
    const vertices = new Float64Array(vertexSource.length * 3);
    vertexSource.forEach((src, i) => {
        vertices[i * 3] = pos[src * 3];
        vertices[i * 3 + 1] = pos[src * 3 + 1];
        vertices[i * 3 + 2] = pos[src * 3 + 2];
    });

    // An interior point to orient the planes against, rather than trusting
    // the library's winding.
    const c = [0, 0, 0];
    for (let i = 0; i < vertexSource.length; i += 1) {
        c[0] += vertices[i * 3];
        c[1] += vertices[i * 3 + 1];
        c[2] += vertices[i * 3 + 2];
    }
    c[0] /= vertexSource.length;
    c[1] /= vertexSource.length;
    c[2] /= vertexSource.length;

    const planes = [];
    let volume = 0;
    for (let t = 0; t < triangles.length; t += 3) {
        const a = triangles[t] * 3, b = triangles[t + 1] * 3, d = triangles[t + 2] * 3;
        const ux = vertices[b] - vertices[a];
        const uy = vertices[b + 1] - vertices[a + 1];
        const uz = vertices[b + 2] - vertices[a + 2];
        const vx = vertices[d] - vertices[a];
        const vy = vertices[d + 1] - vertices[a + 1];
        const vz = vertices[d + 2] - vertices[a + 2];
        let nx = uy * vz - uz * vy;
        let ny = uz * vx - ux * vz;
        let nz = ux * vy - uy * vx;
        const len = Math.hypot(nx, ny, nz);
        if (len < 1e-12) continue;
        nx /= len;
        ny /= len;
        nz /= len;
        let off = nx * vertices[a] + ny * vertices[a + 1] + nz * vertices[a + 2];
        // Distance of the interior point to the plane; positive means the
        // normal points inward, so flip it.
        const sd = nx * c[0] + ny * c[1] + nz * c[2] - off;
        if (sd > 0) {
            nx = -nx;
            ny = -ny;
            nz = -nz;
            off = -off;
        }
        planes.push([nx, ny, nz, off]);
        // Tetrahedron (interior point, triangle): height |sd| times area/3.
        volume += (Math.abs(sd) * len) / 6;
    }

    return { vertices, triangles, vertexSource, planes, volume };
}

// Mark every grid cell whose centre lies inside the hull. Exact, and cheap:
// for each (y, z) row of cells the hull cuts out a single x interval, which
// is the intersection of one inequality per face plane.
export function voxelizeHull(hull, grid, onCell) {
    const { origin, cellSize, nx, ny, nz } = grid;
    const half = cellSize / 2;
    const v = hull.vertices;
    let minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < v.length; i += 3) {
        minY = Math.min(minY, v[i + 1]);
        maxY = Math.max(maxY, v[i + 1]);
        minZ = Math.min(minZ, v[i + 2]);
        maxZ = Math.max(maxZ, v[i + 2]);
    }
    const y0 = Math.max(0, Math.floor((minY - origin.y) / cellSize));
    const y1 = Math.min(ny - 1, Math.floor((maxY - origin.y) / cellSize));
    const z0 = Math.max(0, Math.floor((minZ - origin.z) / cellSize));
    const z1 = Math.min(nz - 1, Math.floor((maxZ - origin.z) / cellSize));
    const EPS = 1e-9;

    let marked = 0;
    for (let iz = z0; iz <= z1; iz += 1) {
        const pz = origin.z + iz * cellSize + half;
        for (let iy = y0; iy <= y1; iy += 1) {
            const py = origin.y + iy * cellSize + half;
            let lo = -Infinity;
            let hi = Infinity;
            for (const [a, b, c, d] of hull.planes) {
                // a*x + b*py + c*pz <= d
                const rhs = d - b * py - c * pz + EPS;
                if (Math.abs(a) < 1e-12) {
                    if (rhs < 0) {
                        lo = Infinity;
                        break;
                    }
                } else if (a > 0) {
                    hi = Math.min(hi, rhs / a);
                } else {
                    lo = Math.max(lo, rhs / a);
                }
                if (lo > hi) break;
            }
            if (lo > hi) continue;
            // Cell centres x = origin.x + (ix + 0.5) * cellSize in [lo, hi].
            const ix0 = Math.max(0, Math.ceil((lo - origin.x) / cellSize - 0.5));
            const ix1 = Math.min(nx - 1, Math.floor((hi - origin.x) / cellSize - 0.5));
            for (let ix = ix0; ix <= ix1; ix += 1) {
                onCell((iz * ny + iy) * nx + ix);
                marked += 1;
            }
        }
    }
    return marked;
}

// The box spanned by the middle of the distribution on each axis (by default
// the 2nd to 98th percentile). The hull can never exceed the full bounding
// box of its own points, so comparing the two says nothing; comparing against
// this core box does — a handful of extreme points survive into the hull but
// cannot move the percentiles.
export function coreBox(pos, n, tail = 0.02) {
    const axis = new Float32Array(n);
    const min = [0, 0, 0];
    const max = [0, 0, 0];
    for (let a = 0; a < 3; a += 1) {
        for (let i = 0; i < n; i += 1) axis[i] = pos[i * 3 + a];
        const sorted = axis.slice().sort();
        min[a] = sorted[Math.floor(tail * (n - 1))];
        max[a] = sorted[Math.ceil((1 - tail) * (n - 1))];
    }
    return { min, max };
}
