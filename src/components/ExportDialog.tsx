import { useEffect, useRef, useState } from "react";
import type { BoxDimensions, DielineLayout } from "../geometry/types";
import type { ArtworkState } from "../artwork/types";
import type { ExportSettings, PaperId } from "../lib/preferences";
import { BUILTIN_EXPORT_PRESETS, PAPER_SIZES, resolvePaper, sanitizeExportSettings, setPreferences, usePreferences } from "../lib/preferences";
import { runPreflight } from "../geometry/preflight";
import type { PreflightIssue } from "../geometry/preflight";
import { useT } from "../lib/i18n";
import NumField from "./NumField";
import Icon from "./Icon";

interface Props {
  layout: DielineLayout;
  dims: BoxDimensions;
  styleDefaults: BoxDimensions;
  artwork: ArtworkState;
  busy: boolean;
  onClose: () => void;
  onExport: (settings: ExportSettings) => void;
}

const SEVERITY_ICON: Record<PreflightIssue["severity"], string> = { error: "✕", warning: "!", info: "i" };

export default function ExportDialog({ layout, dims, styleDefaults, artwork, busy, onClose, onExport }: Props) {
  const t = useT();
  const { exportSettings, exportPresets } = usePreferences();
  const [settings, setSettings] = useState<ExportSettings>(exportSettings);
  const [presetName, setPresetName] = useState("");
  const [issues, setIssues] = useState<PreflightIssue[] | null>(null);
  const exportButton = useRef<HTMLButtonElement>(null);
  const patch = (next: Partial<ExportSettings>) => setSettings((current) => sanitizeExportSettings({ ...current, ...next }));

  // Re-check whenever the design or the paper settings change. The check decodes
  // images, so it runs asynchronously and a stale result is simply dropped.
  useEffect(() => {
    let cancelled = false;
    setIssues(null);
    runPreflight(layout, dims, artwork, settings, styleDefaults)
      .then((result) => { if (!cancelled) setIssues(result); })
      .catch(() => { if (!cancelled) setIssues([]); });
    return () => { cancelled = true; };
  }, [layout, dims, artwork, settings, styleDefaults]);

  useEffect(() => {
    exportButton.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const paper = resolvePaper(settings);
  const allPresets: Record<string, ExportSettings> = { ...BUILTIN_EXPORT_PRESETS, ...exportPresets };
  const errorCount = issues?.filter((issue) => issue.severity === "error").length ?? 0;
  const warningCount = issues?.filter((issue) => issue.severity === "warning").length ?? 0;

  const savePreset = () => {
    const name = presetName.trim().slice(0, 60);
    if (!name || name in BUILTIN_EXPORT_PRESETS) return;
    setPreferences({ exportPresets: { ...exportPresets, [name]: settings } });
    setPresetName("");
  };
  const deletePreset = (name: string) => {
    const { [name]: _removed, ...rest } = exportPresets;
    setPreferences({ exportPresets: rest });
  };

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="dialog dialog-wide" role="dialog" aria-modal="true" aria-labelledby="export-title">
        <header className="dialog-head">
          <h2 id="export-title">{t("Export print-ready PDF")}</h2>
          <button type="button" className="icon-btn" aria-label={t("Close")} onClick={onClose}><Icon name="close"/></button>
        </header>

        <div className="export-columns">
          <section className="export-settings" aria-label={t("PDF settings")}>
            <label className="studio-select-label">{t("Preset")}
              <select value="" onChange={(event) => { const chosen = allPresets[event.target.value]; if (chosen) setSettings(sanitizeExportSettings(chosen)); }}>
                <option value="">{t("Choose a preset…")}</option>
                {Object.keys(BUILTIN_EXPORT_PRESETS).map((name) => <option key={name} value={name}>{t(name)}</option>)}
                {Object.keys(exportPresets).map((name) => <option key={name} value={name}>★ {name}</option>)}
              </select>
            </label>

            <label className="studio-select-label">{t("Paper")}
              <select value={settings.paper} onChange={(event) => patch({ paper: event.target.value as PaperId })}>
                {Object.entries(PAPER_SIZES).map(([id, size]) => <option key={id} value={id}>{size.label} · {size.width} × {size.height} mm</option>)}
                <option value="custom">{t("Custom size")}</option>
              </select>
            </label>
            {settings.paper === "custom" && <div className="num-grid two">
              <NumField label={t("Width")} unit="mm" value={settings.customWidth} min={50} max={2000} step={1} decimals={1} onChange={(n) => patch({ customWidth: n })} />
              <NumField label={t("Height")} unit="mm" value={settings.customHeight} min={50} max={2000} step={1} decimals={1} onChange={(n) => patch({ customHeight: n })} />
            </div>}
            <div className="num-grid two">
              <NumField label={t("Page margin")} unit="mm" value={settings.margin} min={0} max={50} step={1} decimals={1} onChange={(n) => patch({ margin: n })} />
              <NumField label={t("Bleed area")} unit="mm" value={settings.bleed} min={0} max={30} step={0.5} decimals={1} onChange={(n) => patch({ bleed: n })} />
            </div>
            <label className="studio-check-row"><input type="checkbox" checked={settings.cropMarks} onChange={(event) => patch({ cropMarks: event.target.checked })}/> {t("Trim guide and crop marks")}</label>
            <label className="studio-check-row"><input type="checkbox" checked={settings.measurements} onChange={(event) => patch({ measurements: event.target.checked })}/> {t("Measurement marks")}</label>
            <label className="studio-check-row"><input type="checkbox" checked={settings.includeInside} onChange={(event) => patch({ includeInside: event.target.checked })}/> {t("Include the mirrored inside sheet")}</label>
            <p className="studio-hint">{t("Prints at true scale on {w} × {h} mm paper. Bleed controls the margin drawn around the trim edge; your artwork must extend into it.", { w: paper.width, h: paper.height })}</p>

            <div className="preset-save">
              <input type="text" value={presetName} maxLength={60} placeholder={t("Save these settings as…")} aria-label={t("Preset name")} onChange={(event) => setPresetName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") savePreset(); }} />
              <button type="button" className="subtle-action" disabled={!presetName.trim()} onClick={savePreset}>{t("Save preset")}</button>
            </div>
            {Object.keys(exportPresets).length > 0 && <ul className="preset-list">
              {Object.keys(exportPresets).map((name) => <li key={name}><span>★ {name}</span><button type="button" className="icon-btn" aria-label={`${t("Delete preset")} ${name}`} onClick={() => deletePreset(name)}><Icon name="trash"/></button></li>)}
            </ul>}
          </section>

          <section className="preflight" aria-label={t("Preflight check")} aria-live="polite">
            <h3>{t("Preflight check")}</h3>
            {issues === null && <p className="studio-hint">{t("Checking your design…")}</p>}
            {issues?.length === 0 && <p className="preflight-ok">✓ {t("No problems found.")}</p>}
            {issues && issues.length > 0 && <ul className="preflight-list">
              {issues.map((issue, index) => <li key={index} className={`preflight-${issue.severity}`}>
                <span className="preflight-icon" aria-label={t(issue.severity)}>{SEVERITY_ICON[issue.severity]}</span>
                <span>{t(issue.message, issue.params && Object.fromEntries(Object.entries(issue.params).map(([key, value]) => [key, typeof value === "string" ? t(value) : value])))}</span>
              </li>)}
            </ul>}
            <p className="studio-hint">{t("These checks are advice only. You can always export.")}</p>
          </section>
        </div>

        <div className="dialog-actions">
          <button type="button" className="dialog-button" onClick={onClose}>{t("Cancel")}</button>
          <button ref={exportButton} type="button" className={`dialog-button dialog-primary${errorCount ? " dialog-danger" : ""}`} disabled={busy} onClick={() => { setPreferences({ exportSettings: settings }); onExport(settings); }}>
            {busy ? t("Preparing…") : errorCount || warningCount ? t("Export anyway ({n} to review)", { n: errorCount + warningCount }) : t("Export PDF")}
          </button>
        </div>
      </div>
    </div>
  );
}
