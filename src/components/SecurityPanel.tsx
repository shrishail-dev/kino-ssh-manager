import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { AuditReport, HostAudit, RotateOutcome, useVaultStore } from "../store";

interface Props {
  onClose: () => void;
}

const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 } as const;

function worst(host: HostAudit): keyof typeof SEVERITY_ORDER | null {
  return host.findings.length === 0
    ? null
    : (host.findings[0].severity as keyof typeof SEVERITY_ORDER);
}

function keyAge(added: number | null, now: number): string {
  if (added === null) return "age unknown";
  const days = Math.floor((now - added) / 86_400);
  if (days < 1) return "added today";
  if (days < 60) return `${days} days old`;
  const months = Math.floor(days / 30);
  return months < 24 ? `${months} months old` : `${Math.floor(days / 365)} years old`;
}

/** `SHA256:abc…xyz` - enough to compare two by eye without filling the row. */
function shortFingerprint(fp: string): string {
  const body = fp.replace(/^SHA256:/, "");
  return body.length > 20 ? `SHA256:${body.slice(0, 10)}…${body.slice(-6)}` : fp;
}

/**
 * The key audit, and the rotation that acts on it.
 *
 * The audit itself never leaves this machine: it reads the keys already in the
 * vault and says what they are. Rotation is the only thing here that touches a
 * host, and it is deliberately one host at a time with a confirmation - there is
 * no "fix everything" button, because a rotation that goes wrong on ten hosts at
 * once is a very bad afternoon.
 */
export function SecurityPanel({ onClose }: Props) {
  const { auditKeys, rotateKey } = useVaultStore();
  const [report, setReport] = useState<AuditReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [rotatingId, setRotatingId] = useState<string | null>(null);
  const [progress, setProgress] = useState<string>("");
  const [outcome, setOutcome] = useState<{ id: string; result: RotateOutcome } | null>(null);
  const [showClean, setShowClean] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setReport(await auditKeys());
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [auditKeys]);

  useEffect(() => { void load(); }, [load]);

  // The backend narrates rotation step by step; without it the button would sit
  // there for the length of two SSH handshakes with nothing to show for itself.
  useEffect(() => {
    if (!rotatingId) return;
    let stop: (() => void) | undefined;
    let cancelled = false;
    listen<string>(`rotate-${rotatingId}`, (e) => setProgress(e.payload)).then((un) => {
      if (cancelled) un();
      else stop = un;
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [rotatingId]);

  async function rotate(host: HostAudit) {
    setConfirmId(null);
    setRotatingId(host.host_id);
    setProgress("Starting…");
    setOutcome(null);
    try {
      const result = await rotateKey(host.host_id);
      setOutcome({ id: host.host_id, result });
      setError(null);
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setRotatingId(null);
      setProgress("");
    }
  }

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const now = report?.generated_at ?? 0;
  const flagged = report?.hosts.filter((h) => h.findings.length > 0) ?? [];
  const clean = report?.hosts.filter((h) => h.findings.length === 0) ?? [];
  const sorted = [...flagged].sort(
    (a, b) => SEVERITY_ORDER[worst(a)!] - SEVERITY_ORDER[worst(b)!]
  );

  function renderHost(host: HostAudit, isClean: boolean) {
    const open = expanded.has(host.host_id);
    const busy = rotatingId === host.host_id;
    const severity = worst(host);
    return (
      <div
        key={host.host_id}
        className={`audit-host ${severity ? `sev-${severity}` : "sev-none"} ${busy ? "busy" : ""}`}
      >
        <div className="audit-host-head">
          <button
            className="audit-host-toggle"
            onClick={() => toggle(host.host_id)}
            aria-expanded={open}
          >
            <span className="audit-host-name">{host.host_name}</span>
            <span className="audit-host-key">
              {host.key
                ? `${host.key.algorithm}${host.key.bits ? ` ${host.key.bits}` : ""} · ${keyAge(host.key_added_at, now)}`
                : host.auth === "Agent"
                  ? "ssh-agent"
                  : "no key stored"}
            </span>
            {!isClean && (
              <span className="audit-count">
                {host.findings.length} {host.findings.length === 1 ? "note" : "notes"}
              </span>
            )}
          </button>

          {busy ? (
            <span className="audit-progress">{progress}</span>
          ) : confirmId === host.host_id ? (
            <span className="audit-confirm">
              <span className="audit-confirm-text">
                Generate a new key, install it, verify it, then remove the old one?
              </span>
              <button className="btn btn-sm btn-primary" onClick={() => void rotate(host)}>
                Rotate
              </button>
              <button className="btn btn-sm" onClick={() => setConfirmId(null)}>✕</button>
            </span>
          ) : (
            <button
              className="btn btn-sm"
              disabled={!!rotatingId || host.auth === "Agent"}
              title={
                host.auth === "Agent"
                  ? "This host authenticates through your ssh-agent; Kino holds no key to rotate"
                  : "Replace this host's key with a fresh ed25519 one"
              }
              onClick={() => setConfirmId(host.host_id)}
            >
              Rotate key
            </button>
          )}
        </div>

        {outcome?.id === host.host_id && (
          <p className={`audit-outcome ${outcome.result.old_key_removed ? "" : "partial"}`}>
            New key installed - {shortFingerprint(outcome.result.fingerprint)}.{" "}
            {outcome.result.old_key_removed
              ? "The old key was removed from the host."
              : outcome.result.note}
          </p>
        )}

        {open && (
          <div className="audit-detail">
            {host.key && (
              <p className="audit-fingerprint">
                {host.key.fingerprint}
                {host.key.encrypted && <span className="audit-tag">passphrase</span>}
              </p>
            )}
            {host.findings.map((f) => (
              <div key={f.id} className={`audit-finding sev-${f.severity}`}>
                <p className="audit-finding-title">
                  <span className="audit-sev">{f.severity}</span>
                  {f.title}
                </p>
                <p className="audit-finding-detail">{f.detail}</p>
              </div>
            ))}
            {host.findings.length === 0 && (
              <p className="audit-finding-detail">Nothing to report on this key.</p>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={() => { if (!rotatingId) onClose(); }}>
      <div className="modal audit-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Key audit</h2>
          <button className="icon-btn" onClick={onClose} disabled={!!rotatingId}>✕</button>
        </div>

        <div className="audit-toolbar">
          {report && (
            <div className="audit-summary">
              <span className="audit-chip sev-high">{report.high} high</span>
              <span className="audit-chip sev-medium">{report.medium} medium</span>
              <span className="audit-chip sev-low">{report.low} low</span>
              <span className="audit-scope">
                {report.hosts.length} host{report.hosts.length === 1 ? "" : "s"} · read locally,
                nothing was contacted
              </span>
            </div>
          )}
          <button
            className="btn btn-sm"
            onClick={() => void load()}
            disabled={loading || !!rotatingId}
          >
            Re-run
          </button>
        </div>

        {error && <p className="form-error">{error}</p>}

        <div className="audit-body">
          {loading && !report ? (
            <div className="docker-empty">Reading keys…</div>
          ) : report?.hosts.length === 0 ? (
            <div className="docker-empty">No hosts in the vault yet.</div>
          ) : (
            <>
              {sorted.length === 0 ? (
                <div className="docker-empty">
                  Every key checks out - modern algorithm, not shared, not stale.
                </div>
              ) : (
                sorted.map((h) => renderHost(h, false))
              )}

              {clean.length > 0 && (
                <div className="audit-clean">
                  <button className="audit-clean-toggle" onClick={() => setShowClean((v) => !v)}>
                    {showClean ? "Hide" : "Show"} {clean.length} host
                    {clean.length === 1 ? "" : "s"} with nothing to report
                  </button>
                  {showClean && clean.map((h) => renderHost(h, true))}
                </div>
              )}
            </>
          )}
        </div>

        <p className="audit-footnote">
          Rotation generates an ed25519 key, installs it, opens a second connection that can only
          authenticate with the new key, and only then removes the old one. If any step before that
          fails, the host is left exactly as it was.
        </p>
      </div>
    </div>
  );
}
