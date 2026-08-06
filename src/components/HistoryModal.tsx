import { useEffect, useState } from "react";
import { HistoryEvent, useVaultStore } from "../store";

interface Props {
  onClose: () => void;
}

const ITEMS_PER_PAGE = 10;

export function HistoryModal({ onClose }: Props) {
  const { getHistory } = useVaultStore();
  const [history, setHistory] = useState<HistoryEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [query, setQuery] = useState("");

  useEffect(() => {
    getHistory()
      .then((data) => {
        setHistory(data.sort((a, b) => b.timestamp - a.timestamp));
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setLoading(false);
      });
  }, [getHistory]);

  // History only ever grows, so it needs a way in. Matches the message and the
  // event type, so "vault" or "deleted" both narrow usefully.
  const q = query.trim().toLowerCase();
  const filtered = q
    ? history.filter(
        (e) =>
          e.message.toLowerCase().includes(q) ||
          e.event_type.toLowerCase().replace(/_/g, " ").includes(q)
      )
    : history;

  const totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE);
  // Filtering can leave the current page past the end of the new result set.
  const page = Math.min(currentPage, Math.max(1, totalPages));
  const currentHistory = filtered.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ width: 600, maxHeight: "80vh", display: "flex", flexDirection: "column" }}>
        <div className="modal-header">
          <h2>Vault History</h2>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        
        <div style={{ padding: "12px 20px 0" }}>
          <input
            autoFocus
            value={query}
            placeholder="Filter history…"
            onChange={(e) => { setQuery(e.target.value); setCurrentPage(1); }}
          />
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "0 20px", marginTop: 10 }}>
          {loading ? (
            <p style={{ textAlign: "center", color: "var(--subtle)" }}>Loading history...</p>
          ) : history.length === 0 ? (
            <p style={{ textAlign: "center", color: "var(--subtle)" }}>No history available yet.</p>
          ) : filtered.length === 0 ? (
            <p style={{ textAlign: "center", color: "var(--subtle)" }}>
              Nothing matches “{query}”.
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12, paddingBottom: 20 }}>
              {currentHistory.map((event) => (
                <div key={event.id} style={{ display: "flex", justifyContent: "space-between", padding: "12px 16px", background: "var(--surface)", borderRadius: 8, border: "1px solid var(--muted)" }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      {event.event_type === "connection" && (
                        <span className="history-tag" style={{ color: `var(--blue)`, borderColor: `color-mix(in srgb, var(--blue) 40%, transparent)` }}>Connection</span>
                      )}
                      {(event.event_type === "host_added" || event.event_type === "host_edited" || event.event_type === "host_deleted") && (
                        <span className="history-tag" style={{ color: `var(--green)`, borderColor: `color-mix(in srgb, var(--green) 40%, transparent)` }}>Vault Update</span>
                      )}
                      {event.event_type.startsWith("vault_") && (
                        <span className="history-tag" style={{ color: `var(--text)`, borderColor: `color-mix(in srgb, var(--text) 40%, transparent)` }}>System</span>
                      )}
                      {event.event_type.startsWith("key_") && (
                        <span className="history-tag" style={{ color: `var(--yellow)`, borderColor: `color-mix(in srgb, var(--yellow) 40%, transparent)` }}>Key Action</span>
                      )}
                      {(event.event_type === "host_imported" || event.event_type === "host_exported") && (
                        <span className="history-tag" style={{ color: `var(--mauve)`, borderColor: `color-mix(in srgb, var(--mauve) 40%, transparent)` }}>File I/O</span>
                      )}
                    </div>
                    <p style={{ fontSize: 14, color: "var(--text)", margin: 0 }}>{event.message}</p>
                  </div>
                  <div style={{ textAlign: "right", color: "var(--subtle)", fontSize: 12 }}>
                    <div>{new Date(event.timestamp).toLocaleDateString()}</div>
                    <div>{new Date(event.timestamp).toLocaleTimeString()}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="modal-footer" style={{ padding: "16px 20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button 
              className="btn" 
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={page === 1 || totalPages === 0}
            >
              Previous
            </button>
            <span style={{ fontSize: 14, color: "var(--subtle)" }}>
              Page {totalPages === 0 ? 0 : page} of {totalPages}
            </span>
            <button 
              className="btn" 
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages || totalPages === 0}
            >
              Next
            </button>
          </div>
          <button className="btn btn-primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
