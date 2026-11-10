import { useEffect, useState } from "react";
import * as THREE from "three";
import type { DielineLayout } from "../geometry/types";
import type { ArtworkState } from "./types";
import { buildSheetCanvas, renderPanelCanvas } from "./renderPanel";

export interface PanelTextures {
  outside: THREE.CanvasTexture;
  inside: THREE.CanvasTexture;
}

/**
 * Longest edge we will rasterize the full sheet to. 4096 is the texture size
 * every WebGL2 device we care about supports, and it keeps the intermediate
 * sheet canvas under ~16M pixels so rasterizing does not stall the tab.
 */
const SHEET_MAX_EDGE = 4096;

/**
 * Pixels per millimetre to rasterize at: as close to `target` as the sheet's
 * own size allows. A small carton gets the full target (a 135 mm panel at
 * 12 px/mm is ~300 DPI, enough for the 6 pt legal copy on a supplement box);
 * a large sheet is scaled down so the canvas stays within SHEET_MAX_EDGE.
 */
function fitPxPerMm(layout: DielineLayout, target: number): number {
  const longest = Math.max(layout.bounds.width, layout.bounds.height, 1);
  return Math.max(2, Math.min(target, SHEET_MAX_EDGE / longest));
}

/**
 * Printed artwork is mostly fine, high-contrast detail, and a panel is almost
 * always seen at an angle, which is the worst case for the GPU's default
 * filtering: with anisotropy 1 it picks a mip level from the axis that is
 * squashed hardest, so 6 pt text averages into the background and the panel
 * reads as faded — then shimmers as the camera moves and that mip choice flips
 * between levels. Anisotropic sampling takes several taps along the squashed
 * axis instead, which is what keeps small type legible and stops the crawl.
 * Three clamps the value to whatever the device actually supports.
 */
function sharpen(texture: THREE.Texture): void {
  texture.anisotropy = 16;
  texture.generateMipmaps = true;
  // Trilinear: blend between mip levels rather than snapping, so there is no
  // visible pop at the distance where the level changes.
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
}

/**
 * Rasterizes every panel's outside/inside face into a Three.js CanvasTexture.
 * When `showDimensions` is on, each panel's outside face also gets its width x
 * height "printed" right on the texture, so the label rides along with the
 * panel through every fold rotation instead of needing a separate screen-space
 * overlay (which would have to be re-projected and re-oriented every frame).
 */
export function usePanelTextures(layout: DielineLayout, artwork: ArtworkState, targetPxPerMm = 12, showDimensions = false): Map<string, PanelTextures> {
  const [textures, setTextures] = useState<Map<string, PanelTextures>>(new Map());

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const pxPerMm = fitPxPerMm(layout, targetPxPerMm);
      // Inside faces are seen rarely, at shallow angles, and carry almost none of
      // the fine print that forced the outside up to ~300 DPI. Rasterizing them at
      // half density costs nothing visible and takes three quarters off their share
      // of the texture memory, which is what pays for the sharper outside faces.
      const insidePxPerMm = Math.max(2, pxPerMm / 2);
      const outsideSheet = await buildSheetCanvas(artwork.outside, layout, pxPerMm);
      const insideSheet = await buildSheetCanvas(artwork.inside, layout, insidePxPerMm);
      const map = new Map<string, PanelTextures>();

      // Rasterising every panel in one go blocked the main thread for most of a
      // second, which is what made a layer toggle or a tab switch feel like the
      // app had seized. The total work is the same, but yielding between panels
      // turns one long task into a dozen short ones, so the UI keeps responding
      // and the browser can paint in between.
      let since = performance.now();
      for (const panel of layout.panels) {
        if (performance.now() - since > 16) {
          await new Promise((resolve) => setTimeout(resolve, 0));
          if (cancelled) break;
          since = performance.now();
        }
        const label = showDimensions ? `${panel.w.toFixed(0)} × ${panel.h.toFixed(0)}` : undefined;
        const outCanvas = await renderPanelCanvas(panel, artwork.outside, layout, outsideSheet, pxPerMm, label);
        const inCanvas = await renderPanelCanvas(panel, artwork.inside, layout, insideSheet, insidePxPerMm);

        const outTex = new THREE.CanvasTexture(outCanvas);
        outTex.colorSpace = THREE.SRGBColorSpace;
        sharpen(outTex);
        outTex.needsUpdate = true;

        const inTex = new THREE.CanvasTexture(inCanvas);
        inTex.colorSpace = THREE.SRGBColorSpace;
        sharpen(inTex);
        // Mirror horizontally: viewed from the BackSide, the texture would otherwise read backwards.
        inTex.wrapS = THREE.RepeatWrapping;
        inTex.repeat.x = -1;
        inTex.offset.x = 1;
        inTex.needsUpdate = true;

        map.set(panel.id, { outside: outTex, inside: inTex });
      }

      if (cancelled) {
        // Superseded before we finished — release the GPU resources we just made.
        for (const t of map.values()) {
          t.outside.dispose();
          t.inside.dispose();
        }
        return;
      }
      // Free the previous generation's textures. Dragging a size/angle slider
      // re-rasterizes every panel on each change, so without this the old
      // CanvasTextures would accumulate on the GPU for the whole session.
      setTextures((prev) => {
        for (const t of prev.values()) {
          t.outside.dispose();
          t.inside.dispose();
        }
        return map;
      });
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, artwork, targetPxPerMm, showDimensions]);

  return textures;
}
