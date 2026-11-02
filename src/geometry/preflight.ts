import type { BoxDimensions, DielineLayout } from "./types";
import type { ArtworkState, SideArtwork } from "../artwork/types";
import { loadImageSize } from "../lib/files";
import { isSvgSource } from "../artwork/svgArt";
import type { ExportSettings } from "../lib/preferences";
import { resolvePaper } from "../lib/preferences";
import { planPages } from "./paginate";

export type Severity = "error" | "warning" | "info";

export interface PreflightIssue {
  severity: Severity;
  /** English message with {placeholders}; translated by the UI. */
  message: string;
  params?: Record<string, string | number>;
}

const MIN_GLUE_TAB_MM = 10;
const WARN_DPI = 150;
const ERROR_DPI = 72;
const SAFE_TEXT_MARGIN_MM = 3;
const MM_PER_INCH = 25.4;

const sizeCache = new Map<string, Promise<{ width: number; height: number } | null>>();
function imageSize(src: string) {
  // Vector artwork has no pixel resolution, so there is nothing to measure.
  if (isSvgSource(src)) return Promise.resolve(null);
  let found = sizeCache.get(src);
  if (!found) {
    found = loadImageSize(src).catch(() => null);
    sizeCache.set(src, found);
    if (sizeCache.size > 60) sizeCache.delete(sizeCache.keys().next().value as string);
  }
  return found;
}

async function checkSide(side: SideArtwork, label: "outside" | "inside", layout: DielineLayout, issues: PreflightIssue[]) {
  const report = (what: string, dpi: number) => {
    if (dpi < ERROR_DPI) issues.push({ severity: "error", message: "{what} on the {side} is only {dpi} DPI at print size — it will look badly pixelated.", params: { what, side: label, dpi: Math.round(dpi) } });
    else if (dpi < WARN_DPI) issues.push({ severity: "warning", message: "{what} on the {side} is {dpi} DPI at print size (aim for {target}+).", params: { what, side: label, dpi: Math.round(dpi), target: 300 } });
  };

  if (side.sheetImage) {
    const size = await imageSize(side.sheetImage);
    if (size && side.sheetWidth > 0 && side.sheetHeight > 0) {
      report("The full-sheet image", Math.min(size.width / (side.sheetWidth / MM_PER_INCH), size.height / (side.sheetHeight / MM_PER_INCH)));
    }
  }
  for (const [panelId, src] of Object.entries(side.panelImages)) {
    const panel = layout.panels.find((p) => p.id === panelId);
    const size = await imageSize(src);
    if (panel && size) report(`The image on "${panel.name}"`, Math.min(size.width / (panel.w / MM_PER_INCH), size.height / (panel.h / MM_PER_INCH)));
  }
  for (const layer of side.layers) {
    const panel = layout.panels.find((p) => p.id === layer.panelId);
    if (!panel) continue;
    if (layer.kind === "image") {
      const size = await imageSize(layer.src);
      if (size && layer.width > 0 && layer.height > 0) report(`The logo/image on "${panel.name}"`, Math.min(size.width / (layer.width / MM_PER_INCH), size.height / (layer.height / MM_PER_INCH)));
    } else if (layer.text.trim()) {
      // Rough text box: about 0.55 em per character. Good enough to catch text that
      // sits against a cut or crease, where it would be trimmed or hidden by the fold.
      const textW = layer.text.length * layer.fontSize * 0.55;
      const gaps = [layer.x, panel.w - (layer.x + textW), layer.y, panel.h - (layer.y + layer.fontSize)];
      const tightest = Math.min(...gaps);
      if (tightest < SAFE_TEXT_MARGIN_MM) {
        issues.push({ severity: "warning", message: "Text on \"{panel}\" ({side}) is within {gap} mm of a cut or fold line.", params: { panel: panel.name, side: label, gap: Math.max(0, Number(tightest.toFixed(1))) } });
      }
    }
  }
}

/**
 * Checks the design for problems that only show up after printing. Everything
 * here is advisory: the export dialog lists the findings but never blocks.
 */
export async function runPreflight(layout: DielineLayout, dims: BoxDimensions, artwork: ArtworkState, settings: ExportSettings, styleDefaults: BoxDimensions): Promise<PreflightIssue[]> {
  const issues: PreflightIssue[] = [];

  const glue = dims.endFlapRight ?? 0;
  if (glue > 0 && glue < MIN_GLUE_TAB_MM) {
    issues.push({ severity: "warning", message: "The glue tab is {size} mm — under {min} mm it is hard to bond reliably.", params: { size: glue, min: MIN_GLUE_TAB_MM } });
  } else if (glue === 0 && (styleDefaults.endFlapRight ?? 0) > 0) {
    issues.push({ severity: "warning", message: "There is no glue tab, so the tube cannot be closed without tape." });
  }

  for (const panel of layout.panels) {
    if (panel.face.startsWith("flap-") && panel.h > dims.height) {
      issues.push({ severity: "warning", message: "\"{panel}\" is {depth} mm deep, deeper than the {height} mm box wall.", params: { panel: panel.name, depth: Number(panel.h.toFixed(1)), height: dims.height } });
    }
  }

  if (Math.min(dims.length, dims.width, dims.height) < 10) {
    issues.push({ severity: "warning", message: "One box dimension is under 10 mm; flaps and tabs may be too small to fold." });
  }
  if (!(dims.materialThickness && dims.materialThickness > 0)) {
    issues.push({ severity: "info", message: "No material thickness is set, so folds are not compensated for board thickness." });
  }

  const paper = resolvePaper(settings);
  const plan = planPages(layout.bounds, Math.max(settings.margin, settings.cropMarks ? 6 : 0), paper);
  if (!plan.singlePage) {
    issues.push({ severity: "info", message: "The dieline is {width} × {height} mm and will be tiled across {pages} pages on this paper; tape them at the + marks.", params: { width: Math.round(layout.bounds.width), height: Math.round(layout.bounds.height), pages: plan.pages.length } });
  }

  await checkSide(artwork.outside, "outside", layout, issues);
  await checkSide(artwork.inside, "inside", layout, issues);

  const order: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
  return issues.sort((a, b) => order[a.severity] - order[b.severity]);
}
