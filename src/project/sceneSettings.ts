export type CameraPreset = "front" | "back" | "left" | "right" | "top" | "iso";

export interface SceneSettings {
  background: string;
  ambient: number;
  keyLight: number;
  preset: CameraPreset;
}

export const DEFAULT_SCENE_SETTINGS: SceneSettings = {
  background: "#e9e6df",
  ambient: 0.75,
  keyLight: 0.9,
  preset: "iso",
};

export function normalizeSceneSettings(value: unknown): SceneSettings {
  if (!value || typeof value !== "object") return { ...DEFAULT_SCENE_SETTINGS };
  const input = value as Partial<SceneSettings>;
  const validPresets: CameraPreset[] = ["front", "back", "left", "right", "top", "iso"];
  return {
    background: typeof input.background === "string" && /^#[0-9a-f]{6}$/i.test(input.background) ? input.background : DEFAULT_SCENE_SETTINGS.background,
    ambient: typeof input.ambient === "number" && Number.isFinite(input.ambient) ? Math.min(2, Math.max(0.1, input.ambient)) : DEFAULT_SCENE_SETTINGS.ambient,
    keyLight: typeof input.keyLight === "number" && Number.isFinite(input.keyLight) ? Math.min(2, Math.max(0.1, input.keyLight)) : DEFAULT_SCENE_SETTINGS.keyLight,
    preset: validPresets.includes(input.preset as CameraPreset) ? input.preset as CameraPreset : DEFAULT_SCENE_SETTINGS.preset,
  };
}
