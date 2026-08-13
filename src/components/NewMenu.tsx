import { ReactNode } from "react";
import { createPortal } from "react-dom";
import { useAnchoredMenu } from "./useAnchoredMenu";

interface Props {
  onAddHost: () => void;
  onLocalShell: () => void;
  onImportProfile: () => void;
  onImportSshConfig: () => void;
  /** In-flight flags, so an import can't be started twice. */
  importingProfile?: boolean;
  importingSshConfig?: boolean;
}

interface Entry {
  id: string;
  label: string;
  hint: string;
  icon: ReactNode;
  run: () => void;
  busy?: boolean;
}

const ICON = {
  host: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="2" y="3" width="20" height="14" rx="2" /><polyline points="8 21 12 17 16 21" />
    </svg>
  ),
  shell: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  ),
  profile: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  ),
  config: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 4h16v4H4zM4 12h10M4 17h7" strokeLinecap="round" />
    </svg>
  ),
  plus: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  ),
};

/**
 * The four ways to get a session into the sidebar, behind one button.
 *
 * They were four buttons wrapping onto two rows in a narrow sidebar, three of
 * which read "Import"-something and were hard to tell apart at a glance. As a
 * menu each gets a label and a line saying what it actually does.
 *
 * Portalled and anchored, because `.sidebar` is `overflow: hidden` and would
 * otherwise slice the menu off at its edge.
 */
export function NewMenu({
  onAddHost, onLocalShell, onImportProfile, onImportSshConfig,
  importingProfile, importingSshConfig,
}: Props) {
  // Anchored above: this lives in the sidebar footer, so there is never room
  // below it.
  const { open, setOpen, triggerRef, menuRef, style } = useAnchoredMenu({
    prefer: "above",
    align: "left",
  });

  const entries: Entry[] = [
    {
      id: "host",
      label: "Add host",
      hint: "Enter connection details by hand",
      icon: ICON.host,
      run: onAddHost,
    },
    {
      id: "shell",
      label: "Local shell",
      hint: "A terminal on this machine",
      icon: ICON.shell,
      run: onLocalShell,
    },
    {
      id: "profile",
      label: importingProfile ? "Importing…" : "Import profile",
      hint: "A shared .sshm file",
      icon: ICON.profile,
      run: onImportProfile,
      busy: importingProfile,
    },
    {
      id: "config",
      label: importingSshConfig ? "Importing…" : "Import SSH config",
      hint: "Hosts from ~/.ssh/config",
      icon: ICON.config,
      run: onImportSshConfig,
      busy: importingSshConfig,
    },
  ];

  return (
    <div className="new-wrap" ref={triggerRef}>
      <button
        className="btn btn-primary new-trigger"
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {ICON.plus}
        New
      </button>

      {open &&
        createPortal(
          <div className="tools-dropdown new-dropdown anchored-menu" role="menu" ref={menuRef} style={style}>
            <p className="fwd-dropdown-title">Add a session</p>
            {entries.map((e) => (
<button
  key={e.id}
  role="menuitem"
  className="tools-item new-item"
  disabled={e.busy}
  onClick={() => {
    if (e.busy) return;
    setOpen(false);
    e.run();
  }}
>
  <span className="tools-item-icon">{e.icon}</span>
  <span className="new-item-text">
    <span className="tools-item-label">{e.label}</span>
    <span className="new-item-hint">{e.hint}</span>
  </span>
</button>
            ))}
          </div>,
          document.body
        )}
    </div>
  );
}
