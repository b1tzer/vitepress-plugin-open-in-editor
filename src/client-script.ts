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
      var file = currentTarget.getAttribute('data-src-file') || '';
      openInEditor(file, line);
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
})`
