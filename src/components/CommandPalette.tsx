import { useEffect, useMemo, useRef, useState } from "react";
import { useVaultStore } from "../store";
import { pasteToSession } from "../terminalRegistry";
import { hostTarget } from "../utils";

interface Props {
  onClose: () => void;
}

interface Command {
  id: string;
  title: string;
  subtitle?: string;
  group: string;
  run: () => void;
}

/**
 * Subsequence fuzzy match with a small adjacency bonus. Returns a score, or
 * -1 if `query` is not a subsequence of `text`. Higher is better.
 */
function fuzzyScore(query: string, text: string): number {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let score = 0;
  let ti = 0;
  let lastMatch = -2;
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi];
    let found = -1;
    for (let j = ti; j < t.length; j++) {
      if (t[j] === ch) { found = j; break; }
    }
    if (found === -1) return -1;
    score += found === lastMatch + 1 ? 3 : 1; // reward consecutive matches
    if (found === 0) score += 2; // reward matching the start
    lastMatch = found;
    ti = found + 1;
  }
  return score;
}

export function CommandPalette({ onClose }: Props) {
  const {
    hosts,
    snippets,
    panes,
    activePaneId,
    activeTabIds,
    tabs,
    openLocalShell,
    splitPane,
    broadcastInput,
    setBroadcastInput,
    importSshConfig,
    lock,
  } = useVaultStore();

  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  // The terminal that snippet actions target: active tab of the active pane.
  const activeSessionId = useMemo(() => {
    const tid = activeTabIds[activePaneId];
    return tabs.find((t) => t.id === tid && t.connected)?.sessionId ?? null;
  }, [activeTabIds, activePaneId, tabs]);

  const commands = useMemo<Command[]>(() => {
    const cmds: Command[] = [];

    for (const host of hosts) {
      cmds.push({
        id: `host:${host.id}`,
        title: host.name,
        subtitle: `${host.username}@${hostTarget(host)}`,
        group: "Connect",
        run: () => window.dispatchEvent(new CustomEvent("kino:connect-host", { detail: host.id })),
      });
    }

    if (activeSessionId) {
      for (const s of snippets) {
        const preview = s.commands.split("\n").find((l) => l.trim()) ?? "";
        cmds.push({
          id: `snippet:${s.id}`,
          title: s.name,
          subtitle: preview,
          group: "Run snippet",
          run: () => pasteToSession(activeSessionId, s.commands, true),
        });
      }
    }

    cmds.push(
      {
        id: "action:new-host",
        title: "Add host…",
        group: "Actions",
        run: () => window.dispatchEvent(new CustomEvent("kino:new-host")),
      },
      {
        id: "action:local-shell",
        title: "Open local shell",
        group: "Actions",
        run: () => void openLocalShell(),
      },
      {
        id: "action:split",
        title: "Split pane",
        group: "Actions",
        run: () => splitPane(activePaneId),
      },
      {
        id: "action:broadcast",
        title: broadcastInput ? "Turn off broadcast input" : "Turn on broadcast input",
        group: "Actions",
        run: () => setBroadcastInput(!broadcastInput),
      },
      {
        id: "action:import-config",
        title: "Import hosts from ~/.ssh/config",
        group: "Actions",
        run: () => {
          importSshConfig()
            .then((n) => window.dispatchEvent(new CustomEvent("kino:toast", { detail: n > 0 ? `Imported ${n} host${n === 1 ? "" : "s"}` : "No new hosts found in ~/.ssh/config" })))
            .catch((e) => window.dispatchEvent(new CustomEvent("kino:toast", { detail: `Import failed: ${e}` })));
        },
      },
      {
        id: "action:lock",
        title: "Lock vault",
        group: "Actions",
        run: () => lock(),
      },
    );

    return cmds;
  }, [hosts, snippets, activeSessionId, panes, activePaneId, broadcastInput, openLocalShell, splitPane, setBroadcastInput, importSshConfig, lock]);

  const results = useMemo(() => {
    const q = query.trim();
    const scored = commands
      .map((c) => ({ c, score: fuzzyScore(q, `${c.title} ${c.subtitle ?? ""} ${c.group}`) }))
      .filter((r) => r.score >= 0);
    scored.sort((a, b) => b.score - a.score);
    return scored.map((r) => r.c);
  }, [commands, query]);

  useEffect(() => { setIndex(0); }, [query]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${index}"]`)?.scrollIntoView({ block: "nearest" });
  }, [index]);

  function choose(cmd: Command | undefined) {
    if (!cmd) return;
    onClose();
    cmd.run();
  }

  return (
    <div className="palette-overlay" onMouseDown={onClose}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="palette-input"
          placeholder="Search hosts, snippets, actions…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setIndex((i) => Math.min(i + 1, results.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setIndex((i) => Math.max(i - 1, 0)); }
            else if (e.key === "Enter") { e.preventDefault(); choose(results[index]); }
            else if (e.key === "Escape") { e.preventDefault(); onClose(); }
          }}
        />
        <div className="palette-list" ref={listRef}>
          {results.length === 0 ? (
            <div className="palette-empty">No matches</div>
          ) : (
            results.map((cmd, i) => {
              const prevGroup = i > 0 ? results[i - 1].group : null;
              return (
                <div key={cmd.id}>
                  {cmd.group !== prevGroup && <div className="palette-group">{cmd.group}</div>}
                  <div
                    data-idx={i}
                    className={`palette-item ${i === index ? "active" : ""}`}
                    onMouseEnter={() => setIndex(i)}
                    onClick={() => choose(cmd)}
                  >
                    <span className="palette-item-title">{cmd.title}</span>
                    {cmd.subtitle && <span className="palette-item-sub">{cmd.subtitle}</span>}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
