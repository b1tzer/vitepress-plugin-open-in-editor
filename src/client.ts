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
  }
  .vp-open-editor-btn.is-visible {
    opacity: 1;
    transform: translateY(0);
  }
  .vp-open-editor-btn:hover {
    color: var(--vp-c-brand-1, #3451b2);
    border-color: var(--vp-c-brand-1, #3451b2);
  }`
}

/**
 * 生成客户端脚本字符串。
 *
 * 脚本做三件事：
 *   1. 拦截 editLink：identify href.startsWith(markerProtocol) 的 <a>，阻止 SPA 路由，
 *      改为 fetch(endpoint?file=...) 打开整页源文件
 *   2. 悬浮浮动按钮：对 .vp-doc 里带 data-src-line 的元素挂 mouseover 委托，
 *      鼠标进入即在元素右上角显示"编辑此行"按钮，点击 fetch(endpoint?file=...&line=...)
 *   3. 客户端反推 .md 路径：从 location.pathname 去掉 base、去掉 .html 后缀补 .md
 */
export function buildClientScript(cfg: ClientRuntimeConfig): string {
  // 注意：模板值嵌入前要做最基本的 JSON 转义，防止 buttonText 里含引号打断字符串
  const j = (v: string) => JSON.stringify(v)

  return `(function() {
  var BASE = ${j(cfg.base)};
  var ENDPOINT = ${j(cfg.endpoint)};
  var MARKER = ${j(cfg.markerProtocol)};
  var BUTTON_TEXT = ${j(cfg.buttonText)};
  var HOVER = ${cfg.hover ? 'true' : 'false'};

  // ---------- 通用：反推当前页对应的 .md 相对路径 ----------
  function getSourceFile() {
    var pathname = location.pathname;
    if (pathname.indexOf(BASE) !== 0) return '';
    var rel = pathname.slice(BASE.length); // e.g. 04-java-network/chapter-03-socket.html
    if (/\\.html$/.test(rel)) rel = rel.slice(0, -5);
    else if (rel === '' || /\\/$/.test(rel)) rel += 'index';
    return rel + '.md';
  }

  // ---------- 通用：发起打开请求 ----------
  function openInEditor(file, line) {
    if (!file) return;
    var url = ENDPOINT + '?file=' + encodeURIComponent(file)
            + (line > 0 ? '&line=' + line : '');
    fetch(url)
      .then(function(r){ return r.json(); })
      .then(function(d){ if(!d || !d.ok) console.error('[open-in-editor]', d && d.error); })
      .catch(function(err){ console.error('[open-in-editor]', err); });
  }

  // ---------- 1. editLink 假外链拦截 ----------
  // VitePress 只有匹配 /^(?:[a-z]+:|\\/\\/)/i 的 URL 才不被视为内部路由。
  // 因此 editLink.pattern 用一个不存在的协议 http://__vscode__/... 骗过路由，
  // 这里再把点击行为改写为 fetch 到服务端。
  document.addEventListener('click', function(e) {
    if (e.defaultPrevented || e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target && e.target.closest && e.target.closest('a');
    if (!a) return;
    var href = a.getAttribute('href') || '';
    if (href.indexOf(MARKER) !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    openInEditor(href.slice(MARKER.length), 0);
  }, true);

  if (!HOVER) return;

  // ---------- 2. 悬浮浮动按钮 ----------
  var btn = null;
  var currentTarget = null;
  var hideTimer = null;

  function ensureBtn() {
    if (btn) return btn;
    btn = document.createElement('button');
    btn.className = 'vp-open-editor-btn';
    btn.type = 'button';
    btn.innerHTML = '<span aria-hidden="true">↗</span><span>' + BUTTON_TEXT + '</span>';
    btn.addEventListener('mouseenter', function() {
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    });
    btn.addEventListener('mouseleave', scheduleHide);
    btn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      if (!currentTarget) return;
      var line = parseInt(currentTarget.getAttribute('data-src-line') || '0', 10);
      openInEditor(getSourceFile(), line);
    });
    document.body.appendChild(btn);
    return btn;
  }

  function positionBtn(target) {
    var b = ensureBtn();
    var r = target.getBoundingClientRect();
    var top = window.scrollY + r.top - 6;
    var left = window.scrollX + r.right - 90;
    if (left < window.scrollX + r.left + 8) left = window.scrollX + r.left + 8;
    b.style.top = top + 'px';
    b.style.left = left + 'px';
    var line = target.getAttribute('data-src-line') || '';
    b.title = 'Open source line ' + line + ' in editor';
    b.setAttribute('data-line', line);
    b.classList.add('is-visible');
  }

  function scheduleHide() {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(function() {
      if (btn) btn.classList.remove('is-visible');
      currentTarget = null;
    }, 150);
  }

  document.addEventListener('mouseover', function(e) {
    var el = e.target && e.target.closest && e.target.closest('.vp-doc [data-src-line]');
    if (!el) return;
    if (currentTarget === el) {
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
      return;
    }
    currentTarget = el;
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    positionBtn(el);
  });

  document.addEventListener('mouseout', function(e) {
    if (!currentTarget) return;
    var related = e.relatedTarget;
    if (related && (related === btn || (btn && btn.contains(related)))) return;
    if (related && currentTarget.contains(related)) return;
    scheduleHide();
  });

  window.addEventListener('scroll', function() {
    if (btn && btn.classList.contains('is-visible') && currentTarget) {
      positionBtn(currentTarget);
    }
  }, { passive: true });
})();`
}
