// ── THEME MODULE ───────────────────────────────────────────────────────────
// Detects the host (Extella/LibreChat) theme and keeps the toolbar — and the
// embedded Library iframe — in sync with it.
//
// Source of truth: the HOST APP owns the theme. LibreChat stores the user's
// choice in localStorage `color-theme` = 'light' | 'dark' | 'system'. When it
// is 'system' (or unset/auto) the concrete theme is resolved from the OS
// preference (prefers-color-scheme) and the class the app applies to the page.
//
// NOTE: a previous version gave a toolbar-local `ext_theme` key top priority as
// a "manual override". Nothing in the toolbar toggles it, so a stale value just
// masked real app theme changes forever. `ext_theme` is no longer read, and is
// cleared on init() for hygiene.
//
// Exposes: ETB.theme.isDark(), ETB.theme.current(), ETB.theme.toggle(),
//          ETB.theme.onChange(fn), ETB.theme.init()

ETB.theme = (function () {
  var _listeners = [];
  var _current = null;

  // Resolve the concrete theme when the app says 'system' (or doesn't say):
  // OS preference first, then whatever class/luminance the page is showing.
  function _systemTheme() {
    try {
      if (window.matchMedia &&
          window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
      if (window.matchMedia &&
          window.matchMedia('(prefers-color-scheme: light)').matches) return 'light';
    } catch (e) {}
    var h = document.documentElement;
    if (h.classList.contains('dark')) return 'dark';
    if (h.classList.contains('light')) return 'light';
    if (document.body) {
      if (document.body.classList.contains('dark')) return 'dark';
      if (document.body.classList.contains('light')) return 'light';
    }
    try {
      var bg = window.getComputedStyle(document.body).backgroundColor;
      var m = bg.match(/\d+/g);
      if (m) {
        var lum = (+m[0] * 299 + +m[1] * 587 + +m[2] * 114) / 1000;
        return lum > 128 ? 'light' : 'dark';
      }
    } catch (e) {}
    return 'dark';
  }

  function _detect() {
    var ct;
    try { ct = localStorage.getItem('color-theme'); } catch (e) {}
    if (ct === 'light' || ct === 'dark') return ct;
    // 'system' / 'auto' / null → resolve what's actually applied.
    return _systemTheme();
  }

  function _apply(theme) {
    _current = theme;
    // Set on <html> so CSS variables reach #_etbv2_viewport (plugin panels,
    // marketplace, library overlays mount there — not inside #_etbv2_root).
    var html = document.documentElement;
    if (theme === 'light') html.setAttribute('data-etb-light', '1');
    else html.removeAttribute('data-etb-light');
    // Keep toolbar root in sync for any legacy selectors.
    var el = document.getElementById('_etbv2_root');
    if (el) {
      if (theme === 'light') el.setAttribute('data-etb-light', '1');
      else el.removeAttribute('data-etb-light');
    }
    _listeners.forEach(function (fn) { fn(theme); });
  }

  // Re-detect and only re-apply (→ notify listeners → repaint Library) when the
  // resolved theme actually changed, so noisy DOM mutations don't spam postMessage.
  function _sync() {
    var next = _detect();
    if (next !== _current) _apply(next);
  }

  // Watch every signal the host uses to express a theme change. The app and the
  // toolbar share one document, so a same-document `localStorage` write fires NO
  // `storage` event here — the class the app toggles on <html>/<body> is the
  // reliable trigger; matchMedia covers OS changes while color-theme === system.
  var _obs = new MutationObserver(_sync);
  _obs.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class', 'data-theme']
  });
  if (document.body) {
    _obs.observe(document.body, {
      attributes: true,
      attributeFilter: ['class', 'data-theme']
    });
  }
  // Cross-document writes (other tabs) still arrive via storage.
  window.addEventListener('storage', function (e) {
    if (e.key === 'color-theme' || e.key === 'ext_theme') _sync();
  });
  try {
    var _mq = window.matchMedia('(prefers-color-scheme: dark)');
    var _mqHandler = function () { _sync(); };
    if (_mq.addEventListener) _mq.addEventListener('change', _mqHandler);
    else if (_mq.addListener) _mq.addListener(_mqHandler);
  } catch (e) {}

  return {
    isDark: function () { return _detect() === 'dark'; },

    current: function () { return _detect(); },

    // Manual toolbar toggle. Writes the host's own `color-theme` key (not a
    // private one) so the choice and the app stay consistent.
    toggle: function () {
      var next = _detect() === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem('color-theme', next); } catch (e) {}
      _apply(next);
      return next;
    },

    onChange: function (fn) { _listeners.push(fn); },

    init: function () {
      // Drop the stale manual-override key from older builds — `color-theme` is
      // now authoritative and a lingering `ext_theme` would mask app changes.
      try { localStorage.removeItem('ext_theme'); } catch (e) {}
      _apply(_detect());
    }
  };
})();
