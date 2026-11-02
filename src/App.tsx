import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type * as THREE from "three";
import "./App.css";
import Sidebar from "./components/Sidebar";
import ArtworkPanel from "./components/ArtworkPanel";
import StudioTree from "./components/StudioTree";
import StudioInspector from "./components/StudioInspector";
import ExportBar from "./components/ExportBar";
import { BOX_STYLES, getBoxStyle } from "./geometry/boxBuilders";
import { computeFlatLayout } from "./geometry/layout";
import type { BoxDimensions, BoxStyleId, HingeEdge } from "./geometry/types";
import { transferDimensionsToTemplate } from "./geometry/templateDimensions";
import { emptyArtwork } from "./artwork/types";
import { visibleArtwork } from "./artwork/layerVisibility";
import { serializeProject, parseProject, PROJECT_EXTENSION } from "./project/projectFile";
import { downloadBlob } from "./lib/files";
import { preserveSheetRegistration } from "./artwork/rootAnchoring";
import { DEFAULT_SCENE_SETTINGS } from "./project/sceneSettings";
import type { SceneSettings } from "./project/sceneSettings";
import Icon from "./components/Icon";
import { useFeedback } from "./components/Feedback";
import { placeSheetImage } from "./artwork/placeSheetImage";
import { isSvgFile, readArtworkFile } from "./artwork/svgArt";
import { addFace, faceRemovalLoss, freeFaceEdges, removeFace } from "./geometry/panelEdits";
import StartScreen from "./components/StartScreen";
import { addRecent } from "./lib/recentProjects";
import type { RecentProject } from "./lib/recentProjects";
import { setPreferences, usePreferences } from "./lib/preferences";
import { useT } from "./lib/i18n";

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
  const [faceEditing, setFaceEditing] = useState(true);
  const [selectedArtworkLayerId, setSelectedArtworkLayerId] = useState<string | null>(null);
  const [selectedStudioItem, setSelectedStudioItem] = useState("scene:model");
  const [activeTab, setActiveTab] = useState<"2d" | "3d">("2d");
  const [foldAmount, setFoldAmount] = useState(1);
  const [sceneSettings, setSceneSettings] = useState<SceneSettings>({ ...DEFAULT_SCENE_SETTINGS });
  const [showDimensions, setShowDimensions] = useState(false);
  const [lockTemplate, setLockTemplate] = useState(false);
  const [historyVersion, setHistoryVersion] = useState(0);
  const { notify, confirm } = useFeedback();
  const t = useT();
  const { language } = usePreferences();
  const [startOpen, setStartOpen] = useState(false);
  // The design as of the last New / Open / Save. Compared by reference (all state
  // updates are immutable) to know whether closing the app would lose work.
  const [savedSnapshot, setSavedSnapshot] = useState(() => ({ boxStyleId, dims, artwork }));
  const isDirty = savedSnapshot.boxStyleId !== boxStyleId || savedSnapshot.dims !== dims || savedSnapshot.artwork !== artwork;
  const [fileDragActive, setFileDragActive] = useState(false);

  // The whole UI mirrors for Arabic; the drawing canvases opt back out in CSS.
  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = language === "ar" ? "rtl" : "ltr";
  }, [language]);
  const fileDragDepth = useRef(0);

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
  const displayedArtwork = useMemo(() => visibleArtwork(artwork, sceneSettings.hiddenLayerIds, sceneSettings.showOutsideArtwork, sceneSettings.showInsideArtwork), [artwork, sceneSettings.hiddenLayerIds, sceneSettings.showOutsideArtwork, sceneSettings.showInsideArtwork]);

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
    if (id) {
      setPanelClickNonce((n) => n + 1);
      setSelectedStudioItem(`model-panel:${id}`);
    }
  };
  const handleStudioSelectPanel = (id: string | null) => {
    handleSelectPanel(id);
    if (id) setSelectedStudioItem(`model-panel:${id}`);
  };

  const handleChangeStyle = async (id: BoxStyleId) => {
    if (id === boxStyleId) return;
    const memory = { ...templateMemory, [boxStyleId]: { ...dims } };
    const remembered = memory[id];
    let nextDims: BoxDimensions;
    if (remembered) {
      nextDims = { ...remembered };
    } else {
      const keepCustom = await confirm({
        title: t("Switch template"),
        message: t("Carry your custom flap and closure settings over to the new template? Length, width and height are preserved either way, and settings that only apply to this template stay saved in its template memory."),
        confirmLabel: t("Keep my settings"),
        cancelLabel: t("Use template defaults"),
      });
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

  // ---- Adding and removing faces --------------------------------------------
  const faceHandles = useMemo(() => freeFaceEdges(root), [root]);
  const handleAddFace = (parentId: string, edge: HingeEdge) => {
    const result = addFace(dims, root, parentId, edge);
    if (!result) {
      notify(t("A face cannot be added on that edge."), "error");
      return;
    }
    handleChangeDimensions(result.dims);
    setSelectedPanelId(result.id);
  };
  const handleRemoveFace = async (panelId: string) => {
    if (panelId === root.id && root.children.length === 0) {
      notify(t("The last face cannot be removed."), "error");
      return;
    }
    const name = layout.panels.find((panel) => panel.id === panelId)?.name ?? "";
    const attached = faceRemovalLoss(root, panelId).length - 1;
    if (attached > 0) {
      const confirmed = await confirm({
        title: t("Remove face"),
        message: t("Removing {name} also removes the {n} flaps and faces hinged to it or beyond it. Faces that look alike, such as the two sides, are never left next to each other. You can undo this with Ctrl/⌘ Z.", { name, n: attached }),
        confirmLabel: t("Remove"),
        cancelLabel: t("Cancel"),
        danger: true,
      });
      if (!confirmed) return;
    }
    handleChangeDimensions(removeFace(dims, root, panelId));
    setSelectedPanelId(null);
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

  const applyProject = (loaded: ReturnType<typeof parseProject>) => {
    skipNextArtworkAnchorAdjust.current = true;
    setBoxStyleId(loaded.boxStyleId);
    setDims(loaded.dims);
    setTemplateMemory({ ...loaded.templateMemory, [loaded.boxStyleId]: { ...loaded.dims } });
    setArtwork(loaded.artwork);
    setSceneSettings(loaded.scene);
    setSelectedPanelId(null);
    setActiveSide("outside");
    setSavedSnapshot({ boxStyleId: loaded.boxStyleId, dims: loaded.dims, artwork: loaded.artwork });
  };

  const startFromTemplate = async (id: BoxStyleId) => {
    if (isDirty) {
      const ok = await confirm({
        title: t("Discard unsaved changes?"),
        message: t("Starting a new project replaces the current design. You can still get it back with Undo."),
        confirmLabel: t("Start new project"),
        danger: true,
      });
      if (!ok) return;
    }
    const definition = getBoxStyle(id);
    const freshDims = { ...definition.defaultDimensions };
    const freshArtwork = emptyArtwork();
    skipNextArtworkAnchorAdjust.current = true;
    setBoxStyleId(id);
    setDims(freshDims);
    setTemplateMemory({ [id]: { ...definition.defaultDimensions } });
    setArtwork(freshArtwork);
    setSelectedPanelId(null);
    setActiveSide("outside");
    setFoldAmount(1);
    setSceneSettings({ ...DEFAULT_SCENE_SETTINGS });
    setSavedSnapshot({ boxStyleId: id, dims: freshDims, artwork: freshArtwork });
    setStartOpen(false);
  };

  const saveProject = () => {
    const json = serializeProject(boxStyleId, dims, artwork, sceneSettings, templateMemory);
    const name = `${getBoxStyle(boxStyleId).label.replace(/\s+/g, "_")}_${new Date().toISOString().slice(0, 10)}${PROJECT_EXTENSION}`;
    downloadBlob(name, new Blob([json], { type: "application/json" }));
    setSavedSnapshot({ boxStyleId, dims, artwork });
    void addRecent({ name, styleLabel: getBoxStyle(boxStyleId).label, json });
    notify(t("Saved {name}", { name }), "success");
  };

  const openProject = async (file: File) => {
    try {
      const text = await file.text();
      const loaded = parseProject(text);
      applyProject(loaded);
      setStartOpen(false);
      void addRecent({ name: file.name, styleLabel: getBoxStyle(loaded.boxStyleId).label, json: text });
      notify(t("Opened {name}", { name: file.name }), "success");
    } catch (err) {
      notify(t("Could not open project: {message}", { message: (err as Error).message }), "error");
    } finally {
      // Allow re-opening the same file twice in a row.
      if (openInputRef.current) openInputRef.current.value = "";
    }
  };

  const openRecent = (project: RecentProject) => {
    try {
      applyProject(parseProject(project.json));
      setStartOpen(false);
      notify(t("Opened {name}", { name: project.name }), "success");
    } catch (err) {
      notify(t("Could not open project: {message}", { message: (err as Error).message }), "error");
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
    void (async () => {
      try {
        const saved = window.localStorage.getItem("azm-box:autosave");
        if (!saved) { setStartOpen(true); return; }
        const recovered = parseProject(saved);
        const ok = await confirm({
          title: t("Restore your last session?"),
          message: t("An autosaved copy of your previous design was found on this device."),
          confirmLabel: t("Restore"),
          cancelLabel: t("Start fresh"),
        });
        if (!ok) { setStartOpen(true); return; }
        skipNextArtworkAnchorAdjust.current = true;
        setBoxStyleId(recovered.boxStyleId);
        setDims(recovered.dims);
        setTemplateMemory({ ...recovered.templateMemory, [recovered.boxStyleId]: { ...recovered.dims } });
        setArtwork(recovered.artwork);
        setSceneSettings(recovered.scene);
      } catch (error) {
        console.warn("The saved AZM-Box autosave could not be restored.", error);
        setStartOpen(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirm]);

  // Warn before the window/tab closes with changes that were never saved to a file.
  useEffect(() => {
    if (!isDirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [isDirty]);

  // Drag & drop: dropping an image on the dieline places it as the full-sheet
  // artwork of the side being edited (same result as "Place artwork").
  const dropHasFiles = (event: React.DragEvent) => activeTab === "2d" && Array.from(event.dataTransfer.types).includes("Files");
  const handleStageDragEnter = (event: React.DragEvent) => {
    if (!dropHasFiles(event)) return;
    event.preventDefault();
    fileDragDepth.current += 1;
    setFileDragActive(true);
  };
  const handleStageDragOver = (event: React.DragEvent) => {
    if (!dropHasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };
  const handleStageDragLeave = (event: React.DragEvent) => {
    if (!dropHasFiles(event)) return;
    fileDragDepth.current = Math.max(0, fileDragDepth.current - 1);
    if (fileDragDepth.current === 0) setFileDragActive(false);
  };
  const handleStageDrop = async (event: React.DragEvent) => {
    if (!dropHasFiles(event)) return;
    event.preventDefault();
    fileDragDepth.current = 0;
    setFileDragActive(false);
    // Some systems report no MIME type for .svg files, so the extension counts too.
    const file = Array.from(event.dataTransfer.files).find((candidate) => candidate.type.startsWith("image/") || isSvgFile(candidate));
    if (!file) {
      notify(t("Drop an image file (PNG, JPG, SVG…) to place it as artwork."), "error");
      return;
    }
    try {
      const dataUrl = await readArtworkFile(file);
      setArtwork((current) => placeSheetImage(current, activeSide, dataUrl, layout.bounds));
      notify(t("Placed {name} on the {side} sheet. Ctrl/⌘ Z to undo.", { name: file.name, side: t(activeSide) }), "success");
    } catch (error) {
      notify(t(error instanceof Error && error.message ? error.message : "That image could not be read."), "error");
    }
  };

  return (
    <div className="app">
      {startOpen && <StartScreen onPickTemplate={startFromTemplate} onOpenRecent={openRecent} onOpenFile={() => openInputRef.current?.click()} onClose={() => setStartOpen(false)} />}
      <header className="topbar">
        <a className="brand-lockup" href="#workspace" aria-label="PackBox Studio home">
          <span className="brand-symbol"><Icon name="box"/></span>
          <span className="brand-name">PackBox <small>STUDIO</small></span>
        </a>
        <span className="header-rule" aria-hidden="true" />
        <div className="project-context"><span>{t("PACKAGING DESIGN")}</span><strong>{t(style.label)}</strong></div>

        <div className="header-spacer" />
        <div className="history-actions" data-history-version={historyVersion} aria-label="Edit history">
          <button type="button" className="header-icon-button" aria-label="Undo" title="Undo · Ctrl/⌘ Z" onClick={undo} disabled={!undoStack.current.length}><Icon name="undo"/></button>
          <button type="button" className="header-icon-button" aria-label="Redo" title="Redo · Ctrl/⌘ Shift Z" onClick={redo} disabled={!redoStack.current.length}><Icon name="redo"/></button>
        </div>
        <span className="header-rule" aria-hidden="true" />
        <div className="project-bar" aria-label="Project actions">
          <button type="button" className="header-action" onClick={() => setStartOpen(true)} title={t("Start a new project from a template, or open a recent one.")}><Icon name="new"/><span>{t("New")}</span></button>
          <button type="button" className="header-icon-button" onClick={() => openInputRef.current?.click()} title={t("Open a saved .pbox project.")} aria-label={t("Open project")}><Icon name="open"/></button>
          <button type="button" className="header-icon-button" onClick={saveProject} title={t("Save this project as a .pbox file.")} aria-label={t("Save project")}><Icon name="save"/></button>
          <span className={`autosave-status ${autosaveStatus}`} role="status" aria-live="polite" title={autosaveStatus === "error" ? "Autosave failed. Browser storage may be full; download a .pbox backup." : autosaveStatus === "saving" ? "Saving project locally…" : "Project saved locally."}>
            {autosaveStatus === "saving" ? t("Saving…") : autosaveStatus === "error" ? t("Not saved") : t("Saved")}
          </span>
          <input ref={openInputRef} type="file" accept={PROJECT_EXTENSION} className="visually-hidden" onChange={(e) => e.target.files?.[0] && openProject(e.target.files[0])}/>
        </div>
        <span className="header-rule" aria-hidden="true" />
        <div className="tabs view-tabs" role="tablist" aria-label="Workspace view">
          <button id="view-2d" role="tab" aria-controls="workspace-canvas" aria-selected={activeTab === "2d"} className={activeTab === "2d" ? "active" : ""} onClick={() => setActiveTab("2d")}><Icon name="dieline"/><span>{t("Dieline")}</span></button>
          <button id="view-3d" role="tab" aria-controls="workspace-canvas" aria-selected={activeTab === "3d"} className={activeTab === "3d" ? "active" : ""} onClick={() => setActiveTab("3d")}><Icon name="cube"/><span>{t("3D Studio")}</span></button>
        </div>
        <button type="button" className="header-action lang-toggle" onClick={() => setPreferences({ language: language === "ar" ? "en" : "ar" })} title={language === "ar" ? "English" : "العربية"} aria-label={language === "ar" ? "Switch to English" : "التبديل إلى العربية"}><span>{language === "ar" ? "EN" : "ع"}</span></button>
        <div className="help-wrap">
          <button type="button" className="help-btn" aria-label="Keyboard and mouse shortcuts" title="Keyboard & mouse shortcuts" onClick={() => setHelpOpen((v) => !v)}><Icon name="help"/></button>
          {helpOpen && <div className="help-popover" role="dialog" aria-label="Keyboard shortcuts" onClick={(e) => e.stopPropagation()}>
            <div className="help-head"><strong>Keyboard shortcuts</strong><button type="button" className="icon-btn" aria-label="Close shortcuts" onClick={() => setHelpOpen(false)}><Icon name="close"/></button></div>
            <h4>General</h4><dl><dt>⌘Z / Ctrl+Z</dt><dd>Undo</dd><dt>⇧⌘Z / Ctrl+Shift+Z</dt><dd>Redo</dd></dl>
            <h4>2D editor</h4><dl><dt>Scroll</dt><dd>Zoom to cursor</dd><dt>Space + drag</dt><dd>Pan the canvas</dd><dt>Middle-drag</dt><dd>Pan the canvas</dd><dt>Shift + rotate</dt><dd>Snap to 45°</dd><dt>Drag a handle</dt><dd>Resize freely</dd><dt>Click a panel</dt><dd>Select it and reveal its settings</dd></dl>
            <h4>3D studio</h4><dl><dt>Left-drag</dt><dd>Orbit around the box</dd><dt>Right-drag</dt><dd>Pan the view</dd><dt>Scroll</dt><dd>Zoom in / out</dd></dl>
          </div>}
        </div>
        <ExportBar layout={layout} dims={dims} styleDefaults={style.defaultDimensions} artwork={artwork} title={style.label.replace(/\s+/g, "_")} sceneRef={sceneRef} sceneCanvasRef={sceneCanvasRef} transparentSceneExportRef={transparentSceneExportRef} activeTab={activeTab} onRequestTab={setActiveTab}/>
      </header>

      <div className="body" id="workspace">
        {activeTab === "3d" && <div className="studio-left-column">
          <StudioTree artwork={artwork} layout={layout} activeSide={activeSide} settings={sceneSettings} onChangeSettings={setSceneSettings} onChangeArtwork={setArtwork} onSelectSide={setActiveSide} onSelectLayer={setSelectedArtworkLayerId} onSelectPanel={handleStudioSelectPanel} selectedLayerId={selectedArtworkLayerId} selectedPanelId={selectedPanelId} selectedItem={selectedStudioItem} onSelectItem={setSelectedStudioItem}/>
          <Sidebar
            boxStyleId={boxStyleId}
          dims={dims}
          layout={layout}
          onChangeStyle={handleChangeStyle}
          onChangeDims={handleChangeDimensions}
          highlightFace={selectedPanelFace}
          highlightNonce={panelClickNonce}
          selectedPanelId={selectedPanelId}
          onRemoveFace={handleRemoveFace}
          />
        </div>}
        {activeTab === "2d" && <Sidebar
          boxStyleId={boxStyleId}
          dims={dims}
          layout={layout}
          onChangeStyle={handleChangeStyle}
          onChangeDims={handleChangeDimensions}
          highlightFace={selectedPanelFace}
          highlightNonce={panelClickNonce}
          selectedPanelId={selectedPanelId}
          onRemoveFace={handleRemoveFace}
        />}

        <main className="stage" id="workspace-canvas" role="tabpanel" tabIndex={0} aria-labelledby={activeTab === "2d" ? "view-2d" : "view-3d"} onDragEnter={handleStageDragEnter} onDragOver={handleStageDragOver} onDragLeave={handleStageDragLeave} onDrop={handleStageDrop}>
          {fileDragActive && <div className="drop-overlay" aria-hidden="true"><Icon name="image"/><strong>{t("Drop to place artwork")}</strong><span>{t("on the {side} sheet", { side: t(activeSide) })}</span></div>}
          {activeTab === "2d" ? (
            <div className="stage-scroll">
              <Suspense fallback={<div className="stage-loading">Loading 2D editor…</div>}>
              <DielineEditor
                layout={layout}
                side={displayedArtwork[activeSide]}
                pxPerMm={2.2}
                selectedPanelId={selectedPanelId}
                onSelectPanel={handleSelectPanel}
                onUpdateSide={(updater) => setArtwork((a) => ({ ...a, [activeSide]: updater(a[activeSide]) }))}
                showDimensions={showDimensions && sceneSettings.showProductionDimensions}
                onToggleDimensions={setShowDimensions}
                showCutLines={sceneSettings.showCutLines}
                showFoldLines={sceneSettings.showFoldLines}
                selectedProductionLayer={selectedStudioItem === "production:showCutLines" ? "cut" : selectedStudioItem === "production:showFoldLines" ? "fold" : null}
                selectedArtworkLayerId={selectedArtworkLayerId}
                onSelectArtworkLayer={setSelectedArtworkLayerId}
                lockedLayerIds={sceneSettings.lockedLayerIds}
                lockTemplate={lockTemplate}
                onToggleLockTemplate={setLockTemplate}
                faceHandles={faceHandles}
                faceEditing={faceEditing}
                onToggleFaceEditing={setFaceEditing}
                onAddFace={handleAddFace}
                onRemoveFace={handleRemoveFace}
              />
              </Suspense>
            </div>
          ) : (
            <div className="stage-3d">
              <Suspense fallback={<div className="stage-loading">Loading 3D studio…</div>}>
                <Fold3D root={root} dims={dims} layout={layout} artwork={displayedArtwork} showDimensions={showDimensions} foldAmount={foldAmount} sceneSettings={sceneSettings} onChangeSceneSettings={setSceneSettings} onTransparentExportReady={(capture) => (transparentSceneExportRef.current = capture)} onSceneReady={(g) => (sceneRef.current = g)} onCanvasReady={(canvas) => (sceneCanvasRef.current = canvas)} onSelectPanel={handleStudioSelectPanel} />
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

        {activeTab === "2d" ? <ArtworkPanel
          layout={layout}
          artwork={artwork}
          activeSide={activeSide}
          onChangeActiveSide={setActiveSide}
          selectedPanelId={selectedPanelId}
          onUpdateArtwork={setArtwork}
        /> : <StudioInspector settings={sceneSettings} onChange={setSceneSettings} selectedItem={selectedStudioItem} layout={layout} selectedPanelId={selectedPanelId}/> }
      </div>
    </div>
  );
}
