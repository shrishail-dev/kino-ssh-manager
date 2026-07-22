// Per-session terminal output buffer.
//
// A terminal's xterm view is unmounted and recreated when its tab moves to
// another pane (React re-parents the DOM). The SSH session itself lives in the
// backend and survives that, but a fresh xterm starts blank. We keep a rolling
// copy of each session's decoded output here so the new view can repaint its
// scrollback on mount instead of showing an empty screen.

const buffers = new Map<string, string>();

// Cap per session so a long-lived, chatty terminal can't grow without bound.
const CAP = 2_000_000; // ~2 MB of decoded text

export function appendTerminalOutput(sessionId: string, text: string): void {
  let next = (buffers.get(sessionId) ?? "") + text;
  if (next.length > CAP) next = next.slice(-CAP);
  buffers.set(sessionId, next);
}

export function getTerminalOutput(sessionId: string): string {
  return buffers.get(sessionId) ?? "";
}

export function clearTerminalOutput(sessionId: string): void {
  buffers.delete(sessionId);
}
