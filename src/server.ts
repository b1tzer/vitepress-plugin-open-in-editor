import type { Connect, ViteDevServer } from 'vite'
import { execFile } from 'node:child_process'
import { resolve, sep } from 'node:path'
import { getEditorSpec, resolveEditor, type EditorId } from './launcher'

export interface ServerMiddlewareOptions {
  /** 允许打开的文件根目录（绝对路径）。任何逃出该目录的路径都会被拒绝。 */
  docsDir: string
  /** 中间件挂载路径，默认 /__open-editor */
  endpoint: string
  /** 编辑器 id，或空字符串走环境变量 */
  editor?: string
  /** VS Code 系列是否复用同一窗口 */
  reuseWindow: boolean
}

/**
 * 注册一条 Connect 中间件到 Vite dev server：
 *
 *   GET /__open-editor?file=<相对 docsDir 的路径>&line=<行号可选>
 *
 * 服务端执行编辑器 CLI 打开对应文件，返回 JSON 结果。
 *
 * 为什么要走服务端而不是浏览器 vscode:// 协议：
 *   - Remote SSH 场景下浏览器运行在客户端，vscode:// 由客户端 OS 解析，链路不可控
 *   - 走 fetch 后由 dev server（跑在远端）直接 exec，把远端文件路径传给远端 code CLI，
 *     再由 VS Code Server 通过 IPC 转发到本机窗口，路径始终是远端绝对路径，最稳
 */
export function registerOpenEditorMiddleware(
  server: ViteDevServer,
  options: ServerMiddlewareOptions,
): void {
  const { docsDir, endpoint, reuseWindow } = options
  const editorId: EditorId = resolveEditor(options.editor)
  const spec = getEditorSpec(editorId)

  const handler: Connect.NextHandleFunction = (req, res, next) => {
    if (!req.url) return next()

    const qIdx = req.url.indexOf('?')
    const pathname = qIdx >= 0 ? req.url.slice(0, qIdx) : req.url
    if (pathname !== endpoint) return next()

    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
    const file = url.searchParams.get('file')
    const lineRaw = url.searchParams.get('line')

    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(body))
    }

    if (!file) return json(400, { ok: false, error: 'Missing file parameter' })

    // 路径安全：先规范化，再验证是否落在 docsDir 内。
    // resolve 会消除 ..，startsWith(docsDir + sep) 避免 /a/b 匹配到 /a/bbb 这种前缀绕过。
    const fullPath = resolve(docsDir, file)
    const dirPrefix = docsDir.endsWith(sep) ? docsDir : docsDir + sep
    if (fullPath !== docsDir && !fullPath.startsWith(dirPrefix)) {
      return json(400, { ok: false, error: 'Path escapes docsDir' })
    }

    // 拒绝含控制字符（\0 \n \r）的路径，防止参数注入。
    if (/[\x00-\x1f]/.test(fullPath)) {
      return json(400, { ok: false, error: 'Invalid characters in path' })
    }

    const line = lineRaw && /^\d+$/.test(lineRaw) ? parseInt(lineRaw, 10) : 0
    const args = spec.buildArgs(fullPath, line, { reuseWindow })

    execFile(spec.cmd, args, (error, _stdout, stderr) => {
      if (error) {
        const msg = stderr?.trim() || error.message
        console.error(`[open-in-editor] ${spec.cmd} failed: ${msg}`)
        return json(500, { ok: false, error: msg, path: fullPath })
      }
      json(200, { ok: true, editor: editorId, path: fullPath, line })
    })
  }

  server.middlewares.use(handler)
}
