import { useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { Host, useVaultStore } from "../store";
import { generatePassword, slug } from "../utils";

interface Props {
  host: Host;
  onClose: () => void;
  onExported: (message: string) => void;
}

export function ExportProfileModal({ host, onClose, onExported }: Props) {
  const { exportHost, exportHostEncrypted } = useVaultStore();

  const [encrypt, setEncrypt] = useState(true);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const hasSecrets = Boolean(host.password || host.private_key);

  function handleGenerate() {
    setPassword(generatePassword());
    setShowPassword(true);
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(password);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleExport() {
    if (encrypt && !password) {
      setError("Enter or generate a password, or switch to Unencrypted.");
      return;
    }
    const path = await save({
      title: "Export Host Profile",
      defaultPath: `${slug(host.name)}.sshm`,
      filters: [{ name: "Kino SSH Manager Profile", extensions: ["sshm"] }],
    });
    if (!path) return;

    setBusy(true);
    setError("");
    try {
      if (encrypt) {
        await exportHostEncrypted(host, path as string, password);
        onExported("Encrypted profile exported");
      } else {
        await exportHost(host, path as string);
        onExported("Profile exported");
      }
      onClose();
    } catch (e: any) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ width: "min(540px, 94vw)" }}>
        <div className="modal-header">
          <h2>Export “{host.name}”</h2>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>

        <div className="host-form">
          <div className="form-row">
            <label>Protection</label>
            <div className="auth-tabs">
              <button
                type="button"
                className={encrypt ? "active" : ""}
                onClick={() => setEncrypt(true)}
              >
                Password-encrypted
              </button>
              <button
                type="button"
                className={!encrypt ? "active" : ""}
                onClick={() => setEncrypt(false)}
              >
                Unencrypted
              </button>
            </div>
            {hasSecrets && (
              <p className="hint">
                This profile contains the host&rsquo;s saved{" "}
                {host.password && host.private_key
                  ? "password and private key"
                  : host.private_key
                    ? "private key"
                    : "password"}
                .
              </p>
            )}
          </div>

          {encrypt ? (
            <div className="form-section">
              <div className="form-section-title">
                <span>Export password</span>
                <button
                  type="button"
                  className="btn btn-sm"
                  style={{ marginLeft: "auto" }}
                  onClick={() => setShowPassword((v) => !v)}
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
                <button type="button" className="btn btn-sm" onClick={handleGenerate}>
                  Generate
                </button>
              </div>
              <div className="form-row">
                <input
                  type={showPassword ? "text" : "password"}
                  className={showPassword ? "mono" : ""}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password to protect this file"
                  autoComplete="new-password"
                />
              </div>
              {password && (
                <button
                  type="button"
                  className="btn btn-sm"
                  style={{ alignSelf: "flex-start" }}
                  onClick={handleCopy}
                >
                  {copied ? "Copied!" : "Copy password"}
                </button>
              )}
              <p className="hint">
                Share this password with the recipient over a separate channel - they
                need it to import the file. It is not stored anywhere and cannot be
                recovered if lost.
              </p>
            </div>
          ) : (
            <div
              style={{
                background: "var(--overlay)",
                border: "1px solid var(--yellow)",
                borderRadius: "var(--radius)",
                padding: "10px 12px",
                fontSize: "13px",
                color: "var(--subtext)",
              }}
            >
              <strong style={{ color: "var(--yellow)" }}>Saved in plain text.</strong>{" "}
              {hasSecrets
                ? "Anyone who opens the file can read this host's password and private key."
                : "Anyone who opens the file can read this host's settings."}
            </div>
          )}

          {error && <p className="form-error">{error}</p>}

          <div className="modal-footer">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleExport}
              disabled={busy}
            >
              {busy ? "Exporting…" : "Choose file & export"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
