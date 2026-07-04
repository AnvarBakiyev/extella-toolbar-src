// ── NAV MODULE ─────────────────────────────────────────────────────────────
// Central view switcher: Chat | Library | Plugins (mutually exclusive overlays).
// Exposes: ETB.nav.set(view), ETB.nav.get(), ETB.nav.syncUI()

ETB.nav = (function () {
  var _active = 'chat';

  function _paintTabs() {
    ['chat', 'library', 'plugins'].forEach(function (v) {
      var btn = document.getElementById('_etbv2_nav_' + v);
      if (btn) btn.classList.toggle('on', _active === v);
    });
  }

  // A marketplace overlay mid-exit-animation (data-closing) must NOT count as
  // open — otherwise closing a plugin view re-highlights Plugins instead of Chat.
  function _mktOpen() {
    var ov = document.getElementById('_etbv2_mkt_ov');
    return !!(ov && ov.getAttribute('data-closing') !== '1');
  }

  function _libOpen() {
    return !!(ETB.library && ETB.library.isOpen && ETB.library.isOpen());
  }

  // An individual plugin view (router overlay) opened from the marketplace.
  function _pluginOpen() {
    return !!(ETB.router && ETB.router.isOpen && ETB.router.isOpen());
  }

  function _closeOverlays() {
    if (ETB.router && ETB.router.isOpen && ETB.router.isOpen()) {
      ETB.router.close({ silent: true });
    }
    if (ETB.library && ETB.library.isOpen && ETB.library.isOpen()) {
      ETB.library.close({ silent: true });
    }
    if (ETB.marketplace && document.getElementById('_etbv2_mkt_ov')) {
      ETB.marketplace.close({ silent: true });
    }
  }

  if (!window.__etbNavSessionHook) {
    window.__etbNavSessionHook = true;
    ETB.auth.onSessionChange(function (ev) {
      if (!ev.cleared) return;
      // Delegate to the current nav module (survives toolbar re-injection).
      if (window.ETB && window.ETB.nav) window.ETB.nav.set('chat');
    });
  }

  return {
    get: function () { return _active; },

    set: function (view) {
      if (view !== 'chat' && view !== 'library' && view !== 'plugins') return;

      // Re-clicking a tab is a no-op only when that view's surface is actually
      // on screen. If _active === 'plugins' but only a plugin view (not the
      // marketplace) is open, clicking Plugins must reopen the marketplace.
      if (view === _active) {
        if (view === 'chat' && !_pluginOpen() && !_mktOpen() && !_libOpen()) return;
        if (view === 'library' && _libOpen()) return;
        if (view === 'plugins' && _mktOpen()) return;
      }

      _active = view;
      _closeOverlays();
      _paintTabs();

      if (view === 'library' && ETB.library) {
        ETB.library.open();
      } else if (view === 'plugins' && ETB.marketplace) {
        ETB.marketplace.open();
      } else {
        // Overlays close with a short animation; re-sync once DOM catches up.
        setTimeout(function () { ETB.nav.syncUI(); }, 160);
      }
    },

    syncUI: function () {
      // Priority: an open plugin view belongs to Plugins; then Library; then the
      // marketplace overlay; otherwise the underlying chat.
      if (_pluginOpen()) {
        _active = 'plugins';
      } else if (_libOpen()) {
        _active = 'library';
      } else if (_mktOpen()) {
        _active = 'plugins';
      } else {
        _active = 'chat';
      }
      _paintTabs();
    }
  };
})();
