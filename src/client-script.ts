export default `(function(cfg) {
  var ENDPOINT = cfg.endpoint;
  var MARKER = cfg.markerProtocol;
  var BUTTON_TEXT = cfg.buttonText;
  var HOVER = cfg.hover;

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
  var bridge = null;
  var currentTarget = null;
  var hideTimer = null;
  var GAP = 8; // 按钮与正文之间的间距（gutter 或元素上方）

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
      var file = currentTarget.getAttribute('data-src-file') || '';
      openInEditor(file, line);
    });
    document.body.appendChild(btn);
    return btn;
  }

  // 不可见的「桥接热区」：覆盖元素与按钮之间的空隙，让鼠标能顺畅滑入按钮，
  // 不会因跨越空隙触发 mouseout 而让按钮提前消失。它只覆盖空隙、不压住正文。
  function ensureBridge() {
    if (bridge) return bridge;
    bridge = document.createElement('div');
    bridge.className = 'vp-open-editor-bridge';
    bridge.setAttribute('aria-hidden', 'true');
    bridge.addEventListener('mouseenter', function() {
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    });
    bridge.addEventListener('mouseleave', scheduleHide);
    document.body.appendChild(bridge);
    return bridge;
  }

  function positionBtn(target) {
    var b = ensureBtn();
    var r = target.getBoundingClientRect();
    var bw = b.offsetWidth || 80;
    var bh = b.offsetHeight || 24;
    var vw = document.documentElement.clientWidth;
    var top, left, inGutter;

    // 优先把按钮放进正文右侧的留白 gutter，完全不遮挡文字；
    // 窄屏没有 gutter 时回退到元素「外侧上方」，右缘对齐。
    if (r.right + GAP + bw <= vw) {
      inGutter = true;
      left = r.right + GAP;
      top = r.top;
    } else {
      inGutter = false;
      left = r.right - bw;
      if (left < 0) left = 0;
      top = r.top - bh - GAP;
    }

    b.style.top = (window.scrollY + top) + 'px';
    b.style.left = (window.scrollX + left) + 'px';

    positionBridge(r, left, top, bw, bh, inGutter);

    var line = target.getAttribute('data-src-line') || '';
    b.title = 'Open source line ' + line + ' in editor';
    b.setAttribute('data-line', line);
    b.classList.add('is-visible');
  }

  function positionBridge(r, left, top, bw, bh, inGutter) {
    var g = ensureBridge();
    var PAD = 4;
    var x, y, w, h;
    if (inGutter) {
      x = r.right - PAD;
      y = r.top - PAD;
      w = (left - r.right) + PAD * 2;
      h = bh + PAD * 2;
    } else {
      x = left - PAD;
      y = top + bh - PAD;
      w = bw + PAD * 2;
      h = (r.top - (top + bh)) + PAD * 2;
    }
    g.style.left = (window.scrollX + x) + 'px';
    g.style.top = (window.scrollY + y) + 'px';
    g.style.width = w + 'px';
    g.style.height = h + 'px';
    g.classList.add('is-visible');
  }

  function scheduleHide() {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(function() {
      if (btn) btn.classList.remove('is-visible');
      if (bridge) bridge.classList.remove('is-visible');
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
    if (related && (related === bridge || (bridge && bridge.contains(related)))) return;
    if (related && currentTarget.contains(related)) return;
    scheduleHide();
  });

  window.addEventListener('scroll', function() {
    if (btn && btn.classList.contains('is-visible') && currentTarget) {
      positionBtn(currentTarget);
    }
  }, { passive: true });
})`
