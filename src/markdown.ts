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

// markdown-it 没有直接暴露类型；这里用宽松签名，保证在使用方 config.mts 里能无摩擦接入。
type MarkdownIt = {
  renderer: {
    rules: Record<string, unknown>
    renderToken: (tokens: unknown[], idx: number, options: unknown) => string
  }
}

export function injectSourceLine(md: MarkdownIt): void {
  const original = md.renderer.renderToken.bind(md.renderer)
  md.renderer.renderToken = function (
    tokens: unknown[],
    idx: number,
    options: unknown,
  ) {
    const token = tokens[idx] as {
      nesting: number
      map?: number[] | null
      tag?: string
      attrJoin?: (name: string, value: string) => void
    }
    if (
      token &&
      token.nesting === 1 &&
      token.map &&
      token.map.length >= 1 &&
      token.tag &&
      typeof token.attrJoin === 'function'
    ) {
      token.attrJoin('data-src-line', String(token.map[0] + 1))
    }
    return original(tokens, idx, options)
  }
}
