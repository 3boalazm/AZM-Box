import { getBoxStyle } from "../src/geometry/boxBuilders";
import { computeFlatLayout, flattenTree } from "../src/geometry/layout";
import { addFace, clearPanelEdits, faceRemovalLoss, freeFaceEdges, panelEditCount, removeFace, sanitizePanelEdits, setAddedFaceDepth } from "../src/geometry/panelEdits";
import { parseProject, serializeProject } from "../src/project/projectFile";
import { emptyArtwork } from "../src/artwork/types";
import { DEFAULT_SCENE_SETTINGS } from "../src/project/sceneSettings";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}

const style = getBoxStyle("tuck-end");
const base = { ...style.defaultDimensions };
const build = (dims = base) => style.build(dims);
const root = build();
const ids = flattenTree(root).map((node) => node.id);

check("every face has a unique id", new Set(ids).size === ids.length && ids.every(Boolean), `${ids.length} faces`);
check("ids do not change when the box is rebuilt", JSON.stringify(flattenTree(build()).map((n) => n.id)) === JSON.stringify(ids));
const resized = flattenTree(build({ ...base, length: base.length + 20, height: base.height + 5 })).map((n) => n.id);
check("ids survive a dimension change", JSON.stringify(resized) === JSON.stringify(ids));
check("every child points at its parent id", flattenTree(root).every((n) => n.children.every((c) => c.parentId === n.id)));

// Adding a face.
const handles = freeFaceEdges(root);
check("free edges are offered", handles.length > 0, `${handles.length} handles`);
check("no handle is offered on an edge that already has a face", handles.every((h) => {
  const node = flattenTree(root).find((n) => n.id === h.panelId)!;
  return !node.children.some((c) => c.parentEdge === h.edge);
}));
const front = flattenTree(root).find((n) => n.face === "front")!;
const handle = handles.find((h) => h.panelId === front.id)!;
const added = addFace(base, root, handle.panelId, handle.edge)!;
check("a face can be added on a free edge", !!added && panelEditCount(added.dims) === 1);
const withAdded = build(added.dims);
const layoutBefore = computeFlatLayout(root);
const layoutAfter = computeFlatLayout(withAdded);
const extra = layoutAfter.panels.find((p) => p.id === added.id)!;
check("the new face appears in the layout", layoutAfter.panels.length === layoutBefore.panels.length + 1 && extra?.face === "extra");
const horizontal = handle.edge === "top" || handle.edge === "bottom";
check("the new face spans the whole edge it is hinged to", horizontal ? Math.abs(extra.w - front.w) < 1e-6 : Math.abs(extra.h - front.h) < 1e-6, `${extra.w.toFixed(1)} x ${extra.h.toFixed(1)}`);
check("its edge is no longer offered again", !freeFaceEdges(withAdded).some((h) => h.panelId === handle.panelId && h.edge === handle.edge));
check("the new face has a fold line", layoutAfter.foldLines.length === layoutBefore.foldLines.length + 1);
check("a face cannot be added twice on the same edge", addFace(added.dims, withAdded, handle.panelId, handle.edge) === null);

// It keeps its place when the box is resized.
const afterResize = computeFlatLayout(build({ ...added.dims, length: base.length + 30 }));
check("an added face survives a resize and stays attached", afterResize.panels.some((p) => p.id === added.id));

// Its depth can be edited.
const deeper = setAddedFaceDepth(added.dims, added.id, 55);
const deeperExtra = computeFlatLayout(build(deeper)).panels.find((p) => p.id === added.id)!;
check("an added face can be resized", horizontal ? Math.abs(deeperExtra.h - 55) < 1e-6 : Math.abs(deeperExtra.w - 55) < 1e-6);
check("depth is clamped", (setAddedFaceDepth(added.dims, added.id, -5).panelEdits?.added?.[0].depth ?? 0) >= 1);

// A face can be added to an added face.
const chain = freeFaceEdges(withAdded).find((h) => h.panelId === added.id);
const second = chain ? addFace(added.dims, withAdded, chain.panelId, chain.edge) : null;
check("faces can be chained", !!second && computeFlatLayout(build(second.dims)).panels.some((p) => p.id === second.id));

// Removing faces.
const flap = flattenTree(root).find((n) => n.face.startsWith("flap-top"))!;
const noFlap = build(removeFace(base, root, flap.id));
check("a template flap can be removed", !flattenTree(noFlap).some((n) => n.id === flap.id) && flattenTree(noFlap).length === ids.length - 1);
check("a removed flap's edge becomes free for a new face", freeFaceEdges(noFlap).some((h) => h.panelId === flap.parentId && h.edge === "top"));

// Removing a wall in the strip: its flaps go with it and the next wall closes the gap.
const wall = flattenTree(root).find((n) => n.face === "left")!;
const back = flattenTree(root).find((n) => n.face === "back")!;
const lostWithWall = faceRemovalLoss(root, wall.id);
const noWallDims = removeFace(base, root, wall.id);
const noWall = build(noWallDims);
const noWallLayout = computeFlatLayout(noWall);
check("removing a wall also removes its own flaps", lostWithWall.length === 3 && flattenTree(noWall).length === ids.length - 3, `${lostWithWall.length} faces`);
check("the wall beyond it closes the gap", flattenTree(noWall).find((n) => n.id === back.id)?.parentId === wall.parentId);
check("the strip gets shorter by the removed wall", Math.abs(computeFlatLayout(root).bounds.width - noWallLayout.bounds.width - wall.w) < 1e-6, `-${wall.w} mm`);
check("the closed-up faces keep working hinges", noWallLayout.foldLines.length >= noWallLayout.panels.length - 2);

// Removing the base face: the biggest remaining group becomes the new base.
const lostWithBase = faceRemovalLoss(root, root.id);
const noBaseDims = removeFace(base, root, root.id);
const noBase = build(noBaseDims);
check("the base face can be removed", noBaseDims !== base && !flattenTree(noBase).some((n) => n.id === root.id));
check("the tree gets a new base without a hinge", noBase.id !== root.id && noBase.parentEdge === undefined && noBase.parentId === undefined && noBase.hinged === false && noBase.foldAngle === 0);
check("the base face takes only its own flaps with it", flattenTree(noBase).length === ids.length - lostWithBase.length && lostWithBase.length === 3, `${lostWithBase.length} faces`);
const noBaseLayout = computeFlatLayout(noBase);
check("the dieline is still one connected piece", noBaseLayout.panels.length === flattenTree(noBase).length && noBaseLayout.bounds.width > 0);
check("the removed base leaves a free edge to add a face back", freeFaceEdges(noBase).some((h) => h.panelId === noBase.id));
const refilled = addFace(noBaseDims, noBase, noBase.id, freeFaceEdges(noBase).find((h) => h.panelId === noBase.id)!.edge);
check("a face can be added where the base was", !!refilled && computeFlatLayout(build(refilled.dims)).panels.length === noBaseLayout.panels.length + 1);
check("a lone face cannot be removed", removeFace({ ...base }, { ...root, children: [] }, root.id).panelEdits === undefined);
check("removing an unknown face does nothing", removeFace(base, root, "nope") === base);

// An added face that closes the gap survives its parent being removed.
const strip = addFace(base, root, flattenTree(root).find((n) => n.face === "glue")!.id, "right")!;
const stripRoot = build(strip.dims);
const glue = flattenTree(stripRoot).find((n) => n.face === "glue")!;
const withoutGlue = build(removeFace(strip.dims, stripRoot, glue.id));
check("an added face keeps its place when its parent is removed", flattenTree(withoutGlue).some((n) => n.id === strip.id && n.parentId === glue.parentId));

const undone = removeFace(added.dims, withAdded, added.id);
check("removing an added face leaves no trace", panelEditCount(undone) === 0 && undone.panelEdits === undefined);
check("clearing resets every edit", clearPanelEdits({ ...base, panelEdits: { removed: ["x"], added: [] } }).panelEdits === undefined);

// Edits whose face is gone are ignored instead of crashing.
const dangling = build({ ...base, panelEdits: { removed: ["missing"], added: [{ id: "extra-1", parentId: "missing", edge: "top", depth: 10 }] } });
check("edits that point at missing faces are ignored", flattenTree(dangling).length === ids.length);

// Saving and loading.
const saved = serializeProject("tuck-end", added.dims, emptyArtwork(), DEFAULT_SCENE_SETTINGS, { "tuck-end": added.dims });
const loaded = parseProject(saved);
check("panel edits round-trip through a project file", JSON.stringify(loaded.dims.panelEdits) === JSON.stringify(added.dims.panelEdits) && JSON.stringify(loaded.templateMemory["tuck-end"]?.panelEdits) === JSON.stringify(added.dims.panelEdits));
const hostile = sanitizePanelEdits({ removed: [1, "", "ok", "ok"], added: [{ id: "a", parentId: "p", edge: "diagonal", depth: 5 }, { id: "b", parentId: "p", edge: "top", depth: "x" }, { id: "c", parentId: "p", edge: "top", depth: 99999 }, "junk"] });
check("untrusted edits are sanitised", JSON.stringify(hostile) === JSON.stringify({ removed: ["ok"], added: [{ id: "c", parentId: "p", edge: "top", depth: 2000 }] }));

// Every style still builds with an extra face on every free edge, one at a time.
for (const definition of ["tuck-end", "rsc", "mailer", "hsc", "card-deck", "two-piece-lid"] as const) {
  const s = getBoxStyle(definition);
  const r = s.build(s.defaultDimensions);
  const free = freeFaceEdges(r);
  let ok = free.length > 0;
  for (const h of free) {
    const result = addFace(s.defaultDimensions, r, h.panelId, h.edge);
    if (!result) { ok = false; continue; }
    const layout = computeFlatLayout(s.build(result.dims));
    if (layout.panels.length !== flattenTree(r).length + 1) ok = false;
  }
  check(`${definition}: a face can be added on each of its ${free.length} free edges`, ok);
}

if (failures) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
console.log("All panel edit checks passed.");
