import { BOX_STYLES, getBoxStyle } from "../src/geometry/boxBuilders";
import { computeFlatLayout } from "../src/geometry/layout";
import { parseProject, serializeProject } from "../src/project/projectFile";
import { emptyArtwork } from "../src/artwork/types";
import { DEFAULT_SCENE_SETTINGS, MATERIAL_PRESETS, normalizeSceneSettings } from "../src/project/sceneSettings";
import { transferDimensionsToTemplate } from "../src/geometry/templateDimensions";
import { planPages } from "../src/geometry/paginate";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

const style = getBoxStyle("tuck-end");
const base = { ...style.defaultDimensions };
const t = 1.5;

const plain = computeFlatLayout(style.build(base));
const inside = computeFlatLayout(style.build({ ...base, materialThickness: t }));
const outside = computeFlatLayout(style.build({ ...base, materialThickness: t, dimensionBasis: "external" }));
const zero = computeFlatLayout(style.build({ ...base, materialThickness: 0 }));

// Four wall panels wrap the tube, each one caliper wider than the inside size.
check("zero thickness leaves the layout untouched", near(zero.bounds.width, plain.bounds.width) && near(zero.bounds.height, plain.bounds.height));
check("inside basis widens the strip by 4 calipers", near(inside.bounds.width - plain.bounds.width, 4 * t), `${(inside.bounds.width - plain.bounds.width).toFixed(3)} mm`);
check("outside basis narrows the strip by 4 calipers", near(plain.bounds.width - outside.bounds.width, 4 * t), `${(plain.bounds.width - outside.bounds.width).toFixed(3)} mm`);
const frontPlain = plain.panels.find((p) => p.face === "front")!;
const frontInside = inside.panels.find((p) => p.face === "front")!;
const sidePlain = plain.panels.find((p) => p.face === "left")!;
const sideInside = inside.panels.find((p) => p.face === "left")!;
check("front panel = L + t", near(frontInside.w - frontPlain.w, t));
check("side panel = W + t", near(sideInside.w - sidePlain.w, t));
check("wall height = H + t", near(frontInside.h - frontPlain.h, t));

for (const definition of BOX_STYLES) {
  const layout = computeFlatLayout(getBoxStyle(definition.id).build({ ...definition.defaultDimensions, materialThickness: 2 }));
  check(`${definition.id} still builds with thickness`, layout.panels.length > 0 && layout.bounds.width > 0);
}

// Board settings travel across template switches and survive a save/load.
const moved = transferDimensionsToTemplate({ ...base, materialThickness: 3, dimensionBasis: "external" }, getBoxStyle("rsc").defaultDimensions, false);
check("thickness carries across templates", moved.materialThickness === 3 && moved.dimensionBasis === "external");
const saved = serializeProject("tuck-end", { ...base, materialThickness: 0.55, dimensionBasis: "external" }, emptyArtwork(), DEFAULT_SCENE_SETTINGS, {});
const loaded = parseProject(saved);
check("project round-trips thickness and basis", loaded.dims.materialThickness === 0.55 && loaded.dims.dimensionBasis === "external");
let rejected = false;
try { parseProject(saved.replace('"materialThickness":0.55', '"materialThickness":-4')); } catch { rejected = true; }
check("negative thickness is rejected", rejected);

// Older projects have no material parameters or studio fields: they keep their look.
const legacy = normalizeSceneSettings({ material: "metallic", ambient: 0.5 });
check("legacy preset expands to its parameters", legacy.materialParams.roughness === MATERIAL_PRESETS.metallic.roughness && legacy.materialParams.metalness === MATERIAL_PRESETS.metallic.metalness);
check("legacy projects get no studio reflections", legacy.envLight === 0 && legacy.exposure === 1 && legacy.fov === 40);
const bad = normalizeSceneSettings({ materialParams: { roughness: 9, texture: "bogus", tint: "red" }, modelRotation: [1, "x", 3], fov: 500 });
check("scene values are clamped and sanitised", bad.materialParams.roughness === 1 && bad.materialParams.texture === "none" && bad.materialParams.tint === "#ffffff" && bad.modelRotation[1] === 0 && bad.fov === 100);

// Paper sizes: the same dieline needs more pages on a smaller sheet.
const sheet = { width: 380, height: 260 };
const a3 = planPages(sheet, 10, { width: 297, height: 420 });
const a5 = planPages(sheet, 10, { width: 148, height: 210 });
check("a dieline that fits A3 is a single page", a3.singlePage && a3.pages.length === 1);
check("the same dieline tiles across several A5 pages", !a5.singlePage && a5.pages.length > 1, `${a5.pages.length} pages`);

if (failures) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
console.log("All caliper, settings and paper checks passed.");
