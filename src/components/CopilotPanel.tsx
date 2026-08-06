import { useEffect, useRef, useState } from "react";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { AiConfigView, AiMessage, Host, useVaultStore } from "../store";
import { getTerminalOutputTail } from "../terminalBuffer";
import { pasteToSession } from "../terminalRegistry";
import { hostTarget } from "../utils";

interface Props {
  sessionId: string;
  host?: Host;
  local: boolean;
  title: string;
  /** Text (e.g. a terminal selection) to auto-ask the copilot to explain on open. */
  initialPrompt?: string | null;
  onClose: () => void;
  onOpenSettings: () => void;
}

/** How much recent terminal output to attach when the user asks us to. */
const TERMINAL_TAIL_CHARS = 6000;

const SYSTEM_BASE = `You are Kino's terminal copilot, embedded in an SSH client. You help the user operate their servers.

Guidelines:
- Put any shell command in a fenced code block tagged \`bash\` so the user can run it with one click. One coherent command or script per block.
- Prefer commands appropriate for the host shown in the context below.
- Before any destructive or irreversible command (rm -rf, mkfs, dd, DROP, truncate, kill -9 on unknown pids, chmod -R on system paths), say plainly what it will do and that it cannot be undone.
- Be concise. The user is at a terminal and wants the answer, not an essay.
- If you need output from the host to answer, say which command would show it rather than guessing.`;

/** Strip ANSI escapes so the model sees readable text, not control codes. */
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "").replace(/\x1b\][^\x07]*\x07/g, "");
}

type Segment = { kind: "text"; body: string } | { kind: "code"; body: string; lang: string };

/** Split an assistant reply into prose and fenced code blocks. */
function parseSegments(text: string): Segment[] {
  const out: Segment[] = [];
  const fence = /```([a-zA-Z0-9_-]*)\n?([\s\S]*?)(?:```|$)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = fence.exec(text)) !== null) {
    if (m.index > last) out.push({ kind: "text", body: text.slice(last, m.index) });
    out.push({ kind: "code", lang: m[1] || "", body: m[2].replace(/\n$/, "") });
    last = fence.lastIndex;
  }
  if (last < text.length) out.push({ kind: "text", body: text.slice(last) });
  return out.filter((s) => s.kind === "code" || s.body.trim().length > 0);
}

function CodeBlock({ code, lang, onRun, canRun }: { code: string; lang: string; onRun: () => void; canRun: boolean }) {
  const [copied, setCopied] = useState(false);
  const runnable = canRun && (lang === "" || ["bash", "sh", "shell", "zsh", "console"].includes(lang));
  return (
    <div className="copilot-code">
      <div className="copilot-code-bar">
        <span className="copilot-code-lang">{lang || "text"}</span>
        <button
          className="btn btn-sm"
          onClick={async () => {
            await navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
        {runnable && (
          <button className="btn btn-sm btn-primary" onClick={onRun} title="Paste and run in this terminal">
            Run
          </button>
        )}
      </div>
      <pre className="mono">{code}</pre>
    </div>
  );
}

export function CopilotPanel({ sessionId, host, local, title, initialPrompt, onClose, onOpenSettings }: Props) {
  const { aiGetConfig, aiSend, aiCancel } = useVaultStore();
  const [config, setConfig] = useState<AiConfigView | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState<string | null>(null);
  const [thinking, setThinking] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [attachOutput, setAttachOutput] = useState(false);
  const [busy, setBusy] = useState(false);
  const reqIdRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    aiGetConfig()
      .then(setConfig)
      .catch(() => setConfig(null))
      .finally(() => setLoadingConfig(false));
  }, [aiGetConfig]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, streaming, thinking]);

  // When opened with a selection to explain, ask about it once the config is
  // ready. The ref dedupes so the same text isn't re-sent on every re-render.
  const seededRef = useRef<string | null>(null);
  useEffect(() => {
    const text = initialPrompt?.trim();
    if (!text || loadingConfig || !config?.configured) return;
    if (seededRef.current === text) return;
    seededRef.current = text;
    send(`Explain the following, which I selected in my terminal. Be concise:\n\n\`\`\`\n${text}\n\`\`\``);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPrompt, loadingConfig, config]);

  function buildSystem(): string {
    const parts = [SYSTEM_BASE, ""];
    if (local) {
      parts.push("Context: the user is in a LOCAL shell on their own machine, not a remote server.");
    } else if (host) {
      const os = host.os ? `, OS: ${host.os}` : "";
      parts.push(`Context: the user is connected to "${host.name}" (${host.username}@${hostTarget(host)}${os}).`);
      if (host.notes) parts.push(`Notes about this host: ${host.notes}`);
    }
    if (attachOutput) {
      // Read the tail directly: joining the whole 2 MB buffer and then slicing
      // 6 000 characters off the end wastes most of the work.
      const tail = stripAnsi(getTerminalOutputTail(sessionId, TERMINAL_TAIL_CHARS));
      if (tail.trim()) {
        parts.push(
          "",
          "Recent terminal output from this session (most recent last):",
          "<terminal_output>",
          tail,
          "</terminal_output>"
        );
      }
    }
    return parts.join("\n");
  }

  async function send(prompt: string) {
    const text = prompt.trim();
    if (!text || busy) return;
    setError(null);
    setInput("");
    const next: AiMessage[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setStreaming("");
    setThinking("");
    setBusy(true);

    const id = crypto.randomUUID();
    reqIdRef.current = id;
    let acc = "";
    const unlisten: UnlistenFn[] = [];
    const cleanup = () => {
      unlisten.forEach((fn) => fn());
      reqIdRef.current = null;
      setBusy(false);
    };

    try {
      unlisten.push(
        await listen<string>(`ai-delta-${id}`, (e) => {
          acc += e.payload;
          setStreaming(acc);
        })
      );
      unlisten.push(
        await listen<string>(`ai-thinking-${id}`, (e) => setThinking((t) => t + e.payload))
      );
      unlisten.push(
        await listen<string>(`ai-done-${id}`, () => {
          if (acc.trim()) setMessages((m) => [...m, { role: "assistant", content: acc }]);
          setStreaming(null);
          setThinking("");
          cleanup();
        })
      );
      unlisten.push(
        await listen<string>(`ai-error-${id}`, (e) => {
          setError(e.payload);
          // Keep any partial answer rather than throwing it away.
          if (acc.trim()) setMessages((m) => [...m, { role: "assistant", content: acc }]);
          setStreaming(null);
          setThinking("");
          cleanup();
        })
      );
      await aiSend(id, buildSystem(), next);
    } catch (e) {
      setError(String(e));
      setStreaming(null);
      cleanup();
    }
  }

  function stop() {
    if (reqIdRef.current) aiCancel(reqIdRef.current).catch(() => {});
  }

  const canRun = !!sessionId;
  const quick = [
    { label: "Explain the last error", prompt: "Look at the recent terminal output and explain the most recent error, then give me the fix.", needsOutput: true },
    { label: "What's using disk?", prompt: "How do I find what's using the most disk space on this host?" },
    { label: "Check services", prompt: "Show me how to list failed systemd services on this host." },
  ];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal copilot-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>
            Copilot - {title}
            {config?.configured && (
              <span className="copilot-model-badge">
                {config.model}
              </span>
            )}
          </h2>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>

        {loadingConfig ? (
          <div className="docker-empty">Loading…</div>
        ) : !config?.configured ? (
          <div className="copilot-setup">
            <p>The AI copilot isn't set up yet.</p>
            <p className="hint">
              Add a Claude or Gemini API key - or sign in with your Anthropic account - and your
              credential stays encrypted in this vault, on this machine.
            </p>
            <button className="btn btn-primary" onClick={onOpenSettings}>Set up the copilot</button>
          </div>
        ) : (
          <>
            <div className="copilot-thread" ref={scrollRef}>
              {messages.length === 0 && !streaming && (
                <div className="copilot-empty">
                  <p>Ask about this host, or paste an error.</p>
                  <div className="copilot-quick">
                    {quick.map((q) => (
                      <button
                        key={q.label}
                        className="btn btn-sm"
                        onClick={() => {
                          if (q.needsOutput) setAttachOutput(true);
                          send(q.prompt);
                        }}
                      >
                        {q.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((m, i) => (
                <div key={i} className={`copilot-msg ${m.role}`}>
                  <span className="copilot-role">{m.role === "user" ? "You" : "Copilot"}</span>
                  <div className="copilot-body">
                    {m.role === "assistant"
                      ? parseSegments(m.content).map((seg, j) =>
                          seg.kind === "code" ? (
                            <CodeBlock
                              key={j}
                              code={seg.body}
                              lang={seg.lang}
                              canRun={canRun}
                              onRun={() => pasteToSession(sessionId, seg.body, true)}
                            />
                          ) : (
                            <p key={j}>{seg.body.trim()}</p>
                          )
                        )
                      : <p>{m.content}</p>}
                  </div>
                </div>
              ))}

              {thinking && streaming !== null && !streaming && (
                <div className="copilot-msg assistant">
                  <span className="copilot-role">Copilot</span>
                  <div className="copilot-thinking">
                    <span className="copilot-thinking-label">Thinking…</span>
                    <p>{thinking}</p>
                  </div>
                </div>
              )}

              {streaming !== null && streaming && (
                <div className="copilot-msg assistant">
                  <span className="copilot-role">Copilot</span>
                  <div className="copilot-body">
                    {parseSegments(streaming).map((seg, j) =>
                      seg.kind === "code" ? (
                        <CodeBlock
                          key={j}
                          code={seg.body}
                          lang={seg.lang}
                          canRun={canRun}
                          onRun={() => pasteToSession(sessionId, seg.body, true)}
                        />
                      ) : (
                        <p key={j}>{seg.body.trim()}</p>
                      )
                    )}
                    <span className="copilot-cursor" />
                  </div>
                </div>
              )}

              {streaming === "" && !thinking && <div className="copilot-empty">Working…</div>}
            </div>

            {error && <p className="form-error">{error}</p>}

            <div className="copilot-input">
              <label className="copilot-attach" title="Send recent terminal output as context">
                <input
                  type="checkbox"
                  checked={attachOutput}
                  onChange={(e) => setAttachOutput(e.target.checked)}
                />
                Attach terminal output
              </label>
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask about this host… (Enter to send, Shift+Enter for a new line)"
                rows={2}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send(input);
                  }
                }}
              />
              <div className="copilot-actions">
                {messages.length > 0 && !busy && (
                  <button className="btn btn-sm" onClick={() => { setMessages([]); setError(null); }}>
                    Clear
                  </button>
                )}
                {busy ? (
                  <button className="btn btn-sm" onClick={stop}>Stop</button>
                ) : (
                  <button className="btn btn-primary btn-sm" onClick={() => send(input)} disabled={!input.trim()}>
                    Send
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
