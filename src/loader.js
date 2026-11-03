// ---------------------------------------------------------------------------
// The loading wheel.
//
// Shown from the moment the page opens until the splats are on screen, which
// on an 86 MB capture over a stranger's wifi is long enough that a static
// "Loading…" reads as a hang. It owns #status, so the same element carries the
// wheel, the caption and the failure message.
//
// Two states, because the wait has two halves and they fail differently:
//
//   download  the fetch, where Content-Length gives a real percentage
//   prepare   Spark's level-of-detail tree, built in a worker after the last
//             byte arrives, with no progress to report — so the ring sweeps
//             instead of filling, rather than sitting at 100% looking stuck
//
// On 6.2M splats the prepare half is ten seconds on its own, so the sweep is
// not a formality.
// ---------------------------------------------------------------------------

// Keep in step with r="52" in the markup below and with .loader-arc's
// stroke-dasharray in src/style.css: 2 * PI * 52. The dash maths is in user
// units, so this is a constant rather than a measured length.
const CIRCUMFERENCE = 326.726;

export function createLoadingWheel(root) {
    root.innerHTML = `
        <div class="loader">
            <div
                class="loader-wheel"
                role="progressbar"
                aria-valuemin="0"
                aria-valuemax="100"
            >
                <svg viewBox="0 0 120 120" aria-hidden="true">
                    <circle class="loader-track" cx="60" cy="60" r="52" />
                    <circle class="loader-arc" cx="60" cy="60" r="52" />
                </svg>
                <span class="loader-pct"></span>
            </div>
            <p class="loader-label" role="status" aria-live="polite"></p>
        </div>
    `;

    const loader = root.querySelector(".loader");
    const wheel = root.querySelector(".loader-wheel");
    const arc = root.querySelector(".loader-arc");
    const pctEl = root.querySelector(".loader-pct");
    const labelEl = root.querySelector(".loader-label");

    // A download that stalls and resumes can report a lower loaded byte count
    // than the request before it; a ring that runs backwards looks broken.
    let shown = 0;

    function setLabel(text) {
        if (text) labelEl.textContent = text;
    }

    function fill(fraction) {
        arc.style.strokeDashoffset = `${CIRCUMFERENCE * (1 - fraction)}`;
    }

    return {
        // Determinate: a real percentage off the fetch.
        progress(pct, label) {
            const clamped = Math.max(0, Math.min(100, Math.round(pct)));
            if (clamped < shown) return;
            shown = clamped;

            loader.classList.remove("is-indeterminate", "is-failed");
            root.hidden = false;
            setLabel(label);
            pctEl.textContent = `${clamped}%`;
            wheel.setAttribute("aria-valuenow", `${clamped}`);
            fill(clamped / 100);
        },

        // Indeterminate: work with no total to measure against — the LoD
        // build, or a response that arrived without a Content-Length.
        spin(label) {
            // A determinate phase after an indeterminate one starts over, so
            // the monotonic guard must not hold it at the old percentage.
            shown = 0;
            // Clear the inline offset, or it outranks the sweeping arc's own
            // dash values and the ring just sits there closed.
            arc.style.strokeDashoffset = "";
            loader.classList.remove("is-failed");
            loader.classList.add("is-indeterminate");
            root.hidden = false;
            setLabel(label);
            pctEl.textContent = "";
            wheel.removeAttribute("aria-valuenow");
        },

        done() {
            root.hidden = true;
        },

        // The wheel is the wrong shape for "this file is not there": a ring
        // that stops at 38% for ever says less than the reason does.
        fail(message) {
            loader.classList.remove("is-indeterminate");
            loader.classList.add("is-failed");
            root.hidden = false;
            labelEl.textContent = message;
            pctEl.textContent = "";
            wheel.removeAttribute("aria-valuenow");
        },
    };
}
