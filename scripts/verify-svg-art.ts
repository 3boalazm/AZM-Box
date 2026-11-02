import { getBoxStyle } from "../src/geometry/boxBuilders";
import { computeFlatLayout } from "../src/geometry/layout";
import { generateDielineSVG } from "../src/geometry/svgExport";
import { emptySide } from "../src/artwork/types";
import { decodeSvgDataUrl, encodeSvgDataUrl, isSvgSource } from "../src/artwork/svgArt";
import { buildArtworkMarkup, sideHasVectorArt } from "../src/artwork/vectorSheet";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 20" width="10" height="20" preserveAspectRatio="none"><text x="1" y="5">Café ✓ &amp; "quotes"</text></svg>`;
const vectorUrl = encodeSvgDataUrl(svg);
const pngUrl = "data:image/png;base64,iVBORw0KGgo=";

check("an encoded SVG is recognised as vector", isSvgSource(vectorUrl) && !isSvgSource(pngUrl) && !isSvgSource(undefined));
check("SVG data URLs round-trip with non-ASCII text", decodeSvgDataUrl(vectorUrl) === svg);
const base64Url = `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
check("base64 SVG data URLs decode as UTF-8", decodeSvgDataUrl(base64Url) === svg);

const layout = computeFlatLayout(getBoxStyle("tuck-end").build(getBoxStyle("tuck-end").defaultDimensions));
const { width, height } = layout.bounds;
const front = layout.panels.find((p) => p.face === "front")!;

const raster = { ...emptySide("#ffffff"), sheetImage: pngUrl };
check("a raster-only side keeps the bitmap path", !sideHasVectorArt(raster));
check("a vector sheet image is detected", sideHasVectorArt({ ...emptySide("#fff"), sheetImage: vectorUrl }));
check("a vector panel image is detected", sideHasVectorArt({ ...emptySide("#fff"), panelImages: { [front.id]: vectorUrl } }));
check(
  "a vector logo layer is detected",
  sideHasVectorArt({ ...emptySide("#fff"), layers: [{ id: "l", kind: "image", panelId: front.id, x: 1, y: 1, width: 5, height: 5, src: vectorUrl, rotation: 0 }] }),
);

// The sheet image is placed in Y-down sheet space: bottom-left offset becomes a top-left y.
const sheet = { ...emptySide("#ffffff"), sheetImage: vectorUrl, sheetOffset: { x: 12, y: 7 }, sheetWidth: 120, sheetHeight: 80 };
const markup = buildArtworkMarkup(layout, sheet);
const expectedY = (height - 80 - 7).toFixed(3).replace(/\.?0+$/, "");
check("sheet image keeps its position and size", markup.includes(`x="12"`) && markup.includes(`y="${expectedY}"`) && markup.includes(`width="120"`) && markup.includes(`height="80"`), `y=${expectedY}`);
check("the SVG source is embedded as an image, not flattened", markup.includes("data:image/svg+xml") && !markup.includes("data:image/png"));
check("the image stretches to its box like a bitmap", markup.includes(`preserveAspectRatio="none"`));
check("background is painted first", markup.startsWith(`<rect x="0" y="0" width="${Number(width.toFixed(3))}"`));

const rotated = buildArtworkMarkup(layout, { ...sheet, sheetRotation: 30 });
check("rotation turns about the image centre", rotated.includes(`rotate(30 ${12 + 60} ${Number((height - 87 + 40).toFixed(3))})`));

const panelMarkup = buildArtworkMarkup(layout, { ...emptySide("#fff"), panelImages: { [front.id]: vectorUrl } });
check("panel images are clipped to the panel outline", panelMarkup.includes("<clipPath") && panelMarkup.includes(`clip-path="url(#art-clip-`));

const textLayer = buildArtworkMarkup(layout, {
  ...emptySide("#fff"),
  layers: [{ id: "t", kind: "text", panelId: front.id, x: 2, y: 3, text: "A & <B>", fontSize: 6, color: "#112233", rotation: 0 }],
});
check("text layers are escaped", textLayer.includes("A &amp; &lt;B&gt;") && !textLayer.includes("<B>"));

const out = generateDielineSVG(layout, { artworkMarkup: markup, artworkDataUrl: pngUrl, title: "t" });
check("markup wins over a flattened bitmap in the exported SVG", out.includes(`<g id="artwork">`) && out.includes("data:image/svg+xml") && !out.includes("data:image/png"));

if (failures) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
console.log("All SVG artwork checks passed.");
