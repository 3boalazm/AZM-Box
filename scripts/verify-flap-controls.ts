import { getBoxStyle } from "../src/geometry/boxBuilders";
import { computeFlatLayout, flattenTree } from "../src/geometry/layout";

let failures = 0;
const check = (label: string, ok: boolean) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}`);
  if (!ok) failures++;
};

const style = getBoxStyle("hsc");
const base = style.defaultDimensions;
const dims = {
  ...base,
  flapEdges: { top: { front: 30 }, bottom: { front: 0 } },
  flapWidths: { front: 80 },
  flapShapes: { front: "tuck" as const },
};
const root = style.build(dims);
const nodes = flattenTree(root);
const topFront = nodes.find((node) => node.face === "flap-top-front");
const bottomFront = nodes.find((node) => node.face === "flap-bottom-front");
const layout = computeFlatLayout(root);
const flatTop = layout.panels.find((panel) => panel.face === "flap-top-front");
const parent = nodes.find((node) => node.face === "front");

check("positive depth adds a flap on a normally open side", Boolean(topFront));
check("zero depth removes only that edge's flap", !bottomFront && !layout.panels.some((panel) => panel.face === "flap-bottom-front"));
check("flap depth is applied in millimeters", topFront?.h === 30);
check("flap width is independent from depth", topFront?.w === 80);
check("narrow flap is centered along its wall", Math.abs((topFront?.parentOffset ?? 0) - ((parent?.w ?? 0) - 80) / 2) < 1e-6);
check("selected tuck profile reaches the flat layout", Boolean(flatTop && flatTop.points.length >= 7));

console.log(failures === 0 ? "\nALL FLAP CONTROL CHECKS PASSED" : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
