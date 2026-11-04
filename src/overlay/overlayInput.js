// ---------------------------------------------------------------------------
// What can be done, and what presses it.
//
// Two layers on purpose. `overlayActions` is a flat table of named things —
// "toggle overlay 3", "turn the cutout off" — that know nothing about where
// the request came from. `bindKeyboard` maps keys onto that table.
//
// The point is the layer that does not exist yet: a VR controller. On a Quest
// there is no keyboard, and a controller button, a pointer ray hitting a
// hotspot and a key press should all reach the same action rather than each
// growing its own copy of the logic. Adding that later means another binder
// against this table, and nothing in OverlayManager changes.
// ---------------------------------------------------------------------------

export function overlayActions({ overlays, debugView, onStatus }) {
    const ids = overlays.ids;

    const actions = {
        "overlay.toggleAll": {
            label: "Toggle every overlay",
            run: () => {
                overlays.toggleAll();
                onStatus?.(`all overlays → ${overlays.visibilityOf(ids[0]) > 0.5 ? "out" : "in"}`);
            },
        },
        "cutout.toggle": {
            label: "Base cutout on/off",
            run: () => {
                overlays.setCutEnabled(!overlays.cutEnabled);
                onStatus?.(`base cutout ${overlays.cutEnabled ? "on" : "off"}`);
            },
        },
        "debug.toggleGrid": {
            label: "Show the occupied mask cells",
            run: () => {
                const on = debugView?.toggle();
                onStatus?.(`mask cells ${on ? "shown" : "hidden"}`);
            },
        },
        "fade.slower": {
            label: "Longer fades",
            run: () => {
                const s = overlays.setFadeDuration(overlays.fadeDuration + 0.25);
                onStatus?.(`fade ${s.toFixed(2)} s`);
            },
        },
        "fade.faster": {
            label: "Shorter fades",
            run: () => {
                const s = overlays.setFadeDuration(overlays.fadeDuration - 0.25);
                onStatus?.(`fade ${s.toFixed(2)} s`);
            },
        },
    };

    // One per overlay, named by position so a binding can refer to "the third
    // overlay" without knowing what it is.
    ids.forEach((id, index) => {
        actions[`overlay.toggle.${index}`] = {
            label: `Toggle ${id}`,
            run: () => {
                overlays.toggle(id);
                onStatus?.(`${id} → ${overlays.visibilityOf(id) > 0.5 ? "out" : "in"}`);
            },
        };
    });

    return actions;
}

// Desktop bindings. Deliberately the only place a key appears.
export const DEFAULT_KEYMAP = {
    1: "overlay.toggle.0",
    2: "overlay.toggle.1",
    3: "overlay.toggle.2",
    4: "overlay.toggle.3",
    5: "overlay.toggle.4",
    6: "overlay.toggle.5",
    7: "overlay.toggle.6",
    8: "overlay.toggle.7",
    9: "overlay.toggle.8",
    0: "overlay.toggleAll",
    m: "cutout.toggle",
    g: "debug.toggleGrid",
    "[": "fade.faster",
    "]": "fade.slower",
};

export function bindKeyboard(actions, keymap = DEFAULT_KEYMAP) {
    const onKeyDown = (event) => {
        // A browser or system shortcut is not a command. Matches the walk
        // controls' own rule in src/controls.js.
        if (event.metaKey || event.ctrlKey || event.altKey) return;
        const name = keymap[event.key.toLowerCase()];
        const action = name && actions[name];
        if (!action) return;
        event.preventDefault();
        action.run();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
}
