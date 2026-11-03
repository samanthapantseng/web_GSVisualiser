import "./style.css";
import { TRAM } from "./scene.js";
import { startViewer } from "./viewer.js";

// One capture, so no picker and no ?scene= yet — a bare URL is the demo. The
// scene entry is still a table rather than inline constants, because the
// compartment scans will each want their own.
startViewer(TRAM);
