import type { DielineLayout, FlatPanel } from "../geometry/types";
import { worldToPanelLocal } from "../geometry/types";
import type { EditorLayer, SideArtwork } from "./types";
import { isSvgSource } from "./svgArt";

/** True when a side uses any SVG artwork, i.e. flattening it to a bitmap would lose quality. */
export function sideHasVectorArt(side: SideArtwork): boolean {
  return (
    isSvgSource(side.sheetImage) ||
    Object.values(side.panelImages).some((src) => isSvgSource(src)) ||
    side.layers.some((layer) => layer.kind === "image" && isSvgSource(layer.src))
  );
}

const n = (value: number) => Number(value.toFixed(3));

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function imageTag(src: string, x: number, y: number, width: number, height: number): string {
  return `<image href="${escapeXml(src)}" x="${n(x)}" y="${n(y)}" width="${n(width)}" height="${n(height)}" preserveAspectRatio="none" />`;
}

/**
 * Moves into a panel's own local frame within the sheet (Y-down), mirroring the
 * canvas renderer: a bottom-attached flap's frame runs downward from its hinge,
 * so it is flipped to keep artwork upright.
 */
function panelFrame(panel: FlatPanel, sheetHeight: number): string {
  const move = `translate(${n(panel.min[0])} ${n(sheetHeight - panel.max[1])})`;
  return panel.mirrored ? `${move} translate(0 ${n(panel.h)}) scale(1 -1)` : move;
}

/** The same outline in sheet space (Y-down world mm) — used to clip mirror overlays. */
function panelOutlineWorld(panel: FlatPanel, sheetHeight: number): string {
  return panel.points.map((point, index) => `${index === 0 ? "M" : "L"} ${n(point[0])},${n(sheetHeight - point[1])}`).join(" ") + " Z";
}

function panelOutline(panel: FlatPanel): string {
  return (
    panel.points
      .map((point, index) => {
        const [lx, ly] = worldToPanelLocal(panel, point);
        return `${index === 0 ? "M" : "L"} ${n(lx)},${n(panel.h - ly)}`;
      })
      .join(" ") + " Z"
  );
}

function layerMarkup(layer: EditorLayer, panel: FlatPanel): string {
  if (layer.kind === "text") {
    return (
      `<g transform="translate(${n(layer.x)} ${n(panel.h - layer.y)}) rotate(${n(layer.rotation)})">` +
      `<text x="0" y="0" font-family="sans-serif" font-size="${n(layer.fontSize)}" fill="${escapeXml(layer.color)}" dominant-baseline="hanging">${escapeXml(layer.text)}</text></g>`
    );
  }
  const cx = layer.x + layer.width / 2;
  const cy = panel.h - layer.y - layer.height + layer.height / 2;
  return `<g transform="translate(${n(cx)} ${n(cy)}) rotate(${n(layer.rotation)})">${imageTag(layer.src, -layer.width / 2, -layer.height / 2, layer.width, layer.height)}</g>`;
}

/**
 * Builds the artwork of one side as SVG markup in the dieline's sheet space
 * (Y-down, mm), for embedding straight into the exported SVG/PDF. Unlike the
 * flattened bitmap path, SVG sources stay vector and raster images keep their
 * original resolution. Layer order matches the canvas renderer: background,
 * full-sheet image, per-panel images, then text/logo layers.
 */
export function buildArtworkMarkup(layout: DielineLayout, side: SideArtwork, mirroredIds?: ReadonlySet<string>): string {
  const { width: sheetWidth, height: sheetHeight } = layout.bounds;
  const defs: string[] = [];
  const body: string[] = [`<rect x="0" y="0" width="${n(sheetWidth)}" height="${n(sheetHeight)}" fill="${escapeXml(side.backgroundColor)}" />`];

  if (side.sheetImage) {
    const y = sheetHeight - side.sheetHeight - side.sheetOffset.y;
    const image = imageTag(side.sheetImage, side.sheetOffset.x, y, side.sheetWidth, side.sheetHeight);
    const sheetTag = side.sheetRotation
      ? `<g transform="rotate(${n(side.sheetRotation)} ${n(side.sheetOffset.x + side.sheetWidth / 2)} ${n(y + side.sheetHeight / 2)})">${image}</g>`
      : image;
    body.push(sheetTag);

    // Faces flagged as mirrored (without their own image) get the sheet image
    // re-drawn over their outline, flipped about the face's vertical centre line —
    // the same flip the canvas renderer applies to that face's crop.
    layout.panels.forEach((panel, index) => {
      if (mirroredIds?.has(panel.id) !== true || side.panelImages[panel.id]) return;
      const clipId = `art-mirror-clip-${index}`;
      const cx = (panel.min[0] + panel.max[0]) / 2;
      defs.push(`<clipPath id="${clipId}"><path d="${panelOutlineWorld(panel, sheetHeight)}" /></clipPath>`);
      body.push(`<g clip-path="url(#${clipId})"><g transform="translate(${n(2 * cx)} 0) scale(-1 1)">${sheetTag}</g></g>`);
    });
  }

  layout.panels.forEach((panel, index) => {
    const src = side.panelImages[panel.id];
    if (!src) return;
    const clipId = `art-clip-${index}`;
    defs.push(`<clipPath id="${clipId}"><path d="${panelOutline(panel)}" /></clipPath>`);
    // The flip wraps only the image: the clip above stays in the unflipped panel
    // frame, so the visible region remains the face's true outline.
    const image = mirroredIds?.has(panel.id) === true
      ? `<g transform="translate(${n(panel.w)} 0) scale(-1 1)">${imageTag(src, 0, 0, panel.w, panel.h)}</g>`
      : imageTag(src, 0, 0, panel.w, panel.h);
    body.push(`<g transform="${panelFrame(panel, sheetHeight)}"><g clip-path="url(#${clipId})">${image}</g></g>`);
  });

  for (const panel of layout.panels) {
    const layers = side.layers.filter((layer) => layer.panelId === panel.id);
    if (layers.length === 0) continue;
    body.push(`<g transform="${panelFrame(panel, sheetHeight)}">${layers.map((layer) => layerMarkup(layer, panel)).join("")}</g>`);
  }

  return `${defs.length ? `<defs>${defs.join("")}</defs>` : ""}${body.join("\n    ")}`;
}
