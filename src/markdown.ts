/**
 * markdown-it 插件：给每个 block 级 token 的开标签写入 data-src-line 属性。
 *
 * 值来自 token.map[0] + 1（1-based 行号，与编辑器一致）。
 * 编译后的 HTML 里，<h1>/<p>/<pre>/<ul>/<blockquote>/<table> 等元素都会带上源码行号，
 * 客户端脚本据此挂浮动按钮。
 *
 * 为什么改写 renderToken 而不是 core rule：
 *   - core rule 在 parse 阶段遍历所有 token 注入属性，renderToken 在渲染阶段逐 token 判断
 *   - 二者遍历成本相当；renderToken 的真正优势是惰性注入、无需单独注册 rule
 */

import type MarkdownIt from 'markdown-it'

export function injectSourceLine(md: MarkdownIt): void {
  // @types/markdown-it 的 renderToken 类型仅声明 3 个参数，但 markdown-it 运行时
  // 实际传入 5 个（含 env/self）。用 any 绕过该类型不完整，保持与官方运行时行为一致。
  const original = md.renderer.renderToken.bind(md.renderer) as any
  md.renderer.renderToken = ((tokens: any, idx: any, options: any, env: any, self: any) => {
    const token = tokens[idx]
    // 只处理开标签（nesting === 1）且带源码行号映射（map）的块级元素。
    if (token.nesting === 1 && token.map && token.tag) {
      token.attrSet('data-src-line', String(token.map[0] + 1))
      // 注入真实源文件相对路径（相对 srcDir）。VitePress 渲染时通过 env 传入
      // relativePath；在 rewrites 场景下它比 URL 反推更可靠，供 hover 按钮优先使用。
      const rel = (env as { relativePath?: string } | undefined)?.relativePath
      if (rel) token.attrSet('data-src-file', rel)
    }
    return original(tokens, idx, options, env, self)
  }) as any
}
