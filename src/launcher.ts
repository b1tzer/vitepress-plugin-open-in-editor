import { spawnSync } from 'node:child_process'

/**
 * 编辑器命令解析。
 *
 * 优先级（级联回退链）：
 *   1) 用户传入的 editor 选项（显式指定）
 *   2) 环境变量 LAUNCH_EDITOR（社区约定，vite-plugin-vue-inspector、vue-devtools 等都读它）
 *   3) 终端环境识别（精确判断当前 IDE 终端：VS Code / JetBrains / Remote SSH）
 *   4) 运行进程探测（轻量编辑器优先，三端兼容）
 *   5) 环境变量 VISUAL / EDITOR（POSIX 惯例）
 *   6) 默认 'code'
 *
 * 之所以自己写而不是直接依赖 `launch-editor` 包，是因为：
 *   - launch-editor 强制 stderr 输出中文/英文警告，且在 Remote SSH 场景对 code 命令的探测不完全可靠
 *   - 我们只需要一个非常小的映射表 + execFile，代码可控
 *   - 终端识别 + 进程探测只在中间件注册时同步执行一次，spawnSync 开销可接受
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

export interface EditorSpec {
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
 * 进程名/路径关键词 → EditorId 的有序映射。
 * 顺序即优先级：
 *   - 轻量编辑器（VS Code 家族 + CLI 编辑器）排在 JetBrains 重量级 IDE 之前，
 *     对齐 launch-editor / code-inspector「默认偏 VS Code」的行业惯例；
 *   - 更具体的（如 code-insiders）必须排在更宽泛的（如 code）之前，避免误吞。
 *
 * 正则统一对「已转小写」的进程列表做匹配，因此兼容三端差异：
 *   - macOS：`ps x` 输出完整命令行，含 `/Applications/xxx.app/` 路径；
 *   - Linux：`comm` 为裸进程名（code / idea / webstorm）；
 *   - Windows：镜像名带 `.exe`，JetBrains 带 `64` 后缀（idea64.exe）。
 */
const RUNNING_EDITOR_HINTS: Array<{ id: EditorId; match: RegExp }> = [
  { id: 'code-insiders', match: /code[\s-]*insiders/ },
  { id: 'code', match: /\/visual studio code\.app\/|\bcode(?:\.exe)?\b/ },
  { id: 'cursor', match: /\/cursor\.app\/|\bcursor(?:\.exe)?\b/ },
  { id: 'windsurf', match: /\bwindsurf(?:\.exe)?\b/ },
  { id: 'codium', match: /\b(?:vs)?codium(?:\.exe)?\b/ },
  { id: 'sublime', match: /subl(?:ime_text)?(?:\.exe)?/ },
  { id: 'atom', match: /\batom(?:\.exe)?\b/ },
  { id: 'nvim', match: /\bnvim(?:\.exe)?\b/ },
  { id: 'vim', match: /\b(?:g?vim)(?:\.exe)?\b/ },
  { id: 'emacs', match: /\b(?:run)?emacs(?:\.exe)?\b/ },
  { id: 'webstorm', match: /\/webstorm\.app\/|\bwebstorm(?:64)?(?:\.exe)?\b/ },
  { id: 'pycharm', match: /\/pycharm\.app\/|\bpycharm(?:64)?(?:\.exe)?\b/ },
  { id: 'phpstorm', match: /\/phpstorm\.app\/|\bphpstorm(?:64)?(?:\.exe)?\b/ },
  { id: 'goland', match: /\/goland\.app\/|\bgoland(?:64)?(?:\.exe)?\b/ },
  { id: 'rubymine', match: /\/rubymine\.app\/|\brubymine(?:64)?(?:\.exe)?\b/ },
  { id: 'idea', match: /\/intellij idea\.app\/|\bidea(?:64)?(?:\.exe)?\b/ },
  { id: 'clion', match: /\/clion\.app\/|\bclion(?:64)?(?:\.exe)?\b/ },
  { id: 'rider', match: /\/rider\.app\/|\brider(?:64)?(?:\.exe)?\b/ },
]

/** JetBrains 系列 EditorId，用于终端识别到 JetBrains 时限定进程探测范围。 */
const JETBRAINS_IDS = new Set<EditorId>([
  'webstorm',
  'pycharm',
  'phpstorm',
  'goland',
  'rubymine',
  'idea',
  'clion',
  'rider',
])

/** 获取当前运行的进程列表（已转小写）。失败或未知平台返回空串。 */
function getRunningProcessList(): string {
  let cmd: string
  let args: string[]
  if (process.platform === 'darwin') {
    // macOS：ps x 输出完整命令行（含 .app 路径），用于识别 Electron 类 IDE。
    cmd = 'ps'
    args = ['x']
  } else if (process.platform === 'linux') {
    cmd = 'ps'
    args = ['x', '--no-heading', '-o', 'comm', '--sort=comm']
  } else if (process.platform === 'win32') {
    // Windows：tasklist 输出镜像名（含 .exe），无需启动 PowerShell。
    cmd = 'tasklist'
    args = ['/FO', 'CSV', '/NH']
  } else {
    return ''
  }

  try {
    const r = spawnSync(cmd, args, { encoding: 'utf8' })
    return r.status === 0 ? r.stdout.toLowerCase() : ''
  } catch {
    return ''
  }
}

/**
 * 探测正在运行的编辑器进程。
 * 传入 'jetbrains' 时仅匹配 JetBrains 系列（用于终端识别到 JetBrains 时确定具体产品）。
 */
function detectRunningEditor(filter?: 'jetbrains'): EditorId | null {
  const list = getRunningProcessList()
  if (!list) return null
  for (const hint of RUNNING_EDITOR_HINTS) {
    if (filter === 'jetbrains' && !JETBRAINS_IDS.has(hint.id)) continue
    if (hint.match.test(list)) return hint.id
  }
  return null
}

/**
 * 终端环境识别：根据 IDE 集成终端注入的环境变量，精确判断当前所在 IDE。
 * 无法判断时返回 null，交由进程探测层兜底。
 */
function detectTerminalEditor(): EditorId | null {
  // 1. VS Code Remote SSH / WSL / Dev Container：IPC hook 最可靠（可能无 TERM_PROGRAM）。
  if (process.env.VSCODE_IPC_HOOK_CLI) return 'code'
  // 2. VS Code 集成终端（macOS / Linux / Windows 一致）。
  if (process.env.TERM_PROGRAM === 'vscode') return 'code'
  // 3. JetBrains 终端（三端值相同），但无法区分具体产品，交由进程探测确定。
  const termEmu = (process.env.TERMINAL_EMULATOR ?? '').toLowerCase()
  if (termEmu.includes('jetbrains') || termEmu.includes('jediterm')) {
    return detectRunningEditor('jetbrains') ?? 'idea'
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

export function resolveEditor(explicit?: EditorId): EditorId {
  if (explicit) return explicit
  if (process.env.LAUNCH_EDITOR) return normalizeEditor(process.env.LAUNCH_EDITOR)

  // 终端环境识别：精确判断当前 IDE 终端（VS Code / JetBrains / Remote SSH）。
  const terminal = detectTerminalEditor()
  if (terminal) return terminal

  // 进程探测：轻量编辑器优先。
  const running = detectRunningEditor()
  if (running) return running

  if (process.env.VISUAL) return normalizeEditor(process.env.VISUAL)
  if (process.env.EDITOR) return normalizeEditor(process.env.EDITOR)

  return 'code'
}

export function getEditorSpec(id: EditorId): EditorSpec {
  return EDITOR_MAP[id]
}
