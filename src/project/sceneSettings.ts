export type CameraPreset = "front" | "back" | "left" | "right" | "top" | "iso";

export interface CameraPose {
  position: [number, number, number];
  target: [number, number, number];
  up: [number, number, number];
}

export interface SceneSettings {
  background: string;
  ambient: number;
  keyLight: number;
  preset: CameraPreset;
  cameraPose: CameraPose | null;
}

export const DEFAULT_SCENE_SETTINGS: SceneSettings = {
  background: "#e9e6df",
  ambient: 0.75,
  keyLight: 0.9,
  preset: "iso",
  cameraPose: null,
};

export function normalizeSceneSettings(value: unknown): SceneSettings {
  if (!value || typeof value !== "object") return { ...DEFAULT_SCENE_SETTINGS };
  const input = value as Partial<SceneSettings>;
  const validPresets: CameraPreset[] = ["front", "back", "left", "right", "top", "iso"];
  const isVector = (vector: unknown): vector is [number, number, number] => Array.isArray(vector) && vector.length === 3 && vector.every((part) => typeof part === "number" && Number.isFinite(part));
  const pose = input.cameraPose;
  const cameraPose = pose && isVector(pose.position) && isVector(pose.target) && isVector(pose.up)
    ? { position: [...pose.position] as [number, number, number], target: [...pose.target] as [number, number, number], up: [...pose.up] as [number, number, number] }
    : null;
  return {
    background: typeof input.background === "string" && /^#[0-9a-f]{6}$/i.test(input.background) ? input.background : DEFAULT_SCENE_SETTINGS.background,
    ambient: typeof input.ambient === "number" && Number.isFinite(input.ambient) ? Math.min(2, Math.max(0.1, input.ambient)) : DEFAULT_SCENE_SETTINGS.ambient,
    keyLight: typeof input.keyLight === "number" && Number.isFinite(input.keyLight) ? Math.min(2, Math.max(0.1, input.keyLight)) : DEFAULT_SCENE_SETTINGS.keyLight,
    preset: validPresets.includes(input.preset as CameraPreset) ? input.preset as CameraPreset : DEFAULT_SCENE_SETTINGS.preset,
    cameraPose,
  };
}
