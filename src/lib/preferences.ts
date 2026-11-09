import { useSyncExternalStore } from "react";
import { normalizeSceneSettings } from "../project/sceneSettings";
import type { SceneSettings } from "../project/sceneSettings";
import { PRODUCT_SHOTS } from "../project/scenePresets";
import type { SceneLook, ScenePreset, ShotFraming } from "../project/scenePresets";

export type Unit = "mm" | "cm" | "in";
export type Language = "en" | "ar";
export type PaperId = "a5" | "a4" | "a3" | "letter" | "legal" | "tabloid" | "custom";

export const UNIT_MM: Record<Unit, number> = { mm: 1, cm: 10, in: 25.4 };
export const UNIT_DECIMALS: Record<Unit, number> = { mm: 2, cm: 3, in: 3 };

/** Portrait sizes in mm. */
export const PAPER_SIZES: Record<Exclude<PaperId, "custom">, { label: string; width: number; height: number }> = {
  a5: { label: "A5", width: 148, height: 210 },
  a4: { label: "A4", width: 210, height: 297 },
  a3: { label: "A3", width: 297, height: 420 },
  letter: { label: "Letter", width: 215.9, height: 279.4 },
  legal: { label: "Legal", width: 215.9, height: 355.6 },
  tabloid: { label: "Tabloid", width: 279.4, height: 431.8 },
};

export interface ExportSettings {
  paper: PaperId;
  /** Only used when paper is "custom". Portrait mm. */
  customWidth: number;
  customHeight: number;
  /** Blank page margin in mm. */
  margin: number;
  /** Extra area drawn around the trim edge, mm. */
  bleed: number;
  /** Trim guide with corner crop marks. */
  cropMarks: boolean;
  /** Overlay panel and overall dimensions. */
  measurements: boolean;
  /** Also print the mirrored inside sheet. */
  includeInside: boolean;
}

export const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  paper: "a4", customWidth: 210, customHeight: 297, margin: 10, bleed: 6, cropMarks: true, measurements: false, includeInside: true,
};

/** Ready-made starting points; users can add their own next to these. */
export const BUILTIN_EXPORT_PRESETS: Record<string, ExportSettings> = {
  "Home printer · A4": { ...DEFAULT_EXPORT_SETTINGS },
  "Home printer · Letter": { ...DEFAULT_EXPORT_SETTINGS, paper: "letter" },
  "Print shop · A3, 3 mm bleed": { ...DEFAULT_EXPORT_SETTINGS, paper: "a3", margin: 12, bleed: 6 },
  "Review copy · with measurements": { ...DEFAULT_EXPORT_SETTINGS, measurements: true, includeInside: false },
};

export function resolvePaper(settings: ExportSettings): { width: number; height: number } {
  const size = settings.paper === "custom" ? { width: settings.customWidth, height: settings.customHeight } : PAPER_SIZES[settings.paper];
  return { width: Math.min(size.width, size.height), height: Math.max(size.width, size.height) };
}

export interface Preferences {
  unit: Unit;
  language: Language;
  exportSettings: ExportSettings;
  exportPresets: Record<string, ExportSettings>;
  /**
   * Named sets of product shots. Kept in preferences rather than in a project
   * because the point of a shot set is to outlive any one box: you build it once
   * and replay it on the next product so the range photographs as a family.
   */
  scenePresets: Record<string, ScenePreset>;
}

const KEY = "azm-box:preferences";

function num(value: unknown, fallback: number, min: number, max: number) {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

export function sanitizeExportSettings(raw: unknown): ExportSettings {
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Partial<ExportSettings>;
  const base = DEFAULT_EXPORT_SETTINGS;
  const paper = r.paper === "custom" || (typeof r.paper === "string" && r.paper in PAPER_SIZES) ? r.paper : base.paper;
  return {
    paper,
    customWidth: num(r.customWidth, base.customWidth, 50, 2000),
    customHeight: num(r.customHeight, base.customHeight, 50, 2000),
    margin: num(r.margin, base.margin, 0, 50),
    bleed: num(r.bleed, base.bleed, 0, 30),
    cropMarks: typeof r.cropMarks === "boolean" ? r.cropMarks : base.cropMarks,
    measurements: typeof r.measurements === "boolean" ? r.measurements : base.measurements,
    includeInside: typeof r.includeInside === "boolean" ? r.includeInside : base.includeInside,
  };
}

export function sanitizeScenePreset(raw: unknown, fallbackName: string): ScenePreset {
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Partial<ScenePreset>;
  const shots: ShotFraming[] = [];
  if (Array.isArray(r.shots)) {
    for (const value of r.shots.slice(0, 24)) {
      const sh = (typeof value === "object" && value !== null ? value : {}) as Partial<ShotFraming>;
      if (typeof sh.id !== "string" || !sh.id) continue;
      shots.push({
        id: sh.id.slice(0, 40),
        label: typeof sh.label === "string" && sh.label ? sh.label.slice(0, 40) : sh.id.slice(0, 40),
        azimuth: num(sh.azimuth, 0, -360, 360),
        elevation: num(sh.elevation, 0, -89, 89),
        fov: num(sh.fov, 32, 10, 100),
        fill: num(sh.fill, 0.8, 0.05, 1),
      });
    }
  }
  return {
    name: typeof r.name === "string" && r.name ? r.name.slice(0, 60) : fallbackName,
    // The look is a scene, so it is validated by the scene's own normaliser
    // rather than a second, drifting copy of those rules.
    look: pickLook(normalizeSceneSettings(r.look)),
    shots: shots.length ? shots : PRODUCT_SHOTS.map((shot) => ({ ...shot })),
  };
}

function pickLook(scene: SceneSettings): SceneLook {
  const { background, transparentBackground, environment, ambient, exposure, envLight, lights, floor, shadows, material, materialParams } = scene;
  return { background, transparentBackground, environment, ambient, exposure, envLight, lights, floor, shadows, material, materialParams };
}

/** The look and shots currently in use, ready to be saved under a name. */
export function scenePresetFrom(name: string, scene: SceneSettings, shots: ShotFraming[] = PRODUCT_SHOTS): ScenePreset {
  return { name, look: pickLook(scene), shots: shots.map((shot) => ({ ...shot })) };
}

function load(): Preferences {
  const defaults: Preferences = {
    unit: "mm",
    language: typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("ar") ? "ar" : "en",
    exportSettings: { ...DEFAULT_EXPORT_SETTINGS },
    exportPresets: {},
    scenePresets: {},
  };
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) ?? "null");
    if (!raw || typeof raw !== "object") return defaults;
    const presets: Record<string, ExportSettings> = {};
    if (raw.exportPresets && typeof raw.exportPresets === "object") {
      for (const [name, value] of Object.entries(raw.exportPresets).slice(0, 30)) presets[name.slice(0, 60)] = sanitizeExportSettings(value);
    }
    const scenes: Record<string, ScenePreset> = {};
    if (raw.scenePresets && typeof raw.scenePresets === "object") {
      for (const [name, value] of Object.entries(raw.scenePresets).slice(0, 30)) {
        const key = name.slice(0, 60);
        scenes[key] = sanitizeScenePreset(value, key);
      }
    }
    return {
      unit: raw.unit === "cm" || raw.unit === "in" ? raw.unit : "mm",
      language: raw.language === "ar" || raw.language === "en" ? raw.language : defaults.language,
      exportSettings: sanitizeExportSettings(raw.exportSettings),
      exportPresets: presets,
      scenePresets: scenes,
    };
  } catch {
    return defaults;
  }
}

let state: Preferences = load();
const listeners = new Set<() => void>();

export function getPreferences(): Preferences {
  return state;
}

export function setPreferences(patch: Partial<Preferences>) {
  state = { ...state, ...patch };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* Preferences are a convenience; keep working in memory if storage is unavailable. */
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePreferences(): Preferences {
  return useSyncExternalStore(subscribe, getPreferences, getPreferences);
}

/** mm -> a length in the chosen unit, trimmed of trailing zeros. */
export function mmToUnit(mm: number, unit: Unit): number {
  return Number((mm / UNIT_MM[unit]).toFixed(UNIT_DECIMALS[unit]));
}

export function unitToMm(value: number, unit: Unit): number {
  return Number((value * UNIT_MM[unit]).toFixed(3));
}
