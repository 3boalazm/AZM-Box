import type { ArtworkState, EditorLayer } from "../artwork/types";
import type { DielineLayout } from "../geometry/types";
import type { SceneSettings } from "../project/sceneSettings";

interface Props {
  artwork: ArtworkState;
  layout: DielineLayout;
  activeSide: "outside" | "inside";
  settings: SceneSettings;
  onChangeSettings: React.Dispatch<React.SetStateAction<SceneSettings>>;
  onChangeArtwork: React.Dispatch<React.SetStateAction<ArtworkState>>;
  onSelectSide: (side: "outside" | "inside") => void;
  onSelectLayer: (id: string | null) => void;
  onSelectPanel: (id: string | null) => void;
  selectedLayerId: string | null;
  selectedItem: string;
  selectedPanelId: string | null;
  onSelectItem: (id: string) => void;
}

function Eye({ visible }: { visible: boolean }) { return <span aria-hidden="true" className={`tree-eye${visible ? "" : " off"}`}>{visible ? "◉" : "○"}</span>; }

export default function StudioTree({ artwork, layout, activeSide, settings, onChangeSettings, onChangeArtwork, onSelectSide, onSelectLayer, onSelectPanel, selectedLayerId, selectedItem, selectedPanelId, onSelectItem }: Props) {
  const hidden = new Set(settings.hiddenLayerIds);
  const toggleVisibility = (id: string) => onChangeSettings((current) => ({
    ...current,
    hiddenLayerIds: current.hiddenLayerIds.includes(id) ? current.hiddenLayerIds.filter((value) => value !== id) : [...current.hiddenLayerIds, id],
  }));
  const isLocked = (id: string, legacyId?: string) => settings.lockedLayerIds.includes(id) || (!!legacyId && settings.lockedLayerIds.includes(legacyId));
  const toggleLock = (id: string, legacyId?: string) => onChangeSettings((current) => {
    const locked = current.lockedLayerIds.includes(id) || (!!legacyId && current.lockedLayerIds.includes(legacyId));
    return { ...current, lockedLayerIds: locked ? current.lockedLayerIds.filter((value) => value !== id && value !== legacyId) : [...current.lockedLayerIds.filter((value) => value !== legacyId), id] };
  });
  const setFlag = (key: "showCutLines" | "showFoldLines" | "showProductionDimensions" | "showOutsideArtwork" | "showInsideArtwork" | "showModel") => onChangeSettings((current) => ({ ...current, [key]: !current[key] }));
  const duplicateLayer = (sideName: "outside" | "inside", layer: EditorLayer) => {
    const copy = { ...layer, id: `${layer.kind}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name: `${layer.name || (layer.kind === "text" ? layer.text : "Image")} copy`, x: layer.x + 5, y: layer.y + 5 } as EditorLayer;
    onChangeArtwork((current) => ({ ...current, [sideName]: { ...current[sideName], layers: [...current[sideName].layers, copy] } }));
  };
  const removeLayer = (sideName: "outside" | "inside", layerId: string) => {
    if (isLocked(`layer:${sideName}:${layerId}`, layerId)) return;
    onChangeArtwork((current) => ({ ...current, [sideName]: { ...current[sideName], layers: current[sideName].layers.filter((layer) => layer.id !== layerId) } }));
  };
  const renameLayer = (sideName: "outside" | "inside", layer: EditorLayer) => {
    const name = window.prompt("Layer name", layer.name || (layer.kind === "text" ? layer.text : "Image layer"));
    if (name === null) return;
    onChangeArtwork((current) => ({ ...current, [sideName]: { ...current[sideName], layers: current[sideName].layers.map((item) => item.id === layer.id ? { ...item, name: name.trim().slice(0, 120) || "Untitled layer" } : item) } }));
  };
  const moveLayer = (sideName: "outside" | "inside", id: string, direction: -1 | 1) => onChangeArtwork((current) => {
    if (isLocked(`layer:${sideName}:${id}`, id)) return current;
    const layers = [...current[sideName].layers];
    const index = layers.findIndex((layer) => layer.id === id);
    const next = index + direction;
    if (index < 0 || next < 0 || next >= layers.length) return current;
    [layers[index], layers[next]] = [layers[next], layers[index]];
    return { ...current, [sideName]: { ...current[sideName], layers } };
  });
  const selectArtworkLayer = (sideName: "outside" | "inside", layerId: string) => {
    onSelectSide(sideName); onSelectLayer(layerId); onSelectItem(`artwork:${sideName}:${layerId}`);
  };

  const renameSheet = (sideName: "outside" | "inside") => {
    const name = window.prompt("Artwork name", artwork[sideName].sheetImageName || "Full-sheet artwork");
    if (name === null) return;
    onChangeArtwork((current) => ({ ...current, [sideName]: { ...current[sideName], sheetImageName: name.trim().slice(0, 200) || "Full-sheet artwork" } }));
  };
  const renamePanelImage = (sideName: "outside" | "inside", panelId: string) => {
    const panel = layout.panels.find((item) => item.id === panelId);
    const oldName = artwork[sideName].panelImageNames[panelId] || panel?.name || "Panel image";
    const name = window.prompt("Artwork name", oldName);
    if (name === null) return;
    onChangeArtwork((current) => ({ ...current, [sideName]: { ...current[sideName], panelImageNames: { ...current[sideName].panelImageNames, [panelId]: name.trim().slice(0, 200) || "Panel image" } } }));
  };
  const duplicatePanelImage = (sideName: "outside" | "inside", panelId: string) => {
    const source = artwork[sideName].panelImages[panelId];
    const panel = layout.panels.find((item) => item.id === panelId);
    if (!source || !panel) return;
    const id = `img-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const name = artwork[sideName].panelImageNames[panelId] || panel.name || "Panel image";
    const copy: EditorLayer = { id, name: `${name} copy`, kind: "image", panelId, x: 0, y: 0, width: panel.w, height: panel.h, src: source, rotation: 0 };
    onChangeArtwork((current) => ({ ...current, [sideName]: { ...current[sideName], layers: [...current[sideName].layers, copy] } }));
    onSelectSide(sideName); onSelectLayer(id); onSelectItem(`artwork:${sideName}:${id}`);
  };
  const removePanelImage = (sideName: "outside" | "inside", panelId: string) => onChangeArtwork((current) => {
    const panelImages = { ...current[sideName].panelImages };
    const panelImageNames = { ...current[sideName].panelImageNames };
    delete panelImages[panelId]; delete panelImageNames[panelId];
    return { ...current, [sideName]: { ...current[sideName], panelImages, panelImageNames } };
  });

  return <aside className="studio-tree panel" aria-label="Studio scene tree">
    <header className="studio-tree-heading"><span className="eyebrow">WORKSPACE</span><h2>Scene tree</h2><span className="tree-count">{layout.panels.length} faces</span></header>
    <details className="tree-group" open><summary><span className="tree-group-icon">▤</span> Artwork <small>{artwork.outside.layers.length + artwork.inside.layers.length + Object.keys(artwork.outside.panelImages).length + Object.keys(artwork.inside.panelImages).length + Number(!!artwork.outside.sheetImage) + Number(!!artwork.inside.sheetImage)}</small></summary>
      {(["outside", "inside"] as const).map((sideName) => {
        const side = artwork[sideName];
        const isSideVisible = sideName === "outside" ? settings.showOutsideArtwork : settings.showInsideArtwork;
        return <div className="tree-branch" key={sideName}>
          <div className={`tree-row${selectedItem === `side:${sideName}` ? " selected" : ""}`}>
            <button type="button" className="tree-item" onClick={() => { onSelectSide(sideName); onSelectItem(`side:${sideName}`); }}><span className="tree-kind">{sideName === "outside" ? "OUT" : "IN"}</span>{sideName === "outside" ? "Outside face" : "Inside face"}</button>
            <button type="button" className="tree-visibility" aria-label={`${isSideVisible ? "Hide" : "Show"} ${sideName} artwork`} onClick={() => setFlag(sideName === "outside" ? "showOutsideArtwork" : "showInsideArtwork")}><Eye visible={isSideVisible}/></button>
          </div>
          {side.sheetImage && <div className="tree-row tree-child">
            <button type="button" className={`tree-item${selectedItem === `sheet:${sideName}` ? " selected" : ""}`} onClick={() => { onSelectSide(sideName); onSelectLayer("__sheet__"); onSelectItem(`sheet:${sideName}`); }}><span className="tree-kind">IMG</span><span className="tree-label">{side.sheetImageName || "Full-sheet artwork"}</span></button>
            <button type="button" className="tree-visibility" aria-label={`${hidden.has(`sheet:${sideName}`) ? "Show" : "Hide"} full-sheet artwork`} onClick={() => toggleVisibility(`sheet:${sideName}`)}><Eye visible={!hidden.has(`sheet:${sideName}`)}/></button>
            <button type="button" className={`tree-visibility${isLocked(`sheet:${sideName}`) ? " locked" : ""}`} aria-label={`${isLocked(`sheet:${sideName}`) ? "Unlock" : "Lock"} full-sheet artwork`} onClick={() => toggleLock(`sheet:${sideName}`)}>{isLocked(`sheet:${sideName}`) ? "◆" : "◇"}</button>
            <details className="tree-more"><summary aria-label="Full-sheet artwork actions">···</summary><div role="group" aria-label="Full-sheet artwork actions"><button type="button" onClick={() => renameSheet(sideName)}>Rename</button><button type="button" className="danger" disabled={isLocked(`sheet:${sideName}`)} onClick={() => onChangeArtwork((current) => ({ ...current, [sideName]: { ...current[sideName], sheetImage: undefined, sheetImageName: undefined } }))}>Delete</button></div></details>
          </div>}
          {Object.entries(side.panelImages).map(([panelId]) => {
            const panel = layout.panels.find((item) => item.id === panelId);
            const id = `panel:${sideName}:${panelId}`;
            return <div className="tree-row tree-child" key={id}>
              <button type="button" className={`tree-item${selectedItem === id ? " selected" : ""}`} onClick={() => { onSelectSide(sideName); onSelectLayer(null); onSelectPanel(panelId); onSelectItem(id); }}><span className="tree-kind">IMG</span><span className="tree-label">{side.panelImageNames[panelId] || panel?.name || "Panel image"}</span></button>
              <button type="button" className="tree-visibility" aria-label={`${hidden.has(id) ? "Show" : "Hide"} ${panel?.name ?? "panel image"}`} onClick={() => toggleVisibility(id)}><Eye visible={!hidden.has(id)}/></button>
              <button type="button" className={`tree-visibility${isLocked(id) ? " locked" : ""}`} aria-label={`${isLocked(id) ? "Unlock" : "Lock"} ${panel?.name ?? "panel image"}`} onClick={() => toggleLock(id)}>{isLocked(id) ? "◆" : "◇"}</button>
              <details className="tree-more"><summary aria-label={`${panel?.name ?? "Panel image"} actions`}>···</summary><div role="group" aria-label={`${panel?.name ?? "Panel image"} actions`}><button type="button" onClick={() => renamePanelImage(sideName, panelId)}>Rename</button><button type="button" disabled={isLocked(id)} onClick={() => duplicatePanelImage(sideName, panelId)}>Duplicate as panel layer</button><button type="button" className="danger" disabled={isLocked(id)} onClick={() => removePanelImage(sideName, panelId)}>Delete</button></div></details>
            </div>;
          })}
          {side.layers.map((layer, index) => {
            const id = `layer:${sideName}:${layer.id}`;
            const label = layer.name || (layer.kind === "text" ? layer.text : "Image layer");
            const layerLocked = isLocked(`layer:${sideName}:${layer.id}`, layer.id);
            return <div className={`tree-row tree-child${selectedLayerId === layer.id && activeSide === sideName ? " selected" : ""}`} key={layer.id}>
              <button type="button" className="tree-item" onClick={() => selectArtworkLayer(sideName, layer.id)}><span className="tree-kind">{layer.kind === "text" ? "TXT" : "IMG"}</span><span className="tree-label">{label}</span></button>
              <button type="button" className="tree-visibility" aria-label={`${hidden.has(id) ? "Show" : "Hide"} ${label}`} onClick={() => toggleVisibility(id)}><Eye visible={!hidden.has(id)}/></button>
              <button type="button" className={`tree-visibility${isLocked(`layer:${sideName}:${layer.id}`, layer.id) ? " locked" : ""}`} aria-label={`${isLocked(`layer:${sideName}:${layer.id}`, layer.id) ? "Unlock" : "Lock"} ${label}`} title={isLocked(`layer:${sideName}:${layer.id}`, layer.id) ? "Unlock editing and movement" : "Lock editing and movement"} onClick={() => toggleLock(`layer:${sideName}:${layer.id}`, layer.id)}>{isLocked(`layer:${sideName}:${layer.id}`, layer.id) ? "◆" : "◇"}</button>
              <details className="tree-more"><summary aria-label={`Actions for ${label}`}>···</summary><div role="group" aria-label={`${label} actions`}>
                <button type="button" onClick={() => renameLayer(sideName, layer)}>Rename</button><button type="button" onClick={() => duplicateLayer(sideName, layer)}>Duplicate</button>
                <button type="button" disabled={layerLocked || index === 0} onClick={() => moveLayer(sideName, layer.id, -1)}>Move up</button><button type="button" disabled={layerLocked || index === side.layers.length - 1} onClick={() => moveLayer(sideName, layer.id, 1)}>Move down</button>
                <button type="button" className="danger" disabled={layerLocked} onClick={() => removeLayer(sideName, layer.id)}>Delete</button>
              </div></details>
            </div>;
          })}
        </div>;
      })}
    </details>
    <details className="tree-group" open><summary><span className="tree-group-icon">⌗</span> Production / dieline <small>2D only</small></summary>
      {([["showCutLines", "Cut outline"], ["showFoldLines", "Fold / crease lines"], ["showProductionDimensions", "Measurements"]] as const).map(([key, label]) => <div className="tree-row tree-child" key={key}><button type="button" className={`tree-item${selectedItem === `production:${key}` ? " selected" : ""}`} onClick={() => onSelectItem(`production:${key}`)}><span className="tree-kind">{key === "showCutLines" ? "CUT" : key === "showFoldLines" ? "FOLD" : "DIM"}</span>{label}</button><button type="button" className="tree-visibility" aria-label={`${settings[key] ? "Hide" : "Show"} ${label}`} onClick={() => setFlag(key)}><Eye visible={settings[key]}/></button></div>)}
    </details>
    <details className="tree-group" open><summary><span className="tree-group-icon">◈</span> 3D scene <small>{settings.preset.toUpperCase()}</small></summary>
      <div className={`tree-row${selectedItem === "scene:model" ? " selected" : ""}`}><button type="button" className="tree-item" onClick={() => onSelectItem("scene:model")}><span className="tree-kind">3D</span>Packaging model</button><button type="button" className="tree-visibility" aria-label={`${settings.showModel ? "Hide" : "Show"} packaging model`} onClick={() => setFlag("showModel")}><Eye visible={settings.showModel}/></button></div>
      {layout.panels.map((panel) => <div className={`tree-row tree-child${selectedPanelId === panel.id ? " selected" : ""}`} key={`model-panel:${panel.id}`}><button type="button" className="tree-item" onClick={() => { onSelectPanel(panel.id); onSelectItem(`model-panel:${panel.id}`); }}><span className="tree-kind">FACE</span><span className="tree-label">{panel.name}</span></button></div>)}
      {(["key", "fill", "rim"] as const).map((name) => <div className={`tree-row tree-child${selectedItem === `light:${name}` ? " selected" : ""}`} key={name}><button type="button" className="tree-item" onClick={() => onSelectItem(`light:${name}`)}><span className="tree-kind">LIT</span>{name[0].toUpperCase() + name.slice(1)} light</button><button type="button" className="tree-visibility" aria-label={`${settings.lights[name].enabled ? "Disable" : "Enable"} ${name} light`} onClick={() => onChangeSettings((current) => ({ ...current, lights: { ...current.lights, [name]: { ...current.lights[name], enabled: !current.lights[name].enabled } } }))}><Eye visible={settings.lights[name].enabled}/></button></div>)}
      <div className={`tree-row tree-child${selectedItem === "scene:floor" ? " selected" : ""}`}><button type="button" className="tree-item" onClick={() => onSelectItem("scene:floor")}><span className="tree-kind">FLR</span>Ground plane</button><button type="button" className="tree-visibility" aria-label={`${settings.floor.visible ? "Hide" : "Show"} ground plane`} onClick={() => onChangeSettings((current) => ({ ...current, floor: { ...current.floor, visible: !current.floor.visible } }))}><Eye visible={settings.floor.visible}/></button></div>
    </details>
  </aside>;
}
