export interface RootAnchor {
  x: number;
  y: number;
}

export interface SheetOffset {
  x: number;
  y: number;
}

/**
 * Rebase a full-sheet image offset when the normalized dieline root moves because
 * the template extents changed. The artwork stays registered to the same wall
 * instead of appearing to slide when a flap is resized or added/removed.
 */
export function preserveSheetRegistration(offset: SheetOffset, previous: RootAnchor, next: RootAnchor): SheetOffset {
  return { x: offset.x + next.x - previous.x, y: offset.y + next.y - previous.y };
}
