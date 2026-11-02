import { useEffect, useState } from "react";
import { useT } from "../lib/i18n";

interface Props {
  label: string;
  value: number;
  onChange: (value: number) => void;
  step?: number;
  min?: number;
  max?: number;
  /** Digits shown after the decimal point when not editing. */
  decimals?: number;
  unit?: string;
  /** Adds a slider beside the number for quick coarse changes. */
  slider?: boolean;
}

/**
 * Typed numeric input for 3D studio values. Like the sidebar fields, the text is
 * kept as a draft while focused (so it can be cleared and retyped) and the
 * clamped number is committed on blur or Enter. Arrow keys nudge by `step`.
 */
export default function NumField({ label, value, onChange, step = 1, min = -Infinity, max = Infinity, decimals = 1, unit, slider = false }: Props) {
  const t = useT();
  const shown = (v: number) => String(Number(v.toFixed(decimals)));
  const [draft, setDraft] = useState(shown(value));
  const [editing, setEditing] = useState(false);
  useEffect(() => { if (!editing) setDraft(shown(value)); }, [value, editing]); // eslint-disable-line react-hooks/exhaustive-deps

  const commit = (text = draft) => {
    setEditing(false);
    const n = Number(text);
    if (text.trim() === "" || !Number.isFinite(n)) { setDraft(shown(value)); return; }
    const clamped = Math.min(max, Math.max(min, n));
    setDraft(shown(clamped));
    if (clamped !== value) onChange(clamped);
  };

  return (
    <label className="num-field">
      <span className="num-label">{t(label)}{unit && <small>{unit}</small>}</span>
      <input
        type="number"
        step={step}
        min={Number.isFinite(min) ? min : undefined}
        max={Number.isFinite(max) ? max : undefined}
        value={draft}
        onFocus={() => setEditing(true)}
        onChange={(event) => {
          setEditing(true);
          setDraft(event.target.value);
        }}
        onBlur={() => commit()}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
          else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault();
            const direction = event.key === "ArrowUp" ? 1 : -1;
            const multiplier = event.shiftKey ? 10 : event.altKey ? 0.1 : 1;
            const base = Number.isFinite(Number(draft)) ? Number(draft) : value;
            const next = Math.min(max, Math.max(min, base + direction * step * multiplier));
            setDraft(shown(next));
            setEditing(true);
            onChange(next);
          }
        }}
      />
      {slider && Number.isFinite(min) && Number.isFinite(max) && (
        <input className="num-slider" type="range" aria-label={`${label} slider`} min={min} max={max} step={step} value={Math.min(max, Math.max(min, value))} onChange={(event) => onChange(Number(event.target.value))} />
      )}
    </label>
  );
}
