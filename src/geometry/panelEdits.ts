import type { AddedFace, BoxDimensions, HingeEdge, PanelEdits, PanelNode } from "./types";

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

function locate(root: PanelNode): Map<string, Located> {
  const found = new Map<string, Located>();
  const visit = (node: PanelNode, mirrored: boolean) => {
    found.set(node.id, { node, mirrored });
    for (const child of node.children) visit(child, mirrored || child.parentEdge === "bottom");
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
  const { node, mirrored } = located;
  if (mirrored || node.outline) return false;
  if (node.parentEdge && (node.parentEdge === "top" || node.parentEdge === "bottom" ? edge === "bottom" : edge === OPPOSITE[node.parentEdge])) return false;
  return !node.children.some((child) => child.parentEdge === edge);
}

const edgeLength = (node: PanelNode, edge: HingeEdge) => (edge === "top" || edge === "bottom" ? node.w : node.h);

function buildAddedFace(face: AddedFace, parent: PanelNode, index: number): PanelNode {
  const span = edgeLength(parent, face.edge);
  const horizontal = face.edge === "top" || face.edge === "bottom";
  return {
    id: face.id,
    name: `Extra face ${index + 1}`,
    w: horizontal ? span : face.depth,
    h: horizontal ? face.depth : span,
    parentEdge: face.edge,
    parentOffset: 0,
    parentId: parent.id,
    foldAngle: FOLD_ANGLE[face.edge],
    foldStart: 0.7,
    foldEnd: 1,
    hinged: true,
    face: "extra",
    children: [],
  };
}

/** Applies the removals, then the additions, to a tree whose ids are already stable. */
export function applyPanelEdits(root: PanelNode, edits?: PanelEdits): PanelNode {
  if (!edits || (!edits.removed?.length && !edits.added?.length)) return root;

  const removed = new Set(edits.removed ?? []);
  removed.delete(root.id);
  const prune = (node: PanelNode) => {
    node.children = node.children.filter((child) => !removed.has(child.id));
    node.children.forEach(prune);
  };
  prune(root);

  const located = locate(root);
  (edits.added ?? []).forEach((face, index) => {
    const parent = located.get(face.parentId);
    if (!parent || located.has(face.id) || !canHost(parent, face.edge)) return;
    const node = buildAddedFace(face, parent.node, index);
    parent.node.children.push(node);
    located.set(node.id, { node, mirrored: parent.mirrored || face.edge === "bottom" });
  });
  return root;
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

/** The ids of a face and every face hinged beyond it. */
export function faceSubtreeIds(root: PanelNode, panelId: string): string[] {
  const start = locate(root).get(panelId)?.node;
  if (!start) return [];
  const ids: string[] = [];
  const visit = (node: PanelNode) => { ids.push(node.id); node.children.forEach(visit); };
  visit(start);
  return ids;
}

const withEdits = (dims: BoxDimensions, edits: PanelEdits): BoxDimensions => {
  const { panelEdits: _old, ...rest } = dims;
  return edits.removed?.length || edits.added?.length ? { ...rest, panelEdits: edits } : rest;
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

/** Takes a face (and everything hinged beyond it) out of the box. The base face cannot be removed. */
export function removeFace(dims: BoxDimensions, root: PanelNode, panelId: string): BoxDimensions {
  if (panelId === root.id) return dims;
  const subtree = new Set(faceSubtreeIds(root, panelId));
  if (subtree.size === 0) return dims;
  const edits = dims.panelEdits ?? {};
  const added = (edits.added ?? []).filter((face) => !subtree.has(face.id));
  const wasAdded = added.length !== (edits.added ?? []).length && (edits.added ?? []).some((face) => face.id === panelId);
  const removed = wasAdded || (edits.removed ?? []).includes(panelId) ? edits.removed ?? [] : [...(edits.removed ?? []), panelId];
  return withEdits(dims, { removed: removed.slice(0, MAX_REMOVED), added });
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
  return (dims.panelEdits?.removed?.length ?? 0) + (dims.panelEdits?.added?.length ?? 0);
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
  return removed.length || added.length ? { ...(removed.length ? { removed } : {}), ...(added.length ? { added } : {}) } : undefined;
}
