import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal as XTerm } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { Host, Tab, useVaultStore } from "../store";
import { comboFromEvent } from "../keymap";
import { toast } from "../utils";
import { THEMES } from "../themes";
import { appendTerminalOutput, getTerminalOutput } from "../terminalBuffer";
import { registerTerminal, unregisterTerminal } from "../terminalRegistry";

interface Props {
  sessionId: string;
  kind: "ssh" | "local";
  active: boolean;
  /** Tab identity + host, needed for in-place auto-reconnect. */
  tabId?: string;
  host?: Host;
  /** When set, the selection tooltip offers "Explain by AI" for the picked text. */
  onExplain?: (text: string) => void;
}

/** Max consecutive auto-reconnect attempts before giving up. */
const MAX_RECONNECT_ATTEMPTS = 6;

/** "Copied 3 lines" / "Copied 42 characters" - enough to confirm what landed. */
function amount(text: string): string {
  const lines = text.split("\n").length;
  if (lines > 1) return `${lines} lines`;
  return `${text.length} character${text.length === 1 ? "" : "s"}`;
}
const copiedLabel = (text: string) => `Copied ${amount(text)}`;
const pastedLabel = (text: string) => `Pasted ${amount(text)}`;

export function Terminal({ sessionId, kind, active, tabId, host, onExplain }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const logRef = useRef<string>("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  // Floating "Copy / Explain" tooltip anchored to the mouse when text is selected.
  const [selMenu, setSelMenu] = useState<{ x: number; y: number; text: string } | null>(null);
  // The xterm key handler is installed once at mount; read the latest bindings
  // through a ref so rebinding in Settings takes effect without a remount.
  const keybindings = useVaultStore((s) => s.keybindings);
  const keybindingsRef = useRef(keybindings);
  useEffect(() => { keybindingsRef.current = keybindings; }, [keybindings]);
  const { markTabDisconnected, theme: themeId } = useVaultStore();

  // Auto-reconnect: -1 countdown = permanently failed; otherwise seconds left.
  const [reconnect, setReconnect] = useState<{ attempt: number; countdown: number } | null>(null);
  const attemptRef = useRef(0);
  const reconnectTimerRef = useRef<number | null>(null);
  const activeRef = useRef(active);
  useEffect(() => { activeRef.current = active; }, [active]);

  const clearReconnectTimer = () => {
    if (reconnectTimerRef.current !== null) {
      clearInterval(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  };

  async function doReconnect() {
    clearReconnectTimer();
    setReconnect((r) => (r ? { ...r, countdown: 0 } : r));
    try {
      if (!tabId) throw new Error("no tab");
      await useVaultStore.getState().reconnectTab(tabId);
      attemptRef.current = 0;
      setReconnect(null); // sessionId prop changes - main effect rebinds listeners
    } catch {
      attemptRef.current += 1;
      if (attemptRef.current >= MAX_RECONNECT_ATTEMPTS) {
        setReconnect({ attempt: attemptRef.current, countdown: -1 });
      } else {
        scheduleReconnect();
      }
    }
  }

  function scheduleReconnect() {
    const attempt = attemptRef.current;
    const delayMs = Math.min(1000 * 2 ** attempt, 30000);
    let remaining = Math.ceil(delayMs / 1000);
    setReconnect({ attempt: attempt + 1, countdown: remaining });
    clearReconnectTimer();
    reconnectTimerRef.current = window.setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        void doReconnect();
      } else {
        setReconnect({ attempt: attempt + 1, countdown: remaining });
      }
    }, 1000);
  }

  function cancelReconnect() {
    clearReconnectTimer();
    attemptRef.current = 0;
    setReconnect(null);
  }

  useEffect(() => {
    if (!containerRef.current) return;

    // Read theme at mount time via getState so we don't need it in deps
    const { theme: currentThemeId } = useVaultStore.getState();
    const t = THEMES.find((t) => t.id === currentThemeId) ?? THEMES[0];

    const savedFont = Number(localStorage.getItem("ssh-mgr:term-fontsize") ?? "14") || 14;
    const term = new XTerm({
      cursorBlink: true,
      fontSize: savedFont,
      fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
      theme: t.term,
      allowTransparency: false,
      scrollback: 5000,
    });

    const fitAddon = new FitAddon();
    const searchAddon = new SearchAddon();
    // Route link clicks through Tauri's opener - the webview blocks window.open().
    const webLinksAddon = new WebLinksAddon((_event, uri) => {
      openUrl(uri).catch((e) => console.error("Failed to open link:", e));
    });

    term.loadAddon(fitAddon);
    term.loadAddon(searchAddon);
    term.loadAddon(webLinksAddon);

    term.open(containerRef.current);

    // WebGL rendering is much cheaper on busy terminals, but needs a GL context
    // and must load after open(). Fall back to the default renderer if either
    // the context can't be created or it's lost later (e.g. GPU reset).
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      term.loadAddon(webgl);
    } catch {
      // No WebGL available - the DOM renderer stays in place.
    }

    // OSC 52: let the remote side (tmux/vim "+y) put text on the local clipboard.
    // Payload is "<targets>;<base64>"; "?" is a read-back request, which we
    // deliberately don't answer - it would leak clipboard contents to the host.
    term.parser.registerOscHandler(52, (data) => {
      const sep = data.indexOf(";");
      if (sep === -1) return false;
      const payload = data.slice(sep + 1);
      if (payload === "?") return false;
      try {
        const bytes = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0));
        const text = new TextDecoder().decode(bytes);
        navigator.clipboard
          .writeText(text)
          // The remote wrote the clipboard with no visible sign - say so.
          .then(() => toast(`${copiedLabel(text)} (from the remote host)`))
          .catch(() => {});
      } catch {
        return false; // not valid base64 - let the default handler have it
      }
      return true;
    });

    fitAddon.fit();

    termRef.current = term;
    fitRef.current = fitAddon;
    searchRef.current = searchAddon;
    // Expose this terminal for programmatic (bracketed) paste from elsewhere.
    registerTerminal(sessionId, term);

    const resizeCommand = kind === "local" ? "local_resize" : "ssh_resize";
    const writeCommand = kind === "local" ? "local_write" : "ssh_write";
    const dataEvent = kind === "local" ? `local-data-${sessionId}` : `ssh-data-${sessionId}`;
    const closeEvent = kind === "local" ? `local-closed-${sessionId}` : `ssh-closed-${sessionId}`;

    // If this session already produced output (e.g. the tab was moved to another
    // pane and this xterm is a fresh view of a still-running session), repaint it
    // so the terminal isn't blank. Empty on a first connect.
    const prior = getTerminalOutput(sessionId);
    if (prior) {
      term.write(prior);
      logRef.current = prior;
    }

    // Ctrl+F search, Ctrl +/-/0 font size - intercepted before the shell sees them.
    const applyFont = (size: number) => {
      const s = Math.min(28, Math.max(8, size));
      term.options.fontSize = s;
      localStorage.setItem("ssh-mgr:term-fontsize", String(s));
      fitAddon.fit();
      invoke(resizeCommand, { sessionId, cols: term.cols, rows: term.rows }).catch(() => {});
    };
    // Terminal shortcuts are resolved against the customizable keymap. A matched
    // action runs and is swallowed (preventDefault + return false) so the shell
    // never sees the keystroke - e.g. Ctrl+Shift+C copies instead of hitting the
    // webview's own copy, which would otherwise fire a second time.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown") return true;
      const combo = comboFromEvent(e);
      if (!combo) return true;
      const kb = keybindingsRef.current;
      const swallow = () => { e.preventDefault(); return false; };
      switch (combo) {
        case kb["term-copy"]: {
          const sel = term.getSelection();
          if (sel) {
            navigator.clipboard
              .writeText(sel)
              .then(() => toast(copiedLabel(sel)))
              .catch(() => toast("Couldn't copy to clipboard"));
            term.clearSelection();
          }
          return swallow();
        }
        case kb["term-paste"]:
          navigator.clipboard
            .readText()
            .then((t) => {
              if (!t) return;
              term.paste(t);
              toast(pastedLabel(t));
            })
            .catch(() => toast("Couldn't read the clipboard"));
          return swallow();
        case kb["term-find"]:
          setSearchOpen(true);
          return swallow();
        case kb["term-font-inc"]:
          applyFont((term.options.fontSize ?? 14) + 1);
          return swallow();
        case kb["term-font-dec"]:
          applyFont((term.options.fontSize ?? 14) - 1);
          return swallow();
        case kb["term-font-reset"]:
          applyFont(14);
          return swallow();
        default:
          return true;
      }
    });

    term.onData((data) => {
      const bytes = Array.from(new TextEncoder().encode(data));
      const st = useVaultStore.getState();
      // Broadcast mode: fan keystrokes out to the active tab of every pane.
      if (st.broadcastInput && activeRef.current) {
        const targets = st.panes
          .map((p) => st.activeTabIds[p])
          .map((tid) => st.tabs.find((t) => t.id === tid && t.connected))
          .filter((t): t is Tab => !!t);
        if (targets.length > 0) {
          targets.forEach((t) => {
            const cmd = t.kind === "local" ? "local_write" : "ssh_write";
            invoke(cmd, { sessionId: t.sessionId, data: bytes }).catch(() => {});
          });
          return;
        }
      }
      invoke(writeCommand, { sessionId, data: bytes }).catch(() => {});
    });

    const decoder = new TextDecoder();
    const unlistenData = listen<number[]>(dataEvent, (event) => {
      const bytes = new Uint8Array(event.payload);
      term.write(bytes);
      // Buffer output for "Save log" (cap ~4 MB to bound memory).
      const text = decoder.decode(bytes, { stream: true });
      logRef.current += text;
      if (logRef.current.length > 4_000_000) {
        logRef.current = logRef.current.slice(-4_000_000);
      }
      // Also feed the cross-mount buffer so a moved terminal can repaint.
      appendTerminalOutput(sessionId, text);
    });

    const unlistenClose = listen(closeEvent, () => {
      term.writeln("\r\n\x1b[33m[Connection closed]\x1b[0m");
      const st = useVaultStore.getState();
      // Was this tab still considered connected? (Intentional closes remove the
      // tab first, so it won't be found - and we won't try to reconnect.)
      const tab = tabId ? st.tabs.find((t) => t.id === tabId) : undefined;
      const wasConnected = !!tab?.connected;
      markTabDisconnected(sessionId);
      if (kind === "ssh" && host && tabId && wasConnected && st.autoReconnect) {
        attemptRef.current = 0;
        scheduleReconnect();
      }
    });

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      invoke(resizeCommand, { sessionId, cols: term.cols, rows: term.rows }).catch(() => {});
    });
    resizeObserver.observe(containerRef.current);

    // Selection tooltip: show Copy / Explain when a drag leaves text selected,
    // anchored just above the mouse. A fresh mousedown or an emptied selection
    // hides it again.
    const onMouseUp = (e: MouseEvent) => {
      const text = term.getSelection();
      if (!text.trim() || !wrapRef.current) return;
      const rect = wrapRef.current.getBoundingClientRect();
      setSelMenu({ x: e.clientX - rect.left, y: e.clientY - rect.top, text });
    };
    const onMouseDown = () => setSelMenu(null);
    containerRef.current.addEventListener("mouseup", onMouseUp);
    containerRef.current.addEventListener("mousedown", onMouseDown);
    const selDisposable = term.onSelectionChange(() => {
      if (!term.hasSelection()) setSelMenu(null);
    });

    return () => {
      resizeObserver.disconnect();
      containerRef.current?.removeEventListener("mouseup", onMouseUp);
      containerRef.current?.removeEventListener("mousedown", onMouseDown);
      selDisposable.dispose();
      unlistenData.then((fn) => fn());
      unlistenClose.then((fn) => fn());
      unregisterTerminal(sessionId);
      clearReconnectTimer();
      term.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, kind]);

  // Update terminal theme without recreating the terminal instance
  useEffect(() => {
    if (!termRef.current) return;
    const t = THEMES.find((t) => t.id === themeId) ?? THEMES[0];
    termRef.current.options.theme = t.term;
  }, [themeId]);

  useEffect(() => {
    if (active && termRef.current) {
      termRef.current.focus();
      fitRef.current?.fit();
    }
  }, [active]);

  function runSearch(query: string, forward: boolean) {
    if (!query) return;
    if (forward) searchRef.current?.findNext(query);
    else searchRef.current?.findPrevious(query);
  }

  async function saveLog() {
    // Strip ANSI escape sequences for a readable plaintext log.
    // eslint-disable-next-line no-control-regex
    const clean = logRef.current.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
    const path = await saveDialog({ defaultPath: `session-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.log` });
    if (!path) return;
    await invoke("save_session_log", { content: clean, path }).catch((e) => console.error(e));
  }

  function copySelection() {
    if (selMenu) {
      const text = selMenu.text;
      navigator.clipboard
        .writeText(text)
        .then(() => toast(copiedLabel(text)))
        .catch(() => toast("Couldn't copy to clipboard"));
    }
    termRef.current?.clearSelection();
    setSelMenu(null);
  }

  function explainSelection() {
    if (selMenu) onExplain?.(selMenu.text);
    setSelMenu(null);
  }

  return (
    <div ref={wrapRef} className="terminal-wrap" style={{ display: active ? "block" : "none" }}>
      {selMenu && (
        <div
          className="term-sel-menu"
          style={{ left: selMenu.x, top: Math.max(4, selMenu.y - 10) }}
          onMouseDown={(e) => e.preventDefault() /* keep the xterm selection alive */}
        >
          <button className="term-sel-btn" onClick={copySelection}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
            Copy
          </button>
          {onExplain && (
            <button className="term-sel-btn" onClick={explainSelection}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 3l1.9 4.6 4.6 1.9-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9z" />
              </svg>
              Explain by AI
            </button>
          )}
        </div>
      )}
      {reconnect && (
        <div className={`term-reconnect ${reconnect.countdown < 0 ? "failed" : ""}`}>
          {reconnect.countdown < 0 ? (
            <>
              <span>Could not reconnect after {reconnect.attempt} attempts.</span>
              <button className="btn btn-sm btn-primary" onClick={() => { attemptRef.current = 0; scheduleReconnect(); }}>
                Try again
              </button>
              <button className="btn btn-sm" onClick={cancelReconnect}>Dismiss</button>
            </>
          ) : reconnect.countdown === 0 ? (
            <span>Reconnecting…</span>
          ) : (
            <>
              <span>Connection lost. Reconnecting in {reconnect.countdown}s (attempt {reconnect.attempt})…</span>
              <button className="btn btn-sm btn-primary" onClick={() => doReconnect()}>Reconnect now</button>
              <button className="btn btn-sm" onClick={cancelReconnect}>Cancel</button>
            </>
          )}
        </div>
      )}
      <div className="term-toolbar">
        <button className="term-tool-btn" title="Find (Ctrl+F)" onClick={() => setSearchOpen((v) => !v)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </button>
        <button className="term-tool-btn" title="Save session log" onClick={saveLog}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        </button>
      </div>
      {searchOpen && (
        <div className="term-search">
          <input
            autoFocus
            value={searchQuery}
            placeholder="Find in terminal…"
            onChange={(e) => { setSearchQuery(e.target.value); searchRef.current?.findNext(e.target.value, { incremental: true }); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") runSearch(searchQuery, !e.shiftKey);
              if (e.key === "Escape") { setSearchOpen(false); setSearchQuery(""); termRef.current?.focus(); }
            }}
          />
          <button className="btn btn-sm" title="Previous" onClick={() => runSearch(searchQuery, false)}>↑</button>
          <button className="btn btn-sm" title="Next" onClick={() => runSearch(searchQuery, true)}>↓</button>
          <button className="btn btn-sm" title="Close (Esc)" onClick={() => { setSearchOpen(false); setSearchQuery(""); termRef.current?.focus(); }}>✕</button>
        </div>
      )}
      <div ref={containerRef} className="terminal-container" />
    </div>
  );
}
