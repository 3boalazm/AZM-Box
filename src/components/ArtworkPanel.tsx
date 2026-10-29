import { useRef, useState } from "react";
import Icon from "./Icon";
import ArtworkCropper from "./ArtworkCropper";
import type { DielineLayout } from "../geometry/types";
import type { ArtworkState, EditorLayer, SideArtwork } from "../artwork/types";
import { readFileAsDataURL, loadImageSize } from "../lib/files";

interface Props {
  layout: DielineLayout;
  artwork: ArtworkState;
  activeSide: "outside" | "inside";
  onChangeActiveSide: (s: "outside" | "inside") => void;
  selectedPanelId: string | null;
  onUpdateArtwork: (updater: (a: ArtworkState) => ArtworkState) => void;
}

function updateSide(artwork: ArtworkState, side: "outside" | "inside", fn: (s: SideArtwork) => SideArtwork): ArtworkState {
  return { ...artwork, [side]: fn(artwork[side]) };
}

let layerCounter = 0;
function newId(prefix: string) {
  layerCounter += 1;
  return `${prefix}-${Date.now()}-${layerCounter}`;
}

export default function ArtworkPanel({ layout, artwork, activeSide, onChangeActiveSide, selectedPanelId, onUpdateArtwork }: Props) {
  const sheetInputRef = useRef<HTMLInputElement>(null);
  const panelInputRef = useRef<HTMLInputElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [cropTarget, setCropTarget] = useState<{ kind: "sheet" } | { kind: "panel"; panelId: string } | { kind: "layer"; id: string } | null>(null);
  const side = artwork[activeSide];
  const cropSource = cropTarget?.kind === "sheet"
    ? side.sheetImage
    : cropTarget?.kind === "panel"
      ? side.panelImages[cropTarget.panelId]
      : cropTarget?.kind === "layer"
        ? side.layers.find((layer): layer is Extract<EditorLayer, { kind: "image" }> => layer.id === cropTarget.id && layer.kind === "image")?.src
        : undefined;
  const selectedPanel = layout.panels.find((p) => p.id === selectedPanelId);

  const handleSheetUpload = async (file: File) => {
    const dataUrl = await readFileAsDataURL(file);
    // Fit the whole sheet bounds by default (matches the old auto-scale-to-template
    // behavior) — the user can then drag/resize/rotate it freely on the canvas.
    onUpdateArtwork((a) =>
      updateSide(a, activeSide, (s) => ({
        ...s,
        sheetImage: dataUrl,
        sheetOffset: { x: 0, y: 0 },
        sheetWidth: layout.bounds.width,
        sheetHeight: layout.bounds.height,
        sheetRotation: 0,
      })),
    );
  };

  const resetSheetToFit = () => {
    onUpdateArtwork((a) =>
      updateSide(a, activeSide, (s) => ({
        ...s,
        sheetOffset: { x: 0, y: 0 },
        sheetWidth: layout.bounds.width,
        sheetHeight: layout.bounds.height,
        sheetRotation: 0,
      })),
    );
  };

  const handlePanelUpload = async (file: File) => {
    if (!selectedPanel) return;
    const dataUrl = await readFileAsDataURL(file);
    onUpdateArtwork((a) => updateSide(a, activeSide, (s) => ({ ...s, panelImages: { ...s.panelImages, [selectedPanel.id]: dataUrl } })));
  };

  const handleLogoUpload = async (file: File) => {
    if (!selectedPanel) return;
    const dataUrl = await readFileAsDataURL(file);

    // Fit the logo's OWN aspect ratio inside a target box (~50% of the panel)
    // instead of forcing it into a fixed 50%x50% square — that stretch is what
    // was distorting every upload. Fall back to the old square-ish box if the
    // image dimensions can't be read for some reason.
    let width = selectedPanel.w * 0.5;
    let height = selectedPanel.h * 0.5;
    try {
      const natural = await loadImageSize(dataUrl);
      const targetW = selectedPanel.w * 0.5;
      const targetH = selectedPanel.h * 0.5;
      const scale = Math.min(targetW / natural.width, targetH / natural.height);
      width = natural.width * scale;
      height = natural.height * scale;
    } catch {
      /* use the fallback box size above */
    }

    const layer: EditorLayer = {
      id: newId("img"),
      kind: "image",
      panelId: selectedPanel.id,
      x: (selectedPanel.w - width) / 2,
      y: (selectedPanel.h - height) / 2,
      width,
      height,
      src: dataUrl,
      rotation: 0,
    };
    onUpdateArtwork((a) => updateSide(a, activeSide, (s) => ({ ...s, layers: [...s.layers, layer] })));
  };

  const addText = () => {
    if (!selectedPanel) return;
    const layer: EditorLayer = {
      id: newId("txt"),
      kind: "text",
      panelId: selectedPanel.id,
      x: selectedPanel.w * 0.15,
      y: selectedPanel.h * 0.5,
      text: "Your text",
      fontSize: Math.max(4, selectedPanel.h * 0.12),
      color: "#111111",
      rotation: 0,
    };
    onUpdateArtwork((a) => updateSide(a, activeSide, (s) => ({ ...s, layers: [...s.layers, layer] })));
  };

  const removeLayer = (id: string) => {
    onUpdateArtwork((a) => updateSide(a, activeSide, (s) => ({ ...s, layers: s.layers.filter((l) => l.id !== id) })));
  };

  const updateLayerText = (id: string, text: string) => {
    onUpdateArtwork((a) =>
      updateSide(a, activeSide, (s) => ({ ...s, layers: s.layers.map((l) => (l.id === id && l.kind === "text" ? { ...l, text } : l)) })),
    );
  };

  const removePanelImage = () => {
    if (!selectedPanel) return;
    onUpdateArtwork((a) =>
      updateSide(a, activeSide, (s) => {
        const next = { ...s.panelImages };
        delete next[selectedPanel.id];
        return { ...s, panelImages: next };
      }),
    );
  };

  return (
    <aside className="panel artwork-panel inspector-panel" aria-label="Artwork and layers">
      <header className="inspector-heading artwork-heading">
        <div><span className="eyebrow">PRINT & LAYERS</span><h2>Artwork</h2></div>
        <span className="side-indicator">{activeSide === "outside" ? "Outside" : "Inside"}</span>
      </header>

      <div className="side-switch" role="group" aria-label="Artwork side">
        <button type="button" className={activeSide === "outside" ? "active" : ""} aria-pressed={activeSide === "outside"} onClick={() => onChangeActiveSide("outside")}>Outside</button>
        <button type="button" className={activeSide === "inside" ? "active" : ""} aria-pressed={activeSide === "inside"} onClick={() => onChangeActiveSide("inside")}>Inside</button>
      </div>

      <details className="inspector-group artwork-group" open>
        <summary className="inspector-summary"><span>Full sheet image</span><span className="summary-meta">{side.sheetImage ? "Added" : "Optional"}</span></summary>
        <div className="inspector-content">
          <p className="control-hint">Place one print-ready image across the dieline. Resize and reposition it directly on the canvas.</p>
          <input ref={sheetInputRef} className="visually-hidden" type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && handleSheetUpload(e.target.files[0])} />
          {!side.sheetImage ? (
            <button type="button" className="upload-action" onClick={() => sheetInputRef.current?.click()}><Icon name="image"/><span><b>Place artwork</b><small>Choose an image file</small></span><Icon name="plus"/></button>
          ) : (
            <>
              <label className="slider-row artwork-zoom-control"><span>Scale <b>{Math.round((side.sheetWidth / layout.bounds.width) * 100)}%</b></span><input aria-label="Artwork image size" type="range" min={10} max={500} step={1} value={Math.max(10, Math.min(500, Math.round((side.sheetWidth / layout.bounds.width) * 100)))} onChange={(e) => {
                const scale = Number(e.target.value) / 100; const ratio = side.sheetHeight / side.sheetWidth;
                onUpdateArtwork((a) => updateSide(a, activeSide, (s) => ({ ...s, sheetWidth: layout.bounds.width * scale, sheetHeight: layout.bounds.width * scale * ratio })));
              }}/></label>
              <div className="compact-actions">
                <button type="button" className="subtle-action" aria-label="Zoom out artwork" onClick={() => { const scale = Math.max(0.1, side.sheetWidth / layout.bounds.width - 0.1); const ratio = side.sheetHeight / side.sheetWidth; onUpdateArtwork((a) => updateSide(a, activeSide, (s) => ({ ...s, sheetWidth: layout.bounds.width * scale, sheetHeight: layout.bounds.width * scale * ratio }))); }}>−</button>
                <button type="button" className="subtle-action" aria-label="Zoom in artwork" onClick={() => { const scale = Math.min(5, side.sheetWidth / layout.bounds.width + 0.1); const ratio = side.sheetHeight / side.sheetWidth; onUpdateArtwork((a) => updateSide(a, activeSide, (s) => ({ ...s, sheetWidth: layout.bounds.width * scale, sheetHeight: layout.bounds.width * scale * ratio }))); }}>+</button>
                <button type="button" className="subtle-action" onClick={() => setCropTarget({ kind: "sheet" })}><Icon name="crop"/> Crop</button>
                <button type="button" className="subtle-action" onClick={resetSheetToFit}>Fit to sheet</button>
              </div>
              <div className="compact-actions secondary-actions">
                <button type="button" className="text-action" onClick={() => sheetInputRef.current?.click()}>Replace image</button>
                <button type="button" className="text-action danger-action" onClick={() => onUpdateArtwork((a) => updateSide(a, activeSide, (s) => ({ ...s, sheetImage: undefined })))}>Remove</button>
              </div>
            </>
          )}
        </div>
      </details>

      <details className="inspector-group artwork-group" open>
        <summary className="inspector-summary"><span>Selected panel</span><span className="summary-meta">{selectedPanel ? selectedPanel.name : "None"}</span></summary>
        <div className="inspector-content">
          {!selectedPanel ? <p className="empty-note">Select a face on the dieline to place panel artwork and text.</p> : <>
            <div className="panel-target"><span className="target-dot"/><span>{selectedPanel.name}</span><span className="target-size">{selectedPanel.w.toFixed(0)} × {selectedPanel.h.toFixed(0)} mm</span></div>
            <input ref={panelInputRef} className="visually-hidden" type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && handlePanelUpload(e.target.files[0])}/>
            <div className="compact-actions panel-actions">
              <button type="button" className="subtle-action" onClick={() => panelInputRef.current?.click()}><Icon name="image"/> Place image</button>
              <button type="button" className="subtle-action" onClick={addText}><Icon name="plus"/> Add text</button>
              <input ref={logoInputRef} className="visually-hidden" type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && handleLogoUpload(e.target.files[0])}/>
              <button type="button" className="subtle-action" onClick={() => logoInputRef.current?.click()}><Icon name="plus"/> Add logo</button>
            </div>
            {side.panelImages[selectedPanel.id] && <button type="button" className="text-action danger-action" onClick={removePanelImage}>Remove panel image</button>}
          </>}
        </div>
      </details>

      <details className="inspector-group artwork-group" open>
        <summary className="inspector-summary"><span>Layers</span><span className="summary-meta">{side.layers.length.toString().padStart(2, "0")}</span></summary>
        <div className="inspector-content">
          {side.layers.length === 0 ? <p className="empty-note">Text and logos added to the selected face appear here.</p> : <ul className="layer-list">
            {side.layers.map((layer) => <li key={layer.id}>
              <span className="layer-kind"><Icon name={layer.kind === "text" ? "layers" : "image"}/></span>
              {layer.kind === "text" ? <input aria-label="Layer text" value={layer.text} onChange={(e) => updateLayerText(layer.id, e.target.value)}/> : <span className="layer-name">Image layer</span>}
              {layer.kind === "image" && <button type="button" className="subtle-action layer-crop-button" aria-label="Crop image layer" onClick={() => setCropTarget({ kind: "layer", id: layer.id })}><Icon name="crop"/></button>}
              <button type="button" className="icon-btn layer-remove" aria-label={`Remove ${layer.kind} layer`} onClick={() => removeLayer(layer.id)}><Icon name="trash"/></button>
            </li>)}
          </ul>}
        </div>
      </details>
      {cropTarget && cropSource && <ArtworkCropper src={cropSource} onCancel={() => setCropTarget(null)} onApply={(croppedImage) => {
        onUpdateArtwork((a) => updateSide(a, activeSide, (s) => {
          if (cropTarget.kind === "sheet") return { ...s, sheetImage: croppedImage };
          if (cropTarget.kind === "panel") return { ...s, panelImages: { ...s.panelImages, [cropTarget.panelId]: croppedImage } };
          return { ...s, layers: s.layers.map((layer) => layer.id === cropTarget.id && layer.kind === "image" ? { ...layer, src: croppedImage } : layer) };
        }));
        setCropTarget(null);
      }} />}
    </aside>
  );
}
