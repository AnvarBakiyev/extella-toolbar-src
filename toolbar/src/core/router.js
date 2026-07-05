// ── ROUTER MODULE ──────────────────────────────────────────────────────────
// Opens plugin UIs: inline iframe panel, external URL, or plugin chat.
// Panels are kept alive in an LRU cache (up to CACHE_MAX entries) so that
// navigating away and back preserves the full iframe state (chat history,
// scroll position, in-flight requests, etc.).
//
// Exposes: ETB.router.open(plugin), ETB.router.close(), ETB.router.isOpen()

ETB.router = (function () {
  var CACHE_MAX = 5; // max live panels in DOM simultaneously

  // cache entry: { panel, blobUrl, lastUsed (ms timestamp) }
  var _cache = {};
  var _activeId = null; // pluginId of currently visible panel

  if (!window.__etbRouterSessionHook) {
    window.__etbRouterSessionHook = true;
    ETB.auth.onSessionChange(function (ev) {
      if (!ev.token || ev.cleared || !window.__etbResendInit) return;
      window.__etbResendInit(ev.token);
    });
  }

  function _currentTheme() {
    return (ETB.theme && ETB.theme.current) ? ETB.theme.current() : 'dark';
  }

  function _postThemeToIframe(iframe, theme) {
    if (!iframe || !iframe.contentWindow) return;
    try {
      iframe.contentWindow.postMessage({ type: 'etb_theme', theme: theme || _currentTheme() }, '*');
    } catch (e) {}
  }

  // Push live theme changes into every cached plugin iframe (chat/form/html).
  if (!window.__etbRouterThemeHook && ETB.theme && ETB.theme.onChange) {
    window.__etbRouterThemeHook = true;
    ETB.theme.onChange(function (theme) {
      Object.keys(_cache).forEach(function (id) {
        var panel = _cache[id] && _cache[id].panel;
        if (!panel) return;
        var iframe = panel.querySelector('iframe');
        _postThemeToIframe(iframe, theme);
      });
    });
  }

  function _wireIframeToken(iframe, sendFn) {
    function _send(token) { sendFn(token); }
    var t = ETB.auth.getToken();
    _send(t);
    if (!t) ETB.auth.onToken(function (late) { if (iframe.isConnected) _send(late); });
    window.__etbResendInit = function (token) {
      if (iframe.isConnected) sendFn(token);
    };
  }

  // Destroy a cached entry: remove from DOM, revoke blob URL.
  function _evict(pluginId) {
    var entry = _cache[pluginId];
    if (!entry) return;
    if (entry.panel) {
      if (entry.panel.__etbPmHandler) {
        window.removeEventListener('message', entry.panel.__etbPmHandler);
        entry.panel.__etbPmHandler = null;
      }
      if (entry.panel.parentNode) entry.panel.parentNode.removeChild(entry.panel);
    }
    if (entry.blobUrl) { try { URL.revokeObjectURL(entry.blobUrl); } catch (_) {} }
    delete _cache[pluginId];
  }

  // Evict the least-recently-used entry when cache is full.
  function _evictLRU() {
    var ids = Object.keys(_cache);
    if (ids.length < CACHE_MAX) return;
    var oldest = ids.reduce(function (a, b) {
      return (_cache[a].lastUsed || 0) < (_cache[b].lastUsed || 0) ? a : b;
    });
    _evict(oldest);
  }

  // Inject the spinner keyframe once (router may render before any panel that
  // defines it). Idempotent via the style element id.
  function _ensureRepairStyles() {
    if (document.getElementById('_etbv2_router_styles')) return;
    var s = document.createElement('style');
    s.id = '_etbv2_router_styles';
    s.textContent = '@keyframes _etbv2_spin{to{transform:rotate(360deg)}}';
    document.head.appendChild(s);
  }

  // Slim, non-blocking progress strip pinned to the TOP of a panel's content
  // area. It overlays (does not replace) the live UI, so the agent run does not
  // feel like a separate popup window. Returns the bar element.
  function _renderRepairProgress(content, plugin, phase) {
    if (!content) return null;
    _ensureRepairStyles();
    var prev = content.querySelector('._etb_rep_bar');
    if (prev) prev.parentNode.removeChild(prev);
    var bar = document.createElement('div');
    bar.className = '_etb_rep_bar';
    bar.style.cssText = [
      'position:absolute;top:0;left:0;right:0;z-index:6;',
      'display:flex;align-items:center;gap:10px;',
      'padding:8px 14px;box-sizing:border-box;',
      'background:var(--etb-s1,#111);',
      'border-bottom:1px solid var(--etb-bd,rgba(255,255,255,.08));',
      'font-family:-apple-system,system-ui,sans-serif;',
      'animation:_etbv2_slide_in .18s ease;'
    ].join('');
    bar.innerHTML = [
      '<div style="width:15px;height:15px;flex-shrink:0;border:2px solid #2a2a2a;',
      'border-top-color:#C67E34;border-radius:50%;animation:_etbv2_spin .7s linear infinite;"></div>',
      '<div style="font-size:12px;font-weight:700;color:var(--etb-tx,#f0f0f0);flex-shrink:0;">',
      'Agent</div>',
      '<div class="_etb_rep_phase" style="font-size:12px;color:var(--etb-tx2,#aaa);',
      'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;">',
      _esc(phase || 'Working'), '…</div>'
    ].join('');
    content.appendChild(bar);
    return bar;
  }

  // Turn the progress strip into an inline error notice with optional Retry button.
  function _renderRepairError(bar, content, msg, onRetry) {
    if (!bar && content) bar = _renderRepairProgress(content, {}, '');
    if (!bar) return;
    bar.style.background = 'rgba(40,18,18,.97)';
    bar.style.borderBottomColor = 'rgba(220,90,90,.5)';
    var retryBtn = onRetry
      ? '<button class="_etb_rep_retry" style="background:rgba(198,126,52,.2);border:1px solid rgba(198,126,52,.5);' +
        'color:#C67E34;cursor:pointer;font-size:11px;padding:3px 10px;border-radius:5px;flex-shrink:0;">Retry</button>'
      : '';
    bar.innerHTML = [
      '<div style="font-size:14px;flex-shrink:0;">&#9888;</div>',
      '<div style="font-size:12px;color:#f0c9c9;flex:1;overflow:hidden;',
      'text-overflow:ellipsis;white-space:nowrap;">Agent repair failed: ',
      _esc(String(msg || 'unknown error').slice(0, 140)), '</div>',
      retryBtn,
      '<button class="_etb_rep_close" style="background:none;border:none;color:#f0c9c9;',
      'cursor:pointer;font-size:14px;padding:0 4px;flex-shrink:0;">&#10005;</button>'
    ].join('');
    var close = bar.querySelector('._etb_rep_close');
    if (close) close.onclick = function () { if (bar.parentNode) bar.parentNode.removeChild(bar); };
    if (onRetry) {
      var retryEl = bar.querySelector('._etb_rep_retry');
      if (retryEl) retryEl.onclick = function () {
        if (bar.parentNode) bar.parentNode.removeChild(bar);
        onRetry();
      };
    }
    // Auto-dismiss after 20s (longer when there's a Retry button).
    setTimeout(function () { if (bar && bar.parentNode) bar.parentNode.removeChild(bar); },
      onRetry ? 20000 : 8000);
  }

  // Resolve the live URL for a service/local_server plugin.
  function _serviceUrl(plugin) {
    var ui = plugin.ui || {};
    var port = ui.port || (plugin.service && plugin.service.port);
    if (!port) return '';
    var mainFile = (ui.mainFile && ui.mainFile !== 'index.html') ? ui.mainFile : '';
    return 'http://localhost:' + port + (mainFile ? '/' + mainFile : '');
  }

  // Open a URL in the user's default browser. In Extella Desktop, window.open is
  // intercepted by setWindowOpenHandler → shell.openExternal (opens externally).
  function _openUrlExternal(url) {
    if (!url) return;
    try { window.open(url, '_blank'); } catch (e) {}
  }

  // Card shown for apps whose own web UI cannot be embedded in an iframe.
  function _renderOpenExternalCard(content, plugin) {
    if (!content) return;
    var pid = plugin.id ? plugin.id.replace(/'/g, '') : '';
    var url = _serviceUrl(plugin);
    content.innerHTML = [
      '<div style="display:flex;align-items:center;justify-content:center;height:100%;',
      'padding:32px;font-family:-apple-system,system-ui,sans-serif;">',
      '<div style="max-width:420px;text-align:center;">',
      '<div style="font-size:40px;margin-bottom:16px;">&#127759;</div>',
      '<div style="font-size:16px;font-weight:700;color:var(--etb-tx,#f0f0f0);margin-bottom:8px;">',
      _esc(plugin.name), ' is running</div>',
      '<div style="font-size:13px;color:var(--etb-tx2,#888);line-height:1.6;margin-bottom:22px;">',
      'This tool runs its own interface that can\'t be shown inside the panel. ',
      'Open it in your browser', url ? ' (' + _esc(url) + ')' : '', '.</div>',
      '<div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">',
      '<button onclick="ETB.router._openExternal(\'' + _esc(pid) + '\')" style="' +
      'background:#C67E34;border:none;color:#000;font-weight:700;border-radius:9px;' +
      'padding:10px 22px;cursor:pointer;font-size:12px;">&#127759; Open ' + _esc(plugin.name) + '</button>',
      '<button onclick="ETB.router._repairWithAgent(\'' + _esc(pid) + '\')" style="' +
      'background:var(--etb-s3,#1a1a1a);border:1px solid var(--etb-bd2,#333);color:var(--etb-tx,#f0f0f0);border-radius:9px;' +
      'padding:10px 22px;cursor:pointer;font-size:12px;">&#10024; Repair with agent</button>',
      '</div></div></div>'
    ].join('');
  }

  // ── Server fallback card ────────────────────────────────────────
  function _renderServerFallback(content, plugin) {
    var ui = plugin.ui || {};
    var pid = plugin.id ? plugin.id.replace(/'/g, '') : '';
    content.innerHTML = [
      '<div style="display:flex;align-items:center;justify-content:center;height:100%;',
      'padding:32px;font-family:-apple-system,system-ui,sans-serif;">',
      '<div style="max-width:400px;text-align:center;">',
      '<div style="font-size:40px;margin-bottom:16px;">&#9681;</div>',
      '<div style="font-size:16px;font-weight:700;color:var(--etb-tx,#f0f0f0);margin-bottom:8px;">',
      _esc(plugin.name), ' is not running</div>',
      '<div style="font-size:13px;color:var(--etb-tx2,#888);line-height:1.6;margin-bottom:24px;">',
      'Local server is offline (port ', String(ui.port || ''), '). ',
      'Start it, or let the agent install dependencies and run it for you.</div>',
      '<div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">',
      '<button onclick="ETB.router._repairWithAgent(\'' + _esc(pid) + '\')" style="' +
      'background:#C67E34;border:none;color:#000;font-weight:700;border-radius:9px;' +
      'padding:10px 22px;cursor:pointer;font-size:12px;">&#10024; Run with agent</button>',
      ui.startExpert
        ? '<button onclick="ETB.router._startServer(\'' + _esc(pid) + '\')" style="' +
          'background:var(--etb-s3,#1a1a1a);border:1px solid var(--etb-bd2,#333);color:var(--etb-tx,#f0f0f0);border-radius:9px;' +
          'padding:10px 22px;cursor:pointer;font-size:12px;">&#9654; Start server</button>'
        : '',
      '<button onclick="ETB.router._retryServer(\'' + _esc(pid) + '\')" style="' +
      'background:var(--etb-s3,#1a1a1a);border:1px solid var(--etb-bd2,#333);color:var(--etb-tx,#f0f0f0);border-radius:9px;' +
      'padding:10px 22px;cursor:pointer;font-size:12px;">&#8635; Retry</button>',
      '</div>',
      '</div></div>'
    ].join('');
  }

  // Runtime health overlay shown when an embedded/generated UI reports failure.
  function _renderHealthFallback(content, plugin, error) {
    var overlay = document.createElement('div');
    overlay.style.cssText = [
      'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;',
      'padding:32px;background:var(--etb-bg,#0a0a0a);',
      'font-family:-apple-system,system-ui,sans-serif;z-index:5;'
    ].join('');
    var pid = plugin.id ? plugin.id.replace(/'/g, '') : '';
    overlay.innerHTML = [
      '<div style="max-width:420px;text-align:center;">',
      '<div style="font-size:38px;margin-bottom:14px;">&#9888;</div>',
      '<div style="font-size:16px;font-weight:700;color:var(--etb-tx,#f0f0f0);margin-bottom:8px;">',
      _esc(plugin.name), ' UI failed to load</div>',
      '<div style="font-size:13px;color:var(--etb-tx2,#888);line-height:1.6;margin-bottom:20px;">',
      'The interface did not initialize correctly. Let the agent diagnose and fix it,',
      ' or remove the plugin and re-add it to rebuild.',
      error ? '<br><span style="color:#a55;font-size:11px;">' + _esc(String(error).slice(0, 200)) + '</span>' : '',
      '</div>',
      '<button onclick="ETB.router._repairWithAgent(\'' + _esc(pid) + '\')" style="' +
      'background:#C67E34;border:none;color:#000;font-weight:700;border-radius:9px;' +
      'padding:10px 22px;cursor:pointer;font-size:12px;">&#10024; Fix with agent</button>',
      '</div>'
    ].join('');
    content.appendChild(overlay);
  }

  // Listen for an etb_ui_health signal from a generated/CDN-embed iframe.
  // Only reacts to an explicit failure (ok:false) so UIs that never emit a
  // health signal (raw served sites, legacy plugins) are unaffected.
  function _attachHealthWatchdog(iframe, content, plugin) {
    var expectsHealth = !!(plugin && plugin.ui && plugin.ui.expectsHealth);
    var positiveTimer = null;
    function onMsg(e) {
      if (!e.data || e.data.type !== 'etb_ui_health') return;
      if (iframe.contentWindow && e.source !== iframe.contentWindow) return;
      window.removeEventListener('message', onMsg);
      if (positiveTimer) { clearTimeout(positiveTimer); positiveTimer = null; }
      if (e.data.ok === false) _renderHealthFallback(content, plugin, e.data.error);
    }
    window.addEventListener('message', onMsg);
    // For embeds we control (cdn), require a positive ok:true. If none arrives,
    // the component never mounted (blank) → fallback. Raw/build/legacy UIs that
    // never emit health are unaffected (expectsHealth=false).
    if (expectsHealth) {
      positiveTimer = setTimeout(function () {
        if (iframe.isConnected) {
          window.removeEventListener('message', onMsg);
          _renderHealthFallback(content, plugin, 'UI did not signal a successful render');
        }
      }, 12000);
    }
    // Auto-detach if the panel is torn down before any signal.
    setTimeout(function () {
      if (!iframe.isConnected) {
        window.removeEventListener('message', onMsg);
        if (positiveTimer) { clearTimeout(positiveTimer); positiveTimer = null; }
      }
    }, 30000);
  }

  // Check server availability then load iframe, or show fallback.
  // Must use no-cors: the local Python http.server has no CORS headers, so a
  // standard fetch from the HTTPS Extella page would always reject regardless
  // of whether the server is up. no-cors gives an opaque response when the
  // server responds (any status), and rejects only on network error (port closed).
  // AbortController adds a 4-second hard timeout for hung connections.
  function _checkAndLoadServer(iframe, serverUrl, content, plugin) {
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, 4000) : null;
    var fetchOpts = { method: 'HEAD', mode: 'no-cors' };
    if (controller) fetchOpts.signal = controller.signal;

    fetch(serverUrl, fetchOpts)
      .then(function () {
        if (timer) clearTimeout(timer);
        // Hand the locally-served UI the same bridge html-type plugins get, so
        // its buttons can call /api/expert/run directly (token + apiBase).
        // For HuggingFace remote-model plugins, also pass the hf_token so the
        // generated UI can authenticate to the HF Inference API.
        iframe.addEventListener('load', function () {
          _wireIframeToken(iframe, function (token) {
            var needsHfToken = !!(plugin.hf && plugin.hf.needsToken && plugin.hf.tokenKvKey);
            var hfTokenPromise = needsHfToken
              ? ETB.api.kvGet(plugin.hf.tokenKvKey).then(function (r) { return (r && r.value) || ''; }).catch(function () { return ''; })
              : Promise.resolve('');
            hfTokenPromise.then(function (hfToken) {
              try {
                var initMsg = {
                  type: 'etb_init',
                  pluginId: plugin.id,
                  token: token,
                  apiBase: 'https://api.extella.ai',
                  experts: plugin.experts || [],
                  theme: _currentTheme()
                };
                if (hfToken) initMsg.hf_token = hfToken;
                iframe.contentWindow.postMessage(initMsg, '*');
                _postThemeToIframe(iframe);
              } catch (e) {}
            });
          });
        }, { once: true });
        iframe.style.display = 'block';
        var _sep = serverUrl.indexOf('?') === -1 ? '?' : '&';
        iframe.src = serverUrl + _sep + '_t=' + Date.now();
      })
      .catch(function () {
        if (timer) clearTimeout(timer);
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
        _renderServerFallback(content, plugin);
      });
  }

  function _buildPanel(plugin) {
    var panel = document.createElement('div');
    panel.style.cssText = [
      (ETB.shell && ETB.shell.isFallback && ETB.shell.isFallback())
        ? 'position:fixed;top:0;left:0;right:0;bottom:0;'
        : 'position:absolute;inset:0;',
      'z-index:2147483630;',
      'background:var(--etb-bg, #0a0a0a);',
      'display:flex;flex-direction:column;',
      'animation:_etbv2_slide_in .18s ease;'
    ].join('');

    // Header
    var hdr = document.createElement('div');
    hdr.style.cssText = [
      'display:flex;align-items:center;gap:10px;',
      'padding:10px 18px;',
      'border-bottom:1px solid var(--etb-bd, rgba(255,255,255,.07));',
      'background:var(--etb-s1, #111);flex-shrink:0;'
    ].join('');

    var ui = plugin.ui || {};

    // Build header content; add "Open in Finder" button if filePath is set
    var openFileBtn = '';
    if (ui.filePath) {
      var escapedPath = _esc(String(ui.filePath || ''));
      openFileBtn = '<button id="_etb_open_file_btn" title="Copy file path: ' + escapedPath + '" style="' +
        'background:none;border:none;color:var(--etb-tx2,#888);cursor:pointer;' +
        'font-size:14px;padding:4px 8px;border-radius:6px;transition:background .1s;">' +
        '&#128193;</button>';
    }

    // Open-in-browser button for server-backed plugins.
    var browserBtn = '';
    if (ui.type === 'local_server' || plugin.service) {
      var bpid = plugin.id ? plugin.id.replace(/'/g, '') : '';
      browserBtn = '<button onclick="ETB.router._openExternal(\'' + _esc(bpid) + '\')" ' +
        'title="Open this tool in your browser" style="' +
        'background:none;border:none;color:var(--etb-tx2,#888);cursor:pointer;' +
        'font-size:14px;padding:4px 8px;border-radius:6px;transition:background .1s;">' +
        '&#127759;</button>';
    }

    // Run-mode toggle for HuggingFace plugins
    var hfModeToggle = '';
    if (plugin.type === 'huggingface' && plugin.hf) {
      var currentMode = (plugin.hf && plugin.hf.runMode) || plugin.mode || 'local';
      var safePid = plugin.id ? plugin.id.replace(/'/g, '') : '';
      hfModeToggle = [
        '<div style="display:flex;gap:2px;background:var(--etb-s3,#1c1c1c);',
        'border:1px solid var(--etb-bd2,rgba(255,255,255,.13));border-radius:8px;padding:2px;">',
        '<button onclick="ETB.router._hfSwitchMode(\'' + _esc(safePid) + '\',\'local\')" style="',
        'background:' + (currentMode === 'local' ? 'var(--etb-s4,#242424)' : 'none') + ';',
        'border:none;color:' + (currentMode === 'local' ? 'var(--etb-tx,#f0f0f0)' : 'var(--etb-tx2,#888)') + ';',
        'font-size:11px;font-weight:' + (currentMode === 'local' ? '700' : '500') + ';',
        'padding:3px 10px;border-radius:6px;cursor:pointer;font-family:inherit;transition:all .14s;">',
        '💻 Local</button>',
        '<button onclick="ETB.router._hfSwitchMode(\'' + _esc(safePid) + '\',\'remote\')" style="',
        'background:' + (currentMode === 'remote' ? 'var(--etb-s4,#242424)' : 'none') + ';',
        'border:none;color:' + (currentMode === 'remote' ? 'var(--etb-tx,#f0f0f0)' : 'var(--etb-tx2,#888)') + ';',
        'font-size:11px;font-weight:' + (currentMode === 'remote' ? '700' : '500') + ';',
        'padding:3px 10px;border-radius:6px;cursor:pointer;font-family:inherit;transition:all .14s;">',
        '☁️ HF</button>',
        '</div>'
      ].join('');
    }

    hdr.innerHTML = [
      '<div style="width:8px;height:8px;border-radius:50%;background:#C67E34;',
      'box-shadow:0 0 8px rgba(198,126,52,.4);"></div>',
      '<span style="font-size:13px;font-weight:600;color:var(--etb-tx,#f0f0f0);">',
      _esc(plugin.name), '</span>',
      '<span style="font-size:11px;color:var(--etb-tx2,#888);">', _esc(plugin.tagline || ''), '</span>',
      '<div style="flex:1"></div>',
      hfModeToggle,
      browserBtn,
      openFileBtn,
      '<button class="_etbv2_panel_close" style="background:none;border:none;',
      'color:var(--etb-tx2,#888);cursor:pointer;font-size:18px;padding:4px 8px;',
      'border-radius:6px;transition:background .1s;" title="Close">&#10005;</button>'
    ].join('');
    panel.appendChild(hdr);

    // Wire "Open in Finder" click — copy path to clipboard as reliable cross-env action
    if (ui.filePath) {
      var openFileEl = hdr.querySelector('#_etb_open_file_btn');
      if (openFileEl) {
        openFileEl.onclick = function () {
          try { navigator.clipboard.writeText(String(ui.filePath)); } catch (_) {}
          openFileEl.title = 'Path copied!';
          setTimeout(function () { openFileEl.title = 'Copy file path: ' + _esc(String(ui.filePath)); }, 2000);
        };
      }
    }

    // Content area
    var content = document.createElement('div');
    content.style.cssText = 'flex:1;overflow:hidden;position:relative;';

    var uiType = ui.type || 'chat';
    var blobUrl = null;

    if (uiType === 'iframe' && ui.url) {
      var iframe = document.createElement('iframe');
      iframe.src = ui.url;
      iframe.style.cssText = 'width:100%;height:100%;border:none;display:block;';
      iframe.setAttribute('allow', 'clipboard-read;clipboard-write');
      content.appendChild(iframe);

    } else if (uiType === 'html' && ui.html) {
      var htmlBlob = new Blob([ui.html], { type: 'text/html' });
      blobUrl = URL.createObjectURL(htmlBlob);
      var iframe = document.createElement('iframe');
      iframe.src = blobUrl;
      iframe.style.cssText = 'width:100%;height:100%;border:none;display:block;';
      iframe.setAttribute('allow', 'clipboard-read;clipboard-write');
      iframe.addEventListener('load', function () {
        _wireIframeToken(iframe, function (token) {
          try {
            iframe.contentWindow.postMessage({
              type: 'etb_init',
              pluginId: plugin.id,
              token: token,
              apiBase: 'https://api.extella.ai',
              experts: plugin.experts || [],
              theme: _currentTheme()
            }, '*');
            _postThemeToIframe(iframe);
          } catch (e) {}
        });
      }, { once: true });
      _attachHealthWatchdog(iframe, content, plugin);
      content.appendChild(iframe);

    } else if (uiType === 'chat' || uiType === 'github') {
      var chatBlob = new Blob([_ETB_CHAT_HTML], { type: 'text/html' });
      blobUrl = URL.createObjectURL(chatBlob);
      var iframe = document.createElement('iframe');
      iframe.src = blobUrl;
      iframe.style.cssText = 'width:100%;height:100%;border:none;display:block;';
      iframe.setAttribute('allow', 'clipboard-read;clipboard-write');
      iframe.addEventListener('load', function () {
        _wireIframeToken(iframe, function (token) {
          try {
            iframe.contentWindow.postMessage(
              { type: 'etb_init', pluginId: plugin.id, token: token, theme: _currentTheme() },
              '*'
            );
            _postThemeToIframe(iframe);
          } catch (e) {}
        });
      }, { once: true });
      content.appendChild(iframe);

    } else if (uiType === 'form') {
      var formBlob = new Blob([_ETB_FORM_HTML], { type: 'text/html' });
      blobUrl = URL.createObjectURL(formBlob);
      var iframe = document.createElement('iframe');
      iframe.src = blobUrl;
      iframe.style.cssText = 'width:100%;height:100%;border:none;display:block;';
      iframe.setAttribute('allow', 'clipboard-read;clipboard-write');
      iframe.addEventListener('load', function () {
        _wireIframeToken(iframe, function (token) {
          try {
            iframe.contentWindow.postMessage(
              { type: 'etb_init', pluginId: plugin.id, token: token, theme: _currentTheme() },
              '*'
            );
            _postThemeToIframe(iframe);
          } catch (e) {}
        });
      }, { once: true });
      content.appendChild(iframe);

    } else if (uiType === 'local_server') {
      // Apps that block iframe embedding (X-Frame-Options / CSP frame-ancestors)
      // render as a black screen. The agent flags these as openInBrowser so we
      // show a clean card with an external-open button instead of a dead iframe.
      if (ui.openInBrowser) {
        _renderOpenExternalCard(content, plugin);
      } else {
        var mainFile = (ui.mainFile && ui.mainFile !== 'index.html') ? ui.mainFile : '';
        var serverUrl = 'http://localhost:' + ui.port + (mainFile ? '/' + mainFile : '');
        var lsIframe = document.createElement('iframe');
        lsIframe.style.cssText = 'width:100%;height:100%;border:none;display:none;';
        lsIframe.setAttribute('allow', 'clipboard-read;clipboard-write');
        content.appendChild(lsIframe);
        _attachHealthWatchdog(lsIframe, content, plugin);
        _checkAndLoadServer(lsIframe, serverUrl, content, plugin);
      }

    } else {
      content.innerHTML = _renderInfoCard(plugin);
    }

    panel.appendChild(content);

    // Floating Repair overlay — always visible in the bottom-right corner.
    _injectRepairOverlay(content, plugin.id);

    // postMessage listeners scoped to this panel's iframe(s).
    function _srcIframe(e) {
      var iframes = content.querySelectorAll('iframe');
      for (var i = 0; i < iframes.length; i++) {
        try { if (iframes[i].contentWindow === e.source) return iframes[i]; } catch (_) {}
      }
      return iframes.length === 1 ? iframes[0] : null;
    }
    var _pmHandler = function (e) {
      if (!e.data || typeof e.data.type !== 'string') return;
      if (e.data.type === 'etb_repair_request') {
        _showRepairModal(plugin.id, e.data.description || '');
      } else if (e.data.type === 'etb_config_request') {
        _showCredentialsModal(_srcIframe(e), e.data.fields, e.data.title);
      } else if (e.data.type === 'etb_run_expert') {
        // Expert bridge: the plugin iframe (localhost origin) cannot call
        // api.extella.ai directly (cross-origin → "Failed to fetch"). Run the
        // expert here in the toolbar context, which has API access, and post
        // the result back. The iframe never holds the token or hits the API.
        var src = _srcIframe(e);
        var reqId = e.data.reqId;
        function reply(msg) { if (src && src.contentWindow) { try { src.contentWindow.postMessage(msg, '*'); } catch (_) {} } }
        try {
          ETB.api.runExpert(e.data.name, e.data.params || {}, { global: true })
            .then(function (res) { reply({ type: 'etb_expert_result', reqId: reqId, ok: true, res: res }); })
            .catch(function (err) { reply({ type: 'etb_expert_result', reqId: reqId, ok: false, error: (err && err.message) || 'expert failed' }); });
        } catch (err) {
          reply({ type: 'etb_expert_result', reqId: reqId, ok: false, error: (err && err.message) || 'expert failed' });
        }
      } else if (e.data.type === 'etb_kv_get' || e.data.type === 'etb_kv_set') {
        // Scoped KV bridge: like the expert bridge, the iframe cannot reach
        // api.extella.ai directly. The toolbar performs the KV op with its own
        // session token — the SAME namespace the storefront reads — so a merch
        // edit is guaranteed visible. SECURITY: only keys prefixed '_mkt_' are
        // allowed, so a plugin can never read secrets (huggingface_token, …)
        // or write outside the merch surface.
        var src2 = _srcIframe(e);
        var reqId2 = e.data.reqId;
        var key = String(e.data.key || '');
        function reply2(msg) { if (src2 && src2.contentWindow) { try { src2.contentWindow.postMessage(msg, '*'); } catch (_) {} } }
        if (key.indexOf('_mkt_') !== 0) {
          reply2({ type: 'etb_kv_result', reqId: reqId2, ok: false, error: 'key not allowed' });
          return;
        }
        try {
          if (e.data.type === 'etb_kv_get') {
            ETB.api.kvGet(key, { global: true })
              .then(function (r) { reply2({ type: 'etb_kv_result', reqId: reqId2, ok: true, value: (r && r.value != null) ? r.value : null }); })
              .catch(function (err) { reply2({ type: 'etb_kv_result', reqId: reqId2, ok: false, error: (err && err.message) || 'kv get failed' }); });
          } else {
            ETB.api.kvSet(key, e.data.value, e.data.description || 'Marketplace merch (toolbar editor)', { global: true })
              .then(function () { reply2({ type: 'etb_kv_result', reqId: reqId2, ok: true }); })
              .catch(function (err) { reply2({ type: 'etb_kv_result', reqId: reqId2, ok: false, error: (err && err.message) || 'kv set failed' }); });
          }
        } catch (err) {
          reply2({ type: 'etb_kv_result', reqId: reqId2, ok: false, error: (err && err.message) || 'kv failed' });
        }
      } else if (e.data.type === 'etb_rule_add' || e.data.type === 'etb_rule_remove') {
        // Rules bridge: Skills install/uninstall as always-on agent rules. The
        // iframe can't reach the API directly; the toolbar performs the op with
        // the user's own credential. Skill rules carry a marker prefix so they
        // are identifiable; the plugin manages only what it added.
        var src3 = _srcIframe(e);
        var reqId3 = e.data.reqId;
        function reply3(msg) { if (src3 && src3.contentWindow) { try { src3.contentWindow.postMessage(msg, '*'); } catch (_) {} } }
        try {
          if (e.data.type === 'etb_rule_add') {
            ETB.api.rulesAdd(String(e.data.rule || ''), e.data.agents)
              .then(function (refs) { reply3({ type: 'etb_rule_result', reqId: reqId3, ok: !!(refs && refs.length), refs: refs || [] }); })
              .catch(function (err) { reply3({ type: 'etb_rule_result', reqId: reqId3, ok: false, error: (err && err.message) || 'rule add failed' }); });
          } else {
            ETB.api.rulesRemove(e.data.refs || e.data.ruleId)
              .then(function () { reply3({ type: 'etb_rule_result', reqId: reqId3, ok: true }); })
              .catch(function (err) { reply3({ type: 'etb_rule_result', reqId: reqId3, ok: false, error: (err && err.message) || 'rule remove failed' }); });
          }
        } catch (err) {
          reply3({ type: 'etb_rule_result', reqId: reqId3, ok: false, error: (err && err.message) || 'rule failed' });
        }
      } else if (e.data.type === 'etb_agents_list') {
        // Agents bridge: let the Skills UI ask which agent to install a skill on.
        var src4 = _srcIframe(e);
        var reqId4 = e.data.reqId;
        function reply4(msg) { if (src4 && src4.contentWindow) { try { src4.contentWindow.postMessage(msg, '*'); } catch (_) {} } }
        try {
          ETB.api.agentsList()
            .then(function (r) {
              var list = (r && r.agents) || [];
              var slim = list.map(function (a) { return { id: a.id, name: a.name, model: a.model }; });
              reply4({ type: 'etb_agents_result', reqId: reqId4, ok: true, agents: slim });
            })
            .catch(function (err) { reply4({ type: 'etb_agents_result', reqId: reqId4, ok: false, error: (err && err.message) || 'agents list failed' }); });
        } catch (err) {
          reply4({ type: 'etb_agents_result', reqId: reqId4, ok: false, error: (err && err.message) || 'agents failed' });
        }
      }
    };
    window.addEventListener('message', _pmHandler);
    // Store handler on panel element for cleanup on panel eviction.
    panel.__etbPmHandler = _pmHandler;

    hdr.querySelector('._etbv2_panel_close').onclick = function () {
      ETB.router.close();
    };

    return { panel: panel, blobUrl: blobUrl };
  }

  function _renderInfoCard(plugin) {
    return [
      '<div style="display:flex;align-items:center;justify-content:center;',
      'height:100%;padding:32px;font-family:-apple-system,system-ui,sans-serif;">',
      '<div style="max-width:420px;text-align:center;">',
      '<div style="font-size:48px;margin-bottom:16px;">&#128268;</div>',
      '<div style="font-size:18px;font-weight:700;color:var(--etb-tx,#f0f0f0);margin-bottom:8px;">',
      _esc(plugin.name), '</div>',
      '<div style="font-size:13px;color:var(--etb-tx2,#888);line-height:1.6;margin-bottom:24px;">',
      _esc(plugin.description || ''), '</div>',
      '<div style="font-size:11px;color:#C67E34;">',
      'Plugin loaded. Use Extella chat to interact with this plugin.</div>',
      '</div></div>'
    ].join('');
  }

  function _esc(s) {
    return String(s || '').replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ── Repair / Credentials modals ────────────────────────────────────────────

  // Shared modal backdrop + card builder. Returns { backdrop, card }.
  function _buildModalShell(onBackdropClick) {
    var bd = document.createElement('div');
    bd.style.cssText = [
      'position:fixed;inset:0;z-index:2147483647;',
      'background:rgba(0,0,0,.45);backdrop-filter:blur(4px);',
      'display:flex;align-items:center;justify-content:center;',
      'animation:_etbv2_gh_fade .14s ease;',
      'font-family:-apple-system,system-ui,sans-serif;'
    ].join('');
    if (onBackdropClick) bd.addEventListener('click', function (e) {
      if (e.target === bd) onBackdropClick();
    });
    var card = document.createElement('div');
    card.style.cssText = [
      'background:var(--etb-s1,#fff);border:1px solid var(--etb-bd2,rgba(0,0,0,.14));',
      'border-radius:16px;width:440px;max-width:calc(100vw - 32px);',
      'box-shadow:0 16px 48px rgba(0,0,0,.18);overflow:hidden;'
    ].join('');
    bd.appendChild(card);
    document.body.appendChild(bd);
    return { backdrop: bd, card: card };
  }

  function _modalClose(bd) {
    if (bd && bd.parentNode) bd.parentNode.removeChild(bd);
  }

  // Repair modal: textarea describing the issue + confirmation.
  // Always performs a full reinstall from GitHub (no soft-reset option).
  function _showRepairModal(pluginId, prefillText) {
    var plugin = ETB.registry.getById(pluginId);
    var name = (plugin && plugin.name) || pluginId;
    var sh = _buildModalShell(function () { _modalClose(sh.backdrop); });

    // Step 1 — description textarea.
    function renderMain() {
      sh.card.innerHTML = [
        '<div style="display:flex;align-items:center;gap:10px;padding:18px 22px 16px;',
          'border-bottom:1px solid var(--etb-bd,rgba(0,0,0,.07));">',
          '<div style="width:8px;height:8px;border-radius:50%;background:#C67E34;flex-shrink:0;"></div>',
          '<span style="flex:1;font-size:15px;font-weight:700;color:var(--etb-tx,#111);">Repair Plugin</span>',
          '<button id="_etb_rm_close" style="background:none;border:none;color:var(--etb-tx2,#888);',
            'cursor:pointer;font-size:18px;padding:4px 6px;border-radius:5px;">&#10005;</button>',
        '</div>',
        '<div style="padding:20px 22px;">',
          '<div style="font-size:12px;color:var(--etb-tx2,#6b6b6b);margin-bottom:10px;">',
            'Plugin: <b style="color:var(--etb-tx,#111);">' + _esc(name) + '</b>',
          '</div>',
          '<label style="font-size:11px;font-weight:600;color:var(--etb-tx2,#6b6b6b);',
            'text-transform:uppercase;letter-spacing:.06em;display:block;margin-bottom:6px;">',
            'Describe the issue (optional)',
          '</label>',
          '<textarea id="_etb_rm_desc" rows="4" style="width:100%;background:#fff;',
            'border:1px solid var(--etb-bd2,rgba(0,0,0,.14));border-radius:9px;',
            'color:var(--etb-tx,#111);font-size:13px;padding:10px 14px;box-sizing:border-box;',
            'outline:none;resize:vertical;font-family:-apple-system,system-ui,sans-serif;">',
            _esc(prefillText || ''),
          '</textarea>',
          '<div style="font-size:11px;color:var(--etb-tx2,#aaa);margin-top:6px;line-height:1.4;">',
            'The agent will analyse the error, read recent logs, then delete and reinstall the plugin from scratch.',
          '</div>',
          '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px;">',
            '<button id="_etb_rm_cancel" style="background:var(--etb-s3,#f7f7f9);',
              'border:1px solid var(--etb-bd2,rgba(0,0,0,.14));color:var(--etb-tx2,#6b6b6b);',
              'border-radius:9px;padding:9px 18px;cursor:pointer;font-size:12px;">Cancel</button>',
            '<button id="_etb_rm_go" style="background:#C67E34;border:none;color:#000;font-weight:700;',
              'border-radius:9px;padding:9px 24px;cursor:pointer;font-size:12px;">Repair</button>',
          '</div>',
        '</div>'
      ].join('');

      sh.card.querySelector('#_etb_rm_close').onclick  = function () { _modalClose(sh.backdrop); };
      sh.card.querySelector('#_etb_rm_cancel').onclick = function () { _modalClose(sh.backdrop); };
      sh.card.querySelector('#_etb_rm_go').onclick     = function () {
        var desc = sh.card.querySelector('#_etb_rm_desc').value || '';
        renderConfirm(desc);
      };
    }

    // Step 2 — confirmation: shows what will happen + the note the user wrote.
    function renderConfirm(desc) {
      var noteHtml = desc
        ? '<div style="margin-bottom:16px;"><div style="font-size:11px;font-weight:600;color:var(--etb-tx2,#6b6b6b);' +
          'text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px;">Your note to the agent</div>' +
          '<div style="background:var(--etb-s3,#f7f7f9);border:1px solid var(--etb-bd2,rgba(0,0,0,.1));' +
          'border-radius:8px;padding:10px 12px;font-size:12px;color:var(--etb-tx,#111);line-height:1.5;">' +
          _esc(desc) + '</div></div>'
        : '';
      sh.card.innerHTML = [
        '<div style="display:flex;align-items:center;gap:10px;padding:18px 22px 16px;',
          'border-bottom:1px solid var(--etb-bd,rgba(0,0,0,.07));">',
          '<div style="width:8px;height:8px;border-radius:50%;background:#C67E34;flex-shrink:0;"></div>',
          '<span style="flex:1;font-size:15px;font-weight:700;color:var(--etb-tx,#111);">Confirm Repair</span>',
        '</div>',
        '<div style="padding:22px;">',
          '<div style="font-size:13px;color:var(--etb-tx,#111);line-height:1.6;margin-bottom:16px;">',
            'The entire plugin will be removed and reinstalled from GitHub. ',
            'The service will be stopped and restarted.',
          '</div>',
          noteHtml,
          '<div style="font-size:12px;color:var(--etb-tx2,#6b6b6b);margin-bottom:20px;">',
            'Plugin: <b style="color:var(--etb-tx,#111);">' + _esc(name) + '</b>',
          '</div>',
          '<div style="display:flex;gap:8px;justify-content:flex-end;">',
            '<button id="_etb_rc_back" style="background:var(--etb-s3,#f7f7f9);',
              'border:1px solid var(--etb-bd2,rgba(0,0,0,.14));color:var(--etb-tx2,#6b6b6b);',
              'border-radius:9px;padding:9px 18px;cursor:pointer;font-size:12px;">&#8592; Back</button>',
            '<button id="_etb_rc_go" style="background:#C67E34;border:none;color:#000;font-weight:700;',
              'border-radius:9px;padding:9px 20px;cursor:pointer;font-size:12px;">',
              'Delete &amp; Reinstall',
            '</button>',
          '</div>',
        '</div>'
      ].join('');

      sh.card.querySelector('#_etb_rc_back').onclick = function () { renderMain(); };
      sh.card.querySelector('#_etb_rc_go').onclick   = function () {
        _modalClose(sh.backdrop);
        ETB.router._cleanRebuildWithAgent(pluginId, true, desc);
      };
    }

    renderMain();
  }

  // Credentials modal: dynamic fields form, saves to KV, sends etb_config_response.
  function _showCredentialsModal(targetIframe, fields, title) {
    fields = Array.isArray(fields) ? fields : [];
    var sh = _buildModalShell(function () {
      _sendConfigResponse(targetIframe, null, true);
      _modalClose(sh.backdrop);
    });

    function _sendConfigResponse(iframe, values, cancelled) {
      try {
        if (iframe && iframe.contentWindow) {
          iframe.contentWindow.postMessage({
            type: 'etb_config_response',
            values: values || {},
            cancelled: !!cancelled
          }, '*');
        }
      } catch (e) {}
    }

    var fieldsHtml = fields.map(function (f) {
      var fid = _esc(f.id || '');
      var lbl = _esc(f.label || f.id || '');
      var typ = (f.type === 'password' || f.type === 'url') ? _esc(f.type) : 'text';
      return [
        '<div style="margin-bottom:14px;">',
          '<label style="font-size:11px;font-weight:600;color:var(--etb-tx2,#6b6b6b);',
            'text-transform:uppercase;letter-spacing:.06em;display:block;margin-bottom:6px;">',
            lbl,
          '</label>',
          '<input type="' + typ + '" data-field-id="' + fid + '"',
            ' style="width:100%;background:#fff;border:1px solid var(--etb-bd2,rgba(0,0,0,.14));',
            'border-radius:9px;color:var(--etb-tx,#111);font-size:13px;padding:10px 14px;',
            'box-sizing:border-box;outline:none;font-family:-apple-system,system-ui,sans-serif;"',
            ' autocomplete="off" />',
        '</div>'
      ].join('');
    }).join('');

    sh.card.innerHTML = [
      '<div style="display:flex;align-items:center;gap:10px;padding:18px 22px 16px;',
        'border-bottom:1px solid var(--etb-bd,rgba(0,0,0,.07));">',
        '<div style="width:8px;height:8px;border-radius:50%;background:#C67E34;flex-shrink:0;"></div>',
        '<span style="flex:1;font-size:15px;font-weight:700;color:var(--etb-tx,#111);">',
          _esc(title || 'Configure Plugin'),
        '</span>',
        '<button id="_etb_cm_close" style="background:none;border:none;color:var(--etb-tx2,#888);',
          'cursor:pointer;font-size:18px;padding:4px 6px;border-radius:5px;">&#10005;</button>',
      '</div>',
      '<div style="padding:20px 22px;">',
        fieldsHtml || '<div style="font-size:13px;color:var(--etb-tx2,#6b6b6b);">No fields provided.</div>',
        '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:6px;">',
          '<button id="_etb_cm_cancel" style="background:var(--etb-s3,#f7f7f9);',
            'border:1px solid var(--etb-bd2,rgba(0,0,0,.14));color:var(--etb-tx2,#6b6b6b);',
            'border-radius:9px;padding:9px 18px;cursor:pointer;font-size:12px;">Cancel</button>',
          '<button id="_etb_cm_save" style="background:#C67E34;border:none;color:#000;font-weight:700;',
            'border-radius:9px;padding:9px 20px;cursor:pointer;font-size:12px;">Save</button>',
        '</div>',
      '</div>'
    ].join('');

    function doCancel() {
      _sendConfigResponse(targetIframe, null, true);
      _modalClose(sh.backdrop);
    }

    function doSave() {
      var inputs = sh.card.querySelectorAll('[data-field-id]');
      var values = {};
      var saves = [];
      for (var i = 0; i < inputs.length; i++) {
        var inp = inputs[i];
        var key = inp.getAttribute('data-field-id');
        var val = inp.value || '';
        values[key] = val;
        if (val) saves.push(ETB.api.kvSet(key, val).catch(function () {}));
      }
      Promise.all(saves).then(function () {
        _sendConfigResponse(targetIframe, values, false);
      }).catch(function () {
        _sendConfigResponse(targetIframe, values, false);
      });
      _modalClose(sh.backdrop);
    }

    sh.card.querySelector('#_etb_cm_close').onclick  = doCancel;
    sh.card.querySelector('#_etb_cm_cancel').onclick = doCancel;
    sh.card.querySelector('#_etb_cm_save').onclick   = doSave;
  }

  // Floating status modal shown while clean-rebuild runs (detached from any panel).
  // Returns a controller object: { setPhase, done, error, close }.
  function _showRepairStatusModal(plugin, opts) {
    opts = opts || {};
    var pluginName = (plugin && plugin.name) || 'Plugin';
    var fullReset  = !!opts.fullReset;
    var title      = fullReset ? 'Reinstalling Plugin' : 'Rebuilding Plugin UI';

    // No backdrop-close — user must wait or explicitly close/retry.
    var bd = document.createElement('div');
    bd.style.cssText = [
      'position:fixed;inset:0;z-index:2147483647;',
      'background:rgba(0,0,0,.45);backdrop-filter:blur(4px);',
      'display:flex;align-items:center;justify-content:center;',
      'animation:_etbv2_gh_fade .14s ease;',
      'font-family:-apple-system,system-ui,sans-serif;'
    ].join('');

    var card = document.createElement('div');
    card.style.cssText = [
      'background:var(--etb-s1,#fff);border:1px solid var(--etb-bd2,rgba(0,0,0,.14));',
      'border-radius:16px;width:420px;max-width:calc(100vw - 32px);',
      'box-shadow:0 16px 48px rgba(0,0,0,.18);overflow:hidden;'
    ].join('');
    bd.appendChild(card);
    document.body.appendChild(bd);

    function _setCardContent(html) { card.innerHTML = html; }

    function _headerHtml(dot, titleText) {
      return [
        '<div style="display:flex;align-items:center;gap:10px;padding:18px 22px 16px;',
          'border-bottom:1px solid var(--etb-bd,rgba(0,0,0,.07));">',
          '<div style="width:8px;height:8px;border-radius:50%;background:' + dot + ';flex-shrink:0;"></div>',
          '<span style="font-size:15px;font-weight:700;color:var(--etb-tx,#111);">' + _esc(titleText) + '</span>',
        '</div>'
      ].join('');
    }

    // Activity log — keep last 5 entries, updated live during agent run.
    var _logLines = [];

    function _logHtml() {
      if (!_logLines.length) return '';
      return [
        '<div style="margin-top:14px;border:1px solid var(--etb-bd,rgba(0,0,0,.07));',
          'border-radius:8px;overflow:hidden;">',
          '<div style="font-size:10px;font-weight:600;color:var(--etb-tx2,#6b6b6b);',
            'text-transform:uppercase;letter-spacing:.05em;padding:6px 10px 5px;',
            'background:var(--etb-s3,#f7f7f9);border-bottom:1px solid var(--etb-bd,rgba(0,0,0,.07));">',
            'Activity',
          '</div>',
          '<div id="_etb_rsm_log" style="padding:8px 10px;font-size:11px;',
            'font-family:ui-monospace,monospace;line-height:1.6;',
            'color:var(--etb-tx2,#6b6b6b);max-height:80px;overflow:hidden;">',
            _logLines.map(function (l) {
              return '<div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + _esc(l) + '</div>';
            }).join(''),
          '</div>',
        '</div>'
      ].join('');
    }

    // ── Progress state ─────────────────────────────────────────────
    function renderProgress(phase) {
      _setCardContent([
        _headerHtml('#C67E34', title),
        '<div style="padding:24px 22px;">',
          '<div style="display:flex;align-items:center;gap:12px;margin-bottom:14px;">',
            '<div style="width:18px;height:18px;flex-shrink:0;border:2px solid rgba(0,0,0,.08);',
              'border-top-color:#C67E34;border-radius:50%;',
              'animation:_etbv2_spin .7s linear infinite;"></div>',
            '<div id="_etb_rsm_phase" style="font-size:13px;color:var(--etb-tx,#111);',
              'font-weight:500;">' + _esc(phase || 'Working') + '...</div>',
          '</div>',
          '<div style="font-size:12px;color:var(--etb-tx2,#6b6b6b);margin-bottom:4px;">',
            'Plugin: <b style="color:var(--etb-tx,#111);">' + _esc(pluginName) + '</b>',
          '</div>',
          _logHtml(),
          '<div style="font-size:11px;color:var(--etb-tx2,#aaa);margin-top:12px;">',
            'This may take a few minutes. You can navigate away — this window will stay.',
          '</div>',
        '</div>'
      ].join(''));
    }

    // ── Done state ─────────────────────────────────────────────────
    function renderDone(freshPlugin, summary) {
      var summaryHtml = '';
      if (summary && summary.trim()) {
        var short = summary.trim().slice(0, 400);
        summaryHtml = [
          '<div style="background:var(--etb-s3,#f7f7f9);border:1px solid var(--etb-bd,rgba(0,0,0,.07));',
            'border-radius:8px;padding:10px 12px;font-size:11px;font-family:ui-monospace,monospace;',
            'line-height:1.6;color:var(--etb-tx2,#6b6b6b);max-height:80px;overflow:auto;',
            'margin-bottom:16px;white-space:pre-wrap;word-break:break-word;">',
            _esc(short),
          '</div>'
        ].join('');
      }
      _setCardContent([
        _headerHtml('#4caf50', 'Plugin Ready'),
        '<div style="padding:24px 22px;">',
          '<div style="font-size:13px;color:var(--etb-tx,#111);margin-bottom:6px;">',
            '<b>' + _esc(pluginName) + '</b> has been ' +
            (fullReset ? 'reinstalled' : 'rebuilt') + ' successfully.',
          '</div>',
          '<div style="font-size:12px;color:var(--etb-tx2,#6b6b6b);margin-bottom:' +
            (summaryHtml ? '12px' : '20px') + ';">',
            'Open the plugin to verify everything is working.',
          '</div>',
          summaryHtml,
          '<div style="display:flex;gap:8px;justify-content:flex-end;">',
            '<button id="_etb_rsm_close" style="background:var(--etb-s3,#f7f7f9);',
              'border:1px solid var(--etb-bd2,rgba(0,0,0,.14));color:var(--etb-tx2,#6b6b6b);',
              'border-radius:9px;padding:9px 18px;cursor:pointer;font-size:12px;">Close</button>',
            '<button id="_etb_rsm_open" style="background:#C67E34;border:none;color:#000;',
              'font-weight:700;border-radius:9px;padding:9px 22px;cursor:pointer;font-size:12px;">',
              'Open Plugin</button>',
          '</div>',
        '</div>'
      ].join(''));

      card.querySelector('#_etb_rsm_close').onclick = function () { _modalClose(bd); };
      card.querySelector('#_etb_rsm_open').onclick  = function () {
        _modalClose(bd);
        var p = freshPlugin || (plugin && ETB.registry.getById(plugin.id));
        if (p) ETB.router.open(p);
      };
    }

    // ── Error state ────────────────────────────────────────────────
    function renderError(msg, onRetry) {
      _setCardContent([
        _headerHtml('rgba(180,50,50,.85)', 'Repair Failed'),
        '<div style="padding:24px 22px;">',
          '<div style="font-size:13px;color:var(--etb-tx,#111);margin-bottom:6px;">',
            'Plugin: <b>' + _esc(pluginName) + '</b>',
          '</div>',
          '<div style="background:rgba(220,50,50,.06);border:1px solid rgba(220,50,50,.18);',
            'border-radius:9px;padding:10px 14px;font-size:12px;color:rgba(160,40,40,.9);',
            'line-height:1.5;margin-bottom:20px;">',
            _esc(String(msg || 'Unknown error').slice(0, 200)),
          '</div>',
          '<div style="display:flex;gap:8px;justify-content:flex-end;">',
            '<button id="_etb_rsm_close2" style="background:var(--etb-s3,#f7f7f9);',
              'border:1px solid var(--etb-bd2,rgba(0,0,0,.14));color:var(--etb-tx2,#6b6b6b);',
              'border-radius:9px;padding:9px 18px;cursor:pointer;font-size:12px;">Close</button>',
            onRetry
              ? '<button id="_etb_rsm_retry" style="background:#C67E34;border:none;color:#000;font-weight:700;border-radius:9px;padding:9px 20px;cursor:pointer;font-size:12px;">Retry</button>'
              : '',
          '</div>',
        '</div>'
      ].join(''));

      card.querySelector('#_etb_rsm_close2').onclick = function () { _modalClose(bd); };
      if (onRetry) {
        var retryBtn = card.querySelector('#_etb_rsm_retry');
        if (retryBtn) retryBtn.onclick = function () { _modalClose(bd); onRetry(); };
      }
    }

    // Initial render
    renderProgress(fullReset ? 'Deleting' : 'Cleaning UI');

    return {
      setPhase: function (text) {
        var el = card.querySelector('#_etb_rsm_phase');
        if (el) el.textContent = text + '...';
      },
      addLog: function (text) {
        if (!text || !text.trim()) return;
        _logLines.push(text.trim());
        if (_logLines.length > 5) _logLines = _logLines.slice(-5);
        var logDiv = card.querySelector('#_etb_rsm_log');
        if (logDiv) {
          logDiv.innerHTML = _logLines.map(function (l) {
            return '<div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + _esc(l) + '</div>';
          }).join('');
          logDiv.scrollTop = logDiv.scrollHeight;
        }
      },
      done:  function (freshPlugin, summary) { renderDone(freshPlugin, summary); },
      error: function (msg, onRetry) { renderError(msg, onRetry); },
      close: function () { _modalClose(bd); }
    };
  }

  // Floating ✦ Repair overlay — injected into the content div for every plugin panel.
  function _injectRepairOverlay(content, pluginId) {
    var pid = _esc(pluginId.replace(/'/g, ''));
    var fab = document.createElement('div');
    fab.id = '_etb_fab_' + String(pluginId).replace(/[^a-z0-9]/gi, '_');
    fab.style.cssText = [
      'position:absolute;bottom:14px;right:14px;z-index:10;pointer-events:auto;',
      'transition:opacity .15s;'
    ].join('');
    fab.innerHTML = [
      '<button onclick="ETB.router._showRepairModal(\'' + pid + '\',\'\')"',
        ' title="Repair or reconfigure this plugin"',
        ' style="background:var(--etb-s1,#fff);border:1px solid var(--etb-bd2,rgba(0,0,0,.14));',
        'color:var(--etb-tx2,#6b6b6b);border-radius:20px;padding:5px 13px;cursor:pointer;',
        'font-size:11px;font-family:-apple-system,system-ui,sans-serif;',
        'box-shadow:0 2px 8px rgba(0,0,0,.1);transition:background .12s,color .12s;',
        'display:flex;align-items:center;gap:5px;">',
        '<span style="font-size:12px;">&#10024;</span> Repair',
      '</button>'
    ].join('');
    content.appendChild(fab);
  }

  return {
    // Start a local_server plugin's HTTP server via its saved expert.
    // Must run with target: deviceId so the server starts on the user's device.
    _startServer: function (pluginId) {
      var plugin = ETB.registry.getById(pluginId);
      if (!plugin || !plugin.ui || !plugin.ui.startExpert) return;
      var startExpert = plugin.ui.startExpert;
      var port = plugin.ui.port;
      var rootPath = plugin.ui.rootPath;
      ETB.api.kvGet('_device_id')
        .then(function (res) { return (res && res.value) || null; })
        .catch(function () { return null; })
        .then(function (deviceId) {
          var runOpts = deviceId ? { target: deviceId } : {};
          return ETB.api.runExpert(startExpert, { port: String(port || ''), root_path: rootPath || '' }, runOpts);
        })
        .then(function () { ETB.router._retryServer(pluginId); })
        .catch(function (e) { console.warn('[ETB.router] Failed to start server:', e && e.message); });
    },

    // Re-check server availability and reload the iframe when ready.
    _retryServer: function (pluginId) {
      var entry = _cache[pluginId];
      if (!entry) return;
      var plugin = ETB.registry.getById(pluginId);
      if (!plugin || !plugin.ui) return;
      var content = entry.panel.querySelector('div[style*="flex:1"]');
      if (!content) return;
      // Clear fallback, create fresh iframe
      content.innerHTML = '';
      var mainFile = (plugin.ui.mainFile && plugin.ui.mainFile !== 'index.html') ? plugin.ui.mainFile : '';
      var serverUrl = 'http://localhost:' + plugin.ui.port + (mainFile ? '/' + mainFile : '');
      var retryIframe = document.createElement('iframe');
      retryIframe.style.cssText = 'width:100%;height:100%;border:none;display:none;';
      retryIframe.setAttribute('allow', 'clipboard-read;clipboard-write');
      content.appendChild(retryIframe);
      _checkAndLoadServer(retryIframe, serverUrl, content, plugin);
    },

    // Open a service/local_server plugin's live URL in the external browser.
    _openExternal: function (pluginId) {
      var plugin = ETB.registry.getById(pluginId);
      if (!plugin) return;
      _openUrlExternal(_serviceUrl(plugin));
    },

    // Show the repair modal so the user can optionally describe the issue.
    _showRepairModal: function (pluginId, prefillText) {
      _showRepairModal(pluginId, prefillText || '');
    },

    // Hand the plugin to the agent: install deps, (re)start the real service,
    // health-validate, and pick up any manifest changes — then reload the panel.
    _repairWithAgent: function (pluginId, description) {
      var self = this;
      var plugin = ETB.registry.getById(pluginId);
      if (!plugin) return;
      if (!ETB.installPrompt || !ETB.installPrompt.buildRepair) {
        console.warn('[ETB.router] installPrompt.buildRepair unavailable');
        return;
      }
      var entry = _cache[pluginId];
      var content = entry && entry.panel ? entry.panel.querySelector('div[style*="flex:1"]') : null;
      var safeId = String(pluginId).replace(/[^a-z0-9]/gi, '_');
      var ticker = null;

      var bar = _renderRepairProgress(content, plugin, 'Resolving device');
      function setPhase(txt) {
        if (!bar) return;
        var el = bar.querySelector('._etb_rep_phase');
        if (el) el.textContent = txt + '…';
      }
      function removeBar() {
        if (bar && bar.parentNode) bar.parentNode.removeChild(bar);
        bar = null;
      }
      function stopTicker() {
        if (ticker) { clearInterval(ticker); ticker = null; }
      }

      ETB.api.kvGet('_device_id')
        .then(function (res) { return (res && res.value) || null; })
        .catch(function () { return null; })
        .then(function (did) {
          if (did) return did;
          try {
            return (window.extellaDesktop && window.extellaDesktop.getDeviceID)
              ? window.extellaDesktop.getDeviceID() : null;
          } catch (e) { return null; }
        })
        .then(function (deviceId) {
          var port = (plugin.ui && plugin.ui.port) ||
            (plugin.service && plugin.service.port) || '';
          var defaultFailure = 'The toolbar could not load http://localhost:' + port +
            '/ — the service is not responding (installed UI shell only, real app not running).';
          var failure = (description && description.trim())
            ? description.trim() + '\n\n' + defaultFailure
            : defaultFailure;
          var prompt = ETB.installPrompt.buildRepair(plugin, failure);

          // Run the agent, auto-retry once if the device listener is interrupted mid-task.
          var _lastAgentText = '';
          function runOnce(isRetry) {
            var t0 = Date.now();
            stopTicker();
            _lastAgentText = '';
            ticker = setInterval(function () {
              var secs = Math.round((Date.now() - t0) / 1000);
              // Show real agent text when available, fallback to timer
              var baseLabel = isRetry ? 'Retry — ' : '';
              setPhase(_lastAgentText
                ? baseLabel + _lastAgentText
                : baseLabel + 'Working (' + secs + 's)');
            }, 1000);
            return ETB.api.runAgentAsync(prompt, {
              run_timeout: 3600,
              maxWait: 3000000,
              interval: 4000,
              stallTimeout: 18 * 60 * 1000,
              onProgress: function (data) {
                var text = '';
                try { text = ETB.api.extractAgentText(data); } catch (_) {}
                if (text && text.trim()) {
                  var lines = text.trim().split('\n');
                  for (var i = lines.length - 1; i >= 0; i--) {
                    var l = lines[i].trim();
                    if (l.length > 5 && l.length < 80) { _lastAgentText = l; break; }
                  }
                }
              }
            });
          }

          return runOnce(false)
            .catch(function (e1) {
              // First attempt failed (likely listener restart/SIGKILL mid-task).
              // Wait 4s and retry automatically once.
              console.warn('[ETB.router] Repair attempt 1 failed:', e1 && e1.message,
                '— auto-retrying in 4s');
              stopTicker();
              setPhase('Interrupted — retrying in 4s');
              return new Promise(function (resolve) { setTimeout(resolve, 4000); })
                .then(function () { return runOnce(true); });
            })
            .then(function () {
              stopTicker();
              setPhase('Reloading');
              if (deviceId) return ETB.registry.syncFromDevice(deviceId, safeId);
              return null;
            }).then(function () {
              removeBar();
              self._retryServer(pluginId);
            });
        })
        .catch(function (e) {
          stopTicker();
          console.warn('[ETB.router] Agent repair failed (both attempts):', e && e.message);
          // Retry button lets the user manually re-trigger the full repair flow.
          _renderRepairError(bar, content, (e && e.message) || 'unknown error', function () {
            ETB.router._repairWithAgent(pluginId, description);
          });
          bar = null;
        });
    },

    // Delete plugin files and regenerate the UI (soft) or do a full reinstall (hard).
    // Called after the user confirms in the Repair modal.
    // Closes the panel, evicts cache, shows a detached status modal, and reopens when done.
    // Flow: Phase 0 (get deviceId) → Phase 1 (read plugin logs via fython) →
    //       Phase 2 (LLM analysis SubAgent) → Phase 3 (full rebuild agent) → sync → done.
    _cleanRebuildWithAgent: function (pluginId, fullReset, description) {
      var plugin = ETB.registry.getById(pluginId);
      if (!plugin) return;
      if (!ETB.installPrompt || !ETB.installPrompt.buildCleanReinstall) {
        console.warn('[ETB.router] installPrompt.buildCleanReinstall unavailable');
        return;
      }
      var safeId = String(pluginId).replace(/[^a-z0-9]/gi, '_');
      var ticker = null;

      // 1. Close the panel immediately — user should not see a half-deleted plugin.
      ETB.router.close({ silent: true });
      // 2. Evict from cache so the panel is fully rebuilt from the fresh manifest later.
      _evict(pluginId);

      // 3. Show the detached floating status modal (always full reset now).
      var status = _showRepairStatusModal(plugin, { fullReset: true });

      function stopTicker() {
        if (ticker) { clearInterval(ticker); ticker = null; }
      }

      var _lastRebuildText = '';
      ticker = setInterval(function () {
        status.setPhase(_lastRebuildText || 'Reading logs\u2026');
      }, 1000);

      var _onRebuildProgress = ETB.api.createAgentProgressTracker({
        setPhase: function (line) { _lastRebuildText = line; },
        addLog: function (line) { status.addLog(line); }
      });

      // ── Phase 0: resolve deviceId ──────────────────────────────────────────
      ETB.api.kvGet('_device_id')
        .then(function (res) { return (res && res.value) || null; })
        .catch(function () { return null; })
        .then(function (did) {
          if (did) return did;
          try {
            return (window.extellaDesktop && window.extellaDesktop.getDeviceID)
              ? window.extellaDesktop.getDeviceID() : null;
          } catch (e) { return null; }
        })

        // ── Phase 1: read plugin log files via fython ──────────────────────
        .then(function (deviceId) {
          _lastRebuildText = 'Reading logs\u2026';
          var installDir = (plugin.artifacts && plugin.artifacts.rootPath) ||
            (plugin.ui && plugin.ui.rootPath) || ('~/extella-plugins/' + safeId);
          var fnLog = '_etb_logs_' + safeId;
          var logCode = [
            'def ' + fnLog + '() -> str:',
            '    import os, glob, json',
            '    d = os.path.expanduser("' + installDir.replace(/"/g, '\\"') + '")',
            '    collected = []',
            '    for pat in ["server.log", "nohup.out", "*.log", "logs/*.log", ".next/dev/logs/*.log"]:',
            '        for fp in sorted(glob.glob(os.path.join(d, pat)))[:2]:',
            '            try:',
            '                with open(fp, "r", encoding="utf-8", errors="replace") as f:',
            '                    lines = f.readlines()',
            '                collected.append("=== " + os.path.basename(fp) + " (last " + str(min(len(lines), 60)) + " lines) ===")',
            '                collected.extend(lines[-60:])',
            '                if len(collected) >= 120: break',
            '            except Exception:',
            '                pass',
            '        if len(collected) >= 120: break',
            '    return json.dumps({"log": "".join(collected[-120:])})'
          ].join('\n');

          var logsPromise;
          if (deviceId) {
            logsPromise = ETB.api.saveExpert({
              name: fnLog, description: 'Read plugin logs for repair', code: logCode, kwargs: {}, cspl: 'fython'
            }).then(function () {
              return ETB.api.runExpert(fnLog, {}, { target: deviceId, timeout: 20 });
            }).then(function (res) {
              ETB.api.deleteExpert(fnLog).catch(function () {});
              try {
                var raw = typeof res === 'string' ? res : (ETB.api.extractAgentText(res) || '');
                var m = raw.match(/\{[\s\S]*\}/);
                return m ? (JSON.parse(m[0]).log || '') : '';
              } catch (_) { return ''; }
            }).catch(function () { return ''; });
          } else {
            logsPromise = Promise.resolve('');
          }

          return logsPromise.then(function (logs) {
            return { deviceId: deviceId, logs: logs };
          });
        })

        // ── Phase 2: LLM analysis SubAgent ────────────────────────────────
        .then(function (ctx) {
          if (!ETB.installPrompt || !ETB.installPrompt.buildRepairAnalysis) {
            return { deviceId: ctx.deviceId, logs: ctx.logs, analysis: null };
          }
          _lastRebuildText = 'Analyzing error\u2026';
          var aPrompt = ETB.installPrompt.buildRepairAnalysis(plugin, description, ctx.logs);
          return ETB.api.runAgentAsync(aPrompt, {
            run_timeout: 180,
            maxWait: 4 * 60 * 1000,
            interval: 4000
          }).then(function (ar) {
            var analysis = null;
            try {
              var txt = ETB.api.extractAgentText(ar) || '';
              var m = txt.match(/\{[\s\S]*\}/);
              if (m) analysis = JSON.parse(m[0]);
            } catch (_) {}
            return { deviceId: ctx.deviceId, logs: ctx.logs, analysis: analysis };
          }).catch(function () {
            return { deviceId: ctx.deviceId, logs: ctx.logs, analysis: null };
          });
        })

        // ── Phase 3: main full-rebuild agent ──────────────────────────────
        .then(function (ctx) {
          _lastRebuildText = '';
          var prompt = ETB.installPrompt.buildCleanReinstall(plugin, true, description, ctx.analysis, ctx.logs);
          return ETB.api.runAgentAsync(prompt, {
            run_timeout: 3600,
            maxWait: 3000000,
            interval: 4000,
            stallTimeout: 18 * 60 * 1000,
            onProgress: _onRebuildProgress
          }).then(function (agentResult) {
            stopTicker();
            status.setPhase('Syncing');
            if (ctx.deviceId) return ETB.registry.syncFromDevice(ctx.deviceId, safeId)
              .then(function () { return agentResult; });
            return agentResult;
          }).then(function (agentResult) {
            stopTicker();
            var summary = '';
            try { summary = ETB.api.extractAgentText(agentResult); } catch (_) {}
            var freshPlugin = ETB.registry.getById(pluginId);
            status.done(freshPlugin || plugin, summary);
          });
        })

        .catch(function (e) {
          stopTicker();
          console.warn('[ETB.router] Clean rebuild failed:', e && e.message);
          status.error((e && e.message) || 'Unknown error', function () {
            ETB.router._cleanRebuildWithAgent(pluginId, true, description);
          });
        });
    },

    open: function (plugin) {
      var id = plugin.id;

      // Hide currently visible panel (keep it in cache).
      // Update lastUsed so a panel that was active moments ago is not
      // immediately the LRU candidate when a new panel needs to be evicted.
      if (_activeId && _activeId !== id && _cache[_activeId]) {
        _cache[_activeId].lastUsed = Date.now();
        _cache[_activeId].panel.style.display = 'none';
      }

      if (_cache[id]) {
        // Re-show cached panel — full iframe state is preserved.
        var entry = _cache[id];
        entry.panel.style.display = 'flex';
        entry.panel.style.animation = '_etbv2_slide_in .18s ease';
        entry.lastUsed = Date.now();
        _activeId = id;
      } else {
        // Evict oldest entry if cache is full.
        _evictLRU();

        var built = _buildPanel(plugin);
        var mount = (ETB.shell && ETB.shell.getViewport)
          ? ETB.shell.getViewport()
          : document.body;
        mount.appendChild(built.panel);

        _cache[id] = { panel: built.panel, blobUrl: built.blobUrl, lastUsed: Date.now() };
        _activeId = id;
      }

      if (ETB.nav) ETB.nav.syncUI();
    },

    openById: function (id) {
      var plugin = ETB.registry.getById(id);
      if (plugin) this.open(plugin);
    },

    close: function (opts) {
      if (_activeId && _cache[_activeId]) {
        var panel = _cache[_activeId].panel;
        _cache[_activeId].lastUsed = Date.now(); // keep it fresh in LRU
        panel.style.animation = '_etbv2_slide_out .15s ease forwards';
        setTimeout(function () {
          // Hide (not remove) — preserves iframe state for next visit.
          panel.style.display = 'none';
          panel.style.animation = 'none';
        }, 150);
      }
      _activeId = null;
      window.__etbResendInit = null;
      if (ETB.nav && (!opts || !opts.silent)) ETB.nav.syncUI();
    },

    isOpen: function () {
      return !!_activeId;
    },

    evict: function (pluginId) {
      if (_activeId === pluginId) {
        _activeId = null;
        window.__etbResendInit = null;
      }
      _evict(pluginId);
    },

    // Toggle run-mode for a HuggingFace plugin (Local ↔ Remote) and reload the panel.
    _hfSwitchMode: function (pluginId, newMode) {
      var plugin = ETB.registry.getById(pluginId);
      if (!plugin || plugin.type !== 'huggingface') return;

      var currentMode = (plugin.hf && plugin.hf.runMode) || plugin.mode || 'local';
      if (currentMode === newMode) return;

      // Update in-memory manifest so the rebuilt panel uses the new mode.
      // Persisting to device registry is left to the agent during next repair.
      if (!plugin.hf) plugin.hf = {};
      plugin.hf.runMode = newMode;
      plugin.mode = newMode;

      // Evict the cached panel so it rebuilds from scratch with the updated mode.
      _evict(pluginId);
      ETB.router.openById(pluginId);
    }
  };
})();
