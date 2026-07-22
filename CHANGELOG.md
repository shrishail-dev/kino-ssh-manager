# Changelog

All notable changes to Kino SSH Manager are documented here. The format is based
on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to
[Semantic Versioning](https://semver.org/).

## [0.6.0] - 2026-07-22

### Added
- **AI copilot** - an opt-in, bring-your-own-key assistant embedded in the
  terminal, powered by [OpenRouter](https://openrouter.ai) (one key reaches
  every major model). Ask about the host you're on, paste an error, or have it
  explain recent output; suggested shell commands come as one-click "Run"
  blocks. The key is encrypted in the vault like every other secret and only
  ever leaves the machine to call OpenRouter. **Off by default** - enable it
  under **Settings - AI Copilot**.
- **Select text - Copy / Explain by AI** - selecting text in any terminal now
  shows a small tooltip to copy it, or send it straight to the copilot for an
  explanation.
- **Customizable keyboard shortcuts** - rebind the command palette, broadcast
  toggle, terminal find, copy, paste, and font-size shortcuts under **Settings -
  Keyboard Shortcuts**, with live conflict detection and per-action reset.
- **Session restore on unlock** - optionally remember the open tabs and pane
  layout (including pane names) and rebuild them the next time you unlock,
  reconnecting each host into its original pane. Opt-in under Settings.
- **Home favorites** - pin hosts to the empty-pane landing view for one-click
  connect. Star a host in the sidebar or use its right-click menu.
- **Rename panes** - give split panes their own names; the names also appear in
  the tab "Move to pane" menu.
- **Terminal copy & paste shortcuts** - `Ctrl+Shift+C` copies the selection and
  `Ctrl+Shift+V` pastes, alongside the existing right-click and OSC 52 paths.
- **Eight more themes** - Solarized Dark/Light, One Dark, Monokai Pro, Rosé
  Pine, Everforest Dark, Ayu Mirage, and GitHub Light (14 total). The Settings
  theme picker is now a single grouped dropdown.
- **Update available on the login screen** - the release check now runs at
  launch and surfaces a badge on the unlock screen, not just after unlocking.
- **Choose an existing group** - the host editor's Folder / Group field offers a
  dropdown of groups already in use, preventing near-duplicates.

### Changed
- The AI copilot is now OpenRouter-only. The previous Claude (Anthropic) and
  Gemini (Google) providers - including the Anthropic sign-in flow - have been
  removed in favor of a single provider that fronts every model.

## [0.5.0] - 2026-07-14

### Added
- **Agent connection mode** - reach hosts that expose **no inbound SSH port** -
  behind NAT, CGNAT, or a firewall - through a relay, instead of connecting to a
  hostname directly:
  - The host editor gains a **Kino Agent** connection mode. Instead of a hostname
    and port, you provide a **relay URL** (`wss://...`) and an **agent id**.
  - A companion [kino-agent](https://github.com/Samarthegde/kino-agent) runs on
    the target machine and dials *out* to a [kino-relay](https://github.com/Samarthegde/kino-relay);
    the manager reaches it through that relay. The host editor shows the exact
    command to run on the target.
  - The SSH session stays end-to-end encrypted - the relay only forwards bytes
    and never sees your credentials.
  - **Off by default.** Enable it under **Settings - Kino Agent**; when off, all
    agent/relay UI is hidden. It auto-enables if your vault already contains
    agent hosts, so existing configuration is never hidden.
  - A default relay URL can be set in Settings and is pre-filled for new hosts.
- **Password-encrypted profile export** - exporting a host profile now offers a
  password-encrypted `.sshm` file (Argon2 + AES-256-GCM), protected by a
  standalone password you share out-of-band, with a built-in password generator.
  Importing an encrypted profile prompts for the password. Plain (unencrypted)
  export is still available and clearly marked.

### Changed
- **Host editor redesigned as a stepper** - the long Add/Edit Host form is now
  organized into steps (**Connection & Auth**, **Port Forwards**, **Advanced**)
  that double as clickable tabs, so you can jump straight to a field when editing
  without scrolling. Save is available on every step.

### Fixed
- **`wss://` relay URLs now work.** TLS is compiled into the WebSocket client
  (rustls), fixing a `TLS support not compiled in` failure when connecting to a
  `wss://` relay.
- **Host-key verification for agent hosts.** Agent hosts have no hostname, so they
  were all keyed as `:22` in the known-hosts store - trusting one overwrote
  another and later raised a false "possible man-in-the-middle" mismatch. They are
  now keyed by agent id, so each agent's SSH fingerprint is tracked independently.
- **Agent hosts no longer display as `user@:22`** in the sidebar, connect dialog,
  and host-key prompt; they show `user@agent <id>` instead, and are searchable by
  agent id.

## [0.4.3] - 2026-06-30

### Added
- **Session recording & replay** - capture any SSH or local-shell session to an
  [asciicast](https://docs.asciinema.org/) (`.cast`) file:
  - A **Record / Stop** toggle in the terminal toolbar starts and stops capture
    for the active session, with a live "recording" indicator.
  - Recordings are saved to `~/Videos/Kino Recordings`.
  - A **Recordings** manager (Settings - Recordings) lists every recording with
    its date and size, and plays them back in an embedded asciinema player or
    deletes them.
- **Remote file editor** - open a text file from the SFTP browser to edit it in
  a built-in Monaco (VS Code) editor and save it straight back over SFTP, with
  no download/re-upload round trip. Syntax highlighting is picked from the file
  extension and the editor follows the app's active theme.

## [0.4.2] - 2026-06-29

### Changed
- **Full-screen Docker panel** - the Docker management modal now opens maximized,
  so the containers / images / volumes / networks lists use the full window
  height instead of a fixed-height box.
- **Full-screen log viewer** - clicking a container's logs now opens a dedicated
  full-screen modal with larger, more readable text, layered above the Docker
  panel, instead of the small panel that was docked at the bottom. Live
  streaming, auto-scroll, and copy-to-clipboard are unchanged. Closing it (✕ or
  click-away) stops the stream and returns to the Docker panel.

### Removed
- Dropped the unused `resolve_public_key` helper left over from the `ssh2`
  backend; `russh` derives the public key itself during key-based auth.

## [0.4.1] - 2026-06-10

### Added
- **Copy Docker logs** - a one-click button in the container log viewer copies
  the current log buffer to the clipboard.

## [0.4.0] - 2026-06-10

### Added
- **Docker management** - a per-session panel to manage Docker over the existing
  SSH connection (or the local daemon from a local-shell tab):
  - Containers: start / stop / restart / pause / remove, with live status.
  - **Shell access** - drop into an interactive shell inside any running
    container (`docker exec`, prefers `bash`, falls back to `sh`) as a new
    terminal tab.
  - **Live log streaming** - follow a container's logs in real time.
  - **Images / Volumes / Networks** tabs for browsing the daemon.
- **Live system metrics** - a streaming dashboard (CPU, memory, disk, load
  average, uptime, network throughput) sampled once a second, for remote hosts
  and the local machine.
- **Remote (reverse) port forwarding** (`ssh -R`) and a **dynamic SOCKS5 proxy**
  (`ssh -D`), alongside the existing local forwards. Pick the tunnel type per
  rule in the host editor.
- **Operating-system tags** - choose a host's OS in the editor; the sidebar
  shows a matching OS icon (Linux, Ubuntu, Debian, Fedora, Arch, Alpine,
  Windows, macOS) tinted with the host color.
- **Collapsible, resizable sidebar** - hide it from the header toggle or drag
  its edge to resize; the width and collapsed state persist.

### Changed
- **Async networking backend** - the SSH/SFTP/forwarding stack was rewritten
  from the synchronous `ssh2` (libssh2) to the asynchronous `russh` (Tokio).
  A single connection is now multiplexed, so Docker queries, metrics, SFTP, and
  port forwards run in the background without lagging or dropping the terminal.
- Host color is now shown as a top accent line plus an OS/initial tile, instead
  of a full border.
- The sidebar "Sort by" dropdown now follows the active theme.

### Fixed
- App could abort on connect (`ptr::copy_nonoverlapping` UB-check) due to
  pre-release RustCrypto crates pulled in by `russh`; debug-assertions are now
  disabled for dependencies so the benign check no longer crashes dev builds.

### Compatibility
- The new `os` host field is additive; existing vaults load unchanged.
- Port-forward rules without an explicit type default to local forwards.

## [0.3.0] - 2026-06-09

### Added
- **Folders / Groups** - dynamically organize hosts in the sidebar using tag-based groups.
- **Quick Connect Bar** - instantly connect to any transient host directly from the sidebar by typing `user@host:port` without cluttering the vault.
- **Local Shell Tabs** - open a local PowerShell (Windows) or Bash/Zsh (Unix) terminal right inside the app, alongside your remote SSH tabs.

### Fixed
- **Windows SSH authentication (Error 19)** - libssh2 could fail to parse keys with `\r\n` line endings on Windows. Private and public keys are now normalized to use `\n` line endings internally before being sent to the authentication backend.

### Compatibility
- The `group` field for Folders is fully backward compatible; existing vaults will load seamlessly without it.

## [0.2.0] - 2026-06-04

### Added
- **Per-host notes** - store free-form notes on any connection. Notes are
  searchable from the sidebar and shown via a note indicator and row tooltip.
- **Master password confirmation** on first-time vault creation, with a
  "no recovery if you forget this" reminder.
- **Show/hide password toggle** on the unlock screen.
- **Resizable host editor** - drag the bottom-right corner of the Add/Edit Host
  dialog.
- **Windows installers** (`.msi` / `.exe`) are now built and published alongside
  the Linux packages.

### Changed
- Refreshed UI: softer shapes, focus rings, button depth, animated modals, and a
  glassier unlock screen.
- Modals no longer close when clicking outside - only via the ✕ or Cancel/Done
  buttons, to prevent accidental dismissal.

### Fixed
- The auto-lock dropdown now follows the selected theme instead of using the OS
  default colors.
- **SSH key authentication on Windows** - ed25519/OpenSSH keys failed to
  authenticate on the Windows build because libssh2 could not derive the public
  key from the in-memory private key. The public key is now supplied (stored, or
  derived in Rust) so key-based auth works across platforms.
- The Windows build now compiles `libssh2` against a vendored OpenSSL so
  in-memory key auth is available there (keys are never written to disk).

### Compatibility
- The `notes` field is additive; existing vaults continue to load unchanged.
- The Windows key-auth fix is read-only at connect time and changes no vault
  data or format.

## [0.1.0]

### Added
- Initial public release.
- Encrypted vault (Argon2 + AES-256-GCM) unlocked by a single master password.
- Per-host password and/or SSH key auth; ed25519 generation and `.pem`/`.key`/`.ppk` import.
- Built-in xterm.js terminal with scrollback search and font sizing.
- Port forwarding (local tunnels) per host.
- SFTP file browser: browse, upload/download with progress, rename, delete,
  new folder, chmod.
- Snippets library with per-host auto-run on connect.
- Optional encrypted cloud sync to a private GitHub repo, with auto-sync.
- Host key verification (trust-on-first-use) with mismatch protection.
- Security niceties: idle auto-lock, change master password (re-key), in-memory
  secret zeroization, per-host color tags, 6 themes, connection history,
  session logging.
