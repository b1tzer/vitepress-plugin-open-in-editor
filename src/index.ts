import type { Plugin, ResolvedConfig } from 'vite'
import type { UserConfig } from 'vitepress'
import { isAbsolute } from 'node:path'
import { registerOpenEditorMiddleware } from './server'
import { injectSourceLine } from './markdown'
import { buildClientScript, buildStyle } from './client'
import type { EditorId } from './launcher'
import type MarkdownIt from 'markdown-it'

export type { EditorId }

export interface OpenInEditorOptions {
  /**
   * 源文件目录覆盖项，可选，缺省为 '.'。
   *
   * VitePress 在 dev 阶段会把 Vite 的 root 直接设为「解析后的源目录」（config.srcDir 的结果），
   * 即 server.config.root 本身就是源目录。因此：
   *   - 相对路径（含缺省 '.'）一律忽略，直接使用 server.config.root，避免对已是源目录的 root
   *     再次偏移导致重复拼接（如 srcDir='./docs' 被拼成 docs/docs）；
   *   - 仅绝对路径会被原样采用，用于强制覆盖源目录。
   *
   * 一行式用法（withOpenInEditor）会自动从 config.srcDir 透传（相对路径会被忽略、直接使用
   * server.config.root），通常无需手动设置；三件套用法（openInEditor）默认 '.'。
   */
  srcDir?: string

  /**
   * 站点 base（与 VitePress 的 config.base 保持一致）。用于客户端反推当前页对应的 .md 路径。
   * 默认 '/'。
   */
  base?: string

  /**
   * 编辑器 id。未设置时按以下级联链自动探测：
   *   显式 editor → LAUNCH_EDITOR → 终端环境识别（VS Code / JetBrains / Remote SSH）
   *   → 运行进程探测（轻量编辑器优先）→ VISUAL → EDITOR → 'code'
   */
  editor?: EditorId

  /** VS Code 系列是否复用同一窗口，默认 true。 */
  reuseWindow?: boolean

  /** 中间件挂载路径，默认 '/__open-editor'。 */
  endpoint?: string

  /** 是否启用悬浮"编辑此行"浮动按钮，默认 true。 */
  hover?: boolean

  /** 悬浮按钮显示的文字，默认 '编辑此行'。 */
  buttonText?: string

  /**
   * editLink.pattern 使用的假外链协议头，默认 'http://__vscode__/'。
   * 作用是骗过 VitePress 的内部路由把 pattern 视为外链、原样输出 href，
   * 客户端脚本再拦截该 href 转为 fetch 请求。
   * 必须以 '/' 结尾（未结尾会自动补全）。一般不需要改。
   *
   * 注意：该协议头与 VS Code 无关，仅借用不存在的 http host（__vscode__）
   * 来绕过 SPA 路由；名字中的 marker 表示「占位标记」，而非 vscode 协议。
   */
  markerProtocol?: string
}

const DEFAULT_ENDPOINT = '/__open-editor'
// 「假外链」前缀：用不存在的 http 链接骗过 VitePress 内部路由，让 editLink 的
// href 被当作外链原样输出，客户端脚本再拦截该 href 转为 fetch 请求。
// 必须以 '/' 结尾 —— 客户端靠 slice(prefix.length) 剥回相对路径。
// 注意：__vscode__ 只是占位 host，与 VS Code 无关。
const DEFAULT_MARKER = 'http://__vscode__/'
const DEFAULT_BUTTON_TEXT = '编辑此行'

/**
 * 主入口：一次调用返回三块能力。
 *
 * ```ts
 * const ed = openInEditor({}) // srcDir 可省略，root 自动从 dev server 推导
 *
 * export default defineConfig({
 *   markdown: { config: (md) => ed.markdown(md) },
 *   themeConfig: {
 *     editLink: { pattern: ed.editLinkPattern, text: '在编辑器中打开源文件' },
 *   },
 *   vite: { plugins: [ed.vite()] },
 * })
 * ```
 */
export function openInEditor(options: OpenInEditorOptions) {
  const {
    srcDir = '.',
    base = '/',
    editor,
    reuseWindow = true,
    endpoint = DEFAULT_ENDPOINT,
    hover = true,
    buttonText = DEFAULT_BUTTON_TEXT,
    markerProtocol = DEFAULT_MARKER,
  } = options

  // 归一化 markerProtocol：必须以 '/' 结尾，否则客户端 slice 会多出前导斜杠导致路径错误。
  const marker = markerProtocol.endsWith('/') ? markerProtocol : `${markerProtocol}/`

  // 最终源文件目录需等到 configureServer 阶段才能确定（依赖 server.config.root），
  // 这里只保存推导函数，避免在配置阶段过早求值。
  // VitePress 已把 server.config.root 设为「解析后的源目录」，root 本身就是源目录：
  //   - 相对路径（含缺省 '.'）一律忽略，直接返回 root，避免对源目录再次偏移（如 './docs' 被拼成 'docs/docs'）；
  //   - 仅绝对路径保留「强制覆盖源目录」能力，原样返回 srcDir。
  const resolveSourceDir = (root: string): string => (isAbsolute(srcDir) ? srcDir : root)

  const clientCfg = { base, endpoint, markerProtocol: marker, buttonText, hover }

  return {
    /**
     * editLink.pattern 值，直接塞进 themeConfig.editLink.pattern 即可。
     * 之所以要求用户手动填而不是自动注入，是因为 CI 环境常需要切换成 GitHub 编辑链接，
     * 保留手动组装的灵活性。
     */
    editLinkPattern: `${marker}:path` as const,

    /**
     * markdown-it 插件。在 VitePress 的 markdown.config 中调用一次：
     *   markdown: { config: (md) => ed.markdown(md) }
     */
    markdown: injectSourceLine,

    /**
     * Vite 插件。同时负责：
     *   - dev 模式挂载 /__open-editor 中间件
     *   - transformIndexHtml 注入客户端脚本 + 样式
     *   - build 模式给出提示（端点仅在 dev 存在）
     */
    vite(): Plugin {
      let resolvedConfig: ResolvedConfig | null = null

      return {
        name: 'vitepress-plugin-open-in-editor',
        apply: () => true, // dev 和 build 都要挂 transformIndexHtml，build 时脚本无害

        configResolved(cfg) {
          resolvedConfig = cfg
        },

        configureServer(server) {
          const finalSourceDir = resolveSourceDir(server.config.root)
          registerOpenEditorMiddleware(server, {
            sourceDir: finalSourceDir,
            endpoint,
            editor,
            reuseWindow,
          })
          server.config.logger.info(
            `\n  ➜  open-in-editor: hover paragraphs to jump into your editor` +
              `\n     endpoint : ${endpoint}` +
              `\n     sourceDir: ${finalSourceDir}\n`,
          )
        },

        transformIndexHtml() {
          // build 阶段也注入客户端脚本无害，但它请求的 endpoint 在生产环境不存在，
          // 会静默失败。所以生产构建时打一条提示。
          if (resolvedConfig && resolvedConfig.command === 'build') {
            console.info(
              '[open-in-editor] Production build detected: ' +
                `the "${endpoint}" endpoint only works in dev mode; ` +
                'the injected client script will silently fail in the deployed site.',
            )
          }
          return [
            {
              tag: 'style',
              attrs: { 'data-open-in-editor': '' },
              children: buildStyle(),
              injectTo: 'head',
            },
            {
              tag: 'script',
              attrs: { 'data-open-in-editor': '' },
              children: buildClientScript(clientCfg),
              injectTo: 'body',
            },
          ]
        },
      }
    },
  }
}

/**
 * 一行式 wrapper 入口：包装一份 VitePress 配置，自动注入 markdown / vite / editLink。
 *
 * 与 `openInEditor` 三件套基本等价，但把三处接线收拢成一次调用，适合绝大多数场景。
 * 额外提供 **srcDir 自动对齐 + 零配置**：root 自动取 dev server（VitePress 已将其设为
 * 解析后的源目录），插件直接使用 server.config.root，无需用户手动保持一致。
 *
 * ```ts
 * import { withOpenInEditor } from 'vitepress-plugin-open-in-editor'
 *
 * export default withOpenInEditor(
 *   defineConfig({
 *     srcDir: './docs', // 插件自动使用 server.config.root（已是解析后的源目录），无需再叠加 srcDir
 *     // ...原有配置，完全不动
 *   }),
 *   // 第二个参数可整体省略；如需要可传 base / editor / hover 等选项
 * )
 * ```
 *
 * 注入规则（均为「安全合并」，不覆盖用户已有配置）：
 *   1. `markdown.config`：先执行用户原有 config，再执行 `injectSourceLine`
 *   2. `vite.plugins`：在现有插件列表末尾追加 `ed.vite()`
 *   3. `themeConfig.editLink.pattern`：仅在用户未设置时注入 `ed.editLinkPattern`，
 *      已存在的 `editLink.text` 原样保留
 */
export function withOpenInEditor(
  config: UserConfig,
  options: OpenInEditorOptions = {},
): UserConfig {
  // 自动对齐 VitePress 的 srcDir：把 config.srcDir 透传给 openInEditor。
  // 相对路径（如 './docs'）会在 resolveSourceDir 中被忽略、直接使用 server.config.root，
  // 仅当显式传入绝对路径时才用于强制覆盖源目录。
  const ed = openInEditor({ ...options, srcDir: options.srcDir ?? config.srcDir ?? '.' })

  // 1. markdown.config 安全合并
  const prevMarkdownConfig = config.markdown?.config
  const markdown: UserConfig['markdown'] = {
    ...config.markdown,
    config(md: MarkdownIt) {
      prevMarkdownConfig?.(md)
      ed.markdown(md)
    },
  }

  // 2. vite.plugins 追加
  // 注：vitepress 1.x 内置 vite@5，与项目根 vite@8 存在类型差异，
  // 用断言绕过版本冲突（运行时 vite 由 vitepress 决定）。
  const prevVite = config.vite ?? {}
  const prevPlugins = Array.isArray(prevVite.plugins) ? prevVite.plugins : []
  const vite = {
    ...prevVite,
    plugins: [...prevPlugins, ed.vite()],
  } as UserConfig['vite']

  // 3. themeConfig.editLink.pattern 注入（不覆盖已有 pattern / text）
  // themeConfig 泛型默认 any，此处仅对 editLink 做局部断言，属于 VitePress 类型边界。
  const themeConfig = (config.themeConfig ?? {}) as Record<string, any>
  const editLink = themeConfig.editLink as { pattern?: string } | undefined
  if (!editLink) {
    themeConfig.editLink = { pattern: ed.editLinkPattern }
  } else if (!editLink.pattern) {
    themeConfig.editLink = { ...editLink, pattern: ed.editLinkPattern }
  }

  return {
    ...config,
    markdown,
    vite,
    themeConfig,
  }
}

export default openInEditor
