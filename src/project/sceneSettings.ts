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

export type MaterialPreset = "board" | "matte" | "satin" | "metallic" | "gloss" | "kraft" | "softtouch" | "custom";
export type SurfaceTexture = "none" | "grain" | "linen" | "fibre";
export type Vec3 = [number, number, number];

/** Physically-based surface settings for the board. Illustrative only, never a print proof. */
export interface MaterialParams {
  roughness: number;
  metalness: number;
  /** Clear lacquer / varnish layer (0 = none, 1 = full gloss coat). */
  clearcoat: number;
  clearcoatRoughness: number;
  /** Colour multiplied over printed artwork (kraft board tints everything printed on it). */
  tint: string;
  /** Faces shown without artwork. */
  boardColor: string;
  insideColor: string;
  texture: SurfaceTexture;
  textureStrength: number;
  /** Size of one texture tile in mm. */
  textureScale: number;
}

const BASE_MATERIAL: MaterialParams = {
  roughness: 0.85, metalness: 0, clearcoat: 0, clearcoatRoughness: 0.5,
  tint: "#ffffff", boardColor: "#d8cdb8", insideColor: "#efe6d3",
  texture: "none", textureStrength: 0.5, textureScale: 40,
};

export const MATERIAL_PRESETS: Record<Exclude<MaterialPreset, "custom">, MaterialParams> = {
  board: { ...BASE_MATERIAL },
  matte: { ...BASE_MATERIAL, roughness: 0.98 },
  satin: { ...BASE_MATERIAL, roughness: 0.5, metalness: 0.08 },
  metallic: { ...BASE_MATERIAL, roughness: 0.32, metalness: 0.55 },
  gloss: { ...BASE_MATERIAL, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.06, boardColor: "#f2eee6", insideColor: "#f6f1e6" },
  kraft: { ...BASE_MATERIAL, roughness: 0.92, tint: "#c9a577", boardColor: "#b8935f", insideColor: "#a98550", texture: "fibre", textureStrength: 0.9, textureScale: 30 },
  softtouch: { ...BASE_MATERIAL, roughness: 0.96, texture: "grain", textureStrength: 0.35, textureScale: 12 },
};

/** Selecting a preset copies its parameters in, so every value stays editable afterwards. */
export function applyMaterialPreset(preset: MaterialPreset): Pick<SceneSettings, "material" | "materialParams"> {
  const source = preset === "custom" ? MATERIAL_PRESETS.board : MATERIAL_PRESETS[preset];
  return { material: preset, materialParams: { ...source } };
}

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
  materialParams: MaterialParams;
  /** Tone-mapping exposure of the whole render. */
  exposure: number;
  /** Image-based studio reflections (0 = off). */
  envLight: number;
  /** Vertical field of view in degrees. */
  fov: number;
  /** Model rotation (degrees) and offset (mm) about the scene axes. */
  modelRotation: Vec3;
  modelOffset: Vec3;
  turntable: boolean;
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
  materialParams: { ...MATERIAL_PRESETS.board },
  exposure: 1,
  envLight: 0.35,
  fov: 40,
  modelRotation: [0, 0, 0],
  modelOffset: [0, 0, 0],
  turntable: false,
  showOutsideArtwork: true,
  showInsideArtwork: true,
  showCutLines: true,
  showFoldLines: true,
  showProductionDimensions: true,
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
  const validMaterials: MaterialPreset[] = ["board", "matte", "satin", "metallic", "gloss", "kraft", "softtouch", "custom"];
  const material: MaterialPreset = validMaterials.includes(input.material as MaterialPreset) ? input.material as MaterialPreset : "board";
  const materialBase = MATERIAL_PRESETS[material === "custom" ? "board" : material];
  const rawParams = (input as { materialParams?: Partial<MaterialParams> }).materialParams;
  const validTextures: SurfaceTexture[] = ["none", "grain", "linen", "fibre"];
  const materialParams: MaterialParams = {
    roughness: finite(rawParams?.roughness, materialBase.roughness, 0, 1),
    metalness: finite(rawParams?.metalness, materialBase.metalness, 0, 1),
    clearcoat: finite(rawParams?.clearcoat, materialBase.clearcoat, 0, 1),
    clearcoatRoughness: finite(rawParams?.clearcoatRoughness, materialBase.clearcoatRoughness, 0, 1),
    tint: validColor(rawParams?.tint, materialBase.tint),
    boardColor: validColor(rawParams?.boardColor, materialBase.boardColor),
    insideColor: validColor(rawParams?.insideColor, materialBase.insideColor),
    texture: validTextures.includes(rawParams?.texture as SurfaceTexture) ? rawParams!.texture as SurfaceTexture : materialBase.texture,
    textureStrength: finite(rawParams?.textureStrength, materialBase.textureStrength, 0, 3),
    textureScale: finite(rawParams?.textureScale, materialBase.textureScale, 2, 500),
  };
  const vector = (v: unknown, fallback: Vec3, limit: number): Vec3 => isVector(v) ? v.map((n) => Math.min(limit, Math.max(-limit, n))) as Vec3 : [...fallback];
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
    material,
    materialParams,
    exposure: finite(input.exposure, 1, 0.1, 4),
    // Projects saved before image-based lighting existed keep their original look.
    envLight: finite(input.envLight, 0, 0, 3),
    fov: finite(input.fov, DEFAULT_SCENE_SETTINGS.fov, 10, 100),
    modelRotation: vector(input.modelRotation, [0, 0, 0], 360),
    modelOffset: vector(input.modelOffset, [0, 0, 0], 5000),
    turntable: typeof input.turntable === "boolean" ? input.turntable : false,
    showOutsideArtwork: typeof input.showOutsideArtwork === "boolean" ? input.showOutsideArtwork : true,
    showInsideArtwork: typeof input.showInsideArtwork === "boolean" ? input.showInsideArtwork : true,
    showCutLines: typeof input.showCutLines === "boolean" ? input.showCutLines : true,
    showFoldLines: typeof input.showFoldLines === "boolean" ? input.showFoldLines : true,
    showProductionDimensions: typeof input.showProductionDimensions === "boolean" ? input.showProductionDimensions : true,
    hiddenLayerIds: Array.isArray(input.hiddenLayerIds) ? input.hiddenLayerIds.filter((id): id is string => typeof id === "string").slice(0, 5000) : [],
    lockedLayerIds: Array.isArray(input.lockedLayerIds) ? input.lockedLayerIds.filter((id): id is string => typeof id === "string").slice(0, 5000) : [],
    preset: validPresets.includes(input.preset as CameraPreset) ? input.preset as CameraPreset : DEFAULT_SCENE_SETTINGS.preset,
    cameraPose,
  };
}
