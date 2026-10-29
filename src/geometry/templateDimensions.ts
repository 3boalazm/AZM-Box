import type { BoxDimensions } from "./types";

/** Keep the user's physical box size while seeding style-specific closures from the new template. */
export function transferDimensionsToTemplate(current: BoxDimensions, nextDefaults: BoxDimensions, keepCustom = false): BoxDimensions {
  if (!keepCustom) {
    return {
      ...nextDefaults,
      length: current.length,
      width: current.width,
      height: current.height,
    };
  }

  // These fields describe corresponding closure edges/profiles across box styles.
  // Template-only dimensions (for example, a mailer lid depth) stay in that
  // style's memory rather than being applied to a template that does not use them.
  return {
    ...nextDefaults,
    length: current.length,
    width: current.width,
    height: current.height,
    ...(current.endFlapLeft !== undefined ? { endFlapLeft: current.endFlapLeft } : {}),
    ...(current.endFlapRight !== undefined ? { endFlapRight: current.endFlapRight } : {}),
    ...(current.flaps ? { flaps: current.flaps } : {}),
    ...(current.flapEdges ? { flapEdges: current.flapEdges } : {}),
    ...(current.flapWidths ? { flapWidths: current.flapWidths } : {}),
    ...(current.flapShapes ? { flapShapes: current.flapShapes } : {}),
  };
}
