import * as THREE from "three";
import { getCameraMouseButtons } from "../src/components/cameraControls";

const checks = [
  ["Orbit maps left drag to rotate", getCameraMouseButtons("orbit").LEFT === THREE.MOUSE.ROTATE],
  ["Orbit keeps right-drag pan available", getCameraMouseButtons("orbit").RIGHT === THREE.MOUSE.PAN],
  ["Pan maps left drag to pan", getCameraMouseButtons("pan").LEFT === THREE.MOUSE.PAN],
  ["Zoom maps left drag to dolly", getCameraMouseButtons("zoom").LEFT === THREE.MOUSE.DOLLY],
  ["Space temporarily maps left drag to pan", getCameraMouseButtons("orbit", true).LEFT === THREE.MOUSE.PAN],
  ["middle-drag zoom remains available in every mode", (["orbit", "pan", "zoom"] as const).every((mode) => getCameraMouseButtons(mode).MIDDLE === THREE.MOUSE.DOLLY)],
  ["right-drag pan remains available in every mode", (["orbit", "pan", "zoom"] as const).every((mode) => getCameraMouseButtons(mode).RIGHT === THREE.MOUSE.PAN)],
] as const;
let failures = 0;
for (const [label, pass] of checks) {
  console.log(`${pass ? "ok  " : "FAIL"} ${label}`);
  if (!pass) failures++;
}
if (failures) process.exit(1);
console.log("\nALL CAMERA-CONTROL CHECKS PASSED");
