/**
 * Where a panel's artwork actually lands in 3D.
 *
 * The 3D view and the texture it samples are built by two independent pieces of
 * code. Fold3D composes a chain of hinge rotations and maps each panel's local
 * (x, y) to a UV; renderPanelCanvas crops that panel's ink out of the flat sheet
 * using computeFlatLayout's FlatPanel frame. Both claim to describe the same
 * sheet, so there is a check that does not depend on either being right:
 *
 *     for any point on a panel, the world point the 3D geometry puts it at while
 *     the sheet is still flat must be the world point whose ink the texture
 *     sampler fetches for that point's UV.
 *
 * Any disagreement means the panel renders with its artwork moved, mirrored, or
 * on the wrong physical face. The previous version of this file replayed the
 * same hinge math the renderer used to DERIVE the print side, so it agreed with
 * the renderer by construction and passed while every bottom-attached panel —
 * the whole bottom face of a reverse tuck end — rendered mirrored. Checking
 * against the dieline instead is what makes this test able to fail.
 *
 * Folding is out of scope on purpose: ink does not move to the other side of the
 * board, so a glue tab or tuck flap that ends up printed-side-inward once the
 * box is closed is correct and is left alone.
 */
import * as THREE from "three";
import { getBoxStyle, BOX_STYLES } from "../src/geometry/boxBuilders";
import { applyPanelEdits } from "../src/geometry/panelEdits";
import { computeFlatLayout } from "../src/geometry/layout";
import { panelPrintFrames, printFrameOf } from "../src/geometry/printSide";
import { panelLocalToWorld } from "../src/geometry/types";
import type { BoxDimensions, BoxStyleId, FlatPanel, PanelNode } from "../src/geometry/types";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`  ${ok ? "OK  " : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
}

/** Fold3D's computeHinge, verbatim. */
function hinge(node: PanelNode, parentW: number, parentH: number) {
  const o = node.parentOffset ?? 0;
  switch (node.parentEdge) {
    case "right": return { pivot: [parentW, o, 0] as const, axis: "y" as const, baseAngle: 0 };
    case "left": return { pivot: [0, o, 0] as const, axis: "y" as const, baseAngle: Math.PI };
    case "top": return { pivot: [o, parentH, 0] as const, axis: "x" as const, baseAngle: 0 };
    case "bottom": return { pivot: [o, 0, 0] as const, axis: "x" as const, baseAngle: Math.PI };
    default: return { pivot: [0, 0, 0] as const, axis: "x" as const, baseAngle: 0 };
  }
}

/**
 * The world point Fold3D's geometry puts a panel-local point at with the sheet
 * flat (foldAmount = 0, so every hinge sits at its baseAngle).
 */
function worldOfLocal(matrix: THREE.Matrix4, x: number, y: number): [number, number] {
  const p = new THREE.Vector3(x, y, 0).applyMatrix4(matrix);
  return [p.x, p.y];
}

/**
 * The world point whose ink the texture sampler fetches for the UV Fold3D gives
 * that same local point. PanelMesh maps local (x, y) to uv (x/w, y/h); the canvas
 * renderPanelCanvas hands back is indexed in the panel's own local frame, so the
 * ink at uv (u, v) is the sheet's ink at panelLocalToWorld(panel, u*w, v*h).
 */
function inkSourceOfLocal(panel: FlatPanel, frame: { flipU: boolean; flipV: boolean }, x: number, y: number): [number, number] {
  const u = frame.flipU ? 1 - x / panel.w : x / panel.w;
  const v = frame.flipV ? 1 - y / panel.h : y / panel.h;
  return panelLocalToWorld(panel, [u * panel.w, v * panel.h]) as [number, number];
}

function run(label: string, styleId: BoxStyleId, dims?: Partial<BoxDimensions>) {
  const style = getBoxStyle(styleId);
  const root = applyPanelEdits(style.build({ ...style.defaultDimensions, ...dims } as BoxDimensions), (dims as BoxDimensions | undefined)?.panelEdits);
  const layout = computeFlatLayout(root);
  const byId = new Map(layout.panels.map((p) => [p.id, p]));
  const frames = panelPrintFrames(root, layout);

  console.log(`\n${label}`);

  let missing = 0;
  let worstDrift = 0;
  let worstPanel = "";

  const visit = (node: PanelNode, parentW: number, parentH: number, parentMatrix: THREE.Matrix4) => {
    const { pivot, axis, baseAngle } = hinge(node, parentW, parentH);
    const euler = axis === "x" ? new THREE.Euler(baseAngle, 0, 0) : new THREE.Euler(0, baseAngle, 0);
    const local = new THREE.Matrix4().compose(
      new THREE.Vector3(pivot[0], pivot[1], pivot[2]),
      new THREE.Quaternion().setFromEuler(euler),
      new THREE.Vector3(1, 1, 1),
    );
    const matrix = new THREE.Matrix4().multiplyMatrices(parentMatrix, local);

    const panel = byId.get(node.id);
    if (!panel) {
      missing++;
    } else {
      const frame = printFrameOf(frames, node.id);
      if (!frames.has(node.id)) missing++;
      // Corners and the centre: enough to catch a mirror on either axis, a
      // half-turn, or an offset, none of which can hide at all four.
      for (const [fx, fy] of [[0, 0], [1, 0], [1, 1], [0, 1], [0.5, 0.5]]) {
        const x = fx * node.w;
        const y = fy * node.h;
        const [gx, gy] = worldOfLocal(matrix, x, y);
        const [ix, iy] = inkSourceOfLocal(panel, frame, x, y);
        // The flat layout and the hinge chain share an origin only up to the
        // sheet's own translation, so compare each against the panel's centre.
        const [cgx, cgy] = worldOfLocal(matrix, node.w / 2, node.h / 2);
        const [cix, ciy] = inkSourceOfLocal(panel, frame, node.w / 2, node.h / 2);
        const drift = Math.hypot((gx - cgx) - (ix - cix), (gy - cgy) - (iy - ciy));
        if (drift > worstDrift) { worstDrift = drift; worstPanel = node.name ?? node.id; }
      }
    }
    for (const child of node.children ?? []) visit(child, node.w, node.h, matrix);
  };
  visit(root, root.w, root.h, new THREE.Matrix4());

  check("every panel is in the dieline and has a print side", missing === 0, missing ? `${missing} missing` : "");
  check("artwork lands where the geometry puts it", worstDrift < 1e-6, worstDrift ? `${worstDrift.toFixed(2)} mm off on ${worstPanel}` : "");
}

for (const style of BOX_STYLES) run(style.label, style.id);

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
} as Partial<BoxDimensions>);
run("tuck-end, face added on a bottom edge", "tuck-end", {
  panelEdits: { removed: [], added: [{ id: "extra-d", parentId: "front", edge: "bottom", depth: 40 }] },
} as Partial<BoxDimensions>);

console.log(failures === 0 ? "\nAll print-side checks passed." : `\n${failures} print-side check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
