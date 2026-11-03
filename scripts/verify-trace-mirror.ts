/**
 * Verifies the per-face TRACE-mirror option (panelEdits.mirrored):
 *  - applyTraceMirror flips a flagged face's outline points, the cut paths that
 *    belong to it, and the fold lines on its edges about the face's own vertical
 *    centre line — and nothing else (other faces, bounds, artwork layout).
 *  - The mirrored trace reaches the SVG and DXF exporters.
 *  - The flag toggles, sanitizes and survives a .pbox save/load round trip.
 */
import { createCanvas, Image as NodeImage } from "@napi-rs/canvas";
// Shim the two DOM globals renderPanel.ts uses (same pattern as verify-texture.ts).
(globalThis as any).document = { createElement: (t: string) => (t === "canvas" ? createCanvas(1, 1) : {}) };
(globalThis as any).Image = NodeImage;

import { getBoxStyle } from "../src/geometry/boxBuilders";
import { computeFlatLayout } from "../src/geometry/layout";
import { applyTraceMirror, mirroredTraceIds } from "../src/geometry/traceMirror";
import { isFaceMirrored, sanitizePanelEdits, toggleFaceMirror } from "../src/geometry/panelEdits";
import { generateDielineSVG } from "../src/geometry/svgExport";
import { generateDielineDXF } from "../src/geometry/dxfExport";
import { buildSheetCanvas, renderFullSheetCanvas, renderPanelCanvas } from "../src/artwork/renderPanel";
import { buildArtworkMarkup } from "../src/artwork/vectorSheet";
import { serializeProject, parseProject } from "../src/project/projectFile";
import { emptyArtwork, emptySide } from "../src/artwork/types";
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

// 8. the same flag also flips the face's placed ARTWORK region (sheet crop / panel
// image) in the 3D textures and in the raster+vector exports — the artwork file
// itself is never modified. Left half red, right half blue: a mirrored face swaps them.
const art = createCanvas(400, 200);
const actx = art.getContext("2d");
actx.fillStyle = "#ff0000";
actx.fillRect(0, 0, 200, 200);
actx.fillStyle = "#0000ff";
actx.fillRect(200, 0, 200, 200);
const artUrl = art.toDataURL("image/png");
const sideArt = { ...emptySide("#ffffff"), sheetImage: artUrl, sheetWidth: layout.bounds.width, sheetHeight: layout.bounds.height };
const mirroredSet = new Set([back.id]);

(async () => {
  const sheet = await buildSheetCanvas(sideArt as any, layout, 4);
  const plain = (await renderPanelCanvas(back, sideArt as any, layout, sheet as any, 4)) as any;
  const flipped = (await renderPanelCanvas(back, sideArt as any, layout, sheet as any, 4, undefined, mirroredSet)) as any;
  const pctx = plain.getContext("2d");
  const fctx = flipped.getContext("2d");
  const sample = (c: any, x: number, y: number) => Array.from(c.getImageData(x, y, 1, 1).data.slice(0, 3)).join(",");
  const w = flipped.width;
  let flipOk = true;
  for (const u of [2, Math.floor(w * 0.25), Math.floor(w * 0.5), Math.floor(w * 0.75), w - 3]) {
    if (sample(fctx, u, Math.floor(flipped.height / 2)) !== sample(pctx, w - 1 - u, Math.floor(plain.height / 2))) flipOk = false;
  }
  check("panel texture crop flips horizontally when the face is mirrored", flipOk, `w=${w}`);
  check("unmirrored render is untouched when the flag is absent", sample(pctx, 2, Math.floor(plain.height / 2)).startsWith("255"));

  // full-sheet raster (PDF/PNG export path): the face's region flips in sheet space
  const fullPlain = (await renderFullSheetCanvas(layout, sideArt as any, 4)) as any;
  const fullFlip = (await renderFullSheetCanvas(layout, sideArt as any, 4, mirroredSet)) as any;
  const fc = fullFlip.getContext("2d");
  const pc = fullPlain.getContext("2d");
  const cxPx = Math.round(((back.min[0] + back.max[0]) / 2) * 4);
  const yPx = Math.round((layout.bounds.height - (back.min[1] + back.max[1]) / 2) * 4);
  const leftX = Math.round(back.min[0] * 4) + 4;
  const a = sample(fc, leftX, yPx);
  const b = sample(pc, 2 * cxPx - leftX, yPx);
  const outA = sample(fc, 2, 2);
  const outB = sample(pc, 2, 2);
  check("full-sheet export flips the mirrored face's region", a === b, `${a} vs ${b}`);
  check("full-sheet export leaves the rest of the sheet untouched", outA === outB);

  // vector SVG export: mirrored sheet overlay + flipped per-panel image
  const markupFlip = buildArtworkMarkup(layout, sideArt, mirroredSet);
  const cxMm = (back.min[0] + back.max[0]) / 2;
  check("vector export re-draws the sheet flipped over the mirrored face", markupFlip.includes(`translate(${Number((2 * cxMm).toFixed(3))} 0) scale(-1 1)`) && markupFlip.includes("art-mirror-clip"));
  check("vector export without the flag has no flip", !buildArtworkMarkup(layout, sideArt).includes("scale(-1 1)"));
  const panelImg = buildArtworkMarkup(layout, { ...sideArt, panelImages: { [back.id]: artUrl } }, mirroredSet);
  check("vector export flips a mirrored face's own panel image", panelImg.includes(`translate(${Number(back.w.toFixed(3))} 0) scale(-1 1)`));

  if (failures) {
    console.error(`${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("All trace-mirror checks passed.");
})();
