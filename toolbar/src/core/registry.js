// ── PLUGIN REGISTRY ────────────────────────────────────────────────────────
// Single source of truth for all plugins: built-in (from BUILTIN_PLUGINS
// constant injected by build.js) + custom (saved by user in localStorage).
//
// Exposes: ETB.registry.getAll(), getByCategory(), getById(),
//          install(), uninstall(), addCustom(), isInstalled()

ETB.registry = (function () {
  var INSTALLED_KEY = 'etb_plugins_installed_v1';
  var CUSTOM_KEY    = 'etb_plugins_custom_v1';

  // ── Persistence helpers ───────────────────────────────────────
  function _loadInstalled() {
    try { return JSON.parse(localStorage.getItem(INSTALLED_KEY) || '[]'); }
    catch (e) { return []; }
  }

  function _saveInstalled(arr) {
    try { localStorage.setItem(INSTALLED_KEY, JSON.stringify(arr)); } catch (e) {}
  }

  function _loadCustom() {
    try { return JSON.parse(localStorage.getItem(CUSTOM_KEY) || '[]'); }
    catch (e) { return []; }
  }

  function _saveCustom(arr) {
    try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(arr)); } catch (e) {}
  }

  // ── Bootstrap: auto-install plugins with init:true ────────────
  (function _bootstrap() {
    var installed = _loadInstalled();
    var autoIds = (typeof BUILTIN_PLUGINS !== 'undefined' ? BUILTIN_PLUGINS : [])
      .filter(function (p) { return p.init; })
      .map(function (p) { return p.id; });
    var merged = installed.slice();
    autoIds.forEach(function (id) {
      if (merged.indexOf(id) === -1) merged.push(id);
    });
    if (merged.length !== installed.length) _saveInstalled(merged);
  })();

  // ── Public API ────────────────────────────────────────────────
  return {
    getBuiltin: function () {
      return typeof BUILTIN_PLUGINS !== 'undefined' ? BUILTIN_PLUGINS : [];
    },

    getCustom: function () {
      return _loadCustom();
    },

    getAll: function () {
      return this.getBuiltin().concat(_loadCustom());
    },

    getById: function (id) {
      return this.getAll().filter(function (p) { return p.id === id; })[0] || null;
    },

    getByCategory: function (cat) {
      var installed = _loadInstalled();
      return this.getAll().filter(function (p) {
        return p.category === cat && installed.indexOf(p.id) !== -1;
      });
    },

    getInstalled: function () {
      var installed = _loadInstalled();
      return this.getAll().filter(function (p) {
        return installed.indexOf(p.id) !== -1;
      });
    },

    isInstalled: function (id) {
      return _loadInstalled().indexOf(id) !== -1;
    },

    install: function (id) {
      var arr = _loadInstalled();
      if (arr.indexOf(id) === -1) {
        arr.push(id);
        _saveInstalled(arr);
      }
    },

    uninstall: function (id) {
      _saveInstalled(_loadInstalled().filter(function (i) { return i !== id; }));
    },

    // Adds a user-created plugin (e.g. from GitHub URL) and installs it
    addCustom: function (plugin) {
      var custom = _loadCustom();
      // Remove existing with same id before re-adding
      var filtered = custom.filter(function (p) { return p.id !== plugin.id; });
      filtered.push(plugin);
      _saveCustom(filtered);
      this.install(plugin.id);
    },

    removeCustom: function (id) {
      _saveCustom(_loadCustom().filter(function (p) { return p.id !== id; }));
      this.uninstall(id);
    },

    // ── Local file registry sync ──────────────────────────────────
    // Agent-installed plugins write their manifest to a local file:
    //   ~/extella-plugins/_registry/<id>.json
    // The renderer cannot read local files directly, so we read them through a
    // tiny fython expert executed on the device. Each manifest is merged into
    // the custom registry (which caches in localStorage for instant/offline UI).
    // Best-effort: resolves to the array of synced manifests, never rejects.
    syncFromDevice: function (deviceId, onlyId) {
      var self = this;
      if (!deviceId) return Promise.resolve([]);
      var fnName = '_etb_registry_read';
      var code = [
        'def ' + fnName + '(only_id: str = "") -> str:',
        '    import os, json, glob',
        '    d = os.path.expanduser("~/extella-plugins/_registry")',
        '    out = []',
        '    if os.path.isdir(d):',
        '        if only_id:',
        '            files = [os.path.join(d, only_id + ".json")]',
        '        else:',
        '            files = sorted(glob.glob(os.path.join(d, "*.json")))',
        '        for fp in files:',
        '            try:',
        '                with open(fp, "r", encoding="utf-8") as f:',
        '                    out.append(json.load(f))',
        '            except Exception:',
        '                pass',
        '    return json.dumps(out)'
      ].join('\n');

      return ETB.api.saveExpert({
        name: fnName,
        description: 'Read local Extella plugin registry files',
        code: code,
        kwargs: { only_id: '' },
        cspl: 'fython'
      }).then(function () {
        return ETB.api.runExpert(fnName, { only_id: onlyId || '' }, { target: deviceId, timeout: 20 });
      }).then(function (res) {
        var raw = (res && (res.result || res.output)) || '[]';
        var list;
        try { list = typeof raw === 'string' ? JSON.parse(raw) : raw; }
        catch (e) { list = []; }
        if (!Array.isArray(list)) list = [];
        var added = [];
        list.forEach(function (m) {
          if (m && m.id) { self.addCustom(m); added.push(m); }
        });
        return added;
      }).catch(function () { return []; });
    }
  };
})();
