/** Ambiguous glyphs (0/O, 1/l/I) are excluded - these passwords get read aloud and retyped. */
const PASSWORD_CHARS =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*-_=+";

export function generatePassword(length = 20): string {
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => PASSWORD_CHARS[b % PASSWORD_CHARS.length]).join("");
}

/**
 * Show a transient toast in the app shell. Fires the `kino:toast` window event
 * that App listens for, so any component can report without prop-drilling.
 */
export function toast(message: string): void {
  window.dispatchEvent(new CustomEvent("kino:toast", { detail: message }));
}

/** Filesystem-safe stem for a host name, used as the default export filename. */
export function slug(name: string): string {
  return name.replace(/[^a-z0-9]/gi, "_").toLowerCase();
}

/**
 * How to address a host, for display. Agent-mode hosts have no hostname - they're
 * reached by agent id through a relay - so rendering them as "hostname:port" would
 * print a bare ":22".
 */
export function hostTarget(host: {
  hostname: string;
  port: number;
  connection_mode?: string | null;
  agent_id?: string | null;
}): string {
  if (host.connection_mode === "agent") {
    const id = host.agent_id ?? "";
    return id ? `agent ${id.slice(0, 8)}` : "agent";
  }
  return `${host.hostname}:${host.port}`;
}
