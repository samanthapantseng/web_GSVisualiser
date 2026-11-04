import { Worker as NodeWorker } from "node:worker_threads";

// ---------------------------------------------------------------------------
// Enough of the browser's Worker for Spark to decode a capture under Node.
//
// Spark's .spz and .ply decoders are a Rust/wasm module that only ever runs in
// a worker: SplatLoader hands the bytes to a pool, and the pool builds its
// workers with `new Worker("data:text/javascript,...")`. Node has no such
// global, so importing Spark and asking it to read a file throws
// `ReferenceError: Worker is not defined` before it touches the bytes.
//
// The two worker APIs are close enough to bridge. Both run a script off a
// data: URL, both pass structured-cloned messages, both transfer ArrayBuffers.
// They disagree only about shape:
//
//   browser   worker.postMessage(m) / worker.onmessage = (event) => event.data
//             and inside, self.onmessage / postMessage
//   node      worker.postMessage(m) / worker.on("message", (m) => m)
//             and inside, parentPort.on("message") / parentPort.postMessage
//
// So this wraps a node worker on the outside and prepends a prelude on the
// inside that defines the handful of globals the decoder reaches for. The
// decoder itself is a plain IIFE — no imports, no DOM — which is why this
// works at all; everything it needs beyond the message plumbing (WebAssembly,
// TextDecoder, the typed arrays) Node has had for years.
//
// Call installNodeWorker() BEFORE importing Spark. Spark captures nothing at
// module scope, but the first decode happens the moment a capture is opened,
// and a missing global then is a crash rather than a fallback.
// ---------------------------------------------------------------------------

// Runs inside the node worker, ahead of Spark's own script. Classic script, so
// `require` rather than `import`: Spark's worker body is an IIFE and node runs
// an eval'd worker as CommonJS.
const PRELUDE = `
const { parentPort } = require("node:worker_threads");
globalThis.self = globalThis;
let __onmessage = null;
Object.defineProperty(globalThis, "onmessage", {
    get: () => __onmessage,
    set: (fn) => { __onmessage = fn; },
    configurable: true,
});
globalThis.postMessage = (message, transfer) =>
    parentPort.postMessage(message, transfer);
globalThis.addEventListener = (type, fn) => {
    if (type === "message") __onmessage = fn;
};
globalThis.removeEventListener = () => {};
globalThis.close = () => process.exit(0);
parentPort.on("message", (data) => {
    // The browser hands the handler an event; Spark reads event.data.
    if (__onmessage) __onmessage({ data });
});
`;

// "data:text/javascript;charset=utf-8,<percent-encoded source>" back to source.
function sourceFromDataUrl(url) {
    const text = String(url);
    const comma = text.indexOf(",");
    if (!text.startsWith("data:") || comma < 0) {
        throw new Error(
            `The Node Worker shim only understands data: URLs, got ${text.slice(0, 40)}…`,
        );
    }
    const payload = text.slice(comma + 1);
    return text.slice(0, comma).includes(";base64")
        ? Buffer.from(payload, "base64").toString("utf8")
        : decodeURIComponent(payload);
}

class ShimWorker {
    constructor(url, options = {}) {
        const source = `${PRELUDE}\n${sourceFromDataUrl(url)}`;
        // eval: true runs it as CommonJS, which is what an IIFE wants. A data:
        // URL would be treated as a module and the prelude's require() would
        // not resolve.
        this._worker = new NodeWorker(source, {
            eval: true,
            name: options.name,
            // The decoder allocates whole captures; the default heap is too
            // small for a 90 MB scan and fails as an opaque OOM.
            resourceLimits: { maxOldGenerationSizeMb: 4096 },
        });
        this._listeners = { message: [], error: [] };
        this.onmessage = null;
        this.onerror = null;

        this._worker.on("message", (data) => {
            const event = { data };
            this.onmessage?.(event);
            for (const fn of this._listeners.message) fn(event);
        });
        this._worker.on("error", (error) => {
            this.onerror?.(error);
            for (const fn of this._listeners.error) fn(error);
            // Nothing else reports this, and a decoder that died silently
            // looks exactly like a capture that is still loading.
            if (!this.onerror && this._listeners.error.length === 0) {
                console.error("Spark worker failed:", error);
            }
        });
    }

    postMessage(message, transfer) {
        this._worker.postMessage(message, transfer);
    }

    addEventListener(type, fn) {
        this._listeners[type]?.push(fn);
    }

    removeEventListener(type, fn) {
        const list = this._listeners[type];
        if (!list) return;
        const at = list.indexOf(fn);
        if (at >= 0) list.splice(at, 1);
    }

    terminate() {
        this._worker.terminate();
    }
}

export function installNodeWorker() {
    if (typeof globalThis.Worker === "undefined") globalThis.Worker = ShimWorker;
    // Spark revokes an object URL through one of these on the error path. It
    // never creates one on this route, so a no-op revoke is the whole need.
    if (typeof globalThis.URL.revokeObjectURL !== "function") {
        globalThis.URL.revokeObjectURL = () => {};
    }
}
