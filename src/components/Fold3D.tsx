import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { BoxDimensions, DielineLayout, PanelNode } from "../geometry/types";
import { rect } from "../geometry/shapes";
import type { PanelTextures } from "../artwork/usePanelTextures";
import { usePanelTextures } from "../artwork/usePanelTextures";
import type { ArtworkState } from "../artwork/types";
import type { SceneSettings, CameraPreset, CameraPose } from "../project/sceneSettings";
import { getCameraMouseButtons } from "./cameraControls";
import type { CameraNavigationMode } from "./cameraControls";
import Icon from "./Icon";

const OrbitControls = lazy(() => import("@react-three/drei").then(({ OrbitControls }) => ({ default: OrbitControls })));

interface HingeInfo {
  pivot: [number, number, number];
  axis: "x" | "y";
  baseAngle: number;
}

function computeHinge(node: PanelNode, parentW: number, parentH: number): HingeInfo {
  const offset = node.parentOffset ?? 0;
  switch (node.parentEdge) {
    case "right":
      return { pivot: [parentW, offset, 0], axis: "y", baseAngle: 0 };
    case "left":
      return { pivot: [0, offset, 0], axis: "y", baseAngle: 0 };
    case "top":
      return { pivot: [offset, parentH, 0], axis: "x", baseAngle: 0 };
    case "bottom":
      return { pivot: [offset, 0, 0], axis: "x", baseAngle: Math.PI };
    default:
      return { pivot: [0, 0, 0], axis: "x", baseAngle: 0 };
  }
}

function PanelMesh({ node, textures, materialFinish, showOutsideArtwork, showInsideArtwork, onSelectPanel }: { node: PanelNode; textures?: PanelTextures; materialFinish: { roughness: number; metalness: number }; showOutsideArtwork: boolean; showInsideArtwork: boolean; onSelectPanel?: (id: string) => void }) {
  const geometry = useMemo(() => {
    const pts = node.outline ?? rect(node.w, node.h);
    const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
    const geom = new THREE.ShapeGeometry(shape);

    // THREE.ShapeGeometry's built-in UVs are raw local coordinates in mm (its own
    // comment even calls them "world uvs"), NOT normalized to the 0..1 range every
    // texture mapping expects. With the default clamp-to-edge wrapping, a UV of
    // e.g. 70 just clamps to the texture's very last edge pixel — so instead of
    // showing the artwork, almost the entire panel rendered as one smeared solid
    // color (whatever sat at that edge pixel). That's what made uploaded artwork,
    // and the "printed" measurement labels, invisible in the 3D view. Remap to
    // real 0..1 UVs using this panel's own width/height.
    const uv = geom.getAttribute("uv");
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, uv.getX(i) / node.w, uv.getY(i) / node.h);
    }
    uv.needsUpdate = true;

    return geom;
  }, [node]);

  // Panel textures are rasterized asynchronously, so the very first render always
  // has map=undefined and the material gets COMPILED WITHOUT the USE_MAP shader
  // define. Assigning material.map afterwards does not recompile that program, so
  // the texture is silently never sampled and the panel keeps rendering as flat
  // colour — which is why uploaded artwork (and the printed measurement labels)
  // stayed invisible in 3D even after the UV mapping was corrected. Keying the
  // material on the texture's identity makes R3F build a fresh material once the
  // texture exists, so it compiles with the map in place.
  const outsideKey = textures?.outside.uuid ?? "no-outside";
  const insideKey = textures?.inside.uuid ?? "no-inside";

  return (
    <>
      <mesh geometry={geometry} visible={node.face !== "glue"} castShadow receiveShadow onClick={(event) => { event.stopPropagation(); onSelectPanel?.(node.id); }}>
        <meshStandardMaterial
          key={outsideKey}
          map={showOutsideArtwork ? textures?.outside : undefined}
          color={showOutsideArtwork && textures ? "#ffffff" : "#d8cdb8"}
          side={THREE.FrontSide}
          {...materialFinish}
        />
      </mesh>
      <mesh geometry={geometry} onClick={(event) => { event.stopPropagation(); onSelectPanel?.(node.id); }}>
        <meshStandardMaterial
          key={insideKey}
          map={showInsideArtwork ? textures?.inside : undefined}
          color={showInsideArtwork && textures ? "#ffffff" : "#efe6d3"}
          side={THREE.BackSide}
          {...materialFinish}
        />
      </mesh>
    </>
  );
}

function PanelGroup({
  node,
  parentW,
  parentH,
  foldAmount,
  texturesById,
  materialFinish,
  showOutsideArtwork,
  showInsideArtwork,
  onSelectPanel,
}: {
  node: PanelNode;
  parentW: number;
  parentH: number;
  foldAmount: number;
  texturesById: Map<string, PanelTextures>;
  materialFinish: { roughness: number; metalness: number };
  showOutsideArtwork: boolean;
  showInsideArtwork: boolean;
  onSelectPanel?: (id: string) => void;
}) {
  const { pivot, axis, baseAngle } = computeHinge(node, parentW, parentH);
  // Remap the global slider into this hinge's own phase window (tube walls close
  // first, then inner/glued flaps, then outer flaps) so the box assembles in a
  // realistic order instead of every hinge moving in lockstep.
  const start = node.foldStart ?? 0;
  const end = node.foldEnd ?? 1;
  const localT = end > start ? Math.min(1, Math.max(0, (foldAmount - start) / (end - start))) : foldAmount;
  const angle = baseAngle + localT * node.foldAngle;
  const rotation: [number, number, number] = axis === "x" ? [angle, 0, 0] : [0, angle, 0];

  return (
    <group position={pivot} rotation={rotation}>
      <PanelMesh node={node} textures={texturesById.get(node.id)} materialFinish={materialFinish} showOutsideArtwork={showOutsideArtwork} showInsideArtwork={showInsideArtwork} onSelectPanel={onSelectPanel} />
      {node.children.map((child) => (
        <PanelGroup key={child.id} node={child} parentW={node.w} parentH={node.h} foldAmount={foldAmount} texturesById={texturesById} materialFinish={materialFinish} showOutsideArtwork={showOutsideArtwork} showInsideArtwork={showInsideArtwork} onSelectPanel={onSelectPanel} />
      ))}
    </group>
  );
}

type StudioControls = { current: { target: THREE.Vector3; update: () => void } | null };

function CameraRig({ dims, preset, cameraPose, resetKey, controlsRef }: { dims: BoxDimensions; preset: CameraPreset; cameraPose: CameraPose | null; resetKey: number; controlsRef: StudioControls }) {
  const { camera } = useThree();
  useEffect(() => {
    const target = cameraPose ? new THREE.Vector3(...cameraPose.target) : new THREE.Vector3(dims.length / 2, dims.height / 2, -dims.width / 2);
    const radius = Math.max(dims.length, dims.width, dims.height) * 2.5;
    const offsets: Record<CameraPreset, [number, number, number]> = {
      front: [0, 0, radius], back: [0, 0, -radius], left: [-radius, 0, 0],
      right: [radius, 0, 0], top: [0, radius, 0], iso: [radius * 0.8, radius * 0.65, radius * 0.9],
    };
    if (cameraPose) {
      camera.position.set(...cameraPose.position);
      camera.up.set(...cameraPose.up);
    } else {
      camera.position.copy(target).add(new THREE.Vector3(...offsets[preset]));
      camera.up.set(0, 1, 0);
      if (preset === "top") camera.up.set(0, 0, -1);
    }
    camera.lookAt(target);
    if (controlsRef.current) {
      controlsRef.current.target.copy(target);
      controlsRef.current.update();
    }
  }, [camera, cameraPose, controlsRef, dims.height, dims.length, dims.width, preset, resetKey]);
  return null;
}

function TransparentCapture({ onReady }: { onReady?: (capture: () => Promise<Blob>) => void }) {
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    onReady?.(() => new Promise<Blob>((resolve, reject) => {
      const background = scene.background;
      const clearColor = gl.getClearColor(new THREE.Color()).clone();
      const clearAlpha = gl.getClearAlpha();
      try {
        scene.background = null;
        gl.setClearColor(0x000000, 0);
        gl.render(scene, camera);
        gl.domElement.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Could not capture a transparent 3D PNG.")), "image/png");
      } catch (error) {
        reject(error);
      } finally {
        scene.background = background;
        gl.setClearColor(clearColor, clearAlpha);
        gl.render(scene, camera);
      }
    }));
  }, [camera, gl, onReady, scene]);
  return null;
}

interface Fold3DProps {
  root: PanelNode;
  dims: BoxDimensions;
  layout: DielineLayout;
  artwork: ArtworkState;
  showDimensions: boolean;
  foldAmount: number;
  sceneSettings: SceneSettings;
  onChangeSceneSettings: React.Dispatch<React.SetStateAction<SceneSettings>>;
  onTransparentExportReady?: (capture: () => Promise<Blob>) => void;
  onSceneReady?: (group: THREE.Group) => void;
  onCanvasReady?: (canvas: HTMLCanvasElement) => void;
  onSelectPanel?: (id: string) => void;
}

export default function Fold3D({ root, dims, layout, artwork, showDimensions, foldAmount, sceneSettings, onChangeSceneSettings, onTransparentExportReady, onSceneReady, onCanvasReady, onSelectPanel }: Fold3DProps) {
  const texturesById = usePanelTextures(layout, artwork, 6, showDimensions);
  const groupRef = useRef<THREE.Group>(null);
  const controlsRef = useRef<StudioControls["current"]>(null);
  const pendingCameraPose = useRef<CameraPose | null>(null);
  const cameraPoseTimer = useRef<number | null>(null);
  const [studioOpen, setStudioOpen] = useState(false);
  const [navigation, setNavigation] = useState<CameraNavigationMode>("orbit");
  const [spacePan, setSpacePan] = useState(false);
  const [cameraResetKey, setCameraResetKey] = useState(0);
  const { background, ambient, preset, lights, floor, shadows, material } = sceneSettings;
  const materialFinish = material === "metallic" ? { roughness: 0.32, metalness: 0.55 } : material === "satin" ? { roughness: 0.5, metalness: 0.08 } : material === "matte" ? { roughness: 0.98, metalness: 0 } : { roughness: 0.85, metalness: 0 };
  const environmentScale = sceneSettings.environment === "soft" ? 0.82 : sceneSettings.environment === "neutral" ? 0.95 : 1;
  const mouseButtons = useMemo(() => getCameraMouseButtons(navigation, spacePan), [navigation, spacePan]);
  const updateScene = (patch: Partial<SceneSettings>) => onChangeSceneSettings((current) => ({ ...current, ...patch }));
  const reportCameraChange = useCallback((event?: { target?: unknown }) => {
    const controls = event?.target as { object?: THREE.Camera; target?: THREE.Vector3 } | null;
    if (!controls?.object || !controls.target) return;
    pendingCameraPose.current = {
      position: controls.object.position.toArray() as [number, number, number],
      target: controls.target.toArray() as [number, number, number],
      up: controls.object.up.toArray() as [number, number, number],
    };
    if (cameraPoseTimer.current !== null) window.clearTimeout(cameraPoseTimer.current);
    cameraPoseTimer.current = window.setTimeout(() => {
      const pose = pendingCameraPose.current;
      if (pose) onChangeSceneSettings((current) => ({ ...current, cameraPose: pose }));
      cameraPoseTimer.current = null;
    }, 180);
  }, [onChangeSceneSettings]);
  useEffect(() => () => {
    if (cameraPoseTimer.current !== null) {
      window.clearTimeout(cameraPoseTimer.current);
      const pose = pendingCameraPose.current;
      if (pose) onChangeSceneSettings((current) => ({ ...current, cameraPose: pose }));
    }
  }, [onChangeSceneSettings]);
  const presets: { id: CameraPreset; label: string }[] = [
    { id: "front", label: "Front" }, { id: "back", label: "Back" }, { id: "left", label: "Left" },
    { id: "right", label: "Right" }, { id: "top", label: "Top" }, { id: "iso", label: "Iso" },
  ];
  const applyPreset = useCallback((value: CameraPreset) => {
    setCameraResetKey((key) => key + 1);
    onChangeSceneSettings((current) => ({ ...current, preset: value, cameraPose: null }));
  }, [onChangeSceneSettings]);
  useEffect(() => {
    const closeStudio = () => setStudioOpen(false);
    window.addEventListener("packbox:export-menu-open", closeStudio);
    return () => window.removeEventListener("packbox:export-menu-open", closeStudio);
  }, []);

  useEffect(() => {
    const isTyping = (target: EventTarget | null) => target instanceof HTMLElement &&
      (target.isContentEditable || !!target.closest("input,textarea,select,button,a,[role=button]"));
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTyping(event.target)) return;
      if (event.code === "Space") {
        event.preventDefault();
        setSpacePan(true);
      } else if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        setNavigation("orbit");
        applyPreset("iso");
      }
    };
    const onKeyUp = (event: KeyboardEvent) => { if (event.code === "Space") setSpacePan(false); };
    const onBlur = () => setSpacePan(false);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [applyPreset]);

  return (
    <div className="fold3d-root">
      <Canvas className="fold3d-canvas" dpr={[1, 2]} gl={{ preserveDrawingBuffer: true, antialias: true, alpha: true }} shadows={shadows} camera={{ position: [260, 220, 320], fov: 40, near: 1, far: 5000 }} onCreated={({ gl }) => onCanvasReady?.(gl.domElement)}>
        {!sceneSettings.transparentBackground && <color attach="background" args={[background]} />}
        <ambientLight intensity={ambient * environmentScale} />
        {(["key", "fill", "rim"] as const).map((name) => {
          const light = lights[name];
          return light.enabled ? <directionalLight key={name} position={light.position} color={light.color} intensity={light.intensity * (name === "key" ? sceneSettings.keyLight : 1) * environmentScale} castShadow={shadows && name === "key"} shadow-mapSize-width={1024} shadow-mapSize-height={1024} /> : null;
        })}
        {floor.visible && <mesh rotation={[-Math.PI / 2, 0, 0]} position={[dims.length / 2, -2, -dims.width / 2]} receiveShadow>
          <planeGeometry args={[floor.size, floor.size]} />
          <meshStandardMaterial color={floor.color} roughness={0.95} metalness={0} />
        </mesh>}
        <group visible={sceneSettings.showModel} ref={(g) => { groupRef.current = g; if (g && onSceneReady) onSceneReady(g); }}>
          <PanelGroup node={root} parentW={root.w} parentH={root.h} foldAmount={foldAmount} texturesById={texturesById} materialFinish={materialFinish} showOutsideArtwork={sceneSettings.showOutsideArtwork !== false} showInsideArtwork={sceneSettings.showInsideArtwork !== false} onSelectPanel={onSelectPanel} />
        </group>
        <CameraRig dims={dims} preset={preset} cameraPose={sceneSettings.cameraPose} resetKey={cameraResetKey} controlsRef={controlsRef} />
        <TransparentCapture onReady={onTransparentExportReady} />
        <Suspense fallback={null}>
          <OrbitControls ref={controlsRef as never} makeDefault mouseButtons={mouseButtons} onChange={reportCameraChange} enableDamping dampingFactor={0.08} enableRotate enablePan enableZoom minDistance={5} maxDistance={20000} minPolarAngle={0} maxPolarAngle={Math.PI} minAzimuthAngle={-Infinity} maxAzimuthAngle={Infinity} />
        </Suspense>
      </Canvas>
      <nav className="camera-toolbar" aria-label="3D camera navigation">
        {(["orbit", "pan", "zoom"] as const).map((mode) => <button key={mode} type="button" aria-pressed={navigation === mode} className={navigation === mode ? "selected" : ""} title={`${mode[0].toUpperCase()}${mode.slice(1)} mode`} onClick={() => setNavigation(mode)}>{mode[0].toUpperCase() + mode.slice(1)}</button>)}
        <span aria-hidden="true" />
        <button type="button" onClick={() => { setNavigation("orbit"); applyPreset("iso"); }} title="Fit and reset the camera">Fit</button>
      </nav>
      <div className="studio-trigger-wrap">
        <button type="button" className={`studio-trigger${studioOpen ? " active" : ""}`} onClick={() => setStudioOpen((open) => !open)} aria-expanded={studioOpen} aria-controls="studio-settings"><Icon name="cube"/> Scene settings</button>
        {studioOpen && <section id="studio-settings" className="studio-panel" aria-label="3D studio settings">
          <header><strong>3D Studio</strong><button type="button" className="icon-btn" onClick={() => setStudioOpen(false)} aria-label="Close studio controls"><Icon name="close"/></button></header>
          <div className="studio-section"><span className="studio-label">Camera angle</span><div className="studio-angle-grid">
            {presets.map((item) => <button key={item.id} type="button" className={preset === item.id ? "selected" : ""} onClick={() => applyPreset(item.id)}>{item.label}</button>)}
          </div></div>
          <div className="studio-section"><span className="studio-label">Background</span><div className="studio-backgrounds">
            {["#e9e6df", "#f5f3ed", "#ffffff", "#dce4ec", "#23252b"].map((color) => <button key={color} type="button" aria-label={`Background ${color}`} title={color} className={background === color ? "selected" : ""} style={{ background: color }} onClick={() => updateScene({ background: color })} />)}
            <input type="color" aria-label="Custom background color" value={background} onChange={(event) => updateScene({ background: event.target.value })} />
          </div></div>
          <label className="studio-light-slider">Ambient <b>{ambient.toFixed(1)}</b><input type="range" min="0" max="3" step="0.05" value={ambient} onChange={(event) => updateScene({ ambient: Number(event.target.value) })} /></label>
          <div className="studio-section"><span className="studio-label">Lights</span>{(["key", "fill", "rim"] as const).map((name) => <div className="studio-light-control" key={name}>
            <label><input type="checkbox" checked={lights[name].enabled} onChange={(event) => onChangeSceneSettings((current) => ({ ...current, lights: { ...current.lights, [name]: { ...current.lights[name], enabled: event.target.checked } } }))}/><span>{name[0].toUpperCase() + name.slice(1)}</span></label>
            <input aria-label={`${name} light intensity`} type="range" min="0" max="3" step="0.05" value={lights[name].intensity} onChange={(event) => onChangeSceneSettings((current) => ({ ...current, lights: { ...current.lights, [name]: { ...current.lights[name], intensity: Number(event.target.value) } } }))}/>
            <input type="color" aria-label={`${name} light color`} value={lights[name].color} onChange={(event) => onChangeSceneSettings((current) => ({ ...current, lights: { ...current.lights, [name]: { ...current.lights[name], color: event.target.value } } }))}/>
          </div>)}</div>
          <div className="studio-section"><span className="studio-label">Surface & floor</span>
            <label className="studio-select-label">Appearance <select value={material} onChange={(event) => updateScene({ material: event.target.value as SceneSettings["material"] })}><option value="board">Folding board</option><option value="matte">Matte</option><option value="satin">Satin</option><option value="metallic">Metallic</option></select></label>
            <label className="studio-check-row"><input type="checkbox" checked={floor.visible} onChange={(event) => onChangeSceneSettings((current) => ({ ...current, floor: { ...current.floor, visible: event.target.checked } }))}/> Ground plane</label>
            <label className="studio-check-row"><input type="checkbox" checked={shadows} onChange={(event) => updateScene({ shadows: event.target.checked })}/> Shadows</label>
            <label className="studio-check-row"><input type="checkbox" checked={sceneSettings.transparentBackground} onChange={(event) => updateScene({ transparentBackground: event.target.checked })}/> Transparent background</label>
          </div>
          <p className="studio-hint">Surface appearances are visual previews only—not color proof or a manufacturing guarantee. Orbit: drag · Pan: right-drag or Space + drag · Zoom: scroll · F: fit view.</p>
        </section>}
      </div>
    </div>
  );
}
