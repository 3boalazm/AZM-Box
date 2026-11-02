import { useEffect, useRef, useState } from "react";
import type { BoxDimensions, DielineLayout } from "../geometry/types";
import type { ArtworkState, SideArtwork } from "../artwork/types";
import { sideHasContent } from "../artwork/types";
import { renderFullSheetCanvas } from "../artwork/renderPanel";
import { buildArtworkMarkup, sideHasVectorArt } from "../artwork/vectorSheet";
import { generateDielineSVG } from "../geometry/svgExport";
import { generateDielineDXF } from "../geometry/dxfExport";
import { downloadBlob } from "../lib/files";
import type * as THREE from "three";
import Icon from "./Icon";
import { useFeedback } from "./Feedback";
import ExportDialog from "./ExportDialog";
import type { ExportSettings } from "../lib/preferences";
import { resolvePaper, setPreferences, usePreferences } from "../lib/preferences";
import { useT } from "../lib/i18n";

interface Props {
  layout: DielineLayout;
  dims: BoxDimensions;
  styleDefaults: BoxDimensions;
  artwork: ArtworkState;
  title: string;
  sceneRef: React.MutableRefObject<THREE.Group | null>;
  sceneCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  transparentSceneExportRef: React.MutableRefObject<(() => Promise<Blob>) | null>;
  activeTab: "2d" | "3d";
  /** Lets 3D exports switch to the 3D Studio themselves instead of being disabled. */
  onRequestTab: (tab: "2d" | "3d") => void;
}

/**
 * The board colours used on screen (a warm beige for the inside face) exist to
 * make the 3D preview read like real board. They must NOT be baked into an
 * export: you print onto white stock, so a filled background would waste ink and
 * come out as a beige sheet. Everything printed therefore renders on white.
 */
function forPrint(side: SideArtwork): SideArtwork {
  return { ...side, backgroundColor: "#ffffff" };
}

export default function ExportBar({ layout, dims, styleDefaults, artwork, title, sceneRef, sceneCanvasRef, transparentSceneExportRef, activeTab, onRequestTab }: Props) {
  const { notify } = useFeedback();
  const t = useT();
  const { exportSettings } = usePreferences();
  const [busy, setBusy] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const includeMeasurements = exportSettings.measurements;
  const exportMenuRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => { if (exportMenuRef.current) exportMenuRef.current.open = false; }, [activeTab]);
  const closeExportMenu = () => { if (exportMenuRef.current) exportMenuRef.current.open = false; };
  const runFromMenu = (action: () => void) => { action(); closeExportMenu(); };

  const run = async (name: string, fn: () => Promise<void>) => {
    setBusy(name);
    try {
      await fn();
    } catch (err) {
      console.error(err);
      notify(`Export failed: ${(err as Error).message ?? err}`, "error");
    } finally {
      setBusy(null);
    }
  };

  const save = (filename: string, blob: Blob) => {
    downloadBlob(filename, blob);
    notify(`Exported ${filename}`, "success");
  };

  // The 3D refs outlive the 3D view (they keep pointing at a torn-down canvas), so
  // from the dieline tab they are cleared, the studio is opened, and we wait for
  // the freshly mounted scene to publish new ones before exporting from it.
  const ensure3D = async () => {
    if (activeTab === "3d") return;
    sceneRef.current = null;
    sceneCanvasRef.current = null;
    transparentSceneExportRef.current = null;
    onRequestTab("3d");
    const deadline = Date.now() + 10000;
    while (!(sceneRef.current && sceneCanvasRef.current && transparentSceneExportRef.current)) {
      if (Date.now() > deadline) throw new Error("The 3D studio took too long to load. Open the 3D tab and try again.");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    // Give textures and the first frames a moment to settle so the capture isn't blank.
    await new Promise((resolve) => setTimeout(resolve, 700));
  };

  // Sides that use SVG artwork are exported as markup so they stay vector; every
  // other side keeps the flattened 8 px/mm bitmap.
  const artworkFor = async (side: SideArtwork): Promise<{ artworkDataUrl?: string; artworkMarkup?: string }> => {
    const printable = forPrint(side);
    if (sideHasVectorArt(printable)) return { artworkMarkup: buildArtworkMarkup(layout, printable) };
    return { artworkDataUrl: (await renderFullSheetCanvas(layout, printable, 8)).toDataURL("image/png") };
  };

  const exportSVG = () =>
    run("svg", async () => {
      const hasInside = sideHasContent(artwork.inside);
      const outsideSvg = generateDielineSVG(layout, {
        ...(await artworkFor(artwork.outside)),
        title,
        trimGuide: true,
        dimensions: includeMeasurements,
      });
      save(`${title}${hasInside ? "_outside" : ""}.svg`, new Blob([outsideSvg], { type: "image/svg+xml" }));

      if (hasInside) {
        // Saved UNMIRRORED, unlike the PDF's inside page. These are separate image
        // files handed to some other program, where the eventual page orientation
        // (and therefore which axis a long-edge flip turns about) isn't known here.
        // Shipping it the right way round keeps it predictable — mirror it in that
        // program if you send it to a duplex printer.
        const insideSvg = generateDielineSVG(layout, {
          ...(await artworkFor(artwork.inside)),
          title,
          trimGuide: true,
          dimensions: includeMeasurements,
        });
        save(`${title}_inside.svg`, new Blob([insideSvg], { type: "image/svg+xml" }));
      }
    });

  const exportPDF = (settings: ExportSettings) =>
    run("pdf", async () => {
      setDialogOpen(false);
      const { exportDielinePDF } = await import("../geometry/pdfExport");
      // Both faces are always rendered and always exported — the inside sheet is
      // needed for print regardless of whether artwork has been added to it yet.
      const outside = await artworkFor(artwork.outside);
      const inside = await artworkFor(artwork.inside);
      const blob = await exportDielinePDF(layout, {
        outsideArtworkDataUrl: outside.artworkDataUrl,
        outsideArtworkMarkup: outside.artworkMarkup,
        insideArtworkDataUrl: inside.artworkDataUrl,
        insideArtworkMarkup: inside.artworkMarkup,
        title,
        paper: resolvePaper(settings),
        marginMm: settings.margin,
        bleedMm: settings.bleed,
        cropMarks: settings.cropMarks,
        includeInside: settings.includeInside,
        dimensions: settings.measurements,
      });
      save(`${title}.pdf`, blob);
    });

  const exportDXF = () =>
    run("dxf", async () => {
      const dxf = generateDielineDXF(layout);
      save(`${title}.dxf`, new Blob([dxf], { type: "application/dxf" }));
    });

  const exportModel = () =>
    run("glb", async () => {
      const { exportGLB } = await import("../geometry/glbExport");
      await ensure3D();
      if (!sceneRef.current) throw new Error("The 3D model is not ready yet. Open the 3D tab and try again.");
      const blob = await exportGLB(sceneRef.current);
      save(`${title}.glb`, blob);
    });

  const exportSceneImage = (format: "png" | "jpg") => run(format, async () => {
    await ensure3D();
    const canvas = sceneCanvasRef.current;
    if (!canvas) throw new Error("Open the 3D preview first so its canvas is ready.");
    const mime = format === "png" ? "image/png" : "image/jpeg";
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Could not capture the 3D preview.")), mime, 0.94);
    });
    save(`${title}_3d.${format}`, blob);
  });

  const exportTransparentScene = () => run("transparent-png", async () => {
    await ensure3D();
    const capture = transparentSceneExportRef.current;
    if (!capture) throw new Error("Open the 3D preview first so its renderer is ready.");
    save(`${title}_3d_transparent.png`, await capture());
  });

  const exportScenePDF = () => run("scene-pdf", async () => {
    const { jsPDF } = await import("jspdf");
    await ensure3D();
    const canvas = sceneCanvasRef.current;
    if (!canvas) throw new Error("Open the 3D preview first so its canvas is ready.");
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 10;
    const scale = Math.min((pageWidth - 2 * margin) / canvas.width, (pageHeight - 2 * margin) / canvas.height);
    const width = canvas.width * scale;
    const height = canvas.height * scale;
    doc.addImage(canvas.toDataURL("image/png"), "PNG", (pageWidth - width) / 2, (pageHeight - height) / 2, width, height);
    save(`${title}_3d.pdf`, doc.output("blob"));
  });

  return (
    <div className="export-bar" aria-label={t("Export project")}>
      <button type="button" className="export-primary" disabled={!!busy} onClick={() => setDialogOpen(true)} title={t("Print-ready PDF with the dieline and both box faces. Opens paper, bleed and preflight options.")}>
        <Icon name="download"/><span>{busy === "pdf" ? t("Preparing…") : t("Export PDF")}</span>
      </button>
      <details ref={exportMenuRef} className="export-menu" onToggle={(event) => { if (event.currentTarget.open) window.dispatchEvent(new Event("packbox:export-menu-open")); }}>
        <summary aria-label={t("More export options")} title={t("More export options")}><Icon name="more"/><Icon name="chevron"/></summary>
        <div className="export-popover" role="group" aria-label={t("Export options")}>
          <div className="export-group-label">{t("PRODUCTION FILES")}</div>
          <button type="button" className="export-option" disabled={!!busy} onClick={() => runFromMenu(exportSVG)}><span><b>{t("SVG dieline")}</b><small>{t("Vector artwork · outside / inside")}</small></span><Icon name="download"/></button>
          <button type="button" className="export-option" disabled={!!busy} onClick={() => runFromMenu(exportDXF)}><span><b>{t("DXF cut file")}</b><small>{t("CAD-ready cut and crease lines")}</small></span><Icon name="download"/></button>
          <button type="button" className="export-option" disabled={!!busy} onClick={() => runFromMenu(exportModel)} title={t("Export the assembled model.")}><span><b>{t("3D model · GLB")}</b><small>{activeTab === "3d" ? t("Folded packaging geometry") : t("Folded geometry · opens 3D Studio")}</small></span><Icon name="download"/></button>
          <label className="export-measurements"><input type="checkbox" checked={includeMeasurements} onChange={(e) => setPreferences({ exportSettings: { ...exportSettings, measurements: e.target.checked } })}/><span>{t("Include measurement marks")}</span></label>
          <div className="export-group-label presentation-label">{t("PRESENTATION")}</div>
          <div className="presentation-exports">
            <button type="button" className="export-option" disabled={!!busy} onClick={() => runFromMenu(exportTransparentScene)} title={t("Save the current 3D view as a transparent PNG")}><span><b>{t("Scene image · PNG transparent")}</b><small>{t("Transparent background · alpha channel")}</small></span><Icon name="image"/></button>
            <button type="button" className="export-option" disabled={!!busy} onClick={() => runFromMenu(() => exportSceneImage("png"))} title={t("Save the current 3D view as PNG")}><span><b>{t("Scene image · PNG")}</b><small>{t("Current studio background included")}</small></span><Icon name="image"/></button>
            <button type="button" className="export-option" disabled={!!busy} onClick={() => runFromMenu(() => exportSceneImage("jpg"))} title={t("Save the current 3D view as JPG")}><span><b>{t("Scene image · JPG")}</b><small>{t("Compressed preview capture")}</small></span><Icon name="image"/></button>
            <button type="button" className="export-option" disabled={!!busy} onClick={() => runFromMenu(exportScenePDF)} title={t("Save the current 3D view on landscape A4")}><span><b>{t("Scene PDF")}</b><small>{t("Landscape A4 presentation")}</small></span><Icon name="download"/></button>
          </div>
        </div>
      </details>
      {dialogOpen && <ExportDialog layout={layout} dims={dims} styleDefaults={styleDefaults} artwork={artwork} busy={busy === "pdf"} onClose={() => setDialogOpen(false)} onExport={exportPDF} />}
    </div>
  );
}
