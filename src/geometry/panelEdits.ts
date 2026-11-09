import type { AddedFace, BoxDimensions, FaceRole, HingeEdge, PanelEdits, PanelNode } from "./types";

/**
 * Hand edits on top of a template: faces taken away, and rectangular faces added
 * to free edges. They live in `BoxDimensions.panelEdits` so they are saved,
 * undone and carried per template like every other dimension.
 *
 * Faces are addressed by a STRUCTURAL id (the route from the base face through
 * hinge edges and face roles), not by build order, so an id keeps meaning the
 * same face when any dimension changes and the whole tree is rebuilt. Artwork
 * pinned to a face therefore stays on that face.
 */

const OPPOSITE: Record<HingeEdge, HingeEdge> = { top: "bottom", bottom: "top", left: "right", right: "left" };
const MAX_REMOVED = 200;
const MAX_ADDED = 60;
const MAX_ID_LENGTH = 300;
const MIN_DEPTH_MM = 1;
const MAX_DEPTH_MM = 2000;

// Same signs the template builders use, so an added face folds the way the
// matching template flap would.
const FOLD_ANGLE: Record<HingeEdge, number> = { top: -Math.PI / 2, bottom: Math.PI / 2, right: Math.PI / 2, left: -Math.PI / 2 };

export const FACE_EDGES: HingeEdge[] = ["top", "right", "bottom", "left"];

/**
 * Fold window for a face added on `edge` of `host`, following the template
 * builders' own closing order: side-wall flaps close FIRST (they end up as the
 * INNER layers of the closure, tucked under), front/back "face" flaps close LAST
 * (the outermost layer that covers everything), and glue-panel lock flaps land
 * between. Left/right hinges (seam tabs and wall extensions) move with the tube.
 * A face chained onto another flap folds after its parent settles, so tongues
 * tuck in at the very end instead of racing their parent.
 *
 * The stacking inset in Fold3D derives its layer from foldStart, so distinct
 * windows also fix the physical layering: flaps that used to share one window
 * z-fought and drew over the face flap "from outside".
 */
export function addedFacePhase(host: PanelNode, edge: HingeEdge): { foldStart: number; foldEnd: number } {
  if (edge === "left" || edge === "right") return { foldStart: 0, foldEnd: 0.4 };
  switch (host.face) {
    case "left":
    case "right":
      return { foldStart: 0.4, foldEnd: 0.7 };
    case "front":
    case "back":
      return { foldStart: 0.7, foldEnd: 1 };
    case "glue":
      return { foldStart: 0.55, foldEnd: 0.8 };
    default: {
      const pStart = host.foldStart ?? 0;
      const pEnd = host.foldEnd ?? 1;
      const span = Math.max(0.15, pEnd - pStart);
      const start = Math.min(pEnd, 0.8);
      return { foldStart: start, foldEnd: Math.min(1, start + Math.max(0.2, span)) };
    }
  }
}

/** Gives every face an id that depends only on where it sits in the tree. */
export function assignStableIds(root: PanelNode): PanelNode {
  const visit = (node: PanelNode, parent?: PanelNode) => {
    if (parent) {
      const base = `${parent.id}/${node.parentEdge}:${node.face}`;
      const taken = parent.children.filter((sibling) => sibling !== node && sibling.id.startsWith(base)).length;
      node.id = taken ? `${base}~${taken + 1}` : base;
      node.parentId = parent.id;
    } else {
      node.id = node.face;
    }
    node.children.forEach((child) => visit(child, node));
  };
  // Siblings are numbered in order, so clear the old ids first or a stale one could collide.
  const clear = (node: PanelNode) => { node.id = ""; node.children.forEach(clear); };
  clear(root);
  visit(root);
  return root;
}

interface Located { node: PanelNode; mirrored: boolean }

/**
 * Whether a panel's local frame is flipped relative to its parent's — i.e. its
 * local +Z (the printed/outside side) ends up facing INTO the box instead of
 * out of it. Children of a flipped panel must fold the opposite way to still
 * close inward over the opening (the same effect as the card-deck lock flaps,
 * whose signs are negated by hand in boxBuilders.ts).
 *
 * Two things flip a frame:
 *  - hinges that start pre-rotated 180° in computeHinge (bottom, left), and
 *  - folds that rotate a half turn (|foldAngle| = PI, e.g. the glue tab tuck).
 * Ignoring the left/right case is what made faces chained off a side tab or the
 * glue panel swing OUTSIDE the box instead of tucking in.
 */
function childMirrored(parentMirrored: boolean, edge: HingeEdge | undefined, foldAngle?: number): boolean {
  let flipped = parentMirrored;
  if (edge === "bottom" || edge === "left") flipped = !flipped;
  if (foldAngle !== undefined && Math.abs(Math.abs(foldAngle) - Math.PI) < 1e-6) flipped = !flipped;
  return flipped;
}

function locate(root: PanelNode): Map<string, Located> {
  const found = new Map<string, Located>();
  const visit = (node: PanelNode, mirrored: boolean) => {
    found.set(node.id, { node, mirrored });
    for (const child of node.children) visit(child, childMirrored(mirrored, child.parentEdge, child.foldAngle));
  };
  visit(root, false);
  return found;
}

/**
 * A face can carry children only if it is a plain rectangle that the flat layout
 * draws unmirrored (bottom-attached flaps are laid out as leaves), and only on an
 * edge that is neither its own hinge nor already taken by another face.
 */
function canHost(located: Located, edge: HingeEdge): boolean {
  const { node } = located;
  if (node.outline) return false;
  if (node.parentEdge && (node.parentEdge === "top" || node.parentEdge === "bottom" ? edge === "bottom" : edge === OPPOSITE[node.parentEdge])) return false;
  return !node.children.some((child) => child.parentEdge === edge);
}

const edgeLength = (node: PanelNode, edge: HingeEdge) => (edge === "top" || edge === "bottom" ? node.w : node.h);

function buildAddedFace(face: AddedFace, parent: PanelNode, index: number, parentMirrored: boolean): PanelNode {
  const span = edgeLength(parent, face.edge);
  const horizontal = face.edge === "top" || face.edge === "bottom";
  // A mirrored (flipped-frame) parent reverses the sense of every fold about it —
  // negate so the new face still closes INWARD over the box instead of swinging
  // outside (same mirror effect as GLUE_TUCK).
  const base = FOLD_ANGLE[face.edge];
  const phase = addedFacePhase(parent, face.edge);
  return {
    id: face.id,
    name: `Extra face ${index + 1}`,
    w: horizontal ? span : face.depth,
    h: horizontal ? face.depth : span,
    parentEdge: face.edge,
    parentOffset: 0,
    parentId: parent.id,
    foldAngle: parentMirrored ? -base : base,
    foldStart: phase.foldStart,
    foldEnd: phase.foldEnd,
    hinged: true,
    face: "extra",
    children: [],
  };
}

const sizeOf = (node: PanelNode): number => 1 + node.children.reduce((sum, child) => sum + sizeOf(child), 0);

// Opposite walls of a box look alike, so a box never has them side by side.
const OPPOSITE_PAIR: Partial<Record<FaceRole, string>> = { front: "front/back", back: "front/back", left: "left/right", right: "left/right" };

function lookAlike(a: PanelNode, b: PanelNode): boolean {
  const pairA = OPPOSITE_PAIR[a.face];
  const pairB = OPPOSITE_PAIR[b.face];
  if (pairA && pairB) return pairA === pairB;
  return Math.abs(a.w - b.w) < 0.5 && Math.abs(a.h - b.h) < 0.5;
}

/**
 * The face that takes over when `node` is removed. In a strip of walls the next
 * wall along the same edge closes the gap (it is re-hinged to the removed face's
 * parent) — unless that would put two look-alike faces next to each other, such as
 * the two sides or the front and back. A box always has a different face between
 * them, so then nothing closes up and everything beyond goes with the removed face.
 * For the base face the biggest group of faces becomes the new base.
 */
function successorOf(node: PanelNode, isRoot: boolean, parent?: PanelNode): PanelNode | undefined {
  // Hand-added faces never become the base: they only exist once the template is settled.
  if (isRoot) return [...node.children].filter((child) => child.face !== "extra").sort((a, b) => sizeOf(b) - sizeOf(a))[0];
  const next = node.children.find((child) => child.parentEdge === node.parentEdge);
  return next && parent && lookAlike(parent, next) ? undefined : next;
}

/**
 * Applies the removals (re-rooting the tree if the base face is among them), then
 * the additions.
 */
export function applyPanelEdits(root: PanelNode, edits?: PanelEdits): PanelNode {
  if (!edits || (!edits.removed?.length && !edits.added?.length)) return root;

  const removed = new Set(edits.removed ?? []);
  const rootRemoved = removed.delete(root.id);

  // A removed face disappears together with its flaps and tabs; the next wall
  // along the same edge, if any, is re-hinged in its place.
  const settle = (parent: PanelNode, child: PanelNode): PanelNode[] => {
    if (!removed.has(child.id)) return [child];
    const next = successorOf(child, false, parent);
    if (!next) return [];
    next.parentEdge = child.parentEdge;
    next.parentOffset = child.parentOffset ?? 0;
    next.parentId = parent.id;
    return settle(parent, next);
  };
  const prune = (node: PanelNode) => {
    node.children = node.children.flatMap((child) => settle(node, child));
    node.children.forEach(prune);
  };
  prune(root);

  let base = root;
  if (rootRemoved) {
    const next = successorOf(root, true);
    if (next) {
      delete next.parentEdge;
      delete next.parentOffset;
      delete next.parentId;
      next.foldAngle = 0;
      next.hinged = false;
      next.foldStart = undefined;
      next.foldEnd = undefined;
      base = next;
    }
  }

  const located = locate(base);
  (edits.added ?? []).forEach((face, index) => {
    const parent = located.get(face.parentId);
    if (!parent || located.has(face.id) || !canHost(parent, face.edge)) return;
    const node = buildAddedFace(face, parent.node, index, parent.mirrored);
    parent.node.children.push(node);
    located.set(node.id, { node, mirrored: childMirrored(parent.mirrored, face.edge, node.foldAngle) });
  });

  return base;
}

export interface FaceHandle {
  panelId: string;
  edge: HingeEdge;
}

/** Every edge where a new face can be attached. */
export function freeFaceEdges(root: PanelNode): FaceHandle[] {
  const handles: FaceHandle[] = [];
  for (const [panelId, located] of locate(root)) {
    for (const edge of FACE_EDGES) if (canHost(located, edge)) handles.push({ panelId, edge });
  }
  return handles;
}

const subtreeIds = (node: PanelNode): string[] => [node.id, ...node.children.flatMap(subtreeIds)];

/** The ids of every face that disappears when `panelId` is removed (the face, its flaps and tabs). */
export function faceRemovalLoss(root: PanelNode, panelId: string): string[] {
  const node = locate(root).get(panelId)?.node;
  if (!node) return [];
  const keep = successorOf(node, node === root, node.parentId ? locate(root).get(node.parentId)?.node : undefined);
  return [node.id, ...node.children.filter((child) => child !== keep).flatMap(subtreeIds)];
}

const withEdits = (dims: BoxDimensions, edits: PanelEdits): BoxDimensions => {
  const { panelEdits: _old, ...rest } = dims;
  const next: PanelEdits = {
    ...(edits.removed?.length ? { removed: edits.removed } : {}),
    ...(edits.added?.length ? { added: edits.added } : {}),
    ...(edits.mirrored?.length ? { mirrored: edits.mirrored } : {}),
  };
  return Object.keys(next).length > 0 ? { ...rest, panelEdits: next } : rest;
};

let addedCounter = 0;
function newFaceId(taken: Set<string>): string {
  let id: string;
  do {
    addedCounter += 1;
    id = `extra-${Date.now().toString(36)}${addedCounter.toString(36)}`;
  } while (taken.has(id));
  return id;
}

/** Adds a face on a free edge. Returns the new dimensions and the face's id, or null if the edge is not free. */
export function addFace(dims: BoxDimensions, root: PanelNode, parentId: string, edge: HingeEdge): { dims: BoxDimensions; id: string } | null {
  const located = locate(root);
  const parent = located.get(parentId);
  const edits = dims.panelEdits ?? {};
  if (!parent || !canHost(parent, edge) || (edits.added?.length ?? 0) >= MAX_ADDED) return null;
  const span = edgeLength(parent.node, edge);
  const depth = Math.round(Math.min(Math.max(10, span * 0.4), 40));
  const id = newFaceId(new Set(located.keys()));
  return { dims: withEdits(dims, { ...edits, added: [...(edits.added ?? []), { id, parentId, edge, depth }] }), id };
}

/**
 * Takes a face out of the box together with the flaps and tabs hinged to it. The
 * faces beyond it close up the gap, and removing the base face makes the biggest
 * remaining group the new base. The last face cannot be removed.
 */
export function removeFace(dims: BoxDimensions, root: PanelNode, panelId: string): BoxDimensions {
  const node = locate(root).get(panelId)?.node;
  if (!node || (node === root && root.children.length === 0)) return dims;
  const edits = dims.panelEdits ?? {};
  const lost = new Set(faceRemovalLoss(root, panelId));
  const wasAdded = (edits.added ?? []).some((face) => face.id === panelId);
  // An added face hinged to the removed one keeps its place if it is the one closing the gap.
  const added = (edits.added ?? [])
    .filter((face) => !lost.has(face.id))
    .map((face) => (face.parentId === panelId && node.parentId ? { ...face, parentId: node.parentId } : face));
  const removed = wasAdded || (edits.removed ?? []).includes(panelId) ? edits.removed ?? [] : [...(edits.removed ?? []), panelId];
  // A removed face cannot stay trace-mirrored — drop it from the mirror list too.
  const mirrored = (edits.mirrored ?? []).filter((id) => !lost.has(id) && id !== panelId);
  return withEdits(dims, { removed: removed.slice(0, MAX_REMOVED), added, ...(mirrored.length ? { mirrored } : {}) });
}

export function setAddedFaceDepth(dims: BoxDimensions, id: string, depth: number): BoxDimensions {
  const edits = dims.panelEdits;
  if (!edits?.added?.some((face) => face.id === id)) return dims;
  const clamped = Math.min(MAX_DEPTH_MM, Math.max(MIN_DEPTH_MM, depth));
  return withEdits(dims, { ...edits, added: edits.added.map((face) => (face.id === id ? { ...face, depth: clamped } : face)) });
}

export function clearPanelEdits(dims: BoxDimensions): BoxDimensions {
  return withEdits(dims, {});
}

export function panelEditCount(dims: BoxDimensions): number {
  return (dims.panelEdits?.removed?.length ?? 0) + (dims.panelEdits?.added?.length ?? 0) + (dims.panelEdits?.mirrored?.length ?? 0);
}

/** True when the face's trace (cut/fold lines) is currently drawn mirrored. */
export function isFaceMirrored(dims: BoxDimensions, panelId: string): boolean {
  return (dims.panelEdits?.mirrored ?? []).includes(panelId);
}

/**
 * Toggles horizontal trace-mirroring of a face: its cut outline and fold lines
 * flip about the face's own centre in the 2D dieline and every export, while
 * artwork placed on the face is left untouched.
 */
export function toggleFaceMirror(dims: BoxDimensions, panelId: string): BoxDimensions {
  const edits = dims.panelEdits ?? {};
  const current = edits.mirrored ?? [];
  const mirrored = current.includes(panelId) ? current.filter((id) => id !== panelId) : [...current, panelId].slice(0, MAX_REMOVED);
  return withEdits(dims, { removed: edits.removed, added: edits.added, mirrored });
}

const isId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= MAX_ID_LENGTH;

/**
 * Reads untrusted `panelEdits` (a project file). Entries that are malformed are
 * dropped rather than failing the whole load, so an odd file still opens.
 */
export function sanitizePanelEdits(raw: unknown): PanelEdits | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const source = raw as Record<string, unknown>;
  const removed = Array.isArray(source.removed) ? [...new Set(source.removed.filter(isId))].slice(0, MAX_REMOVED) : [];
  const mirrored = Array.isArray(source.mirrored) ? [...new Set(source.mirrored.filter(isId))].slice(0, MAX_REMOVED) : [];
  const seen = new Set<string>();
  const added: AddedFace[] = [];
  for (const entry of Array.isArray(source.added) ? source.added : []) {
    if (typeof entry !== "object" || entry === null) continue;
    const face = entry as Record<string, unknown>;
    if (!isId(face.id) || !isId(face.parentId) || seen.has(face.id)) continue;
    if (!FACE_EDGES.includes(face.edge as HingeEdge)) continue;
    if (typeof face.depth !== "number" || !Number.isFinite(face.depth)) continue;
    seen.add(face.id);
    added.push({ id: face.id, parentId: face.parentId, edge: face.edge as HingeEdge, depth: Math.min(MAX_DEPTH_MM, Math.max(MIN_DEPTH_MM, face.depth)) });
    if (added.length >= MAX_ADDED) break;
  }
  return removed.length || added.length || mirrored.length
    ? { ...(removed.length ? { removed } : {}), ...(added.length ? { added } : {}), ...(mirrored.length ? { mirrored } : {}) }
    : undefined;
}
