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
    // Double-tap W (or the up arrow) and hold to run. 1.4 m/s is a walking
    // pace, which is right for looking at something and wrong for crossing
    // forty-three metres of it; 3x covers the length in about ten seconds.
    // Letting go of forward drops back to a walk.
    sprintMultiplier: 3,
    doubleTapMs: 300,

    hint:
        "<strong>Drag</strong> to look · <strong>WASD</strong> to walk " +
        "(double-tap <strong>W</strong> to run) · " +
        "<strong>F</strong> orbits it from outside · <strong>R</strong> resets · " +
        "<strong>H</strong> toggles readout",
};
