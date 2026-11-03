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
    // INRIA/COLMAP convention and the same as the bubble and the earlier tram.
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

    // Opening frame. distance is a multiple of the reach at which the whole
    // capture just fills the frame, so 1 touches the edges and 1.15 leaves a
    // margin; the controls work the metres out from the window's own aspect.
    // Elevation is degrees above the horizon; azimuth is degrees around it
    // from broadside, so 0 looks at the side of the tram and 90 down its
    // length. Narrow windows are swung towards end-on on their own.
    framing: { distance: 1.1, elevation: 14, azimuth: 35 },

    // How many splats the level-of-detail tree is allowed to hand the GPU in
    // a frame, out of the file's 6.2M.
    //
    // 1M was tried and looked it: at the distance the whole vehicle is seen
    // from, a forty-three metre tram across a laptop screen does not have many
    // pixels to spare, and the tree thins the capture until the bodywork goes
    // grainy. 2.5M is where it holds together.
    //
    // 0 means "leave Spark's own default alone", which is tiered by platform:
    // 2.5M on desktop, 1–1.5M on mobile, 500–750K in a headset. Worth
    // switching to when the demo is tested on a phone, since a flat 2.5M asks
    // a phone for what a laptop gets.
    splatBudget: 2500000,

    // Read out of the .spz header, which is the only count that matches what
    // actually loads. Only for the HUD's "x of y" line.
    totalSplats: 6246086,

    loading: "Loading the tram…",
    hint:
        "<strong>Drag</strong> to orbit · <strong>scroll</strong> to zoom · " +
        "<strong>right-drag</strong> to pan · <strong>F</strong> walks " +
        "through it · <strong>R</strong> resets · <strong>H</strong> toggles readout",
};
