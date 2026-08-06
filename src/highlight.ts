// Output highlighting for the terminal, in the spirit of MobaXterm's.
//
// The only way to colour arbitrary terminal output is to rewrite the byte
// stream: match patterns in a line and wrap them in SGR escapes before xterm
// parses it. (xterm's decoration API draws overlays on cells, which is built
// for gutter markers, not token colouring - it would not survive scrollback and
// would cost a redraw per match.)
//
// Rewriting someone else's terminal stream is easy to get wrong, so the rules
// below are deliberately conservative:
//
//   * Complete lines only. A partial line at the end of a packet is passed
//     through untouched rather than held back - buffering it would stall a
//     prompt, which never ends in a newline, until the user typed something.
//   * Never inside the alternate screen buffer. vim, htop, less and every other
//     full-screen program paint their own colours and position the cursor
//     precisely; injecting escapes there corrupts the display. This is why
//     MobaXterm's highlighting also stops at the edge of a TUI.
//   * Never on a line that already carries an escape sequence. If the program
//     is colouring its own output, it wins.
//   * Never on very long lines, which are usually machine data (base64, JSON
//     blobs) where the regex costs the most and helps the least.
//
// Colours are SGR 38;5;N (256-colour) rather than literal RGB so they land on
// the palette the active theme already defines.

/** Longer than this and a "line" is data, not prose - skip it. */
const MAX_LINE = 2000;

/**
 * Most a single chunk may be before highlighting bows out.
 *
 * Measured on JavaScriptCore, this pass runs at roughly 5 MB/s - fast enough to
 * be invisible while you read, nowhere near fast enough to sit in front of a
 * firehose. Rather than let it become the bottleneck the 0.7.x throughput work
 * just removed, it simply stands aside once a chunk gets big.
 *
 * The reasoning is that highlighting is a *reading* aid. 8 KB per ~12 ms batch
 * is around 650 KB/s, or well over a hundred full screens a second: far more
 * than anyone can read, and far less than a `cat` of a large file. So it stays
 * on for everything you could actually follow, and gets out of the way at
 * exactly the point the screen becomes a blur.
 */
const MAX_CHUNK = 8 * 1024;

/* 256-colour palette slots. These map onto the theme's own ANSI colours, so
 * highlighting inherits whatever theme is active instead of hardcoding ink. */
const RED = "\x1b[38;5;9m";
const YELLOW = "\x1b[38;5;11m";
const GREEN = "\x1b[38;5;10m";
const CYAN = "\x1b[38;5;14m";
const BLUE = "\x1b[38;5;12m";
const DIM = "\x1b[38;5;8m";
const RESET = "\x1b[39m";

/**
 * One pass, one regex. Alternation with named groups is markedly cheaper than
 * running five separate replaces over every line, which matters because this
 * sits in the path we just spent a release making fast.
 *
 * Ordering matters: earlier alternatives win, so timestamps are matched before
 * bare numbers could nibble at them, and URLs before paths (a URL contains
 * slashes and would otherwise be shredded by the path rule).
 */
const PATTERN = new RegExp(
  [
    // ISO-8601 and syslog-style timestamps at any position.
    "(\\b\\d{4}-\\d{2}-\\d{2}[T ]\\d{2}:\\d{2}:\\d{2}(?:[.,]\\d+)?(?:Z|[+-]\\d{2}:?\\d{2})?\\b|\\b\\d{2}:\\d{2}:\\d{2}(?:[.,]\\d+)?\\b)",
    // Severity words, whole-word and case-insensitive.
    "(\\b(?:ERROR|ERR|FATAL|CRITICAL|CRIT|FAIL(?:ED|URE)?|PANIC|DENIED|REFUSED|TIMEOUT)\\b)",
    "(\\b(?:WARN(?:ING)?|DEPRECATED|NOTICE|RETRY(?:ING)?)\\b)",
    "(\\b(?:OK|SUCCESS|SUCCEEDED|PASSED?|DONE|READY|ACTIVE|RUNNING|ENABLED|LISTENING)\\b)",
    "(\\b(?:INFO|DEBUG|TRACE|VERBOSE)\\b)",
    // URLs before paths - a URL's slashes would otherwise trip the path rule.
    "(\\b[A-Za-z][A-Za-z0-9+.-]*://[^\\s'\"<>]+)",
    // IPv4, optionally with a port.
    "(\\b\\d{1,3}(?:\\.\\d{1,3}){3}(?::\\d{1,5})?\\b)",
    // Absolute unix paths with at least two segments, so a bare "/" is ignored.
    "((?<![\\w/])/(?:[\\w.@%+-]+/)+[\\w.@%+-]*)",
  ].join("|"),
  // No /i: severity words are matched uppercase-only. That keeps them in step
  // with the CANDIDATE gate below, and stops the word "error" inside an
  // ordinary sentence from lighting up.
  "g"
);

/**
 * Cheap gate. The full alternation has to try eight branches at every character
 * position, which is far too expensive to run over lines that cannot match at
 * all. Every rule needs a digit, a slash, a colon, or a run of capitals, so one
 * cheap scan rejects ordinary prose outright - and prose is most of what a
 * terminal prints.
 */
const CANDIDATE = /[0-9/:]|[A-Z]{2}/;

/** Colour a single line. Exported for tests; callers want `highlightChunk`. */
export function highlightLine(line: string): string {
  // Leave it alone if the program is already colouring, or if it's data.
  if (line.length === 0 || line.length > MAX_LINE) return line;
  if (!CANDIDATE.test(line)) return line;
  if (line.includes("\x1b")) return line;
  // Positional groups, not named ones: the named-group form makes the engine
  // allocate a groups object for every single match, which measured as the
  // dominant cost of the whole pass.
  return line.replace(
    PATTERN,
    (m, ts, err, warn, ok, info, url, ip, path) => {
      if (err !== undefined) return RED + m + RESET;
      if (warn !== undefined) return YELLOW + m + RESET;
      if (ok !== undefined) return GREEN + m + RESET;
      if (info !== undefined) return DIM + m + RESET;
      if (ts !== undefined) return DIM + m + RESET;
      if (url !== undefined || ip !== undefined) return CYAN + m + RESET;
      if (path !== undefined) return BLUE + m + RESET;
      return m;
    }
  );
}

/**
 * Colour the complete lines in a chunk of terminal output.
 *
 * Everything up to the last newline is highlighted; whatever trails it is
 * emitted untouched so nothing is ever held back. That means a line split
 * across two packets goes uncoloured - an acceptable trade for never delaying
 * a prompt, and rare in practice now that output is coalesced.
 */
export function highlightChunk(chunk: string): string {
  if (!chunk || chunk.length > MAX_CHUNK) return chunk;
  const cut = chunk.lastIndexOf("\n");
  if (cut === -1) return chunk;

  const complete = chunk.slice(0, cut + 1);
  const trailing = chunk.slice(cut + 1);

  // Split on \n but keep \r attached to the line it terminates, so CRLF streams
  // round-trip byte-for-byte.
  const out = complete
    .split("\n")
    .map((seg, i, arr) => {
      if (i === arr.length - 1) return seg; // trailing "" after the final \n
      const hasCR = seg.endsWith("\r");
      const body = hasCR ? seg.slice(0, -1) : seg;
      return highlightLine(body) + (hasCR ? "\r" : "");
    })
    .join("\n");

  return out + trailing;
}
