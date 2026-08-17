# vitepress-plugin-open-in-editor

Hover any paragraph, code block, table or list in your VitePress site, and jump straight to the exact source line in your local editor. Works transparently in **VS Code Remote SSH**, because the CLI is executed on the remote host.

Zero-config for VS Code. Supports Cursor / Windsurf / WebStorm / IntelliJ IDEA / Vim / Neovim / Sublime / Emacs, and any editor exposed via `$LAUNCH_EDITOR`.

---

## Features

- **Hover-to-open** — hover any block element in the doc body, a floating "Edit this line" button appears; click to open the corresponding `.md` line in your editor.
- **editLink integration** — the built-in VitePress *Edit this page* link also opens the source file instead of pointing to GitHub.
- **Line-accurate** — every block-level element carries a `data-src-line` attribute injected at markdown-it render time.
- **Remote SSH friendly** — the editor command runs inside the dev server (on the remote host); VS Code Server forwards it to your local window via IPC. No `vscode://` protocol dance required.
- **Multi-editor** — VS Code, VS Code Insiders, VSCodium, Cursor, Windsurf, WebStorm, IDEA, PyCharm, PhpStorm, GoLand, RubyMine, CLion, Rider, Sublime, Atom, Vim, Vi, Neovim, Emacs.
- **Dev-only by design** — the middleware is only registered in `vitepress dev`. Production builds are unaffected.

## Install

```bash
npm i -D vitepress-plugin-open-in-editor
# or during local development in a monorepo:
npm i -D file:./packages/vitepress-plugin-open-in-editor
```

## Prerequisites

- **Node.js** >= 18
- **Vite** >= 4
- **VitePress** >= 1

`vite` and `vitepress` are peer dependencies — they must be installed in your project. If you already have a VitePress site, you're all set.

## Usage

### Recommended: one-line wrapper

```ts
// docs/.vitepress/config.mts
import { defineConfig } from 'vitepress'
import { withOpenInEditor } from 'vitepress-plugin-open-in-editor'

export default withOpenInEditor(
  defineConfig({
    base: '/my-site/', // must match VitePress `base`
    srcDir: './docs',  // optional: the plugin aligns with it automatically
    // ...your existing config, unchanged
  }),
  // The second argument is optional. The plugin auto-detects the VitePress root
  // (the parent of `.vitepress`) from the dev server, and resolves the real
  // source dir via `resolve(root, srcDir)` — no manual path to keep in sync.
  // { editor: 'cursor', hover: true, buttonText: '编辑此行' },
)
```

### Manual: full control

The wrapper above is just sugar for the manual three-piece wiring below. Use this when you need fine-grained control (e.g. switching `editLink` to point at GitHub in CI):

```ts
// docs/.vitepress/config.mts
import { defineConfig } from 'vitepress'
import { openInEditor } from 'vitepress-plugin-open-in-editor'

const ed = openInEditor({
  base: '/my-site/', // must match VitePress `base`
  // srcDir: './docs',                  // optional: defaults to '.'; relative to root, or absolute
  // editor: 'cursor',                  // optional; falls back to $LAUNCH_EDITOR / 'code'
  // hover: true,                       // enable/disable the floating button
  // buttonText: '编辑此行',
})

export default defineConfig({
  base: '/my-site/',

  markdown: {
    config: (md) => ed.markdown(md),
  },

  themeConfig: {
    editLink: {
      pattern: ed.editLinkPattern,
      text: '在编辑器中打开源文件',
    },
  },

  vite: {
    plugins: [ed.vite()],
  },
})
```

`openInEditor()` returns an object with three members you plug into VitePress config:

| Member             | Type                                                             | Where to use                      |
|--------------------|------------------------------------------------------------------|-----------------------------------|
| `ed.markdown(md)`  | `(md: markdownit) => void`                                       | `markdown.config` — injects `data-src-line` attributes          |
| `ed.vite()`         | `() => vite.Plugin`                                              | `vite.plugins` — registers `/__open-editor` middleware & client  |
| `ed.editLinkPattern` | `string`                                                       | `themeConfig.editLink.pattern` — rewrites editLink to open locally |

## How it works

```
┌──────────────────────────────────────────────────────────────────┐
│ Browser (in VS Code Simple Browser or any tab)                   │
│                                                                  │
│  hover a <p data-src-line="42">                                  │
│      │                                                           │
│      └─ show floating button                                     │
│             │ click                                              │
│             └─ fetch('/__open-editor?file=xxx.md&line=42')       │
└──────────────────────┬───────────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│ Vite dev server (on the same host as your source files)          │
│                                                                  │
│  /__open-editor middleware                                       │
│      │                                                           │
│      ├─ resolve & validate path (must be inside sourceDir)       │
│      └─ execFile('code', ['--reuse-window', '--goto',            │
│                            '/abs/path/to/xxx.md:42'])            │
└──────────────────────┬───────────────────────────────────────────┘
                       │  (VS Code Server IPC over $VSCODE_IPC_HOOK_CLI)
                       ▼
                Your local VS Code window opens xxx.md at line 42.
```

The `data-src-line` attribute is injected by a tiny markdown-it renderToken override, so it works for every block token (`p`, `h1`-`h6`, `pre`, `blockquote`, `ul`, `ol`, `li`, `table`, `tr`, ...).

## Options

| Option           | Type      | Default              | Description                                                                 |
|------------------|-----------|----------------------|-----------------------------------------------------------------------------|
| `srcDir`         | `string`  | `'.'`                | Source dir. Relative to the VitePress root (auto-detected), or absolute to override. With `withOpenInEditor`, auto-read from `config.srcDir`. |
| `base`           | `string`  | `'/'`                | Must match VitePress `config.base`. Used to reverse the current `.md` path. |
| `editor`         | `string`  | *(auto-detected)*    | Explicit editor id (see list below). Overrides auto-detection.              |
| `reuseWindow`    | `boolean` | `true`               | Pass `--reuse-window` to VS Code family.                                    |
| `endpoint`       | `string`  | `'/__open-editor'`   | Middleware mount path.                                                      |
| `hover`          | `boolean` | `true`               | Toggle the floating "Edit this line" button.                                |
| `buttonText`     | `string`  | `'编辑此行'`         | Text shown on the floating button.                                          |
| `markerProtocol` | `string`  | `'http://__vscode__/'` | Fake URL scheme used to trick VitePress SPA router. Rarely needs tweaking.  |

### Editor auto-detection

When `editor` is not set, the plugin resolves the editor automatically in this order:

```
explicit editor → LAUNCH_EDITOR → terminal detection → process detection → VISUAL → EDITOR → code
```

1. **Terminal detection** — detects the IDE the dev server is running from:
   - `VSCODE_IPC_HOOK_CLI` or `TERM_PROGRAM=vscode` → VS Code (covers Remote SSH / WSL / Dev Containers)
   - `TERMINAL_EMULATOR` containing `jetbrains` → a JetBrains IDE (WebStorm / IDEA / PyCharm / …)
2. **Process detection** — scans running processes for a known editor, preferring lightweight editors (VS Code family, Sublime, Vim, …) over JetBrains IDEs. Cross-platform (macOS / Linux / Windows).

### Supported editors

`code`, `code-insiders`, `codium`, `cursor`, `windsurf`, `webstorm`, `idea`, `pycharm`, `phpstorm`, `goland`, `rubymine`, `clion`, `rider`, `sublime`, `atom`, `vim`, `vi`, `nvim`, `emacs`.

Make sure the corresponding CLI is on your `$PATH`.

## Development

This repo ships a local VitePress playground for quickly verifying plugin changes:

```bash
npm install
npm run demo:dev     # start the playground (default http://localhost:5173)
npm run demo:build   # static build of the playground
npm run demo:preview # preview the built playground
```

The playground at `docs/` imports the plugin source directly from `src/` via a relative import in `docs/.vitepress/config.mts`, so edits to `src/` are reflected immediately without rebuilding the package.

## Caveats

1. **Dev-only.** `vitepress build` produces a static site without the `/__open-editor` endpoint. Clicks in the deployed site fail silently.
2. **Editor window binding.** In VS Code Remote SSH, `code` opens the file in whichever window owns `$VSCODE_IPC_HOOK_CLI` — that's the window that started the dev server. Switching windows won't change the target.
3. **Code blocks jump to their opening line only.** markdown-it tokens don't preserve line numbers within a fenced block.

## License

MIT
