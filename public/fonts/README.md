# Bundled fonts

Every font the app renders is shipped here and loaded from disk. Nothing is
fetched from a CDN at runtime: a credential manager should look identical
offline, and a page that holds SSH keys has no business making third-party
requests.

Subsetted to `latin` + `latin-ext` as woff2. Non-variable families ship one file
per weight (`-400-`, `-700-`); variable families ship one file spanning the range
(`-var-`).

## Interface

| Family | Files | Licence |
|---|---|---|
| Big Shoulders Display | `bigshoulders-*` | SIL Open Font License 1.1 |
| Chivo | `chivo-*` | SIL Open Font License 1.1 |

## Terminal

Offered under **Settings › Terminal › Font**.

| Family | Files | Licence |
|---|---|---|
| JetBrains Mono | `jetbrainsmono-*` | SIL Open Font License 1.1 |
| Fira Code | `firacode-*` | SIL Open Font License 1.1 |
| IBM Plex Mono | `ibmplexmono-*` | SIL Open Font License 1.1 |
| Source Code Pro | `sourcecodepro-*` | SIL Open Font License 1.1 |
| Inconsolata | `inconsolata-*` | SIL Open Font License 1.1 |
| Ubuntu Mono | `ubuntumono-*` | Ubuntu Font Licence 1.0 |

`OFL.txt` is the SIL Open Font License 1.1 text covering the OFL families above.
Ubuntu Mono is distributed under the Ubuntu Font Licence 1.0
(<https://ubuntu.com/legal/font-licence>), which likewise permits redistribution
and embedding.

Ligature-capable faces (Fira Code, JetBrains Mono) render without ligatures:
xterm.js needs a separate addon for those, and it isn't usable in this webview.
