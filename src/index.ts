import type { Plugin, ResolvedConfig } from 'vite'
import { registerOpenEditorMiddleware } from './server'
import { injectSourceLine } from './markdown'
import { buildClientScript, buildStyle } from './client'

export type { EditorId } from './launcher'

export interface OpenInEditorOptions {
  /**
   * 文档根目录的绝对路径。所有可打开的文件必须落在该目录下。
   * 强烈建议使用 `resolve(dirname(fileURLToPath(import.meta.url)), '..')` 动态推导，
   * 避免硬编码导致的跨机器/跨环境失效。
   */
  docsDir: string

  /**
   * 站点 base（与 VitePress 的 config.base 保持一致）。用于客户端反推当前页对应的 .md 路径。
   * 默认 '/'。
   */
  base?: string

  /** 编辑器 id。未设置时按 LAUNCH_EDITOR → VISUAL → EDITOR → 'code' 的顺序解析。 */
  editor?: string

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
   * 一般不需要改。
   */
  markerProtocol?: string
}

const DEFAULT_ENDPOINT = '/__open-editor'
const DEFAULT_MARKER = 'http://__vscode__/'
const DEFAULT_BUTTON_TEXT = '编辑此行'

/**
 * 主入口：一次调用返回三块能力。
 *
 * ```ts
 * const ed = openInEditor({ docsDir: resolve(__dirname, '..') })
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
    docsDir,
    base = '/',
    editor,
    reuseWindow = true,
    endpoint = DEFAULT_ENDPOINT,
    hover = true,
    buttonText = DEFAULT_BUTTON_TEXT,
    markerProtocol = DEFAULT_MARKER,
  } = options

  if (!docsDir) {
    throw new Error('[open-in-editor] `docsDir` is required (absolute path).')
  }

  const clientCfg = { base, endpoint, markerProtocol, buttonText, hover }

  return {
    /**
     * editLink.pattern 值，直接塞进 themeConfig.editLink.pattern 即可。
     * 之所以要求用户手动填而不是自动注入，是因为 CI 环境常需要切换成 GitHub 编辑链接，
     * 保留手动组装的灵活性。
     */
    editLinkPattern: `${markerProtocol}:path` as const,

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
          registerOpenEditorMiddleware(server, {
            docsDir,
            endpoint,
            editor,
            reuseWindow,
          })
          server.config.logger.info(
            `\n  ➜  open-in-editor: hover paragraphs to jump into your editor` +
              `\n     endpoint: ${endpoint}` +
              `\n     docsDir : ${docsDir}\n`,
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
 * 与 `openInEditor` 三件套完全等价，但把三处接线收拢成一次调用，适合绝大多数场景：
 *
 * ```ts
 * import { withOpenInEditor } from 'vitepress-plugin-open-in-editor'
 *
 * export default withOpenInEditor(
 *   defineConfig({
 *     // ...原有配置，完全不动
 *   }),
 *   { docsDir: resolve(dirname(fileURLToPath(import.meta.url)), '..') },
 * )
 * ```
 *
 * 注入规则（均为「安全合并」，不覆盖用户已有配置）：
 *   1. `markdown.config`：先执行用户原有 config，再执行 `injectSourceLine`
 *   2. `vite.plugins`：在现有插件列表末尾追加 `ed.vite()`
 *   3. `themeConfig.editLink.pattern`：仅在用户未设置时注入 `ed.editLinkPattern`，
 *      已存在的 `editLink.text` 原样保留
 */
export function withOpenInEditor<T>(
  config: T,
  options: OpenInEditorOptions,
): T {
  const ed = openInEditor(options)
  const next: Record<string, unknown> = { ...(config as Record<string, unknown>) }

  // 1. markdown.config 安全合并
  const prevMarkdown = next.markdown as { config?: (md: unknown) => void } | undefined
  const prevMarkdownConfig = prevMarkdown?.config
  next.markdown = {
    ...prevMarkdown,
    config(md: unknown) {
      if (typeof prevMarkdownConfig === 'function') prevMarkdownConfig(md)
      ed.markdown(md as Parameters<typeof ed.markdown>[0])
    },
  }

  // 2. vite.plugins 追加
  const prevVite = (next.vite as { plugins?: unknown[] } | undefined) ?? {}
  const prevPlugins = Array.isArray(prevVite.plugins) ? prevVite.plugins : []
  next.vite = {
    ...prevVite,
    plugins: [...prevPlugins, ed.vite()],
  }

  // 3. themeConfig.editLink.pattern 注入（不覆盖已有 pattern / text）
  const themeConfig = (next.themeConfig as Record<string, unknown> | undefined) ?? {}
  const editLink = themeConfig.editLink as { pattern?: string } | undefined
  if (!editLink) {
    themeConfig.editLink = { pattern: ed.editLinkPattern }
  } else if (!editLink.pattern) {
    themeConfig.editLink = { ...editLink, pattern: ed.editLinkPattern }
  }
  next.themeConfig = themeConfig

  return next as T
}

export default openInEditor
