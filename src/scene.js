// ---------------------------------------------------------------------------
// The capture, and the facts about it that the viewer cannot work out for
// itself.
//
// Everything here is a property of this particular scan — where the file is,
// which way is up, how it should be framed on arrival. Nothing in
// src/viewer.js mentions a tram; it reads this. When the compartment scans
// arrive they become a second table alongside it, so this shape is worth
// keeping even with one entry in it.
//
// Query-string overrides win over anything here (see CONFIG in viewer.js), so
// a wrong up axis or an awkward framing can be found live — ?upAxis=-z&heading=90 —
// and only then baked in.
// ---------------------------------------------------------------------------

export const TRAM = {
    title: "VBZ Flexity",
    url: "data/flexity_tram.spz",

    // Which axis of the splat data points up. This export is -y up, the usual
    // INRIA/COLMAP convention.
    //
    // It took two wrong answers to get here, and they failed differently.
    // "+z" laid the tram on its side, which the extent catches: a Flexity is
    // 42.9 m long, 2.4 m wide and 3.6 m high, and under "+z" the capture
    // measured 43.0 x 2.8 x 3.6 with the 3.6 across its width. Height and
    // width had swapped places. "+y" put the height back where it belonged —
    // 43.0 x 3.6 x 2.8 — and stood the tram on its roof, which the extent
    // cannot catch at all, because an upright capture and an inverted one have
    // identical bounds.
    //
    // So the two checks are different checks, and the compartment scans each
    // want both. The extent settles which axis is up, whenever the thing
    // scanned has known dimensions. Only looking inside settles up from down:
    // seats resting on the floor rather than hanging off the ceiling.
    //
    // Standing -Y up is a 180 degree rotation about Z, so the tram also ends
    // up facing the other way along X. Nothing depends on that yet; ?heading=
    // aims it when something does.
    upAxis: "-y",

    // Degrees of yaw applied after the up-axis correction, about world up. A
    // capture arrives facing wherever training left it; this aims it so the
    // opening view looks along the tram rather than at a corner of it.
    heading: 0,

    // 0 keeps the capture's own scale, which for a vehicle is what you want:
    // these exports are metric, so one data unit is one metre and the tram
    // comes out tram-sized.
    worldHeight: 0,

    // Where the capture's own origin ends up.
    //
    //   data   the origin written into the file becomes the world origin, and
    //          the orbit pivots around it. The scan carries a deliberate
    //          origin, so this keeps the viewer's coordinates and the file's
    //          the same thing — which is what the compartment boxes will be
    //          written in later, and what makes those numbers portable back
    //          to the scanning software.
    //   floor  ignore it: centre the capture horizontally and drop its lowest
    //          splat to y = 0. What the VR project did, and the right answer
    //          for a capture whose origin is wherever training left it.
    origin: "data",

    // What the orbit turns around, which is a separate question from where
    // the capture sits. This scan's origin is at one end of the vehicle, at
    // floor height — a sensible place to measure from and a terrible place to
    // pivot a camera, because orbiting swings forty metres of tram around the
    // viewer in an arc. So the coordinates stay the file's and the camera
    // turns around the middle of the capture.
    //
    //   centre  the middle of the capture's bounding box
    //   origin  the file's own origin, wherever that is
    pivot: "centre",

    // How far above the horizon the camera may be taken, in degrees. The
    // lower bound is what keeps the tram upright: without it the orbit
    // carries on under the floor and round the other side, and a vehicle
    // seen from beneath reads as having tipped over. 0 is the horizon.
    pitchRange: [0, 70],

    // Where the viewer opens.
    //
    //   pov     standing at a point and looking in a direction, in walk mode,
    //           so WASD moves off from there straight away
    //   orbit   framed on the pivot from outside, using `framing` below
    //
    // The capture's own origin sits at floor level at one end of the vehicle,
    // on its centreline — which is to say at the end of the corridor, looking
    // down it. That is the opening shot: you are inside the tram before you
    // have touched anything.
    //
    // position and lookAt are world metres; eyeHeight lifts both by the same
    // amount, so the view stays level.
    //
    // The eye has to be lifted. At the origin exactly, the camera sits inside
    // the floor: the splats that make up the floor are around it rather than
    // in front of it, and Spark's level-of-detail tree resolves that by
    // handing the GPU a single enormous splat, which fills the screen with
    // grey. 1.6 m is a standing eye, which is both the view that was wanted
    // and the one that renders. ?eyeHeight=0 shows the floor-level version.
    start: {
        mode: "pov",
        position: [0, 0, 0],
        lookAt: [40, 0, 0],
        eyeHeight: 1.6,
    },

    // Used by start.mode "orbit", and by F. distance is a multiple of the
    // reach at which the whole capture just fills the frame, so 1 touches the
    // edges and 1.15 leaves a margin; the controls work the metres out from
    // the window's own aspect. Elevation is degrees above the horizon;
    // azimuth is degrees around it from broadside, so 0 looks at the side of
    // the tram and 90 down its length. Narrow windows are swung towards
    // end-on on their own.
    framing: { distance: 1.1, elevation: 14, azimuth: 35 },

    // How many splats the level-of-detail tree is allowed to hand the GPU in
    // a frame, out of the file's 6.2M.
    //
    // 1M was tried and looked it: at the distance the whole vehicle is seen
    // from, a forty-three metre tram across a laptop screen does not have many
    // pixels to spare, and the tree thins the capture until the bodywork goes
    // grainy. 2.5M is where it holds together.
    //
    // 0 means "leave Spark's own default alone", which is 2.5M on a desktop
    // and the same number by a different route.
    splatBudget: 2500000,

    // Load the capture with Spark's extended encoding. Its compact default
    // stores splat centres as half floats, whose precision is relative to the
    // size of the coordinate — so detail decays with distance from the
    // capture's own origin, not from the camera. Measured on this scan: a
    // 0.98 mm grid two metres out, a 31 mm grid at thirty-five. The far end
    // of a forty-three metre vehicle therefore had every splat centre snapped
    // onto a three-centimetre lattice, which smeared the posters there into
    // stripes while the identical posters by the door stayed legible.
    //
    // Extended encoding puts that grid at 0.004 mm throughout, for about
    // double the position memory and no measurable frame cost. ?ext=0 to see
    // the difference.
    extEncoding: true,

    // The budget to climb to once the view stops moving, and how long it has
    // to be still first.
    //
    // Redrawing only on change leaves the whole frame budget unspent while
    // nobody is touching anything, and this spends it: the level-of-detail
    // tree is given far more than it can use, descends as deep as the capture
    // allows, and draws one expensive frame that then costs nothing to keep on
    // screen. Moving drops straight back to splatBudget.
    //
    // 8M is above the 7.74M the tree holds, so it is not really a budget —
    // it means "take whatever is worth taking". What the tree actually takes
    // is bounded by lodRenderScale, which stops it at splats under a pixel,
    // so the gain is large up close and small from across the street.
    //
    // 0 turns the whole thing off.
    idleSplatBudget: 8000000,
    idleDelay: 0.35,

    // Read out of the .spz header, which is the only count that matches what
    // actually loads. Only for the HUD's "x of y" line.
    totalSplats: 6246086,

    loading: "Loading the tram…",
    // Solid walls in walk mode. The viewer builds a coarse occupancy grid
    // from the splat centres once the capture has loaded — a cell holding
    // enough small splats counts as solid — and walking is tested against it.
    // Without this you drift through the bodywork and out into the void,
    // which is no use to anyone being shown round a vehicle.
    //
    // It is built from the capture, so it needs no authoring, and it knows
    // about the seats and the partitions as well as the outer shell. The
    // trade is that it is only as good as the scan: a gap the scan did not
    // resolve is a gap you can walk through. ?collide=0 turns it off.
    collision: true,
    // Grid resolution in metres. Finer catches thinner things and costs
    // memory as the cube of itself.
    collisionCell: 0.2,
    // Small splats per cell before it counts as solid. Too low and stray
    // splats in the aisle wall it off; too high and thin panels let you
    // through.
    collisionThreshold: 4,
    // Boxes where the collision grid is ignored, in world metres.
    //
    // The grid is built from what the scan saw, and what the scan saw of the
    // cab doorway is a 35 cm slot offset 40 cm from the centreline — passable
    // in principle, impossible to find by walking at it. A door people are
    // meant to go through is worth stating outright rather than hoping the
    // capture resolved it.
    //
    // The numbers come from probing the grid: at eye height the bulkhead runs
    // solid across z = 0.00..0.35 from x = 37.7, with the gap beyond it. This
    // box covers the threshold and the frame either side, so walking straight
    // down the aisle carries you in.
    openings: [
        {
            name: "Driver's cab door",
            min: [37.5, 0.0, -0.15],
            max: [39.2, 2.1, 0.75],
        },
    ],

    // How far inside the capture's own bounds walking is held. The grid alone
    // is not enough: glass leaves no splats, so the windows are holes in it
    // and you can walk out through one. This closes them.
    wallMargin: 0.25,

    // Double-tap W and hold to run. 1.4 m/s is a walking
    // pace, which is right for looking at something and wrong for crossing
    // forty-three metres of it; 3x covers the length in about ten seconds.
    // Letting go of forward drops back to a walk.
    sprintMultiplier: 3,
    doubleTapMs: 300,

    // -----------------------------------------------------------------------
    // Things worth a second look.
    //
    // A circle drawn on the capture, and what is behind it. The marker is a
    // point in world metres — the same metres the file is in, because
    // origin: "data" above keeps them the same thing — plus the direction the
    // marked surface faces and how big the thing being marked is.
    //
    // `overlay` is a second .spz laid over the first. The two captures were
    // trained apart and share no coordinate system at all, only a subject, so
    // there is no number in either file that says where one sits in the other:
    // the placement below was found by looking, with ?align=driver-ceiling-panel,
    // and is the output of that. See src/align.js.
    //
    // Positions come from ?pick=1, which raycasts the splats and prints the
    // point you clicked.
    // -----------------------------------------------------------------------
    hotspots: [
        {
            id: "driver-ceiling-panel",
            label: "Ceiling service panel",
            detail: "Scanned with the hatch open",

            // On the hatch itself, in the cab ceiling.
            position: [38.95, 2.32, 0.3],
            // Which way the marked surface faces: down, out of the ceiling.
            // The marker is hidden from the other side of it, which is what
            // stops it hanging in the air over the roof when the vehicle is
            // seen from outside.
            normal: [0, -1, 0],
            // The ring is drawn at this radius in metres, so it reads as
            // painted on the panel rather than floating over it.
            radius: 0.14,
            // How close you have to be for it to appear. The cab is small and
            // the saloon is forty metres of it, so this is deliberately short.
            range: 5,

            // Which detail capture this opens. The placement — where that
            // capture sits in the vehicle, which way up it is, how big — lives
            // in overlays.config.json, because the offline mask builder needs
            // the same numbers and a transform written down twice is a
            // transform that drifts. See the note at the top of that file.
            overlayId: "driver-ceiling-panel",
        },
        {
            id: "back-panel",
            label: "Back panel",
            detail: "Scanned with the hatch open",

            // On the lime-green lid of the desk in the cab at the origin end,
            // on the centreline. The lid is closed in the tram capture and
            // open in the detail one, which is what the overlay shows.
            //
            // The placement in overlays.config.json was fitted numerically
            // rather than by eye: an ICP of the detail capture's box and rim
            // against the tram's splats round this desk, from each quarter
            // turn of yaw. Two orientations fit about as well — the box is
            // nearly symmetric — and the one used has the lid hinged on the
            // window side, opposite the keyhole on the closed lid, so it opens
            // away from the aisle with the buttons facing you.
            position: [-1.89, 0.72, -0.09],
            // The lid faces up, tipped a little towards the aisle.
            normal: [0, 1, 0],
            radius: 0.14,
            range: 5,

            overlayId: "back-panel",
        },
        {
            id: "back-panel-lower",
            label: "Fuse box",
            detail: "Photographed behind the lower panel",

            // On the white cabinet door under the lime lid, which faces down
            // the aisle.
            position: [-1.75, 0.4, -0.09],
            normal: [1, 0, 0],
            radius: 0.14,
            range: 5,

            // A photograph rather than a scan: `image` instead of
            // `overlayId` opens it as a popup over the view. This is a
            // 2560 px copy of flexity_BackPanel_lower.jpeg; the 16 MB original
            // is too heavy to fetch on a click.
            image: "data/flexity_BackPanel_lower_web.jpg",
        },
    ],

    // The controls bar along the bottom: an icon or the keys themselves for
    // each control, then a word for what it does. Styled in style.css under
    // #hint.
    hint:
        '<span class="hint-item">' +
        '<svg class="hint-icon hint-mouse" viewBox="0 0 32 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="11" y="2" width="10" height="18" rx="5"/><path d="M16 2v7M11 9h10"/><path d="M16 2.3A5 5 0 0 0 11 7v2h5z" fill="currentColor" stroke="none"/><path d="M7 8l-3 3 3 3M25 8l3 3-3 3"/></svg>' +
        '<span class="hint-label">Drag to look</span></span>' +
        '<span class="hint-item"><span class="hint-wasd">' +
        "<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></span>" +
        '<span class="hint-label">Walk<small>double-tap W to run</small></span></span>' +
        '<span class="hint-item"><span class="hint-keys"><kbd>↑</kbd><kbd>↓</kbd></span>' +
        '<span class="hint-label">Eye height</span></span>' +
        '<span class="hint-item"><span class="hint-spot" aria-hidden="true"></span>' +
        '<span class="hint-label">Click circles to open</span></span>' +
        '<span class="hint-item"><kbd>R</kbd>' +
        '<span class="hint-label">Reset view</span></span>',
};
