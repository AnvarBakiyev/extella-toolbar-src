// ── SHELL MODULE ───────────────────────────────────────────────────────────
// Integrates the toolbar into Extella's layout without overlapping native UI.
// Wraps the host app (#root) in a flex viewport; overlays mount inside it.
// Patches Extella fixed full-screen layers (incl. modals/sheets) below the bar.
// Exposes: ETB.shell.init(), ETB.shell.getViewport(), ETB.shell.height()

ETB.shell = (function () {
  var BAR_H = 0;
  var HOST_SELECTORS = ['#root', '#app'];
  var _host = null;
  var _viewport = null;
  var _mode = 'shell'; // 'shell' | 'fallback'

  function _findHost() {
    for (var i = 0; i < HOST_SELECTORS.length; i++) {
      var el = document.querySelector(HOST_SELECTORS[i]);
      if (el) return el;
    }
    return null;
  }

  // Full-screen fixed layers (main shell, upgrade sheet, dialogs) use viewport
  // coordinates — offset them below the toolbar. Nested fixed/sticky top bars
  // need the same offset (direct-child-only was not enough for upgrade plan).
  function _fullScreenFixedFix(selectors) {
    var box = [
      'top:var(--etb-bar-h)!important;',
      'bottom:0!important;left:0!important;right:0!important;',
      'height:auto!important;max-height:none!important;'
    ].join('');
    return selectors.map(function (sel) { return sel + '{' + box + '}'; }).join('');
  }

  function _hostFixRules(hostSel) {
    var topBar = 'top:var(--etb-bar-h)!important;';
    return [
      ':root{--etb-bar-h:' + BAR_H + 'px;}',
      hostSel + '{',
        'height:100%!important;max-height:100%!important;',
        'min-height:0!important;display:flex!important;',
        'flex-direction:column!important;overflow:hidden!important;',
      '}',
      _fullScreenFixedFix([
        hostSel + ' .fixed.inset-0',
        'body > .fixed.inset-0:not(#_etbv2_root):not(#_etbv2_viewport)',
        'body > [data-radix-portal] .fixed.inset-0',
        '[data-radix-portal] .fixed.inset-0'
      ]),
      hostSel + ' .fixed.top-0{' + topBar + '}',
      hostSel + ' .sticky.top-0{' + topBar + '}',
      hostSel + ' .h-screen{',
        'height:100%!important;max-height:100%!important;min-height:0!important;',
      '}',
      hostSel + ' .min-h-screen{min-height:0!important;}',
      hostSel + ' .h-svh,' + hostSel + ' .min-h-svh,',
      hostSel + ' .h-dvh,' + hostSel + ' .min-h-dvh{',
        'height:100%!important;max-height:100%!important;min-height:0!important;',
      '}'
    ].join('');
  }

  function _injectStyles(hostSel, shellLayout) {
    if (document.getElementById('_etbv2_shell_styles')) return;
    var rules = [
      'html,body{height:100%!important;margin:0!important;padding-top:0!important;}',
      'body{display:flex!important;flex-direction:column!important;overflow:hidden!important;}',
      '#_etbv2_root{flex-shrink:0;position:relative;z-index:2147483635;}',
      _hostFixRules(hostSel)
    ];
    if (shellLayout) {
      rules.push(
        '#_etbv2_viewport{flex:1;min-height:0;overflow:hidden;position:relative;}'
      );
    }
    var s = document.createElement('style');
    s.id = '_etbv2_shell_styles';
    s.textContent = rules.join('');
    document.head.appendChild(s);
  }

  function _injectFallbackStyles() {
    if (document.getElementById('_etbv2_page_push')) return;
    var push = document.createElement('style');
    push.id = '_etbv2_page_push';
    push.textContent = 'body{padding-top:' + BAR_H + 'px!important;}';
    document.head.appendChild(push);
  }

  function _wrapHost(host) {
    if (host.parentNode && host.parentNode.id === '_etbv2_viewport') {
      _viewport = host.parentNode;
      _host = host;
      return true;
    }

    var parent = host.parentNode;
    if (!parent) return false;

    _viewport = document.createElement('div');
    _viewport.id = '_etbv2_viewport';
    parent.insertBefore(_viewport, host);
    _viewport.appendChild(host);
    _host = host;
    return true;
  }

  return {
    height: function () { return BAR_H; },

    init: function () {
      _host = _findHost();
      var hostSel = _host ? ('#' + (_host.id || 'root')) : '#root';

      if (_host && _wrapHost(_host)) {
        _injectStyles(hostSel, true);
        _mode = 'shell';
        return;
      }

      if (_host) {
        _injectStyles(hostSel, false);
      }
      console.warn('[ETB] shell: viewport wrap skipped — using fixed-toolbar fallback');
      _injectFallbackStyles();
      _mode = 'fallback';
    },

    getViewport: function () {
      if (_mode === 'shell' && _viewport) return _viewport;
      return document.body;
    },

    isFallback: function () {
      return _mode === 'fallback';
    }
  };
})();
