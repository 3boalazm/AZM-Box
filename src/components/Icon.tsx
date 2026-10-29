import type { ReactNode, SVGProps } from "react";

export type IconName = "box" | "new" | "open" | "save" | "undo" | "redo" | "help" | "dieline" | "cube" | "download" | "chevron" | "image" | "plus" | "trash" | "close" | "crop" | "layers" | "expand" | "more" | "minus" | "ruler" | "lock";

const paths: Record<IconName, ReactNode> = {
  box: <><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4.3 7.6 7.7 4.3 7.7-4.3M12 12v9M8 5.2l8 4.5"/></>,
  new: <><path d="M12 5v14M5 12h14"/></>,
  open: <><path d="M3 7.5h7l2 2h9v9H3z"/><path d="M3 7.5V5h7l2 2.5"/></>,
  save: <><path d="M5 3h12l3 3v15H4V3h1Z"/><path d="M8 3v6h8V3M8 21v-7h8v7"/></>,
  undo: <><path d="M9 14 4 9l5-5"/><path d="M4 9h9a7 7 0 0 1 0 14h-2"/></>,
  redo: <><path d="m15 14 5-5-5-5"/><path d="M20 9h-9a7 7 0 0 0 0 14h2"/></>,
  help: <><circle cx="12" cy="12" r="9"/><path d="M9.7 9a2.4 2.4 0 1 1 4 1.8c-1 .7-1.7 1.1-1.7 2.7M12 17h.01"/></>,
  dieline: <><path d="M4 5h6v6H4zM14 5h6v6h-6zM4 15h6v5H4zM14 15h6v5h-6z"/><path d="M10 8h4m-7 3v4m10-4v4m-3 3h-4"/></>,
  cube: <><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4.3 7.6 7.7 4.3 7.7-4.3M12 12v9"/></>,
  download: <><path d="M12 3v12m-5-5 5 5 5-5"/><path d="M5 17v4h14v-4"/></>,
  chevron: <path d="m7 10 5 5 5-5"/>,
  image: <><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="m21 15-5-5L5 20"/></>,
  plus: <><path d="M12 5v14M5 12h14"/></>,
  trash: <><path d="M4 7h16M10 11v6m4-6v6M6 7l1 14h10l1-14M9 7V4h6v3"/></>,
  close: <><path d="m6 6 12 12M18 6 6 18"/></>,
  crop: <><path d="M7 3v13a3 3 0 0 0 3 3h11M3 7h13a3 3 0 0 1 3 3v11"/></>,
  layers: <><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5m-18 5 9 5 9-5"/></>,
  expand: <><path d="M8 3H3v5M16 3h5v5M3 16v5h5m13-5v5h-5"/><path d="M8 8 3 3m13 5 5-5M8 16l-5 5m13-5 5 5"/></>,
  more: <><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>,
  minus: <path d="M5 12h14"/>,
  ruler: <><path d="M4 7 7 4l13 13-3 3L4 7Z"/><path d="m8 8 2-2m1 5 2-2m1 5 2-2"/></>,
  lock: <><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></>,
};

export default function Icon({ name, ...props }: SVGProps<SVGSVGElement> & { name: IconName }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}>{paths[name]}</svg>;
}
