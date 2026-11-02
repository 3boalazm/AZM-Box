import { readFileAsDataURL } from "../lib/files";

/**
 * SVG artwork is stored as an `image/svg+xml` data URL just like a raster image,
 * but it is kept as markup all the way to the export so it stays vector: it is
 * re-drawn at the destination size on screen and embedded as vector in SVG/PDF.
 */

const SVG_MIME = "image/svg+xml";
const UNIT_TO_PX: Record<string, number> = { "": 1, px: 1, pt: 96 / 72, pc: 16, mm: 96 / 25.4, cm: 96 / 2.54, in: 96 };
const DANGEROUS_ELEMENTS = new Set(["script", "foreignobject", "iframe", "object", "embed", "audio", "video", "canvas"]);
// Anything that is not an in-document reference or an embedded image would make the
// artwork depend on (or call out to) something outside the project file.
const SAFE_REFERENCE = /^\s*(#|data:image\/)/i;

export function isSvgSource(src: string | undefined): src is string {
  return !!src && /^\s*data:image\/svg\+xml/i.test(src);
}

export function isSvgFile(file: File): boolean {
  return file.type === SVG_MIME || /\.svg$/i.test(file.name);
}

export function encodeSvgDataUrl(svg: string): string {
  return `data:${SVG_MIME};charset=utf-8,${encodeURIComponent(svg)}`;
}

export function decodeSvgDataUrl(src: string): string {
  const comma = src.indexOf(",");
  if (comma < 0) throw new Error("This SVG file could not be read.");
  const head = src.slice(0, comma);
  const body = src.slice(comma + 1);
  if (/;base64/i.test(head)) {
    const binary = atob(body.replace(/\s/g, ""));
    return new TextDecoder("utf-8").decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
  }
  return decodeURIComponent(body);
}

function lengthToPx(value: string | null): number | null {
  const match = value?.trim().match(/^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)([a-z]*)$/i);
  if (!match) return null;
  const factor = UNIT_TO_PX[match[2].toLowerCase()];
  const number = Number(match[1]);
  return factor !== undefined && Number.isFinite(number) && number > 0 ? number * factor : null;
}

function parseViewBox(value: string | null): [number, number, number, number] | null {
  const parts = value?.trim().split(/[\s,]+/).map(Number);
  if (!parts || parts.length !== 4 || parts.some((part) => !Number.isFinite(part)) || parts[2] <= 0 || parts[3] <= 0) return null;
  return parts as [number, number, number, number];
}

function stripUnsafeStyle(css: string): string {
  return css.replace(/@import[^;]*;?/gi, "").replace(/url\(\s*(['"]?)(?!#|data:)[^)]*\)/gi, "none");
}

/** Removes everything in the markup that could run code or load something external. */
function sanitize(root: Element) {
  for (const element of [root, ...Array.from(root.querySelectorAll("*"))]) {
    if (DANGEROUS_ELEMENTS.has(element.localName.toLowerCase())) {
      element.remove();
      continue;
    }
    if (element.localName.toLowerCase() === "style") element.textContent = stripUnsafeStyle(element.textContent ?? "");
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith("on")) element.removeAttribute(attribute.name);
      else if ((name === "href" || name.endsWith(":href")) && !SAFE_REFERENCE.test(attribute.value)) element.removeAttribute(attribute.name);
      else if (name === "style") element.setAttribute(attribute.name, stripUnsafeStyle(attribute.value));
    }
  }
}

/** Measures drawn content for the rare SVG that declares neither a viewBox nor a size. */
function measureContent(root: Element): [number, number, number, number] | null {
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-99999px;top:0;visibility:hidden;pointer-events:none";
  const clone = document.importNode(root, true) as unknown as SVGSVGElement;
  host.appendChild(clone);
  document.body.appendChild(host);
  try {
    const box = clone.getBBox();
    return box.width > 0 && box.height > 0 ? [box.x, box.y, box.width, box.height] : null;
  } catch {
    return null;
  } finally {
    document.body.removeChild(host);
  }
}

export interface PreparedSvg {
  dataUrl: string;
  /** Intrinsic proportions, in SVG user units. */
  width: number;
  height: number;
}

/**
 * Validates and normalises SVG markup for use as artwork: scripts and external
 * references are removed, and a viewBox plus a matching width/height are always
 * present so every renderer agrees on the artwork's proportions. The root is set
 * to stretch to whatever box it is placed in, exactly like a raster image.
 */
export function prepareSvg(text: string): PreparedSvg {
  const doc = new DOMParser().parseFromString(text, SVG_MIME);
  const root = doc.documentElement;
  if (!root || root.localName.toLowerCase() !== "svg" || doc.getElementsByTagName("parsererror").length > 0) {
    throw new Error("This SVG file could not be read.");
  }
  sanitize(root);

  let viewBox = parseViewBox(root.getAttribute("viewBox"));
  if (!viewBox) {
    const w = lengthToPx(root.getAttribute("width"));
    const h = lengthToPx(root.getAttribute("height"));
    viewBox = w && h ? [0, 0, w, h] : measureContent(root);
  }
  if (!viewBox) throw new Error("This SVG has no size, so it cannot be placed.");

  root.setAttribute("viewBox", viewBox.join(" "));
  root.setAttribute("width", String(viewBox[2]));
  root.setAttribute("height", String(viewBox[3]));
  root.setAttribute("preserveAspectRatio", "none");
  if (!root.getAttribute("xmlns")) root.setAttribute("xmlns", "http://www.w3.org/2000/svg");

  return { dataUrl: encodeSvgDataUrl(new XMLSerializer().serializeToString(root)), width: viewBox[2], height: viewBox[3] };
}

/**
 * Crops SVG artwork by moving its viewBox, which keeps it vector. The rectangle is
 * given as percentages of the current artwork, like the raster crop tool.
 */
export function cropSvgDataUrl(src: string, crop: { left: number; top: number; width: number; height: number }): string {
  const doc = new DOMParser().parseFromString(decodeSvgDataUrl(src), SVG_MIME);
  const root = doc.documentElement;
  const viewBox = parseViewBox(root.getAttribute("viewBox"));
  if (!viewBox) throw new Error("This SVG file could not be read.");
  const [x, y, w, h] = viewBox;
  const next = [x + (crop.left / 100) * w, y + (crop.top / 100) * h, (crop.width / 100) * w, (crop.height / 100) * h];
  root.setAttribute("viewBox", next.map((value) => Number(value.toFixed(4))).join(" "));
  root.setAttribute("width", String(Number(next[2].toFixed(4))));
  root.setAttribute("height", String(Number(next[3].toFixed(4))));
  return encodeSvgDataUrl(new XMLSerializer().serializeToString(root));
}

/** Reads an artwork file: SVG stays vector markup, everything else becomes a raster data URL. */
export async function readArtworkFile(file: File): Promise<string> {
  if (!isSvgFile(file)) return readFileAsDataURL(file);
  return prepareSvg(await file.text()).dataUrl;
}
