import * as THREE from "three";

export type CameraNavigationMode = "orbit" | "pan" | "zoom";
export type CameraMouseButtons = { LEFT: THREE.MOUSE; MIDDLE: THREE.MOUSE; RIGHT: THREE.MOUSE };

/** Map each explicit toolbar mode to OrbitControls mouse behavior without disabling other navigation paths. */
export function getCameraMouseButtons(mode: CameraNavigationMode, spacePan = false): CameraMouseButtons {
  if (spacePan || mode === "pan") {
    return { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
  }
  if (mode === "zoom") {
    return { LEFT: THREE.MOUSE.DOLLY, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
  }
  return { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
}
