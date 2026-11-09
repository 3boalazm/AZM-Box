/**
 * Treats every box as a set of pieces and checks the one property that must hold
 * for all of them: a flap hung off ANY free edge of ANY piece closes INWARD, over
 * the opening, and ends up inside the finished box — not sticking out of it.
 *
 * The templates only ever grow flaps on the four tube walls, so that is the only
 * case their own tests cover. Here every shell piece of every template gets a
 * flap on each of its free top/bottom edges in turn, including hand-added faces
 * and faces chained onto other faces, and each one is folded and measured.
 *
 * Replays the same hinge math as Fold3D/verify-fold: hinge base angles, the
 * panel's fold angle, composed through THREE's own matrices.
 */
import * as THREE from "three";
import { BOX_STYLES, getBoxStyle } from "../src/geometry/boxBuilders";
import { attachFlap, freeEdges, pieces } from "../src/geometry/boxModel";
import { applyPanelEdits } from "../src/geometry/panelEdits";
import { rect } from "../src/geometry/shapes";
import type { PanelNode } from "../src/geometry/types";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`  ${ok ? "OK  " : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
}

/**
 * Fold3D nudges each flap along its own normal so stacked layers do not z-fight.
 * The replay has to apply it too: without it this test measured a box the
 * renderer never draws, and passed a tongue whose crease end was being pushed out
 * through the face it was supposed to hide behind.
 */
const FLAP_STACK_MM = 0.3;
const GLUE_INSET_MM = 0.25;
function stackInset(n: PanelNode): number {
  if (n.tucked) return 0;
  if (n.parentEdge === "top" || n.parentEdge === "bottom") {
    const layer = Math.max(0, Math.min(1, n.foldStart ?? 0));
    return (n.parentEdge === "top" ? 1 : -1) * FLAP_STACK_MM * layer;
  }
  if (n.face === "glue" && (n.parentEdge === "left" || n.parentEdge === "right")) return GLUE_INSET_MM;
  return 0;
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

interface Tip { id: string; name: string; face: string; pos: THREE.Vector3; corners: THREE.Vector3[]; normal: THREE.Vector3 }

/** Tip (far edge midpoint) and outline corners of every panel at full fold. */
function tipsAtClose(root: PanelNode): Tip[] {
  const out: Tip[] = [];
  const walk = (n: PanelNode, pw: number, ph: number, parent: THREE.Object3D) => {
    const h = hinge(n, pw, ph) as { p: number[]; ax: string; b: number };
    const g = new THREE.Group();
    g.position.set(h.p[0], h.p[1], h.p[2]);
    const a = h.b + (n.foldAngle ?? 0);
    if (h.ax === "x") g.rotation.set(a, 0, 0); else g.rotation.set(0, a, 0);
    parent.add(g);
    const inner = new THREE.Group();
    inner.position.set(0, 0, stackInset(n));
    g.add(inner);
    inner.updateWorldMatrix(true, false);
    const pts = n.outline ?? rect(n.w, n.h);
    const midX = (Math.min(...pts.map((p) => p[0])) + Math.max(...pts.map((p) => p[0]))) / 2;
    const maxY = Math.max(...pts.map((p) => p[1]));
    const t = new THREE.Object3D();
    t.position.set(midX, maxY, 0);
    inner.add(t);
    t.updateWorldMatrix(true, false);
    const corners = pts.map(([x, y]) => {
      const c = new THREE.Object3D();
      c.position.set(x, y, 0);
      inner.add(c);
      c.updateWorldMatrix(true, false);
      return new THREE.Vector3().setFromMatrixPosition(c.matrixWorld);
    });
    const normal = new THREE.Vector3(0, 0, 1).transformDirection(inner.matrixWorld);
    out.push({ id: n.id, name: n.name, face: String(n.face), pos: new THREE.Vector3().setFromMatrixPosition(t.matrixWorld), corners, normal });
    for (const k of n.children ?? []) walk(k, n.w, n.h, inner);
  };
  walk(root, 0, 0, new THREE.Group());
  return out;
}

/** Footprint of the closed box, taken from the shell pieces only. */
function shellBox(root: PanelNode, tips: Tip[]) {
  const shellIds = new Set(pieces(root).filter((p) => p.kind === "shell").map((p) => p.id));
  // Every corner of every shell panel — a tip alone is one point on one edge, so
  // tips-only collapses the box to the plane those tips happen to share.
  const pts = tips.filter((t) => shellIds.has(t.id)).flatMap((t) => t.corners);
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  for (const p of pts) { min.min(p); max.max(p); }
  return { min, max };
}

function build(styleId: string, extraDims: Record<string, unknown> = {}): PanelNode {
  const style = getBoxStyle(styleId);
  const dims = { ...style.defaultDimensions, ...extraDims } as never;
  return applyPanelEdits(style.build(dims), dims);
}

/** Hang one flap on one free edge and report whether it closes into the box. */
function tryFlap(styleId: string, extraDims: Record<string, unknown>, hostId: string, edge: "top" | "bottom", depth: number) {
  const root = build(styleId, extraDims);
  const node = attachFlap(root, hostId, edge, { depth, profile: "plain", name: "TEST FLAP", foldStart: 0.85, foldEnd: 1 });
  if (!node) return null;
  const tips = tipsAtClose(root);
  const box = shellBox(root, tips.filter((t) => t.id !== node.id));
  const tip = tips.find((t) => t.id === node.id)!;
  const slack = 1.5;
  const inside =
    tip.pos.x >= box.min.x - slack && tip.pos.x <= box.max.x + slack &&
    tip.pos.y >= box.min.y - slack && tip.pos.y <= box.max.y + slack &&
    tip.pos.z >= box.min.z - slack && tip.pos.z <= box.max.z + slack;
  return { inside, tip: tip.pos, box };
}

/** Smallest outside dimension of the closed box — the tightest opening a flap can face. */
function minShellExtent(styleId: string, extraDims: Record<string, unknown>): number {
  const root = build(styleId, extraDims);
  const box = shellBox(root, tipsAtClose(root));
  return Math.min(box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z);
}

function sweep(label: string, styleId: string, extraDims: Record<string, unknown> = {}) {
  const root = build(styleId, extraDims);
  const shellIds = new Set(pieces(root).filter((p) => p.kind === "shell").map((p) => p.id));
  const byId = new Map(pieces(root).map((p) => [p.id, p]));
  const targets = freeEdges(root).filter((f) => shellIds.has(f.pieceId) && (f.edge === "top" || f.edge === "bottom"));

  const bad: string[] = [];
  let tested = 0;
  for (const target of targets) {
    const host = byId.get(target.pieceId)!;
    // This sweep is about fold DIRECTION, so keep the flap shallow enough to fit.
    // A flap deeper than its opening is a separate case, covered below.
    const shallow = Math.max(4, Math.min(target.span / 2, 30, minShellExtent(styleId, extraDims) / 2));
    const depth = shallow;
    const res = tryFlap(styleId, extraDims, target.pieceId, target.edge as "top" | "bottom", depth);
    if (!res) continue;
    tested++;
    if (!res.inside) bad.push(`${host.name} ${target.edge} -> tip (${res.tip.x.toFixed(0)},${res.tip.y.toFixed(0)},${res.tip.z.toFixed(0)}) outside [${res.box.min.x.toFixed(0)}..${res.box.max.x.toFixed(0)}, ${res.box.min.y.toFixed(0)}..${res.box.max.y.toFixed(0)}, ${res.box.min.z.toFixed(0)}..${res.box.max.z.toFixed(0)}]`);
  }
  for (const b of bad) console.log(`        ${b}`);
  check(label, bad.length === 0, `${tested} free edges flapped, ${bad.length} closed outward`);
}

console.log("A flap on every free top/bottom edge of every shell piece must close INTO the box:\n");
for (const style of BOX_STYLES) sweep(style.label.padEnd(28), style.id);

// A depth of 0 removes a template's own flap from that wall, freeing the edge —
// so this pass actually reaches every wall of every template instead of only the
// handful that happen to ship without a flap.
const NO_FLAPS = { flapEdges: { top: { front: 0, back: 0, left: 0, right: 0 }, bottom: { front: 0, back: 0, left: 0, right: 0 } } };
console.log("\nSame sweep with the templates' own flaps removed, so every wall edge is free:\n");
for (const style of BOX_STYLES) sweep(style.label.padEnd(28), style.id, NO_FLAPS);

console.log("\nBoxes with hand-added and removed faces:\n");
sweep("reverse-tuck-end, your project ", "reverse-tuck-end", {
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
sweep("tuck-end, face added on bottom  ", "tuck-end", {
  panelEdits: { removed: [], added: [{ id: "x1", parentId: "front", edge: "bottom", depth: 40 }] },
});

console.log("\nFlaps DEEPER than the opening they close — the tongue must tuck inside:\n");

function overDeep(label: string, styleId: string, extraDims: Record<string, unknown>, flapName: string) {
  const root = build(styleId, extraDims);
  const tips = tipsAtClose(root);
  const target = tips.filter((t) => t.name.includes(flapName));
  if (target.length === 0) { check(label, false, `no panel named "${flapName}"`); return; }
  const others = tips.filter((t) => !t.name.includes(flapName));
  const box = shellBox(root, others);
  const slack = 1.5;
  const out = target.filter((t) =>
    t.pos.x < box.min.x - slack || t.pos.x > box.max.x + slack ||
    t.pos.y < box.min.y - slack || t.pos.y > box.max.y + slack ||
    t.pos.z < box.min.z - slack || t.pos.z > box.max.z + slack);
  for (const t of out) console.log(`        ${t.name} tip (${t.pos.x.toFixed(0)},${t.pos.y.toFixed(0)},${t.pos.z.toFixed(0)}) sticks out of [${box.min.x.toFixed(0)}..${box.max.x.toFixed(0)}, ${box.min.y.toFixed(0)}..${box.max.y.toFixed(0)}, ${box.min.z.toFixed(0)}..${box.max.z.toFixed(0)}]`);
  // The tongue must end up strictly INSIDE the shell, not sitting in the plane of
  // the wall it folds against: coplanar is what let it render on the outside of a
  // closed box.
  const margin = 0.2;
  // Every CORNER, not just the tip: the crease end is what was being pushed out
  // through the face, while the free end sat correctly inside.
  const tongues = target.filter((t) => t.name.includes("Tongue"));
  // Only along the axis the tongue lies against — the wall it has to hide behind.
  // Across the other two it hugs the crease, where dipping a fraction past the
  // box's own rim is just the lean and says nothing about which side it is on.
  const flush: Tip[] = [];
  for (const t of tongues) {
    const n = t.normal;
    const axis: "x" | "y" | "z" = Math.abs(n.x) >= Math.abs(n.y) && Math.abs(n.x) >= Math.abs(n.z) ? "x" : Math.abs(n.y) >= Math.abs(n.z) ? "y" : "z";
    const bad = t.corners.filter((p) => p[axis] < box.min[axis] - margin || p[axis] > box.max[axis] + margin);
    if (bad.length === 0) continue;
    flush.push(t);
    const w = bad[0];
    console.log(`        ${t.name}: ${bad.length}/${t.corners.length} corners out through the wall on ${axis}, e.g. ${axis}=${w[axis].toFixed(2)} vs [${box.min[axis].toFixed(2)}..${box.max[axis].toFixed(2)}]`);
  }
  check(label, out.length === 0 && flush.length === 0, `${target.length} panel(s) from the split, ${tongues.length} tongue(s) tucked behind the wall`);
}

// Your box: a bottom flap 80 mm deep on a box only 70 mm deep.
overDeep("80 mm flap on a 70 mm deep box ", "reverse-tuck-end",
  { length: 135, width: 70, height: 95, flapEdges: { bottom: { back: 80 } } }, "Bottom Tuck Flap (Back)");

// The same overshoot, but on a wall the user added by hand — the case the old
// reach table skipped entirely, so the tongue was never split off.
overDeep("over-deep flap on a hand-added wall", "reverse-tuck-end", {
  length: 135, width: 70, height: 95,
  panelEdits: { removed: [], added: [
    { id: "extra-a", parentId: "front", edge: "left", depth: 70 },
    { id: "extra-deep", parentId: "extra-a", edge: "top", depth: 160 },
  ] },
}, "Extra face 2");

// The top closure of the real project: a face added on the BACK wall's top edge,
// 80 mm deep over a 70 mm opening. Its tongue faces the other way from the bottom
// one, which is exactly why the bottom of the box looked right while the top kept
// showing the tongue through the front face.
overDeep("deep top closure, your project", "reverse-tuck-end", {
  length: 135, width: 70, height: 95, endFlapRight: 15,
  flapEdges: { bottom: { back: 80 } },
  panelEdits: { removed: ["front/right:left/right:back/right:right", "front/top:flap-top-front"], added: [
    { id: "extra-a", parentId: "front", edge: "left", depth: 70 },
    { id: "extra-b", parentId: "front/right:left/right:back", edge: "top", depth: 80 },
    { id: "extra-c", parentId: "extra-a", edge: "top", depth: 28 },
  ] },
}, "Extra face 2");

console.log(failures === 0 ? "\nAll box-piece checks passed." : `\n${failures} box-piece check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
