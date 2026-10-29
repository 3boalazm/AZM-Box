import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type * as THREE from "three";
import "./App.css";
import Sidebar from "./components/Sidebar";
import ArtworkPanel from "./components/ArtworkPanel";
import ExportBar from "./components/ExportBar";
import { BOX_STYLES, getBoxStyle } from "./geometry/boxBuilders";
import { computeFlatLayout } from "./geometry/layout";
import type { BoxDimensions, BoxStyleId } from "./geometry/types";
import { transferDimensionsToTemplate } from "./geometry/templateDimensions";
import { emptyArtwork } from "./artwork/types";
import { serializeProject, parseProject, PROJECT_EXTENSION } from "./project/projectFile";
import { downloadBlob } from "./lib/files";
import { preserveSheetRegistration } from "./artwork/rootAnchoring";
import { DEFAULT_SCENE_SETTINGS } from "./project/sceneSettings";
import type { SceneSettings } from "./project/sceneSettings";
import Icon from "./components/Icon";

const Fold3D = lazy(() => import("./components/Fold3D"));
const DielineEditor = lazy(() => import("./components/DielineEditor"));

export default function App() {
  const [boxStyleId, setBoxStyleId] = useState<BoxStyleId>("tuck-end");
  const [dims, setDims] = useState<BoxDimensions>(BOX_STYLES[0].defaultDimensions);
  const [templateMemory, setTemplateMemory] = useState<Partial<Record<BoxStyleId, BoxDimensions>>>(() => ({
    [BOX_STYLES[0].id]: { ...BOX_STYLES[0].defaultDimensions },
  }));
  const [autosaveStatus, setAutosaveStatus] = useState<"saving" | "saved" | "error">("saving");
  const [artwork, setArtwork] = useState(emptyArtwork());
  const [activeSide, setActiveSide] = useState<"outside" | "inside">("outside");
  const [selectedPanelId, setSelectedPanelId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"2d" | "3d">("2d");
  const [foldAmount, setFoldAmount] = useState(1);
  const [sceneSettings, setSceneSettings] = useState<SceneSettings>({ ...DEFAULT_SCENE_SETTINGS });
  const [showDimensions, setShowDimensions] = useState(false);
  const [lockTemplate, setLockTemplate] = useState(false);
  const [historyVersion, setHistoryVersion] = useState(0);

  const sceneRef = useRef<THREE.Group | null>(null);
  const sceneCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const transparentSceneExportRef = useRef<(() => Promise<Blob>) | null>(null);
  const skipNextArtworkAnchorAdjust = useRef(false);
  const restorePromptHandled = useRef(false);
  const foldAnimationRef = useRef<number | null>(null);

  const animateFoldTo = (target: number) => {
    if (foldAnimationRef.current !== null) cancelAnimationFrame(foldAnimationRef.current);
    const from = foldAmount;
    const startedAt = performance.now();
    const duration = 650;
    const step = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - (1 - progress) ** 3;
      setFoldAmount(from + (target - from) * eased);
      if (progress < 1) foldAnimationRef.current = requestAnimationFrame(step);
      else foldAnimationRef.current = null;
    };
    foldAnimationRef.current = requestAnimationFrame(step);
  };

  const setFoldFromSlider = (value: number) => {
    if (foldAnimationRef.current !== null) cancelAnimationFrame(foldAnimationRef.current);
    foldAnimationRef.current = null;
    setFoldAmount(value);
  };

  useEffect(() => () => {
    if (foldAnimationRef.current !== null) cancelAnimationFrame(foldAnimationRef.current);
  }, []);

  const root = useMemo(() => getBoxStyle(boxStyleId).build(dims), [boxStyleId, dims]);
  const layout = useMemo(() => computeFlatLayout(root), [root]);

  // Keep the uploaded full-sheet artwork registered to the root/body panel when
  // dieline bounds change (for example, when a flap gets deeper). The layout
  // recenters itself as its extents grow; without this offset correction the
  // artwork appears to slide even though its own size did not change.
  const rootPanel = layout.panels[0];
  const previousRootAnchor = useRef({ x: rootPanel.min[0], y: rootPanel.max[1] });
  useEffect(() => {
    const previous = previousRootAnchor.current;
    const next = { x: rootPanel.min[0], y: rootPanel.max[1] };
    previousRootAnchor.current = next;
    if (skipNextArtworkAnchorAdjust.current) {
      skipNextArtworkAnchorAdjust.current = false;
      return;
    }
    const dx = next.x - previous.x;
    const dy = next.y - previous.y;
    if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return;
    setArtwork((current) => ({
      ...current,
      outside: { ...current.outside, sheetOffset: preserveSheetRegistration(current.outside.sheetOffset, previous, next) },
      inside: { ...current.inside, sheetOffset: preserveSheetRegistration(current.inside.sheetOffset, previous, next) },
    }));
  }, [layout, rootPanel.max, rootPanel.min]);
  useEffect(() => {
    // If a project/style reset changed artwork but not the geometry anchor,
    // release the one-shot skip so the next real flap edit is still compensated.
    if (skipNextArtworkAnchorAdjust.current) skipNextArtworkAnchorAdjust.current = false;
  }, [boxStyleId, dims]);

  // Clicking a panel flashes the sidebar control that governs it. The nonce makes
  // clicking the SAME panel again re-trigger the animation (a changing value is
  // what restarts it), and the face tells the sidebar which field to highlight.
  const [panelClickNonce, setPanelClickNonce] = useState(0);
  const selectedPanelFace = layout.panels.find((p) => p.id === selectedPanelId)?.face;

  const handleSelectPanel = (id: string | null) => {
    setSelectedPanelId(id);
    if (id) setPanelClickNonce((n) => n + 1);
  };

  const handleChangeStyle = (id: BoxStyleId) => {
    if (id === boxStyleId) return;
    const memory = { ...templateMemory, [boxStyleId]: { ...dims } };
    const remembered = memory[id];
    let nextDims: BoxDimensions;
    if (remembered) {
      nextDims = { ...remembered };
    } else {
      const keepCustom = window.confirm(
        "Keep the current flap and closure settings when switching templates? Choose OK to carry compatible custom values; choose Cancel to use the new template's flap/closure defaults. Length, width, and height are preserved either way. Settings that only apply to this template remain saved in its template memory.",
      );
      nextDims = transferDimensionsToTemplate(dims, getBoxStyle(id).defaultDimensions, keepCustom);
      memory[id] = { ...nextDims };
    }
    skipNextArtworkAnchorAdjust.current = true;
    setTemplateMemory(memory);
    setBoxStyleId(id);
    setDims(nextDims);
    setSceneSettings((current) => ({ ...current, cameraPose: null }));
    setSelectedPanelId(null);
  };

  const handleChangeDimensions = (next: BoxDimensions) => {
    setDims(next);
    setTemplateMemory((current) => ({ ...current, [boxStyleId]: { ...next } }));
    setSceneSettings((current) => ({ ...current, cameraPose: null }));
  };

  // ---- Undo / redo ---------------------------------------------------------
  // Snapshots of the whole DESIGN state (style + dims + artwork). Snapshots hold
  // object references, not copies — all updates here are immutable, so old
  // references stay valid and pushing one costs nothing even with megabytes of
  // embedded artwork. Rapid bursts (slider drags fire many changes per second)
  // collapse into ONE undo step: only the first change of a burst pushes the
  // pre-burst state; anything within 400ms of the previous change is skipped.
  type Snapshot = { boxStyleId: BoxStyleId; dims: BoxDimensions; artwork: ReturnType<typeof emptyArtwork> };
  const undoStack = useRef<Snapshot[]>([]);
  const redoStack = useRef<Snapshot[]>([]);
  const restoring = useRef(false);
  const lastEditAt = useRef(0);
  const prevSnap = useRef<Snapshot>({ boxStyleId, dims, artwork });

  useEffect(() => {
    const prev = prevSnap.current;
    if (prev.boxStyleId === boxStyleId && prev.dims === dims && prev.artwork === artwork) return;
    if (restoring.current) {
      restoring.current = false;
    } else {
      const now = Date.now();
      if (now - lastEditAt.current > 400) {
        undoStack.current.push(prev);
        if (undoStack.current.length > 50) undoStack.current.shift();
        redoStack.current = []; // a fresh edit invalidates the redo branch
      }
      lastEditAt.current = now;
    }
    prevSnap.current = { boxStyleId, dims, artwork };
    setHistoryVersion((version) => version + 1);
  }, [boxStyleId, dims, artwork]);

  const applySnapshot = (snap: Snapshot) => {
    restoring.current = true;
    skipNextArtworkAnchorAdjust.current = true;
    setBoxStyleId(snap.boxStyleId);
    setDims(snap.dims);
    setTemplateMemory((current) => ({ ...current, [snap.boxStyleId]: { ...snap.dims } }));
    setArtwork(snap.artwork);
    setSceneSettings((current) => ({ ...current, cameraPose: null }));
    setSelectedPanelId(null);
  };

  const undo = () => {
    const snap = undoStack.current.pop();
    if (!snap) return;
    redoStack.current.push(prevSnap.current);
    setHistoryVersion((version) => version + 1);
    applySnapshot(snap);
  };

  const redo = () => {
    const snap = redoStack.current.pop();
    if (!snap) return;
    undoStack.current.push(prevSnap.current);
    setHistoryVersion((version) => version + 1);
    applySnapshot(snap);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Never steal the shortcut from a focused text/number field — the browser's
      // own input-level undo is what the user expects there.
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- New / Save / Open project (.pbox) -----------------------------------
  // The whole design — box style, dimensions, and both sides' artwork with every
  // image embedded as a data URL — serializes to one JSON file and loads back.
  const openInputRef = useRef<HTMLInputElement>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  const newProject = () => {
    if (!window.confirm("Start a new project? The current design is discarded (you can still get it back with Undo).")) return;
    skipNextArtworkAnchorAdjust.current = true;
    setBoxStyleId(BOX_STYLES[0].id);
    setDims({ ...BOX_STYLES[0].defaultDimensions });
    setTemplateMemory({ [BOX_STYLES[0].id]: { ...BOX_STYLES[0].defaultDimensions } });
    setArtwork(emptyArtwork());
    setSelectedPanelId(null);
    setActiveSide("outside");
    setFoldAmount(1);
    setSceneSettings({ ...DEFAULT_SCENE_SETTINGS });
  };

  const saveProject = () => {
    const json = serializeProject(boxStyleId, dims, artwork, sceneSettings, templateMemory);
    const name = `${getBoxStyle(boxStyleId).label.replace(/\s+/g, "_")}_${new Date().toISOString().slice(0, 10)}${PROJECT_EXTENSION}`;
    downloadBlob(name, new Blob([json], { type: "application/json" }));
  };

  const openProject = async (file: File) => {
    try {
      const text = await file.text();
      const loaded = parseProject(text);
      skipNextArtworkAnchorAdjust.current = true;
      setBoxStyleId(loaded.boxStyleId);
      setDims(loaded.dims);
      setTemplateMemory({ ...loaded.templateMemory, [loaded.boxStyleId]: { ...loaded.dims } });
      setArtwork(loaded.artwork);
      setSceneSettings(loaded.scene);
      setSelectedPanelId(null);
      setActiveSide("outside");
    } catch (err) {
      alert(`Could not open project: ${(err as Error).message}`);
    } finally {
      // Allow re-opening the same file twice in a row.
      if (openInputRef.current) openInputRef.current.value = "";
    }
  };

  const style = getBoxStyle(boxStyleId);

  // Keep a recoverable local copy of the complete project. Large embedded artwork
  // can exceed browser storage quotas, so autosave is best-effort and never blocks editing.
  useEffect(() => {
    setAutosaveStatus("saving");
    const timer = window.setTimeout(() => {
      try {
        window.localStorage.setItem("azm-box:autosave", serializeProject(boxStyleId, dims, artwork, sceneSettings, templateMemory));
        setAutosaveStatus("saved");
      } catch (error) {
        console.warn("AZM-Box autosave could not be written (browser storage may be full).", error);
        setAutosaveStatus("error");
      }
    }, 600);
    return () => window.clearTimeout(timer);
  }, [artwork, boxStyleId, dims, sceneSettings, templateMemory]);

  useEffect(() => {
    if (restorePromptHandled.current) return;
    restorePromptHandled.current = true;
    try {
      const saved = window.localStorage.getItem("azm-box:autosave");
      if (!saved) return;
      const recovered = parseProject(saved);
      if (!window.confirm("Restore the most recent AZM-Box autosave?")) return;
      skipNextArtworkAnchorAdjust.current = true;
      setBoxStyleId(recovered.boxStyleId);
      setDims(recovered.dims);
      setTemplateMemory({ ...recovered.templateMemory, [recovered.boxStyleId]: { ...recovered.dims } });
      setArtwork(recovered.artwork);
      setSceneSettings(recovered.scene);
    } catch (error) {
      console.warn("The saved AZM-Box autosave could not be restored.", error);
    }
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <a className="brand-lockup" href="#workspace" aria-label="PackBox Studio home">
          <span className="brand-symbol"><Icon name="box"/></span>
          <span className="brand-name">PackBox <small>STUDIO</small></span>
        </a>
        <span className="header-rule" aria-hidden="true" />
        <div className="project-context"><span>PACKAGING DESIGN</span><strong>{style.label}</strong></div>

        <div className="header-spacer" />
        <div className="history-actions" data-history-version={historyVersion} aria-label="Edit history">
          <button type="button" className="header-icon-button" aria-label="Undo" title="Undo · Ctrl/⌘ Z" onClick={undo} disabled={!undoStack.current.length}><Icon name="undo"/></button>
          <button type="button" className="header-icon-button" aria-label="Redo" title="Redo · Ctrl/⌘ Shift Z" onClick={redo} disabled={!redoStack.current.length}><Icon name="redo"/></button>
        </div>
        <span className="header-rule" aria-hidden="true" />
        <div className="project-bar" aria-label="Project actions">
          <button type="button" className="header-action" onClick={newProject} title="Start a fresh project (undoable)."><Icon name="new"/><span>New</span></button>
          <button type="button" className="header-icon-button" onClick={() => openInputRef.current?.click()} title="Open a saved .pbox project." aria-label="Open project"><Icon name="open"/></button>
          <button type="button" className="header-icon-button" onClick={saveProject} title="Save this project as a .pbox file." aria-label="Save project"><Icon name="save"/></button>
          <span className={`autosave-status ${autosaveStatus}`} role="status" aria-live="polite" title={autosaveStatus === "error" ? "Autosave failed. Browser storage may be full; download a .pbox backup." : autosaveStatus === "saving" ? "Saving project locally…" : "Project saved locally."}>
            {autosaveStatus === "saving" ? "Saving…" : autosaveStatus === "error" ? "Not saved" : "Saved"}
          </span>
          <input ref={openInputRef} type="file" accept={PROJECT_EXTENSION} className="visually-hidden" onChange={(e) => e.target.files?.[0] && openProject(e.target.files[0])}/>
        </div>
        <span className="header-rule" aria-hidden="true" />
        <div className="tabs view-tabs" role="tablist" aria-label="Workspace view">
          <button id="view-2d" role="tab" aria-controls="workspace-canvas" aria-selected={activeTab === "2d"} className={activeTab === "2d" ? "active" : ""} onClick={() => setActiveTab("2d")}><Icon name="dieline"/><span>Dieline</span></button>
          <button id="view-3d" role="tab" aria-controls="workspace-canvas" aria-selected={activeTab === "3d"} className={activeTab === "3d" ? "active" : ""} onClick={() => setActiveTab("3d")}><Icon name="cube"/><span>3D Studio</span></button>
        </div>
        <div className="help-wrap">
          <button type="button" className="help-btn" aria-label="Keyboard and mouse shortcuts" title="Keyboard & mouse shortcuts" onClick={() => setHelpOpen((v) => !v)}><Icon name="help"/></button>
          {helpOpen && <div className="help-popover" role="dialog" aria-label="Keyboard shortcuts" onClick={(e) => e.stopPropagation()}>
            <div className="help-head"><strong>Keyboard shortcuts</strong><button type="button" className="icon-btn" aria-label="Close shortcuts" onClick={() => setHelpOpen(false)}><Icon name="close"/></button></div>
            <h4>General</h4><dl><dt>⌘Z / Ctrl+Z</dt><dd>Undo</dd><dt>⇧⌘Z / Ctrl+Shift+Z</dt><dd>Redo</dd></dl>
            <h4>2D editor</h4><dl><dt>Scroll</dt><dd>Zoom to cursor</dd><dt>Space + drag</dt><dd>Pan the canvas</dd><dt>Middle-drag</dt><dd>Pan the canvas</dd><dt>Shift + rotate</dt><dd>Snap to 45°</dd><dt>Drag a handle</dt><dd>Resize freely</dd><dt>Click a panel</dt><dd>Select it and reveal its settings</dd></dl>
            <h4>3D studio</h4><dl><dt>Left-drag</dt><dd>Orbit around the box</dd><dt>Right-drag</dt><dd>Pan the view</dd><dt>Scroll</dt><dd>Zoom in / out</dd></dl>
          </div>}
        </div>
        <ExportBar layout={layout} artwork={artwork} title={style.label.replace(/\s+/g, "_")} sceneRef={sceneRef} sceneCanvasRef={sceneCanvasRef} transparentSceneExportRef={transparentSceneExportRef} activeTab={activeTab}/>
      </header>

      <div className="body" id="workspace">
        <Sidebar
          boxStyleId={boxStyleId}
          dims={dims}
          onChangeStyle={handleChangeStyle}
          onChangeDims={handleChangeDimensions}
          highlightFace={selectedPanelFace}
          highlightNonce={panelClickNonce}
        />

        <main className="stage" id="workspace-canvas" role="tabpanel" tabIndex={0} aria-labelledby={activeTab === "2d" ? "view-2d" : "view-3d"}>
          {activeTab === "2d" ? (
            <div className="stage-scroll">
              <Suspense fallback={<div className="stage-loading">Loading 2D editor…</div>}>
              <DielineEditor
                layout={layout}
                side={artwork[activeSide]}
                pxPerMm={2.2}
                selectedPanelId={selectedPanelId}
                onSelectPanel={handleSelectPanel}
                onUpdateSide={(updater) => setArtwork((a) => ({ ...a, [activeSide]: updater(a[activeSide]) }))}
                showDimensions={showDimensions}
                onToggleDimensions={setShowDimensions}
                lockTemplate={lockTemplate}
                onToggleLockTemplate={setLockTemplate}
              />
              </Suspense>
            </div>
          ) : (
            <div className="stage-3d">
              <Suspense fallback={<div className="stage-loading">Loading 3D studio…</div>}>
                <Fold3D root={root} dims={dims} layout={layout} artwork={artwork} showDimensions={showDimensions} foldAmount={foldAmount} sceneSettings={sceneSettings} onChangeSceneSettings={setSceneSettings} onTransparentExportReady={(capture) => (transparentSceneExportRef.current = capture)} onSceneReady={(g) => (sceneRef.current = g)} onCanvasReady={(canvas) => (sceneCanvasRef.current = canvas)} />
              </Suspense>
              <div className="fold-slider" aria-label="3D box folding controls">
                <div className="fold-progress">
                  <strong>Box folding</strong>
                  <span>{Math.round(foldAmount * 100)}% folded</span>
                </div>
                <div className="fold-range">
                  <span>Flat</span>
                  <input
                    aria-label="Fold box"
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={foldAmount}
                    onChange={(e) => setFoldFromSlider(Number(e.target.value))}
                  />
                  <span>Closed</span>
                </div>
                <button
                  type="button"
                  className="fold-action"
                  onClick={() => animateFoldTo(foldAmount >= 1 ? 0 : 1)}
                >
                  {foldAmount >= 1 ? "Unfold" : "Close box"}
                </button>
                <label className="dim-toggle" title="Prints each panel's width x height right on its face.">
                  <input type="checkbox" checked={showDimensions} onChange={(e) => setShowDimensions(e.target.checked)} />
                  Measurements
                </label>
              </div>
            </div>
          )}
        </main>

        <ArtworkPanel
          layout={layout}
          artwork={artwork}
          activeSide={activeSide}
          onChangeActiveSide={setActiveSide}
          selectedPanelId={selectedPanelId}
          onUpdateArtwork={setArtwork}
        />
      </div>
    </div>
  );
}
