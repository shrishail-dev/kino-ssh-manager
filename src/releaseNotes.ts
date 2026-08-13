/**
 * What's new, shown once on the unlock screen after an upgrade.
 *
 * Adding a release means adding an entry here; a version with no entry shows
 * nothing at all, which is the right behaviour for a patch release that has
 * nothing worth interrupting anyone for.
 */

export interface ReleaseNote {
  version: string;
  /** One line under the version stamp. */
  headline: string;
  items: { title: string; detail: string }[];
}

export const RELEASE_NOTES: ReleaseNote[] = [
  {
    version: "0.8.0",
    headline: "Three new tools, and a safer way to keep your keys fresh.",
    items: [
      {
        title: "Cron editor",
        detail:
          "Tools → Cron jobs reads the host's crontab and writes each schedule out in plain " +
          "English, with the next times it will actually fire. Add, edit and pause jobs " +
          "without vi. Comments and PATH= lines survive every save untouched.",
      },
      {
        title: "Key audit & rotation",
        detail:
          "Settings → Vault → Key audit checks every stored key for weak algorithms, reuse " +
          "across hosts, and age. Rotating installs a fresh ed25519 key, proves it works on a " +
          "second connection, and only then removes the old one.",
      },
      {
        title: "Copy output as an image",
        detail:
          "Select terminal output and choose Image: a PNG with the colours, bold and " +
          "highlighting intact, ready to paste into Slack or an issue.",
      },
    ],
  },
];

/** localStorage key holding the last version whose notes were acknowledged. */
const SEEN_KEY = "kino:whats-new-seen";

export function notesFor(version: string): ReleaseNote | undefined {
  return RELEASE_NOTES.find((n) => n.version === version);
}

export function markSeen(version: string): void {
  try {
    localStorage.setItem(SEEN_KEY, version);
  } catch {
    // A vault that won't persist a dismissal is not worth failing an unlock over.
  }
}

function seenVersion(): string | null {
  try {
    return localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
}

/**
 * Should the notes for `version` be shown right now?
 *
 * Two cases are deliberately silent:
 *
 * - **A fresh install.** Nothing about this release is "new" to someone who has
 *   never run an older one. The version is marked seen on the spot, which also
 *   stops the notes appearing the second time they launch - by then a vault
 *   exists, and without this they'd look exactly like an upgrading user.
 * - **A version with no entry.** Not every release has something to say.
 *
 * An upgrade from before this feature existed has no stored version but does
 * have a vault, and that is precisely the case that should see the notes.
 */
export function shouldShowNotes(version: string, vaultExists: boolean): boolean {
  if (!version || !notesFor(version)) return false;
  if (!vaultExists) {
    markSeen(version);
    return false;
  }
  return seenVersion() !== version;
}
