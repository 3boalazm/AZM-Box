/**
 * Save -> load round-trip for the .pbox project format: builds a state using
 * EVERY artwork feature (sheet image w/ offset+size+rotation, per-panel image,
 * text + logo layers on both sides), serializes, parses, and asserts deep
 * equality. Also checks corrupted/foreign input is rejected cleanly and that a
 * pre-`sheetRotation`-era file loads with defaults (forward compatibility).
 */
import { serializeProject, parseProject } from "../src/project/projectFile";
import { normalizeSceneSettings } from "../src/project/sceneSettings";
import { emptySide } from "../src/artwork/types";
import type { ArtworkState } from "../src/artwork/types";
import { DEFAULT_SCENE_SETTINGS } from "../src/project/sceneSettings";
import type { BoxDimensions, BoxStyleId } from "../src/geometry/types";

const px = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const artwork: ArtworkState = {
  outside: {
    ...emptySide("#ffffff"),
    sheetImage: px,
    sheetOffset: { x: 12.5, y: -3.25 },
    sheetWidth: 216,
    sheetHeight: 178,
    sheetRotation: 45,
    panelImages: { "front-1": px },
    layers: [
      { id: "t1", kind: "text", panelId: "front-1", x: 5, y: 10, text: "Hello Box", fontSize: 8, color: "#112233", rotation: 15 },
      { id: "i1", kind: "image", panelId: "back-3", x: 1, y: 2, width: 30, height: 20, src: px, rotation: -30 },
    ],
  },
  inside: { ...emptySide("#f2ede3"), layers: [{ id: "t2", kind: "text", panelId: "left-2", x: 3, y: 4, text: "inside note", fontSize: 5, color: "#000000", rotation: 0 }] },
};
const dims = {
  length: 70,
  width: 24,
  height: 100,
  endFlapRight: 18,
  flaps: { front: 24, back: 18, left: 35, right: 35 },
  flapEdges: { top: { front: 28 }, bottom: { back: 16 } },
  flapWidths: { front: 68 },
  flapShapes: { front: "tuck" as const },
};

let fails = 0;
const check = (label: string, ok: boolean) => { console.log(`${ok ? "ok  " : "FAIL"} ${label}`); if (!ok) fails++; };

// 1. full round trip
const scene = { background: "#dce4ec", ambient: 1.35, keyLight: 0.55, preset: "front" as const, cameraPose: { position: [101, 70, 90] as [number, number, number], target: [20, 32, -10] as [number, number, number], up: [0, 1, 0] as [number, number, number] } };
const templateMemory: Partial<Record<BoxStyleId, BoxDimensions>> = {
  "tuck-end": { ...dims, endFlapRight: 22 },
  mailer: { length: 230, width: 170, height: 75, lidDepth: 68, flapEdges: { top: { back: 52 } } },
};
const loaded = parseProject(serializeProject("card-deck-lock", dims, artwork, scene, templateMemory));
check("box style survives", loaded.boxStyleId === "card-deck-lock");
check("dims survive (incl. asymmetric flap depths, widths, and shapes)", JSON.stringify(loaded.dims) === JSON.stringify(dims));
check("artwork survives byte-identically", JSON.stringify(loaded.artwork) === JSON.stringify(artwork));
check("embedded image data URL intact", loaded.artwork.outside.sheetImage === px && loaded.artwork.outside.panelImages["front-1"] === px);
check("scene settings survive round trip", JSON.stringify(loaded.scene) === JSON.stringify(normalizeSceneSettings(scene)));
check("per-template dimensions and custom closures survive", loaded.templateMemory["tuck-end"]?.endFlapRight === 22 && loaded.templateMemory["tuck-end"]?.flapEdges?.top?.front === 28 && loaded.templateMemory.mailer?.lidDepth === 68 && loaded.templateMemory.mailer?.flapEdges?.top?.back === 52);
const versionTwo = parseProject(JSON.stringify({ app: "packbox", version: 2, boxStyleId: "rsc", dims: { length: 300, width: 200, height: 200 }, scene }));
check("version 2 project migrates with its scene and empty template memory", JSON.stringify(versionTwo.scene) === JSON.stringify(normalizeSceneSettings(scene)) && Object.keys(versionTwo.templateMemory).length === 0);
const versionOne = parseProject(JSON.stringify({ app: "packbox", version: 1, boxStyleId: "rsc", dims: { length: 300, width: 200, height: 200 } }));
check("version 1 project migrates with default scene", JSON.stringify(versionOne.scene) === JSON.stringify(DEFAULT_SCENE_SETTINGS));

// 2. rejects garbage with readable errors
for (const [label, bad] of [["random text", "not json at all"], ["foreign JSON", '{"hello":1}'], ["wrong version", '{"app":"packbox","version":99}'], ["unknown style", '{"app":"packbox","version":1,"boxStyleId":"nope","dims":{"length":1,"width":1,"height":1}}'], ["oversized dimensions", '{"app":"packbox","version":1,"boxStyleId":"rsc","dims":{"length":6000,"width":20,"height":20}}'], ["negative flap depth", '{"app":"packbox","version":1,"boxStyleId":"rsc","dims":{"length":30,"width":20,"height":20,"flapEdges":{"top":{"front":-2}}}}']] as const) {
  let threw = false;
  try { parseProject(bad); } catch (e) { threw = e instanceof Error && e.message.length > 5; }
  check(`rejects ${label}`, threw);
}

// 3. forward compatibility: an "old" file missing sheetRotation/sheetWidth loads with defaults
const oldFile = JSON.stringify({
  app: "packbox", version: 1, savedAt: "2026-01-01", boxStyleId: "card-deck",
  dims: { length: 70, width: 24, height: 100 },
  artwork: { outside: { sheetImage: px, sheetOffset: { x: 0, y: 0 }, panelImages: {}, layers: [], backgroundColor: "#fff" }, inside: {} },
});
const old = parseProject(oldFile);
check("old file loads, missing fields get defaults", old.artwork.outside.sheetRotation === 0 && Number.isFinite(old.artwork.outside.sheetWidth) && old.artwork.inside.backgroundColor === "#f2ede3");

console.log(fails === 0 ? "\nALL PROJECT-FILE CHECKS PASSED" : `\n${fails} FAILED`);
process.exit(fails ? 1 : 0);
