import { Host, PortForward } from "../store";

interface Props {
  forward: PortForward;
  host: Host;
  active: boolean;
}

/** One station on the wire. */
interface Station {
  /** Where this end lives - the thing people actually get wrong. */
  place: string;
  /** The address you'd type, or the port that gets opened. */
  addr: string;
}

/**
 * Resolve a forward into three stations, left to right in the direction traffic
 * is *initiated*.
 *
 * This is the whole point of the diagram. The old text rendering was
 * `localhost:5432 - db.internal:5432`, and that dash silently meant opposite
 * things for -L and -R: for a local forward the listener is on your machine,
 * for a remote one it is on the server. Getting that backwards is the classic
 * port-forwarding mistake, so the diagram states which end opens the port,
 * which machine resolves the destination, and which way traffic flows.
 */
function stations(f: PortForward, host: Host): { from: Station; via: Station; to: Station } {
  const kind = f.kind ?? "local";
  // The middle station is labelled with the ssh flag rather than the host name:
  // for a remote forward the host is already the left-hand endpoint, so
  // repeating it there said nothing, and the flag is what people recognise.
  const via: Station = {
    place: "Tunnel",
    addr: kind === "remote" ? "-R" : kind === "socks" ? "-D" : "-L",
  };

  if (kind === "remote") {
    // ssh -R : the SSH server opens the port; connections come back to us.
    return {
      from: { place: host.name, addr: `${f.bind_host || "127.0.0.1"}:${f.remote_port}` },
      via,
      // Resolved from *this* machine, which is why it's labelled that way.
      to: { place: "This machine", addr: `${f.remote_host}:${f.local_port}` },
    };
  }

  if (kind === "socks") {
    // ssh -D : a local SOCKS5 listener; the destination is whatever each
    // connection asks for, resolved out at the server.
    return {
      from: { place: "This machine", addr: `localhost:${f.local_port}` },
      via,
      to: { place: "Anywhere", addr: "per request" },
    };
  }

  // ssh -L : we open the port; the destination is resolved by the server.
  return {
    from: { place: "This machine", addr: `localhost:${f.local_port}` },
    via,
    to: { place: "Server-side", addr: `${f.remote_host}:${f.remote_port}` },
  };
}

function Node({ s }: { s: Station }) {
  return (
    <div className="fwd-node">
      <span className="fwd-node-place">{s.place}</span>
      <span className="fwd-node-addr">{s.addr}</span>
    </div>
  );
}

/**
 * Three stations on one wire, in the Kino Projection patch-diagram idiom the
 * kino-control landing page uses. When the tunnel is up, a pulse travels the
 * rail in the direction traffic actually flows.
 */
export function ForwardDiagram({ forward, host, active }: Props) {
  const { from, via, to } = stations(forward, host);
  return (
    <div className={`fwd-diagram ${active ? "live" : ""}`} aria-hidden="true">
      <Node s={from} />
      <div className="fwd-rail">
        <span className="fwd-arrow">▶</span>
        {active && <span className="fwd-pulse" />}
      </div>
      <Node s={via} />
      <div className="fwd-rail">
        <span className="fwd-arrow">▶</span>
        {active && <span className="fwd-pulse fwd-pulse--late" />}
      </div>
      <Node s={to} />
    </div>
  );
}

/** Screen-reader text; the diagram itself is decorative. */
export function forwardSummary(f: PortForward, host: Host): string {
  const { from, via, to } = stations(f, host);
  return `${from.place} ${from.addr}, through ${via.place}, to ${to.place} ${to.addr}`;
}
