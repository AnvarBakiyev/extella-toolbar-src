// ── TABS / MAIN TOOLBAR UI ─────────────────────────────────────────────────
// Persistent toolbar: [Chat | Library | Plugins] (center)
// Exposes: ETB.tabs.init(), ETB.tabs.refresh()

ETB.tabs = (function () {

  // ── CSS ────────────────────────────────────────────────────────
  var STYLES = [
    // Theme tokens on <html> so every overlay in #_etbv2_viewport inherits them.
    'html{',
      '--etb-a:#C67E34;--etb-ar:198,126,52;',
      '--etb-bg:#0a0a0a;--etb-s1:#111;--etb-s2:#161616;--etb-s3:#1c1c1c;',
      '--etb-bd:rgba(255,255,255,.07);--etb-bd2:rgba(255,255,255,.13);',
      '--etb-tx:#f0f0f0;--etb-tx2:#888;--etb-tx3:#444;',
    '}',
    'html[data-etb-light]{',
      '--etb-bg:#F4EFE7;--etb-s1:#fff;--etb-s2:#fff;--etb-s3:#FAF6EF;',
      '--etb-bd:rgba(0,0,0,.07);--etb-bd2:rgba(0,0,0,.14);',
      '--etb-tx:#111;--etb-tx2:#6b6b6b;--etb-tx3:#ccc;',
    '}',
    '#_etbv2_root{',
      'font-family:-apple-system,system-ui,sans-serif;',
      '-webkit-font-smoothing:antialiased;',
    '}',
    '#_etbv2_bar{',
      'height:0;overflow:visible;',
      'background:none;border:none;box-shadow:none;padding:0;',
      'pointer-events:none;',
      'flex-shrink:0;',
    '}',
    '#_etbv2_nav_center{',
      'position:fixed;top:8px;left:50%;transform:translateX(-50%);',
      'z-index:2147483635;pointer-events:auto;',
      'display:flex;align-items:center;gap:2px;',
      'background:var(--etb-s1);',
      'border:1px solid var(--etb-bd2);',
      'border-radius:22px;',
      'padding:4px;',
      'box-shadow:0 2px 20px rgba(0,0,0,.35);',
    '}',
    'html[data-etb-light] #_etbv2_nav_center{',
      'box-shadow:0 2px 16px rgba(0,0,0,.1);',
    '}',
    '._etbv2_sec{',
      'display:flex;align-items:center;gap:5px;',
      'padding:6px 12px;border-radius:18px;cursor:pointer;',
      'font-size:12px;font-weight:500;color:var(--etb-tx2);',
      'transition:color .12s,background .12s;white-space:nowrap;',
      'border:none;background:transparent;',
    '}',
    '._etbv2_sec:hover{color:var(--etb-tx);background:var(--etb-s3);}',
    '._etbv2_sec.on{color:var(--etb-a);background:rgba(var(--etb-ar),.1);font-weight:600;}',
    // Ручка перетаскивания: панель двигается по горизонтали, позиция запоминается.
    '#_etbv2_nav_grip{',
      'display:flex;align-items:center;justify-content:center;',
      'width:14px;align-self:stretch;cursor:grab;color:var(--etb-tx3);',
      'font-size:10px;letter-spacing:1px;user-select:none;flex-shrink:0;',
    '}',
    '#_etbv2_nav_grip:hover{color:var(--etb-tx2);}',
    '#_etbv2_nav_center.dragging{opacity:.85;}',
    '#_etbv2_nav_center.dragging ._etbv2_sec{pointer-events:none;}',
    '@keyframes _etbv2_slide_in{from{transform:translateY(8px);opacity:0}to{transform:translateY(0);opacity:1}}',
    '@keyframes _etbv2_slide_out{from{transform:translateY(0);opacity:1}to{transform:translateY(8px);opacity:0}}'
  ].join('');

  function _injectStyles() {
    if (document.getElementById('_etbv2_styles')) return;
    var s = document.createElement('style');
    s.id = '_etbv2_styles';
    s.textContent = STYLES;
    document.head.appendChild(s);
  }

  // Позиция панели: юзерская настройка живёт в localStorage и переживает
  // перезапуски. x — доля ширины окна (0..1).
  var POS_KEY = 'etb_nav_pos_v1';
  function _loadPos() {
    try { return JSON.parse(localStorage.getItem(POS_KEY) || '{}') || {}; }
    catch (e) { return {}; }
  }
  function _savePos(p) {
    try { localStorage.setItem(POS_KEY, JSON.stringify(p)); } catch (e) {}
  }
  function _applyPos(nav) {
    var p = _loadPos();
    if (typeof p.x === 'number') {
      // фиксируем левый край в px от доли ширины, отключая центрирование
      var w = nav.offsetWidth || 260;
      var left = Math.min(Math.max(p.x * window.innerWidth, 4), window.innerWidth - w - 4);
      nav.style.left = left + 'px';
      nav.style.transform = 'none';
    }
  }

  function _buildBar() {
    var bar = document.createElement('div');
    bar.id = '_etbv2_bar';

    var navCenter = document.createElement('div');
    navCenter.id = '_etbv2_nav_center';

    // Ручка слева: тянешь — панель едет по горизонтали. Двойной клик — в центр.
    var grip = document.createElement('div');
    grip.id = '_etbv2_nav_grip';
    grip.title = 'Перетащить панель. Двойной клик — вернуть в центр';
    grip.textContent = '⋮⋮';
    (function () {
      var sx = 0, ox = 0, on = false;
      grip.addEventListener('mousedown', function (e) {
        on = true; sx = e.clientX;
        ox = navCenter.getBoundingClientRect().left;
        navCenter.classList.add('dragging');
        e.preventDefault();
      });
      window.addEventListener('mousemove', function (e) {
        if (!on) return;
        var w = navCenter.offsetWidth;
        var left = Math.min(Math.max(ox + (e.clientX - sx), 4), window.innerWidth - w - 4);
        navCenter.style.left = left + 'px';
        navCenter.style.transform = 'none';
      });
      window.addEventListener('mouseup', function () {
        if (!on) return;
        on = false;
        navCenter.classList.remove('dragging');
        var p = _loadPos();
        p.x = navCenter.getBoundingClientRect().left / window.innerWidth;
        _savePos(p);
      });
      grip.addEventListener('dblclick', function () {
        navCenter.style.left = '50%';
        navCenter.style.transform = 'translateX(-50%)';
        var p = _loadPos(); delete p.x; _savePos(p);
      });
    })();
    navCenter.appendChild(grip);

    var navItems = [
      { id: 'chat',    label: 'Chat',    title: 'Return to chat' },
      { id: 'library', label: 'Library', title: 'Open Library' },
      { id: 'plugins', label: 'Plugins', title: 'Open plugin marketplace' }
    ];

    navItems.forEach(function (item) {
      var btn = document.createElement('button');
      btn.className = '_etbv2_sec';
      btn.id = '_etbv2_nav_' + item.id;
      btn.title = item.title;
      btn.innerHTML = '<span>' + item.label + '</span>';
      btn.addEventListener('click', function () {
        ETB.nav.set(item.id);
      });
      navCenter.appendChild(btn);
    });

    // Reload — re-injects the freshly deployed toolbar.js without restarting
    // Extella (the loader re-runs on every page load). Dev & user convenience.
    var sep = document.createElement('div');
    sep.style.cssText = 'width:1px;height:14px;background:var(--etb-bd2);margin:0 3px;flex-shrink:0;';
    navCenter.appendChild(sep);
    var reloadBtn = document.createElement('button');
    reloadBtn.className = '_etbv2_sec';
    reloadBtn.id = '_etbv2_nav_reload';
    reloadBtn.title = 'Reload Extella UI (re-applies the toolbar without restarting the app)';
    reloadBtn.innerHTML = '<span>&#8635;</span>';
    reloadBtn.addEventListener('click', function () {
      try { window.location.reload(); } catch (e) {}
    });
    navCenter.appendChild(reloadBtn);

    bar.appendChild(navCenter);

    // применить сохранённую позицию (после вставки в DOM размеры уже известны)
    setTimeout(function () { _applyPos(navCenter); }, 0);

    return bar;
  }

  return {
    init: function () {
      if (document.getElementById('_etbv2_root')) return;

      _injectStyles();

      var root = document.createElement('div');
      root.id = '_etbv2_root';
      if (ETB.shell && ETB.shell.isFallback && ETB.shell.isFallback()) {
        root.setAttribute('data-etb-fallback', '1');
      }
      document.body.insertBefore(root, document.body.firstChild);
      ETB.theme.init();

      root.appendChild(_buildBar());
      ETB.nav.syncUI();
    },

    refresh: function () {
      if (ETB.nav) ETB.nav.syncUI();
    }
  };
})();
