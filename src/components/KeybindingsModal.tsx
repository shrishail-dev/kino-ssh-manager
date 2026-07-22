import { useEffect, useState } from "react";
import { useVaultStore } from "../store";
import { comboFromEvent, formatCombo, KEY_ACTIONS, KeyActionId } from "../keymap";

interface Props {
  onClose: () => void;
}

export function KeybindingsModal({ onClose }: Props) {
  const { keybindings, setKeybinding, resetKeybinding, resetAllKeybindings } = useVaultStore();
  // Which action is currently capturing a new combo (null = not recording).
  const [recording, setRecording] = useState<KeyActionId | null>(null);

  // While recording, the next real key combo becomes the binding. Escape aborts.
  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") { setRecording(null); return; }
      const combo = comboFromEvent(e);
      if (!combo) return; // modifier-only; wait for a real key
      setKeybinding(recording, combo);
      setRecording(null);
    };
    // Capture phase so the combo doesn't also trigger app/terminal handlers.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recording, setKeybinding]);

  // Count combos so duplicates can be flagged.
  const counts: Record<string, number> = {};
  for (const a of KEY_ACTIONS) {
    const c = keybindings[a.id];
    if (c) counts[c] = (counts[c] ?? 0) + 1;
  }

  const categories = ["Global", "Terminal"] as const;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal ai-settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Keyboard Shortcuts</h2>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>

        <div className="ai-settings-body">
          {categories.map((cat) => (
            <div className="form-section" key={cat}>
              <div className="form-section-title"><span>{cat}</span></div>
              {KEY_ACTIONS.filter((a) => a.category === cat).map((a) => {
                const combo = keybindings[a.id];
                const isRecording = recording === a.id;
                const isCustom = combo !== a.default;
                const conflict = combo && counts[combo] > 1;
                return (
                  <div className="keybind-row" key={a.id}>
                    <span className="keybind-label">{a.label}</span>
                    <div className="keybind-controls">
                      {conflict && !isRecording && (
                        <span className="keybind-conflict" title="This combo is assigned to more than one action">conflict</span>
                      )}
                      <button
                        className={`keybind-combo ${isRecording ? "recording" : ""}`}
                        onClick={() => setRecording(isRecording ? null : a.id)}
                        title="Click, then press the new shortcut (Esc to cancel)"
                      >
                        {isRecording ? "Press keys…" : <kbd>{formatCombo(combo)}</kbd>}
                      </button>
                      {isCustom && !isRecording && (
                        <button className="icon-btn keybind-reset" title="Reset to default" onClick={() => resetKeybinding(a.id)}>
                          ↺
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
          <p className="hint">
            Click a shortcut, then press the keys you want. Terminal shortcuts are captured before
            the shell sees them, so avoid combos you rely on inside programs.
          </p>
        </div>

        <div className="modal-footer">
          <button className="btn" onClick={onClose} style={{ marginRight: "auto" }}>Close</button>
          <button className="btn" onClick={resetAllKeybindings}>Reset all</button>
        </div>
      </div>
    </div>
  );
}
