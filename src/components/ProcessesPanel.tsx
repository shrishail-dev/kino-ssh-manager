import { useCallback, useEffect, useState } from "react";
import { KillSignal, ProcessInfo, useVaultStore } from "../store";

interface Props {
  sessionId: string;
  title: string;
  local: boolean;
  onClose: () => void;
}

function fmtRss(kb: number): string {
  let v = kb;
  const units = ["KB", "MB", "GB"];
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

type SortKey = "cpu" | "mem" | "pid" | "command";

export function ProcessesPanel({ sessionId, title, local, onClose }: Props) {
  const { processesList, processKill } = useVaultStore();
  const [procs, setProcs] = useState<ProcessInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("cpu");
  const [busyPid, setBusyPid] = useState<number | null>(null);
  const [confirmPid, setConfirmPid] = useState<number | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const load = useCallback(async () => {
    try {
      const list = await processesList(sessionId, local);
      setProcs(list);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [processesList, sessionId, local]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = window.setInterval(() => { void load(); }, 4000);
    return () => clearInterval(id);
  }, [autoRefresh, load]);

  async function signal(pid: number, sig: KillSignal) {
    setBusyPid(pid);
    try {
      await processKill(sessionId, local, pid, sig);
      setConfirmPid(null);
      // Give the process a moment to actually go away before refreshing.
      window.setTimeout(() => void load(), 400);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusyPid(null);
    }
  }

  const q = filter.trim().toLowerCase();
  const visible = procs
    .filter((p) =>
      !q ||
      p.command.toLowerCase().includes(q) ||
      p.user.toLowerCase().includes(q) ||
      String(p.pid).includes(q)
    )
    .sort((a, b) => {
      switch (sortKey) {
        case "pid": return a.pid - b.pid;
        case "mem": return b.mem - a.mem;
        case "command": return a.command.localeCompare(b.command);
        default: return b.cpu - a.cpu;
      }
    });

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal proc-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Processes - {title}</h2>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>

        <div className="proc-toolbar">
          <input
            className="proc-filter"
            placeholder="Filter by command, user or pid…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <select
            className="settings-select"
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            title="Sort by"
          >
            <option value="cpu">Sort: CPU</option>
            <option value="mem">Sort: Memory</option>
            <option value="pid">Sort: PID</option>
            <option value="command">Sort: Command</option>
          </select>
          <label className="proc-auto" title="Refresh every 4s">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            Auto
          </label>
          <button className="btn btn-sm" onClick={() => void load()} disabled={loading}>
            Refresh
          </button>
        </div>

        {error && <p className="form-error">{error}</p>}

        <div className="proc-list">
          {loading && procs.length === 0 ? (
            <div className="docker-empty">Loading processes…</div>
          ) : visible.length === 0 ? (
            <div className="docker-empty">
              {procs.length === 0 ? "No processes returned." : `No matches for “${filter}”.`}
            </div>
          ) : (
            <table className="proc-table">
              <thead>
                <tr>
                  <th>PID</th>
                  <th>User</th>
                  <th className="num">CPU%</th>
                  <th className="num">MEM%</th>
                  <th className="num">RSS</th>
                  <th>S</th>
                  <th>Command</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visible.map((p) => (
                  <tr key={p.pid} className={busyPid === p.pid ? "busy" : undefined}>
                    <td className="mono">{p.pid}</td>
                    <td>{p.user}</td>
                    <td className={`num mono ${p.cpu >= 50 ? "hot" : ""}`}>{p.cpu.toFixed(1)}</td>
                    <td className={`num mono ${p.mem >= 25 ? "hot" : ""}`}>{p.mem.toFixed(1)}</td>
                    <td className="num mono">{fmtRss(p.rss_kb)}</td>
                    <td className="mono" title={p.state}>{p.state}</td>
                    <td className="proc-cmd mono" title={p.command}>{p.command}</td>
                    <td className="proc-actions">
                      {confirmPid === p.pid ? (
                        <>
                          <button
                            className="btn btn-sm"
                            disabled={busyPid === p.pid}
                            onClick={() => signal(p.pid, "TERM")}
                            title="Ask the process to exit (SIGTERM)"
                          >
                            Term
                          </button>
                          <button
                            className="btn btn-sm delete-btn confirm"
                            disabled={busyPid === p.pid}
                            onClick={() => signal(p.pid, "KILL")}
                            title="Force kill (SIGKILL)"
                          >
                            Kill
                          </button>
                          <button className="btn btn-sm" onClick={() => setConfirmPid(null)}>
                            ✕
                          </button>
                        </>
                      ) : (
                        <button
                          className="btn btn-sm"
                          onClick={() => setConfirmPid(p.pid)}
                          title="Signal this process"
                        >
                          End
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
