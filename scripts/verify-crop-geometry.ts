import { readFileSync } from "node:fs";
import { moveCropRect, resizeCropRect } from "../src/artwork/cropGeometry";

let failures = 0;
const check = (label: string, ok: boolean) => { console.log(`${ok ? "ok  " : "FAIL"} ${label}`); if (!ok) failures++; };
const close = (a: number, b: number) => Math.abs(a - b) < 1e-9;
const start = { left: 20, top: 20, width: 60, height: 60 };
const corners = [
  ["north-west", "nw", -50, -50, { left: 0, top: 0, width: 80, height: 80 }],
  ["north-east", "ne", 50, -50, { left: 20, top: 0, width: 80, height: 80 }],
  ["south-west", "sw", -50, 50, { left: 0, top: 20, width: 80, height: 80 }],
  ["south-east", "se", 50, 50, { left: 20, top: 20, width: 80, height: 80 }],
] as const;
for (const [label, mode, dx, dy, expected] of corners) {
  const actual = resizeCropRect(start, mode, dx, dy);
  check(`${label} crop handle resizes both crop bounds`, Object.keys(expected).every((key) => close(actual[key as keyof typeof actual], expected[key as keyof typeof expected])));
}
const moved = moveCropRect(start, -100, 120);
check("crop body drag clamps inside image boundaries", moved.left === 0 && moved.top === 40 && moved.width === 60 && moved.height === 60);
const tiny = resizeCropRect({ left: 10, top: 10, width: 80, height: 80 }, "nw", 200, 200);
check("crop handles preserve a minimum crop size", tiny.width >= 5 && tiny.height >= 5 && tiny.left + tiny.width <= 100 && tiny.top + tiny.height <= 100);

const css = readFileSync(new URL("../src/App.css", import.meta.url), "utf8");
check("crop selection explicitly receives pointer events", /\.crop-selection,\.crop-handle\s*\{[^}]*pointer-events:auto/s.test(css));
console.log(failures === 0 ? "\nALL CROP INTERACTION CHECKS PASSED" : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
