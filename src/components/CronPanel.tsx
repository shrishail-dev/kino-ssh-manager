import { useCallback, useEffect, useState } from "react";
import { CronJob, CronPreview, CronTable, useVaultStore } from "../store";

interface Props {
  sessionId: string;
  title: string;
  local: boolean;
  onClose: () => void;
}

/** A job being edited. `line` is null for one that doesn't exist yet. */
interface Draft {
  line: number | null;
  schedule: string;
  command: string;
  /** Written as a `#` line above the job. Only offered for new jobs - see below. */
  comment: string;
  enabled: boolean;
}

const PRESETS: { label: string; schedule: string }[] = [
  { label: "Every 5 min", schedule: "*/5 * * * *" },
  { label: "Hourly", schedule: "0 * * * *" },
  { label: "Daily 04:00", schedule: "0 4 * * *" },
  { label: "Weekdays 09:00", schedule: "0 9 * * 1-5" },
  { label: "Mondays 04:00", schedule: "0 4 * * 1" },
  { label: "Monthly 1st", schedule: "0 0 1 * *" },
  { label: "At boot", schedule: "@reboot" },
];

const FIELD_LABELS = ["minute", "hour", "day", "month", "weekday"];

/**
 * Render a host-clock timestamp.
 *
 * Cron fires on the host's wall clock, which is often not ours. Shifting the
 * epoch by the host's offset and reading the UTC parts back out gives the
 * host's local time without dragging in a date library.
 */
function hostTime(ts: number, offsetMin: number): string {
  const d = new Date((ts + offsetMin * 60) * 1000);
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)}`;
}

function relative(ts: number, now: number): string {
  const secs = ts - now;
  if (secs <= 0) return "due";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `in ${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `in ${hours}h ${mins % 60}m`;
  const days = Math.floor(hours / 24);
  return days < 14 ? `in ${days}d ${hours % 24}h` : `in ${days}d`;
}

function offsetLabel(offsetMin: number): string {
  const sign = offsetMin < 0 ? "-" : "+";
  const abs = Math.abs(offsetMin);
  return `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

/** The crontab line a draft becomes. Disabling comments it out, as people do by hand. */
function toLine(draft: Draft): string {
  const body = `${draft.schedule.trim()} ${draft.command.trim()}`;
  return draft.enabled ? body : `#${body}`;
}

/**
 * The crontab editor.
 *
 * The panel never regenerates a crontab. It holds the file as the line array
 * `cron_list` returned and rewrites only the lines it is asked to change, so
 * comments, `PATH=`, blank lines and anything the parser didn't recognise
 * survive every save untouched. The Raw tab is the escape hatch for editing
 * those directly.
 */
export function CronPanel({ sessionId, title, local, onClose }: Props) {
  const { cronList, cronSave, cronPreview } = useVaultStore();
  const [table, setTable] = useState<CronTable | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [preview, setPreview] = useState<CronPreview | null>(null);
  const [confirmLine, setConfirmLine] = useState<number | null>(null);
  const [view, setView] = useState<"jobs" | "raw">("jobs");
  const [rawText, setRawText] = useState("");
  /** The host's clock, advanced locally so "in 3h" doesn't freeze on load. */
  const [now, setNow] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const t = await cronList(sessionId, local);
      setTable(t);
      setRawText(t.lines.join("\n"));
      setNow(t.host_now);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [cronList, sessionId, local]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const id = window.setInterval(() => setNow((n) => n + 30), 30_000);
    return () => clearInterval(id);
  }, []);

  // Debounced so a schedule typed a character at a time doesn't queue a call
  // per keystroke; the preview is pure and local, but it still crosses IPC.
  useEffect(() => {
    if (!draft || !table) {
      setPreview(null);
      return;
    }
    const id = window.setTimeout(() => {
      cronPreview(draft.schedule, table.host_now, table.host_offset_min)
        .then(setPreview)
        .catch(() => setPreview(null));
    }, 120);
    return () => clearTimeout(id);
  }, [draft, table, cronPreview]);

  async function commit(lines: string[]) {
    if (!table) return;
    setSaving(true);
    try {
      const next = await cronSave(sessionId, local, lines, table.token);
      setTable(next);
      setRawText(next.lines.join("\n"));
      setNow(next.host_now);
      setDraft(null);
      setConfirmLine(null);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  function applyDraft() {
    if (!table || !draft) return;
    const lines = [...table.lines];
    if (draft.line === null) {
      const comment = draft.comment.trim();
      if (comment) lines.push(`# ${comment}`);
      lines.push(toLine(draft));
    } else {
      lines[draft.line] = toLine(draft);
    }
    void commit(lines);
  }

  function toggleEnabled(job: CronJob) {
    if (!table) return;
    const lines = [...table.lines];
    lines[job.line] = toLine({
      line: job.line,
      schedule: job.schedule,
      command: job.command,
      comment: "",
      enabled: !job.enabled,
    });
    void commit(lines);
  }

  function remove(job: CronJob) {
    if (!table) return;
    // Only the job's own line goes. A comment above it might belong to more
    // than this job, and dropping somebody's note is not this button's job.
    void commit(table.lines.filter((_, i) => i !== job.line));
  }

  const offset = table?.host_offset_min ?? 0;
  const editingExisting = draft?.line !== null && draft !== null;
  const scheduleParts = draft && !draft.schedule.trim().startsWith("@")
    ? draft.schedule.trim().split(/\s+/)
    : null;
  const fieldMode = scheduleParts !== null && scheduleParts.length === 5;

  function setField(index: number, value: string) {
    if (!draft || !scheduleParts) return;
    const parts = [...scheduleParts];
    parts[index] = value.trim() === "" ? "*" : value.trim();
    setDraft({ ...draft, schedule: parts.join(" ") });
  }

  return (
    <div className="modal-overlay" onClick={() => { if (!draft) onClose(); }}>
      <div className="modal cron-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Cron - {title}</h2>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>

        <div className="cron-toolbar">
          <div className="cron-tabs">
            <button
              className={`cron-tab ${view === "jobs" ? "active" : ""}`}
              onClick={() => setView("jobs")}
            >
              Jobs
            </button>
            <button
              className={`cron-tab ${view === "raw" ? "active" : ""}`}
              onClick={() => { setView("raw"); setDraft(null); }}
            >
              Raw
            </button>
          </div>

          {table && (
            <span className="cron-clock" title="Cron fires on the host's clock, not yours">
              host {hostTime(now, offset)} {offsetLabel(offset)}
            </span>
          )}

          <div className="cron-toolbar-actions">
            {view === "jobs" && (
              <button
                className="btn btn-sm"
                disabled={!table || saving}
                onClick={() =>
                  setDraft({
                    line: null,
                    schedule: "0 4 * * *",
                    command: "",
                    comment: "",
                    enabled: true,
                  })
                }
              >
                New job
              </button>
            )}
            <button className="btn btn-sm" onClick={() => void load()} disabled={loading || saving}>
              Refresh
            </button>
          </div>
        </div>

        {error && <p className="form-error">{error}</p>}

        {loading && !table ? (
          <div className="docker-empty">Reading crontab…</div>
        ) : view === "raw" ? (
          <div className="cron-raw">
            <p className="cron-hint">
              The whole crontab, exactly as it is on the host. Editing here is the way to change
              comments and <code>PATH=</code> / <code>MAILTO=</code> lines.
            </p>
            <textarea
              className="cron-raw-text"
              spellCheck={false}
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
            />
            <div className="cron-raw-actions">
              <button
                className="btn btn-primary btn-sm"
                disabled={saving || rawText === (table?.lines.join("\n") ?? "")}
                onClick={() => void commit(rawText.split("\n"))}
              >
                {saving ? "Saving…" : "Save crontab"}
              </button>
              <button
                className="btn btn-sm"
                disabled={saving}
                onClick={() => setRawText(table?.lines.join("\n") ?? "")}
              >
                Revert
              </button>
            </div>
          </div>
        ) : (
          <div className="cron-body">
            {table && table.env.length > 0 && (
              <div className="cron-env">
                {table.env.map((line) => (
                  <code key={line} className="cron-env-line">{line}</code>
                ))}
              </div>
            )}

            {table && table.jobs.length === 0 && !draft && (
              <div className="docker-empty">
                {table.empty
                  ? "No crontab for this user yet. Adding a job creates one."
                  : "No scheduled jobs in this crontab."}
              </div>
            )}

            <div className="cron-list">
              {table?.jobs.map((job) => (
                <div
                  key={`${job.line}-${job.schedule}`}
                  className={`cron-job ${job.enabled ? "" : "disabled"}`}
                >
                  <div className="cron-job-main">
                    {job.comment && <p className="cron-job-comment">{job.comment}</p>}
                    <div className="cron-job-when">
                      <code className="cron-job-spec">{job.schedule}</code>
                      <span className="cron-job-desc">{job.description}</span>
                      {!job.enabled && <span className="cron-job-badge">paused</span>}
                    </div>
                    <code className="cron-job-cmd" title={job.command}>{job.command}</code>
                    <p className="cron-job-next">
                      {!job.enabled
                        ? "Paused - will not run"
                        : job.next_runs.length === 0
                          ? job.schedule === "@reboot"
                            ? "Runs when the host boots"
                            : "Never - this schedule can't occur"
                          : `Next ${hostTime(job.next_runs[0], offset)} (${relative(job.next_runs[0], now)})`}
                    </p>
                  </div>

                  <div className="cron-job-actions">
                    <button
                      className="btn btn-sm"
                      disabled={saving}
                      onClick={() =>
                        setDraft({
                          line: job.line,
                          schedule: job.schedule,
                          command: job.command,
                          comment: job.comment ?? "",
                          enabled: job.enabled,
                        })
                      }
                    >
                      Edit
                    </button>
                    <button
                      className="btn btn-sm"
                      disabled={saving}
                      onClick={() => toggleEnabled(job)}
                      title={job.enabled ? "Comment the job out" : "Uncomment the job"}
                    >
                      {job.enabled ? "Pause" : "Resume"}
                    </button>
                    {confirmLine === job.line ? (
                      <>
                        <button
                          className="btn btn-sm delete-btn confirm"
                          disabled={saving}
                          onClick={() => remove(job)}
                        >
                          Delete
                        </button>
                        <button className="btn btn-sm" onClick={() => setConfirmLine(null)}>✕</button>
                      </>
                    ) : (
                      <button
                        className="btn btn-sm"
                        disabled={saving}
                        onClick={() => setConfirmLine(job.line)}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {draft && (
          <div className="cron-editor">
            <p className="cron-editor-title">{editingExisting ? "Edit job" : "New job"}</p>

            <div className="cron-presets">
              {PRESETS.map((p) => (
                <button
                  key={p.schedule}
                  className={`cron-preset ${draft.schedule.trim() === p.schedule ? "active" : ""}`}
                  onClick={() => setDraft({ ...draft, schedule: p.schedule })}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {fieldMode ? (
              <div className="cron-fields">
                {scheduleParts.map((part, i) => (
                  <label key={FIELD_LABELS[i]} className="cron-field">
                    <span>{FIELD_LABELS[i]}</span>
                    <input
                      value={part}
                      spellCheck={false}
                      onChange={(e) => setField(i, e.target.value)}
                    />
                  </label>
                ))}
              </div>
            ) : (
              <label className="cron-field cron-field-wide">
                <span>schedule</span>
                <input
                  value={draft.schedule}
                  spellCheck={false}
                  onChange={(e) => setDraft({ ...draft, schedule: e.target.value })}
                />
              </label>
            )}

            <label className="cron-field cron-field-wide">
              <span>command</span>
              <input
                value={draft.command}
                spellCheck={false}
                placeholder="/usr/local/bin/backup.sh --full"
                onChange={(e) => setDraft({ ...draft, command: e.target.value })}
              />
            </label>

            {!editingExisting && (
              <label className="cron-field cron-field-wide">
                <span>note</span>
                <input
                  value={draft.comment}
                  placeholder="Optional - written as a comment above the job"
                  onChange={(e) => setDraft({ ...draft, comment: e.target.value })}
                />
              </label>
            )}

            <div className={`cron-preview ${preview && !preview.valid ? "invalid" : ""}`}>
              <p className="cron-preview-desc">{preview?.description ?? "…"}</p>
              {preview?.next_runs.length ? (
                <p className="cron-preview-runs">
                  {preview.next_runs.map((t) => hostTime(t, offset)).join("  ·  ")}
                </p>
              ) : preview?.valid && draft.schedule.trim() === "@reboot" ? (
                <p className="cron-preview-runs">Only at boot</p>
              ) : preview?.valid ? (
                <p className="cron-preview-runs">This schedule never occurs</p>
              ) : null}
            </div>

            <div className="cron-editor-actions">
              <button
                className="btn btn-primary btn-sm"
                disabled={saving || !preview?.valid || !draft.command.trim()}
                onClick={applyDraft}
              >
                {saving ? "Saving…" : editingExisting ? "Apply" : "Add job"}
              </button>
              <button className="btn btn-sm" disabled={saving} onClick={() => setDraft(null)}>
                Cancel
              </button>
              <label className="cron-enabled">
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
                />
                Enabled
              </label>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
