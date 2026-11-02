import { useEffect, useMemo, useState } from "react";
import { BOX_STYLES, getBoxStyle } from "../geometry/boxBuilders";
import { computeFlatLayout } from "../geometry/layout";
import { generateDielineSVG } from "../geometry/svgExport";
import type { BoxStyleId } from "../geometry/types";
import { listRecent, removeRecent } from "../lib/recentProjects";
import type { RecentProject } from "../lib/recentProjects";
import { mmToUnit, usePreferences } from "../lib/preferences";
import { useT } from "../lib/i18n";
import Icon from "./Icon";

interface Props {
  onPickTemplate: (id: BoxStyleId) => void;
  onOpenRecent: (project: RecentProject) => void;
  onOpenFile: () => void;
  onClose: () => void;
}

/**
 * A dieline drawn small enough that the hairline cut/fold strokes would vanish,
 * so their widths are scaled up in proportion to the sheet size.
 */
function thumbnail(id: BoxStyleId): string {
  const style = getBoxStyle(id);
  const layout = computeFlatLayout(style.build(style.defaultDimensions));
  const px = Math.max(layout.bounds.width, layout.bounds.height) / 110;
  const svg = generateDielineSVG(layout, { title: "" })
    .replace(/stroke="#e2231a" stroke-width="[\d.]+"/g, `stroke="#e2231a" stroke-width="${(px * 1.1).toFixed(2)}"`)
    .replace(/stroke="#1a9e4f" stroke-width="[\d.]+" stroke-dasharray="[^"]+"/g, `stroke="#1a9e4f" stroke-width="${px.toFixed(2)}" stroke-dasharray="${(px * 3).toFixed(2)},${(px * 2.2).toFixed(2)}"`);
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export default function StartScreen({ onPickTemplate, onOpenRecent, onOpenFile, onClose }: Props) {
  const t = useT();
  const { unit } = usePreferences();
  const [recent, setRecent] = useState<RecentProject[] | null>(null);
  const thumbs = useMemo(() => Object.fromEntries(BOX_STYLES.map((style) => [style.id, thumbnail(style.id)])) as Record<BoxStyleId, string>, []);

  useEffect(() => {
    let cancelled = false;
    listRecent().then((items) => { if (!cancelled) setRecent(items); });
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => { cancelled = true; window.removeEventListener("keydown", onKey); };
  }, [onClose]);

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="dialog start-screen" role="dialog" aria-modal="true" aria-labelledby="start-title">
        <header className="dialog-head">
          <div><h2 id="start-title">{t("Start a project")}</h2><p>{t("Pick a template, or continue where you left off.")}</p></div>
          <button type="button" className="icon-btn" aria-label={t("Close")} onClick={onClose}><Icon name="close"/></button>
        </header>

        <div className="start-body">
          <section aria-label={t("Templates")}>
            <h3>{t("Templates")}</h3>
            <div className="template-grid">
              {BOX_STYLES.map((style) => (
                <button key={style.id} type="button" className="template-card" onClick={() => onPickTemplate(style.id)}>
                  <img src={thumbs[style.id]} alt="" width="150" height="110" />
                  <strong>{t(style.label)}</strong>
                  <small>{mmToUnit(style.defaultDimensions.length, unit)} × {mmToUnit(style.defaultDimensions.width, unit)} × {mmToUnit(style.defaultDimensions.height, unit)} {unit}</small>
                </button>
              ))}
            </div>
          </section>

          <aside className="recent-column" aria-label={t("Recent projects")}>
            <h3>{t("Recent projects")}</h3>
            <button type="button" className="subtle-action recent-open" onClick={onOpenFile}><Icon name="open"/> {t("Open a .pbox file…")}</button>
            {recent === null && <p className="studio-hint">{t("Loading…")}</p>}
            {recent?.length === 0 && <p className="studio-hint">{t("Projects you save or open will appear here.")}</p>}
            <ul className="recent-list">
              {recent?.map((item) => (
                <li key={item.id}>
                  <button type="button" className="recent-item" onClick={() => onOpenRecent(item)}>
                    <strong>{item.name}</strong>
                    <small>{t(item.styleLabel)} · {new Date(item.savedAt).toLocaleDateString()}</small>
                  </button>
                  <button type="button" className="icon-btn" aria-label={`${t("Remove from recent")} ${item.name}`} onClick={() => { removeRecent(item.id); setRecent((current) => current?.filter((entry) => entry.id !== item.id) ?? null); }}><Icon name="trash"/></button>
                </li>
              ))}
            </ul>
          </aside>
        </div>
      </div>
    </div>
  );
}
