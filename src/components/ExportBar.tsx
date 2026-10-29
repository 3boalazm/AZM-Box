import { useEffect, useRef, useState } from "react";
import type { DielineLayout } from "../geometry/types";
import type { ArtworkState, SideArtwork } from "../artwork/types";
import { sideHasContent } from "../artwork/types";
import { renderFullSheetCanvas } from "../artwork/renderPanel";
import { generateDielineSVG } from "../geometry/svgExport";
import { generateDielineDXF } from "../geometry/dxfExport";
import { downloadBlob } from "../lib/files";
import type * as THREE from "three";
import Icon from "./Icon";

interface Props {
  layout: DielineLayout;
  artwork: ArtworkState;
  title: string;
  sceneRef: React.MutableRefObject<THREE.Group | null>;
  sceneCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  transparentSceneExportRef: React.MutableRefObject<(() => Promise<Blob>) | null>;
  activeTab: "2d" | "3d";
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

export default function ExportBar({ layout, artwork, title, sceneRef, sceneCanvasRef, transparentSceneExportRef, activeTab }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [includeMeasurements, setIncludeMeasurements] = useState(false);
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
      alert(`Export failed: ${(err as Error).message ?? err}`);
    } finally {
      setBusy(null);
    }
  };

  const exportSVG = () =>
    run("svg", async () => {
      const hasInside = sideHasContent(artwork.inside);
      const outsideCanvas = await renderFullSheetCanvas(layout, forPrint(artwork.outside), 8);
      const outsideSvg = generateDielineSVG(layout, {
        artworkDataUrl: outsideCanvas.toDataURL("image/png"),
        title,
        trimGuide: true,
        dimensions: includeMeasurements,
      });
      downloadBlob(`${title}${hasInside ? "_outside" : ""}.svg`, new Blob([outsideSvg], { type: "image/svg+xml" }));

      if (hasInside) {
        // Saved UNMIRRORED, unlike the PDF's inside page. These are separate image
        // files handed to some other program, where the eventual page orientation
        // (and therefore which axis a long-edge flip turns about) isn't known here.
        // Shipping it the right way round keeps it predictable — mirror it in that
        // program if you send it to a duplex printer.
        const insideCanvas = await renderFullSheetCanvas(layout, forPrint(artwork.inside), 8);
        const insideSvg = generateDielineSVG(layout, {
          artworkDataUrl: insideCanvas.toDataURL("image/png"),
          title,
          trimGuide: true,
          dimensions: includeMeasurements,
        });
        downloadBlob(`${title}_inside.svg`, new Blob([insideSvg], { type: "image/svg+xml" }));
      }
    });

  const exportPDF = () =>
    run("pdf", async () => {
      const { exportDielinePDF } = await import("../geometry/pdfExport");
      // Both faces are always rendered and always exported — the inside sheet is
      // needed for print regardless of whether artwork has been added to it yet.
      const outsideCanvas = await renderFullSheetCanvas(layout, forPrint(artwork.outside), 8);
      const insideCanvas = await renderFullSheetCanvas(layout, forPrint(artwork.inside), 8);
      const blob = await exportDielinePDF(layout, {
        outsideArtworkDataUrl: outsideCanvas.toDataURL("image/png"),
        insideArtworkDataUrl: insideCanvas.toDataURL("image/png"),
        title,
        dimensions: includeMeasurements,
      });
      downloadBlob(`${title}.pdf`, blob);
    });

  const exportDXF = () =>
    run("dxf", async () => {
      const dxf = generateDielineDXF(layout);
      downloadBlob(`${title}.dxf`, new Blob([dxf], { type: "application/dxf" }));
    });

  const exportModel = () =>
    run("glb", async () => {
      const { exportGLB } = await import("../geometry/glbExport");
      if (!sceneRef.current) {
        alert("Open the 3D tab first so the model is ready to export.");
        return;
      }
      const blob = await exportGLB(sceneRef.current);
      downloadBlob(`${title}.glb`, blob);
    });

  const exportSceneImage = (format: "png" | "jpg") => run(format, async () => {
    const canvas = sceneCanvasRef.current;
    if (!canvas) throw new Error("Open the 3D preview first so its canvas is ready.");
    const mime = format === "png" ? "image/png" : "image/jpeg";
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Could not capture the 3D preview.")), mime, 0.94);
    });
    downloadBlob(`${title}_3d.${format}`, blob);
  });

  const exportTransparentScene = () => run("transparent-png", async () => {
    const capture = transparentSceneExportRef.current;
    if (!capture) throw new Error("Open the 3D preview first so its renderer is ready.");
    downloadBlob(`${title}_3d_transparent.png`, await capture());
  });

  const exportScenePDF = () => run("scene-pdf", async () => {
    const { jsPDF } = await import("jspdf");
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
    downloadBlob(`${title}_3d.pdf`, doc.output("blob"));
  });

  return (
    <div className="export-bar" aria-label="Export project">
      <button type="button" className="export-primary" disabled={!!busy} onClick={exportPDF} title="Print-ready A4 PDF with the dieline and both box faces.">
        <Icon name="download"/><span>{busy === "pdf" ? "Preparing…" : "Export PDF"}</span>
      </button>
      <details ref={exportMenuRef} className="export-menu" onToggle={(event) => { if (event.currentTarget.open) window.dispatchEvent(new Event("packbox:export-menu-open")); }}>
        <summary aria-label="More export options" title="More export options"><Icon name="more"/><Icon name="chevron"/></summary>
        <div className="export-popover" role="group" aria-label="Export options">
          <div className="export-group-label">PRODUCTION FILES</div>
          <button type="button" className="export-option" disabled={!!busy} onClick={() => runFromMenu(exportSVG)}><span><b>SVG dieline</b><small>Vector artwork · outside / inside</small></span><Icon name="download"/></button>
          <button type="button" className="export-option" disabled={!!busy} onClick={() => runFromMenu(exportDXF)}><span><b>DXF cut file</b><small>CAD-ready cut and crease lines</small></span><Icon name="download"/></button>
          <button type="button" className="export-option" disabled={!!busy || activeTab !== "3d"} onClick={() => runFromMenu(exportModel)} title={activeTab !== "3d" ? "Open 3D Studio before exporting the model." : "Export the assembled model."}><span><b>3D model · GLB</b><small>{activeTab === "3d" ? "Folded packaging geometry" : "Available in 3D Studio"}</small></span><Icon name="download"/></button>
          <label className="export-measurements"><input type="checkbox" checked={includeMeasurements} onChange={(e) => setIncludeMeasurements(e.target.checked)}/><span>Include measurement marks</span></label>
          <div className="export-group-label presentation-label">PRESENTATION</div>
          <div className="presentation-exports">
            <button type="button" className="export-option" disabled={!!busy || activeTab !== "3d"} onClick={() => runFromMenu(exportTransparentScene)} title="Save the current 3D view as a transparent PNG"><span><b>Scene image · PNG transparent</b><small>Transparent background · alpha channel</small></span><Icon name="image"/></button>
            <button type="button" className="export-option" disabled={!!busy || activeTab !== "3d"} onClick={() => runFromMenu(() => exportSceneImage("png"))} title="Save the current 3D view as PNG"><span><b>Scene image · PNG</b><small>Current studio background included</small></span><Icon name="image"/></button>
            <button type="button" className="export-option" disabled={!!busy || activeTab !== "3d"} onClick={() => runFromMenu(() => exportSceneImage("jpg"))} title="Save the current 3D view as JPG"><span><b>Scene image · JPG</b><small>Compressed preview capture</small></span><Icon name="image"/></button>
            <button type="button" className="export-option" disabled={!!busy || activeTab !== "3d"} onClick={() => runFromMenu(exportScenePDF)} title="Save the current 3D view on landscape A4"><span><b>Scene PDF</b><small>Landscape A4 presentation</small></span><Icon name="download"/></button>
          </div>
        </div>
      </details>
    </div>
  );
}
