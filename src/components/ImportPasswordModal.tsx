import { useState } from "react";
import { useVaultStore } from "../store";

interface Props {
  /** Path to an encrypted .sshm profile awaiting its password. */
  path: string;
  onClose: () => void;
  onImported: (name: string) => void;
}

export function ImportPasswordModal({ path, onClose, onImported }: Props) {
  const { importHostEncrypted } = useVaultStore();
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleImport(e: React.FormEvent) {
    e.preventDefault();
    if (!password) {
      setError("Enter the password this profile was exported with.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const host = await importHostEncrypted(path, password);
      onImported(host.name);
      onClose();
    } catch (e: any) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  const fileName = path.split(/[/\\]/).pop() ?? path;

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ width: "min(480px, 94vw)" }}>
        <div className="modal-header">
          <h2>Encrypted Profile</h2>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>

        <form onSubmit={handleImport} className="host-form">
          <div className="form-row">
            <label>Password</label>
            <input
              type={showPassword ? "text" : "password"}
              className={showPassword ? "mono" : ""}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password from whoever shared this file"
              autoComplete="off"
              autoFocus
            />
            <p className="hint">
              <span className="mono">{fileName}</span> is encrypted. Enter the password it
              was exported with.
            </p>
          </div>

          {error && <p className="form-error">{error}</p>}

          <div className="modal-footer">
            <button
              type="button"
              className="btn"
              style={{ marginRight: "auto" }}
              onClick={() => setShowPassword((v) => !v)}
            >
              {showPassword ? "Hide" : "Show"}
            </button>
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? "Importing…" : "Import"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
