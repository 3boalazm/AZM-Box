import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { BoxDimensions, DielineLayout, PanelNode } from "../geometry/types";
import { rect } from "../geometry/shapes";
import type { PanelTextures } from "../artwork/usePanelTextures";
import { usePanelTextures } from "../artwork/usePanelTextures";
import type { ArtworkState } from "../artwork/types";

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

function PanelMesh({ node, textures }: { node: PanelNode; textures?: PanelTextures }) {
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
      <mesh geometry={geometry} visible={node.face !== "glue"}>
        <meshStandardMaterial
          key={outsideKey}
          map={textures?.outside}
          color={textures ? "#ffffff" : "#d8cdb8"}
          side={THREE.FrontSide}
          roughness={0.85}
        />
      </mesh>
      <mesh geometry={geometry}>
        <meshStandardMaterial
          key={insideKey}
          map={textures?.inside}
          color={textures ? "#ffffff" : "#efe6d3"}
          side={THREE.BackSide}
          roughness={0.9}
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
}: {
  node: PanelNode;
  parentW: number;
  parentH: number;
  foldAmount: number;
  texturesById: Map<string, PanelTextures>;
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
      <PanelMesh node={node} textures={texturesById.get(node.id)} />
      {node.children.map((child) => (
        <PanelGroup key={child.id} node={child} parentW={node.w} parentH={node.h} foldAmount={foldAmount} texturesById={texturesById} />
      ))}
    </group>
  );
}

type CameraPreset = "front" | "back" | "left" | "right" | "top" | "iso";
type StudioControls = { current: { target: THREE.Vector3; update: () => void } | null };

function CameraRig({ dims, preset, controlsRef }: { dims: BoxDimensions; preset: CameraPreset; controlsRef: StudioControls }) {
  const { camera } = useThree();
  useEffect(() => {
    const target = new THREE.Vector3(dims.length / 2, dims.height / 2, -dims.width / 2);
    const radius = Math.max(dims.length, dims.width, dims.height) * 2.5;
    const offsets: Record<CameraPreset, [number, number, number]> = {
      front: [0, 0, radius], back: [0, 0, -radius], left: [-radius, 0, 0],
      right: [radius, 0, 0], top: [0, radius, 0], iso: [radius * 0.8, radius * 0.65, radius * 0.9],
    };
    camera.position.copy(target).add(new THREE.Vector3(...offsets[preset]));
    camera.up.set(0, 1, 0);
    if (preset === "top") camera.up.set(0, 0, -1);
    camera.lookAt(target);
    if (controlsRef.current) {
      controlsRef.current.target.copy(target);
      controlsRef.current.update();
    }
  }, [camera, controlsRef, dims.height, dims.length, dims.width, preset]);
  return null;
}

interface Fold3DProps {
  root: PanelNode;
  dims: BoxDimensions;
  layout: DielineLayout;
  artwork: ArtworkState;
  showDimensions: boolean;
  foldAmount: number;
  onSceneReady?: (group: THREE.Group) => void;
  onCanvasReady?: (canvas: HTMLCanvasElement) => void;
}

export default function Fold3D({ root, dims, layout, artwork, showDimensions, foldAmount, onSceneReady, onCanvasReady }: Fold3DProps) {
  const texturesById = usePanelTextures(layout, artwork, 6, showDimensions);
  const groupRef = useRef<THREE.Group>(null);
  const controlsRef = useRef<StudioControls["current"]>(null);
  const [studioOpen, setStudioOpen] = useState(false);
  const [background, setBackground] = useState("#1c1f26");
  const [ambient, setAmbient] = useState(0.75);
  const [keyLight, setKeyLight] = useState(0.9);
  const [preset, setPreset] = useState<CameraPreset>("iso");
  const presets: { id: CameraPreset; label: string }[] = [
    { id: "front", label: "Front" }, { id: "back", label: "Back" }, { id: "left", label: "Left" },
    { id: "right", label: "Right" }, { id: "top", label: "Top" }, { id: "iso", label: "Iso" },
  ];

  return (
    <div className="fold3d-root">
      <Canvas className="fold3d-canvas" dpr={[1, 2]} gl={{ preserveDrawingBuffer: true, antialias: true, alpha: false }} camera={{ position: [260, 220, 320], fov: 40, near: 1, far: 5000 }} onCreated={({ gl }) => onCanvasReady?.(gl.domElement)}>
        <color attach="background" args={[background]} />
        <ambientLight intensity={ambient} />
        <directionalLight position={[300, 400, 200]} intensity={keyLight} />
        <directionalLight position={[-200, 150, -300]} intensity={keyLight * 0.45} />
        <directionalLight position={[0, -250, 100]} intensity={keyLight * 0.25} />
        <group ref={(g) => { groupRef.current = g; if (g && onSceneReady) onSceneReady(g); }}>
          <PanelGroup node={root} parentW={root.w} parentH={root.h} foldAmount={foldAmount} texturesById={texturesById} />
        </group>
        <CameraRig dims={dims} preset={preset} controlsRef={controlsRef} />
        <Suspense fallback={null}>
          <OrbitControls ref={controlsRef as never} makeDefault enableDamping dampingFactor={0.08} minDistance={5} maxDistance={20000} minPolarAngle={0} maxPolarAngle={Math.PI} minAzimuthAngle={-Infinity} maxAzimuthAngle={Infinity} />
        </Suspense>
      </Canvas>
      <div className="studio-trigger-wrap">
        <button type="button" className={`studio-trigger${studioOpen ? " active" : ""}`} onClick={() => setStudioOpen((open) => !open)} aria-expanded={studioOpen}>✦ Studio</button>
        {studioOpen && <section className="studio-panel" aria-label="3D studio settings">
          <header><strong>3D Studio</strong><button type="button" className="icon-btn" onClick={() => setStudioOpen(false)} aria-label="Close studio controls">×</button></header>
          <div className="studio-section"><span className="studio-label">Camera angle</span><div className="studio-angle-grid">
            {presets.map((item) => <button key={item.id} type="button" className={preset === item.id ? "selected" : ""} onClick={() => setPreset(item.id)}>{item.label}</button>)}
          </div></div>
          <div className="studio-section"><span className="studio-label">Background</span><div className="studio-backgrounds">
            {["#1c1f26", "#f2f4f7", "#ffffff", "#dce4ec", "#121a2b"].map((color) => <button key={color} type="button" aria-label={`Background ${color}`} title={color} className={background === color ? "selected" : ""} style={{ background: color }} onClick={() => setBackground(color)} />)}
            <input type="color" aria-label="Custom background color" value={background} onChange={(event) => setBackground(event.target.value)} />
          </div></div>
          <label className="studio-light-slider">Ambient light <b>{ambient.toFixed(1)}</b><input type="range" min="0.1" max="2" step="0.05" value={ambient} onChange={(event) => setAmbient(Number(event.target.value))} /></label>
          <label className="studio-light-slider">Key light <b>{keyLight.toFixed(1)}</b><input type="range" min="0.1" max="2" step="0.05" value={keyLight} onChange={(event) => setKeyLight(Number(event.target.value))} /></label>
          <p className="studio-hint">Drag to orbit; scroll to zoom.</p>
        </section>}
      </div>
    </div>
  );
}
