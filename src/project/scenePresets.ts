import type { CameraPose, SceneSettings } from "./sceneSettings";

/**
 * A saved set of product shots that can be replayed on any box.
 *
 * The point of a preset is that two different products come out looking like a
 * family, so the one thing a shot must NOT store is a camera distance in mm: a
 * 135 mm carton and a 90 mm one at the same distance fill different amounts of
 * the frame, and the set stops matching. A shot stores an angle and how much of
 * the frame the box should fill; the distance is worked out per box from its own
 * size. Everything about the look — background, lights, material — is shared by
 * every shot in the preset, which is the other half of making them match.
 */

export interface ShotFraming {
  id: string;
  label: string;
  /** Degrees around the vertical axis, 0 = straight at the front face. */
  azimuth: number;
  /** Degrees above the horizon, positive looks down on the box. */
  elevation: number;
  /** Vertical field of view in degrees. Longer lenses flatten perspective. */
  fov: number;
  /**
   * Fraction of the frame's height the box's bounding sphere should take up.
   * 1 touches the top and bottom edges, so anything below that is margin.
   */
  fill: number;
}

/** The part of the scene every shot in a preset shares. */
export type SceneLook = Pick<
  SceneSettings,
  | "background" | "transparentBackground" | "environment" | "ambient" | "exposure"
  | "envLight" | "lights" | "floor" | "shadows" | "material" | "materialParams"
>;

export interface ScenePreset {
  name: string;
  look: SceneLook;
  shots: ShotFraming[];
}

export interface BoxBounds {
  min: [number, number, number];
  max: [number, number, number];
}

/** Centre of the box — what every shot points at. */
export function boundsCentre(b: BoxBounds): [number, number, number] {
  return [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
}

/** Radius of the sphere that encloses the box, which is what framing scales from. */
export function boundsRadius(b: BoxBounds): number {
  const dx = b.max[0] - b.min[0], dy = b.max[1] - b.min[1], dz = b.max[2] - b.min[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz) / 2;
}

/**
 * Camera pose that frames `bounds` the way `shot` asks for.
 *
 * The distance comes out of the field of view: at distance d a sphere of radius
 * r subtends 2*asin(r/d), so to have it cover `fill` of a frame that is `fov`
 * tall, d = r / sin(fov * fill / 2). Scale the box and the distance scales with
 * it, which is exactly what keeps two products the same size on the page.
 */
export function cameraPoseForShot(shot: ShotFraming, bounds: BoxBounds): CameraPose {
  const target = boundsCentre(bounds);
  const radius = boundsRadius(bounds);
  const half = (shot.fov * Math.PI) / 180 / 2;
  const distance = radius / Math.max(0.05, Math.sin(half * Math.min(1, Math.max(0.05, shot.fill))));
  const az = (shot.azimuth * Math.PI) / 180;
  const el = (shot.elevation * Math.PI) / 180;
  return {
    position: [
      target[0] + Math.sin(az) * Math.cos(el) * distance,
      target[1] + Math.sin(el) * distance,
      target[2] + Math.cos(az) * Math.cos(el) * distance,
    ],
    target,
    up: [0, 1, 0],
  };
}

/** How far the box's bounding sphere spans vertically, as a fraction of the frame. */
export function framedFraction(pose: CameraPose, bounds: BoxBounds, fov: number): number {
  const target = boundsCentre(bounds);
  const radius = boundsRadius(bounds);
  const d = Math.hypot(pose.position[0] - target[0], pose.position[1] - target[1], pose.position[2] - target[2]);
  if (d <= radius) return 1;
  return (2 * Math.asin(radius / d)) / ((fov * Math.PI) / 180);
}

/** The six shots: the same six for every product, so a range photographs as a set. */
export const PRODUCT_SHOTS: ShotFraming[] = [
  { id: "hero",   label: "Hero",        azimuth: 26,   elevation: 12, fov: 32, fill: 0.78 },
  { id: "front",  label: "Front",       azimuth: 0,    elevation: 4,  fov: 30, fill: 0.80 },
  { id: "side",   label: "Side",        azimuth: 90,   elevation: 4,  fov: 30, fill: 0.80 },
  { id: "back",   label: "Back",        azimuth: 180,  elevation: 4,  fov: 30, fill: 0.80 },
  { id: "top",    label: "Top",         azimuth: 26,   elevation: 62, fov: 34, fill: 0.76 },
  { id: "detail", label: "Close angle", azimuth: -38,  elevation: 20, fov: 24, fill: 0.95 },
];
