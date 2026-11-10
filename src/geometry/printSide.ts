import * as THREE from "three";
import type { DielineLayout, PanelNode } from "./types";
import { panelLocalToWorld } from "./types";

/**
 * How a panel's artwork has to be mapped onto its 3D mesh.
 *
 * Two separate pieces of code describe the same flat sheet. computeFlatLayout
 * gives every panel a FlatPanel frame, and renderPanelCanvas crops that panel's
 * ink into a canvas indexed by it. Fold3D builds the panel from a chain of hinge
 * rotations, which gives it a frame of its own. For most panels the two agree;
 * for some they differ by a reflection, and nothing used to reconcile them:
 *
 *  - a `bottom` hinge opens at baseAngle = PI about X, so its frame is flipped
 *    in Y — and the layout walks it y-flipped too, so those two matched;
 *  - a `left` hinge opens at baseAngle = PI about Y, so its frame is flipped in
 *    X — but the layout places a left-attached panel unflipped, starting its own
 *    width back from the parent's left edge, so those two did NOT match.
 *
 * Rather than hand-derive a rule per hinge edge and hope it keeps matching, this
 * measures it: replay the hinge chain with the sheet flat, then compare each
 * panel's own axes against the FlatPanel axes the texture was cut along. Whatever
 * reflection is left over is what the UVs have to undo, and whichever way local
 * +Z ends up pointing is which physical face carries the print.
 *
 * Folding is deliberately not part of this — it is all evaluated at foldAmount 0.
 * Ink does not move to the other side of the board, so a glue tab or tuck flap
 * that ends up printed-side-inward once the box closes is correct and is left
 * alone.
 */
export interface PanelPrintFrame {
  /** Sample the texture from 1 - u: the mesh's local +X runs against the sheet's. */
  flipU: boolean;
  /** Sample the texture from 1 - v: the mesh's local +Y runs against the sheet's. */
  flipV: boolean;
  /** Local +Z faces the back of the board, so the outside artwork paints on BackSide. */
  mirrored: boolean;
}

const UNFLIPPED: PanelPrintFrame = { flipU: false, flipV: false, mirrored: false };

/** Fold3D's computeHinge, at rest. Kept in step with it by verify-print-side. */
function restHinge(node: PanelNode, parentW: number, parentH: number) {
  const offset = node.parentOffset ?? 0;
  switch (node.parentEdge) {
    case "right": return { pivot: [parentW, offset, 0] as const, euler: new THREE.Euler(0, 0, 0) };
    case "left": return { pivot: [0, offset, 0] as const, euler: new THREE.Euler(0, Math.PI, 0) };
    case "top": return { pivot: [offset, parentH, 0] as const, euler: new THREE.Euler(0, 0, 0) };
    case "bottom": return { pivot: [offset, 0, 0] as const, euler: new THREE.Euler(Math.PI, 0, 0) };
    default: return { pivot: [0, 0, 0] as const, euler: new THREE.Euler(0, 0, 0) };
  }
}

export function panelPrintFrames(root: PanelNode, layout: DielineLayout): Map<string, PanelPrintFrame> {
  const out = new Map<string, PanelPrintFrame>();
  const byId = new Map(layout.panels.map((panel) => [panel.id, panel]));

  const visit = (node: PanelNode, parentW: number, parentH: number, parent: THREE.Matrix4) => {
    const { pivot, euler } = restHinge(node, parentW, parentH);
    const matrix = new THREE.Matrix4().multiplyMatrices(
      parent,
      new THREE.Matrix4().compose(
        new THREE.Vector3(pivot[0], pivot[1], pivot[2]),
        new THREE.Quaternion().setFromEuler(euler),
        new THREE.Vector3(1, 1, 1),
      ),
    );

    const panel = byId.get(node.id);
    if (panel) {
      // The mesh's own axes, in flat world space.
      const origin = new THREE.Vector3(0, 0, 0).applyMatrix4(matrix);
      const meshX = new THREE.Vector3(node.w, 0, 0).applyMatrix4(matrix).sub(origin);
      const meshY = new THREE.Vector3(0, node.h, 0).applyMatrix4(matrix).sub(origin);
      const meshZ = new THREE.Vector3(0, 0, 1).transformDirection(matrix);

      // The same two axes as the texture was cut along.
      const sheetOrigin = panelLocalToWorld(panel, [0, 0]);
      const sheetX = panelLocalToWorld(panel, [panel.w, 0]);
      const sheetY = panelLocalToWorld(panel, [0, panel.h]);

      out.set(node.id, {
        flipU: meshX.x * (sheetX[0] - sheetOrigin[0]) + meshX.y * (sheetX[1] - sheetOrigin[1]) < 0,
        flipV: meshY.x * (sheetY[0] - sheetOrigin[0]) + meshY.y * (sheetY[1] - sheetOrigin[1]) < 0,
        mirrored: meshZ.z < 0,
      });
    }

    for (const child of node.children ?? []) visit(child, node.w, node.h, matrix);
  };
  visit(root, root.w, root.h, new THREE.Matrix4());
  return out;
}

export function printFrameOf(frames: Map<string, PanelPrintFrame>, id: string): PanelPrintFrame {
  return frames.get(id) ?? UNFLIPPED;
}
