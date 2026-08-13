import { CSSProperties, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useAnchoredMenu } from "./useAnchoredMenu";

export interface SelectOption {
  value: string;
  label: string;
  /** Second line, for options that need explaining. */
  hint?: string;
  /** Extra style for the label - the font pickers set fontFamily so each
   *  option is drawn in the face it names. */
  labelStyle?: CSSProperties;
}

interface Props {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  className?: string;
  "aria-label"?: string;
  disabled?: boolean;
}

/**
 * A select that actually follows the theme.
 *
 * A native `<select>` can be styled shut but not open: on Linux the popup is
 * drawn by GTK, which ignores the page's CSS entirely - so the list came up in
 * the system's colours and system font, in the middle of a dark, custom-typeset
 * app. `option { background: … }` is quietly discarded there.
 *
 * So the list is ours: a button plus a portalled, anchored listbox using the
 * same ink and type as everything else. Being ours, it can also draw each
 * option in its own typeface, which is what makes the font pickers legible as
 * pickers rather than as a list of names.
 */
export function Select({
  value, options, onChange, className = "", disabled, ...rest
}: Props) {
  const { open, setOpen, triggerRef, menuRef, style } = useAnchoredMenu({
    prefer: "below",
    align: "left",
  });
  const listRef = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value);

  // Keep the selected row in view when the list opens - with fifteen themes the
  // active one is often well below the fold.
  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector<HTMLElement>('[data-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [open]);

  function move(delta: number) {
    const i = options.findIndex((o) => o.value === value);
    const next = options[Math.min(options.length - 1, Math.max(0, i + delta))];
    if (next) onChange(next.value);
  }

  return (
    <div className="sel-wrap" ref={triggerRef}>
      <button
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-label={rest["aria-label"]}
        disabled={disabled}
        className={`sel-trigger ${className}`}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          // Arrow keys change the value in place, matching a native select.
          if (e.key === "ArrowDown") { e.preventDefault(); open ? null : move(1); }
          if (e.key === "ArrowUp") { e.preventDefault(); open ? null : move(-1); }
          if ((e.key === "Enter" || e.key === " ") && !open) { e.preventDefault(); setOpen(true); }
        }}
      >
        <span className="sel-value" style={current?.labelStyle}>
          {current?.label ?? value}
        </span>
        <svg className="sel-caret" width="10" height="10" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open &&
        createPortal(
          <div className="sel-list anchored-menu" role="listbox" ref={menuRef} style={style}>
            <div className="sel-scroll" ref={listRef}>
              {options.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  role="option"
                  aria-selected={o.value === value}
                  data-selected={o.value === value}
                  className={`sel-option ${o.value === value ? "selected" : ""}`}
                  onClick={() => {
                    setOpen(false);
                    if (o.value !== value) onChange(o.value);
                  }}
                >
                  <span className="sel-option-label" style={o.labelStyle}>{o.label}</span>
                  {o.hint && <span className="sel-option-hint">{o.hint}</span>}
                </button>
              ))}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
