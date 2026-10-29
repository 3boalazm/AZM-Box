import type { BoxDimensions } from "./types";

/** Keep the user's physical box size while seeding style-specific closures from the new template. */
export function transferDimensionsToTemplate(current: BoxDimensions, nextDefaults: BoxDimensions): BoxDimensions {
  return {
    ...nextDefaults,
    length: current.length,
    width: current.width,
    height: current.height,
  };
}
