export interface CropRect {
  left: number;
  top: number;
  width: number;
  height: number;
}
export type CropDragMode = "move" | "nw" | "ne" | "sw" | "se";

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function moveCropRect(start: CropRect, dx: number, dy: number): CropRect {
  return {
    ...start,
    left: clamp(start.left + dx, 0, 100 - start.width),
    top: clamp(start.top + dy, 0, 100 - start.height),
  };
}

export function resizeCropRect(start: CropRect, mode: Exclude<CropDragMode, "move">, dx: number, dy: number, minSize = 5): CropRect {
  let left = start.left;
  let top = start.top;
  let right = start.left + start.width;
  let bottom = start.top + start.height;
  if (mode.includes("w")) left = clamp(start.left + dx, 0, right - minSize);
  if (mode.includes("e")) right = clamp(start.left + start.width + dx, left + minSize, 100);
  if (mode.includes("n")) top = clamp(start.top + dy, 0, bottom - minSize);
  if (mode.includes("s")) bottom = clamp(start.top + start.height + dy, top + minSize, 100);
  return { left, top, width: right - left, height: bottom - top };
}
