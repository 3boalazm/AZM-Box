import * as THREE from "three";
import type { SurfaceTexture } from "../project/sceneSettings";

const SIZE = 256;

// Deterministic so a texture looks the same every session and in every export.
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function paint(kind: Exclude<SurfaceTexture, "none">): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d")!;
  const random = mulberry32(kind === "grain" ? 11 : kind === "linen" ? 23 : 37);
  ctx.fillStyle = "#808080";
  ctx.fillRect(0, 0, SIZE, SIZE);

  if (kind === "grain") {
    // Fine speckle, like uncoated or soft-touch board. Per-pixel noise tiles perfectly.
    const image = ctx.getImageData(0, 0, SIZE, SIZE);
    for (let i = 0; i < image.data.length; i += 4) {
      const v = 128 + (random() - 0.5) * 120;
      image.data[i] = image.data[i + 1] = image.data[i + 2] = v;
      image.data[i + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
  } else if (kind === "linen") {
    // Woven threads: horizontal and vertical lines of slightly varying brightness.
    for (let y = 0; y < SIZE; y += 2) {
      ctx.fillStyle = `rgba(${random() > 0.5 ? "255,255,255" : "0,0,0"},${0.12 + random() * 0.2})`;
      ctx.fillRect(0, y, SIZE, 1);
    }
    for (let x = 0; x < SIZE; x += 2) {
      ctx.fillStyle = `rgba(${random() > 0.5 ? "255,255,255" : "0,0,0"},${0.1 + random() * 0.18})`;
      ctx.fillRect(x, 0, 1, SIZE);
    }
  } else {
    // Recycled / kraft fibres: short random strokes. Drawn at wrapped offsets so edges tile.
    for (let i = 0; i < 1400; i++) {
      const x = random() * SIZE;
      const y = random() * SIZE;
      const angle = random() * Math.PI;
      const length = 4 + random() * 14;
      ctx.strokeStyle = `rgba(${random() > 0.5 ? "255,255,255" : "0,0,0"},${0.1 + random() * 0.22})`;
      ctx.lineWidth = 0.6 + random() * 0.9;
      for (const [ox, oy] of [[0, 0], [SIZE, 0], [-SIZE, 0], [0, SIZE], [0, -SIZE]]) {
        ctx.beginPath();
        ctx.moveTo(x + ox, y + oy);
        ctx.lineTo(x + ox + Math.cos(angle) * length, y + oy + Math.sin(angle) * length);
        ctx.stroke();
      }
    }
  }
  return canvas;
}

const cache = new Map<SurfaceTexture, THREE.CanvasTexture>();

/**
 * A tiling bump texture for one board surface, repeated so one tile covers
 * `scaleMm` of the panel in both directions regardless of the panel's size.
 */
export function surfaceBumpTexture(kind: SurfaceTexture, panelW: number, panelH: number, scaleMm: number): THREE.Texture | undefined {
  if (kind === "none" || typeof document === "undefined") return undefined;
  let base = cache.get(kind);
  if (!base) {
    base = new THREE.CanvasTexture(paint(kind));
    base.wrapS = base.wrapT = THREE.RepeatWrapping;
    cache.set(kind, base);
  }
  const texture = base.clone();
  texture.repeat.set(Math.max(0.01, panelW / scaleMm), Math.max(0.01, panelH / scaleMm));
  texture.needsUpdate = true;
  return texture;
}
