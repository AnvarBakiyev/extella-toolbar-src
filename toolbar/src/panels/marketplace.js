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
      '    import os, signal, shutil, json, glob',
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
      '    reg_dir = os.path.expanduser("~/extella-plugins/_registry")',
      '    if os.path.isdir(reg_dir):',
      '        for rf in glob.glob(os.path.join(reg_dir, "*.json")):',
      '            try:',
      '                with open(rf, "r", encoding="utf-8") as _fh: _m = json.load(_fh)',
      '                if isinstance(_m, dict) and _m.get("id") == ' + JSON.stringify(pluginId) + ':',
      '                    os.remove(rf); removed.append(rf)',
      '            except Exception: pass',
      '    return json.dumps({"status": "ok", "removed": removed})'
    ].join('\n');

    ETB.api.kvGet('_device_id')
      .then(function (res) { return (res && res.value) || null; })
      .catch(function () { return null; })
      .then(function (deviceId) {
        // Без deviceId чистку НЕ пропускаем: гоним на текущем устройстве без target —
        // зеркало фолбэка syncFromDevice. Иначе файл реестра выживал и синк
        // возвращал карточку (баг «Remove не держится»).
        return ETB.api.saveExpert({
          name: fnName,
          description: 'Cleanup plugin ' + pluginId,
          code: code,
          kwargs: {},
          cspl: 'fython'
        }).then(function () {
          var opts = { timeout: 20 };
          if (deviceId) opts.target = deviceId;
          return ETB.api.runExpert(fnName, {}, opts).catch(function () {
            // stale/недоступный target → ретрай на текущем устройстве
            if (deviceId) return ETB.api.runExpert(fnName, {}, { timeout: 20 });
          });
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

      // Merch layer: the hero story (and future collections/promos) comes
      // from KV '_mkt_merch', so the storefront is re-merchandised from the
      // cloud without an app release. Sent to the iframe once both the
      // payload and the document are ready.
      var _merchPayload = null;
      function _sendMerch() {
        if (!_merchPayload) return;
        var frame = document.getElementById('_etbv2_mkt_frame');
        if (frame && frame.contentWindow) {
          try { frame.contentWindow.postMessage({ type: 'etb_merch', data: _merchPayload }, '*'); } catch (e) {}
        }
      }
      // Fetch cloud merch only once the session token is ready. getToken() is
      // empty until the async auth flow resolves, so a one-shot kvGet fired at
      // open() would send an empty X-Auth-Token → 401 → silently no hero (a
      // race: the hero showed only when the token happened to be ready in time).
      // onToken() fires now if the token is present, else when it arrives; then
      // retry a few times to ride out a slow first response. Delivery to the
      // iframe is belt-and-suspenders: this push + the iframe's etb_ready pull.
      function _fetchMerch(tries) {
        tries = tries || 0;
        ETB.api.kvGet('_mkt_merch').then(function (r) {
          var ok = r && r.value != null && r.value !== '' &&
                   r.status !== 'error' && r.status !== 'not_found';
          if (ok) {
            try { _merchPayload = (typeof r.value === 'string') ? JSON.parse(r.value) : r.value; }
            catch (e) { return; }
            _sendMerch();
            return;
          }
          if (tries < 4) setTimeout(function () { _fetchMerch(tries + 1); }, 1200);
        }).catch(function () {
          if (tries < 4) setTimeout(function () { _fetchMerch(tries + 1); }, 1200);
        });
      }
      try {
        if (ETB.auth && ETB.auth.onToken) ETB.auth.onToken(function () { _fetchMerch(0); });
        else _fetchMerch(0);
      } catch (e) { _fetchMerch(0); }
      iframe.addEventListener('load', _sendMerch);

      // Do NOT call ETB.nav.syncUI() here — nav.set() already called _paintTabs()
      // before invoking open(). Calling syncUI() now inspects the DOM and can see
      // a library overlay that is still animating closed (150ms), causing it to
      // override _active back to 'library' and mis-highlight the wrong tab.

      // Listen for install/open/close events from marketplace iframe.
      // Store reference so it can be removed on close.
      _msgHandler = function (e) {
        if (!e.data) return;
        // Iframe finished booting and attached its message listener → (re)push
        // the merch payload. Guarantees delivery regardless of who was ready
        // first (payload vs document).
        if (e.data.type === 'etb_ready') { _sendMerch(); return; }

        // ── Storefront service bridges (KV / rules / agents) ────────────────
        // Let the store manage Skills in-place (as a category) rather than in a
        // The storefront iframe (blob: origin) can't resolve the session token
        // itself (no cookies, no DOM user-id). It asks the parent for the live
        // token so direct api.js calls (e.g. GitHub install) don't 401. Same-app
        // trust boundary; the token is the user's own and never logged.
        if (e.data.type === 'etb_request_token') {
          try {
            var _tf = document.getElementById('_etbv2_mkt_frame');
            var _tok = (window.ETB && ETB.auth && ETB.auth.getToken) ? ETB.auth.getToken() : '';
            if (_tf && _tf.contentWindow && _tok) {
              _tf.contentWindow.postMessage({ type: 'extella-token', token: _tok }, '*');
            }
          } catch (_) {}
          return;
        }

        // separate plugin window. Mirrors the router bridges; KV is scoped to
        // '_mkt_' keys so a page can never touch secrets.
        if (e.data.type === 'etb_kv_get' || e.data.type === 'etb_kv_set' ||
            e.data.type === 'etb_rule_add' || e.data.type === 'etb_rule_remove' ||
            e.data.type === 'etb_agents_list' ||
            e.data.type === 'etb_run_expert' || e.data.type === 'etb_run_agent') {
          var _mf = document.getElementById('_etbv2_mkt_frame');
          var _rid = e.data.reqId, _t = e.data.type;
          var _back = function (msg) { if (_mf && _mf.contentWindow) { try { _mf.contentWindow.postMessage(msg, '*'); } catch (_) {} } };
          var _kerr = function (m) { _back({ type: 'etb_kv_result', reqId: _rid, ok: false, error: m }); };
          try {
            if (_t === 'etb_kv_get' || _t === 'etb_kv_set') {
              var _key = String(e.data.key || '');
              if (_key.indexOf('_mkt_') !== 0) { _kerr('key not allowed'); return; }
              if (_t === 'etb_kv_get') {
                ETB.api.kvGet(_key, { global: true })
                  .then(function (r) { _back({ type: 'etb_kv_result', reqId: _rid, ok: true, value: (r && r.value != null) ? r.value : null }); })
                  .catch(function (er) { _kerr((er && er.message) || 'kv get failed'); });
              } else {
                ETB.api.kvSet(_key, e.data.value, e.data.description || 'Marketplace (storefront)', { global: true })
                  .then(function () { _back({ type: 'etb_kv_result', reqId: _rid, ok: true }); })
                  .catch(function (er) { _kerr((er && er.message) || 'kv set failed'); });
              }
            } else if (_t === 'etb_rule_add') {
              ETB.api.rulesAdd(String(e.data.rule || ''), e.data.agents)
                .then(function (refs) { _back({ type: 'etb_rule_result', reqId: _rid, ok: !!(refs && refs.length), refs: refs || [] }); })
                .catch(function (er) { _back({ type: 'etb_rule_result', reqId: _rid, ok: false, error: (er && er.message) || 'rule add failed' }); });
            } else if (_t === 'etb_rule_remove') {
              ETB.api.rulesRemove(e.data.refs || e.data.ruleId)
                .then(function () { _back({ type: 'etb_rule_result', reqId: _rid, ok: true }); })
                .catch(function (er) { _back({ type: 'etb_rule_result', reqId: _rid, ok: false, error: (er && er.message) || 'rule remove failed' }); });
            } else if (_t === 'etb_agents_list') {
              ETB.api.agentsList()
                .then(function (r) { var list = (r && r.agents) || []; _back({ type: 'etb_agents_result', reqId: _rid, ok: true, agents: list.map(function (a) { return { id: a.id, name: a.name, model: a.model }; }) }); })
                .catch(function (er) { _back({ type: 'etb_agents_result', reqId: _rid, ok: false, error: (er && er.message) || 'agents failed' }); });
            } else if (_t === 'etb_run_expert') {
              // Expert bridge for the storefront (install a CLI capability, etc.).
              // Runs in toolbar context (has API access); idempotent resolvers make
              // a double-run harmless if router's per-plugin handler also fires.
              // runExpertAsync: если сервер откладывает длинный прогон (kp_ingest, синтез,
              // большие пачки) в задачу — поллит её до готовности (иначе прилетает
              // «deferred, use task_id as reference» вместо результата).
              ETB.api.runExpertAsync(e.data.name, e.data.params || {}, { global: true, maxWait: 900000, interval: 2500 })
                .then(function (res) { _back({ type: 'etb_expert_result', reqId: _rid, ok: true, res: res }); })
                .catch(function (er) { _back({ type: 'etb_expert_result', reqId: _rid, ok: false, error: (er && er.message) || 'expert failed' }); });
            } else if (_t === 'etb_run_agent') {
              // «+ Добавить инструмент»: ask the Builder to compose a spec and call
              // the factory. Agent runs take minutes → ack immediately (fire-and-
              // forget) and let the storefront refresh its catalog once it lands.
              try {
                ETB.api.runAgentAsync(String(e.data.message || ''), { agent_id: e.data.agent_id, run_timeout: 600 })
                  .catch(function () {});
              } catch (_ea) {}
              _back({ type: 'etb_agent_result', reqId: _rid, ok: true, started: true });
            }
          } catch (er) {
            var rt = _t === 'etb_run_agent' ? 'etb_agent_result'
                   : (_t === 'etb_run_expert' ? 'etb_expert_result'
                   : (_t.indexOf('rule') >= 0 ? 'etb_rule_result'
                   : (_t.indexOf('agents') >= 0 ? 'etb_agents_result' : 'etb_kv_result')));
            _back({ type: rt, reqId: _rid, ok: false, error: (er && er.message) || 'bridge failed' });
          }
          return;
        }
        if (e.data.type !== 'etb_plugin_action') return;
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
          // Любая запись из custom-реестра синхронизирована с устройства (syncFromDevice),
          // поэтому её надо чистить ПОЛНОСТЬЮ — иначе файл реестра на устройстве остаётся
          // и модель/плагин возвращается на следующем syncFromDevice (баг «Remove не держится»).
          var isCustom = !!(ETB.registry.getCustom && ETB.registry.getCustom().some(function (p) { return p && p.id === pluginId; }));
          if (/^(?:gh_|hf_)/.test(pluginId) || hasArtifacts || isCustom) {
            // Agent-installed / GitHub / HuggingFace / device-synced plugin: full cleanup of every
            // artifact + on-device registry file + custom entry + evict cached panel.
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
