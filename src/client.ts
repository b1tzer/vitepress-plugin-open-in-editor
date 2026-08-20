/**
 * 客户端脚本 & 样式的生成器。
 *
 * 之所以以字符串工厂形式导出而不是独立的 .client.ts 由 Vite 打包：
 *   - VitePress 的客户端入口无法在 config 层追加脚本，只能走 head 注入
 *   - 我们需要把运行时参数（base、endpoint、markerProtocol、buttonText）编译进脚本
 *   - 字符串形式最直接，也避免了跨包 chunk 加载的复杂度
 *
 * 输出物同时供两种消费者：
 *   - VitePress head 数组（['script', {}, ClientScript]）
 *   - Vite transformIndexHtml（作为 tags 注入）
 */

import clientScriptSource from './client-script'

export interface ClientRuntimeConfig {
  /** 站点 base（含首尾斜杠），用于反推当前页对应的 .md 相对路径 */
  base: string
  /** 服务端中间件挂载路径，如 /__open-editor */
  endpoint: string
  /** 假外链协议头，用于让 VitePress 把 editLink 视为外链避免 SPA 路由拦截 */
  markerProtocol: string
  /** 悬浮按钮显示文字 */
  buttonText: string
  /** 是否启用悬浮浮动按钮（关掉则只保留 editLink 一键跳转） */
  hover: boolean
}

/**
 * 浮动按钮的样式。带 vp- 前缀避免和用户自定义样式冲突。
 * 颜色变量遵循 VitePress 默认主题令牌，暗色主题下自动跟随。
 */
export function buildStyle(): string {
  return `.vp-open-editor-btn {
    position: absolute;
    z-index: 40;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    font-size: 12px;
    line-height: 1.4;
    color: var(--vp-c-text-2, #555);
    background: var(--vp-c-bg-soft, #f5f5f5);
    border: 1px solid var(--vp-c-divider, #e2e2e2);
    border-radius: 4px;
    cursor: pointer;
    opacity: 0;
    transform: translateY(-4px);
    transition: opacity .12s ease, transform .12s ease;
    box-shadow: 0 2px 6px rgba(0,0,0,.06);
    user-select: none;
    pointer-events: none;
  }
  .vp-open-editor-btn.is-visible {
    opacity: 1;
    transform: translateY(0);
    pointer-events: auto;
  }
  .vp-open-editor-btn:hover {
    color: var(--vp-c-brand-1, #3451b2);
    border-color: var(--vp-c-brand-1, #3451b2);
  }
  .vp-open-editor-bridge {
    position: absolute;
    z-index: 39;
    pointer-events: none;
  }
  .vp-open-editor-bridge.is-visible {
    pointer-events: auto;
  }`
}

/**
 * 生成客户端脚本字符串。
 *
 * 脚本做三件事：
 *   1. 拦截 editLink：identify href.startsWith(markerProtocol) 的 <a>，阻止 SPA 路由，
 *      改为 fetch(endpoint?file=...) 打开整页源文件
 *   2. 悬浮浮动按钮：对 .vp-doc 里带 data-src-line 的元素挂 mouseover 委托，
 *      鼠标进入即在正文右侧留白（窄屏则元素上方）显示"编辑此行"按钮，不遮挡正文，
 *      点击 fetch(endpoint?file=...&line=...)
 *   3. 客户端反推 .md 路径：从 location.pathname 去掉 base、去掉 .html 后缀补 .md
 */
export function buildClientScript(cfg: ClientRuntimeConfig): string {
  return `(${clientScriptSource})(${JSON.stringify(cfg)})`
}
