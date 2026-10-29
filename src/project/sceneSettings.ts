export type CameraPreset = "front" | "back" | "left" | "right" | "top" | "iso";

export interface CameraPose {
  position: [number, number, number];
  target: [number, number, number];
  up: [number, number, number];
}

export interface StudioLight {
  enabled: boolean;
  intensity: number;
  color: string;
  position: [number, number, number];
}

export type MaterialPreset = "board" | "matte" | "satin" | "metallic";

/** Persisted presentation state only; it never changes the dieline or production exports. */
export interface SceneSettings {
  background: string;
  transparentBackground: boolean;
  environment: "studio" | "soft" | "neutral";
  ambient: number;
  keyLight: number; // Legacy v1-v3 key-light multiplier, retained for compatible migration.
  lights: { key: StudioLight; fill: StudioLight; rim: StudioLight };
  floor: { visible: boolean; color: string; size: number };
  shadows: boolean;
  material: MaterialPreset;
  showModel: boolean;
  showOutsideArtwork: boolean;
  showInsideArtwork: boolean;
  showCutLines: boolean;
  showFoldLines: boolean;
  showProductionDimensions: boolean;
  hiddenLayerIds: string[];
  lockedLayerIds: string[];
  preset: CameraPreset;
  cameraPose: CameraPose | null;
}

export const DEFAULT_SCENE_SETTINGS: SceneSettings = {
  background: "#e9e6df",
  transparentBackground: false,
  environment: "studio",
  ambient: 0.75,
  keyLight: 0.9,
  lights: {
    key: { enabled: true, intensity: 1, color: "#fff2d8", position: [300, 400, 200] },
    fill: { enabled: true, intensity: 0.45, color: "#d9e7ff", position: [-200, 150, -300] },
    rim: { enabled: true, intensity: 0.25, color: "#ffffff", position: [0, -250, 100] },
  },
  floor: { visible: true, color: "#d9d6cf", size: 2400 },
  shadows: true,
  material: "board",
  showModel: true,
  showOutsideArtwork: true,
  showInsideArtwork: true,
  showCutLines: true,
  showFoldLines: true,
  showProductionDimensions: false,
  hiddenLayerIds: [],
  lockedLayerIds: [],
  preset: "iso",
  cameraPose: null,
};

export function normalizeSceneSettings(value: unknown): SceneSettings {
  if (!value || typeof value !== "object") return structuredClone(DEFAULT_SCENE_SETTINGS);
  const input = value as Partial<SceneSettings>;
  const validPresets: CameraPreset[] = ["front", "back", "left", "right", "top", "iso"];
  const isVector = (vector: unknown): vector is [number, number, number] => Array.isArray(vector) && vector.length === 3 && vector.every((part) => typeof part === "number" && Number.isFinite(part));
  const finite = (v: unknown, fallback: number, min: number, max: number) => typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
  const validColor = (v: unknown, fallback: string) => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v : fallback;
  const pose = input.cameraPose;
  const cameraPose = pose && isVector(pose.position) && isVector(pose.target) && isVector(pose.up)
    ? { position: [...pose.position] as [number, number, number], target: [...pose.target] as [number, number, number], up: [...pose.up] as [number, number, number] }
    : null;
  const lights = (input as { lights?: Partial<SceneSettings["lights"]> }).lights;
  const normalizeLight = (name: keyof SceneSettings["lights"]): StudioLight => {
    const fallback = DEFAULT_SCENE_SETTINGS.lights[name];
    const light = lights?.[name] as Partial<StudioLight> | undefined;
    return {
      enabled: typeof light?.enabled === "boolean" ? light.enabled : fallback.enabled,
      intensity: finite(light?.intensity, fallback.intensity, 0, 5),
      color: validColor(light?.color, fallback.color),
      position: isVector(light?.position) ? [...light.position] as [number, number, number] : [...fallback.position],
    };
  };
  const validMaterials: MaterialPreset[] = ["board", "matte", "satin", "metallic"];
  const floor = (input as { floor?: Partial<SceneSettings["floor"]> }).floor;
  return {
    background: validColor(input.background, DEFAULT_SCENE_SETTINGS.background),
    transparentBackground: typeof input.transparentBackground === "boolean" ? input.transparentBackground : false,
    environment: ["studio", "soft", "neutral"].includes(String(input.environment)) ? input.environment as SceneSettings["environment"] : "studio",
    ambient: finite(input.ambient, DEFAULT_SCENE_SETTINGS.ambient, 0, 3),
    keyLight: finite(input.keyLight, DEFAULT_SCENE_SETTINGS.keyLight, 0, 5),
    lights: { key: normalizeLight("key"), fill: normalizeLight("fill"), rim: normalizeLight("rim") },
    floor: {
      visible: typeof floor?.visible === "boolean" ? floor.visible : true,
      color: validColor(floor?.color, DEFAULT_SCENE_SETTINGS.floor.color),
      size: finite(floor?.size, DEFAULT_SCENE_SETTINGS.floor.size, 100, 10000),
    },
    shadows: typeof input.shadows === "boolean" ? input.shadows : true,
    material: validMaterials.includes(input.material as MaterialPreset) ? input.material as MaterialPreset : "board",
    showModel: typeof input.showModel === "boolean" ? input.showModel : true,
    showOutsideArtwork: typeof input.showOutsideArtwork === "boolean" ? input.showOutsideArtwork : true,
    showInsideArtwork: typeof input.showInsideArtwork === "boolean" ? input.showInsideArtwork : true,
    showCutLines: typeof input.showCutLines === "boolean" ? input.showCutLines : true,
    showFoldLines: typeof input.showFoldLines === "boolean" ? input.showFoldLines : true,
    showProductionDimensions: typeof input.showProductionDimensions === "boolean" ? input.showProductionDimensions : false,
    hiddenLayerIds: Array.isArray(input.hiddenLayerIds) ? input.hiddenLayerIds.filter((id): id is string => typeof id === "string").slice(0, 5000) : [],
    lockedLayerIds: Array.isArray(input.lockedLayerIds) ? input.lockedLayerIds.filter((id): id is string => typeof id === "string").slice(0, 5000) : [],
    preset: validPresets.includes(input.preset as CameraPreset) ? input.preset as CameraPreset : DEFAULT_SCENE_SETTINGS.preset,
    cameraPose,
  };
}
