import type { HingeEdge, PanelNode } from "./types";

/**
 * Whether a panel is drawn back-to-front in the FLAT SHEET — i.e. whether its
 * local +Z, the side THREE.FrontSide paints the outside artwork on, points away
 * from the printed face of the sheet.
 *
 * `left` and `bottom` hinges start pre-rotated a half turn (baseAngle = PI in
 * Fold3D's computeHinge), so a panel hanging off one of those edges is already
 * turned over while the sheet is still flat; two of them cancel, so this is a
 * running XOR down the hinge chain.
 *
 * Folding is deliberately NOT part of this. Which physical face carries the print
 * is decided by the sheet, and no amount of folding moves the ink to the other
 * side. A flap that ends up with its printed face towards the box interior — a
 * glue tab under GLUE_TUCK, a lid tuck flap pushed down inside — is behaving
 * correctly and must keep rendering that way.
 */
export function childPrintMirrored(parentMirrored: boolean, edge: HingeEdge | undefined): boolean {
  return edge === "left" || edge === "bottom" ? !parentMirrored : parentMirrored;
}

export function printMirroredById(root: PanelNode): Map<string, boolean> {
  const out = new Map<string, boolean>();
  const visit = (node: PanelNode, mirrored: boolean) => {
    out.set(node.id, mirrored);
    for (const child of node.children ?? []) {
      visit(child, childPrintMirrored(mirrored, child.parentEdge));
    }
  };
  visit(root, false);
  return out;
}
