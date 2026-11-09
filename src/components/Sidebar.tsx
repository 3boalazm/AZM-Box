import { useEffect, useState } from "react";
import { BOX_STYLES } from "../geometry/boxBuilders";
import type { BoxDimensions, BoxStyleId, DielineLayout, FaceRole, FlapWall } from "../geometry/types";
import { FLAP_WALLS } from "../geometry/types";
import { clearPanelEdits, isFaceMirrored, panelEditCount, setAddedFaceDepth, toggleFaceMirror } from "../geometry/panelEdits";
import { mmToUnit, setPreferences, unitToMm, usePreferences } from "../lib/preferences";
import type { Unit } from "../lib/preferences";
import { useT } from "../lib/i18n";

interface Props {
  boxStyleId: BoxStyleId;
  dims: BoxDimensions;
  /** The flat layout already computed by App for this style + dims. */
  layout: DielineLayout;
  onChangeStyle: (id: BoxStyleId) => void;
  onChangeDims: (dims: BoxDimensions) => void;
  /** Face of the panel just clicked in the 2D view, so its control can flash. */
  highlightFace?: FaceRole;
  /** Bumped on every panel click so re-clicking the same panel replays the flash. */
  highlightNonce?: number;
  /** Set on double-clicking a face in the 2D view: open its section and jump to its control. */
  openFace?: { face: FaceRole; nonce: number } | null;
  /** The face selected on the dieline, if any. */
  selectedPanelId?: string | null;
  onRemoveFace?: (panelId: string) => void;
}

/**
 * Maps a clicked panel's face to the id of the sidebar control that governs it,
 * so clicking a shape in the drawing points you at the field that changes it.
 */
/**
 * Where a face's settings live in this sidebar: the control id that should
 * flash, and the DOM element to scroll to (a field label, a flap-wall group,
 * or the selected-face card for hand-added faces).
 */
function faceTarget(face: FaceRole): { flashId: string | null; elementId: string } {
  const flapMatch = /^flap-(?:top|bottom)-(front|back|left|right)$/.exec(face);
  if (flapMatch) return { flashId: `flap-${flapMatch[1]}`, elementId: `flap-wall-${flapMatch[1]}` };
  switch (face) {
    case "front":
    case "back":
      return { flashId: "length", elementId: "control-length" }; // front/back walls are L wide
    case "left":
    case "right":
      return { flashId: "width", elementId: "control-width" }; // side walls are W deep
    case "glue":
      return { flashId: "endFlapRight", elementId: "control-endFlapRight" };
    case "top":
    case "bottom":
      return { flashId: "height", elementId: "control-height" };
    default:
      return { flashId: "face-target", elementId: "face-target-panel" };
  }
}

function controlIdForFace(face: FaceRole): string | null {
  return faceTarget(face).flashId;
}

/** Common board calipers (mm). Typical values; check your supplier's data sheet. */
const BOARD_PRESETS: { label: string; thickness: number }[] = [
  { label: "Folding carton 300 gsm", thickness: 0.4 },
  { label: "Folding carton 400 gsm", thickness: 0.55 },
  { label: "Rigid / greyboard 1 mm", thickness: 1 },
  { label: "E-flute corrugated", thickness: 1.5 },
  { label: "B-flute corrugated", thickness: 3 },
  { label: "C-flute corrugated", thickness: 4 },
  { label: "BC double wall", thickness: 7 },
];

/**
 * A numeric field that can be freely cleared and retyped.
 *
 * The value is kept as a STRING while focused so an empty box (or a partial entry
 * like "-" or "0") is a legal intermediate state. Clamping the number on every
 * keystroke — which is what this used to do — meant you could never delete the
 * existing digits to type new ones: erasing "18" snapped straight back to the
 * minimum. The clamped number is committed on blur or on Enter instead.
 *
 * `value`, `min` and `max` are always millimetres; the text shown and typed is in
 * the user's chosen unit.
 */
const MAX_DIMENSION_MM = 5000;

function Field({
  label,
  value,
  onChange,
  min = 1,
  max = MAX_DIMENSION_MM,
  hint,
  flash,
  controlId,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  hint?: string;
  /** When true this field plays the brief highlight animation. */
  flash?: boolean;
  /** DOM id used to scroll to / flash this control when its face is double-clicked. */
  controlId?: string;
}) {
  const { unit } = usePreferences();
  const [draft, setDraft] = useState(String(mmToUnit(value, unit)));
  const [editing, setEditing] = useState(false);

  // Keep in sync when the value changes from elsewhere (style switch, reset...)
  // but never yank the text out from under the user mid-edit.
  useEffect(() => {
    if (!editing) setDraft(String(mmToUnit(value, unit)));
  }, [value, editing, unit]);

  const commit = () => {
    setEditing(false);
    const n = Number(draft);
    if (draft.trim() === "" || !Number.isFinite(n)) {
      setDraft(String(mmToUnit(value, unit))); // nothing usable typed — put the old value back
      return;
    }
    const clamped = Math.min(max, Math.max(min, unitToMm(n, unit)));
    setDraft(String(mmToUnit(clamped, unit)));
    if (clamped !== value) onChange(clamped);
  };

  return (
    <label id={controlId ? `control-${controlId}` : undefined} className={`field${flash ? " field-flash" : ""}`} title={hint}>
      <span>{label}</span>
      <input
        type="number"
        step="any"
        min={mmToUnit(min, unit)}
        max={mmToUnit(max, unit)}
        value={draft}
        onFocus={() => setEditing(true)}
        onChange={(e) => {
          setEditing(true);
          setDraft(e.target.value);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
        }}
      />
    </label>
  );
}

/** Human labels for the four per-wall flap controls. */
const WALL_LABELS: Record<FlapWall, string> = {
  front: "Front wall flap",
  back: "Back wall flap",
  left: "Left wall flap",
  right: "Right wall flap",
};

export default function Sidebar({ boxStyleId, dims, layout, onChangeStyle, onChangeDims, highlightFace, highlightNonce, openFace, selectedPanelId, onRemoveFace }: Props) {
  const t = useT();
  const { unit } = usePreferences();
  const style = BOX_STYLES.find((s) => s.id === boxStyleId)!;

  // Which control is currently flashing. Cleared on a timer so the highlight is a
  // brief cue rather than a persistent selected state.
  const [flashId, setFlashId] = useState<string | null>(null);
  useEffect(() => {
    if (!highlightFace || !highlightNonce) return;
    const id = controlIdForFace(highlightFace);
    if (!id) return;
    setFlashId(null); // drop it first so re-clicking the same panel restarts the animation
    const start = requestAnimationFrame(() => setFlashId(id));
    const clear = setTimeout(() => setFlashId(null), 1000);
    return () => {
      cancelAnimationFrame(start);
      clearTimeout(clear);
    };
  }, [highlightFace, highlightNonce]);

  // Double-clicking a face on the dieline: open every collapsed section on the
  // way to its control, scroll it into view, flash it and focus the input so the
  // measurement can be edited right away.
  useEffect(() => {
    if (!openFace) return;
    const { flashId: id, elementId } = faceTarget(openFace.face);
    const el = document.getElementById(elementId);
    if (!el || !id) return;
    let group: HTMLDetailsElement | null = el.closest("details");
    while (group) {
      group.open = true;
      group = group.parentElement?.closest("details") ?? null;
    }
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setFlashId(null); // drop first so re-double-clicking the same face restarts the animation
    const start = requestAnimationFrame(() => setFlashId(id));
    const focusTimer = setTimeout(() => {
      const input = el.querySelector("input, select") as HTMLElement | null;
      input?.focus({ preventScroll: true });
    }, 450);
    const clear = setTimeout(() => setFlashId(null), 2000);
    return () => {
      cancelAnimationFrame(start);
      clearTimeout(focusTimer);
      clearTimeout(clear);
    };
  }, [openFace]);

  const wallPanel = (wall: FlapWall) => layout.panels.find((panel) => panel.face === wall);
  const flapPanel = (edge: "top" | "bottom", wall: FlapWall) => layout.panels.find((panel) => panel.face === `flap-${edge}-${wall}`);
  const flapDepth = (edge: "top" | "bottom", wall: FlapWall) => {
    const explicit = dims.flapEdges?.[edge]?.[wall];
    if (explicit !== undefined) return explicit;
    return flapPanel(edge, wall)?.h ?? dims.flaps?.[wall] ?? 0;
  };
  const flapWidth = (wall: FlapWall) => dims.flapWidths?.[wall] ?? wallPanel(wall)?.w ?? 0;
  const setFlapDepth = (edge: "top" | "bottom", wall: FlapWall, value: number) =>
    onChangeDims({ ...dims, flapEdges: { ...dims.flapEdges, [edge]: { ...dims.flapEdges?.[edge], [wall]: value } } });
  const setFlapWidth = (wall: FlapWall, value: number) => onChangeDims({ ...dims, flapWidths: { ...dims.flapWidths, [wall]: value } });
  const setFlapShape = (wall: FlapWall, value: NonNullable<BoxDimensions["flapShapes"]>[FlapWall]) =>
    onChangeDims({ ...dims, flapShapes: { ...dims.flapShapes, [wall]: value } });

  const thickness = dims.materialThickness ?? 0;
  const basis = dims.dimensionBasis ?? "internal";
  const matchingPreset = BOARD_PRESETS.find((preset) => preset.thickness === thickness);
  const front = wallPanel("front");
  const left = wallPanel("left");
  const selectedFace = layout.panels.find((panel) => panel.id === selectedPanelId);
  const selectedAdded = dims.panelEdits?.added?.find((face) => face.id === selectedPanelId);
  const faceEdits = panelEditCount(dims);
  const fmt = (mm: number) => `${mmToUnit(mm, unit)} ${unit}`;

  return (
    <aside className="panel sidebar inspector-panel" aria-label={t("Box structure settings")}>
      <header className="inspector-heading">
        <div><span className="eyebrow">{t("PARAMETRIC BOX")}</span><h2>{t("Structure")}</h2></div>
        <select className="unit-pill" aria-label={t("Units")} value={unit} onChange={(e) => setPreferences({ unit: e.target.value as Unit })}>
          <option value="mm">mm</option><option value="cm">cm</option><option value="in">in</option>
        </select>
      </header>

      <details className="inspector-group" open>
        <summary className="inspector-summary"><span>{t("Template")}</span><span className="summary-meta">01</span></summary>
        <div className="inspector-content">
          <label className="control-label" htmlFor="box-style">{t("Box style")}</label>
          <select id="box-style" className="control-select" value={boxStyleId} onChange={(e) => onChangeStyle(e.target.value as BoxStyleId)}>
            {BOX_STYLES.map((s) => <option key={s.id} value={s.id}>{t(s.label)}</option>)}
          </select>
          <p className="control-hint">{t(style.description)}</p>
        </div>
      </details>

      <details className="inspector-group" open>
        <summary className="inspector-summary"><span>{t("Overall dimensions")}</span><span className="summary-meta">02</span></summary>
        <div className="inspector-content">
          <div className="dimension-grid">
            <Field label={t("Length · L")} value={dims.length} onChange={(v) => onChangeDims({ ...dims, length: v })} flash={flashId === "length"} controlId="length" />
            <Field label={t("Width · W")} value={dims.width} onChange={(v) => onChangeDims({ ...dims, width: v })} flash={flashId === "width"} controlId="width" />
            <Field label={t("Height · H")} value={dims.height} onChange={(v) => onChangeDims({ ...dims, height: v })} flash={flashId === "height"} controlId="height" />
          </div>
          <span className="control-hint">{basis === "internal" ? t("Finished internal box size") : t("Finished external box size")}</span>
        </div>
      </details>

      <details className="inspector-group" open>
        <summary className="inspector-summary"><span>{t("Board material")}</span><span className="summary-meta">{thickness > 0 ? fmt(thickness) : t("Off")}</span></summary>
        <div className="inspector-content">
          <label className="control-label" htmlFor="board-preset">{t("Board type")}</label>
          <select id="board-preset" className="control-select" value={matchingPreset ? String(matchingPreset.thickness) : thickness === 0 ? "0" : "custom"} onChange={(e) => {
            if (e.target.value !== "custom") onChangeDims({ ...dims, materialThickness: Number(e.target.value) });
          }}>
            <option value="0">{t("No compensation")}</option>
            {BOARD_PRESETS.map((preset) => <option key={preset.label} value={String(preset.thickness)}>{t(preset.label)} · {preset.thickness} mm</option>)}
            {!matchingPreset && thickness > 0 && <option value="custom">{t("Custom")}</option>}
          </select>
          <Field label={t("Thickness (caliper)")} value={thickness} min={0} max={50} onChange={(v) => onChangeDims({ ...dims, materialThickness: v })} hint={t("Folding wraps board around each crease. Panels are drawn one caliper wider than the inside size so the finished box is not too tight.")} />
          <label className="control-label" htmlFor="dimension-basis">{t("L / W / H are the")}</label>
          <select id="dimension-basis" className="control-select" value={basis} onChange={(e) => onChangeDims({ ...dims, dimensionBasis: e.target.value as "internal" | "external" })}>
            <option value="internal">{t("Inside size (what it holds)")}</option>
            <option value="external">{t("Outside size (what you measure)")}</option>
          </select>
          {thickness > 0 && front && left
            ? <p className="control-hint">{t("Front/back panel {a}, side panel {b} — each crease-to-crease.", { a: fmt(front.w), b: fmt(left.w) })}</p>
            : <p className="control-hint">{t("Set the board thickness to compensate folds. Leave off for the nominal sizes.")}</p>}
        </div>
      </details>

      <details className="inspector-group" open>
        <summary className="inspector-summary"><span>{t("Flap geometry")}</span><span className="summary-meta">03</span></summary>
        <div className="inspector-content flap-inspector">
          <p className="control-hint">{t("Set each edge independently. Use 0 mm to remove a flap.")}</p>
          {FLAP_WALLS.map((wall) => {
            const parent = wallPanel(wall);
            const topDepth = flapDepth("top", wall);
            const bottomDepth = flapDepth("bottom", wall);
            const maxWidth = parent?.w ?? Math.max(dims.length, dims.width);
            const addedDepth = Math.max(10, Math.round((parent?.w ?? dims.length) * 0.35));
            return (
              <details className="flap-wall" key={wall} id={`flap-wall-${wall}`}>
                <summary><span>{t(WALL_LABELS[wall])}</span><span className="flap-size-summary">{mmToUnit(topDepth, unit)} / {mmToUnit(bottomDepth, unit)} {unit}</span></summary>
                <div className="flap-wall-content">
                  <div className="flap-pair">
                    <Field label={t("Top depth")} value={topDepth} min={0} onChange={(v) => setFlapDepth("top", wall, v)} flash={flashId === `flap-${wall}`} />
                    <button type="button" className="flap-remove" aria-label={topDepth > 0 ? `Remove top flap on ${WALL_LABELS[wall]}` : `Add top flap on ${WALL_LABELS[wall]}`} onClick={() => setFlapDepth("top", wall, topDepth > 0 ? 0 : addedDepth)}>{topDepth > 0 ? t("Remove") : t("+ Add")}</button>
                  </div>
                  <div className="flap-pair">
                    <Field label={t("Bottom depth")} value={bottomDepth} min={0} onChange={(v) => setFlapDepth("bottom", wall, v)} flash={flashId === `flap-${wall}`} />
                    <button type="button" className="flap-remove" aria-label={bottomDepth > 0 ? `Remove bottom flap on ${WALL_LABELS[wall]}` : `Add bottom flap on ${WALL_LABELS[wall]}`} onClick={() => setFlapDepth("bottom", wall, bottomDepth > 0 ? 0 : addedDepth)}>{bottomDepth > 0 ? t("Remove") : t("+ Add")}</button>
                  </div>
                  <div className="flap-options">
                    <Field label={t("Width")} value={flapWidth(wall)} min={1} max={maxWidth} onChange={(v) => setFlapWidth(wall, Math.min(maxWidth, v))} hint={`Centered along wall; maximum ${maxWidth} mm.`} />
                    <label className="field"><span>{t("Profile")}</span>
                      <select aria-label={`${WALL_LABELS[wall]} profile`} value={dims.flapShapes?.[wall] ?? "default"} onChange={(event) => setFlapShape(wall, event.target.value as NonNullable<BoxDimensions["flapShapes"]>[FlapWall])}>
                        <option value="default">{t("Default")}</option><option value="straight">{t("Straight")}</option><option value="dust">{t("Dust flap")}</option><option value="tuck">{t("Tuck / lock")}</option><option value="lock">{t("Lock tab")}</option>
                      </select>
                    </label>
                  </div>
                </div>
              </details>
            );
          })}
        </div>
      </details>

      <details className="inspector-group">
        <summary className="inspector-summary"><span>{t("End closures")}</span><span className="summary-meta">04</span></summary>
        <div className="inspector-content">
          <p className="control-hint">{t("Tabs at each end of the unfolded strip.")}</p>
          <Field label={t("Right glue tab")} value={dims.endFlapRight ?? 0} min={0} onChange={(v) => onChangeDims({ ...dims, endFlapRight: v })} hint={t("The manufacturer's glue tab that bonds the tube closed.")} flash={flashId === "endFlapRight"} controlId="endFlapRight" />
          <Field label={t("Left end tab")} value={dims.endFlapLeft ?? 0} min={0} onChange={(v) => onChangeDims({ ...dims, endFlapLeft: v })} hint={t("Optional matching tab; set 0 mm for none.")} />
          {boxStyleId === "mailer" && <Field label={t("Lid tuck depth")} value={Math.round(dims.lidDepth ?? dims.height * 0.9)} min={1} onChange={(v) => onChangeDims({ ...dims, lidDepth: v })} />}
        </div>
      </details>

      <details className="inspector-group" open>
        <summary className="inspector-summary"><span>{t("Die-cut direction")}</span><span className="summary-meta">{dims.flipX || dims.flipY ? t("Flipped") : t("Normal")}</span></summary>
        <div className="inspector-content">
          <p className="control-hint">{t("Mirror the die-cut over the sheet without moving the artwork, for artwork drawn the other way round.")}</p>
          <div className="flip-buttons">
            <button type="button" className={`flip-button${dims.flipX ? " active" : ""}`} aria-pressed={!!dims.flipX} onClick={() => onChangeDims({ ...dims, flipX: !dims.flipX })}>⇄ {t("Mirror left ↔ right")}</button>
            <button type="button" className={`flip-button${dims.flipY ? " active" : ""}`} aria-pressed={!!dims.flipY} onClick={() => onChangeDims({ ...dims, flipY: !dims.flipY })}>⇅ {t("Flip top ↕ bottom")}</button>
          </div>
        </div>
      </details>

      <details className="inspector-group" open>
        <summary className="inspector-summary"><span>{t("Faces")}</span><span className="summary-meta">{faceEdits > 0 ? t("{n} edited", { n: faceEdits }) : String(layout.panels.length).padStart(2, "0")}</span></summary>
        <div className="inspector-content">
          <p className="control-hint">{t("Click + on a free edge of the dieline to add a face there. Select a face, then − to remove it.")}</p>
          {selectedFace
            ? <div id="face-target-panel" className={`panel-target${flashId === "face-target" ? " field-flash" : ""}`}><span className="target-dot"/><span>{selectedFace.name}</span><span className="target-size">{fmt(selectedFace.w)} × {fmt(selectedFace.h)}</span></div>
            : <p className="empty-note">{t("Select a face on the dieline to resize or remove it.")}</p>}
          {selectedAdded && <Field label={t("Face depth")} value={selectedAdded.depth} min={1} onChange={(v) => onChangeDims(setAddedFaceDepth(dims, selectedAdded.id, v))} hint={t("How far the added face reaches from the edge it is hinged to.")} />}
          {selectedFace && <label className="studio-check-row face-mirror-row" title={t("Flip this face's cut and fold lines horizontally about the face's centre in the dieline and all exports — for dies whose die-cut shows this face (usually the back) mirrored. Artwork placed on the face is not affected.")}>
            <input type="checkbox" aria-label={t("Mirror this face's trace")} checked={isFaceMirrored(dims, selectedFace.id)} onChange={() => onChangeDims(toggleFaceMirror(dims, selectedFace.id))} />
            <span>{t("Mirror this face's trace (cut/fold lines)")}</span>
          </label>}
          {selectedFace && onRemoveFace && layout.panels.length > 1 && <button type="button" className="flap-remove face-remove" onClick={() => onRemoveFace(selectedFace.id)}>− {t("Remove this face")}</button>}
          {faceEdits > 0 && <button type="button" className="text-action" onClick={() => onChangeDims(clearPanelEdits(dims))}>{t("Restore the template faces")}</button>}
        </div>
      </details>

      <button className="reset-control" type="button" onClick={() => onChangeDims({
        ...style.defaultDimensions,
        // The board and how the box was measured belong to the project, not the template.
        ...(dims.materialThickness !== undefined ? { materialThickness: dims.materialThickness } : {}),
        ...(dims.dimensionBasis !== undefined ? { dimensionBasis: dims.dimensionBasis } : {}),
        ...(dims.flipX ? { flipX: true } : {}),
        ...(dims.flipY ? { flipY: true } : {}),
      })}>{t("Reset dimensions to template")}</button>
    </aside>
  );
}
