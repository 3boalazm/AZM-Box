/**
 * A scene preset exists so a range of products photographs as a set. The property
 * that has to hold for that is simple to state and easy to get wrong: the same
 * shot, applied to boxes of different sizes, must leave each box taking up the
 * SAME fraction of the frame.
 *
 * Storing a camera distance in millimetres breaks it — that is the trap this
 * checks against, with a fixed-distance camera as the control.
 */
import { PRODUCT_SHOTS, boundsRadius, cameraPoseForShot, framedFraction } from "../src/project/scenePresets";
import type { BoxBounds } from "../src/project/scenePresets";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`  ${ok ? "OK  " : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
}

/** A closed carton occupies length x height x width about the origin. */
const box = (l: number, h: number, w: number): BoxBounds => ({ min: [0, 0, -w], max: [l, h, 0] });

const products: Array<[string, BoxBounds]> = [
  ["Proxeed Plus  135x70x95", box(135, 95, 70)],
  ["Erex           90x45x120", box(90, 120, 45)],
  ["Wonen         160x80x60 ", box(160, 60, 80)],
  ["tiny sachet    40x20x70 ", box(40, 70, 20)],
  ["bulk carton   400x300x250", box(400, 250, 300)],
];

console.log("Each shot must frame every product to the same fraction of the frame:\n");

for (const shot of PRODUCT_SHOTS) {
  const fractions = products.map(([, b]) => framedFraction(cameraPoseForShot(shot, b), b, shot.fov));
  const spread = Math.max(...fractions) - Math.min(...fractions);
  const offTarget = Math.max(...fractions.map((f) => Math.abs(f - shot.fill)));
  check(
    `${shot.label.padEnd(12)} az ${String(shot.azimuth).padStart(4)}°  el ${String(shot.elevation).padStart(3)}°  fill ${shot.fill}`,
    spread < 0.001 && offTarget < 0.001,
    `spread ${spread.toExponential(1)}, off target ${offTarget.toExponential(1)}`,
  );
}

console.log("\nThe camera must stay outside the box, whatever its size:\n");
for (const [name, b] of products) {
  const tooClose = PRODUCT_SHOTS.filter((shot) => {
    const pose = cameraPoseForShot(shot, b);
    const c = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
    const d = Math.hypot(pose.position[0] - c[0], pose.position[1] - c[1], pose.position[2] - c[2]);
    return d <= boundsRadius(b) * 1.05;
  });
  check(name, tooClose.length === 0, tooClose.length ? `inside on ${tooClose.map((s) => s.label).join(", ")}` : `${PRODUCT_SHOTS.length} shots clear`);
}

console.log("\nControl — what a distance stored in millimetres would do instead:\n");
{
  const shot = PRODUCT_SHOTS[0];
  const FIXED_MM = 455; // the distance that happened to suit Proxeed Plus
  const fractions = products.map(([, b]) => {
    const c = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2] as [number, number, number];
    return framedFraction({ position: [c[0], c[1], c[2] + FIXED_MM], target: c, up: [0, 1, 0] }, b, shot.fov);
  });
  const spread = Math.max(...fractions) - Math.min(...fractions);
  console.log(`  fractions: ${fractions.map((f) => f.toFixed(2)).join(", ")}`);
  check("a fixed distance does NOT frame them alike", spread > 0.1, `spread ${spread.toFixed(2)} of the frame`);
}

console.log(failures === 0 ? "\nAll scene-preset checks passed." : `\n${failures} scene-preset check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
