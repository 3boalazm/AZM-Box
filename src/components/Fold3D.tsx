import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import type { BoxDimensions, DielineLayout, PanelNode } from "../geometry/types";
import { rect } from "../geometry/shapes";
import { childPrintMirrored } from "../geometry/printSide";
import { PRODUCT_SHOTS, cameraPoseForShot } from "../project/scenePresets";
import type { ShotFraming } from "../project/scenePresets";
import { getPreferences, scenePresetFrom, setPreferences, usePreferences } from "../lib/preferences";
import type { PanelTextures } from "../artwork/usePanelTextures";
import { usePanelTextures } from "../artwork/usePanelTextures";
import type { ArtworkState } from "../artwork/types";
import type { SceneSettings, CameraPreset, CameraPose, MaterialParams } from "../project/sceneSettings";
import { applyMaterialPreset } from "../project/sceneSettings";
import { surfaceBumpTexture } from "../artwork/surfaceTextures";
import { getCameraMouseButtons } from "./cameraControls";
import type { CameraNavigationMode } from "./cameraControls";
import Icon from "./Icon";

const OrbitControls = lazy(() => import("@react-three/drei").then(({ OrbitControls }) => ({ default: OrbitControls })));

/** Glue/end tabs fold inside the box and end up coplanar with the seam wall; nudge
 * them this far along their own normal (into the box) so the two surfaces never
 * z-fight — the wall wins when viewed from outside, the tab from inside. */
const GLUE_INSET_MM = 0.25;

/** One board-caliper step between flap layers. Flaps that close over the same
 * opening all end up in the SAME plane (zero-thickness model), which z-fights and
 * lets inner flaps' edges show through the outer flap from outside. Real boxes
 * stack: each later-closing (outer) flap sits one layer further out. We reproduce
 * that by nudging every top/bottom flap along its own normal by its closing
 * order (foldStart): top flaps stack upward (+local Z = outside), bottom flaps
 * stack downward (outside is -Y, and their local +Z points up into the box). */
const FLAP_STACK_MM = 0.3;

function flapStackInset(node: PanelNode): number {
  // A tongue is NOT one of the layers closing over the opening — it stands
  // perpendicular to its own flap, against the inside of the far wall. Stacking
  // it pushes it along its own normal, which for a tongue points straight through
  // that wall: the crease end ended up OUTSIDE the box and showed through the
  // face. Whether it came out in front or behind depended only on which way the
  // tongue happened to face, which is why the bottom one looked right and the top
  // one did not. Its inward lean already settles which side it is on.
  if (node.tucked) return 0;
  if (node.parentEdge === "top" || node.parentEdge === "bottom") {
    const layer = Math.max(0, Math.min(1, node.foldStart ?? 0));
    return (node.parentEdge === "top" ? 1 : -1) * FLAP_STACK_MM * layer;
  }
  if (node.face === "glue" && (node.parentEdge === "left" || node.parentEdge === "right")) return GLUE_INSET_MM;
  return 0;
}

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
      // Left-attached panels sit to the LEFT of the parent in the flat sheet
      // (layout.ts places them at originX - w with an unflipped local frame), so the
      // hinge must start pre-rotated 180° about Y; their foldAngle (e.g. -TUBE_FOLD
      // for the left end tab) then lands at a total of +90°, tucking them inside.
      return { pivot: [0, offset, 0], axis: "y", baseAngle: Math.PI };
    case "top":
      return { pivot: [offset, parentH, 0], axis: "x", baseAngle: 0 };
    case "bottom":
      return { pivot: [offset, 0, 0], axis: "x", baseAngle: Math.PI };
    default:
      return { pivot: [0, 0, 0], axis: "x", baseAngle: 0 };
  }
}

function PanelMesh({ node, mirrored, textures, material, showOutsideArtwork, showInsideArtwork, onSelectPanel }: { node: PanelNode; mirrored: boolean; textures?: PanelTextures; material: MaterialParams; showOutsideArtwork: boolean; showInsideArtwork: boolean; onSelectPanel?: (id: string) => void }) {
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
    // A panel in a flipped frame (see childPrintMirrored) has its local +Z pointing
    // into the box, so its two faces are drawn with the sides swapped below. Mirror
    // the U axis to match: the swapped side already reverses what the viewer sees,
    // and these two reversals cancel, so the outside artwork still reads correctly
    // from outside the box and the inside sheet still reads correctly from within.
    const uv = geom.getAttribute("uv");
    for (let i = 0; i < uv.count; i++) {
      const u = uv.getX(i) / node.w;
      uv.setXY(i, mirrored ? 1 - u : u, uv.getY(i) / node.h);
    }
    uv.needsUpdate = true;

    return geom;
  }, [node, mirrored]);

  // Panel textures are rasterized asynchronously, so the very first render always
  // has map=undefined and the material gets COMPILED WITHOUT the USE_MAP shader
  // define. Assigning material.map afterwards does not recompile that program, so
  // the texture is silently never sampled and the panel keeps rendering as flat
  // colour — which is why uploaded artwork (and the printed measurement labels)
  // stayed invisible in 3D even after the UV mapping was corrected. Keying the
  // material on the texture's identity makes R3F build a fresh material once the
  // texture exists, so it compiles with the map in place.
  const bump = useMemo(() => surfaceBumpTexture(material.texture, node.w, node.h, material.textureScale), [material.texture, material.textureScale, node.w, node.h]);
  useEffect(() => () => bump?.dispose(), [bump]);
  const finish = {
    roughness: material.roughness,
    metalness: material.metalness,
    clearcoat: material.clearcoat,
    clearcoatRoughness: material.clearcoatRoughness,
    bumpMap: bump,
    bumpScale: bump ? material.textureStrength * 2 : 0,
  };
  const outsideKey = `${textures?.outside.uuid ?? "no-outside"}-${bump ? "bump" : "flat"}`;
  const insideKey = `${textures?.inside.uuid ?? "no-inside"}-${bump ? "bump" : "flat"}`;

  return (
    <>
      <mesh geometry={geometry} castShadow receiveShadow onClick={(event) => { event.stopPropagation(); onSelectPanel?.(node.id); }}>
        <meshPhysicalMaterial
          key={outsideKey}
          map={showOutsideArtwork ? textures?.outside : undefined}
          color={showOutsideArtwork && textures ? material.tint : material.boardColor}
          side={mirrored ? THREE.BackSide : THREE.FrontSide}
          {...finish}
        />
      </mesh>
      <mesh geometry={geometry} onClick={(event) => { event.stopPropagation(); onSelectPanel?.(node.id); }}>
        <meshPhysicalMaterial
          key={insideKey}
          map={showInsideArtwork ? textures?.inside : undefined}
          color={showInsideArtwork && textures ? material.tint : material.insideColor}
          side={mirrored ? THREE.FrontSide : THREE.BackSide}
          {...finish}
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
  mirrored,
  texturesById,
  material,
  showOutsideArtwork,
  showInsideArtwork,
  onSelectPanel,
}: {
  node: PanelNode;
  parentW: number;
  parentH: number;
  foldAmount: number;
  mirrored?: boolean;
  texturesById: Map<string, PanelTextures>;
  material: MaterialParams;
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

  const stackInset = flapStackInset(node);
  return (
    <group position={pivot} rotation={rotation}>
      <group position={[0, 0, stackInset]}>
        <PanelMesh node={node} mirrored={!!mirrored} textures={texturesById.get(node.id)} material={material} showOutsideArtwork={showOutsideArtwork} showInsideArtwork={showInsideArtwork} onSelectPanel={onSelectPanel} />
        {node.children.map((child) => (
          <PanelGroup key={child.id} node={child} parentW={node.w} parentH={node.h} foldAmount={foldAmount} mirrored={childPrintMirrored(!!mirrored, child.parentEdge)} texturesById={texturesById} material={material} showOutsideArtwork={showOutsideArtwork} showInsideArtwork={showInsideArtwork} onSelectPanel={onSelectPanel} />
        ))}
      </group>
    </group>
  );
}

type StudioControls = { current: { target: THREE.Vector3; update: () => void } | null };

function CameraRig({ dims, preset, cameraPose, fov, resetKey, controlsRef, controlsReady, onPresetApplied }: { dims: BoxDimensions; preset: CameraPreset; cameraPose: CameraPose | null; fov: number; resetKey: number; controlsRef: StudioControls; controlsReady: boolean; onPresetApplied: (pose: CameraPose) => void }) {
  const { camera } = useThree();
  useEffect(() => {
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  }, [camera, fov]);
  useEffect(() => {
    // OrbitControls is lazy-loaded; framing before it exists would be overwritten
    // when it mounts and snaps the camera to its own default target.
    if (!controlsReady) return;
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
    // A preset has no stored pose yet; publish the real one so the numeric camera
    // fields show true values. Only when none is stored, so this cannot loop.
    if (!cameraPose) {
      onPresetApplied({ position: camera.position.toArray() as [number, number, number], target: target.toArray() as [number, number, number], up: camera.up.toArray() as [number, number, number] });
    }
  }, [camera, cameraPose, controlsRef, dims.height, dims.length, dims.width, controlsReady, onPresetApplied, preset, resetKey]);
  return null;
}

/** Exposure and procedural studio reflections (no network, so it works offline). */
function SceneTuning({ exposure, envLight }: { exposure: number; envLight: number }) {
  const { gl, scene } = useThree();
  useEffect(() => {
    const generator = new THREE.PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const target = generator.fromScene(room, 0.04);
    scene.environment = target.texture;
    return () => {
      scene.environment = null;
      target.dispose();
      generator.dispose();
      room.dispose();
    };
  }, [gl, scene]);
  useEffect(() => { scene.environmentIntensity = envLight; }, [scene, envLight]);
  useEffect(() => { gl.toneMappingExposure = exposure; }, [gl, exposure]);
  return null;
}

function Turntable({ spinRef, enabled }: { spinRef: React.RefObject<THREE.Group | null>; enabled: boolean }) {
  useFrame((_, delta) => {
    if (enabled && spinRef.current) spinRef.current.rotation.y += delta * 0.5;
  });
  return null;
}

/** A scene capture that can render at a higher pixel ratio than the on-screen canvas,
 * so exported PNG/JPG/PDF previews are sharper than the live view. */
export type SceneCapture = (opts?: { transparent?: boolean; scale?: number; mime?: string }) => Promise<Blob>;

function TransparentCapture({ onReady }: { onReady?: (capture: SceneCapture) => void }) {
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    onReady?.((opts) => new Promise<Blob>((resolve, reject) => {
      const transparent = opts?.transparent ?? true;
      const mime = opts?.mime ?? "image/png";
      const background = scene.background;
      const clearColor = gl.getClearColor(new THREE.Color()).clone();
      const clearAlpha = gl.getClearAlpha();
      const prevPixelRatio = gl.getPixelRatio();
      const prevSize = new THREE.Vector2();
      gl.getSize(prevSize); // CSS size of the canvas
      // Supersample, but cap the backing store so huge windows don't explode memory.
      const maxScale = 4096 / Math.max(1, Math.max(prevSize.x, prevSize.y) * prevPixelRatio);
      const scale = Math.max(1, Math.min(opts?.scale ?? 3, maxScale));
      try {
        if (transparent) {
          scene.background = null;
          gl.setClearColor(0x000000, 0);
        }
        // Same CSS size -> camera aspect is unchanged; only the backing store grows.
        gl.setPixelRatio(prevPixelRatio * scale);
        gl.setSize(prevSize.x, prevSize.y, false);
        gl.render(scene, camera);
        gl.domElement.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Could not capture the 3D scene.")), mime, 0.94);
      } catch (error) {
        reject(error);
      } finally {
        gl.setPixelRatio(prevPixelRatio);
        gl.setSize(prevSize.x, prevSize.y, false);
        if (transparent) {
          scene.background = background;
          gl.setClearColor(clearColor, clearAlpha);
        }
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
  onSceneCaptureReady?: (capture: SceneCapture) => void;
  onSceneReady?: (group: THREE.Group) => void;
  onCanvasReady?: (canvas: HTMLCanvasElement) => void;
  /** False while the 2D view is on top: the scene stays alive but stops rendering. */
  active?: boolean;
  onSelectPanel?: (id: string) => void;
}

export default function Fold3D({ root, dims, layout, artwork, showDimensions, foldAmount, sceneSettings, onChangeSceneSettings, onSceneCaptureReady, onSceneReady, onCanvasReady, onSelectPanel, active = true }: Fold3DProps) {
  const texturesById = usePanelTextures(layout, artwork, 6, showDimensions);
  const groupRef = useRef<THREE.Group>(null);
  const controlsRef = useRef<StudioControls["current"]>(null);
  const pendingCameraPose = useRef<CameraPose | null>(null);
  const cameraPoseTimer = useRef<number | null>(null);
  const [studioOpen, setStudioOpen] = useState(false);
  const [navigation, setNavigation] = useState<CameraNavigationMode>("orbit");
  const [spacePan, setSpacePan] = useState(false);
  const [cameraResetKey, setCameraResetKey] = useState(0);
  const { background, ambient, preset, lights, floor, shadows, materialParams: material } = sceneSettings;
  const spinRef = useRef<THREE.Group>(null);
  const modelCenter: [number, number, number] = [dims.length / 2, dims.height / 2, -dims.width / 2];
  const rotationRad = sceneSettings.modelRotation.map((deg) => THREE.MathUtils.degToRad(deg)) as [number, number, number];
  const shadowReach = Math.max(dims.length, dims.width, dims.height) * 3;
  const environmentScale = sceneSettings.environment === "soft" ? 0.82 : sceneSettings.environment === "neutral" ? 0.95 : 1;
  const mouseButtons = useMemo(() => getCameraMouseButtons(navigation, spacePan), [navigation, spacePan]);
  const updateScene = (patch: Partial<SceneSettings>) => onChangeSceneSettings((current) => ({ ...current, ...patch }));
  const { scenePresets } = usePreferences();

  // A shot is framed from the box's own size, so the same set keeps every
  // product the same size on the page. See scenePresets.ts.
  const boxBounds = useMemo(() => ({
    min: [0, 0, -dims.width] as [number, number, number],
    max: [dims.length, dims.height, 0] as [number, number, number],
  }), [dims.length, dims.height, dims.width]);

  const applyShot = (shot: ShotFraming) => updateScene({ fov: shot.fov, cameraPose: cameraPoseForShot(shot, boxBounds) });

  const applyScenePreset = (name: string) => {
    const saved = getPreferences().scenePresets[name];
    if (!saved) return;
    onChangeSceneSettings((current) => ({ ...current, ...saved.look }));
  };

  const saveScenePreset = () => {
    const name = window.prompt("Save this look and shot set as")?.trim();
    if (!name) return;
    // Save straight from the sceneSettings prop. Reaching the current scene by
    // passing a function to onChangeSceneSettings and writing preferences inside
    // it put a side effect in a state updater: React is free to run one of those
    // more than once, or not at the moment it is called, so the write could be
    // repeated or land later than the code that reads it back.
    const prefs = getPreferences();
    setPreferences({ scenePresets: { ...prefs.scenePresets, [name]: scenePresetFrom(name, sceneSettings) } });
  };
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
  const [controlsReady, setControlsReady] = useState(false);
  const attachControls = useCallback((controls: StudioControls["current"]) => {
    controlsRef.current = controls;
    setControlsReady(!!controls);
  }, []);
  const storeAppliedPose = useCallback((pose: CameraPose) => {
    // Drop any stale pose queued by an earlier camera event; it must not overwrite this one.
    if (cameraPoseTimer.current !== null) window.clearTimeout(cameraPoseTimer.current);
    cameraPoseTimer.current = null;
    pendingCameraPose.current = null;
    onChangeSceneSettings((current) => (current.cameraPose ? current : { ...current, cameraPose: pose }));
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
      <Canvas className="fold3d-canvas" frameloop={active ? "always" : "never"} dpr={[1, 1.5]} gl={{ preserveDrawingBuffer: true, antialias: true, alpha: true }} shadows={shadows ? { type: THREE.PCFShadowMap } : false} camera={{ position: [260, 220, 320], fov: 40, near: 1, far: 5000 }} onCreated={({ gl }) => onCanvasReady?.(gl.domElement)}>
        {!sceneSettings.transparentBackground && <color attach="background" args={[background]} />}
        <ambientLight intensity={ambient * environmentScale} />
        {(["key", "fill", "rim"] as const).map((name) => {
          const light = lights[name];
          return light.enabled ? <directionalLight key={name} position={light.position} color={light.color} intensity={light.intensity * (name === "key" ? sceneSettings.keyLight : 1) * environmentScale} castShadow={shadows && name === "key"} shadow-mapSize-width={1024} shadow-mapSize-height={1024} shadow-bias={-0.0004} shadow-normalBias={0.6} shadow-camera-left={-shadowReach} shadow-camera-right={shadowReach} shadow-camera-top={shadowReach} shadow-camera-bottom={-shadowReach} shadow-camera-near={1} shadow-camera-far={shadowReach * 6} /> : null;
        })}
        {floor.visible && <mesh rotation={[-Math.PI / 2, 0, 0]} position={[dims.length / 2, -2, -dims.width / 2]} receiveShadow>
          <planeGeometry args={[floor.size, floor.size]} />
          <meshStandardMaterial color={floor.color} roughness={0.95} metalness={0} />
        </mesh>}
        <group position={[modelCenter[0] + sceneSettings.modelOffset[0], modelCenter[1] + sceneSettings.modelOffset[1], modelCenter[2] + sceneSettings.modelOffset[2]]}>
          <group ref={spinRef}>
            <group rotation={rotationRad}>
              <group position={[-modelCenter[0], -modelCenter[1], -modelCenter[2]]}>
                <group ref={(g) => { groupRef.current = g; if (g && onSceneReady) onSceneReady(g); }}>
                  <PanelGroup node={root} parentW={root.w} parentH={root.h} foldAmount={foldAmount} texturesById={texturesById} material={material} showOutsideArtwork={sceneSettings.showOutsideArtwork !== false} showInsideArtwork={sceneSettings.showInsideArtwork !== false} onSelectPanel={onSelectPanel} />
                </group>
              </group>
            </group>
          </group>
        </group>
        <Turntable spinRef={spinRef} enabled={sceneSettings.turntable} />
        <SceneTuning exposure={sceneSettings.exposure} envLight={sceneSettings.envLight} />
        <CameraRig dims={dims} preset={preset} cameraPose={sceneSettings.cameraPose} fov={sceneSettings.fov} resetKey={cameraResetKey} controlsRef={controlsRef} controlsReady={controlsReady} onPresetApplied={storeAppliedPose} />
        <TransparentCapture onReady={onSceneCaptureReady} />
        <Suspense fallback={null}>
          <OrbitControls ref={attachControls as never} makeDefault mouseButtons={mouseButtons} onChange={reportCameraChange} enableDamping dampingFactor={0.08} enableRotate enablePan enableZoom minDistance={5} maxDistance={20000} minPolarAngle={0} maxPolarAngle={Math.PI} minAzimuthAngle={-Infinity} maxAzimuthAngle={Infinity} />
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
          <div className="studio-section"><span className="studio-label">Product shots</span><div className="studio-angle-grid">
            {PRODUCT_SHOTS.map((shot) => <button key={shot.id} type="button" title={`${shot.azimuth}° around, ${shot.elevation}° up, ${Math.round(shot.fill * 100)}% of frame`} onClick={() => applyShot(shot)}>{shot.label}</button>)}
          </div>
          <div className="studio-preset-row">
            <select aria-label="Saved scene presets" value="" onChange={(event) => { if (event.target.value) applyScenePreset(event.target.value); }}>
              <option value="">Saved looks…</option>
              {Object.keys(scenePresets).map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
            <button type="button" onClick={saveScenePreset}>Save current</button>
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
            <label className="studio-select-label">Appearance <select value={sceneSettings.material} onChange={(event) => updateScene(applyMaterialPreset(event.target.value as SceneSettings["material"]))}><option value="board">Folding board</option><option value="matte">Matte</option><option value="satin">Satin</option><option value="metallic">Metallic</option><option value="gloss">Gloss varnish</option><option value="kraft">Kraft</option><option value="softtouch">Soft-touch</option><option value="custom">Custom</option></select></label>
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
