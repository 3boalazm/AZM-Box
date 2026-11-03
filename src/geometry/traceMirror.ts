import type { DielineLayout, FlatPanel, Point } from "./types";

/**
 * Per-face TRACE mirroring.
 *
 * Some dies are cut from the mirrored side of the sheet, so one face (typically
 * the back) appears mirrored in the die file. `PanelEdits.mirrored` lists those
 * faces; applyTraceMirror() returns a copy of the flat layout in which every
 * trace element that belongs to a mirrored face — its outline polygon, the cut
 * paths inside it, and the fold lines on its edges — is flipped horizontally
 * about that face's own vertical centre line.
 *
 * Only the TRACE is mirrored. Artwork mapping (which reads `layout.panels`
 * min/max/points for cropping) must keep using the ORIGINAL layout, so placed
 * artwork is never flipped; pass this mirrored layout only to the places that
 * draw or export cut/fold lines (2D editor overlay, SVG/PDF/DXF exporters).
 *
 * A plain rectangular face mirrors onto itself, so for the common back-wall
 * case the cut outline is unchanged while the face's fold lines swap sides —
 * exactly what a mirrored die-cut of that face looks like. Asymmetric outlines
 * (dust-flap chamfers, tuck slots, lock tabs) flip for real.
 */

const EPS = 1e-6;

/** Horizontal mirror of x about the panel's own vertical centre line. */
const mirrorX = (panel: FlatPanel, x: number) => panel.min[0] + panel.max[0] - x;

function within(panel: FlatPanel, [x, y]: Point): boolean {
  return x >= panel.min[0] - EPS && x <= panel.max[0] + EPS && y >= panel.min[1] - EPS && y <= panel.max[1] + EPS;
}

/**
 * Returns `layout` unchanged when no face is mirrored (the common case), so
 * callers can use the result unconditionally without extra memo branches.
 */
export function applyTraceMirror(layout: DielineLayout, mirroredIds: ReadonlySet<string>): DielineLayout {
  if (mirroredIds.size === 0) return layout;
  const flagged = layout.panels.filter((p) => mirroredIds.has(p.id));
  if (flagged.length === 0) return layout;

  const ownerOf = (pt: Point): FlatPanel | undefined => flagged.find((p) => within(p, pt));

  const panels = layout.panels.map((p) =>
    mirroredIds.has(p.id) ? { ...p, points: p.points.map(([x, y]): Point => [mirrorX(p, x), y]) } : p,
  );

  // Each cut-outline polygon is produced per panel (see cutPaths in layout.ts),
  // so a polygon whose points all sit inside one mirrored face belongs to that
  // face and flips with it. Polygons spanning several panels stay untouched.
  const cutOutline = layout.cutOutline.map((poly) => {
    const match = flagged.find((p) => poly.length > 0 && poly.every((pt) => within(p, pt)));
    return match ? poly.map(([x, y]): Point => [mirrorX(match, x), y]) : poly;
  });

  // A fold line belongs to a mirrored face when both its endpoints lie inside
  // that same face — that is the face's own hinge edge, which flips with it.
  const foldLines = layout.foldLines.map((f) => {
    const a = ownerOf(f.a);
    const b = ownerOf(f.b);
    if (a && a === b) return { a: [mirrorX(a, f.a[0]), f.a[1]] as Point, b: [mirrorX(a, f.b[0]), f.b[1]] as Point };
    return f;
  });

  return { ...layout, panels, cutOutline, foldLines };
}

/** Ids of the faces currently flagged as trace-mirrored, for display/export. */
export function mirroredTraceIds(dims: { panelEdits?: { mirrored?: string[] } }): ReadonlySet<string> {
  return new Set(dims.panelEdits?.mirrored ?? []);
}
