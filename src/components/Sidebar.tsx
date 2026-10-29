import { useEffect, useMemo, useState } from "react";
import { BOX_STYLES, getBoxStyle } from "../geometry/boxBuilders";
import { computeFlatLayout } from "../geometry/layout";
import type { BoxDimensions, BoxStyleId, FaceRole, FlapWall } from "../geometry/types";
import { FLAP_WALLS } from "../geometry/types";

interface Props {
  boxStyleId: BoxStyleId;
  dims: BoxDimensions;
  onChangeStyle: (id: BoxStyleId) => void;
  onChangeDims: (dims: BoxDimensions) => void;
  /** Face of the panel just clicked in the 2D view, so its control can flash. */
  highlightFace?: FaceRole;
  /** Bumped on every panel click so re-clicking the same panel replays the flash. */
  highlightNonce?: number;
}

/**
 * Maps a clicked panel's face to the id of the sidebar control that governs it,
 * so clicking a shape in the drawing points you at the field that changes it.
 */
function controlIdForFace(face: FaceRole): string | null {
  const flapMatch = /^flap-(?:top|bottom)-(front|back|left|right)$/.exec(face);
  if (flapMatch) return `flap-${flapMatch[1]}`;
  switch (face) {
    case "front":
    case "back":
      return "length"; // front/back walls are L wide
    case "left":
    case "right":
      return "width"; // side walls are W deep
    case "glue":
      return "endFlapRight";
    case "top":
    case "bottom":
      return "height";
    default:
      return null;
  }
}

/**
 * A numeric field that can be freely cleared and retyped.
 *
 * The value is kept as a STRING while focused so an empty box (or a partial entry
 * like "-" or "0") is a legal intermediate state. Clamping the number on every
 * keystroke — which is what this used to do — meant you could never delete the
 * existing digits to type new ones: erasing "18" snapped straight back to the
 * minimum. The clamped number is committed on blur or on Enter instead.
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
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  hint?: string;
  /** When true this field plays the brief highlight animation. */
  flash?: boolean;
}) {
  const [draft, setDraft] = useState(String(value));
  const [editing, setEditing] = useState(false);

  // Keep in sync when the value changes from elsewhere (style switch, reset...)
  // but never yank the text out from under the user mid-edit.
  useEffect(() => {
    if (!editing) setDraft(String(value));
  }, [value, editing]);

  const commit = () => {
    setEditing(false);
    const n = Number(draft);
    if (draft.trim() === "" || !Number.isFinite(n)) {
      setDraft(String(value)); // nothing usable typed — put the old value back
      return;
    }
    const clamped = Math.min(max, Math.max(min, n));
    setDraft(String(clamped));
    if (clamped !== value) onChange(clamped);
  };

  return (
    <label className={`field${flash ? " field-flash" : ""}`} title={hint}>
      <span>{label}</span>
      <input
        type="number"
        min={min}
        max={max}
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

export default function Sidebar({ boxStyleId, dims, onChangeStyle, onChangeDims, highlightFace, highlightNonce }: Props) {
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

  const layout = useMemo(() => computeFlatLayout(getBoxStyle(boxStyleId).build(dims)), [boxStyleId, dims]);
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

  return (
    <aside className="panel sidebar inspector-panel" aria-label="Box structure settings">
      <header className="inspector-heading">
        <div><span className="eyebrow">PARAMETRIC BOX</span><h2>Structure</h2></div>
        <span className="unit-pill">mm</span>
      </header>

      <details className="inspector-group" open>
        <summary className="inspector-summary"><span>Template</span><span className="summary-meta">01</span></summary>
        <div className="inspector-content">
          <label className="control-label" htmlFor="box-style">Box style</label>
          <select id="box-style" className="control-select" value={boxStyleId} onChange={(e) => onChangeStyle(e.target.value as BoxStyleId)}>
            {BOX_STYLES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <p className="control-hint">{style.description}</p>
        </div>
      </details>

      <details className="inspector-group" open>
        <summary className="inspector-summary"><span>Overall dimensions</span><span className="summary-meta">02</span></summary>
        <div className="inspector-content">
          <div className="dimension-grid">
            <Field label="Length · L" value={dims.length} onChange={(v) => onChangeDims({ ...dims, length: v })} flash={flashId === "length"} />
            <Field label="Width · W" value={dims.width} onChange={(v) => onChangeDims({ ...dims, width: v })} flash={flashId === "width"} />
            <Field label="Height · H" value={dims.height} onChange={(v) => onChangeDims({ ...dims, height: v })} flash={flashId === "height"} />
          </div>
          <span className="control-hint">Finished internal box size</span>
        </div>
      </details>

      <details className="inspector-group" open>
        <summary className="inspector-summary"><span>Flap geometry</span><span className="summary-meta">03</span></summary>
        <div className="inspector-content flap-inspector">
          <p className="control-hint">Set each edge independently. Use 0 mm to remove a flap.</p>
          {FLAP_WALLS.map((wall) => {
            const parent = wallPanel(wall);
            const topDepth = flapDepth("top", wall);
            const bottomDepth = flapDepth("bottom", wall);
            const maxWidth = parent?.w ?? Math.max(dims.length, dims.width);
            const addedDepth = Math.max(10, Math.round((parent?.w ?? dims.length) * 0.35));
            return (
              <details className="flap-wall" key={wall}>
                <summary><span>{WALL_LABELS[wall]}</span><span className="flap-size-summary">{topDepth} / {bottomDepth} mm</span></summary>
                <div className="flap-wall-content">
                  <div className="flap-pair">
                    <Field label="Top depth" value={topDepth} min={0} onChange={(v) => setFlapDepth("top", wall, v)} flash={flashId === `flap-${wall}`} />
                    <button type="button" className="flap-remove" aria-label={topDepth > 0 ? `Remove top flap on ${WALL_LABELS[wall]}` : `Add top flap on ${WALL_LABELS[wall]}`} onClick={() => setFlapDepth("top", wall, topDepth > 0 ? 0 : addedDepth)}>{topDepth > 0 ? "Remove" : "+ Add"}</button>
                  </div>
                  <div className="flap-pair">
                    <Field label="Bottom depth" value={bottomDepth} min={0} onChange={(v) => setFlapDepth("bottom", wall, v)} flash={flashId === `flap-${wall}`} />
                    <button type="button" className="flap-remove" aria-label={bottomDepth > 0 ? `Remove bottom flap on ${WALL_LABELS[wall]}` : `Add bottom flap on ${WALL_LABELS[wall]}`} onClick={() => setFlapDepth("bottom", wall, bottomDepth > 0 ? 0 : addedDepth)}>{bottomDepth > 0 ? "Remove" : "+ Add"}</button>
                  </div>
                  <div className="flap-options">
                    <Field label="Width" value={flapWidth(wall)} min={1} max={maxWidth} onChange={(v) => setFlapWidth(wall, Math.min(maxWidth, v))} hint={`Centered along wall; maximum ${maxWidth} mm.`} />
                    <label className="field"><span>Profile</span>
                      <select aria-label={`${WALL_LABELS[wall]} profile`} value={dims.flapShapes?.[wall] ?? "default"} onChange={(event) => setFlapShape(wall, event.target.value as NonNullable<BoxDimensions["flapShapes"]>[FlapWall])}>
                        <option value="default">Default</option><option value="straight">Straight</option><option value="dust">Dust flap</option><option value="tuck">Tuck / lock</option><option value="lock">Lock tab</option>
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
        <summary className="inspector-summary"><span>End closures</span><span className="summary-meta">04</span></summary>
        <div className="inspector-content">
          <p className="control-hint">Tabs at each end of the unfolded strip.</p>
          <Field label="Right glue tab" value={dims.endFlapRight ?? 0} min={0} onChange={(v) => onChangeDims({ ...dims, endFlapRight: v })} hint="The manufacturer's glue tab that bonds the tube closed." flash={flashId === "endFlapRight"} />
          <Field label="Left end tab" value={dims.endFlapLeft ?? 0} min={0} onChange={(v) => onChangeDims({ ...dims, endFlapLeft: v })} hint="Optional matching tab; set 0 mm for none." />
          {boxStyleId === "mailer" && <Field label="Lid tuck depth" value={Math.round(dims.lidDepth ?? dims.height * 0.9)} min={1} onChange={(v) => onChangeDims({ ...dims, lidDepth: v })} />}
        </div>
      </details>

      <button className="reset-control" type="button" onClick={() => onChangeDims({ ...style.defaultDimensions })}>Reset dimensions to template</button>
    </aside>
  );
}
