// Central registry of rebindable keyboard shortcuts.
//
// Every customizable action has a stable id, a human label, and a
// platform-aware default combo. Bindings are stored as canonical strings like
// "Ctrl+Shift+C" or "Meta+K": modifiers first in a fixed order (Ctrl, Alt,
// Shift, Meta), then the key. `comboFromEvent` produces the same canonical form
// from a live KeyboardEvent, so matching is a plain string compare.

export type KeyActionId =
  | "command-palette"
  | "broadcast-toggle"
  | "term-find"
  | "term-copy"
  | "term-paste"
  | "term-font-inc"
  | "term-font-dec"
  | "term-font-reset"
  | "term-clear";

export interface KeyAction {
  id: KeyActionId;
  label: string;
  category: "Global" | "Terminal";
  default: string;
}

export const IS_MAC =
  typeof navigator !== "undefined" &&
  /mac/i.test(navigator.platform || navigator.userAgent || "");

// The "primary" modifier: Cmd on macOS, Ctrl elsewhere.
const MOD = IS_MAC ? "Meta" : "Ctrl";

export const KEY_ACTIONS: KeyAction[] = [
  { id: "command-palette", label: "Open command palette", category: "Global", default: `${MOD}+K` },
  { id: "broadcast-toggle", label: "Toggle broadcast input", category: "Global", default: "Ctrl+Shift+B" },
  { id: "term-find", label: "Find in terminal", category: "Terminal", default: "Ctrl+F" },
  { id: "term-copy", label: "Copy selection", category: "Terminal", default: "Ctrl+Shift+C" },
  { id: "term-paste", label: "Paste", category: "Terminal", default: "Ctrl+Shift+V" },
  { id: "term-font-inc", label: "Increase font size", category: "Terminal", default: "Ctrl+=" },
  { id: "term-font-dec", label: "Decrease font size", category: "Terminal", default: "Ctrl+-" },
  { id: "term-font-reset", label: "Reset font size", category: "Terminal", default: "Ctrl+0" },
  { id: "term-clear", label: "Clear scrollback", category: "Terminal", default: "Ctrl+Shift+K" },
];

export const DEFAULT_KEYBINDINGS: Record<KeyActionId, string> = KEY_ACTIONS.reduce(
  (acc, a) => { acc[a.id] = a.default; return acc; },
  {} as Record<KeyActionId, string>
);

const MODIFIER_KEYS = new Set(["Control", "Shift", "Alt", "Meta"]);

/** Canonicalize a single key value (letters upper-cased; space named). */
function normalizeKey(key: string): string | null {
  if (MODIFIER_KEYS.has(key)) return null; // modifier-only press
  if (key === " " || key === "Spacebar") return "Space";
  if (key.length === 1) return key.toUpperCase();
  return key; // Enter, Escape, ArrowUp, Tab, F1…F12, etc.
}

/**
 * Build the canonical combo string for a KeyboardEvent, or null if only a
 * modifier is held. Accepts anything with the standard modifier/key fields, so
 * it works for both DOM events and xterm's forwarded events.
 */
export function comboFromEvent(e: {
  ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean; key: string;
}): string | null {
  const key = normalizeKey(e.key);
  if (!key) return null;
  const parts: string[] = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  if (e.metaKey) parts.push("Meta");
  parts.push(key);
  return parts.join("+");
}

/** Pretty-print a combo for display (⌘/⌥ on macOS, "Ctrl" elsewhere). */
export function formatCombo(combo: string): string {
  if (!combo) return "-";
  return combo
    .split("+")
    .map((p) => {
      if (p === "Meta") return IS_MAC ? "⌘" : "Win";
      if (p === "Alt") return IS_MAC ? "⌥" : "Alt";
      if (p === "Ctrl") return IS_MAC ? "⌃" : "Ctrl";
      if (p === "Shift") return IS_MAC ? "⇧" : "Shift";
      return p;
    })
    .join(IS_MAC ? "" : "+");
}
