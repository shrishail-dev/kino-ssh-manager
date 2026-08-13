import { useEffect } from "react";
import { ReleaseNote, markSeen } from "../releaseNotes";

interface Props {
  note: ReleaseNote;
  onClose: () => void;
}

/**
 * The once-per-upgrade release notes, over the unlock screen.
 *
 * Dismissing is what marks the version seen - not showing it. If the app is
 * closed with this still open, it comes back next launch, which is the
 * behaviour you want from something whose whole job is to be read once.
 */
export function WhatsNew({ note, onClose }: Props) {
  function dismiss() {
    markSeen(note.version);
    onClose();
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") dismiss();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="modal-overlay whatsnew-overlay" onClick={dismiss}>
      <div className="modal whatsnew" onClick={(e) => e.stopPropagation()}>
        <div className="whatsnew-head">
          <p className="whatsnew-eyebrow">Now showing</p>
          <h2 className="whatsnew-version">v{note.version}</h2>
          <button className="icon-btn whatsnew-close" onClick={dismiss} title="Dismiss">
            ✕
          </button>
        </div>

        <p className="whatsnew-headline">{note.headline}</p>

        <ol className="whatsnew-list">
          {note.items.map((item, i) => (
            <li key={item.title} className="whatsnew-item">
              <span className="whatsnew-num">{String(i + 1).padStart(2, "0")}</span>
              <div className="whatsnew-body">
                <p className="whatsnew-title">{item.title}</p>
                <p className="whatsnew-detail">{item.detail}</p>
              </div>
            </li>
          ))}
        </ol>

        <div className="whatsnew-foot">
          <button className="btn btn-primary btn-sm" onClick={dismiss}>
            Got it
          </button>
          <span className="whatsnew-foot-note">Shown once per release</span>
        </div>
      </div>
    </div>
  );
}
