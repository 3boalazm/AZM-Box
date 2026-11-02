import type { BoxDimensions } from "./types";

/** Keep the user's physical box size while seeding style-specific closures from the new template. */
export function transferDimensionsToTemplate(current: BoxDimensions, nextDefaults: BoxDimensions, keepCustom = false): BoxDimensions {
  // Board thickness and the inside/outside basis describe the material and how
  // the size was measured, not the template, so they always travel with the box.
  const material = {
    // How the die-cut is laid over the artwork is a project choice, not a template one.
    ...(current.flipX ? { flipX: true } : {}),
    ...(current.flipY ? { flipY: true } : {}),
    ...(current.materialThickness !== undefined ? { materialThickness: current.materialThickness } : {}),
    ...(current.dimensionBasis !== undefined ? { dimensionBasis: current.dimensionBasis } : {}),
  };
  if (!keepCustom) {
    return {
      ...nextDefaults,
      length: current.length,
      width: current.width,
      height: current.height,
      ...material,
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
    ...material,
    ...(current.endFlapLeft !== undefined ? { endFlapLeft: current.endFlapLeft } : {}),
    ...(current.endFlapRight !== undefined ? { endFlapRight: current.endFlapRight } : {}),
    ...(current.flaps ? { flaps: current.flaps } : {}),
    ...(current.flapEdges ? { flapEdges: current.flapEdges } : {}),
    ...(current.flapWidths ? { flapWidths: current.flapWidths } : {}),
    ...(current.flapShapes ? { flapShapes: current.flapShapes } : {}),
  };
}
