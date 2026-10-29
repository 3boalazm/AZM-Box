import { BOX_STYLES } from "../src/geometry/boxBuilders";
import { transferDimensionsToTemplate } from "../src/geometry/templateDimensions";

const current = { length: 123, width: 67, height: 175, flaps: { front: 42 }, endFlapRight: 33 };
const target = BOX_STYLES.find((style) => style.id === "reverse-tuck-end")!;
const next = transferDimensionsToTemplate(current, target.defaultDimensions);
const checks = [
  ["length is preserved", next.length === 123],
  ["width is preserved", next.width === 67],
  ["height is preserved", next.height === 175],
  ["style-specific flap overrides reset to target defaults", next.flaps === target.defaultDimensions.flaps],
  ["glue flap resets to target default", next.endFlapRight === target.defaultDimensions.endFlapRight],
] as const;
let failed = false;
for (const [label, pass] of checks) {
  console.log(`${pass ? "ok  " : "FAIL"} ${label}`);
  failed ||= !pass;
}
if (failed) process.exit(1);
console.log("\nALL STYLE-SWITCH CHECKS PASSED");
