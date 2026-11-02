import type { ArtworkState } from "./types";

/**
 * Places `dataUrl` as the full-sheet artwork of one side, fitted to the dieline
 * bounds. Shared by the "Place artwork" button and drag & drop onto the canvas.
 */
export function placeSheetImage(
  artwork: ArtworkState,
  side: "outside" | "inside",
  dataUrl: string,
  bounds: { width: number; height: number },
): ArtworkState {
  return {
    ...artwork,
    [side]: {
      ...artwork[side],
      sheetImage: dataUrl,
      sheetOffset: { x: 0, y: 0 },
      sheetWidth: bounds.width,
      sheetHeight: bounds.height,
      sheetRotation: 0,
    },
  };
}
