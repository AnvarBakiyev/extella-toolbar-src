// ── EXTELLA EVOLUTION AUTOMATION REGISTRY PROVIDER ─────────────────────────
// Read-only evidence provider for the Evolution Console automation registry.
//
// This module does not compute the final automation projection and never
// changes automation state. In particular it does not write KV, save Experts,
// mutate localStorage, ingest cards into ETB.registry or delete device files.
// The device transport is supplied by ETB.registry.scanDeviceManifests(), whose
// result is validated again here before any card can enter the source snapshot.

ETB.evolutionAutomationRegistryProvider = (function () {
  var SOURCE_SCHEMA =
    'extella.evolution.automation-registry-sources.v3';
  var BROWSER_INSTALLED_KEY = 'etb_plugins_installed_v1';
  var STRICT_CARD_FILE = /^([a-z0-9][a-z0-9._-]{1,79})\.json$/;
  var AUTOMATION_ID = /^[a-z0-9][a-z0-9._-]{1,79}$/;

  function hasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value, key);
  }

  function clone(value) {
    if (value == null) return value;
    return JSON.parse(JSON.stringify(value));
  }

  function text(value) {
    return String(value == null ? '' : value).trim();
  }

  function sourceError(source, code, messageRu, messageEn, detail) {
    var output = {
      source: String(source || 'UNKNOWN'),
      code: String(code || 'SOURCE_UNAVAILABLE'),
      message_ru: String(messageRu || 'Источник данных недоступен'),
      message_en: String(messageEn || 'The data source is unavailable')
    };
    if (detail) output.detail = String(detail);
    return output;
  }

  function errorDetail(error) {
    return String(error && error.message || error || 'unknown error').slice(0, 500);
  }

  function assertContext(options) {
    if (options && typeof options.assertContext === 'function') {
      try { options.assertContext(); }
      catch (error) {
        error.__evolutionAutomationRegistryContext = true;
        throw error;
      }
    }
  }

  function rethrowContext(error) {
    if (error && error.__evolutionAutomationRegistryContext === true) {
      throw error;
    }
  }

  function apiFailed(response) {
    var status = text(response && response.status).toLowerCase();
    var httpStatus = Number(response && (
      response.httpStatus != null ? response.httpStatus : response.http_status
    ));
    return status === 'error' || status === 'failed' ||
      status === 'not_found' || httpStatus >= 400;
  }

  function apiFailureMessage(response) {
    var detail = response && response.detail;
    if (detail && typeof detail === 'object') {
      detail = detail.message || detail.msg || '';
    }
    return [
      response && response.message,
      response && typeof response.error === 'string' ? response.error :
        (response && response.error && response.error.message),
      detail
    ].filter(Boolean).join(' ') || 'API source returned an error';
  }

  function apiValue(response) {
    if (response == null) return null;
    if (hasOwn(response, 'value')) return response.value;
    if (hasOwn(response, 'kv_value')) return response.kv_value;
    if (response.result && hasOwn(response.result, 'value')) {
      return response.result.value;
    }
    return response;
  }

  function parseJsonDocument(response) {
    var value;
    if (apiFailed(response)) throw new Error(apiFailureMessage(response));
    value = apiValue(response);
    if (value == null || value === '') {
      throw new Error('KV source returned an empty value');
    }
    if (typeof value !== 'string') return clone(value);
    try { return JSON.parse(value); }
    catch (_) { throw new Error('KV source returned invalid JSON'); }
  }

  function parseLooseValue(response) {
    var value;
    if (apiFailed(response)) throw new Error(apiFailureMessage(response));
    value = apiValue(response);
    if (typeof value !== 'string') return clone(value);
    try { return JSON.parse(value); }
    catch (_) { return value; }
  }

  function missingResponse(response) {
    var status = text(response && response.status).toLowerCase();
    var httpStatus = Number(response && (
      response.httpStatus != null ? response.httpStatus : response.http_status
    ));
    var detail = apiFailureMessage(response).toLowerCase();
    return status === 'not_found' || httpStatus === 404 ||
      /key[^a-z0-9]+not[^a-z0-9]+found|not[^a-z0-9]+found[^a-z0-9]+key/
        .test(detail);
  }

  function missingError(error) {
    return /key[^a-z0-9]+not[^a-z0-9]+found|not[^a-z0-9]+found[^a-z0-9]+key/
      .test(errorDetail(error).toLowerCase());
  }

  function documentItems(value) {
    if (Array.isArray(value)) return clone(value);
    if (value && Array.isArray(value.items)) return clone(value.items);
    throw new Error('source document must contain an items array');
  }

  // ОБЩИЕ РЕЕСТРЫ ЧИТАЮТСЯ ПО СВОБОДНЫМ ИМЕНАМ (перенос 28.07.2026).
  //
  // Было так: `_mkt_automations` отдавал 0 записей при 12 целых. // canon-ok: разбор истории, не чтение
  // Причина не в скоупе как
  // таковом — у СТАРОГО имени накопились близнецы в разных областях, и `kv/get` отдавал не ту
  // запись. Лечили это закреплением агента-владельца, но тот же идентификатор запрещён здесь
  // как платный Claude — конфликт был неустраним по построению.
  //
  // Опыт 28.07 показал главное: `global: true` РАБОТАЕТ, если у имени нет истории. Свежий
  // ключ, записанный одним агентом, читается всеми одинаково и без всякого закрепления.
  // Поэтому лечим не область, а ИМЯ: зеркало в свободные имена пишет wz_registry_rebuild,
  // а здесь остаётся обычное общее чтение — и запрещённого идентификатора тут больше нет.
  var SHARED_REGISTRY_KEYS = {
    automations: 'extella:automations:v2',
    installed: 'extella:installed:v2'
  };

  function readKvItems(api, key, options) {
    var scope = {
      global: true
    };
    assertContext(options);
    return Promise.resolve().then(function () {
      return api.kvGet(key, scope);
    }).then(function (response) {
      assertContext(options);
      return {
        available: true,
        key: key,
        scope: clone(scope),
        items: documentItems(parseJsonDocument(response)),
        errors: []
      };
    }).catch(function (error) {
      rethrowContext(error);
      return {
        available: false,
        key: key,
        scope: clone(scope),
        items: [],
        errors: [sourceError(
          key,
          'GLOBAL_KV_SOURCE_UNAVAILABLE',
          'Глобальный KV-источник ' + key + ' недоступен',
          'Global KV source ' + key + ' is unavailable',
          errorDetail(error)
        )]
      };
    });
  }

  function installedId(value) {
    var id = text(value);
    if (!id || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,239}$/.test(id)) return null;
    return id;
  }

  function readBrowserInstalled(storage, options) {
    var raw;
    var parsed;
    var ids = [];
    var seen = {};
    var errors = [];
    assertContext(options);
    if (!storage || typeof storage.getItem !== 'function') {
      return {
        available: false,
        key: BROWSER_INSTALLED_KEY,
        ids: [],
        errors: [sourceError(
          'BROWSER_INSTALLED',
          'BROWSER_STORAGE_UNAVAILABLE',
          'Локальный реестр установок браузера недоступен',
          'The browser installation registry is unavailable'
        )]
      };
    }
    try {
      raw = storage.getItem(BROWSER_INSTALLED_KEY);
      parsed = raw == null || raw === '' ? [] : JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        throw new Error('browser installation registry must be an array');
      }
      parsed.forEach(function (value, index) {
        var id = installedId(value);
        if (!id) {
          errors.push(sourceError(
            'BROWSER_INSTALLED',
            'BROWSER_INSTALLED_ID_INVALID',
            'Локальный реестр содержит некорректный идентификатор установки',
            'The browser registry contains an invalid installation id',
            'index=' + index
          ));
          return;
        }
        if (!seen[id]) {
          seen[id] = true;
          ids.push(id);
        }
      });
      assertContext(options);
      return {
        available: true,
        key: BROWSER_INSTALLED_KEY,
        ids: ids.sort(),
        errors: errors
      };
    } catch (error) {
      rethrowContext(error);
      return {
        available: false,
        key: BROWSER_INSTALLED_KEY,
        ids: [],
        errors: [sourceError(
          'BROWSER_INSTALLED',
          'BROWSER_INSTALLED_INVALID',
          'Локальный реестр установок браузера повреждён',
          'The browser installation registry is invalid',
          errorDetail(error)
        )]
      };
    }
  }

  function responseRows(response, names) {
    var i;
    if (apiFailed(response)) throw new Error(apiFailureMessage(response));
    if (Array.isArray(response)) return response;
    for (i = 0; i < names.length; i += 1) {
      if (response && Array.isArray(response[names[i]])) {
        return response[names[i]];
      }
    }
    throw new Error('API source returned no rows array');
  }

  function normalizeRows(
    rows,
    source,
    identity,
    projector,
    invalidCode,
    duplicateCode
  ) {
    var output = [];
    var seen = {};
    var errors = [];
    rows.forEach(function (row, index) {
      var id = text(identity(row));
      if (!id) {
        errors.push(sourceError(
          source,
          invalidCode,
          'Источник вернул строку без стабильного идентификатора',
          'The source returned a row without a stable identifier',
          'index=' + index
        ));
        return;
      }
      if (seen[id]) {
        errors.push(sourceError(
          source,
          duplicateCode,
          'Источник вернул дублирующийся стабильный идентификатор',
          'The source returned a duplicate stable identifier',
          id
        ));
        return;
      }
      seen[id] = true;
      output.push(projector(row, id));
    });
    return { rows: output, errors: errors };
  }

  function readPlatformAgents(api, options) {
    assertContext(options);
    return Promise.resolve().then(function () {
      return api.agentsList();
    }).then(function (response) {
      var normalized;
      assertContext(options);
      normalized = normalizeRows(
        responseRows(response, ['agents', 'results', 'items']),
        'PLATFORM_AGENTS',
        function (row) { return row && (row.id || row.agent_id); },
        function (row, id) {
          return {
            id: id,
            name: text(row && (row.name || row.agent_name)) || id,
            provider: text(row && row.provider),
            model: text(row && row.model)
          };
        },
        'PLATFORM_AGENT_ID_REQUIRED',
        'DUPLICATE_PLATFORM_AGENT_ID'
      );
      return {
        available: true,
        rows: normalized.rows,
        errors: normalized.errors
      };
    }).catch(function (error) {
      rethrowContext(error);
      return {
        available: false,
        rows: [],
        errors: [sourceError(
          'PLATFORM_AGENTS',
          'PLATFORM_AGENTS_UNAVAILABLE',
          'Список платформенных агентов недоступен',
          'The platform agent list is unavailable',
          errorDetail(error)
        )]
      };
    });
  }

  function readPlatformExperts(api, options) {
    var scope = {
      global: true
    };
    assertContext(options);
    return Promise.resolve().then(function () {
      return api.expertsListScoped(scope);
    }).then(function (response) {
      var normalized;
      assertContext(options);
      normalized = normalizeRows(
        responseRows(response, ['experts', 'results', 'items']),
        'PLATFORM_EXPERTS',
        function (row) { return row && (row.name || row.expert_name); },
        function (row, name) {
          return {
            name: name,
            description: text(row && (
              row.description || row.expert_description
            ))
          };
        },
        'PLATFORM_EXPERT_NAME_REQUIRED',
        'DUPLICATE_PLATFORM_EXPERT_NAME'
      );
      return {
        available: true,
        scope: clone(scope),
        rows: normalized.rows,
        errors: normalized.errors
      };
    }).catch(function (error) {
      rethrowContext(error);
      return {
        available: false,
        scope: clone(scope),
        rows: [],
        errors: [sourceError(
          'PLATFORM_EXPERTS',
          'PLATFORM_EXPERTS_UNAVAILABLE',
          'Список платформенных экспертов недоступен',
          'The platform Expert list is unavailable',
          errorDetail(error)
        )]
      };
    });
  }

  function scannerEntries(result) {
    if (Array.isArray(result)) return result;
    if (result && Array.isArray(result.entries)) return result.entries;
    if (result && Array.isArray(result.files)) return result.files;
    if (result && Array.isArray(result.cards)) return result.cards;
    throw new Error('device scanner returned no entries array');
  }

  function scannerCount(result, names) {
    var i;
    var value;
    for (i = 0; i < names.length; i += 1) {
      value = result && Number(result[names[i]]);
      if (isFinite(value) && value >= 0) return Math.floor(value);
    }
    return 0;
  }

  function entryFilename(entry) {
    return text(entry && (
      entry.filename || entry.fileName || entry.file_name || entry.name
    ));
  }

  function entryManifest(entry) {
    if (!entry || typeof entry !== 'object') return null;
    if (entry.manifest && typeof entry.manifest === 'object') {
      return entry.manifest;
    }
    if (entry.value && typeof entry.value === 'object') return entry.value;
    if (entry.card && typeof entry.card === 'object') return entry.card;
    return null;
  }

  function safeRuntimeState(value) {
    var output;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    output = {
      enabled: value.enabled,
      active_version: typeof value.active_version === 'string' ?
        value.active_version.slice(0, 160) : value.active_version,
      last_run: null,
      last_result: typeof value.last_result === 'string' ?
        value.last_result.slice(0, 160) : value.last_result,
      last_error: null,
      schedules: [],
      checked_at: typeof value.checked_at === 'string' ?
        value.checked_at.slice(0, 160) : value.checked_at
    };
    if (value.last_run && typeof value.last_run === 'object' &&
        !Array.isArray(value.last_run)) {
      output.last_run = {};
      ['id', 'at', 'ts', 'status', 'kind'].forEach(function (key) {
        var exact = value.last_run[key];
        if (typeof exact === 'string') {
          output.last_run[key] = exact.slice(0, 500);
        } else if (typeof exact === 'number' && isFinite(exact)) {
          output.last_run[key] = exact;
        }
      });
    } else if (value.last_run != null) {
      output.last_run = value.last_run;
    }
    if (value.last_error && typeof value.last_error === 'object' &&
        !Array.isArray(value.last_error)) {
      output.last_error = {};
      ['code', 'message_ru', 'message_en'].forEach(function (key) {
        if (typeof value.last_error[key] === 'string') {
          output.last_error[key] = value.last_error[key].slice(0, 1000);
        }
      });
    } else if (value.last_error != null) {
      output.last_error = value.last_error;
    }
    if (Array.isArray(value.schedules)) {
      output.schedules = value.schedules.slice(0, 200).map(function (schedule) {
        var safe = {};
        if (!schedule || typeof schedule !== 'object' ||
            Array.isArray(schedule)) return null;
        ['id', 'location', 'kind', 'cadence'].forEach(function (key) {
          if (typeof schedule[key] === 'string') {
            safe[key] = schedule[key].slice(0, 160);
          }
        });
        if (typeof schedule.active === 'boolean') {
          safe.active = schedule.active;
        }
        if (schedule.next_run === null ||
            typeof schedule.next_run === 'string' ||
            (typeof schedule.next_run === 'number' &&
             isFinite(schedule.next_run))) {
          safe.next_run = schedule.next_run;
        }
        return safe;
      }).filter(Boolean);
    } else {
      output.schedules = value.schedules;
    }
    return output;
  }

  function safeProbe(value, stateProbe) {
    var output;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    output = {
      available: value.available === true,
      responded: value.responded === true,
      status_code: Number.isInteger(Number(value.status_code)) ?
        Number(value.status_code) : null,
      error_code: text(value.error_code).slice(0, 160) || null,
      value: null
    };
    if (stateProbe) {
      output.value = safeRuntimeState(value.value);
    } else if (value.value && typeof value.value === 'object' &&
               !Array.isArray(value.value)) {
      output.value = {};
      ['ok', 'service', 'version', 'mode'].forEach(function (key) {
        var exact = value.value[key];
        if (typeof exact === 'string') {
          output.value[key] = exact.slice(0, 500);
        } else if (typeof exact === 'boolean' ||
                   (typeof exact === 'number' && isFinite(exact))) {
          output.value[key] = exact;
        }
      });
    }
    return output;
  }

  function safeRuntime(value) {
    var port;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    port = Number(value.port);
    return {
      configured: value.configured === true,
      port: Number.isInteger(port) && port > 0 && port <= 65535 ? port : null,
      health: safeProbe(value.health, false),
      state: safeProbe(value.state, true),
      state_path_source:
        text(value.state_path_source).slice(0, 80) || null
    };
  }

  function normalizeDeviceScan(result) {
    var cards = [];
    var errors = [];
    var seen = {};
    var backupFilesIgnored = scannerCount(result, [
      'backupFilesIgnored',
      'backup_files_ignored',
      'skippedBackups',
      'skipped_backups'
    ]);
    var invalidFilesIgnored = scannerCount(result, [
      'invalidFilesIgnored',
      'invalid_files_ignored'
    ]);
    var locallyIgnoredBackups = 0;
    var locallyIgnoredInvalid = 0;
    scannerEntries(result).forEach(function (entry, index) {
      var filename = entryFilename(entry);
      var match;
      var manifest;
      var id;
      if (filename.indexOf('.bak_') !== -1) {
        locallyIgnoredBackups += 1;
        return;
      }
      if (!filename || filename.indexOf('/') !== -1 ||
          filename.indexOf('\\') !== -1) {
        locallyIgnoredInvalid += 1;
        errors.push(sourceError(
          'DEVICE_CARDS',
          'DEVICE_CARD_FILENAME_REQUIRED',
          'Карточка устройства не имеет допустимого имени верхнего уровня',
          'A device card has no valid top-level filename',
          'index=' + index
        ));
        return;
      }
      match = STRICT_CARD_FILE.exec(filename);
      if (!match) {
        locallyIgnoredInvalid += 1;
        errors.push(sourceError(
          'DEVICE_CARDS',
          'DEVICE_CARD_FILENAME_INVALID',
          'Карточка устройства не соответствует строгой маске <id>.json',
          'A device card does not match the strict <id>.json mask',
          filename
        ));
        return;
      }
      manifest = entryManifest(entry);
      if (!manifest) {
        locallyIgnoredInvalid += 1;
        errors.push(sourceError(
          'DEVICE_CARDS',
          'DEVICE_CARD_MANIFEST_INVALID',
          'Файл карточки устройства не содержит JSON-манифест',
          'The device card file contains no JSON manifest',
          filename
        ));
        return;
      }
      id = text(manifest.id);
      if (!id || id !== match[1]) {
        locallyIgnoredInvalid += 1;
        errors.push(sourceError(
          'DEVICE_CARDS',
          'DEVICE_CARD_ID_FILENAME_MISMATCH',
          'Идентификатор карточки не совпадает с именем файла',
          'The device card id does not match its filename',
          filename
        ));
        return;
      }
      if (seen[id]) {
        locallyIgnoredInvalid += 1;
        errors.push(sourceError(
          'DEVICE_CARDS',
          'DUPLICATE_DEVICE_CARD_ID',
          'Сканер вернул две карточки с одним идентификатором',
          'The scanner returned duplicate cards for one id',
          id
        ));
        return;
      }
      seen[id] = true;
      cards.push({
        filename: filename,
        manifest: clone(manifest),
        runtime: safeRuntime(entry && entry.runtime)
      });
    });
    backupFilesIgnored = Math.max(backupFilesIgnored, locallyIgnoredBackups);
    invalidFilesIgnored = Math.max(invalidFilesIgnored, locallyIgnoredInvalid);
    cards.sort(function (left, right) {
      return left.filename < right.filename ? -1 :
        (left.filename > right.filename ? 1 : 0);
    });
    return {
      cards: cards,
      backupFilesIgnored: backupFilesIgnored,
      invalidFilesIgnored: invalidFilesIgnored,
      errors: errors
    };
  }

  function currentDeviceId(options) {
    var value;
    if (options && hasOwn(options, 'deviceId')) {
      if (text(options.deviceId)) {
        return Promise.resolve(text(options.deviceId));
      }
      return Promise.reject(new Error(
        text(options.deviceIdError) || 'current desktop device id is unavailable'
      ));
    }
    try {
      if (typeof window !== 'undefined' && window.extellaDesktop &&
          typeof window.extellaDesktop.getDeviceID === 'function') {
        value = window.extellaDesktop.getDeviceID();
        return Promise.resolve(value).then(function (id) {
          id = text(id);
          if (!id) throw new Error('current desktop device id is empty');
          return id;
        });
      }
    } catch (error) {
      return Promise.reject(error);
    }
    return Promise.reject(new Error(
      'current desktop device id is unavailable'
    ));
  }

  function deviceScanner(options) {
    if (options && typeof options.scanDeviceCards === 'function') {
      return options.scanDeviceCards;
    }
    if (ETB.registry &&
        typeof ETB.registry.scanDeviceManifests === 'function') {
      return function (deviceId) {
        return ETB.registry.scanDeviceManifests(deviceId);
      };
    }
    return null;
  }

  function readDeviceCards(options) {
    var scan = deviceScanner(options);
    if (!scan) {
      return Promise.resolve({
        available: false,
        deviceId: null,
        cards: [],
        backupFilesIgnored: 0,
        invalidFilesIgnored: 0,
        errors: [sourceError(
          'DEVICE_CARDS',
          'DEVICE_SCANNER_UNAVAILABLE',
          'Read-only сканер карточек устройства недоступен',
          'The read-only device card scanner is unavailable'
        )]
      });
    }
    return currentDeviceId(options).then(function (deviceId) {
      assertContext(options);
      return Promise.resolve(scan(deviceId)).then(function (result) {
        var normalized;
        assertContext(options);
        normalized = normalizeDeviceScan(result);
        if (normalized.invalidFilesIgnored > 0 &&
            normalized.errors.length === 0) {
          normalized.errors.push(sourceError(
            'DEVICE_CARDS',
            'DEVICE_CARD_FILES_REJECTED',
            'Часть файлов карточек устройства отклонена строгой проверкой',
            'Some device card files were rejected by strict validation',
            'count=' + normalized.invalidFilesIgnored
          ));
        }
        return {
          available: true,
          deviceId: deviceId,
          cards: normalized.cards,
          backupFilesIgnored: normalized.backupFilesIgnored,
          invalidFilesIgnored: normalized.invalidFilesIgnored,
          errors: normalized.errors
        };
      });
    }).catch(function (error) {
      rethrowContext(error);
      return {
        available: false,
        deviceId: null,
        cards: [],
        backupFilesIgnored: 0,
        invalidFilesIgnored: 0,
        errors: [sourceError(
          'DEVICE_CARDS',
          'DEVICE_CARDS_UNAVAILABLE',
          'Карточки текущего устройства недоступны',
          'Cards for the current device are unavailable',
          errorDetail(error)
        )]
      };
    });
  }

  function automationId(value) {
    return text(value && (
      value.automation_id || value.automationId ||
      value.id || value.orchestrator
    ));
  }

  function installedAutomationIds(deviceCards) {
    var ids = [];
    var seen = {};
    (deviceCards || []).forEach(function (card) {
      var manifest = card && card.manifest;
      var id = text(manifest && manifest.id);
      var business = deviceCardClassification(card).kind ===
        'BUSINESS_AUTOMATION';
      if (business && AUTOMATION_ID.test(id) && !seen[id]) {
        seen[id] = true;
        ids.push(id);
      }
    });
    return ids.sort();
  }

  function embeddedAutomationId(manifest) {
    var value = manifest && manifest.automation;
    var id = text(value && (value.automation_id || value.automationId));
    return AUTOMATION_ID.test(id) && id === text(manifest && manifest.id) ?
      id : null;
  }

  function deviceCardClassification(card) {
    var manifest = card && card.manifest;
    var id = text(manifest && manifest.id);
    if (embeddedAutomationId(manifest)) {
      return { kind: 'BUSINESS_AUTOMATION', evidence: 'AUTOMATION_PASSPORT' };
    }
    if (manifest && (
      (manifest.category === 'automations' && manifest.type === 'process') ||
      manifest.schemaVersion === 'extella-process-pack-v1' ||
      manifest.schema_version === 'extella-process-pack-v1'
    )) {
      return { kind: 'BUSINESS_AUTOMATION', evidence: 'PROCESS_MANIFEST' };
    }
    // Bounded compatibility only for the three migrations reviewed on
    // 2026-07-26.  New products must arrive through canonical passport or
    // process metadata; extending this list is intentionally forbidden.
    if (['extella_1c_agent', 'extella_contract_agent',
         'extella_travel_agency'].indexOf(id) !== -1) {
      return { kind: 'BUSINESS_AUTOMATION', evidence: 'REVIEWED_MIGRATION' };
    }
    if (manifest && manifest.system === true) {
      return { kind: 'SYSTEM_SURFACE', evidence: 'SYSTEM_MARKER' };
    }
    return { kind: 'UNCLASSIFIED', evidence: 'CLASSIFICATION_MISSING' };
  }

  function deviceCardInventory(deviceCards) {
    var available = Boolean(deviceCards && deviceCards.available === true);
    var rows = available ? (deviceCards.cards || []).map(function (card) {
      var manifest = card && card.manifest || {};
      var classification = deviceCardClassification(card);
      var name = manifest.name || manifest.title || null;
      return {
        id: text(manifest.id),
        name: clone(name),
        version: text(manifest.version) || null,
        kind: classification.kind,
        evidence: classification.evidence
      };
    }) : [];
    var counts = {
      discovered: available ? rows.length : null,
      business_automations: available ? 0 : null,
      system_surfaces: available ? 0 : null,
      unclassified: available ? 0 : null
    };
    if (available) {
      rows.forEach(function (row) {
        if (row.kind === 'BUSINESS_AUTOMATION') {
          counts.business_automations += 1;
        } else if (row.kind === 'SYSTEM_SURFACE') {
          counts.system_surfaces += 1;
        } else {
          counts.unclassified += 1;
        }
      });
    }
    return {
      schema: 'extella.evolution.device_inventory.v1',
      available: available,
      classification_complete: available && counts.unclassified === 0,
      counts: counts,
      rows: rows
    };
  }

  function canonicalState(value) {
    var status;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('agent_state must be an object');
    }
    status = text(value.status).toLowerCase();
    if (typeof value.enabled === 'boolean') {
      return { enabled: value.enabled, status: status || null };
    }
    if (status === 'active') return { enabled: true, status: status };
    if (status === 'paused' || status === 'frozen' || status === 'disabled') {
      return { enabled: false, status: status };
    }
    return { enabled: 'UNKNOWN', status: status || null };
  }

  function canonicalRuns(value) {
    var runs;
    var latest;
    function timestamp(exact) {
      var parsed;
      if (typeof exact === 'number' && isFinite(exact)) return exact;
      parsed = Date.parse(exact);
      if (!isFinite(parsed)) {
        throw new Error('agent_runs contains an invalid timestamp');
      }
      return parsed;
    }
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        !Array.isArray(value.runs)) {
      throw new Error('agent_runs must contain a runs array');
    }
    if (value.runs.length > 1000) {
      throw new Error('agent_runs exceeds the bounded history limit');
    }
    runs = value.runs.map(function (run) {
      var ts;
      if (!run || typeof run !== 'object' || Array.isArray(run)) {
        throw new Error('agent_runs contains an invalid run');
      }
      ts = run.ts;
      if (typeof ts !== 'string' &&
          !(typeof ts === 'number' && isFinite(ts))) {
        throw new Error('agent_runs contains an invalid timestamp');
      }
      timestamp(ts);
      if (run.ok !== true && run.ok !== false && run.ok !== null) {
        throw new Error('agent_runs contains an invalid result');
      }
      return {
        ts: ts,
        ok: run.ok
      };
    }).sort(function (left, right) {
      return timestamp(right.ts) - timestamp(left.ts);
    });
    latest = runs.length ? runs[0] : null;
    return { latest: latest, count: runs.length };
  }

  function readAutomationKvFact(api, automation, kind, options) {
    var prefix = kind === 'state' ? 'agent_state:' : 'agent_runs:';
    var key = prefix + automation;
    var source = kind === 'state' ? 'AUTOMATION_STATE' : 'AUTOMATION_RUNS';
    var scope = {};
    assertContext(options);
    return Promise.resolve().then(function () {
      return api.kvGet(key, scope);
    }).then(function (response) {
      var value;
      assertContext(options);
      if (missingResponse(response)) {
        return {
          available: true,
          present: false,
          automationId: automation,
          key: key,
          scope: clone(scope),
          value: null,
          errors: []
        };
      }
      value = parseJsonDocument(response);
      return {
        available: true,
        present: true,
        automationId: automation,
        key: key,
        scope: clone(scope),
        value: kind === 'state' ?
          canonicalState(value) : canonicalRuns(value),
        errors: []
      };
    }).catch(function (error) {
      rethrowContext(error);
      if (missingError(error)) {
        return {
          available: true,
          present: false,
          automationId: automation,
          key: key,
          scope: clone(scope),
          value: null,
          errors: []
        };
      }
      return {
        available: false,
        present: false,
        automationId: automation,
        key: key,
        scope: clone(scope),
        value: null,
        errors: [sourceError(
          source,
          kind === 'state' ?
            'AUTOMATION_STATE_UNAVAILABLE' : 'AUTOMATION_RUNS_UNAVAILABLE',
          kind === 'state' ?
            'Каноническое состояние автоматизации недоступно' :
            'Каноническая история запусков автоматизации недоступна',
          kind === 'state' ?
            'The canonical automation state is unavailable' :
            'The canonical automation run history is unavailable',
          automation + ':' + errorDetail(error)
        )]
      };
    });
  }

  function readAutomationKvFacts(api, ids, kind, options) {
    return Promise.all(ids.map(function (id) {
      return readAutomationKvFact(api, id, kind, options);
    })).then(function (facts) {
      var errors = [];
      facts.forEach(function (fact) {
        errors = errors.concat(fact.errors || []);
      });
      return {
        available: facts.every(function (fact) {
          return fact.available === true;
        }),
        facts: facts,
        errors: errors
      };
    });
  }

  function schedulerScopeAgentId(platformAgents, options) {
    var explicit = installedId(options && options.schedulerScopeAgentId);
    var matches;
    if (explicit) return explicit;
    matches = (platformAgents && platformAgents.rows || []).filter(
      function (agent) {
        return text(agent && agent.name) === 'Extella (Claude)' &&
          text(agent && agent.provider).toLowerCase() === 'anthropic' &&
          text(agent && agent.model).toLowerCase().indexOf('claude') !== -1;
      }
    );
    return matches.length === 1 ? installedId(matches[0].id) : null;
  }

  function schedulerIndexSids(value) {
    var raw = Array.isArray(value) ? value :
      (value && Array.isArray(value.sids) ? value.sids : null);
    var output = [];
    var seen = {};
    if (!raw) throw new Error('scheduler index must contain a sids array');
    raw.forEach(function (value) {
      var sid = text(value);
      if (sid.indexOf('sched:') === 0) sid = sid.slice(6);
      if (!sid || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$/.test(sid)) {
        throw new Error('scheduler index contains an invalid sid');
      }
      if (!seen[sid]) {
        seen[sid] = true;
        output.push(sid);
      }
    });
    return output.sort();
  }

  function readSchedulerIndex(api, platformAgents, options) {
    var agentId = schedulerScopeAgentId(platformAgents, options);
    var key = 'sched:__index__';
    var scope = agentId ? { agentId: agentId } : null;
    if (!scope) {
      return Promise.resolve({
        available: false,
        key: key,
        scope: null,
        sids: [],
        errors: [sourceError(
          'SCHEDULER_INDEX',
          'SCHEDULER_SCOPE_UNRESOLVED',
          'Штатный скоуп индекса расписаний не определён однозначно',
          'The canonical scheduler-index scope could not be resolved uniquely'
        )]
      });
    }
    assertContext(options);
    return Promise.resolve().then(function () {
      return api.kvGet(key, scope);
    }).then(function (response) {
      var value;
      assertContext(options);
      if (missingResponse(response)) {
        throw new Error('scheduler index key not found');
      }
      value = parseJsonDocument(response);
      return {
        available: true,
        key: key,
        scope: clone(scope),
        sids: schedulerIndexSids(value),
        errors: []
      };
    }).catch(function (error) {
      rethrowContext(error);
      return {
        available: false,
        key: key,
        scope: clone(scope),
        sids: [],
        errors: [sourceError(
          'SCHEDULER_INDEX',
          'SCHEDULER_INDEX_UNAVAILABLE',
          'Канонический индекс расписаний недоступен',
          'The canonical scheduler index is unavailable',
          errorDetail(error)
        )]
      };
    });
  }

  function appendScheduleDescriptor(output, seen, automation, descriptor) {
    var keys = [];
    var agentId;
    var global;
    if (!descriptor || typeof descriptor !== 'object') return;
    [
      descriptor.kv_key,
      descriptor.kvKey,
      descriptor.active_key,
      descriptor.activeKey
    ].forEach(function (value) {
      value = text(value);
      if (value && keys.indexOf(value) === -1) keys.push(value);
    });
    agentId = text(
      descriptor.agent_id || descriptor.agentId ||
      descriptor.platform_agent_id || descriptor.platformAgentId ||
      descriptor.scope_agent_id || descriptor.scopeAgentId
    );
    global = descriptor.global === true;
    keys.forEach(function (key) {
      var exact = [
        automation,
        key,
        global ? 'global' : 'agent',
        agentId
      ].join('\u0000');
      if (seen[exact]) return;
      seen[exact] = true;
      output.push({
        automationId: automation,
        key: key,
        global: global,
        agentId: agentId || null
      });
    });
  }

  function collectScheduleSources(catalogItems, deviceCards, explicit) {
    var output = [];
    var seen = {};
    function inspect(value) {
      var id = automationId(value);
      var componentSchedules = value && value.components &&
        value.components.schedules;
      var schedules = Array.isArray(value && value.schedules) ?
        value.schedules : [];
      if (!id) return;
      if (Array.isArray(componentSchedules)) {
        schedules = schedules.concat(componentSchedules);
      }
      schedules.forEach(function (descriptor) {
        appendScheduleDescriptor(output, seen, id, descriptor);
      });
    }
    (catalogItems || []).forEach(inspect);
    (deviceCards || []).forEach(function (card) {
      inspect(card && card.manifest);
    });
    (Array.isArray(explicit) ? explicit : []).forEach(function (descriptor) {
      var copy = clone(descriptor || {});
      if (!copy.kv_key && !copy.kvKey && copy.key) {
        copy.kv_key = copy.key;
      }
      appendScheduleDescriptor(
        output,
        seen,
        text(copy && (
          copy.automationId || copy.automation_id
        )),
        copy
      );
    });
    output.sort(function (left, right) {
      var a = [left.automationId, left.key, left.agentId || ''].join('\u0000');
      var b = [right.automationId, right.key, right.agentId || ''].join('\u0000');
      return a < b ? -1 : (a > b ? 1 : 0);
    });
    return output;
  }

  function readScheduleSource(api, descriptor, options) {
    var scope;
    var error;
    if (!descriptor.automationId || !descriptor.key) {
      error = sourceError(
        'SCHEDULE_KV',
        'SCHEDULE_SOURCE_INVALID',
        'Источник расписания не содержит automation_id или KV-ключ',
        'A schedule source has no automation_id or KV key'
      );
      return Promise.resolve({
        available: false,
        descriptor: clone(descriptor),
        value: null,
        errors: [error]
      });
    }
    if (!descriptor.global && !descriptor.agentId) {
      error = sourceError(
        'SCHEDULE_KV',
        'SCHEDULE_SCOPE_REQUIRED',
        'Для KV расписания нужен точный agent_id',
        'An exact agent_id is required for the schedule KV source',
        descriptor.automationId + ':' + descriptor.key
      );
      return Promise.resolve({
        available: false,
        descriptor: clone(descriptor),
        value: null,
        errors: [error]
      });
    }
    scope = {
      global: descriptor.global === true
    };
    if (descriptor.agentId) scope.agentId = descriptor.agentId;
    assertContext(options);
    return Promise.resolve().then(function () {
      return api.kvGet(descriptor.key, scope);
    }).then(function (response) {
      assertContext(options);
      return {
        available: true,
        descriptor: clone(descriptor),
        scope: clone(scope),
        value: parseLooseValue(response),
        errors: []
      };
    }).catch(function (readError) {
      rethrowContext(readError);
      return {
        available: false,
        descriptor: clone(descriptor),
        scope: clone(scope),
        value: null,
        errors: [sourceError(
          'SCHEDULE_KV',
          'SCHEDULE_KV_UNAVAILABLE',
          'KV расписания недоступен',
          'The schedule KV source is unavailable',
          errorDetail(readError)
        )]
      };
    });
  }

  function readSchedules(api, catalog, device, options) {
    var descriptors = collectScheduleSources(
      catalog.items,
      device.cards,
      options && options.scheduleSources
    );
    return Promise.all(descriptors.map(function (descriptor) {
      return readScheduleSource(api, descriptor, options);
    })).then(function (facts) {
      var errors = [];
      facts.forEach(function (fact) {
        errors = errors.concat(fact.errors || []);
      });
      return {
        available: facts.every(function (fact) {
          return fact.available === true;
        }),
        facts: facts,
        errors: errors
      };
    });
  }

  function defaultStorage(options) {
    if (options && options.storage) return options.storage;
    if (typeof localStorage !== 'undefined') return localStorage;
    return null;
  }

  function sourceComplete(source) {
    return Boolean(
      source &&
      source.available === true &&
      (!Array.isArray(source.errors) || source.errors.length === 0)
    );
  }

  function load(options) {
    var api;
    options = options || {};
    api = options.api || ETB.api;
    if (!api || typeof api.kvGet !== 'function' ||
        typeof api.agentsList !== 'function' ||
        typeof api.expertsListScoped !== 'function') {
      return Promise.reject(new Error(
        'Evolution automation registry provider requires read-only API methods'
      ));
    }
    assertContext(options);
    return Promise.all([
      readKvItems(api, SHARED_REGISTRY_KEYS.automations, options),
      readKvItems(api, SHARED_REGISTRY_KEYS.installed, options),
      Promise.resolve(readBrowserInstalled(defaultStorage(options), options)),
      readPlatformAgents(api, options),
      readPlatformExperts(api, options),
      readDeviceCards(options)
    ]).then(function (sources) {
      var catalog = sources[0];
      var composerInstalled = sources[1];
      var browserInstalled = sources[2];
      var platformAgents = sources[3];
      var platformExperts = sources[4];
      var deviceCards = sources[5];
      assertContext(options);
      return Promise.all([
        readSchedules(api, catalog, deviceCards, options),
        readAutomationKvFacts(
          api,
          installedAutomationIds(deviceCards.cards),
          'state',
          options
        ),
        readAutomationKvFacts(
          api,
          installedAutomationIds(deviceCards.cards),
          'runs',
          options
        ),
        readSchedulerIndex(api, platformAgents, options)
      ]).then(
        function (additional) {
          var schedules = additional[0];
          var automationStates = additional[1];
          var automationRuns = additional[2];
          var schedulerIndex = additional[3];
          var errors = [];
          [
            catalog,
            composerInstalled,
            browserInstalled,
            platformAgents,
            platformExperts,
            deviceCards,
            schedules,
            automationStates,
            automationRuns,
            schedulerIndex
          ].forEach(function (source) {
            errors = errors.concat(source.errors || []);
          });
          assertContext(options);
          return {
            schemaVersion: SOURCE_SCHEMA,
            collectedAt: text(options.now) || new Date().toISOString(),
            sources: {
              catalog: catalog,
              composerInstalled: composerInstalled,
              browserInstalled: browserInstalled,
              platformAgents: platformAgents,
              platformExperts: platformExperts,
              schedules: schedules,
              automationStates: automationStates,
              automationRuns: automationRuns,
              schedulerIndex: schedulerIndex,
              deviceCards: deviceCards
            },
            catalogItems: clone(catalog.items),
            composerInstalledItems: clone(composerInstalled.items),
            browserInstalledIds: clone(browserInstalled.ids),
            platformAgentRows: clone(platformAgents.rows),
            platformExpertRows: clone(platformExperts.rows),
            scheduleFacts: clone(schedules.facts),
            runtimeStateRows: deviceCards.cards.map(function (card) {
              return {
                automationId: text(card && card.manifest &&
                  card.manifest.id),
                runtime: clone(card && card.runtime)
              };
            }),
            automationStateFacts: clone(automationStates.facts),
            automationRunFacts: clone(automationRuns.facts),
            schedulerIndexSids: clone(schedulerIndex.sids),
            deviceCardRows: clone(deviceCards.cards),
            deviceInventory: deviceCardInventory(deviceCards),
            complete: [
              catalog,
              composerInstalled,
              browserInstalled,
              platformAgents,
              platformExperts,
              schedules,
              automationStates,
              automationRuns,
              schedulerIndex,
              deviceCards
            ].every(function (source) {
              return sourceComplete(source);
            }),
            errors: errors
          };
        }
      );
    });
  }

  return {
    SOURCE_SCHEMA: SOURCE_SCHEMA,
    BROWSER_INSTALLED_KEY: BROWSER_INSTALLED_KEY,
    load: load,
    normalizeDeviceScan: normalizeDeviceScan,
    deviceCardInventory: deviceCardInventory,
    collectScheduleSources: collectScheduleSources,
    schedulerIndexSids: schedulerIndexSids,
    schedulerScopeAgentId: schedulerScopeAgentId
  };
}());
