// ── LIBRARY PANEL ──────────────────────────────────────────────────────────
// Opens the embedded Library SPA (_ETB_LIBRARY_HTML — the main project's
// single-file Vite build, inlined by build.js) in a full-screen overlay iframe
// via a blob: URL — no local HTTP server required.
//
// Auth handoff: the Main Backend token is passed through the URL hash
// (#token=…). A synchronous shim spliced into the bundle's <head> by build.js
// lifts it into window.__MB_TOKEN__ BEFORE React boots, so the SPA's first API
// request already carries the credential (no race with React Query).
//
// Loading strategy: the iframe is NEVER mounted with an empty token. If the
// token is not yet available when the panel opens, a spinner is shown until
// ETB.auth.onToken resolves. This eliminates the "Authorization failed" error
// that appeared when users opened Library before the auth flow completed (a
// race visible on Linux where httpOnly cookie access may be delayed).
//
// Exposes: ETB.library.open(), ETB.library.close(), ETB.library.isOpen(),
//          ETB.library.toggle()

ETB.library = (function () {
  // Shared across re-injections so remount/close stay in sync.
  window.__etbLibBlobUrl = window.__etbLibBlobUrl || null;
  var _keyHandler = null;

  var LIB_STYLES = [
    '#_etbv2_lib_ov{',
      'position:absolute;inset:0;z-index:2147483632;',
      'background:var(--etb-bg,#0a0a0a);',
      'display:flex;flex-direction:column;',
      'animation:_etbv2_slide_in .18s ease;',
    '}',
    '#_etbv2_root[data-etb-fallback] ~ #_etbv2_viewport #_etbv2_lib_ov,',
    'body:not(:has(#_etbv2_viewport)) #_etbv2_lib_ov{',
      'position:fixed;inset:0;',
    '}',
    '#_etbv2_lib_frame{flex:1;border:none;display:block;width:100%;}',
    '#_etbv2_lib_close{',
      'position:absolute;top:8px;right:14px;z-index:2147483633;',
      'width:28px;height:28px;border-radius:12px;cursor:pointer;',
      'display:flex;align-items:center;justify-content:center;',
      'background:var(--etb-s2,#161616);color:var(--etb-tx2,#888);',
      'border:1px solid var(--etb-bd2,rgba(255,255,255,.13));',
      'font-size:15px;line-height:1;',
      'transition:color .12s,border-color .12s;',
    '}',
    '#_etbv2_root[data-etb-fallback] ~ #_etbv2_viewport #_etbv2_lib_close{',
      'position:fixed;top:8px;',
    '}',
    '#_etbv2_lib_close:hover{color:var(--etb-a,#C67E34);',
      'border-color:rgba(var(--etb-ar,198,126,52),.4);}',
    '#_etbv2_lib_loader{',
      'position:absolute;inset:0;',
      'display:flex;flex-direction:column;align-items:center;justify-content:center;',
      'gap:16px;color:var(--etb-tx2,#888);font-size:13px;',
      'font-family:-apple-system,system-ui,sans-serif;',
    '}',
    '@keyframes _etbv2_spin{to{transform:rotate(360deg)}}',
    '#_etbv2_lib_spinner{',
      'width:28px;height:28px;border-radius:50%;',
      'border:2px solid var(--etb-bd2,rgba(255,255,255,.13));',
      'border-top-color:var(--etb-a,#C67E34);',
      'animation:_etbv2_spin .7s linear infinite;',
    '}'
  ].join('');

  function _ensureStyles() {
    if (document.getElementById('_etbv2_lib_styles')) return;
    var s = document.createElement('style');
    s.id = '_etbv2_lib_styles';
    s.textContent = LIB_STYLES;
    document.head.appendChild(s);
  }

  // (Re)mount the SPA into the iframe carrying `token` in the URL hash. The
  // bundle's <head> shim lifts the hash into window.__MB_TOKEN__ before React
  // boots, then strips it so the HashRouter starts on a clean route.
  //
  // A FRESH blob: URL is minted on every call — this is essential. Re-pointing
  // the iframe at the same blob URL with only a different #hash is a same-
  // document navigation: the browser fires hashchange but does NOT reload, so
  // the shim never re-runs and the new token is ignored. A new blob URL is a
  // distinct document → a real load → the shim runs with the token.
  function _mountFrame(iframe, token) {
    if (window.__etbLibBlobUrl) URL.revokeObjectURL(window.__etbLibBlobUrl);
    var blob = new Blob([_ETB_LIBRARY_HTML], { type: 'text/html' });
    window.__etbLibBlobUrl = URL.createObjectURL(blob);
    // Pass the live Extella theme alongside the token. The bundle's <head> shim
    // lifts #theme into window.__MB_THEME__ so the SPA boots already themed (no
    // light→dark flash); live changes after boot arrive via postMessage below.
    var theme = (ETB.theme && ETB.theme.current) ? ETB.theme.current() : 'dark';
    iframe.src = window.__etbLibBlobUrl +
      '#token=' + encodeURIComponent(token || '') +
      '&theme=' + encodeURIComponent(theme);
  }

  // Build a loading spinner shown while awaiting the auth token.
  // Removed once the token arrives and the iframe is mounted.
  function _makeLoader() {
    var el = document.createElement('div');
    el.id = '_etbv2_lib_loader';
    el.innerHTML = '<div id="_etbv2_lib_spinner"></div><span>Connecting…</span>';
    return el;
  }

  // Mount the iframe ONLY after a valid token is available. If the token is
  // already present the iframe loads immediately (common case: user already
  // authenticated). If not, a spinner holds the panel open until onToken fires
  // (or auth times out and triggers the manual-token prompt in auth.js).
  //
  // This prevents the Library SPA from ever booting with an empty __MB_TOKEN__,
  // which caused "Authorization failed" on pages that made fresh API requests.
  function _loadWithToken(iframe, loaderEl) {
    var initial = ETB.auth.getToken();
    if (initial) {
      if (loaderEl && loaderEl.parentNode) loaderEl.parentNode.removeChild(loaderEl);
      _mountFrame(iframe, initial);
      return;
    }
    // Честный таймаут: «Connecting…» не должен висеть вечно без токена
    var _libTmr = setTimeout(function () {
      if (loaderEl && loaderEl.parentNode) {
        loaderEl.innerHTML = '<span>Не удалось подключиться к аккаунту. Перезапусти Extella (⌘Q) и открой Library снова. / Could not connect — restart Extella and reopen Library.</span>';
      }
    }, 45000);
    ETB.auth.onToken(function (token) {
      if (!token || !iframe.isConnected) return;
      clearTimeout(_libTmr);
      if (loaderEl && loaderEl.parentNode) loaderEl.parentNode.removeChild(loaderEl);
      _mountFrame(iframe, token);
    });
  }

  // Live theme: when the Extella theme changes, push it into the embedded
  // Library iframe so it restyles in place. We postMessage instead of remounting
  // (remount would mint a fresh blob doc and drop the SPA's React state).
  if (!window.__etbLibThemeHook && ETB.theme && ETB.theme.onChange) {
    window.__etbLibThemeHook = true;
    ETB.theme.onChange(function (theme) {
      var iframe = document.getElementById('_etbv2_lib_frame');
      if (iframe && iframe.contentWindow) {
        iframe.contentWindow.postMessage({ __etbTheme: theme }, '*');
      }
    });
  }

  // Remount Library when the signed-in account changes so __MB_TOKEN__ updates.
  if (!window.__etbLibSessionHook) {
    window.__etbLibSessionHook = true;
    ETB.auth.onSessionChange(function (ev) {
    if (!ev.token || ev.cleared) return;
    var iframe = document.getElementById('_etbv2_lib_frame');
    if (!iframe || !iframe.isConnected) return;
    var ov = document.getElementById('_etbv2_lib_ov');
    if (!ov) return;
    var loader = document.getElementById('_etbv2_lib_loader');
    if (!loader) {
      loader = _makeLoader();
      loader.querySelector('span').textContent = 'Switching account…';
      ov.appendChild(loader);
    }
    _mountFrame(iframe, ev.token);
    if (loader.parentNode) loader.parentNode.removeChild(loader);
    });
  }

  return {
    open: function () {
      if (document.getElementById('_etbv2_lib_ov')) return;
      if (typeof _ETB_LIBRARY_HTML !== 'string' || !_ETB_LIBRARY_HTML) {
        console.warn('[ETB] Library bundle is empty — build the main project ' +
          '(`npm run build`) before `node build.js`.');
        return;
      }
      _ensureStyles();

      var ov = document.createElement('div');
      ov.id = '_etbv2_lib_ov';

      var iframe = document.createElement('iframe');
      iframe.id = '_etbv2_lib_frame';
      iframe.setAttribute('allow', 'clipboard-read;clipboard-write');
      ov.appendChild(iframe);

      // Spinner shown until token arrives (instantly removed when already authed).
      var loader = _makeLoader();
      ov.appendChild(loader);

      var mount = (ETB.shell && ETB.shell.getViewport)
        ? ETB.shell.getViewport()
        : (document.getElementById('_etbv2_root') || document.body);
      mount.appendChild(ov);

      _loadWithToken(iframe, loader);

      _keyHandler = function (e) {
        if (e.key === 'Escape') ETB.nav.set('chat');
      };
      window.addEventListener('keydown', _keyHandler);

      // Do NOT call ETB.nav.syncUI() here — nav.set() already called _paintTabs()
      // before invoking open(). Calling syncUI() now could race with another
      // overlay that is still animating closed (150ms DOM removal delay).
    },

    close: function (opts) {
      if (_keyHandler) {
        window.removeEventListener('keydown', _keyHandler);
        _keyHandler = null;
      }
      var close = document.getElementById('_etbv2_lib_close');
      if (close && close.parentNode) close.parentNode.removeChild(close);

      var ov = document.getElementById('_etbv2_lib_ov');
      if (ov) {
        ov.style.animation = '_etbv2_slide_out .15s ease forwards';
        setTimeout(function () {
          if (ov.parentNode) ov.parentNode.removeChild(ov);
          if (window.__etbLibBlobUrl) {
            URL.revokeObjectURL(window.__etbLibBlobUrl);
            window.__etbLibBlobUrl = null;
          }
        }, 150);
      }
      if (!opts || !opts.silent) ETB.nav.syncUI();
    },

    isOpen: function () {
      return !!document.getElementById('_etbv2_lib_ov');
    },

    toggle: function () {
      if (this.isOpen()) ETB.nav.set('chat');
      else ETB.nav.set('library');
    }
  };
})();
