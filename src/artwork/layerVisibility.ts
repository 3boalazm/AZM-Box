import type { ArtworkState, SideArtwork } from "./types";

export type ArtworkLayerVisibilityId = `sheet:${"outside" | "inside"}` | `panel:${"outside" | "inside"}:${string}` | `layer:${"outside" | "inside"}:${string}`;

/** Filters presentation-only visibility without mutating or deleting print artwork. */
export function visibleArtwork(artwork: ArtworkState, hiddenIds: readonly string[], showOutside = true, showInside = true): ArtworkState {
  const hidden = new Set(hiddenIds);
  const filterSide = (sideName: "outside" | "inside", side: SideArtwork, shown: boolean): SideArtwork => ({
    ...side,
    sheetImage: shown && !hidden.has(`sheet:${sideName}`) ? side.sheetImage : undefined,
    panelImages: shown ? Object.fromEntries(Object.entries(side.panelImages).filter(([id]) => !hidden.has(`panel:${sideName}:${id}`))) : {},
    layers: shown ? side.layers.filter((layer) => !hidden.has(`layer:${sideName}:${layer.id}`)) : [],
  });
  return { outside: filterSide("outside", artwork.outside, showOutside), inside: filterSide("inside", artwork.inside, showInside) };
}
