import { emptyArtwork, type EditorLayer } from "../src/artwork/types";
import { visibleArtwork } from "../src/artwork/layerVisibility";
import { DEFAULT_SCENE_SETTINGS, normalizeSceneSettings } from "../src/project/sceneSettings";
import { serializeProject, parseProject } from "../src/project/projectFile";
import { BOX_STYLES } from "../src/geometry/boxBuilders";
import { computeFlatLayout } from "../src/geometry/layout";
import { generateDielineSVG } from "../src/geometry/svgExport";

let failures = 0;
const check = (name: string, pass: boolean) => { console.log(`${pass ? "ok  " : "FAIL"} ${name}`); if (!pass) failures++; };
const artwork = emptyArtwork();
const image = "data:image/png;base64,QUJD";
const textLayer: EditorLayer = { id: "txt-1", name: "Headline", kind: "text", panelId: "front", x: 2, y: 3, text: "Hello", fontSize: 8, color: "#222222", rotation: 0 };
artwork.outside.sheetImage = image;
artwork.outside.sheetImageName = "Registered sheet";
artwork.outside.panelImages.front = image;
artwork.outside.panelImageNames.front = "Front label";
artwork.outside.layers = [textLayer];
artwork.inside.layers = [{ id: "img-2", name: "Mark", kind: "image", panelId: "back", x: 1, y: 1, width: 12, height: 6, src: image, rotation: 0 }];
const pristine = JSON.stringify(artwork);
const filtered = visibleArtwork(artwork, ["sheet:outside", "panel:outside:front", "layer:outside:txt-1"]);
check("visibility hides sheet, panel image, and individual artwork layer in preview", !filtered.outside.sheetImage && !filtered.outside.panelImages.front && filtered.outside.layers.length === 0);
check("visibility does not mutate or discard project artwork", JSON.stringify(artwork) === pristine && artwork.outside.sheetImage === image && artwork.outside.layers[0]?.name === "Headline");
check("sheet and panel image labels are retained as artwork metadata", artwork.outside.sheetImageName === "Registered sheet" && artwork.outside.panelImageNames.front === "Front label");
check("side visibility is a presentation filter, leaving stored face artwork intact", visibleArtwork(artwork, [], false, true).outside.layers.length === 0 && artwork.outside.layers.length === 1);

const custom = normalizeSceneSettings({
  ...DEFAULT_SCENE_SETTINGS,
  background: "#112233",
  transparentBackground: true,
  environment: "soft",
  lights: { ...DEFAULT_SCENE_SETTINGS.lights, key: { enabled: false, intensity: 2.4, color: "#abcdef", position: [1, 2, 3] } },
  floor: { visible: false, color: "#778899", size: 4000 },
  shadows: false,
  material: "satin",
  showModel: false,
  showProductionDimensions: true,
  preset: "top",
  cameraPose: { position: [9, 8, 7], target: [1, 2, 3], up: [0, 1, 0] },
  hiddenLayerIds: ["sheet:outside", 2],
  lockedLayerIds: ["txt-1"],
});
const style = BOX_STYLES[0];
const serialized = serializeProject(style.id, style.defaultDimensions, artwork, custom);
const parsed = parseProject(serialized);
check("new project files serialize as version 4", JSON.parse(serialized).version === 4);
check("camera, background, floor, light rig, shadows and material survive .pbox round-trip", JSON.stringify(parsed.scene) === JSON.stringify(custom));
check("custom sheet and panel image names survive .pbox round-trip", parsed.artwork.outside.sheetImageName === "Registered sheet" && parsed.artwork.outside.panelImageNames.front === "Front label");
check("layer visibility and lock preferences survive .pbox round-trip", parsed.scene.hiddenLayerIds.includes("sheet:outside") && parsed.scene.lockedLayerIds.includes("txt-1"));
for (const version of [1, 2, 3]) {
  const old = parseProject(JSON.stringify({ app: "packbox", version, boxStyleId: "rsc", dims: { length: 300, width: 200, height: 200 }, scene: { background: "#dce4ec", ambient: 1.1, keyLight: 0.8, preset: "front", cameraPose: null } }));
  const expectedBackground = version === 1 ? DEFAULT_SCENE_SETTINGS.background : "#dce4ec";
  check(`version ${version} project migrates with defaulted workbench settings`, old.scene.background === expectedBackground && old.scene.lights.key.enabled && old.scene.floor.visible && old.scene.material === "board");
}
const malformed = normalizeSceneSettings({ lights: { key: { enabled: true, intensity: 99, color: "nonsense", position: [0, 0] } }, hiddenLayerIds: ["one"] });
check("invalid scene fields are safely clamped or defaulted", malformed.lights.key.intensity === 5 && malformed.lights.key.color === DEFAULT_SCENE_SETTINGS.lights.key.color && malformed.lights.key.position.length === 3);
check("defaults start with measurements hidden and packaging model visible", DEFAULT_SCENE_SETTINGS.showProductionDimensions === false && DEFAULT_SCENE_SETTINGS.showModel === true);
const productionLayout = computeFlatLayout(BOX_STYLES[0].build(BOX_STYLES[0].defaultDimensions));
const screenOnlySettings = normalizeSceneSettings({ ...DEFAULT_SCENE_SETTINGS, showCutLines: false, showFoldLines: false });
const productionSvg = generateDielineSVG(productionLayout, { title: "Workbench proof" });
check("screen-only production-layer visibility does not alter export geometry", screenOnlySettings.showCutLines === false && screenOnlySettings.showFoldLines === false && productionSvg.includes("cut-lines") && productionSvg.includes("fold-lines"));
console.log(failures ? `\n${failures} WORKBENCH CHECK(S) FAILED` : "\nALL WORKBENCH CHECKS PASSED");
process.exit(failures ? 1 : 0);
