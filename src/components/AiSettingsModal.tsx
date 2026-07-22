import { useEffect, useState } from "react";
import { AiModelInfo, useVaultStore } from "../store";

interface Props {
  onClose: () => void;
}

// OpenRouter accepts low | medium | high for reasoning effort; models that
// don't reason simply ignore it.
const EFFORTS = ["low", "medium", "high"];

export function AiSettingsModal({ onClose }: Props) {
  const { aiGetConfig, aiSetConfig, aiListModels } = useVaultStore();

  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState("medium");
  const [hasKey, setHasKey] = useState(false);

  const [models, setModels] = useState<AiModelInfo[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    aiGetConfig()
      .then((c) => {
        if (!c) return;
        setModel(c.model);
        setEffort(c.effort);
        setHasKey(c.has_api_key);
      })
      .catch(() => {});
  }, [aiGetConfig]);

  async function refreshModels() {
    setLoadingModels(true);
    setError("");
    try {
      // Persist first so the backend queries with the credential just entered.
      await aiSetConfig({ provider: "openrouter", api_key: apiKey, model, effort });
      setApiKey("");
      setHasKey(true);
      setModels(await aiListModels());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoadingModels(false);
    }
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      const view = await aiSetConfig({ provider: "openrouter", api_key: apiKey, model, effort });
      setApiKey("");
      setHasKey(view.has_api_key);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal ai-settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>AI Copilot</h2>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>

        <div className="ai-settings-body">
          <div className="form-row">
            <label>Provider</label>
            <div className="auth-tabs">
              <button type="button" className="active">OpenRouter</button>
            </div>
            <p className="hint">
              kino talks to models through <a href="https://openrouter.ai" target="_blank" rel="noreferrer">OpenRouter</a> -
              one key reaches every major model.
            </p>
          </div>

          <div className="form-section">
            <div className="form-section-title">
              <span>OpenRouter API key</span>
              {hasKey && <span className="default-badge">stored</span>}
            </div>
            <div className="form-row">
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={hasKey ? "•••••••• (leave blank to keep)" : "sk-or-…"}
                autoComplete="off"
                className="mono"
              />
              <p className="hint">
                Create one at openrouter.ai/keys. Encrypted in your vault with the same key as
                everything else - it never leaves this machine except to call OpenRouter.
              </p>
            </div>
          </div>

          <div className="form-section">
            <div className="form-section-title">
              <span>Model</span>
              <button className="btn btn-sm" style={{ marginLeft: "auto" }} onClick={refreshModels} disabled={loadingModels}>
                {loadingModels ? "Loading…" : "Refresh list"}
              </button>
            </div>
            <div className="form-row">
              {models.length > 0 ? (
                <select className="settings-select" value={model} onChange={(e) => setModel(e.target.value)}>
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </select>
              ) : (
                <input value={model} onChange={(e) => setModel(e.target.value)} className="mono" placeholder="e.g. openrouter/auto" />
              )}
              <p className="hint">
                “Refresh list” asks OpenRouter for the available models (it saves first, so enter the
                key above beforehand). Model IDs look like <code>anthropic/claude-opus-4-8</code> or
                <code> openai/gpt-4o</code>.
              </p>
            </div>
          </div>

          <div className="form-row">
            <label>Effort <span className="hint-inline">(reasoning depth vs. speed and cost)</span></label>
            <select className="settings-select" value={effort} onChange={(e) => setEffort(e.target.value)}>
              {EFFORTS.map((e) => (
                <option key={e} value={e}>{e}</option>
              ))}
            </select>
            <p className="hint">Applies to models that support reasoning; others ignore it.</p>
          </div>
        </div>

        {error && <p className="form-error">{error}</p>}

        <div className="modal-footer">
          <button className="btn" onClick={onClose} style={{ marginRight: "auto" }}>Close</button>
          {saved && <span className="hint" style={{ color: "var(--green)" }}>Saved</span>}
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
