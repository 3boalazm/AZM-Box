import { useState } from "react";

interface Props {
  src: string;
  onCancel: () => void;
  onApply: (croppedDataUrl: string) => void;
}

export default function ArtworkCropper({ src, onCancel, onApply }: Props) {
  const [left, setLeft] = useState(0);
  const [top, setTop] = useState(0);
  const [width, setWidth] = useState(100);
  const [height, setHeight] = useState(100);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

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
  const updateLeft = (value: number) => {
    const next = Math.min(value, 95);
    setLeft(next);
    setWidth((current) => Math.min(current, 100 - next));
  };
  const updateTop = (value: number) => {
    const next = Math.min(value, 95);
    setTop(next);
    setHeight((current) => Math.min(current, 100 - next));
  };

  return (
    <div className="crop-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onCancel()}>
      <section className="crop-dialog" role="dialog" aria-modal="true" aria-labelledby="crop-title">
        <header className="crop-dialog-head">
          <div>
            <h2 id="crop-title">Crop artwork</h2>
            <p>Adjust the crop area, then apply it to the artwork sheet.</p>
          </div>
          <button type="button" className="icon-btn" aria-label="Close crop tool" onClick={onCancel}>×</button>
        </header>

        <div className="crop-preview-wrap">
          <div className="crop-preview">
            <img src={src} alt="Artwork to crop" />
            <div className="crop-dim" style={{ left: 0, top: 0, width: "100%", height: `${top}%` }} />
            <div className="crop-dim" style={{ left: 0, top: `${top}%`, width: `${left}%`, height: `${height}%` }} />
            <div className="crop-dim" style={{ left: `${left + width}%`, top: `${top}%`, width: `${100 - left - width}%`, height: `${height}%` }} />
            <div className="crop-dim" style={{ left: 0, top: `${top + height}%`, width: "100%", height: `${100 - top - height}%` }} />
            <div className="crop-selection" style={{ left: `${left}%`, top: `${top}%`, width: `${width}%`, height: `${height}%` }} />
          </div>
        </div>

        <div className="crop-controls">
          <label>Left <b>{left}%</b><input type="range" min="0" max="95" value={left} onChange={(event) => updateLeft(Number(event.target.value))} /></label>
          <label>Top <b>{top}%</b><input type="range" min="0" max="95" value={top} onChange={(event) => updateTop(Number(event.target.value))} /></label>
          <label>Width <b>{width}%</b><input type="range" min="5" max={100 - left} value={width} onChange={(event) => updateWidth(Number(event.target.value))} /></label>
          <label>Height <b>{height}%</b><input type="range" min="5" max={100 - top} value={height} onChange={(event) => updateHeight(Number(event.target.value))} /></label>
        </div>
        {error && <p className="crop-error" role="alert">{error}</p>}
        <footer className="crop-actions">
          <button type="button" className="secondary" onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="button" className="crop-apply" onClick={applyCrop} disabled={busy}>{busy ? "Cropping…" : "Apply crop"}</button>
        </footer>
      </section>
    </div>
  );
}
