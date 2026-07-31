export interface TermTheme {
  background: string; foreground: string;
  cursor: string; cursorAccent: string;
  black: string; red: string; green: string; yellow: string;
  blue: string; magenta: string; cyan: string; white: string;
  brightBlack: string; brightRed: string; brightGreen: string; brightYellow: string;
  brightBlue: string; brightMagenta: string; brightCyan: string; brightWhite: string;
}

export interface Theme {
  id: string;
  name: string;
  dark: boolean;
  ui: {
    bg: string; surface: string; overlay: string;
    muted: string; subtle: string; text: string; subtext: string;
    blue: string; green: string; red: string; yellow: string; mauve: string;
    btnPrimaryFg: string;
  };
  term: TermTheme;
}

export const THEMES: Theme[] = [
  // The house theme, shared with the kino-control web UI ("Kino Projection").
  // Two inks on bitumen black: unbleached paper and one scarce vermilion.
  // Verdigris and marigold exist only to carry status that red and cream can't.
  {
    id: "kino-projection",
    name: "Kino Projection",
    dark: true,
    ui: {
      bg: "#100d0b", surface: "#191411", overlay: "#241d19",
      muted: "#352c26", subtle: "#857a6d", text: "#ede3d2", subtext: "#b8ac9b",
      // `blue` is the accent slot the chrome reads from - here it's vermilion.
      blue: "#e5452b", green: "#63b39a", red: "#e5452b", yellow: "#e0a13c", mauve: "#7f97bd",
      btnPrimaryFg: "#100d0b",
    },
    term: {
      background: "#100d0b", foreground: "#ede3d2",
      cursor: "#e5452b", cursorAccent: "#100d0b",
      black: "#352c26", red: "#e5452b", green: "#63b39a", yellow: "#e0a13c",
      blue: "#7f97bd", magenta: "#c08497", cyan: "#7fb5ab", white: "#c9bfae",
      brightBlack: "#574a41", brightRed: "#f2664c", brightGreen: "#7fc9b0", brightYellow: "#f0b95a",
      brightBlue: "#9db3d4", brightMagenta: "#d3a0ae", brightCyan: "#9acdc3", brightWhite: "#ede3d2",
    },
  },
  {
    id: "catppuccin-mocha",
    name: "Catppuccin Mocha",
    dark: true,
    ui: {
      bg: "#1e1e2e", surface: "#181825", overlay: "#313244",
      muted: "#45475a", subtle: "#6c7086", text: "#cdd6f4", subtext: "#a6adc8",
      blue: "#89b4fa", green: "#a6e3a1", red: "#f38ba8", yellow: "#f9e2af", mauve: "#cba6f7",
      btnPrimaryFg: "#1e1e2e",
    },
    term: {
      background: "#1e1e2e", foreground: "#cdd6f4",
      cursor: "#f5e0dc", cursorAccent: "#1e1e2e",
      black: "#45475a", red: "#f38ba8", green: "#a6e3a1", yellow: "#f9e2af",
      blue: "#89b4fa", magenta: "#f5c2e7", cyan: "#94e2d5", white: "#bac2de",
      brightBlack: "#585b70", brightRed: "#f38ba8", brightGreen: "#a6e3a1", brightYellow: "#f9e2af",
      brightBlue: "#89b4fa", brightMagenta: "#f5c2e7", brightCyan: "#94e2d5", brightWhite: "#a6adc8",
    },
  },
  {
    id: "catppuccin-latte",
    name: "Catppuccin Latte",
    dark: false,
    ui: {
      bg: "#eff1f5", surface: "#e6e9ef", overlay: "#ccd0da",
      muted: "#bcc0cc", subtle: "#9ca0b0", text: "#4c4f69", subtext: "#5c5f77",
      blue: "#1e66f5", green: "#40a02b", red: "#d20f39", yellow: "#df8e1d", mauve: "#8839ef",
      btnPrimaryFg: "#ffffff",
    },
    term: {
      background: "#eff1f5", foreground: "#4c4f69",
      cursor: "#dc8a78", cursorAccent: "#eff1f5",
      black: "#5c5f77", red: "#d20f39", green: "#40a02b", yellow: "#df8e1d",
      blue: "#1e66f5", magenta: "#ea76cb", cyan: "#179299", white: "#acb0be",
      brightBlack: "#6c6f85", brightRed: "#d20f39", brightGreen: "#40a02b", brightYellow: "#df8e1d",
      brightBlue: "#1e66f5", brightMagenta: "#ea76cb", brightCyan: "#179299", brightWhite: "#bcc0cc",
    },
  },
  {
    id: "dracula",
    name: "Dracula",
    dark: true,
    ui: {
      bg: "#282a36", surface: "#21222c", overlay: "#44475a",
      muted: "#373844", subtle: "#6272a4", text: "#f8f8f2", subtext: "#d8d8d2",
      blue: "#8be9fd", green: "#50fa7b", red: "#ff5555", yellow: "#ffb86c", mauve: "#bd93f9",
      btnPrimaryFg: "#282a36",
    },
    term: {
      background: "#282a36", foreground: "#f8f8f2",
      cursor: "#f8f8f0", cursorAccent: "#282a36",
      black: "#21222c", red: "#ff5555", green: "#50fa7b", yellow: "#f1fa8c",
      blue: "#bd93f9", magenta: "#ff79c6", cyan: "#8be9fd", white: "#f8f8f2",
      brightBlack: "#6272a4", brightRed: "#ff6e6e", brightGreen: "#69ff94", brightYellow: "#ffffa5",
      brightBlue: "#d6acff", brightMagenta: "#ff92df", brightCyan: "#a4ffff", brightWhite: "#ffffff",
    },
  },
  {
    id: "tokyo-night",
    name: "Tokyo Night",
    dark: true,
    ui: {
      bg: "#1a1b26", surface: "#16161e", overlay: "#292e42",
      muted: "#3b4261", subtle: "#565f89", text: "#c0caf5", subtext: "#9aa5ce",
      blue: "#7aa2f7", green: "#9ece6a", red: "#f7768e", yellow: "#e0af68", mauve: "#bb9af7",
      btnPrimaryFg: "#1a1b26",
    },
    term: {
      background: "#1a1b26", foreground: "#c0caf5",
      cursor: "#c0caf5", cursorAccent: "#1a1b26",
      black: "#15161e", red: "#f7768e", green: "#9ece6a", yellow: "#e0af68",
      blue: "#7aa2f7", magenta: "#bb9af7", cyan: "#7dcfff", white: "#acb0d0",
      brightBlack: "#414868", brightRed: "#f7768e", brightGreen: "#9ece6a", brightYellow: "#e0af68",
      brightBlue: "#7aa2f7", brightMagenta: "#bb9af7", brightCyan: "#7dcfff", brightWhite: "#c0caf5",
    },
  },
  {
    id: "nord",
    name: "Nord",
    dark: true,
    ui: {
      bg: "#2e3440", surface: "#3b4252", overlay: "#434c5e",
      muted: "#4c566a", subtle: "#616e88", text: "#eceff4", subtext: "#d8dee9",
      blue: "#81a1c1", green: "#a3be8c", red: "#bf616a", yellow: "#ebcb8b", mauve: "#b48ead",
      btnPrimaryFg: "#2e3440",
    },
    term: {
      background: "#2e3440", foreground: "#eceff4",
      cursor: "#d8dee9", cursorAccent: "#2e3440",
      black: "#3b4252", red: "#bf616a", green: "#a3be8c", yellow: "#ebcb8b",
      blue: "#81a1c1", magenta: "#b48ead", cyan: "#88c0d0", white: "#e5e9f0",
      brightBlack: "#4c566a", brightRed: "#bf616a", brightGreen: "#a3be8c", brightYellow: "#ebcb8b",
      brightBlue: "#81a1c1", brightMagenta: "#b48ead", brightCyan: "#8fbcbb", brightWhite: "#eceff4",
    },
  },
  {
    id: "gruvbox-dark",
    name: "Gruvbox Dark",
    dark: true,
    ui: {
      bg: "#282828", surface: "#1d2021", overlay: "#3c3836",
      muted: "#504945", subtle: "#665c54", text: "#ebdbb2", subtext: "#d5c4a1",
      blue: "#83a598", green: "#b8bb26", red: "#fb4934", yellow: "#fabd2f", mauve: "#d3869b",
      btnPrimaryFg: "#282828",
    },
    term: {
      background: "#282828", foreground: "#ebdbb2",
      cursor: "#fbf1c7", cursorAccent: "#282828",
      black: "#3c3836", red: "#cc241d", green: "#98971a", yellow: "#d79921",
      blue: "#458588", magenta: "#b16286", cyan: "#689d6a", white: "#a89984",
      brightBlack: "#928374", brightRed: "#fb4934", brightGreen: "#b8bb26", brightYellow: "#fabd2f",
      brightBlue: "#83a598", brightMagenta: "#d3869b", brightCyan: "#8ec07c", brightWhite: "#ebdbb2",
    },
  },
  {
    id: "solarized-dark",
    name: "Solarized Dark",
    dark: true,
    ui: {
      bg: "#002b36", surface: "#073642", overlay: "#0a4653",
      muted: "#586e75", subtle: "#657b83", text: "#839496", subtext: "#93a1a1",
      blue: "#268bd2", green: "#859900", red: "#dc322f", yellow: "#b58900", mauve: "#6c71c4",
      btnPrimaryFg: "#002b36",
    },
    term: {
      background: "#002b36", foreground: "#839496",
      cursor: "#93a1a1", cursorAccent: "#002b36",
      black: "#073642", red: "#dc322f", green: "#859900", yellow: "#b58900",
      blue: "#268bd2", magenta: "#d33682", cyan: "#2aa198", white: "#eee8d5",
      brightBlack: "#586e75", brightRed: "#cb4b16", brightGreen: "#586e75", brightYellow: "#657b83",
      brightBlue: "#839496", brightMagenta: "#6c71c4", brightCyan: "#93a1a1", brightWhite: "#fdf6e3",
    },
  },
  {
    id: "solarized-light",
    name: "Solarized Light",
    dark: false,
    ui: {
      bg: "#fdf6e3", surface: "#eee8d5", overlay: "#d9d2b8",
      muted: "#93a1a1", subtle: "#839496", text: "#657b83", subtext: "#586e75",
      blue: "#268bd2", green: "#859900", red: "#dc322f", yellow: "#b58900", mauve: "#6c71c4",
      btnPrimaryFg: "#ffffff",
    },
    term: {
      background: "#fdf6e3", foreground: "#657b83",
      cursor: "#586e75", cursorAccent: "#fdf6e3",
      black: "#073642", red: "#dc322f", green: "#859900", yellow: "#b58900",
      blue: "#268bd2", magenta: "#d33682", cyan: "#2aa198", white: "#eee8d5",
      brightBlack: "#586e75", brightRed: "#cb4b16", brightGreen: "#586e75", brightYellow: "#657b83",
      brightBlue: "#839496", brightMagenta: "#6c71c4", brightCyan: "#93a1a1", brightWhite: "#fdf6e3",
    },
  },
  {
    id: "one-dark",
    name: "One Dark",
    dark: true,
    ui: {
      bg: "#282c34", surface: "#21252b", overlay: "#3b4048",
      muted: "#4b5263", subtle: "#5c6370", text: "#abb2bf", subtext: "#9da5b4",
      blue: "#61afef", green: "#98c379", red: "#e06c75", yellow: "#e5c07b", mauve: "#c678dd",
      btnPrimaryFg: "#282c34",
    },
    term: {
      background: "#282c34", foreground: "#abb2bf",
      cursor: "#528bff", cursorAccent: "#282c34",
      black: "#282c34", red: "#e06c75", green: "#98c379", yellow: "#d19a66",
      blue: "#61afef", magenta: "#c678dd", cyan: "#56b6c2", white: "#abb2bf",
      brightBlack: "#5c6370", brightRed: "#e06c75", brightGreen: "#98c379", brightYellow: "#e5c07b",
      brightBlue: "#61afef", brightMagenta: "#c678dd", brightCyan: "#56b6c2", brightWhite: "#ffffff",
    },
  },
  {
    id: "monokai-pro",
    name: "Monokai Pro",
    dark: true,
    ui: {
      bg: "#2d2a2e", surface: "#221f22", overlay: "#403e41",
      muted: "#5b595c", subtle: "#727072", text: "#fcfcfa", subtext: "#c1c0c0",
      blue: "#78dce8", green: "#a9dc76", red: "#ff6188", yellow: "#ffd866", mauve: "#ab9df2",
      btnPrimaryFg: "#2d2a2e",
    },
    term: {
      background: "#2d2a2e", foreground: "#fcfcfa",
      cursor: "#fcfcfa", cursorAccent: "#2d2a2e",
      black: "#403e41", red: "#ff6188", green: "#a9dc76", yellow: "#ffd866",
      blue: "#fc9867", magenta: "#ab9df2", cyan: "#78dce8", white: "#fcfcfa",
      brightBlack: "#727072", brightRed: "#ff6188", brightGreen: "#a9dc76", brightYellow: "#ffd866",
      brightBlue: "#fc9867", brightMagenta: "#ab9df2", brightCyan: "#78dce8", brightWhite: "#fcfcfa",
    },
  },
  {
    id: "rose-pine",
    name: "Rosé Pine",
    dark: true,
    ui: {
      bg: "#191724", surface: "#1f1d2e", overlay: "#26233a",
      muted: "#403d52", subtle: "#6e6a86", text: "#e0def4", subtext: "#908caa",
      blue: "#9ccfd8", green: "#31748f", red: "#eb6f92", yellow: "#f6c177", mauve: "#c4a7e7",
      btnPrimaryFg: "#191724",
    },
    term: {
      background: "#191724", foreground: "#e0def4",
      cursor: "#e0def4", cursorAccent: "#191724",
      black: "#26233a", red: "#eb6f92", green: "#31748f", yellow: "#f6c177",
      blue: "#9ccfd8", magenta: "#c4a7e7", cyan: "#ebbcba", white: "#e0def4",
      brightBlack: "#6e6a86", brightRed: "#eb6f92", brightGreen: "#31748f", brightYellow: "#f6c177",
      brightBlue: "#9ccfd8", brightMagenta: "#c4a7e7", brightCyan: "#ebbcba", brightWhite: "#e0def4",
    },
  },
  {
    id: "everforest-dark",
    name: "Everforest Dark",
    dark: true,
    ui: {
      bg: "#2d353b", surface: "#232a2e", overlay: "#343f44",
      muted: "#4f5b58", subtle: "#859289", text: "#d3c6aa", subtext: "#9da9a0",
      blue: "#7fbbb3", green: "#a7c080", red: "#e67e80", yellow: "#dbbc7f", mauve: "#d699b6",
      btnPrimaryFg: "#2d353b",
    },
    term: {
      background: "#2d353b", foreground: "#d3c6aa",
      cursor: "#d3c6aa", cursorAccent: "#2d353b",
      black: "#343f44", red: "#e67e80", green: "#a7c080", yellow: "#dbbc7f",
      blue: "#7fbbb3", magenta: "#d699b6", cyan: "#83c092", white: "#d3c6aa",
      brightBlack: "#859289", brightRed: "#e67e80", brightGreen: "#a7c080", brightYellow: "#dbbc7f",
      brightBlue: "#7fbbb3", brightMagenta: "#d699b6", brightCyan: "#83c092", brightWhite: "#d3c6aa",
    },
  },
  {
    id: "ayu-mirage",
    name: "Ayu Mirage",
    dark: true,
    ui: {
      bg: "#1f2430", surface: "#191e2a", overlay: "#33415e",
      muted: "#404a5c", subtle: "#707a8c", text: "#cbccc6", subtext: "#b8cfe6",
      blue: "#73d0ff", green: "#87d96c", red: "#f28779", yellow: "#ffd580", mauve: "#d4bfff",
      btnPrimaryFg: "#1f2430",
    },
    term: {
      background: "#1f2430", foreground: "#cbccc6",
      cursor: "#ffcc66", cursorAccent: "#1f2430",
      black: "#191e2a", red: "#f28779", green: "#87d96c", yellow: "#ffd173",
      blue: "#73d0ff", magenta: "#d4bfff", cyan: "#95e6cb", white: "#c7c7c7",
      brightBlack: "#686868", brightRed: "#f28779", brightGreen: "#a6cc70", brightYellow: "#ffd580",
      brightBlue: "#73d0ff", brightMagenta: "#d4bfff", brightCyan: "#95e6cb", brightWhite: "#ffffff",
    },
  },
  {
    id: "github-light",
    name: "GitHub Light",
    dark: false,
    ui: {
      bg: "#ffffff", surface: "#f6f8fa", overlay: "#eaeef2",
      muted: "#d0d7de", subtle: "#6e7781", text: "#24292f", subtext: "#57606a",
      blue: "#0969da", green: "#1a7f37", red: "#cf222e", yellow: "#9a6700", mauve: "#8250df",
      btnPrimaryFg: "#ffffff",
    },
    term: {
      background: "#ffffff", foreground: "#24292f",
      cursor: "#24292f", cursorAccent: "#ffffff",
      black: "#24292e", red: "#cf222e", green: "#1a7f37", yellow: "#9a6700",
      blue: "#0969da", magenta: "#8250df", cyan: "#1b7c83", white: "#6e7781",
      brightBlack: "#57606a", brightRed: "#a40e26", brightGreen: "#1a7f37", brightYellow: "#633c01",
      brightBlue: "#218bff", brightMagenta: "#a475f9", brightCyan: "#3192aa", brightWhite: "#24292f",
    },
  },
];

export function applyTheme(theme: Theme): void {
  const r = document.documentElement.style;
  const u = theme.ui;
  // Polarity hook for the rules that can't be written from the ink slots alone
  // - a shadow mixed from --bg is invisible on a light theme, and a scrim mixed
  // from a white --bg doesn't dim anything. See "Polarity" in index.css.
  document.documentElement.dataset.themeDark = theme.dark ? "1" : "0";
  r.setProperty("--bg", u.bg);
  r.setProperty("--surface", u.surface);
  r.setProperty("--overlay", u.overlay);
  r.setProperty("--muted", u.muted);
  r.setProperty("--subtle", u.subtle);
  r.setProperty("--text", u.text);
  r.setProperty("--subtext", u.subtext);
  r.setProperty("--blue", u.blue);
  r.setProperty("--green", u.green);
  r.setProperty("--red", u.red);
  r.setProperty("--yellow", u.yellow);
  r.setProperty("--mauve", u.mauve);
  r.setProperty("--btn-primary-fg", u.btnPrimaryFg);
}
