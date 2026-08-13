import { useEffect, useLayoutEffect, useRef, useState } from "react";

interface Options {
  /** Which side of the trigger to try first; it flips if there isn't room. */
  prefer?: "below" | "above";
  /** Which edge to line the menu up with. */
  align?: "left" | "right";
}

/** Keep clear of the window edge by this much. */
const MARGIN = 8;

/**
 * A dropdown that is portalled to `<body>` and positioned against its trigger.
 *
 * Menus in this app keep landing inside scroll containers - the host list, the
 * sidebar - and a scroll container clips its absolutely-positioned descendants,
 * which silently slices the menu in half. Rendering into `<body>` and
 * positioning in viewport coordinates is the only arrangement that survives
 * wherever the trigger happens to sit.
 *
 * The subtlety that comes with it: the menu is no longer a DOM descendant of
 * the trigger, so a click-outside handler that only checks the trigger would
 * close the menu on `mousedown` and destroy the button before its `click` ever
 * landed - every item would silently do nothing. Both nodes are checked here.
 *
 * The menu element MUST carry the `anchored-menu` class alongside whatever
 * class gives it its looks. The `style` returned here is viewport coordinates,
 * which only mean anything under `position: fixed`, and a borrowed class that
 * still sets `right` or `bottom` will stretch the box between that edge and our
 * `left`. The measurement below then reads the stretched width and places the
 * menu off-screen - it renders, but nowhere anyone can see it.
 */
export function useAnchoredMenu({ prefer = "below", align = "right" }: Options = {}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  /**
   * Measured in a layout effect so the position lands before paint: the first
   * commit renders the menu off-screen, and this corrects it without a flash.
   */
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const place = () => {
      const trigger = triggerRef.current?.getBoundingClientRect();
      const menu = menuRef.current;
      if (!trigger || !menu) return;
      const { offsetWidth: w, offsetHeight: h } = menu;

      const below = trigger.bottom + 4;
      const above = trigger.top - 4 - h;
      const fitsBelow = below + h <= window.innerHeight - MARGIN;
      const fitsAbove = above >= MARGIN;

      let top: number;
      if (prefer === "below") top = fitsBelow || !fitsAbove ? below : above;
      else top = fitsAbove || !fitsBelow ? above : below;
      top = Math.max(MARGIN, Math.min(top, window.innerHeight - h - MARGIN));

      const raw = align === "right" ? trigger.right - w : trigger.left;
      const left = Math.min(Math.max(MARGIN, raw), window.innerWidth - w - MARGIN);

      setPos({ top, left });
    };
    place();
    // Capture phase: a scrolling panel's own scroll doesn't bubble to window.
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, prefer, align]);

  return {
    open,
    setOpen,
    triggerRef,
    menuRef,
    /** Spread onto the portalled menu; parks it off-screen until measured. */
    style: { top: pos?.top ?? -9999, left: pos?.left ?? -9999 } as const,
  };
}
