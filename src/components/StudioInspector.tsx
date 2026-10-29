import type { SceneSettings, CameraPreset } from "../project/sceneSettings";
import type { DielineLayout } from "../geometry/types";

interface Props { settings: SceneSettings; onChange: React.Dispatch<React.SetStateAction<SceneSettings>>; selectedItem: string; layout: DielineLayout; selectedPanelId: string | null; }
const cameraPresets: { id: CameraPreset; label: string }[] = [{ id: "front", label: "Front" }, { id: "back", label: "Back" }, { id: "left", label: "Left" }, { id: "right", label: "Right" }, { id: "top", label: "Top" }, { id: "iso", label: "Iso" }];

export default function StudioInspector({ settings, onChange, selectedItem, layout, selectedPanelId }: Props) {
  const update = (patch: Partial<SceneSettings>) => onChange((current) => ({ ...current, ...patch }));
  const selectedPanel = layout.panels.find((panel) => panel.id === selectedPanelId);
  const selectedName = selectedItem.startsWith("model-panel:") ? selectedPanel?.name ?? "Panel face" : selectedItem.startsWith("light:") ? `${selectedItem.slice(6)} light` : selectedItem.startsWith("production:") ? "Production / dieline" : selectedItem.startsWith("artwork:") || selectedItem.startsWith("sheet:") || selectedItem.startsWith("panel:") ? "Artwork layer" : selectedItem === "scene:floor" ? "Ground plane" : "Packaging model";
  return <aside className="studio-inspector panel" aria-label="Studio properties">
    <header className="studio-inspector-heading"><span className="eyebrow">PROPERTIES</span><h2>{selectedName}</h2><p>Preview controls · saved with this project</p></header>
    {selectedItem.startsWith("model-panel:") && selectedPanel && <div className="studio-context-card"><strong>{selectedPanel.name}</strong><span>{selectedPanel.w.toFixed(1)} × {selectedPanel.h.toFixed(1)} mm</span><small>Panel selection is linked to the 2D dieline and artwork inspector.</small></div>}
    {selectedItem.startsWith("production:") && <div className="studio-context-card"><strong>Screen visibility only</strong><small>Hiding cut, fold or measurement overlays here does not remove production geometry from SVG, DXF or PDF exports.</small></div>}
    {(selectedItem.startsWith("artwork:") || selectedItem.startsWith("sheet:") || selectedItem.startsWith("panel:")) && <div className="studio-context-card"><strong>Artwork remains intact</strong><small>Visibility is a preview setting. Original image data, placement, crop and the opposite face remain stored in the project and production artwork exports.</small></div>}
    <details className="inspector-group" open><summary className="inspector-summary">Camera & framing</summary><div className="inspector-content">
      <span className="studio-label">Orthographic views</span><div className="studio-angle-grid">{cameraPresets.map((item) => <button key={item.id} type="button" className={settings.preset === item.id ? "selected" : ""} onClick={() => onChange((current) => ({ ...current, preset: item.id, cameraPose: null }))}>{item.label}</button>)}</div>
      <p className="studio-hint">Drag to orbit · right-drag to pan · scroll to zoom. Camera position is stored in the project file.</p>
    </div></details>
    <details className="inspector-group" open><summary className="inspector-summary">Environment & background</summary><div className="inspector-content">
      <label className="studio-select-label">Environment preset<select value={settings.environment} onChange={(event) => { const environment = event.target.value as SceneSettings["environment"]; onChange((current) => ({ ...current, environment, background: environment === "studio" ? "#e9e6df" : environment === "soft" ? "#f5f3ed" : "#dce4ec" })); }}><option value="studio">Warm studio</option><option value="soft">Soft white</option><option value="neutral">Cool neutral</option></select></label>
      <label className="studio-color-row">Custom background <input type="color" value={settings.background} onChange={(event) => update({ background: event.target.value })}/></label>
      <label className="studio-check-row"><input type="checkbox" checked={settings.transparentBackground} onChange={(event) => update({ transparentBackground: event.target.checked })}/> Transparent backdrop</label>
      <label className="studio-check-row"><input type="checkbox" checked={settings.floor.visible} onChange={(event) => onChange((current) => ({ ...current, floor: { ...current.floor, visible: event.target.checked } }))}/> Ground plane</label>
      {settings.floor.visible && <label className="studio-color-row">Ground color <input type="color" value={settings.floor.color} onChange={(event) => onChange((current) => ({ ...current, floor: { ...current.floor, color: event.target.value } }))}/></label>}
      <label className="studio-check-row"><input type="checkbox" checked={settings.shadows} onChange={(event) => update({ shadows: event.target.checked })}/> Contact shadows</label>
    </div></details>
    <details className="inspector-group" open><summary className="inspector-summary">Lighting rig</summary><div className="inspector-content">
      <label className="studio-light-slider">Ambient fill <b>{settings.ambient.toFixed(2)}</b><input type="range" min="0" max="3" step="0.05" value={settings.ambient} onChange={(event) => update({ ambient: Number(event.target.value) })}/></label>
      {(["key", "fill", "rim"] as const).map((name) => <div className="inspector-light" key={name}>
        <label className="studio-check-row"><input type="checkbox" checked={settings.lights[name].enabled} onChange={(event) => onChange((current) => ({ ...current, lights: { ...current.lights, [name]: { ...current.lights[name], enabled: event.target.checked } } }))}/>{name[0].toUpperCase() + name.slice(1)} light</label>
        <div className="inspector-light-controls"><input aria-label={`${name} intensity`} type="range" min="0" max="3" step="0.05" value={settings.lights[name].intensity} onChange={(event) => onChange((current) => ({ ...current, lights: { ...current.lights, [name]: { ...current.lights[name], intensity: Number(event.target.value) } } }))}/><input type="color" aria-label={`${name} color`} value={settings.lights[name].color} onChange={(event) => onChange((current) => ({ ...current, lights: { ...current.lights, [name]: { ...current.lights[name], color: event.target.value } } }))}/></div>
      </div>)}
    </div></details>
    <details className="inspector-group" open><summary className="inspector-summary">Surface appearance</summary><div className="inspector-content">
      <label className="studio-select-label">Material preview<select value={settings.material} onChange={(event) => update({ material: event.target.value as SceneSettings["material"] })}><option value="board">Folding board · natural</option><option value="matte">Matte</option><option value="satin">Satin</option><option value="metallic">Metallic</option></select></label>
      <p className="studio-hint">Visual appearance is illustrative only. It is not a color proof or a guarantee of print or manufacturing results.</p>
    </div></details>
  </aside>;
}
