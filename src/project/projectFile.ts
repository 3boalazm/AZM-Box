import type { BoxDimensions, BoxStyleId } from "../geometry/types";
import type { ArtworkState, SideArtwork, EditorLayer } from "../artwork/types";
import { emptySide } from "../artwork/types";
import { BOX_STYLES } from "../geometry/boxBuilders";
import { DEFAULT_SCENE_SETTINGS, normalizeSceneSettings } from "./sceneSettings";
import type { SceneSettings } from "./sceneSettings";

/**
 * PackBox project file (.pbox).
 *
 * Format: plain JSON. Chosen deliberately over a zip/binary container because
 * every piece of artwork in the app (full-sheet image, per-panel images, logo
 * layers) is ALREADY held as a base64 data URL in state — so JSON.stringify of
 * the state embeds every image, text and logo byte-for-byte with zero extra
 * encoding steps, stays human-inspectable, and diffing/versioning it works.
 * The `version` field lets future releases migrate old files instead of
 * rejecting them.
 */
export interface ProjectFile {
  app: "packbox";
  version: 4;
  savedAt: string; // ISO timestamp, informational only
  boxStyleId: BoxStyleId;
  dims: BoxDimensions;
  artwork: ArtworkState;
  scene: SceneSettings;
  templateMemory: Partial<Record<BoxStyleId, BoxDimensions>>;
}

export const PROJECT_EXTENSION = ".pbox";

export function serializeProject(
  boxStyleId: BoxStyleId,
  dims: BoxDimensions,
  artwork: ArtworkState,
  scene: SceneSettings = DEFAULT_SCENE_SETTINGS,
  templateMemory: Partial<Record<BoxStyleId, BoxDimensions>> = {},
): string {
  const file: ProjectFile = {
    app: "packbox",
    version: 4,
    savedAt: new Date().toISOString(),
    boxStyleId,
    dims,
    artwork,
    scene: normalizeSceneSettings(scene),
    templateMemory,
  };
  return JSON.stringify(file);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

const MAX_PROJECT_DIMENSION_MM = 5000;
function validateDimension(value: unknown, label: string, min = 0) {
  if (value === undefined) return;
  if (!isFiniteNumber(value) || value < min || value > MAX_PROJECT_DIMENSION_MM) {
    throw new Error(`${label} must be between ${min} and ${MAX_PROJECT_DIMENSION_MM} mm.`);
  }
}
function validateDimensionMap(value: unknown, label: string, min = 0) {
  if (value === undefined) return;
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label} must be an object of millimeter values.`);
  for (const [key, entry] of Object.entries(value)) validateDimension(entry, `${label}.${key}`, min);
}

/**
 * Re-validates a side's artwork against the CURRENT shape of SideArtwork,
 * merging over emptySide() defaults. This is what makes older project files
 * forward-compatible: a file saved before e.g. `sheetRotation` existed simply
 * inherits the default instead of leaving undefined holes in the state.
 */
function normalizeSide(raw: unknown, fallbackColor: string): SideArtwork {
  const base = emptySide(fallbackColor);
  if (typeof raw !== "object" || raw === null) return base;
  const r = raw as Record<string, unknown>;

  const layers: EditorLayer[] = Array.isArray(r.layers)
    ? (r.layers as EditorLayer[]).filter(
        (l) =>
          l &&
          typeof l.id === "string" &&
          typeof l.panelId === "string" &&
          (l.kind === "text" ? typeof l.text === "string" : l.kind === "image" && typeof l.src === "string"),
      ).map((layer) => ({ ...layer, name: typeof layer.name === "string" ? layer.name.slice(0, 120) : undefined }))
    : [];

  return {
    ...base,
    sheetImage: typeof r.sheetImage === "string" ? r.sheetImage : undefined,
    sheetOffset:
      typeof r.sheetOffset === "object" &&
      r.sheetOffset !== null &&
      isFiniteNumber((r.sheetOffset as Record<string, unknown>).x) &&
      isFiniteNumber((r.sheetOffset as Record<string, unknown>).y)
        ? (r.sheetOffset as { x: number; y: number })
        : base.sheetOffset,
    sheetWidth: isFiniteNumber(r.sheetWidth) ? r.sheetWidth : base.sheetWidth,
    sheetHeight: isFiniteNumber(r.sheetHeight) ? r.sheetHeight : base.sheetHeight,
    sheetRotation: isFiniteNumber(r.sheetRotation) ? r.sheetRotation : base.sheetRotation,
    panelImages:
      typeof r.panelImages === "object" && r.panelImages !== null
        ? Object.fromEntries(Object.entries(r.panelImages as Record<string, unknown>).filter(([, v]) => typeof v === "string")) as Record<string, string>
        : {},
    layers,
    backgroundColor: typeof r.backgroundColor === "string" ? r.backgroundColor : base.backgroundColor,
  };
}

function normalizeTemplateMemory(raw: unknown): Partial<Record<BoxStyleId, BoxDimensions>> {
  const memory: Partial<Record<BoxStyleId, BoxDimensions>> = {};
  if (raw === undefined || raw === null) return memory;
  if (typeof raw !== "object" || Array.isArray(raw)) throw new Error("Saved template settings must be an object.");
  for (const [id, value] of Object.entries(raw)) {
    const style = BOX_STYLES.find((item) => item.id === id);
    if (!style) continue;
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`Saved settings for ${id} are invalid.`);
    const dimensions = value as Partial<BoxDimensions>;
    for (const key of ["length", "width", "height"] as const) validateDimension(dimensions[key], `Saved ${id} ${key}`, 1);
    if (!isFiniteNumber(dimensions.length) || !isFiniteNumber(dimensions.width) || !isFiniteNumber(dimensions.height)) {
      throw new Error(`Saved settings for ${id} are missing box dimensions.`);
    }
    validateDimension(dimensions.endFlapLeft, `Saved ${id} left end tab`);
    validateDimension(dimensions.endFlapRight, `Saved ${id} right end tab`);
    validateDimension(dimensions.lidDepth, `Saved ${id} lid depth`, 1);
    validateDimensionMap(dimensions.flaps, `Saved ${id} flap depths`);
    validateDimensionMap(dimensions.flapWidths, `Saved ${id} flap widths`, 1);
    if (dimensions.flapEdges !== undefined) {
      if (typeof dimensions.flapEdges !== "object" || dimensions.flapEdges === null || Array.isArray(dimensions.flapEdges)) throw new Error(`Saved ${id} flap edges are invalid.`);
      for (const edge of ["top", "bottom"] as const) validateDimensionMap(dimensions.flapEdges[edge], `Saved ${id} ${edge} flap depths`);
    }
    if (dimensions.flapShapes !== undefined) {
      const validShapes = new Set(["default", "straight", "dust", "tuck", "lock"]);
      if (typeof dimensions.flapShapes !== "object" || dimensions.flapShapes === null || Array.isArray(dimensions.flapShapes) || Object.values(dimensions.flapShapes).some((shape) => !validShapes.has(String(shape)))) {
        throw new Error(`Saved ${id} flap shapes are invalid.`);
      }
    }
    memory[style.id] = { ...style.defaultDimensions, ...dimensions, length: dimensions.length, width: dimensions.width, height: dimensions.height };
  }
  return memory;
}

/**
 * Parses and validates a .pbox file's text. Throws with a human-readable
 * message on anything unusable; tolerates and repairs missing optional fields.
 */
export function parseProject(text: string): { boxStyleId: BoxStyleId; dims: BoxDimensions; artwork: ArtworkState; scene: SceneSettings; templateMemory: Partial<Record<BoxStyleId, BoxDimensions>> } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("This is not a PackBox project file (invalid JSON).");
  }
  if (typeof raw !== "object" || raw === null || (raw as Record<string, unknown>).app !== "packbox") {
    throw new Error("This is not a PackBox project file.");
  }
  const file = raw as Record<string, unknown> & { version?: number; boxStyleId?: BoxStyleId; dims?: BoxDimensions; artwork?: ArtworkState; scene?: SceneSettings; templateMemory?: unknown };
  if (file.version !== 1 && file.version !== 2 && file.version !== 3 && file.version !== 4) {
    throw new Error(`Unsupported project version (${String(file.version)}). This app reads versions 1, 2, 3, and 4.`);
  }

  const style = BOX_STYLES.find((s) => s.id === file.boxStyleId);
  if (!style) {
    throw new Error(`The project uses a box style ("${String(file.boxStyleId)}") that this version of the app doesn't have.`);
  }

  const d = (typeof file.dims === "object" && file.dims !== null ? file.dims : {}) as Partial<BoxDimensions>;
  if (!isFiniteNumber(d.length) || !isFiniteNumber(d.width) || !isFiniteNumber(d.height)) {
    throw new Error("The project's box dimensions are missing or invalid.");
  }
  for (const [key, value] of [["length", d.length], ["width", d.width], ["height", d.height]] as const) {
    validateDimension(value, `Box ${key}`, 1);
  }
  validateDimension(d.endFlapLeft, "Left end flap depth");
  validateDimension(d.endFlapRight, "Right end flap depth");
  validateDimension(d.lidDepth, "Lid depth", 1);
  validateDimensionMap(d.flaps, "Flap depths");
  validateDimensionMap(d.flapWidths, "Flap widths", 1);
  if (d.flapEdges !== undefined) {
    if (typeof d.flapEdges !== "object" || d.flapEdges === null || Array.isArray(d.flapEdges)) throw new Error("Flap edge depths must be an object.");
    const edges = d.flapEdges as Record<string, unknown>;
    for (const edge of ["top", "bottom"]) validateDimensionMap(edges[edge], `${edge} flap depths`);
  }
  if (d.flapShapes !== undefined) {
    if (typeof d.flapShapes !== "object" || d.flapShapes === null || Array.isArray(d.flapShapes)) throw new Error("Flap shapes must be an object.");
    const validShapes = new Set(["default", "straight", "dust", "tuck", "lock"]);
    if (Object.values(d.flapShapes).some((shape) => !validShapes.has(String(shape)))) throw new Error("The project contains an unknown flap shape.");
  }
  const dims: BoxDimensions = {
    ...style.defaultDimensions,
    ...d,
    length: d.length,
    width: d.width,
    height: d.height,
  };

  const a = (typeof file.artwork === "object" && file.artwork !== null ? file.artwork : {}) as Record<string, unknown>;
  const artwork: ArtworkState = {
    outside: normalizeSide(a.outside, "#ffffff"),
    inside: normalizeSide(a.inside, "#f2ede3"),
  };

  return {
    boxStyleId: style.id,
    dims,
    artwork,
    scene: normalizeSceneSettings(file.version >= 2 ? file.scene : DEFAULT_SCENE_SETTINGS),
    templateMemory: normalizeTemplateMemory(file.version >= 3 ? file.templateMemory : undefined),
  };
}
