import { useVaultStore } from "../store";
import { hostTarget } from "../utils";
import { OsIcon } from "./OsIcon";

interface Props {
  /** The pane this landing view belongs to; connecting targets it. */
  paneId: string;
}

/**
 * The empty-pane landing view. Shows the hosts the user pinned to home as
 * one-click connect cards. Clicking a card routes through the sidebar's verified
 * connect flow (host-key check, auth prompt) via the shared window event; the
 * pane is made active first so the new session lands here.
 */
export function HomePanel({ paneId }: Props) {
  const { hosts, favoriteHostIds, setActivePane } = useVaultStore();

  const favorites = favoriteHostIds
    .map((id) => hosts.find((h) => h.id === id))
    .filter((h): h is NonNullable<typeof h> => !!h);

  function connect(id: string) {
    setActivePane(paneId);
    window.dispatchEvent(new CustomEvent("kino:connect-host", { detail: id }));
  }

  if (favorites.length === 0) {
    return (
      <div className="home-panel empty">
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
        <p className="home-title">No pinned hosts yet</p>
        <p className="hint">
          Star a host in the sidebar (or right-click - Pin to Home) to keep it here for one-click access.
        </p>
      </div>
    );
  }

  return (
    <div className="home-panel">
      <p className="home-title">Favorites</p>
      <div className="home-grid">
        {favorites.map((host) => (
          <button key={host.id} className="home-card" onClick={() => connect(host.id)} title={`Connect to ${host.name}`}>
            <span
              className="home-card-icon"
              style={host.color ? { background: `color-mix(in srgb, ${host.color} 22%, transparent)`, color: host.color } : undefined}
            >
              <OsIcon os={host.os} />
            </span>
            <span className="home-card-body">
              <span className="home-card-name">{host.name}</span>
              <span className="home-card-meta">{host.username}@{hostTarget(host)}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
