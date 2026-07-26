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
    'extella.evolution.automation-registry-sources.v1';
  var BROWSER_INSTALLED_KEY = 'etb_plugins_installed_v1';
  var STRICT_CARD_FILE = /^([a-z0-9][a-z0-9._-]{1,79})\.json$/;

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

  function documentItems(value) {
    if (Array.isArray(value)) return clone(value);
    if (value && Array.isArray(value.items)) return clone(value.items);
    throw new Error('source document must contain an items array');
  }

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
        manifest: clone(manifest)
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
    if (text(options && options.deviceId)) {
      return Promise.resolve(text(options.deviceId));
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
      readKvItems(api, '_mkt_automations', options),
      readKvItems(api, '_mkt_installed', options),
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
      return readSchedules(api, catalog, deviceCards, options).then(
        function (schedules) {
          var errors = [];
          [
            catalog,
            composerInstalled,
            browserInstalled,
            platformAgents,
            platformExperts,
            deviceCards,
            schedules
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
              deviceCards: deviceCards
            },
            catalogItems: clone(catalog.items),
            composerInstalledItems: clone(composerInstalled.items),
            browserInstalledIds: clone(browserInstalled.ids),
            platformAgentRows: clone(platformAgents.rows),
            platformExpertRows: clone(platformExperts.rows),
            scheduleFacts: clone(schedules.facts),
            deviceCardRows: clone(deviceCards.cards),
            complete: [
              catalog,
              composerInstalled,
              browserInstalled,
              platformAgents,
              platformExperts,
              schedules,
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
    collectScheduleSources: collectScheduleSources
  };
}());
