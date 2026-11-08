// Verifies that faces added with the panel-edit "add face" feature always close
// INWARD over the box at full fold — including faces chained off side tabs, the
// glue panel and other added faces, where the host's frame is flipped and the
// fold sign must be negated. Regression guard for the childMirrored() fix in
// panelEdits.ts (faces chained through left/right hinges used to swing outside).
import * as THREE from "three";
import { getBoxStyle } from "../src/geometry/boxBuilders";
import { rect } from "../src/geometry/shapes";
import type { AddedFace, BoxDimensions, BoxStyleId, PanelNode } from "../src/geometry/types";

function computeHinge(node: PanelNode, parentW: number, parentH: number) {
  const offset = node.parentOffset ?? 0;
  switch (node.parentEdge) {
    case "right": return { pivot: [parentW, offset, 0] as [number, number, number], axis: "y" as const, baseAngle: 0 };
    case "left": return { pivot: [0, offset, 0] as [number, number, number], axis: "y" as const, baseAngle: Math.PI };
    case "top": return { pivot: [offset, parentH, 0] as [number, number, number], axis: "x" as const, baseAngle: 0 };
    case "bottom": return { pivot: [offset, 0, 0] as [number, number, number], axis: "x" as const, baseAngle: Math.PI };
    default: return { pivot: [0, 0, 0] as [number, number, number], axis: "x" as const, baseAngle: 0 };
  }
}

function buildGroup(node: PanelNode, parentW: number, parentH: number, foldAmount: number): THREE.Group {
  const { pivot, axis, baseAngle } = computeHinge(node, parentW, parentH);
  const start = node.foldStart ?? 0;
  const end = node.foldEnd ?? 1;
  const localT = end > start ? Math.min(1, Math.max(0, (foldAmount - start) / (end - start))) : foldAmount;
  const angle = baseAngle + localT * node.foldAngle;
  const group = new THREE.Group();
  group.position.set(...pivot);
  if (axis === "x") group.rotation.set(angle, 0, 0);
  else group.rotation.set(0, angle, 0);
  const pts = node.outline ?? rect(node.w, node.h);
  const midX = (Math.min(...pts.map((p) => p[0])) + Math.max(...pts.map((p) => p[0]))) / 2;
  const maxY = Math.max(...pts.map((p) => p[1]));
  const marker = new THREE.Object3D();
  marker.position.set(midX, maxY, 0);
  marker.name = `${node.name}::tip`;
  group.add(marker);
  for (const child of node.children) group.add(buildGroup(child, node.w, node.h, foldAmount));
  return group;
}

function collectTips(group: THREE.Object3D, out: { name: string; pos: THREE.Vector3 }[]) {
  group.updateWorldMatrix(true, false);
  if (group.name.endsWith("::tip")) {
    const pos = new THREE.Vector3();
    group.getWorldPosition(pos);
    out.push({ name: group.name.replace("::tip", ""), pos });
  }
  for (const child of group.children) collectTips(child, out);
}

function findFace(root: PanelNode, match: (n: PanelNode) => boolean): PanelNode | undefined {
  if (match(root)) return root;
  for (const c of root.children) {
    const f = findFace(c, match);
    if (f) return f;
  }
  return undefined;
}

interface Case {
  style: BoxStyleId;
  label: string;
  host: (n: PanelNode) => boolean;
  added: AddedFace[];
}

// Every case builds one or more chained extra faces and checks that each one's
// tip finishes INSIDE the box footprint at foldAmount = 1.
const cases: Case[] = [
  {
    style: "rsc",
    label: "extra face on a wall's free left edge",
    host: (n) => n.face === "front" && !n.parentEdge,
    added: [{ id: "extra-a", parentId: "front", edge: "left", depth: 25 }],
  },
  {
    style: "rsc",
    label: "chained off a left-edge tab (top/bottom/left)",
    host: (n) => n.face === "front" && !n.parentEdge,
    added: [
      { id: "extra-a", parentId: "front", edge: "left", depth: 25 },
      { id: "extra-b", parentId: "extra-a", edge: "top", depth: 25 },
      { id: "extra-c", parentId: "extra-a", edge: "bottom", depth: 25 },
      { id: "extra-d", parentId: "extra-a", edge: "left", depth: 25 },
      { id: "extra-e", parentId: "extra-b", edge: "top", depth: 25 },
      { id: "extra-f", parentId: "extra-b", edge: "right", depth: 25 },
    ],
  },
  {
    style: "rsc",
    label: "chained off a bottom flap (mirrored host)",
    host: (n) => n.face === "flap-bottom-front",
    added: [
      { id: "extra-a", parentId: "flap-bottom-front", edge: "top", depth: 25 },
      { id: "extra-b", parentId: "extra-a", edge: "top", depth: 25 },
      { id: "extra-c", parentId: "extra-a", edge: "left", depth: 25 },
      { id: "extra-d", parentId: "extra-a", edge: "right", depth: 25 },
      { id: "extra-e", parentId: "extra-a", edge: "bottom", depth: 25 },
    ],
  },
  {
    style: "rsc",
    label: "chained off a top flap",
    host: (n) => n.face === "flap-top-back",
    added: [
      { id: "extra-a", parentId: "flap-top-back", edge: "top", depth: 25 },
      { id: "extra-b", parentId: "extra-a", edge: "top", depth: 25 },
      { id: "extra-c", parentId: "extra-a", edge: "left", depth: 25 },
    ],
  },
];

let failures = 0;
for (const c of cases) {
  const style = getBoxStyle(c.style);
  const dims: BoxDimensions = { ...style.defaultDimensions };
  const probe = style.build({ ...dims });
  const host = findFace(probe, c.host);
  if (!host) {
    console.log(`FAIL ${c.label}: host face not found`);
    failures++;
    continue;
  }
  // Chain ids "extra-*" reference earlier entries in the same list; the first
  // entry attaches to the probe's structural host id.
  const added = c.added.map((a) => ({ ...a }));
  added[0].parentId = host.id;
  const root = getBoxStyle(c.style).build({ ...dims, panelEdits: { added } });
  const g = buildGroup(root, root.w, root.h, 1);
  g.updateWorldMatrix(true, true);
  const tips: { name: string; pos: THREE.Vector3 }[] = [];
  collectTips(g, tips);
  const L = dims.length, W = dims.width, H = dims.height;
  console.log(`\n${c.label} [${c.style}]`);
  let any = false;
  for (const t of tips.filter((t) => t.name.startsWith("Extra face"))) {
    any = true;
    const inside = t.pos.x >= -1 && t.pos.x <= L + 1 && t.pos.z >= -W - 1 && t.pos.z <= 1 && t.pos.y >= -1 && t.pos.y <= H + 1;
    if (!inside) failures++;
    console.log(`  ${t.name.padEnd(16)} tip=(${t.pos.x.toFixed(1)},${t.pos.y.toFixed(1)},${t.pos.z.toFixed(1)})  ${inside ? "OK (closes inward)" : "BUG (closes outward)"}`);
  }
  if (!any) {
    console.log("  FAIL: no extra faces were attached");
    failures++;
  }
}

console.log(`\n${failures === 0 ? "ALL EXTRA-FACE FOLDS OK" : `${failures} PROBLEM(S) FOUND`}`);
process.exitCode = failures === 0 ? 0 : 1;
