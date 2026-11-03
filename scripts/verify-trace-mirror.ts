/**
 * Verifies the per-face TRACE-mirror option (panelEdits.mirrored):
 *  - applyTraceMirror flips a flagged face's outline points, the cut paths that
 *    belong to it, and the fold lines on its edges about the face's own vertical
 *    centre line — and nothing else (other faces, bounds, artwork layout).
 *  - The mirrored trace reaches the SVG and DXF exporters.
 *  - The flag toggles, sanitizes and survives a .pbox save/load round trip.
 */
import { getBoxStyle } from "../src/geometry/boxBuilders";
import { computeFlatLayout } from "../src/geometry/layout";
import { applyTraceMirror, mirroredTraceIds } from "../src/geometry/traceMirror";
import { isFaceMirrored, sanitizePanelEdits, toggleFaceMirror } from "../src/geometry/panelEdits";
import { generateDielineSVG } from "../src/geometry/svgExport";
import { generateDielineDXF } from "../src/geometry/dxfExport";
import { serializeProject, parseProject } from "../src/project/projectFile";
import { emptyArtwork } from "../src/artwork/types";
import type { Point } from "../src/geometry/types";

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const style = getBoxStyle("tuck-end");
const dims = { ...style.defaultDimensions, length: 80, width: 40, height: 120 };
const layout = computeFlatLayout(style.build(dims));
const back = layout.panels.find((p) => p.face === "back")!;
const flap = layout.panels.find((p) => p.face === "flap-top-back")!;
const cx = (back.min[0] + back.max[0]) / 2;
const inBack = (pt: Point) => pt[0] >= back.min[0] - 1e-6 && pt[0] <= back.max[0] + 1e-6 && pt[1] >= back.min[1] - 1e-6 && pt[1] <= back.max[1] + 1e-6;

// 1. empty flag set -> the very same object (no copy, no cost)
check("no mirrored faces returns the layout as-is", applyTraceMirror(layout, new Set()) === layout);
check("mirroredTraceIds reads panelEdits", mirroredTraceIds({ panelEdits: { mirrored: [back.id] } }).has(back.id) && mirroredTraceIds({}).size === 0);

// 2. flag the back wall
const mirrored = applyTraceMirror(layout, new Set([back.id]));
check("returns a copy, original layout untouched", mirrored !== layout && layout.panels.find((p) => p.id === back.id) === back);
check("bounds unchanged by trace mirror", mirrored.bounds.width === layout.bounds.width && mirrored.bounds.height === layout.bounds.height);
const backM = mirrored.panels.find((p) => p.id === back.id)!;
check("mirrored face keeps its bbox and size", backM.min[0] === back.min[0] && backM.max[0] === back.max[0] && backM.min[1] === back.min[1] && backM.max[1] === back.max[1] && backM.w === back.w && backM.h === back.h);
const ptKey = (p: Point) => `${p[0].toFixed(4)},${p[1].toFixed(4)}`;
check("face outline mirrors onto itself for a rectangle", [...back.points.map(ptKey)].sort().join("|") === [...backM.points.map(ptKey)].sort().join("|"));
const front = layout.panels.find((p) => p.face === "front")!;
check("unflagged faces keep their exact points", JSON.stringify(mirrored.panels.find((p) => p.id === front.id)!.points) === JSON.stringify(front.points));

// 3. fold lines: those with both endpoints inside the back face flip about its centre, the rest stay
let flipped = 0;
let kept = 0;
let foldOk = true;
layout.foldLines.forEach((f, i) => {
  const g = mirrored.foldLines[i];
  if (inBack(f.a) && inBack(f.b)) {
    flipped++;
    if (Math.abs(g.a[0] - (2 * cx - f.a[0])) > 1e-9 || Math.abs(g.b[0] - (2 * cx - f.b[0])) > 1e-9 || g.a[1] !== f.a[1] || g.b[1] !== f.b[1]) foldOk = false;
  } else {
    kept++;
    if (g.a[0] !== f.a[0] || g.b[0] !== f.b[0] || g.a[1] !== f.a[1] || g.b[1] !== f.b[1]) foldOk = false;
  }
});
check(`fold lines on the face flip, others stay (${flipped} flipped, ${kept} kept)`, foldOk && flipped > 0 && kept > 0);

// 4. cut outline: a polygon fully inside a flagged face flips with it; others stay.
// (A strip wall's boundary is all hinges, so flagging the back wall flips only its
// fold lines; flagging a flap flips its cut outline, which is asymmetric.)
check("flagging a plain wall leaves every cut polygon unchanged", JSON.stringify(mirrored.cutOutline) === JSON.stringify(layout.cutOutline));
const inFlap = (pt: Point) => pt[0] >= flap.min[0] - 1e-6 && pt[0] <= flap.max[0] + 1e-6 && pt[1] >= flap.min[1] - 1e-6 && pt[1] <= flap.max[1] + 1e-6;
const fcx0 = (flap.min[0] + flap.max[0]) / 2;
const flapMirroredCut = applyTraceMirror(layout, new Set([flap.id]));
let cutOk = true;
let cutFlipped = 0;
layout.cutOutline.forEach((poly, i) => {
  const g = flapMirroredCut.cutOutline[i];
  const inside = poly.length > 0 && poly.every(inFlap);
  if (inside) {
    cutFlipped++;
    if (!poly.every((pt, k) => Math.abs(g[k][0] - (2 * fcx0 - pt[0])) < 1e-9 && g[k][1] === pt[1])) cutOk = false;
  } else if (JSON.stringify(g) !== JSON.stringify(poly)) cutOk = false;
});
check(`cut polygons inside the flagged flap flip, others stay (${cutFlipped} flipped)`, cutOk && cutFlipped > 0);

// 5. an asymmetric outline (tuck flap) flips for real
const fcx = (flap.min[0] + flap.max[0]) / 2;
const flapMirrored = applyTraceMirror(layout, new Set([flap.id]));
const flapM = flapMirrored.panels.find((p) => p.id === flap.id)!;
check("flap outline points mirror about the face centre", flapM.points.every((p, i) => Math.abs(p[0] - (2 * fcx - flap.points[i][0])) < 1e-9 && p[1] === flap.points[i][1]));
check("asymmetric flap outline visibly changes when flagged", JSON.stringify(flapM.points) !== JSON.stringify(flap.points));

// 6. exporters emit the mirrored trace
const svgPlain = generateDielineSVG(layout, { title: "t" });
const svgMirrored = generateDielineSVG(applyTraceMirror(layout, new Set([flap.id])), { title: "t" });
check("SVG export reflects the mirrored trace", svgMirrored !== svgPlain && svgMirrored.includes("<g id=\"cut-lines\">"));
const expectedX = (2 * fcx - flap.points[0][0]).toFixed(2);
const expectedY = (layout.bounds.height - flap.points[0][1]).toFixed(2);
check("SVG cut path contains the mirrored vertex", svgMirrored.split('<g id="cut-lines">')[1].includes(`M ${expectedX},${expectedY}`) || svgMirrored.includes(`${expectedX},${expectedY}`), `looked for ${expectedX},${expectedY}`);
const dxfMirrored = generateDielineDXF(applyTraceMirror(layout, new Set([flap.id])));
check("DXF export differs when a face is mirrored", dxfMirrored !== generateDielineDXF(layout));

// 7. toggle + sanitize + project round trip
let d = toggleFaceMirror(dims, back.id);
check("toggleFaceMirror turns the flag on", isFaceMirrored(d, back.id) && d.panelEdits?.mirrored?.includes(back.id) === true);
d = toggleFaceMirror(d, back.id);
check("toggleFaceMirror turns it off and drops the empty edit", !isFaceMirrored(d, back.id) && d.panelEdits === undefined);
const weird = sanitizePanelEdits({ mirrored: [back.id, 42, back.id, "x".repeat(400)], added: [] });
check("sanitizePanelEdits keeps valid ids, drops junk, dedupes", JSON.stringify(weird?.mirrored) === JSON.stringify([back.id]));
const loaded = parseProject(serializeProject("tuck-end", toggleFaceMirror(dims, back.id), emptyArtwork()));
check("mirror flag survives a .pbox round trip", loaded.dims.panelEdits?.mirrored?.includes(back.id) === true);
const oldFile = parseProject(JSON.stringify({ app: "packbox", version: 4, boxStyleId: "tuck-end", dims: { length: 80, width: 40, height: 120 } }));
check("project files without the flag load fine", oldFile.dims.panelEdits === undefined);

if (failures) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
console.log("All trace-mirror checks passed.");
