// ── PLUGIN REGISTRY ────────────────────────────────────────────────────────
// Single source of truth for all plugins: built-in (from BUILTIN_PLUGINS
// constant injected by build.js) + custom (saved by user in localStorage).
//
// Exposes: ETB.registry.getAll(), getByCategory(), getById(),
//          install(), uninstall(), addCustom(), isInstalled()

ETB.registry = (function () {
  var INSTALLED_KEY = 'etb_plugins_installed_v1';
  var CUSTOM_KEY    = 'etb_plugins_custom_v1';
  // Надгробия удалённых плагинов: константа отсутствовала → ReferenceError в
  // try/catch → tombstone НЕ персистился и удалённые плагины воскресали при синке
  var REMOVED_KEY   = 'etb_plugins_removed_v1';
  var REMOVING_KEY  = 'etb_removing_v1';  // tombstone: id помечен на удаление, пока файл реестра на устройстве ещё есть — не возвращаем при syncFromDevice
  var EVOLUTION_STUDIO_OWNERSHIP_MIGRATION_KEY =
    'etb_evolution_studio_ownership_migration_v1';
  function _loadRemoving(){ try { return JSON.parse(localStorage.getItem(REMOVING_KEY) || '[]'); } catch(e){ return []; } }
  function _saveRemoving(a){ try { localStorage.setItem(REMOVING_KEY, JSON.stringify(a)); } catch(e){} }

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

  // Страницы панелей ТЯЖЁЛЫЕ (у Рекрутёра 338 КБ), а localStorage — маленький
  // и на переполнении бросает. Прежний молчаливый catch означал: запись не
  // прошла, кэш навсегда остался старым, и человек открывал вчерашнюю панель,
  // хотя на диске лежала сегодняшняя. Час отладки 04.08 ушёл в этот мираж.
  // Поэтому в кэше держим карточку БЕЗ страницы: страница живёт на устройстве
  // и дочитывается при открытии (router.openById). Кэш — про «какие плитки
  // показать», а не про содержимое панели.
  var HTML_MARK = '__etb_html_on_device__';
  function _slim(p) {
    if (!p || !p.ui || typeof p.ui.html !== 'string' || p.ui.html.length < 4096) return p;
    var copy = {}; for (var k in p) if (Object.prototype.hasOwnProperty.call(p, k)) copy[k] = p[k];
    var ui = {}; for (var u in p.ui) if (Object.prototype.hasOwnProperty.call(p.ui, u)) ui[u] = p.ui[u];
    ui.html = HTML_MARK;
    copy.ui = ui;
    return copy;
  }
  function _saveCustom(arr) {
    var slim = (arr || []).map(_slim);
    try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(slim)); }
    catch (e) {
      // Переполнение — не «ничего не случилось»: витрина обязана сказать это
      // вслух, иначе следующий такой случай снова будет искать сам себя.
      try { console.warn('[ETB.registry] кэш карточек не сохранён:', (e && e.message) || e); } catch (_) {}
    }
  }

  function _loadRemoved() {
    try { return JSON.parse(localStorage.getItem(REMOVED_KEY) || '[]'); }
    catch (e) { return []; }
  }

  function _saveRemoved(arr) {
    try { localStorage.setItem(REMOVED_KEY, JSON.stringify(arr.slice(-100))); } catch (e) {}
  }

  function _tombstone(id) {
    var a = _loadRemoved();
    if (a.indexOf(id) === -1) { a.push(id); _saveRemoved(a); }
  }

  function _untombstone(id) {
    var a = _loadRemoved();
    if (a.indexOf(id) !== -1) _saveRemoved(a.filter(function (x) { return x !== id; }));
  }

  function _evolutionScannerPayload(response) {
    var current = response;
    var depth = 0;
    // The platform can return the scanner directly, inside an expert task
    // result, or inside the bridge envelope used by tokenless panels. Unwrap a
    // bounded number of known layers; never search arbitrary nested objects.
    while (depth < 4) {
      if (typeof current === 'string') {
        try { current = JSON.parse(current); }
        catch (_) {
          throw new Error('device registry scanner returned invalid JSON');
        }
        depth += 1;
        continue;
      }
      if (!current || typeof current !== 'object') break;
      if (Array.isArray(current.entries)) return current;
      if (Object.prototype.hasOwnProperty.call(current, 'res')) {
        current = current.res;
        depth += 1;
        continue;
      }
      if (Object.prototype.hasOwnProperty.call(current, 'result')) {
        current = current.result;
        depth += 1;
        continue;
      }
      if (Object.prototype.hasOwnProperty.call(current, 'output')) {
        current = current.output;
        depth += 1;
        continue;
      }
      break;
    }
    return current;
  }

  function _evolutionScannerContract(parsed) {
    var contractVersion = 'extella.evolution.registry_scan.v2';
    var capabilities = parsed && parsed.capabilities;
    var contractError;
    if (!parsed || parsed.contract_version !== contractVersion ||
        !Array.isArray(capabilities) ||
        capabilities.indexOf('device_refs_v1') === -1) {
      contractError = new Error(
        'device registry scanner contract is stale: ' +
        String(parsed && parsed.contract_version || 'missing')
      );
      contractError.code = 'DEVICE_SCANNER_CONTRACT_STALE';
      throw contractError;
    }
    if (typeof parsed !== 'object' || !Array.isArray(parsed.entries) ||
        !Number.isInteger(Number(parsed.matched_count)) ||
        !Number.isInteger(Number(parsed.ignored_backup_count)) ||
        !Number.isInteger(Number(parsed.rejected_count))) {
      throw new Error('device registry scanner returned an invalid contract');
    }
    return {
      contractVersion: parsed.contract_version,
      capabilities: capabilities.slice().sort(),
      entries: parsed.entries,
      deviceRefs: parsed.device_refs &&
        typeof parsed.device_refs === 'object' &&
        !Array.isArray(parsed.device_refs) ? parsed.device_refs : {},
      matchedCount: Number(parsed.matched_count),
      backupFilesIgnored: Number(parsed.ignored_backup_count),
      invalidFilesIgnored: Number(parsed.rejected_count)
    };
  }

  function _isLegacyCapabilityStudioOwner(plugin) {
    var definitions = plugin &&
      (plugin.expert_defs || plugin.expertDefs) || [];
    var names = (plugin && Array.isArray(plugin.experts) ?
      plugin.experts : []).map(String);
    definitions.forEach(function (definition) {
      if (definition && definition.name) names.push(String(definition.name));
    });
    return Boolean(
      plugin &&
      plugin.id === 'profit-growth-scenario' &&
      plugin.owned_experts === true &&
      names.indexOf('xtl_capability_studio_profitability_v1') !== -1
    );
  }

  function _installCapabilityStudioOwnership() {
    var installed = _loadInstalled();
    if (installed.indexOf('capability-studio-scenario') === -1) {
      installed.push('capability-studio-scenario');
      _saveInstalled(installed);
    }
    try {
      localStorage.setItem(
        EVOLUTION_STUDIO_OWNERSHIP_MIGRATION_KEY,
        'done'
      );
    } catch (e) {}
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
    // Before Evolution Console became a fleet-only surface, its stable plugin
    // id provisioned the Capability Studio profitability Expert. On the first
    // launch after the split, transfer that already-installed UI ownership to
    // Capability Studio so the Expert is not orphaned. Fresh installs are not
    // affected because this migration marker is written on their first launch.
    var ownershipMigrationDone = false;
    try {
      ownershipMigrationDone =
        localStorage.getItem(EVOLUTION_STUDIO_OWNERSHIP_MIGRATION_KEY) ===
          'done';
    } catch (e) {}
    if (!ownershipMigrationDone) {
      if (installed.indexOf('profit-growth-scenario') !== -1 &&
          merged.indexOf('capability-studio-scenario') === -1) {
        merged.push('capability-studio-scenario');
      }
      try {
        localStorage.setItem(
          EVOLUTION_STUDIO_OWNERSHIP_MIGRATION_KEY,
          'done'
        );
      } catch (e) {}
    }
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

    // Пометить плагин удаляемым: syncFromDevice не вернёт его, пока файл реестра на устройстве не исчезнет.
    markRemoving: function (id) {
      var a = _loadRemoving(); if (a.indexOf(id) === -1) { a.push(id); _saveRemoving(a); }
    },
    isRemoving: function (id) { return _loadRemoving().indexOf(id) !== -1; },
    clearRemoving: function (id) {
      _saveRemoving(_loadRemoving().filter(function (x) { return x !== id; }));
    },

    // Adds a user-created plugin (e.g. from GitHub URL) and installs it
    HTML_ON_DEVICE: HTML_MARK,

    addCustom: function (plugin) {
      _untombstone(plugin.id);   // явная установка снимает надгробие — переустановка снова видна
      var custom = _loadCustom();
      // Remove existing with same id before re-adding
      var filtered = custom.filter(function (p) { return p.id !== plugin.id; });
      filtered.push(plugin);
      _saveCustom(filtered);
      this.install(plugin.id);
    },

    removeCustom: function (id) {
      _tombstone(id);   // sync больше не воскресит, даже если файл реестра на устройстве ещё жив (гонка/сбой чистки)
      _saveCustom(_loadCustom().filter(function (p) { return p.id !== id; }));
      this.uninstall(id);
    },

    isRemoved: function (id) {
      return _loadRemoved().indexOf(id) !== -1;
    },

    // ── Local file registry sync ──────────────────────────────────
    // Agent-installed plugins write their manifest to a local file:
    //   ~/extella-plugins/_registry/<id>.json
    // The renderer cannot read local files directly, so we read them through a
    // tiny fython expert executed on the device. Each manifest is merged into
    // the custom registry (which caches in localStorage for instant/offline UI).
    // Best-effort: resolves to the array of synced manifests, never rejects.
    //
    // Evolution Console uses the separate strict scanner below. The scanner
    // Expert is provisioned by the release/integration layer; opening or
    // refreshing Console never saves an Expert, deletes a file, or mutates the
    // browser registry cache.
    scanDeviceManifests: function (deviceId, deviceRefs) {
      var exactDeviceId = String(deviceId || '').trim();
      var exactDeviceRefs = Array.isArray(deviceRefs) ? deviceRefs.slice().sort() : [];
      var fnName = '_etb_evolution_registry_scan_v1';
      if (!exactDeviceId) {
        return Promise.reject(new Error(
          'current device id is required for the read-only registry scan'
        ));
      }
      return ETB.api.runExpert(fnName, {
        device_refs_json: JSON.stringify(exactDeviceRefs)
      }, {
        // targets массивом — рабочее поле платформы; одиночный target остаётся
        // ради совместимости и молча игнорируется сервером.
        targets: [exactDeviceId],
        target: exactDeviceId,
        clientTimeoutMs: 180000,
        global: true
      }).then(function (response) {
        return _evolutionScannerContract(
          _evolutionScannerPayload(response)
        );
      });
    },

    syncFromDevice: function (deviceId, onlyId) {
      var self = this;
      var fnName = '_etb_registry_read';
      // Девайсные тумбстоуны (_registry/_removed/*.json, пишет чистка удаления):
      // зомби-хвост первого оборванного рана установки может дописать манифест
      // ПОСЛЕ удаления плагина — тогда карточка воскресала. Читатель работает
      // джанитором: манифест с затумбстоуненным id не отдаётся и удаляется с
      // диска. Переустановка сначала снимает тумбстоун (clearDeviceTombstone).
      var code = [
        'def ' + fnName + '(only_id: str = "") -> str:',
        '    import os, json, glob',
        '    d = os.path.expanduser("~/extella-plugins/_registry")',
        '    dead = set()',
        '    t_dir = os.path.join(d, "_removed")',
        '    if os.path.isdir(t_dir):',
        '        for tp in glob.glob(os.path.join(t_dir, "*.json")):',
        '            try:',
        '                with open(tp, "r", encoding="utf-8") as tf: tm = json.load(tf)',
        '                if isinstance(tm, dict) and tm.get("id"): dead.add(tm["id"])',
        '            except Exception:',
        '                pass',
        '    out = []',
        '    if os.path.isdir(d):',
        '        if only_id:',
        '            files = [os.path.join(d, only_id + ".json")]',
        '        else:',
        '            files = sorted(glob.glob(os.path.join(d, "*.json")))',
        '        for fp in files:',
        '            try:',
        '                with open(fp, "r", encoding="utf-8") as f:',
        '                    m = json.load(f)',
        '                if isinstance(m, dict) and m.get("id") in dead:',
        '                    try: os.remove(fp)',
        '                    except Exception: pass',
        '                    continue',
        // Мёртвые чужие карточки: local_server с rootPath, которого нет на ЭТОМ
        // устройстве (напр. абсолютный путь с чужого Мака, приехавший старым
        // синком) — не отдаём и удаляем файл. Hosted (ui.url) и info не трогаем.
        '                ui = m.get("ui") or {}',
        '                if isinstance(ui, dict) and ui.get("type") == "local_server" and not ui.get("url"):',
        '                    rp = ui.get("rootPath") or (m.get("artifacts") or {}).get("rootPath") or ""',
        '                    if rp and not os.path.exists(os.path.expanduser(str(rp))):',
        '                        try: os.remove(fp)',
        '                        except Exception: pass',
        '                        continue',
        '                out.append(m)',
        '            except Exception:',
        '                pass',
        '    return json.dumps({"m": out, "t": sorted(dead)})'
      ].join('\n');

      function ingest(res, onlyKnown) {
        var raw = (res && (res.result || res.output)) || '[]';
        var list;
        try { list = typeof raw === 'string' ? JSON.parse(raw) : raw; }
        catch (e) { list = []; }
        // Новый формат ридера: {m: манифесты, t: id из девайсных тумбстоунов}.
        // Тумбстоун доносит «снято с раздачи» до КЭША витрины: файл карточки
        // уже удалён, но localStorage иначе показывал бы её вечно (класс
        // «выключили hosted — карточка осталась у всех»).
        var tombstoned = [];
        if (list && !Array.isArray(list) && typeof list === 'object') {
          tombstoned = Array.isArray(list.t) ? list.t : [];
          list = Array.isArray(list.m) ? list.m : [];
        }
        if (!Array.isArray(list)) list = [];
        tombstoned.forEach(function (id) {
          if (!id) return;
          if (self.getById(id)) {
            self.removeCustom(id);
            if (ETB.router && ETB.router.evict) ETB.router.evict(id);
          }
        });
        var added = [], deviceIds = {}, removing = _loadRemoving();
        list.forEach(function (m) {
          if (!m || !m.id) return;
          // Recovery path for an empty/cleared local cache: the pre-split
          // device manifest is authoritative evidence that this exact Expert
          // belonged to Capability Studio. Run even if the one-time bootstrap
          // marker was already written before async device sync completed.
          if (_isLegacyCapabilityStudioOwner(m)) {
            _installCapabilityStudioOwnership();
          }
          // Без-target ран уходит на дефолтный таргет АККАУНТА — на общем
          // аккаунте (invite-токены) это устройство ВЛАДЕЛЬЦА, и коллегам
          // приезжали его личные карточки. Фолбэк вправе только восстановить
          // карточки, уже известные ЭТОМУ устройству, — не импортировать чужие.
          if (onlyKnown && !self.getById(m.id)) return;
          deviceIds[m.id] = true;
          if (removing.indexOf(m.id) !== -1) return;   // помечен на удаление, файл ещё жив — НЕ возвращаем
          self.addCustom(m); added.push(m);
        });
        // удаление завершилось (файла на устройстве больше нет) — снимаем метку
        var still = removing.filter(function (id) { return deviceIds[id]; });
        if (still.length !== removing.length) _saveRemoving(still);
        return added;
      }
      function run(useTarget) {
        // runExpertAsync, не runExpert: тяжёлые прогоны платформа откладывает и
        // отдаёт task_id — синхронный вызов получал конверт БЕЗ результата,
        // ingest видел пусто, и витрина считала, что на устройстве карточек нет.
        // Так свежая панель, лежащая на диске, не доезжала до человека (04.08).
        var opts = { timeout: 60, maxWait: 90000 };
        // ЗАКРЕПЛЕНИЕ — ТОЛЬКО МАССИВОМ targets. Одиночный target платформа
        // принимает молча и игнорирует: чтение реестра уходило на дефолтное
        // устройство аккаунта (у владельца — VPS, где ~/extella-plugins нет),
        // отвечало пустым списком, и витрина вечно показывала карточку из
        // своего кэша. Свежая панель ставилась на диск и не открывалась.
        if (useTarget && deviceId) { opts.targets = [deviceId]; opts.target = deviceId; }
        return ETB.api.runExpertAsync(fnName, { only_id: onlyId || '' }, opts);
      }

      return ETB.api.saveExpert({
        name: fnName,
        description: 'Read local Extella plugin registry files',
        code: code,
        kwargs: { only_id: '' },
        cspl: 'fython'
      }).then(function () {
        return run(true);
      }).then(ingest).then(function (added) {
        // A stale/unavailable target id yields nothing — retry on the CURRENT
        // device (no target). Robust to device re-registration (id changes).
        // onlyKnown: без-target ран может исполниться на устройстве владельца
        // аккаунта — восстанавливаем только свои карточки, чужие не импортируем.
        if (!added.length && deviceId) {
          return run(false).then(function (r) { return ingest(r, true); })
            .catch(function () { return added; });
        }
        return added;
      }).catch(function () {
        return run(false).then(function (r) { return ingest(r, true); })
          .catch(function () { return []; });
      });
    },

    // Снять девайсный тумбстоун перед (пере)установкой: иначе джанитор
    // syncFromDevice примет свежий манифест за позднюю запись зомби и удалит.
    // Best-effort, зеркалит фолбэк syncFromDevice (target → без target).
    clearDeviceTombstone: function (deviceId, pluginId) {
      if (!pluginId) return Promise.resolve();
      var fnName = '_etb_tombstone_clear';
      var code = [
        'def ' + fnName + '(plugin_id: str = "") -> str:',
        '    import os, json, glob',
        '    t_dir = os.path.expanduser("~/extella-plugins/_registry/_removed")',
        '    removed = []',
        '    if plugin_id and os.path.isdir(t_dir):',
        '        for fp in glob.glob(os.path.join(t_dir, "*.json")):',
        '            try:',
        '                with open(fp, "r", encoding="utf-8") as f: m = json.load(f)',
        '                if isinstance(m, dict) and m.get("id") == plugin_id:',
        '                    os.remove(fp); removed.append(fp)',
        '            except Exception:',
        '                pass',
        '    return json.dumps(removed)'
      ].join('\n');
      return ETB.api.saveExpert({
        name: fnName,
        description: 'Remove plugin removal tombstone before reinstall',
        code: code,
        kwargs: { plugin_id: '' },
        cspl: 'fython'
      }).then(function () {
        var opts = { timeout: 20 };
        if (deviceId) { opts.targets = [deviceId]; opts.target = deviceId; }
        return ETB.api.runExpert(fnName, { plugin_id: pluginId }, opts).catch(function () {
          if (deviceId) return ETB.api.runExpert(fnName, { plugin_id: pluginId }, { timeout: 20 });
        });
      }).catch(function () {});
    }
  };
})();
