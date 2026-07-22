import { useEffect, useRef, useState } from "react";

export interface MenuItem {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  /** Render as a non-interactive section header instead of a button. */
  header?: boolean;
}

interface Props {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}

/** A lightweight right-click menu positioned at (x, y), kept inside the viewport.
 *  Closes on outside click, Escape, scroll, or after an item is chosen. */
export function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  useEffect(() => {
    // Nudge the menu back on-screen if it would overflow the right/bottom edge.
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let nx = x;
    let ny = y;
    if (x + r.width > window.innerWidth) nx = Math.max(8, window.innerWidth - r.width - 8);
    if (y + r.height > window.innerHeight) ny = Math.max(8, window.innerHeight - r.height - 8);
    if (nx !== pos.x || ny !== pos.y) setPos({ x: nx, y: ny });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [x, y]);

  useEffect(() => {
    // Close on a press OUTSIDE the menu. A blanket capture-phase close would fire
    // before an item's click and dismiss the menu before the click registered, so
    // a press inside must be ignored here and left to the item's own handler.
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="context-menu"
      style={{ top: pos.y, left: pos.x }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, i) =>
        item.header ? (
          <div key={i} className="context-menu-header">{item.label}</div>
        ) : (
          <button
            key={i}
            className="context-menu-item"
            disabled={item.disabled}
            onClick={() => { item.onClick?.(); onClose(); }}
          >
            {item.label}
          </button>
        )
      )}
    </div>
  );
}
