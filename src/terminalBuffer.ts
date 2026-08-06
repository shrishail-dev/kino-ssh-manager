// Per-session terminal output buffer.
//
// A terminal's xterm view is unmounted and recreated when its tab moves to
// another pane (React re-parents the DOM). The SSH session itself lives in the
// backend and survives that, but a fresh xterm starts blank. We keep a rolling
// copy of each session's decoded output here so the new view can repaint its
// scrollback on mount instead of showing an empty screen.

/** Largest single chunk we hold. Bounds both the trim overshoot below and the
 *  cost of splitting an oversized append (a big paste, or a replayed buffer). */
const MAX_CHUNK = 64 * 1024;

/**
 * A rolling text buffer that keeps roughly the last `cap` characters.
 *
 * Appends land in a list of chunks rather than one big string. The obvious
 * implementation - `buf = (buf + text).slice(-cap)` - re-copies the entire
 * buffer on every append once it reaches the cap, so a chatty SSH session pays
 * O(cap) per packet forever. Measured in JavaScriptCore, the engine the Linux
 * build actually runs on, that put a hard ~1.6 MB/s ceiling on terminal
 * throughput and produced megabytes of garbage per packet; the same 4.1 MB of
 * output costs ~1 ms here instead of ~2.5 s.
 *
 * Trimming only ever drops whole chunks, so an append costs time proportional
 * to the text appended and never to how much is already buffered. The trade is
 * that the buffer can sit up to one chunk over `cap` - the cap exists to bound
 * memory, not as an exact contract, so that's fine.
 */
export class RollingText {
  private parts: string[] = [];
  private len = 0;
  /** Cached join, invalidated on append. Reads are rare (save-log export,
   *  repainting a moved terminal, building copilot context). */
  private joined: string | null = null;

  constructor(private readonly cap: number) {}

  get length(): number {
    return this.len;
  }

  append(text: string): void {
    if (!text) return;
    this.joined = null;

    if (text.length > MAX_CHUNK) {
      // Keep every chunk bounded, so the overshoot below stays bounded too.
      for (let i = 0; i < text.length; i += MAX_CHUNK) {
        this.push(text.slice(i, i + MAX_CHUNK));
      }
    } else {
      this.push(text);
    }

    // Drop whole chunks while doing so still leaves at least `cap` characters.
    // Never slices, so this costs O(1) per dropped chunk regardless of size.
    while (this.parts.length > 1 && this.len - this.parts[0].length >= this.cap) {
      this.len -= this.parts.shift()!.length;
    }
  }

  private push(chunk: string): void {
    this.parts.push(chunk);
    this.len += chunk.length;
  }

  /** Everything buffered, oldest first. */
  toString(): string {
    if (this.joined === null) this.joined = this.parts.join("");
    return this.joined;
  }

  /** The last `n` characters, without joining the whole buffer to get them. */
  tail(n: number): string {
    if (this.joined !== null) return this.joined.slice(-n);
    const out: string[] = [];
    let have = 0;
    for (let i = this.parts.length - 1; i >= 0 && have < n; i--) {
      out.push(this.parts[i]);
      have += this.parts[i].length;
    }
    return out.reverse().join("").slice(-n);
  }

  /** Replace the contents wholesale (used when seeding from a prior view). */
  reset(text = ""): void {
    this.parts = [];
    this.len = 0;
    this.joined = null;
    this.append(text);
  }
}

const buffers = new Map<string, RollingText>();

// Cap per session so a long-lived, chatty terminal can't grow without bound.
const CAP = 2_000_000; // ~2 MB of decoded text

export function appendTerminalOutput(sessionId: string, text: string): void {
  let buf = buffers.get(sessionId);
  if (!buf) {
    buf = new RollingText(CAP);
    buffers.set(sessionId, buf);
  }
  buf.append(text);
}

export function getTerminalOutput(sessionId: string): string {
  return buffers.get(sessionId)?.toString() ?? "";
}

/** Trailing slice of a session's output - cheaper than reading it all and then
 *  slicing, which joins megabytes to keep a few thousand characters. */
export function getTerminalOutputTail(sessionId: string, chars: number): string {
  return buffers.get(sessionId)?.tail(chars) ?? "";
}

export function clearTerminalOutput(sessionId: string): void {
  buffers.delete(sessionId);
}
