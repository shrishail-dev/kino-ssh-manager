import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { save, open as openDialog } from "@tauri-apps/plugin-dialog";
import { useVaultStore } from "../store";
import { ExportProfileModal } from "./ExportProfileModal";
import { slug } from "../utils";
import type { Host } from "../store";

interface Props {
  host: Host;
}

export function ExportMenu({ host }: Props) {
  const { exportSshKey } = useVaultStore();
  const [menuOpen, setMenuOpen] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [status, setStatus] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // Viewport coordinates for the portalled menu; null until measured.
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      const t = e.target as Node;
      // The menu is portalled to <body>, so it is NOT inside `ref` - it has to
      // be checked separately or mousedown on a menu item would unmount the
      // button before its click ever landed.
      if (ref.current?.contains(t) || menuRef.current?.contains(t)) return;
      setMenuOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  /**
   * Position the menu against the trigger, in viewport coordinates.
   *
   * It has to be portalled and fixed rather than absolutely positioned in the
   * row: `.host-list` is a scroll container, and a scroll container clips its
   * absolutely-positioned descendants. Any host low in the list had its menu
   * sliced off at the list's bottom edge.
   *
   * Runs in a layout effect so the measured position is applied before paint -
   * the first commit renders it off-screen, and it is corrected without a flash.
   */
  useLayoutEffect(() => {
    if (!menuOpen) {
      setPos(null);
      return;
    }
    const place = () => {
      const trigger = ref.current?.getBoundingClientRect();
      const menu = menuRef.current;
      if (!trigger || !menu) return;
      const { offsetWidth: w, offsetHeight: h } = menu;
      const M = 8; // keep clear of the window edge
      // Prefer below the trigger; flip above when it would not fit.
      const below = trigger.bottom + 4;
      const top =
        below + h > window.innerHeight - M ? Math.max(M, trigger.top - 4 - h) : below;
      // Right-aligned to the trigger, clamped into the viewport.
      const left = Math.min(Math.max(M, trigger.right - w), window.innerWidth - w - M);
      setPos({ top, left });
    };
    place();
    // Capture phase: the sidebar's own scroll doesn't bubble to window.
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [menuOpen]);

  function flash(msg: string) {
    setStatus(msg);
    setTimeout(() => setStatus(""), 2000);
  }

  function handleExportProfile() {
    // The profile carries the host's password and private key, so the encryption
    // choice happens in a dedicated dialog rather than dumping straight to disk.
    setMenuOpen(false);
    setShowExport(true);
  }

  async function handleExportPrivKey() {
    setMenuOpen(false);
    const path = await save({
      title: "Export Private Key",
      defaultPath: `${slug(host.name)}_id_ed25519`,
      filters: [{ name: "Private Key", extensions: ["pem", "key"] }],
    });
    if (!path) return;
    await exportSshKey(host.private_key!, path as string);
    flash("Private key exported");
  }

  async function handleExportPubKey() {
    setMenuOpen(false);
    const path = await save({
      title: "Export Public Key",
      defaultPath: `${slug(host.name)}_id_ed25519.pub`,
      filters: [{ name: "Public Key", extensions: ["pub"] }],
    });
    if (!path) return;
    await exportSshKey(host.public_key!, path as string);
    flash("Public key exported");
  }

  async function handleCopyPubKey() {
    setMenuOpen(false);
    await navigator.clipboard.writeText(host.public_key!);
    flash("Copied!");
  }

  return (
    // `open` is what keeps the row's action strip visible once the pointer
    // moves off the row and into the menu - see .host-actions in index.css.
    <div className={`export-wrap ${menuOpen ? "open" : ""}`} ref={ref}>
      <button
        className="icon-btn"
        title={status || "Export / Keys"}
        onClick={() => setMenuOpen((v) => !v)}
      >
        {status ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2.5">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        )}
      </button>

      {menuOpen && createPortal(
        <div
          className="export-dropdown export-dropdown--floating"
          ref={menuRef}
          style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
        >
          <p className="export-dropdown-title">Export</p>

          <button className="export-item" onClick={handleExportProfile}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            Full profile (.sshm)
          </button>

          {host.private_key && (
            <button className="export-item" onClick={handleExportPrivKey}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
              </svg>
              Private key (id_ed25519)
            </button>
          )}

          {host.public_key && (
            <>
              <button className="export-item" onClick={handleExportPubKey}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                Public key (.pub)
              </button>
              <button className="export-item" onClick={handleCopyPubKey}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
                Copy public key
              </button>
            </>
          )}
        </div>,
        document.body
      )}

      {showExport && (
        <ExportProfileModal
          host={host}
          onClose={() => setShowExport(false)}
          onExported={flash}
        />
      )}
    </div>
  );
}

/** Ask the user for a profile file. Returns the path, or null if they cancelled. */
export async function pickProfileFile(): Promise<string | null> {
  const result = await openDialog({
    title: "Import Host Profile",
    filters: [{ name: "Kino SSH Manager Profile", extensions: ["sshm", "json"] }],
    multiple: false,
  });
  if (!result) return null;
  return (Array.isArray(result) ? result[0] : result) as string;
}
