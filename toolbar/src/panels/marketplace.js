// ── MARKETPLACE PANEL ─────────────────────────────────────────────────────
// Opens the plugins_manager.html in a full-screen modal overlay (iframe).
// Exposes: ETB.marketplace.open(), ETB.marketplace.close()

ETB.marketplace = (function () {
  var _msgHandler = null;
  var _blobUrl = null;

  // Full removal of an agent-installed plugin: delete every artifact the agent
  // created (experts, KV keys, on-device files + running server, registry file)
  // plus the local registry entry. Driven by the manifest's `artifacts`, with
  // safe deterministic fallbacks when the manifest is missing. Fire-and-forget —
  // cleanup errors must never surface in the UI.
  function _removeAgentPlugin(pluginId, plugin) {
    plugin = plugin || ETB.registry.getById(pluginId);
    var safeId = pluginId.replace(/[^a-z0-9]/gi, '_');
    var art = (plugin && plugin.artifacts) || {};

    var rootPath = art.rootPath || (plugin && plugin.ui && plugin.ui.rootPath) || ('~/extella-plugins/' + safeId);
    var registryFile = art.registryFile || ('~/extella-plugins/_registry/' + safeId + '.json');

    // Collect every pid file the agent may have written (static server + real
    // service), deduped, so Remove tears the running app down too.
    var pidFiles = [];
    function _addPid(p) { if (p && pidFiles.indexOf(p) === -1) pidFiles.push(p); }
    _addPid(art.pidFile);
    (art.pidFiles || []).forEach(_addPid);
    if (plugin && plugin.service && plugin.service.pidFile) _addPid(plugin.service.pidFile);
    _addPid('/tmp/etb_srv_' + safeId + '.pid');
    var pidListPy = '[' + pidFiles.map(function (p) {
      return '"' + String(p).replace(/"/g, '\\"') + '"';
    }).join(', ') + ']';

    // 1) Delete saved experts (start expert + any plugin experts). Include the
    //    start expert from ui as a fallback when artifacts is incomplete.
    var experts = (art.experts || []).slice();
    if (plugin && plugin.ui && plugin.ui.startExpert && experts.indexOf(plugin.ui.startExpert) === -1) {
      experts.push(plugin.ui.startExpert);
    }
    (plugin && plugin.experts ? plugin.experts : []).forEach(function (name) {
      if (typeof name === 'string' && experts.indexOf(name) === -1) experts.push(name);
    });
    experts.forEach(function (name) {
      if (name) ETB.api.deleteExpert(name).catch(function () {});
    });

    // 2) Clear KV keys (declared + legacy server-port key).
    (art.kvKeys || []).forEach(function (k) {
      if (k) ETB.api.kvSet(k, '').catch(function () {});
    });
    ETB.api.kvSet('_server_port_' + safeId, '').catch(function () {});

    // 3) On-device cleanup: stop server, remove files, build status, registry file.
    var fnName = '_etb_cleanup_' + safeId;
    var code = [
      'def ' + fnName + '() -> str:',
      '    import os, signal, shutil, json',
      '    removed = []',
      '    for pid_file in ' + pidListPy + ':',
      '        if os.path.exists(pid_file):',
      '            try: os.kill(int(open(pid_file).read().strip()), signal.SIGTERM)',
      '            except Exception: pass',
      '            try: os.remove(pid_file)',
      '            except Exception: pass',
      '    root = os.path.expanduser("' + rootPath + '")',
      '    try:',
      '        if os.path.isdir(root): shutil.rmtree(root); removed.append(root)',
      '    except Exception: pass',
      '    for f in ["/tmp/etb_build_' + safeId + '.json", os.path.expanduser("' + registryFile + '")]:',
      '        try:',
      '            if os.path.exists(f): os.remove(f); removed.append(f)',
      '        except Exception: pass',
      '    return json.dumps({"status": "ok", "removed": removed})'
    ].join('\n');

    ETB.api.kvGet('_device_id')
      .then(function (res) { return (res && res.value) || null; })
      .catch(function () { return null; })
      .then(function (deviceId) {
        if (!deviceId) return;
        return ETB.api.saveExpert({
          name: fnName,
          description: 'Cleanup plugin ' + pluginId,
          code: code,
          kwargs: {},
          cspl: 'fython'
        }).then(function () {
          return ETB.api.runExpert(fnName, {}, { target: deviceId, timeout: 20 });
        }).then(function () {
          // Remove the throwaway cleanup expert itself.
          return ETB.api.deleteExpert(fnName).catch(function () {});
        });
      })
      .catch(function () {});

    // 4) Local registry: drop the custom entry and evict any cached panel.
    ETB.registry.removeCustom(pluginId);
    if (ETB.router && ETB.router.evict) ETB.router.evict(pluginId);
  }

  var MKT_STYLES = [
    '#_etbv2_mkt_ov{',
      'position:absolute;inset:0;z-index:2147483632;',
      'background:var(--etb-bg,#0a0a0a);',
      'display:flex;flex-direction:column;',
      'animation:_etbv2_slide_in .18s ease;',
    '}',
    '#_etbv2_root[data-etb-fallback] ~ #_etbv2_viewport #_etbv2_mkt_ov,',
    'body:not(:has(#_etbv2_viewport)) #_etbv2_mkt_ov{',
      'position:fixed;inset:0;',
    '}',
    '#_etbv2_mkt_frame{flex:1;border:none;display:block;width:100%;}'
  ].join('');

  function _ensureStyles() {
    if (document.getElementById('_etbv2_mkt_styles')) return;
    var s = document.createElement('style');
    s.id = '_etbv2_mkt_styles';
    s.textContent = MKT_STYLES;
    document.head.appendChild(s);
  }

  return {
    open: function () {
      var existing = document.getElementById('_etbv2_mkt_ov');
      if (existing) {
        // A truly-open overlay → nothing to do. A stale one still finishing its
        // close animation → drop it now so we can open a fresh instance.
        if (existing.getAttribute('data-closing') !== '1') return;
        if (existing.parentNode) existing.parentNode.removeChild(existing);
      }
      _ensureStyles();

      var ov = document.createElement('div');
      ov.id = '_etbv2_mkt_ov';

      var iframe = document.createElement('iframe');
      iframe.id = '_etbv2_mkt_frame';
      // Use blob: URL — no local HTTP server required
      var blob = new Blob([_ETB_MARKETPLACE_HTML], { type: 'text/html' });
      _blobUrl = URL.createObjectURL(blob);
      iframe.src = _blobUrl;
      iframe.setAttribute('allow', 'clipboard-read;clipboard-write');
      iframe.addEventListener('load', function () {
        if (iframe.contentWindow && ETB.theme) {
          try {
            iframe.contentWindow.postMessage(
              { type: 'etb_theme', theme: ETB.theme.current() }, '*'
            );
          } catch (e) {}
        }
      }, { once: true });
      ov.appendChild(iframe);

      if (!window.__etbMktThemeHook && ETB.theme && ETB.theme.onChange) {
        window.__etbMktThemeHook = true;
        ETB.theme.onChange(function (theme) {
          var frame = document.getElementById('_etbv2_mkt_frame');
          if (frame && frame.contentWindow) {
            try {
              frame.contentWindow.postMessage({ type: 'etb_theme', theme: theme }, '*');
            } catch (e) {}
          }
        });
      }

      var mount = (ETB.shell && ETB.shell.getViewport)
        ? ETB.shell.getViewport()
        : (document.getElementById('_etbv2_root') || document.body);
      mount.appendChild(ov);

      // Agents can drop new manifests into the device registry while Extella
      // is running (e.g. a chat session installs a plugin). Boot-time sync
      // alone misses those — refresh on every marketplace open, best-effort,
      // and tell the iframe to re-render if anything new arrived.
      try {
        ETB.api.kvGet('_device_id').then(function (r) {
          if (r && r.value) return r.value;
          try {
            return (window.extellaDesktop && typeof window.extellaDesktop.getDeviceID === 'function')
              ? window.extellaDesktop.getDeviceID() : null;
          } catch (e) { return null; }
        }).then(function (did) {
          if (!did) return;
          return ETB.registry.syncFromDevice(did).then(function (added) {
            if (added && added.length) {
              var frame = document.getElementById('_etbv2_mkt_frame');
              if (frame && frame.contentWindow) {
                try { frame.contentWindow.postMessage({ type: 'etb_reload_plugins' }, '*'); } catch (e) {}
              }
              if (ETB.tabs && ETB.tabs.refresh) ETB.tabs.refresh();
            }
          });
        }).catch(function () {});
      } catch (e) {}

      // Do NOT call ETB.nav.syncUI() here — nav.set() already called _paintTabs()
      // before invoking open(). Calling syncUI() now inspects the DOM and can see
      // a library overlay that is still animating closed (150ms), causing it to
      // override _active back to 'library' and mis-highlight the wrong tab.

      // Listen for install/open/close events from marketplace iframe.
      // Store reference so it can be removed on close.
      _msgHandler = function (e) {
        if (!e.data || e.data.type !== 'etb_plugin_action') return;
        var action = e.data.action;
        var pluginId = e.data.pluginId;
        if (action === 'install' && pluginId) {
          ETB.registry.install(pluginId);
          ETB.tabs.refresh();
        } else if (action === 'install_featured' && pluginId) {
          // One-click install of a curated plugin: provision its pre-authored
          // experts/concepts on the user's account, then report back so the
          // iframe can flip the button state without a reload.
          var plugin = ETB.registry.getById(pluginId);
          var _reply = function (ok, message) {
            var frame = document.getElementById('_etbv2_mkt_frame');
            if (frame && frame.contentWindow) {
              frame.contentWindow.postMessage({
                type: 'etb_install_result',
                pluginId: pluginId,
                ok: ok,
                message: message || ''
              }, '*');
            }
          };
          if (!plugin) { _reply(false, 'Unknown plugin: ' + pluginId); return; }
          ETB.plugins.provision(plugin, 'install').then(function () {
            ETB.tabs.refresh();
            _reply(true);
          }).catch(function (err) {
            _reply(false, (err && err.message) || 'provisioning failed');
          });
        } else if (action === 'uninstall' && pluginId) {
          // Prefer the manifest snapshot passed by the iframe (captured before localStorage
          // was cleared) so CSPL cleanup has the correct artifact paths and pid files.
          var unPlugin = e.data.pluginData || ETB.registry.getById(pluginId);
          var hasArtifacts = !!(unPlugin && unPlugin.artifacts);
          if (/^(?:gh_|hf_)/.test(pluginId) || hasArtifacts) {
            // Agent-installed / GitHub / HuggingFace plugin: full cleanup of every artifact +
            // remove the custom registry entry + evict cached panel.
            _removeAgentPlugin(pluginId, unPlugin);
          } else {
            // Built-in / curated plugin: just mark uninstalled and evict.
            ETB.registry.uninstall(pluginId);
            if (ETB.router && ETB.router.evict) ETB.router.evict(pluginId);
          }
          ETB.tabs.refresh();
        } else if (action === 'open' && pluginId) {
          ETB.marketplace.close();
          ETB.nav.syncUI();
          ETB.router.openById(pluginId);
          ETB.nav.syncUI();
        } else if (action === 'close') {
          ETB.nav.set('chat');
        }
      };
      window.addEventListener('message', _msgHandler);
    },

    close: function (opts) {
      if (_msgHandler) {
        window.removeEventListener('message', _msgHandler);
        _msgHandler = null;
      }
      if (_blobUrl) { URL.revokeObjectURL(_blobUrl); _blobUrl = null; }
      var ov = document.getElementById('_etbv2_mkt_ov');
      if (ov) {
        // Mark as closing synchronously so nav.syncUI() stops counting it as the
        // active Plugins surface during the 150ms exit animation.
        ov.setAttribute('data-closing', '1');
        ov.style.animation = '_etbv2_slide_out .15s ease forwards';
        setTimeout(function () {
          if (ov.parentNode) ov.parentNode.removeChild(ov);
        }, 150);
      }
      if (!opts || !opts.silent) ETB.nav.syncUI();
    }
  };
})();
