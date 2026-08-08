/**
 * 编辑器命令解析。
 *
 * 优先级：
 *   1) 用户传入的 editor 选项（显式指定）
 *   2) 环境变量 LAUNCH_EDITOR（社区约定，vite-plugin-vue-inspector、vue-devtools 等都读它）
 *   3) 环境变量 VISUAL / EDITOR（POSIX 惯例）
 *   4) 默认 'code'
 *
 * 之所以自己写而不是直接依赖 `launch-editor` 包，是因为：
 *   - launch-editor 强制 stderr 输出中文/英文警告，且在 Remote SSH 场景对 code 命令的探测不完全可靠
 *   - 我们只需要一个非常小的映射表 + execFile，代码可控
 *   - 未来若需要更强能力（自动探测已启动的 IDE 进程），再切换到 launch-editor 也很容易
 */

export type EditorId =
  | 'code'
  | 'code-insiders'
  | 'codium'
  | 'cursor'
  | 'windsurf'
  | 'webstorm'
  | 'idea'
  | 'pycharm'
  | 'phpstorm'
  | 'goland'
  | 'rubymine'
  | 'clion'
  | 'rider'
  | 'sublime'
  | 'atom'
  | 'vim'
  | 'nvim'
  | 'emacs'

interface EditorSpec {
  /** 命令行可执行名（要能在 PATH 中找到） */
  cmd: string
  /** 组装 argv 的方式。line=0 表示不带行号。 */
  buildArgs(file: string, line: number, opts: { reuseWindow: boolean }): string[]
}

const CODE_LIKE = (cmd: string): EditorSpec => ({
  cmd,
  buildArgs(file, line, { reuseWindow }) {
    const args: string[] = []
    if (reuseWindow) args.push('--reuse-window')
    args.push('--goto', line > 0 ? `${file}:${line}` : file)
    return args
  },
})

const JETBRAINS = (cmd: string): EditorSpec => ({
  cmd,
  // JetBrains CLI 语法：<cmd> --line <line> <file>
  buildArgs(file, line) {
    return line > 0 ? ['--line', String(line), file] : [file]
  },
})

const EDITOR_MAP: Record<EditorId, EditorSpec> = {
  code: CODE_LIKE('code'),
  'code-insiders': CODE_LIKE('code-insiders'),
  codium: CODE_LIKE('codium'),
  cursor: CODE_LIKE('cursor'),
  windsurf: CODE_LIKE('windsurf'),

  webstorm: JETBRAINS('webstorm'),
  idea: JETBRAINS('idea'),
  pycharm: JETBRAINS('pycharm'),
  phpstorm: JETBRAINS('phpstorm'),
  goland: JETBRAINS('goland'),
  rubymine: JETBRAINS('rubymine'),
  clion: JETBRAINS('clion'),
  rider: JETBRAINS('rider'),

  sublime: {
    cmd: 'subl',
    buildArgs: (file, line) => [line > 0 ? `${file}:${line}` : file],
  },
  atom: {
    cmd: 'atom',
    buildArgs: (file, line) => [line > 0 ? `${file}:${line}` : file],
  },
  vim: {
    cmd: 'vim',
    buildArgs: (file, line) => (line > 0 ? [`+${line}`, file] : [file]),
  },
  nvim: {
    cmd: 'nvim',
    buildArgs: (file, line) => (line > 0 ? [`+${line}`, file] : [file]),
  },
  emacs: {
    cmd: 'emacs',
    buildArgs: (file, line) => (line > 0 ? [`+${line}`, file] : [file]),
  },
}

export function resolveEditor(explicit?: string): EditorId {
  const candidate =
    explicit ||
    process.env.LAUNCH_EDITOR ||
    process.env.VISUAL ||
    process.env.EDITOR ||
    'code'

  if ((EDITOR_MAP as Record<string, unknown>)[candidate]) {
    return candidate as EditorId
  }
  // 不识别的编辑器 id 一律回退到 code，避免执行不存在的命令。
  console.warn(
    `[open-in-editor] Unknown editor "${candidate}", falling back to "code".`,
  )
  return 'code'
}

export function getEditorSpec(id: EditorId): EditorSpec {
  return EDITOR_MAP[id]
}
