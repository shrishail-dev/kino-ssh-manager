import { useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { THEMES } from "../themes";
import { useVaultStore } from "../store";
import { HistoryModal } from "./HistoryModal";
import { SyncModal } from "./SyncModal";
import { SnippetsModal } from "./SnippetsModal";
import { ChangePasswordModal } from "./ChangePasswordModal";
import { AboutModal } from "./AboutModal";
import { RecordingsModal } from "./RecordingsModal";
import { AiSettingsModal } from "./AiSettingsModal";
import { KeybindingsModal } from "./KeybindingsModal";

interface Props {
  onLock: () => void;
}

export function SettingsMenu({ onLock }: Props) {
  const {
    theme: themeId,
    setTheme,
    idleLockMinutes,
    setIdleLockMinutes,
    updateInfo,
    relayEnabled,
    setRelayEnabled,
    defaultRelayUrl,
    setDefaultRelayUrl,
    copilotEnabled,
    setCopilotEnabled,
    restoreSessionEnabled,
    setRestoreSessionEnabled,
    autoReconnect,
    setAutoReconnect,
    exportSshConfig,
  } = useVaultStore();
  const [exportingConfig, setExportingConfig] = useState(false);
  const [open, setOpen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showRecordings, setShowRecordings] = useState(false);
  const [showSync, setShowSync] = useState(false);
  const [showSnippets, setShowSnippets] = useState(false);
  const [showChangePw, setShowChangePw] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [showAi, setShowAi] = useState(false);
  const [showKeys, setShowKeys] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function handleLock() {
    setOpen(false);
    onLock();
  }

  async function handleExportSshConfig() {
    setExportingConfig(true);
    try {
      const count = await exportSshConfig();
      setOpen(false);
      window.dispatchEvent(new CustomEvent("kino:toast", {
        detail: `Wrote ${count} host${count === 1 ? "" : "s"} to ~/.ssh/config`,
      }));
    } catch (e) {
      alert(`Could not write ~/.ssh/config: ${e}`);
    } finally {
      setExportingConfig(false);
    }
  }

  return (
    <div className="settings-wrap" ref={ref}>
      <button
        className={`header-icon-btn ${open ? "active" : ""}`}
        onClick={() => setOpen((v) => !v)}
        title="Settings"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
        {updateInfo?.available && <span className="update-badge" title="Update available" />}
      </button>

      {open && (
        <div className="settings-dropdown">
          {updateInfo?.available && (
            <>
              <button
                className="settings-action settings-update"
                onClick={() => { setOpen(false); openUrl(updateInfo.url).catch(() => {}); }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 3v12" />
                  <polyline points="7 10 12 15 17 10" />
                  <path d="M5 21h14" />
                </svg>
                Update available - v{updateInfo.latest}
              </button>
              <div className="settings-divider" />
            </>
          )}
          <div className="settings-row">
            <span>Theme</span>
            <select
              className="settings-select"
              value={themeId}
              onChange={(e) => setTheme(e.target.value)}
            >
              <optgroup label="Dark">
                {THEMES.filter((t) => t.dark).map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </optgroup>
              <optgroup label="Light">
                {THEMES.filter((t) => !t.dark).map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </optgroup>
            </select>
          </div>

          <div className="settings-divider" />

          <div className="settings-row">
            <span>Auto-lock</span>
            <select
              className="settings-select"
              value={idleLockMinutes}
              onChange={(e) => setIdleLockMinutes(Number(e.target.value))}
            >
              <option value={0}>Off</option>
              <option value={5}>5 min</option>
              <option value={15}>15 min</option>
              <option value={30}>30 min</option>
              <option value={60}>1 hour</option>
            </select>
          </div>
          
          <div className="settings-row">
            <span>Auto-reconnect</span>
            <select
              className="settings-select"
              value={autoReconnect ? "1" : "0"}
              onChange={(e) => setAutoReconnect(e.target.value === "1")}
            >
              <option value="1">On</option>
              <option value="0">Off</option>
            </select>
          </div>

          <div className="settings-divider" />

          <div className="settings-row">
            <span>Kino Agent</span>
            <select
              className="settings-select"
              value={relayEnabled ? "1" : "0"}
              onChange={(e) => setRelayEnabled(e.target.value === "1")}
            >
              <option value="0">Off</option>
              <option value="1">On</option>
            </select>
          </div>

          {relayEnabled && (
            <div className="settings-row">
              <span>Relay Server URL</span>
              <input
                type="text"
                className="settings-select"
                style={{ padding: "4px 8px", fontSize: "13px" }}
                placeholder="wss://relay.kino.app"
                value={defaultRelayUrl}
                onChange={(e) => setDefaultRelayUrl(e.target.value)}
              />
            </div>
          )}

          <div className="settings-row">
            <span>AI Copilot</span>
            <select
              className="settings-select"
              value={copilotEnabled ? "1" : "0"}
              onChange={(e) => setCopilotEnabled(e.target.value === "1")}
            >
              <option value="0">Off</option>
              <option value="1">On</option>
            </select>
          </div>

          <div className="settings-row">
            <span>Restore session on unlock</span>
            <select
              className="settings-select"
              value={restoreSessionEnabled ? "1" : "0"}
              onChange={(e) => setRestoreSessionEnabled(e.target.value === "1")}
            >
              <option value="0">Off</option>
              <option value="1">On</option>
            </select>
          </div>

          <div className="settings-divider" />

          <button className="settings-action" onClick={() => { setOpen(false); setShowHistory(true); }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            View History
          </button>

          <button className="settings-action" onClick={() => { setOpen(false); setShowRecordings(true); }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="23 7 16 12 23 17 23 7" />
              <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
            </svg>
            Recordings
          </button>

          {copilotEnabled && (
            <button className="settings-action" onClick={() => { setOpen(false); setShowAi(true); }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 3l1.9 4.6 4.6 1.9-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9z" />
                <path d="M18 15l.8 2.2 2.2.8-2.2.8L18 21l-.8-2.2-2.2-.8 2.2-.8z" />
              </svg>
              AI Copilot
            </button>
          )}

          <button className="settings-action" onClick={() => { setOpen(false); setShowKeys(true); }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="6" width="20" height="12" rx="2" ry="2" />
              <line x1="6" y1="10" x2="6" y2="10" /><line x1="10" y1="10" x2="10" y2="10" />
              <line x1="14" y1="10" x2="14" y2="10" /><line x1="18" y1="10" x2="18" y2="10" />
              <line x1="8" y1="14" x2="16" y2="14" />
            </svg>
            Keyboard Shortcuts
          </button>

          <button className="settings-action" onClick={() => { setOpen(false); setShowSnippets(true); }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="16 18 22 12 16 6" />
              <polyline points="8 6 2 12 8 18" />
            </svg>
            Snippets
          </button>

          <button className="settings-action" onClick={handleExportSshConfig} disabled={exportingConfig}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            {exportingConfig ? "Exporting…" : "Export to ~/.ssh/config"}
          </button>

          <button className="settings-action" onClick={() => { setOpen(false); setShowSync(true); }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 12a9 9 0 0 0-9-9 9 9 0 0 0-6.74 3M3 12a9 9 0 0 0 9 9 9 9 0 0 0 6.74-3" />
              <polyline points="3 4 3 9 8 9" />
              <polyline points="21 20 21 15 16 15" />
            </svg>
            Cloud Sync
          </button>

          <button className="settings-action" onClick={() => { setOpen(false); setShowChangePw(true); }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="11" width="18" height="11" rx="2" />
              <path d="M7 11V7a5 5 0 0 1 9.9-1" />
            </svg>
            Change Master Password
          </button>

          <div className="settings-divider" />

          <button className="settings-action" onClick={() => { setOpen(false); setShowAbout(true); }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
            About
          </button>

          <button className="settings-action settings-action-danger" onClick={handleLock}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="5" y="11" width="14" height="10" rx="2" />
              <path d="M8 11V7a4 4 0 0 1 8 0v4" />
            </svg>
            Lock Vault
          </button>
        </div>
      )}

      {showHistory && <HistoryModal onClose={() => setShowHistory(false)} />}
      {showRecordings && <RecordingsModal onClose={() => setShowRecordings(false)} />}
      {showSync && <SyncModal onClose={() => setShowSync(false)} />}
      {showSnippets && <SnippetsModal onClose={() => setShowSnippets(false)} />}
      {showChangePw && <ChangePasswordModal onClose={() => setShowChangePw(false)} />}
      {showAi && <AiSettingsModal onClose={() => setShowAi(false)} />}
      {showKeys && <KeybindingsModal onClose={() => setShowKeys(false)} />}
      {showAbout && <AboutModal onClose={() => setShowAbout(false)} />}
    </div>
  );
}
