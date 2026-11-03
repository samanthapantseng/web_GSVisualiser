import { defineConfig } from "vite";

export default defineConfig({
    // Relative, so the same build works at a bare localhost root and under
    // the repo subpath GitHub Pages serves a project site from
    // (samanthapantseng.github.io/web_GSVisualiser/).
    base: "./",
    server: {
        port: 5175,
        // Listen on every interface, so the demo can be opened from a phone
        // on the same wifi before it is anywhere near Pages.
        host: true,
    },
});
