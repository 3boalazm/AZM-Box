import type { SceneSettings, CameraPreset, CameraPose, MaterialParams, Vec3 } from "../project/sceneSettings";
import { applyMaterialPreset } from "../project/sceneSettings";
import type { DielineLayout } from "../geometry/types";
import NumField from "./NumField";
import { useT } from "../lib/i18n";

interface Props { settings: SceneSettings; onChange: React.Dispatch<React.SetStateAction<SceneSettings>>; selectedItem: string; layout: DielineLayout; selectedPanelId: string | null; }
const cameraPresets: { id: CameraPreset; label: string }[] = [{ id: "front", label: "Front" }, { id: "back", label: "Back" }, { id: "left", label: "Left" }, { id: "right", label: "Right" }, { id: "top", label: "Top" }, { id: "iso", label: "Iso" }];
const AXES = ["X", "Y", "Z"] as const;
const FALLBACK_POSE: CameraPose = { position: [260, 220, 320], target: [0, 0, 0], up: [0, 1, 0] };
const toDeg = (rad: number) => (rad * 180) / Math.PI;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Three typed X / Y / Z inputs for one vector. */
function VectorFields({ label, value, onChange, step = 1, unit, decimals = 1 }: { label: string; value: Vec3; onChange: (next: Vec3) => void; step?: number; unit?: string; decimals?: number }) {
  const t = useT();
  return <fieldset className="num-group">
    <legend>{t(label)}{unit && <small>{unit}</small>}</legend>
    <div className="num-grid">
      {AXES.map((axis, index) => <NumField key={axis} label={axis} value={value[index]} step={step} decimals={decimals} onChange={(n) => onChange(value.map((v, i) => (i === index ? n : v)) as Vec3)} />)}
    </div>
  </fieldset>;
}

export default function StudioInspector({ settings, onChange, selectedItem, layout, selectedPanelId }: Props) {
  const t = useT();
  const update = (patch: Partial<SceneSettings>) => onChange((current) => ({ ...current, ...patch }));
  const selectedPanel = layout.panels.find((panel) => panel.id === selectedPanelId);
  const selectedName = selectedItem.startsWith("model-panel:") ? selectedPanel?.name ?? "Panel face" : selectedItem.startsWith("light:") ? `${selectedItem.slice(6)} light` : selectedItem.startsWith("production:") ? "Production / dieline" : selectedItem.startsWith("artwork:") || selectedItem.startsWith("sheet:") || selectedItem.startsWith("panel:") ? "Artwork layer" : selectedItem === "scene:floor" ? "Ground plane" : "Packaging model";

  const pose = settings.cameraPose ?? FALLBACK_POSE;
  const setPose = (patch: Partial<CameraPose>) => update({ cameraPose: { ...pose, ...patch } });
  // Orbit coordinates: distance / azimuth / elevation of the camera around its target.
  const offset = [pose.position[0] - pose.target[0], pose.position[1] - pose.target[1], pose.position[2] - pose.target[2]];
  const distance = Math.hypot(offset[0], offset[1], offset[2]) || 1;
  const elevation = toDeg(Math.asin(Math.max(-1, Math.min(1, offset[1] / distance))));
  const azimuth = toDeg(Math.atan2(offset[0], offset[2]));
  const setOrbit = (next: { distance?: number; azimuth?: number; elevation?: number }) => {
    const d = next.distance ?? distance;
    const el = toRad(next.elevation ?? elevation);
    const az = toRad(next.azimuth ?? azimuth);
    setPose({ position: [pose.target[0] + d * Math.cos(el) * Math.sin(az), pose.target[1] + d * Math.sin(el), pose.target[2] + d * Math.cos(el) * Math.cos(az)] });
  };

  const setLight = (name: "key" | "fill" | "rim", patch: Partial<SceneSettings["lights"]["key"]>) =>
    onChange((current) => ({ ...current, lights: { ...current.lights, [name]: { ...current.lights[name], ...patch } } }));
  const material = settings.materialParams;
  const setMaterial = (patch: Partial<MaterialParams>) => update({ material: "custom", materialParams: { ...material, ...patch } });

  return <aside className="studio-inspector panel" aria-label="Studio properties">
    <header className="studio-inspector-heading"><span className="eyebrow">{t("PROPERTIES")}</span><h2>{selectedName}</h2><p>{t("Preview controls · saved with this project")}</p></header>
    {selectedItem.startsWith("model-panel:") && selectedPanel && <div className="studio-context-card"><strong>{selectedPanel.name}</strong><span>{selectedPanel.w.toFixed(1)} × {selectedPanel.h.toFixed(1)} mm</span><small>Panel selection is linked to the 2D dieline and artwork inspector.</small></div>}
    {selectedItem.startsWith("production:") && <div className="studio-context-card"><strong>Screen visibility only</strong><small>Hiding cut, fold or measurement overlays here does not remove production geometry from SVG, DXF or PDF exports.</small></div>}
    {(selectedItem.startsWith("artwork:") || selectedItem.startsWith("sheet:") || selectedItem.startsWith("panel:")) && <div className="studio-context-card"><strong>Artwork remains intact</strong><small>Visibility is a preview setting. Original image data, placement, crop and the opposite face remain stored in the project and production artwork exports.</small></div>}

    <details className="inspector-group" open><summary className="inspector-summary">{t("Camera & framing")}</summary><div className="inspector-content">
      <span className="studio-label">{t("Orthographic views")}</span><div className="studio-angle-grid">{cameraPresets.map((item) => <button key={item.id} type="button" className={settings.preset === item.id ? "selected" : ""} onClick={() => onChange((current) => ({ ...current, preset: item.id, cameraPose: null }))}>{t(item.label)}</button>)}</div>
      <VectorFields label="Position" unit="mm" value={pose.position} onChange={(position) => setPose({ position })} />
      <VectorFields label="Look-at target" unit="mm" value={pose.target} onChange={(target) => setPose({ target })} />
      <fieldset className="num-group"><legend>{t("Orbit")}</legend><div className="num-grid">
        <NumField label="Distance" value={distance} step={5} min={5} max={20000} decimals={0} onChange={(n) => setOrbit({ distance: n })} />
        <NumField label="Azimuth" unit="°" value={azimuth} step={1} min={-180} max={180} decimals={1} onChange={(n) => setOrbit({ azimuth: n })} />
        <NumField label="Elevation" unit="°" value={elevation} step={1} min={-89} max={89} decimals={1} onChange={(n) => setOrbit({ elevation: n })} />
      </div></fieldset>
      <NumField label="Field of view" unit="°" value={settings.fov} step={1} min={10} max={100} decimals={0} slider onChange={(n) => update({ fov: n })} />
      <p className="studio-hint">{t("Type exact values, or drag to orbit · right-drag to pan · scroll to zoom. ↑/↓ nudge a field; Shift ×10, Alt ×0.1.")}</p>
    </div></details>

    <details className="inspector-group" open><summary className="inspector-summary">{t("Model transform")}</summary><div className="inspector-content">
      <VectorFields label="Rotation" unit="°" value={settings.modelRotation} step={5} onChange={(modelRotation) => update({ modelRotation })} />
      <VectorFields label="Position offset" unit="mm" value={settings.modelOffset} onChange={(modelOffset) => update({ modelOffset })} />
      <label className="studio-check-row"><input type="checkbox" checked={settings.turntable} onChange={(event) => update({ turntable: event.target.checked })}/> {t("Turntable (slow spin)")}</label>
      <button type="button" className="subtle-action" onClick={() => update({ modelRotation: [0, 0, 0], modelOffset: [0, 0, 0], turntable: false })}>{t("Reset transform")}</button>
    </div></details>

    <details className="inspector-group" open><summary className="inspector-summary">{t("Environment & background")}</summary><div className="inspector-content">
      <label className="studio-select-label">{t("Environment preset")}<select value={settings.environment} onChange={(event) => { const environment = event.target.value as SceneSettings["environment"]; onChange((current) => ({ ...current, environment, background: environment === "studio" ? "#e9e6df" : environment === "soft" ? "#f5f3ed" : "#dce4ec" })); }}><option value="studio">{t("Warm studio")}</option><option value="soft">{t("Soft white")}</option><option value="neutral">{t("Cool neutral")}</option></select></label>
      <label className="studio-color-row">{t("Custom background")} <input type="color" value={settings.background} onChange={(event) => update({ background: event.target.value })}/></label>
      <label className="studio-check-row"><input type="checkbox" checked={settings.transparentBackground} onChange={(event) => update({ transparentBackground: event.target.checked })}/> {t("Transparent backdrop")}</label>
      <label className="studio-check-row"><input type="checkbox" checked={settings.floor.visible} onChange={(event) => onChange((current) => ({ ...current, floor: { ...current.floor, visible: event.target.checked } }))}/> {t("Ground plane")}</label>
      {settings.floor.visible && <label className="studio-color-row">{t("Ground color")} <input type="color" value={settings.floor.color} onChange={(event) => onChange((current) => ({ ...current, floor: { ...current.floor, color: event.target.value } }))}/></label>}
      <label className="studio-check-row"><input type="checkbox" checked={settings.shadows} onChange={(event) => update({ shadows: event.target.checked })}/> {t("Contact shadows")}</label>
    </div></details>

    <details className="inspector-group" open><summary className="inspector-summary">{t("Lighting rig")}</summary><div className="inspector-content">
      <NumField label="Exposure" value={settings.exposure} step={0.05} min={0.1} max={4} decimals={2} slider onChange={(n) => update({ exposure: n })} />
      <NumField label="Studio reflections" value={settings.envLight} step={0.05} min={0} max={3} decimals={2} slider onChange={(n) => update({ envLight: n })} />
      <NumField label="Ambient fill" value={settings.ambient} step={0.05} min={0} max={3} decimals={2} slider onChange={(n) => update({ ambient: n })} />
      {(["key", "fill", "rim"] as const).map((name) => <div className="inspector-light" key={name}>
        <label className="studio-check-row"><input type="checkbox" checked={settings.lights[name].enabled} onChange={(event) => setLight(name, { enabled: event.target.checked })}/>{name[0].toUpperCase() + name.slice(1)} light<input className="light-color" type="color" aria-label={`${name} color`} value={settings.lights[name].color} onChange={(event) => setLight(name, { color: event.target.value })}/></label>
        {settings.lights[name].enabled && <>
          <NumField label="Intensity" value={settings.lights[name].intensity} step={0.05} min={0} max={5} decimals={2} slider onChange={(n) => setLight(name, { intensity: n })} />
          <VectorFields label="Position" unit="mm" value={settings.lights[name].position} step={10} decimals={0} onChange={(position) => setLight(name, { position })} />
        </>}
      </div>)}
    </div></details>

    <details className="inspector-group" open><summary className="inspector-summary">{t("Surface appearance")}</summary><div className="inspector-content">
      <label className="studio-select-label">{t("Material preset")}<select value={settings.material} onChange={(event) => update(applyMaterialPreset(event.target.value as SceneSettings["material"]))}>
        <option value="board">{t("Folding board · natural")}</option><option value="matte">{t("Matte")}</option><option value="satin">{t("Satin")}</option><option value="metallic">{t("Metallic")}</option><option value="gloss">{t("Gloss varnish")}</option><option value="kraft">{t("Kraft")}</option><option value="softtouch">{t("Soft-touch")}</option><option value="custom">{t("Custom")}</option>
      </select></label>
      <NumField label="Roughness" value={material.roughness} step={0.02} min={0} max={1} decimals={2} slider onChange={(n) => setMaterial({ roughness: n })} />
      <NumField label="Metalness" value={material.metalness} step={0.02} min={0} max={1} decimals={2} slider onChange={(n) => setMaterial({ metalness: n })} />
      <NumField label="Gloss coat" value={material.clearcoat} step={0.05} min={0} max={1} decimals={2} slider onChange={(n) => setMaterial({ clearcoat: n })} />
      {material.clearcoat > 0 && <NumField label="Coat roughness" value={material.clearcoatRoughness} step={0.02} min={0} max={1} decimals={2} slider onChange={(n) => setMaterial({ clearcoatRoughness: n })} />}
      <label className="studio-select-label">{t("Surface texture")}<select value={material.texture} onChange={(event) => setMaterial({ texture: event.target.value as MaterialParams["texture"] })}><option value="none">{t("Smooth")}</option><option value="grain">{t("Fine grain")}</option><option value="linen">{t("Linen weave")}</option><option value="fibre">{t("Recycled fibre")}</option></select></label>
      {material.texture !== "none" && <>
        <NumField label="Texture strength" value={material.textureStrength} step={0.05} min={0} max={3} decimals={2} slider onChange={(n) => setMaterial({ textureStrength: n })} />
        <NumField label="Texture tile" unit="mm" value={material.textureScale} step={1} min={2} max={500} decimals={0} slider onChange={(n) => setMaterial({ textureScale: n })} />
      </>}
      <label className="studio-color-row">{t("Board tint over artwork")} <input type="color" value={material.tint} onChange={(event) => setMaterial({ tint: event.target.value })}/></label>
      <label className="studio-color-row">{t("Blank outside colour")} <input type="color" value={material.boardColor} onChange={(event) => setMaterial({ boardColor: event.target.value })}/></label>
      <label className="studio-color-row">{t("Blank inside colour")} <input type="color" value={material.insideColor} onChange={(event) => setMaterial({ insideColor: event.target.value })}/></label>
      <p className="studio-hint">{t("Visual appearance is illustrative only. It is not a color proof or a guarantee of print or manufacturing results.")}</p>
    </div></details>
  </aside>;
}
