import { useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

interface Props {
  src: string;
  onCancel: () => void;
  onApply: (croppedDataUrl: string) => void;
}
type DragMode = "move" | "nw" | "ne" | "sw" | "se";

export default function ArtworkCropper({ src, onCancel, onApply }: Props) {
  const [left, setLeft] = useState(0);
  const [top, setTop] = useState(0);
  const [width, setWidth] = useState(100);
  const [height, setHeight] = useState(100);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const dragRef = useRef<{ mode: DragMode; pointerId: number; startX: number; startY: number; left: number; top: number; width: number; height: number } | null>(null);

  const beginDrag = (mode: DragMode, event: ReactPointerEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { mode, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, left, top, width, height };
  };
  const moveCrop = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const dx = ((event.clientX - drag.startX) / bounds.width) * 100;
    const dy = ((event.clientY - drag.startY) / bounds.height) * 100;
    const minSize = 5;
    if (drag.mode === "move") {
      setLeft(Math.max(0, Math.min(100 - drag.width, drag.left + dx)));
      setTop(Math.max(0, Math.min(100 - drag.height, drag.top + dy)));
      return;
    }
    let x1 = drag.left, y1 = drag.top, x2 = drag.left + drag.width, y2 = drag.top + drag.height;
    if (drag.mode.includes("w")) x1 = Math.max(0, Math.min(x2 - minSize, drag.left + dx));
    if (drag.mode.includes("e")) x2 = Math.min(100, Math.max(x1 + minSize, drag.left + drag.width + dx));
    if (drag.mode.includes("n")) y1 = Math.max(0, Math.min(y2 - minSize, drag.top + dy));
    if (drag.mode.includes("s")) y2 = Math.min(100, Math.max(y1 + minSize, drag.top + drag.height + dy));
    setLeft(x1); setTop(y1); setWidth(x2 - x1); setHeight(y2 - y1);
  };
  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  };

  const applyCrop = async () => {
    setBusy(true);
    setError("");
    try {
      const image = new Image();
      image.src = src;
      await image.decode();
      const sx = Math.round((left / 100) * image.naturalWidth);
      const sy = Math.round((top / 100) * image.naturalHeight);
      const sw = Math.max(1, Math.round((width / 100) * image.naturalWidth));
      const sh = Math.max(1, Math.round((height / 100) * image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = sw;
      canvas.height = sh;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Your browser could not create the crop.");
      context.drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh);
      onApply(canvas.toDataURL("image/png"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not crop this image.");
      setBusy(false);
    }
  };
  const updateWidth = (value: number) => setWidth(Math.min(value, 100 - left));
  const updateHeight = (value: number) => setHeight(Math.min(value, 100 - top));
  const updateLeft = (value: number) => { const next = Math.min(value, 95); setLeft(next); setWidth((current) => Math.min(current, 100 - next)); };
  const updateTop = (value: number) => { const next = Math.min(value, 95); setTop(next); setHeight((current) => Math.min(current, 100 - next)); };

  return (
    <div className="crop-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onCancel()}>
      <section className="crop-dialog" role="dialog" aria-modal="true" aria-labelledby="crop-title">
        <header className="crop-dialog-head">
          <div><h2 id="crop-title">Crop artwork</h2><p>Drag the box to move it, or drag a corner to resize the crop.</p></div>
          <button type="button" className="icon-btn" aria-label="Close crop tool" onClick={onCancel}>×</button>
        </header>
        <div className="crop-preview-wrap">
          <div className="crop-preview" onPointerMove={moveCrop} onPointerUp={endDrag} onPointerCancel={endDrag}>
            <img src={src} alt="Artwork to crop" draggable={false} />
            <div className="crop-dim" style={{ left: 0, top: 0, width: "100%", height: `${top}%` }} />
            <div className="crop-dim" style={{ left: 0, top: `${top}%`, width: `${left}%`, height: `${height}%` }} />
            <div className="crop-dim" style={{ left: `${left + width}%`, top: `${top}%`, width: `${100 - left - width}%`, height: `${height}%` }} />
            <div className="crop-dim" style={{ left: 0, top: `${top + height}%`, width: "100%", height: `${100 - top - height}%` }} />
            <div className="crop-selection" onPointerDown={(event) => beginDrag("move", event)} style={{ left: `${left}%`, top: `${top}%`, width: `${width}%`, height: `${height}%` }}>
              {(["nw", "ne", "sw", "se"] as const).map((corner) => <span key={corner} className={`crop-handle crop-handle-${corner}`} role="presentation" onPointerDown={(event) => beginDrag(corner, event)} />)}
            </div>
          </div>
        </div>
        <div className="crop-controls">
          <label>Left <b>{left}%</b><input type="range" min="0" max="95" value={left} onChange={(event) => updateLeft(Number(event.target.value))} /></label>
          <label>Top <b>{top}%</b><input type="range" min="0" max="95" value={top} onChange={(event) => updateTop(Number(event.target.value))} /></label>
          <label>Width <b>{width}%</b><input type="range" min="5" max={100 - left} value={width} onChange={(event) => updateWidth(Number(event.target.value))} /></label>
          <label>Height <b>{height}%</b><input type="range" min="5" max={100 - top} value={height} onChange={(event) => updateHeight(Number(event.target.value))} /></label>
        </div>
        {error && <p className="crop-error" role="alert">{error}</p>}
        <footer className="crop-actions"><button type="button" className="secondary" onClick={onCancel} disabled={busy}>Cancel</button><button type="button" className="crop-apply" onClick={applyCrop} disabled={busy}>{busy ? "Cropping…" : "Apply crop"}</button></footer>
      </section>
    </div>
  );
}
