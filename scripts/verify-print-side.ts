/**
 * The outside artwork is painted on THREE.FrontSide — each panel's local +Z. A
 * panel hinged on a `left` or `bottom` edge starts a half turn over in the flat
 * sheet (baseAngle = PI), so its +Z faces the back of the sheet and the print
 * would render on the wrong physical face: the box reads inside-out.
 *
 * Fold3D compensates by swapping the two faces (and mirroring the U axis) for
 * those panels. The invariant that proves it: UNFOLDED, every panel's printed
 * face must point the same way as the sheet's printed face. This replays Fold3D's
 * own hinge math at foldAmount = 0 and checks exactly that, on every template and
 * on boxes with faces added and removed by hand.
 *
 * Folding is out of scope on purpose — ink does not move to the other side of the
 * board, so a glue tab or a tuck flap that ends up printed-side-inward once the
 * box is closed is correct and is left alone.
 */
import * as THREE from "three";
import { getBoxStyle, BOX_STYLES } from "../src/geometry/boxBuilders";
import { applyPanelEdits } from "../src/geometry/panelEdits";
import { printMirroredById } from "../src/geometry/printSide";
import type { PanelNode } from "../src/geometry/types";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`  ${ok ? "OK  " : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
}

function hinge(n: PanelNode, pw: number, ph: number) {
  const o = n.parentOffset ?? 0;
  switch (n.parentEdge) {
    case "right": return { p: [pw, o, 0], ax: "y", b: 0 };
    case "left": return { p: [0, o, 0], ax: "y", b: Math.PI };
    case "top": return { p: [o, ph, 0], ax: "x", b: 0 };
    case "bottom": return { p: [o, 0, 0], ax: "x", b: Math.PI };
    default: return { p: [0, 0, 0], ax: "x", b: 0 };
  }
}

interface Measured { id: string; name: string; normal: THREE.Vector3 }

/** Panel orientations in the FLAT sheet: hinge base angles only, no folding. */
function measureFlat(root: PanelNode): Measured[] {
  const out: Measured[] = [];
  const walk = (n: PanelNode, pw: number, ph: number, parent: THREE.Object3D) => {
    const h = hinge(n, pw, ph) as { p: number[]; ax: string; b: number };
    const g = new THREE.Group();
    g.position.set(h.p[0], h.p[1], h.p[2]);
    if (h.ax === "x") g.rotation.set(h.b, 0, 0); else g.rotation.set(0, h.b, 0);
    parent.add(g);
    g.updateWorldMatrix(true, false);
    out.push({ id: n.id, name: n.name ?? String(n.face), normal: new THREE.Vector3(0, 0, 1).transformDirection(g.matrixWorld) });
    for (const k of n.children ?? []) walk(k, n.w, n.h, g);
  };
  walk(root, 0, 0, new THREE.Group());
  return out;
}

function run(label: string, styleId: string, extraDims: Record<string, unknown> = {}) {
  const style = getBoxStyle(styleId);
  const dims = { ...style.defaultDimensions, ...extraDims } as never;
  let root: PanelNode = style.build(dims);
  root = applyPanelEdits(root, dims);
  const panels = measureFlat(root);
  const flags = printMirroredById(root);

  let wrong = 0;
  let flipped = 0;
  for (const p of panels) {
    const mirrored = flags.get(p.id) ?? false;
    if (mirrored) flipped++;
    // The face the ink is actually on, once Fold3D's swap is taken into account.
    const printed = p.normal.clone().multiplyScalar(mirrored ? -1 : 1);
    if (printed.z < 0.99) {
      wrong++;
      console.log(`        ${p.name}: printed face points (${printed.x.toFixed(2)},${printed.y.toFixed(2)},${printed.z.toFixed(2)}), expected (0,0,1)`);
    }
  }
  check(label, wrong === 0, `${panels.length} panels, ${flipped} drawn back-to-front in the sheet`);
}

console.log("Every panel's printed face vs the sheet's printed face, unfolded:\n");
for (const style of BOX_STYLES) run(style.label.padEnd(28), style.id);

console.log("\nBoxes with hand-added and removed faces:\n");
run("reverse-tuck-end, 3 added + 2 removed", "reverse-tuck-end", {
  length: 135, width: 70, height: 95, endFlapRight: 15,
  flapEdges: { bottom: { back: 80 } },
  panelEdits: {
    removed: ["front/right:left/right:back/right:right", "front/top:flap-top-front"],
    added: [
      { id: "extra-a", parentId: "front", edge: "left", depth: 70 },
      { id: "extra-b", parentId: "front/right:left/right:back", edge: "top", depth: 80 },
      { id: "extra-c", parentId: "extra-a", edge: "top", depth: 28 },
    ],
  },
});
run("tuck-end, face added on a bottom edge", "tuck-end", {
  panelEdits: { removed: [], added: [{ id: "extra-d", parentId: "front", edge: "bottom", depth: 40 }] },
});

console.log(failures === 0 ? "\nAll print-side checks passed." : `\n${failures} print-side check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
