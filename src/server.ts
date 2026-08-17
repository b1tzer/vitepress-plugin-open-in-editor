import type { Connect, ViteDevServer } from 'vite'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { getEditorSpec, resolveEditor } from './launcher'
import type { EditorId, EditorSpec } from './launcher'

export interface ServerMiddlewareOptions {
  /** 允许打开的源文件目录（绝对路径）。任何逃出该目录的路径都会被拒绝。 */
  sourceDir: string
  /** 中间件挂载路径，默认 /__open-editor */
  endpoint: string
  /** 编辑器 id；省略时自动探测 */
  editor?: EditorId
  /** VS Code 系列是否复用同一窗口 */
  reuseWindow: boolean
}

/**
 * 注册一条 Connect 中间件到 Vite dev server：
 *
 *   GET /__open-editor?file=<相对 sourceDir 的路径>&line=<行号可选>
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
  const { sourceDir, endpoint, reuseWindow } = options

  // 延迟解析编辑器：把 spawnSync 的进程探测推迟到首次请求，避免阻塞 dev server 启动。
  // 显式传入 editor 时 resolveEditor 直接返回、无探测开销；未传时才在此处惰性探测。
  let editorId: EditorId | null = null
  let spec: EditorSpec | null = null

  const ensureSpec = (): EditorSpec => {
    if (!spec) {
      editorId = resolveEditor(options.editor)
      spec = getEditorSpec(editorId)
    }
    return spec
  }

  const handler: Connect.NextHandleFunction = (req, res, next) => {
    if (!req.url) return next()

    const url = new URL(req.url, 'http://localhost')
    if (url.pathname !== endpoint) return next()
    const file = url.searchParams.get('file')
    const lineRaw = url.searchParams.get('line')

    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(body))
    }

    if (!file) return json(400, { ok: false, error: 'Missing file parameter' })

    // 路径安全：先规范化，再验证是否落在 sourceDir 内。
    // resolve 会消除 ..，startsWith(sourceDir + sep) 避免 /a/b 匹配到 /a/bbb 这种前缀绕过。
    const fullPath = resolve(sourceDir, file)
    const dirPrefix = sourceDir.endsWith(sep) ? sourceDir : sourceDir + sep
    if (fullPath !== sourceDir && !fullPath.startsWith(dirPrefix)) {
      return json(400, { ok: false, error: 'Path escapes sourceDir' })
    }

    // 拒绝含控制字符（\0 \n \r）的路径，防止参数注入。
    if (/[\x00-\x1f]/.test(fullPath)) {
      return json(400, { ok: false, error: 'Invalid characters in path' })
    }

    // 文件存在性校验：避免 code --goto 指向不存在的路径时新建空白文件。
    // 最常见的根因是文件相对路径反推错误，把根因直接打印出来便于定位。
    if (!existsSync(fullPath)) {
      console.error(
        `[open-in-editor] 文件不存在：` +
          `\n   sourceDir: ${sourceDir}` +
          `\n   file     : ${file}` +
          `\n   fullPath : ${fullPath}`,
      )
      return json(404, {
        ok: false,
        error: 'File not found.',
        path: fullPath,
        sourceDir,
      })
    }

    const line = lineRaw && /^\d+$/.test(lineRaw) ? parseInt(lineRaw, 10) : 0
    const s = ensureSpec()
    const args = s.buildArgs(fullPath, line, { reuseWindow })

    execFile(s.cmd, args, (error, _stdout, stderr) => {
      if (error) {
        const msg = stderr?.trim() || error.message
        console.error(`[open-in-editor] ${s.cmd} failed: ${msg}`)
        return json(500, { ok: false, error: msg, path: fullPath })
      }
      json(200, { ok: true, editor: editorId, path: fullPath, line })
    })
  }

  server.middlewares.use(handler)
}
