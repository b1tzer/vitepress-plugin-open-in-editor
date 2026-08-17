/**
 * markdown-it 插件：给每个 block 级 token 的开标签写入 data-src-line 属性。
 *
 * 值来自 token.map[0] + 1（1-based 行号，与编辑器一致）。
 * 编译后的 HTML 里，<h1>/<p>/<pre>/<ul>/<blockquote>/<table> 等元素都会带上源码行号，
 * 客户端脚本据此挂浮动按钮。
 *
 * 为什么改写 renderToken 而不是 core rule：
 *   - core rule 拿到的是 token 数组，操作 attr 方便，但每次 md.parse 都要遍历
 *   - 改写 renderToken 只在真正渲染标签的那一刻注入，开销与原本渲染完全一致
 */

import type MarkdownIt from 'markdown-it'

export function injectSourceLine(md: MarkdownIt): void {
  const original = md.renderer.renderToken.bind(md.renderer)
  md.renderer.renderToken = (tokens, idx, options) => {
    const token = tokens[idx]
    // 只处理开标签（nesting === 1）且带源码行号映射（map）的块级元素。
    if (token.nesting === 1 && token.map && token.tag) {
      token.attrJoin('data-src-line', String(token.map[0] + 1))
    }
    return original(tokens, idx, options)
  }
}
