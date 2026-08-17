import { spawnSync } from 'node:child_process'

/**
 * 编辑器命令解析。
 *
 * 优先级（向 launch-editor 对齐的级联回退链）：
 *   1) 用户传入的 editor 选项（显式指定）
 *   2) 环境变量 LAUNCH_EDITOR（社区约定，vite-plugin-vue-inspector、vue-devtools 等都读它）
 *   3) 运行进程探测（优先命中正在运行的编辑器，如 vscode/cursor/webstorm）
 *   4) 环境变量 VISUAL / EDITOR（POSIX 惯例）
 *   5) 默认 'code'
 *
 * 之所以自己写而不是直接依赖 `launch-editor` 包，是因为：
 *   - launch-editor 强制 stderr 输出中文/英文警告，且在 Remote SSH 场景对 code 命令的探测不完全可靠
 *   - 我们只需要一个非常小的映射表 + execFile，代码可控
 *   - 进程探测只在中间件注册时同步执行一次，spawnSync 开销可接受
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
  | 'vi'
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
  vi: {
    cmd: 'vi',
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

/**
 * 进程名关键词 → EditorId 的有序映射。
 * 顺序即优先级：更具体的（如 code-insiders）必须排在更宽泛的（如 code）之前，
 * 避免 `code` 的 \b 边界误吞 code-insiders。
 */
const RUNNING_EDITOR_HINTS: Array<{ id: EditorId; match: RegExp }> = [
  { id: 'code-insiders', match: /code-insiders/i },
  { id: 'cursor', match: /\bcursor\b/i },
  { id: 'windsurf', match: /\bwindsurf\b/i },
  { id: 'codium', match: /\bcodium\b/i },
  { id: 'webstorm', match: /\bwebstorm\b/i },
  { id: 'pycharm', match: /\bpycharm\b/i },
  { id: 'phpstorm', match: /\bphpstorm\b/i },
  { id: 'goland', match: /\bgoland\b/i },
  { id: 'rubymine', match: /\brubymine\b/i },
  { id: 'idea', match: /\bidea\b/i },
  { id: 'clion', match: /\bclion\b/i },
  { id: 'rider', match: /\brider\b/i },
  { id: 'sublime', match: /subl(ime_text)?/i },
  { id: 'atom', match: /\batom\b/i },
  { id: 'nvim', match: /\bnvim\b/i },
  { id: 'vim', match: /\bvim\b/i },
  { id: 'emacs', match: /\bemacs\b/i },
  { id: 'code', match: /\bcode\b/i },
]

/** 获取当前运行的进程命令名列表。失败或非 unix 平台返回空串。 */
function getRunningProcessList(): string {
  // 本项目核心场景是 VS Code Remote SSH（远端为 Linux/macOS），
  // Windows 本地跳过探测，交给环境变量 / 默认值。
  if (process.platform !== 'darwin' && process.platform !== 'linux') return ''

  const args =
    process.platform === 'darwin'
      ? ['x', '-o', 'comm=']
      : ['x', '--no-heading', '-o', 'comm', '--sort=comm']

  try {
    const r = spawnSync('ps', args, { encoding: 'utf8' })
    return r.status === 0 ? r.stdout : ''
  } catch {
    return ''
  }
}

/** 探测正在运行的编辑器进程，返回命中的 EditorId，未命中返回 null。 */
function detectRunningEditor(): EditorId | null {
  const list = getRunningProcessList()
  if (!list) return null
  for (const hint of RUNNING_EDITOR_HINTS) {
    if (hint.match.test(list)) return hint.id
  }
  return null
}

/** 将候选字符串归一化为已知 EditorId，未知时回退到 code。 */
function normalizeEditor(candidate: string): EditorId {
  if ((EDITOR_MAP as Record<string, unknown>)[candidate]) {
    return candidate as EditorId
  }
  // 不识别的编辑器 id 一律回退到 code，避免执行不存在的命令。
  console.warn(
    `[open-in-editor] Unknown editor "${candidate}", falling back to "code".`,
  )
  return 'code'
}

export function resolveEditor(explicit?: string): EditorId {
  if (explicit) return normalizeEditor(explicit)
  if (process.env.LAUNCH_EDITOR) return normalizeEditor(process.env.LAUNCH_EDITOR)

  const running = detectRunningEditor()
  if (running) return running

  if (process.env.VISUAL) return normalizeEditor(process.env.VISUAL)
  if (process.env.EDITOR) return normalizeEditor(process.env.EDITOR)

  return 'code'
}

export function getEditorSpec(id: EditorId): EditorSpec {
  return EDITOR_MAP[id]
}
