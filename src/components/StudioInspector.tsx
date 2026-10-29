import type { ArtworkState, EditorLayer, SideArtwork } from "../artwork/types";
import type { DielineLayout } from "../geometry/types";
import type { CameraPreset, SceneSettings } from "../project/sceneSettings";

interface Props {
  settings: SceneSettings;
  onChange: React.Dispatch<React.SetStateAction<SceneSettings>>;
  artwork: ArtworkState;
  onChangeArtwork: React.Dispatch<React.SetStateAction<ArtworkState>>;
  activeSide: "outside" | "inside";
  onChangeActiveSide: (side: "outside" | "inside") => void;
  selectedItem: string;
  layout: DielineLayout;
  selectedPanelId: string | null;
}

const cameraPresets: { id: CameraPreset; label: string }[] = [
  { id: "front", label: "Front" }, { id: "back", label: "Back" }, { id: "left", label: "Left" },
  { id: "right", label: "Right" }, { id: "top", label: "Top" }, { id: "iso", label: "Iso" },
];

function NumericField({ label, value, step = 1, disabled = false, onChange }: { label: string; value: number; step?: number; disabled?: boolean; onChange: (value: number) => void }) {
  return <label className="studio-property-field"><span>{label}</span><input type="number" step={step} value={Number.isFinite(value) ? Number(value.toFixed(2)) : 0} disabled={disabled} onChange={(event) => { const next = Number(event.target.value); if (Number.isFinite(next)) onChange(next); }}/></label>;
}

export default function StudioInspector({ settings, onChange, artwork, onChangeArtwork, activeSide, onChangeActiveSide, selectedItem, layout, selectedPanelId }: Props) {
  const update = (patch: Partial<SceneSettings>) => onChange((current) => ({ ...current, ...patch }));
  const updateSide = (sideName: "outside" | "inside", patch: Partial<SideArtwork>) => onChangeArtwork((current) => ({ ...current, [sideName]: { ...current[sideName], ...patch } }));
  const layerMatch = /^artwork:(outside|inside):(.+)$/.exec(selectedItem);
  const sheetMatch = /^sheet:(outside|inside)$/.exec(selectedItem);
  const panelImageMatch = /^panel:(outside|inside):(.+)$/.exec(selectedItem);
  const selectedArtworkSide = (layerMatch?.[1] || sheetMatch?.[1] || panelImageMatch?.[1]) as "outside" | "inside" | undefined;
  const selectedLayer = layerMatch ? artwork[selectedArtworkSide!].layers.find((layer) => layer.id === layerMatch[2]) : undefined;
  const selectedPanelImageId = panelImageMatch?.[2];
  const selectedPanelImageSide = selectedPanelImageId && selectedArtworkSide ? artwork[selectedArtworkSide].panelImages[selectedPanelImageId] : undefined;
  const modelPanelId = selectedItem.startsWith("model-panel:") ? selectedItem.slice("model-panel:".length) : selectedPanelId;
  const selectedPanel = layout.panels.find((panel) => panel.id === modelPanelId);
  const selectedSheet = sheetMatch ? artwork[selectedArtworkSide!]: undefined;
  const selectedSide = selectedArtworkSide ? artwork[selectedArtworkSide] : undefined;
  const selectedLayerLocked = selectedLayer && selectedArtworkSide
    ? settings.lockedLayerIds.includes(`layer:${selectedArtworkSide}:${selectedLayer.id}`) || settings.lockedLayerIds.includes(selectedLayer.id)
    : false;
  const selectedSheetLocked = selectedArtworkSide ? settings.lockedLayerIds.includes(`sheet:${selectedArtworkSide}`) : false;
  const selectedPanelImageLocked = selectedArtworkSide && selectedPanelImageId ? settings.lockedLayerIds.includes(`panel:${selectedArtworkSide}:${selectedPanelImageId}`) : false;

  const updateLayer = (layerId: string, patch: Partial<EditorLayer>) => {
    if (!selectedArtworkSide || selectedLayerLocked) return;
    onChangeArtwork((current) => ({
      ...current,
      [selectedArtworkSide]: { ...current[selectedArtworkSide], layers: current[selectedArtworkSide].layers.map((layer) => layer.id === layerId ? { ...layer, ...patch } as EditorLayer : layer) },
    }));
  };
  const selectedName = selectedLayer?.name || (selectedLayer?.kind === "text" ? selectedLayer.text : undefined)
    || (sheetMatch ? artwork[selectedArtworkSide!].sheetImageName || "Full-sheet artwork" : undefined)
    || (selectedPanelImageId ? artwork[selectedArtworkSide!].panelImageNames[selectedPanelImageId] || layout.panels.find((p) => p.id === selectedPanelImageId)?.name || "Panel image" : undefined)
    || (selectedItem.startsWith("model-panel:") ? selectedPanel?.name : undefined)
    || (selectedItem.startsWith("light:") ? `${selectedItem.slice(6)} light` : undefined)
    || (selectedItem.startsWith("production:") ? "Production / dieline" : undefined)
    || (selectedItem === "scene:floor" ? "Ground plane" : selectedItem === "scene:model" ? "Packaging model" : selectedItem.startsWith("side:") ? `${selectedItem.endsWith("inside") ? "Inside" : "Outside"} artwork` : "Scene properties");
  const selectedGroup = selectedLayer || sheetMatch || panelImageMatch || selectedItem.startsWith("side:") ? "artwork"
    : selectedItem.startsWith("light:") ? "lighting"
      : selectedItem === "scene:floor" ? "environment"
        : selectedItem.startsWith("production:") ? "production"
          : selectedItem.startsWith("model-panel:") || selectedItem === "scene:model" ? "surface" : "camera";

  return <aside className="studio-inspector panel" aria-label="Studio properties">
    <header className="studio-inspector-heading"><span className="eyebrow">PROPERTIES</span><h2>{selectedName}</h2><p>Context properties · project-saved</p></header>

    {selectedLayer && selectedArtworkSide && <section className="studio-selection-properties" aria-label="Selected artwork layer properties">
      <div className="studio-selection-top"><span>{selectedLayer.kind === "text" ? "TEXT LAYER" : "IMAGE LAYER"}</span><span>{selectedLayerLocked ? "LOCKED" : "EDITABLE"}</span></div>
      <label className="studio-select-label">Layer name<input className="studio-text-input" value={selectedLayer.name || (selectedLayer.kind === "text" ? selectedLayer.text : "Image layer")} disabled={selectedLayerLocked} onChange={(event) => updateLayer(selectedLayer.id, { name: event.target.value.slice(0, 120) })}/></label>
      {selectedLayer.kind === "text" && <label className="studio-select-label">Text content<input className="studio-text-input" value={selectedLayer.text} disabled={selectedLayerLocked} onChange={(event) => updateLayer(selectedLayer.id, { text: event.target.value })}/></label>}
      <div className="studio-property-grid">
        <NumericField label="X · mm" value={selectedLayer.x} disabled={selectedLayerLocked} onChange={(x) => updateLayer(selectedLayer.id, { x })}/>
        <NumericField label="Y · mm" value={selectedLayer.y} disabled={selectedLayerLocked} onChange={(y) => updateLayer(selectedLayer.id, { y })}/>
        {selectedLayer.kind === "text" ? <NumericField label="Font · mm" step={0.5} value={selectedLayer.fontSize} disabled={selectedLayerLocked} onChange={(fontSize) => updateLayer(selectedLayer.id, { fontSize: Math.max(1, fontSize) })}/>
          : <><NumericField label="Width · mm" value={selectedLayer.width} disabled={selectedLayerLocked} onChange={(width) => updateLayer(selectedLayer.id, { width: Math.max(1, width) })}/><NumericField label="Height · mm" value={selectedLayer.height} disabled={selectedLayerLocked} onChange={(height) => updateLayer(selectedLayer.id, { height: Math.max(1, height) })}/></>}
        <NumericField label="Rotation · °" step={1} value={selectedLayer.rotation} disabled={selectedLayerLocked} onChange={(rotation) => updateLayer(selectedLayer.id, { rotation })}/>
      </div>
      {selectedLayer.kind === "text" && <label className="studio-color-row">Text color <input type="color" value={selectedLayer.color} disabled={selectedLayerLocked} onChange={(event) => updateLayer(selectedLayer.id, { color: event.target.value })}/></label>}
    </section>}

    {selectedSheet && selectedArtworkSide && <section className="studio-selection-properties" aria-label="Selected full-sheet artwork properties">
      <div className="studio-selection-top"><span>FULL-SHEET IMAGE</span><span>{selectedSheetLocked ? "LOCKED" : "EDITABLE"}</span></div>
      <label className="studio-select-label">Image name<input className="studio-text-input" value={selectedSheet.sheetImageName || "Full-sheet artwork"} disabled={selectedSheetLocked} onChange={(event) => updateSide(selectedArtworkSide, { sheetImageName: event.target.value.slice(0, 200) })}/></label>
      <div className="studio-property-grid">
        <NumericField label="X · mm" value={selectedSheet.sheetOffset.x} disabled={selectedSheetLocked} onChange={(x) => updateSide(selectedArtworkSide, { sheetOffset: { ...selectedSheet.sheetOffset, x } })}/>
        <NumericField label="Y · mm" value={selectedSheet.sheetOffset.y} disabled={selectedSheetLocked} onChange={(y) => updateSide(selectedArtworkSide, { sheetOffset: { ...selectedSheet.sheetOffset, y } })}/>
        <NumericField label="Width · mm" value={selectedSheet.sheetWidth} disabled={selectedSheetLocked} onChange={(sheetWidth) => updateSide(selectedArtworkSide, { sheetWidth: Math.max(1, sheetWidth) })}/>
        <NumericField label="Height · mm" value={selectedSheet.sheetHeight} disabled={selectedSheetLocked} onChange={(sheetHeight) => updateSide(selectedArtworkSide, { sheetHeight: Math.max(1, sheetHeight) })}/>
        <NumericField label="Rotation · °" value={selectedSheet.sheetRotation} disabled={selectedSheetLocked} onChange={(sheetRotation) => updateSide(selectedArtworkSide, { sheetRotation })}/>
      </div>
    </section>}

    {selectedPanelImageId && selectedArtworkSide && <section className="studio-selection-properties" aria-label="Selected panel artwork properties">
      <div className="studio-selection-top"><span>PANEL IMAGE</span><span>{selectedPanelImageLocked ? "LOCKED" : "EDITABLE"}</span></div>
      <label className="studio-select-label">Image name<input className="studio-text-input" value={artwork[selectedArtworkSide].panelImageNames[selectedPanelImageId] || "Panel image"} disabled={selectedPanelImageLocked} onChange={(event) => updateSide(selectedArtworkSide, { panelImageNames: { ...artwork[selectedArtworkSide].panelImageNames, [selectedPanelImageId]: event.target.value.slice(0, 200) } })}/></label>
      <p className="studio-hint">{selectedPanelImageSide ? "The panel image fills its assigned face. Replacement and removal controls remain in the Artwork inspector." : "This panel image is no longer present."}</p>
    </section>}

    {selectedPanel && selectedItem.startsWith("model-panel:") && <div className="studio-context-card"><strong>{selectedPanel.name}</strong><span>{selectedPanel.w.toFixed(1)} × {selectedPanel.h.toFixed(1)} mm</span><small>Panel selection is linked to the dieline and artwork panel.</small></div>}
    {selectedItem.startsWith("production:") && <div className="studio-context-card"><strong>Screen-only visibility</strong><small>Hidden cut/fold/measurement overlays remain in production SVG, DXF and PDF exports.</small></div>}
    {(selectedLayer || selectedSheet || selectedPanelImageId) && <div className="studio-face-switch" role="group" aria-label="Artwork face"><button type="button" aria-pressed={activeSide === "outside"} className={activeSide === "outside" ? "active" : ""} onClick={() => onChangeActiveSide("outside")}>Outside</button><button type="button" aria-pressed={activeSide === "inside"} className={activeSide === "inside" ? "active" : ""} onClick={() => onChangeActiveSide("inside")}>Inside</button></div>}

    <details className="inspector-group" open={selectedGroup === "camera"}><summary className="inspector-summary">Camera & framing</summary><div className="inspector-content">
      <span className="studio-label">Views</span><div className="studio-angle-grid">{cameraPresets.map((item) => <button key={item.id} type="button" className={settings.preset === item.id ? "selected" : ""} onClick={() => onChange((current) => ({ ...current, preset: item.id, cameraPose: null }))}>{item.label}</button>)}</div>
      <p className="studio-hint">Orbit · pan · zoom. The camera pose is saved in the project.</p>
    </div></details>
    <details className="inspector-group" open={selectedGroup === "environment"}><summary className="inspector-summary">Environment & background</summary><div className="inspector-content">
      <label className="studio-select-label">Environment preset<select value={settings.environment} onChange={(event) => { const environment = event.target.value as SceneSettings["environment"]; onChange((current) => ({ ...current, environment, background: environment === "studio" ? "#e9e6df" : environment === "soft" ? "#f5f3ed" : "#dce4ec" })); }}><option value="studio">Warm studio</option><option value="soft">Soft white</option><option value="neutral">Cool neutral</option></select></label>
      <label className="studio-color-row">Custom background <input type="color" value={settings.background} onChange={(event) => update({ background: event.target.value })}/></label>
      <label className="studio-check-row"><input type="checkbox" checked={settings.transparentBackground} onChange={(event) => update({ transparentBackground: event.target.checked })}/> Transparent backdrop</label>
      <label className="studio-check-row"><input type="checkbox" checked={settings.floor.visible} onChange={(event) => onChange((current) => ({ ...current, floor: { ...current.floor, visible: event.target.checked } }))}/> Ground plane</label>
      {settings.floor.visible && <label className="studio-color-row">Ground color <input type="color" value={settings.floor.color} onChange={(event) => onChange((current) => ({ ...current, floor: { ...current.floor, color: event.target.value } }))}/></label>}
      <label className="studio-check-row"><input type="checkbox" checked={settings.shadows} onChange={(event) => update({ shadows: event.target.checked })}/> Contact shadows</label>
    </div></details>
    <details className="inspector-group" open={selectedGroup === "lighting"}><summary className="inspector-summary">Lighting rig</summary><div className="inspector-content">
      <label className="studio-light-slider">Ambient fill <b>{settings.ambient.toFixed(2)}</b><input type="range" min="0" max="3" step="0.05" value={settings.ambient} onChange={(event) => update({ ambient: Number(event.target.value) })}/></label>
      {(["key", "fill", "rim"] as const).map((name) => <div className="inspector-light" key={name}>
        <label className="studio-check-row"><input type="checkbox" checked={settings.lights[name].enabled} onChange={(event) => onChange((current) => ({ ...current, lights: { ...current.lights, [name]: { ...current.lights[name], enabled: event.target.checked } } }))}/>{name[0].toUpperCase() + name.slice(1)} light</label>
        <div className="inspector-light-controls"><input aria-label={`${name} intensity`} type="range" min="0" max="3" step="0.05" value={settings.lights[name].intensity} onChange={(event) => onChange((current) => ({ ...current, lights: { ...current.lights, [name]: { ...current.lights[name], intensity: Number(event.target.value) } } }))}/><input type="color" aria-label={`${name} color`} value={settings.lights[name].color} onChange={(event) => onChange((current) => ({ ...current, lights: { ...current.lights, [name]: { ...current.lights[name], color: event.target.value } } }))}/></div>
      </div>)}
    </div></details>
    <details className="inspector-group" open={selectedGroup === "surface"}><summary className="inspector-summary">Model & surface</summary><div className="inspector-content">
      <label className="studio-check-row"><input type="checkbox" checked={settings.showModel} onChange={(event) => update({ showModel: event.target.checked })}/> Show packaging model</label>
      <label className="studio-select-label">Material preview<select value={settings.material} onChange={(event) => update({ material: event.target.value as SceneSettings["material"] })}><option value="board">Folding board · natural</option><option value="matte">Matte</option><option value="satin">Satin</option><option value="metallic">Metallic</option></select></label>
      <p className="studio-hint">Visual appearance is illustrative only—not a color proof or manufacturing guarantee.</p>
    </div></details>
    <details className="inspector-group" open={selectedGroup === "production"}><summary className="inspector-summary">Production overlays</summary><div className="inspector-content">
      {([["showCutLines", "Cut outline"], ["showFoldLines", "Fold / crease lines"], ["showProductionDimensions", "Measurements"]] as const).map(([key, label]) => <label className="studio-check-row" key={key}><input type="checkbox" checked={settings[key]} onChange={(event) => update({ [key]: event.target.checked } as Partial<SceneSettings>)}/>{label}</label>)}
      <p className="studio-hint">Display-only controls; production exports keep all cut and fold geometry.</p>
    </div></details>
    {(selectedSide || selectedItem.startsWith("side:")) && <details className="inspector-group" open={selectedGroup === "artwork"}><summary className="inspector-summary">Artwork source & face</summary><div className="inspector-content">
      <div className="studio-face-switch"><button type="button" className={activeSide === "outside" ? "active" : ""} onClick={() => onChangeActiveSide("outside")}>Outside</button><button type="button" className={activeSide === "inside" ? "active" : ""} onClick={() => onChangeActiveSide("inside")}>Inside</button></div>
      <p className="studio-hint">Show/hide and lock controls live beside each artwork item in the Scene tree. The Artwork view retains image replacement and crop tools.</p>
    </div></details>}
  </aside>;
}
