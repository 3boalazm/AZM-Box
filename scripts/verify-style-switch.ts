import { BOX_STYLES } from "../src/geometry/boxBuilders";
import { transferDimensionsToTemplate } from "../src/geometry/templateDimensions";

const current = {
  length: 123, width: 67, height: 175, flaps: { front: 42 }, endFlapRight: 33,
  flapEdges: { top: { front: 29 }, bottom: { back: 18 } },
  flapWidths: { front: 84 }, flapShapes: { front: "tuck" as const }, lidDepth: 61,
};
const target = BOX_STYLES.find((style) => style.id === "reverse-tuck-end")!;
const carried = transferDimensionsToTemplate(current, target.defaultDimensions, true);
const reset = transferDimensionsToTemplate(current, target.defaultDimensions);
const checks = [
  ["length, width, and height are preserved in both choices", carried.length === 123 && carried.width === 67 && carried.height === 175 && reset.length === 123 && reset.width === 67 && reset.height === 175],
  ["shared flap and closure overrides carry when requested", carried.flaps?.front === 42 && carried.endFlapRight === 33 && carried.flapEdges?.top?.front === 29 && carried.flapWidths?.front === 84 && carried.flapShapes?.front === "tuck"],
  ["template-only lid depth is not applied to an incompatible template", carried.lidDepth === undefined],
  ["Cancel/default choice uses target-specific settings", reset.flaps === target.defaultDimensions.flaps && reset.endFlapRight === target.defaultDimensions.endFlapRight && reset.lidDepth === undefined],
] as const;
let failed = false;
for (const [label, pass] of checks) {
  console.log(`${pass ? "ok  " : "FAIL"} ${label}`);
  failed ||= !pass;
}
if (failed) process.exit(1);
console.log("\nALL STYLE-SWITCH CHECKS PASSED");
