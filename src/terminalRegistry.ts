import type { Terminal as XTerm } from "@xterm/xterm";

// Maps a live session id to its xterm instance so code outside a Terminal
// component (e.g. the command palette) can insert text into the right terminal.
const registry = new Map<string, XTerm>();

export function registerTerminal(sessionId: string, term: XTerm) {
  registry.set(sessionId, term);
}

export function unregisterTerminal(sessionId: string) {
  registry.delete(sessionId);
}

/**
 * Insert text into a session's terminal.
 *
 * Routing through xterm's `paste()` means multi-line input is wrapped in
 * bracketed-paste markers (`ESC[200~ … ESC[201~`) whenever the remote shell has
 * bracketed-paste mode on, so readline treats it as a single pasted block
 * instead of executing each line as it streams in. When `run` is set, a final
 * carriage return is sent to execute the pasted command(s).
 *
 * Returns false if no terminal is registered for the session.
 */
export function pasteToSession(sessionId: string, text: string, run = false): boolean {
  const term = registry.get(sessionId);
  if (!term) return false;
  term.paste(text);
  if (run) term.input("\r");
  return true;
}
