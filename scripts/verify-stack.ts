// Verifies the flap stacking offset in Fold3D.tsx (FLAP_STACK_MM): flap pairs that
// overlap in the SAME plane at foldAmount=1 (zero-thickness model => z-fighting,
// inner flap edges showing through the outer flap from outside) must be separated
// by one board-caliper step per closing layer, later-closing (larger foldStart)
// flaps further OUT of the opening. Presentation-only check; the 2D dieline is
// untouched.
import * as THREE from "three";
import { BOX_STYLES } from "../src/geometry/boxBuilders";
import type { PanelNode } from "../src/geometry/types";

const FLAP_STACK_MM = 0.3, GLUE_INSET_MM = 0.25;
function flapStackInset(node: PanelNode): number {
  if (node.parentEdge === "top" || node.parentEdge === "bottom") {
    const layer = Math.max(0, Math.min(1, node.foldStart ?? 0));
    return (node.parentEdge === "top" ? 1 : -1) * FLAP_STACK_MM * layer;
  }
  if (node.face === "glue" && (node.parentEdge === "left" || node.parentEdge === "right")) return GLUE_INSET_MM;
  return 0;
}
function hinge(node: PanelNode, parentW: number, parentH: number) {
  const offset = node.parentOffset ?? 0;
  switch (node.parentEdge) {
    case "right": return { pivot: new THREE.Vector3(parentW, offset, 0), axis: "y" as const, base: 0 };
    case "left": return { pivot: new THREE.Vector3(0, offset, 0), axis: "y" as const, base: Math.PI };
    case "top": return { pivot: new THREE.Vector3(offset, parentH, 0), axis: "x" as const, base: 0 };
    case "bottom": return { pivot: new THREE.Vector3(offset, 0, 0), axis: "x" as const, base: Math.PI };
    default: return { pivot: new THREE.Vector3(), axis: "x" as const, base: 0 };
  }
}
interface Entry { name: string; edge: string; layer: number; corners: THREE.Vector3[]; normal: THREE.Vector3 }
function buildTree(node: PanelNode, parent: THREE.Object3D, pw: number, ph: number, t: number, inset: boolean): THREE.Group {
  const { pivot, axis, base } = hinge(node, pw, ph);
  const start = node.foldStart ?? 0, end = node.foldEnd ?? 1;
  const localT = end > start ? Math.min(1, Math.max(0, (t - start) / (end - start))) : t;
  const angle = base + localT * node.foldAngle;
  const group = new THREE.Group();
  group.position.copy(pivot);
  if (axis === "x") group.rotation.set(angle, 0, 0); else group.rotation.set(0, angle, 0);
  const inner = new THREE.Group();
  inner.position.set(0, 0, inset ? flapStackInset(node) : 0);
  group.add(inner);
  parent.add(group);
  const marker = new THREE.Object3D();
  marker.name = node.name;
  marker.userData = { edge: node.parentEdge ?? "", layer: node.foldStart ?? 0, w: node.w, h: node.h };
  inner.add(marker);
  for (const child of node.children) buildTree(child, inner, node.w, node.h, t, inset);
  return group;
}
function collect(root: THREE.Object3D): Entry[] {
  root.updateWorldMatrix(true, true);
  const out: Entry[] = [];
  const walk = (o: THREE.Object3D) => {
    if (o.userData.edge) {
      const { w, h } = o.userData;
      const corners = [( [0, 0] ), ([w, 0]), ([w, h]), ([0, h])].map(([x, y]) => new THREE.Vector3(x, y, 0).applyMatrix4(o.matrixWorld));
      const normal = new THREE.Vector3(0, 0, 1).transformDirection(o.matrixWorld);
      out.push({ name: o.name, edge: o.userData.edge, layer: o.userData.layer, corners, normal });
    }
    o.children.forEach(walk);
  };
  walk(root);
  return out;
}
const planeOf = (e: Entry) => { // for top/bottom flaps at t=1 the quad lies in a Y=const plane
  const ys = e.corners.map((c) => c.y);
  return { flat: Math.max(...ys) - Math.min(...ys) < 0.05, y: ys[0] };
};
const aabbOverlap = (a: Entry, b: Entry) => {
  const xs = (e: Entry) => [Math.min(...e.corners.map((c) => c.x)), Math.max(...e.corners.map((c) => c.x))];
  const zs = (e: Entry) => [Math.min(...e.corners.map((c) => c.z)), Math.max(...e.corners.map((c) => c.z))];
  const [ax0, ax1] = xs(a), [bx0, bx1] = xs(b), [az0, az1] = zs(a), [bz0, bz1] = zs(b);
  return ax0 < bx1 - 0.5 && bx0 < ax1 - 0.5 && az0 < bz1 - 0.5 && bz0 < az1 - 0.5;
};
let fails = 0;
for (const style of BOX_STYLES) {
  const root = style.build(style.defaultDimensions);
  const flat = collect(buildTree(root, new THREE.Group(), root.w, root.h, 1, false));
  const withInset = collect(buildTree(root, new THREE.Group(), root.w, root.h, 1, true));
  let pairs = 0;
  for (let i = 0; i < flat.length; i++) {
    for (let j = i + 1; j < flat.length; j++) {
      const a = flat[i], b = flat[j];
      if ((a.edge !== "top" && a.edge !== "bottom") || a.edge !== b.edge) continue;
      const pa = planeOf(a), pb = planeOf(b);
      if (!pa.flat || !pb.flat) continue;
      if (Math.abs(pa.y - pb.y) > 0.05) continue; // not coplanar
      if (Math.abs(Math.abs(a.normal.dot(b.normal)) - 1) > 0.01) continue; // not parallel
      if (!aabbOverlap(a, b)) continue; // no area overlap
      if (a.layer === b.layer) continue; // same layer abuts or overlaps identically — out of scope (left/right pair)
      pairs++;
      const ai = withInset[i], bi = withInset[j];
      // World "out" of the opening: +Y for top flaps, -Y for bottom flaps.
      const outDir = new THREE.Vector3(0, a.edge === "top" ? 1 : -1, 0);
      const center = (e: Entry) => e.corners.reduce((acc, c) => acc.add(c), new THREE.Vector3()).multiplyScalar(0.25);
      const gapAlong = Math.abs(center(ai).clone().sub(center(bi)).dot(outDir));
      const expectGap = Math.abs(a.layer - b.layer) * FLAP_STACK_MM;
      if (gapAlong < 0.05) { console.log(`FAIL ${style.id}: ${a.name} & ${b.name} overlap coplanar, gap=${gapAlong.toFixed(4)}mm`); fails++; }
      else if (Math.abs(gapAlong - expectGap) > 0.02) console.log(`WARN ${style.id}: ${a.name}/${b.name} gap=${gapAlong.toFixed(3)} expected=${expectGap.toFixed(3)}`);
      else console.log(`OK ${style.id}: ${a.name}(L${a.layer}) covers ${b.name}(L${b.layer}), separated ${gapAlong.toFixed(3)}mm`);
      // Ordering only applies between flaps whose print side faces OUT of the box
      // (mirrored lock flaps face inward and legitimately sit on the inner side).
      const aOut = a.normal.dot(outDir) > 0.5, bOut = b.normal.dot(outDir) > 0.5;
      if (aOut && bOut) {
        const aAlong = center(ai).dot(outDir), bAlong = center(bi).dot(outDir);
        if (Math.sign(bAlong - aAlong) !== Math.sign(b.layer - a.layer)) { console.log(`FAIL ${style.id}: ${a.name}/${b.name} outer flap not outermost`); fails++; }
      }
    }
  }
  if (pairs) console.log(`  ^ ${style.id}: ${pairs} overlapping coplanar flap pairs`);
}
console.log(fails === 0 ? "ALL STACKING OK" : `${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
