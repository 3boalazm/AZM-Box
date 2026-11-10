/**
 * The box seen as PIECES, independent of any one template.
 *
 * The templates in boxBuilders.ts each hard-code which flaps exist, keyed by
 * FlapWall ("front" | "back" | "left" | "right") and a top/bottom edge. That
 * makes a flap something only the four tube walls can have, on two of their
 * four edges — so a face the user adds by hand can never carry a real flap, and
 * a template cannot grow one anywhere else either.
 *
 * This module says the same thing the other way round: a box is a set of pieces,
 * every piece has four edges, any edge with nothing on it is free, and a flap can
 * hang off ANY free edge of ANY piece. The fold direction is derived from the
 * host's own frame rather than looked up per template, which is what lets it work
 * on hand-added faces and on flaps chained onto other flaps.
 */
import { FACE_EDGES, childFrameMirrored } from "./panelEdits";
import { dustFlap, rect, roundedTuckFlap, tuckFlap } from "./shapes";
import type { HingeEdge, PanelNode, Point } from "./types";

export type PieceKind =
  /** Forms the shell of the box: a wall, a lid, a base, or a hand-added face. */
  | "shell"
  /** Closes an opening: tuck flaps, dust flaps, lock flaps. */
  | "flap"
  /** The seam tab that is glued to the opposite wall. */
  | "glue";

export interface Piece {
  id: string;
  name: string;
  kind: PieceKind;
  /** Edge of the host this piece hangs off. Absent on the root. */
  edge?: HingeEdge;
  hostId?: string;
  /** How deep the piece stands out from its host, in mm. */
  depth: number;
  /** True when the piece's own frame runs back-to-front (see childFrameMirrored). */
  mirrored: boolean;
  node: PanelNode;
}

export interface FreeEdge {
  pieceId: string;
  edge: HingeEdge;
  /** Length of that edge in mm — the natural width for a flap placed on it. */
  span: number;
}

export type FlapProfile = "plain" | "dust" | "tuck" | "rounded";

export interface FlapSpec {
  depth: number;
  profile?: FlapProfile;
  name?: string;
  /** Overrides the derived fold window. */
  foldStart?: number;
  foldEnd?: number;
}

const FOLD_BASE: Record<HingeEdge, number> = {
  top: -Math.PI / 2,
  bottom: Math.PI / 2,
  right: Math.PI / 2,
  left: -Math.PI / 2,
};

function kindOf(node: PanelNode): PieceKind {
  if (node.face === "glue") return "glue";
  return String(node.face).startsWith("flap-") ? "flap" : "shell";
}

/** Length of `edge` on `node`, honouring a non-rectangular outline. */
export function edgeSpan(node: PanelNode, edge: HingeEdge): number {
  return edge === "top" || edge === "bottom" ? node.w : node.h;
}

/** Every piece in the box, parents before children. */
export function pieces(root: PanelNode): Piece[] {
  const out: Piece[] = [];
  const visit = (node: PanelNode, host: PanelNode | undefined, mirrored: boolean) => {
    out.push({
      id: node.id,
      name: node.name,
      kind: kindOf(node),
      edge: node.parentEdge,
      hostId: host?.id,
      depth: node.parentEdge === "top" || node.parentEdge === "bottom" ? node.h : node.w,
      mirrored,
      node,
    });
    for (const child of node.children ?? []) {
      // Deliberately called without the child's foldAngle: flapFoldAngle only
      // needs the parity the hinge edges give it, and a half-turn fold is a
      // closure state rather than part of the frame the flap is attached in.
      visit(child, node, childFrameMirrored(mirrored, child.parentEdge));
    }
  };
  visit(root, undefined, false);
  return out;
}

export function pieceById(root: PanelNode): Map<string, Piece> {
  return new Map(pieces(root).map((p) => [p.id, p]));
}

/**
 * Every edge of every piece that has nothing hanging off it yet. Unlike
 * freeFaceEdges in panelEdits, this covers flaps and glue tabs too, so a tongue
 * can be placed on the end of a flap the same way a flap goes on a wall.
 */
export function freeEdges(root: PanelNode): FreeEdge[] {
  const out: FreeEdge[] = [];
  for (const piece of pieces(root)) {
    const taken = new Set((piece.node.children ?? []).map((c) => c.parentEdge));
    // The edge a piece hangs off is its hinge to the host, never free.
    if (piece.edge) taken.add(piece.edge === "top" ? "bottom" : piece.edge === "bottom" ? "top" : piece.edge === "left" ? "right" : "left");
    for (const edge of FACE_EDGES) {
      if (taken.has(edge)) continue;
      out.push({ pieceId: piece.id, edge, span: edgeSpan(piece.node, edge) });
    }
  }
  return out;
}

/** The flaps already hanging off a piece. */
export function flapsOf(root: PanelNode, pieceId: string): Piece[] {
  return pieces(root).filter((p) => p.hostId === pieceId && p.kind === "flap");
}

function outlineFor(profile: FlapProfile, w: number, h: number): Point[] | undefined {
  switch (profile) {
    case "dust": return dustFlap(w, h);
    case "tuck": return tuckFlap(w, h);
    case "rounded": return roundedTuckFlap(w, h);
    default: return rect(w, h);
  }
}

/**
 * Fold a flap on `edge` of `host` so it closes INWARD over the opening.
 *
 * The sign cannot be a per-edge constant: a host that is drawn back-to-front in
 * the flat sheet has a y-flipped local frame, which reverses the sense of every
 * fold about it. Negating for those hosts is what makes the same call work on a
 * wall, on a hand-added face hanging off a left edge, and on a flap chained onto
 * another flap.
 */
export function flapFoldAngle(hostMirrored: boolean, edge: HingeEdge): number {
  const base = FOLD_BASE[edge];
  return hostMirrored ? -base : base;
}

let seq = 0;

/**
 * Hang a flap off any free edge of any piece. Returns the new node, already
 * attached to `host`, or null when that edge is taken.
 */
export function attachFlap(root: PanelNode, hostId: string, edge: HingeEdge, spec: FlapSpec): PanelNode | null {
  const byId = pieceById(root);
  const piece = byId.get(hostId);
  if (!piece) return null;
  const host = piece.node;
  if ((host.children ?? []).some((c) => c.parentEdge === edge)) return null;

  const horizontal = edge === "top" || edge === "bottom";
  const span = edgeSpan(host, edge);
  const w = horizontal ? span : spec.depth;
  const h = horizontal ? spec.depth : span;
  seq += 1;

  const flapFace = horizontal
    ? (`flap-${edge === "top" ? "top" : "bottom"}-${["front", "back", "left", "right"].includes(String(host.face)) ? host.face : "front"}` as PanelNode["face"])
    : ("extra" as PanelNode["face"]);

  const node: PanelNode = {
    id: `flap-${hostId}-${edge}-${seq}`,
    name: spec.name ?? `${host.name} ${edge} flap`,
    w,
    h,
    outline: outlineFor(spec.profile ?? "plain", w, h),
    parentEdge: edge,
    parentOffset: 0,
    parentId: host.id,
    foldAngle: flapFoldAngle(piece.mirrored, edge),
    foldStart: spec.foldStart,
    foldEnd: spec.foldEnd,
    hinged: true,
    face: flapFace,
    children: [],
  };
  host.children.push(node);
  return node;
}
