// ── EXTELLA EVOLUTION · BUSINESS-AUTOMATION REGISTRY PROJECTION ──────────
// Pure, read-only reconciliation of catalogue records and CURRENT_DEVICE
// manifest evidence. This module performs no I/O and never mutates its input.

ETB.evolutionAutomationRegistry = (function () {
  'use strict';

  var SCHEMA = 'extella.evolution.automation_registry.v1';
  var UNKNOWN = 'UNKNOWN';
  var ID_RE = /^[a-z0-9][a-z0-9._-]{1,79}$/;
  var SEMVER_RE =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
  var RELEASE_STATUSES = {
    active: true,
    beta: true,
    deprecated: true
  };

  // Reviewed, bounded migration facts for the three canonical business
  // automations. They repair legacy source shape only; they never prove that
  // an automation is installed on the current device.
  var KNOWN_MIGRATIONS = {
    extella_1c_agent: {
      name: { ru: 'Агент 1С', en: '1C Agent' },
      declaredVersion: '0.3.0-dev.16',
      status: 'beta',
      category: 'automations',
      type: 'process',
      schemaVersion: 'extella-process-pack-v1',
      missingPlatformAgentAtVersion: '0.3.0-dev.6',
      reviewedAt: '2026-07-26',
      source: {
        repository: 'github.com/AnvarBakiyev/extella-1c-agent',
        branch: 'codex/1c-capability-contract-hardening',
        sha: 'b9cf98e'
      },
      components: {
        services: [{
          kind: 'local',
          port: 8792,
          health: '/api/health',
          state: 'UNKNOWN'
        }],
        schedules: [{
          id: 'job-pack-scheduler',
          kind: 'in-service',
          interval_s: 30,
          state: 'UNKNOWN'
        }],
        integrations: [
          { kind: '1c-com', external_writes: false, state: 'UNKNOWN' },
          { kind: '1c-odata', external_writes: false, state: 'UNKNOWN' }
        ],
        knowledge: [
          { kind: 'concepts', count: 4, state: 'DECLARED' },
          { kind: 'job-packs', count: 23, state: 'DECLARED' }
        ],
        rules: [{ kind: 'rules', count: 2, state: 'DECLARED' }]
      }
    },
    extella_contract_agent: {
      name: { ru: 'Kazakh Lawyer', en: 'Kazakh Lawyer' },
      declaredVersion: '1.0.0',
      status: 'active',
      category: 'automations',
      type: 'process',
      source: {
        repository: 'github.com/AnvarBakiyev/kazakh-lawyer',
        branch: 'main',
        sha: '0d858fc'
      },
      components: {
        services: [{
          kind: 'local',
          port: 8767,
          health: '/x/status',
          state: 'UNKNOWN'
        }],
        schedules: [],
        integrations: [
          { kind: 'smtp', state: 'UNKNOWN' },
          { kind: 'whatsapp-greenapi', state: 'UNKNOWN' },
          { kind: 'telegram', state: 'UNKNOWN' }
        ],
        knowledge: [
          { kind: 'concepts', count: 1, state: 'DECLARED' },
          { kind: 'external-legal-base', required: false, state: 'DECLARED' }
        ],
        rules: []
      }
    },
    extella_travel_agency: {
      name: {
        ru: 'Агент турагентства',
        en: 'Travel Agency Agent'
      },
      declaredVersion: '0.1.0',
      status: 'active',
      category: 'automations',
      type: 'process',
      source: {
        repository: 'github.com/AnvarBakiyev/extella-travel-agency-pack',
        branch: 'main',
        sha: '1d66267'
      },
      components: {
        services: [{
          kind: 'local',
          port: 8766,
          health: '/x/status',
          state: 'UNKNOWN'
        }],
        schedules: [
          {
            id: 'sched:wz_20260709_travel',
            kind: 'external-cron',
            interval_s: 900,
            state: 'UNKNOWN'
          },
          {
            id: 'ta:inbound:enabled',
            kind: 'external-cron',
            interval_s: 60,
            state: 'UNKNOWN'
          }
        ],
        integrations: [
          { kind: 'tourvisor', state: 'UNKNOWN' },
          { kind: 'whatsapp', state: 'UNKNOWN' },
          { kind: 'telegram', state: 'UNKNOWN' },
          { kind: 'local-ocr', state: 'UNKNOWN' }
        ],
        knowledge: [{ kind: 'concept-texts', count: 1, state: 'DECLARED' }],
        rules: []
      }
    }
  };

  var RISK_TEXT = {
    CATALOG_RECORD_INVALID: {
      severity: 'error',
      ru: 'Запись каталога неполна или имеет недопустимые поля.',
      en: 'The catalogue record is incomplete or contains invalid fields.'
    },
    CATALOG_RECORD_CONFLICT: {
      severity: 'error',
      ru: 'Канонические и устаревшие поля записи каталога расходятся.',
      en: 'Canonical and legacy catalogue fields disagree.'
    },
    DEVICE_RECORD_INVALID: {
      severity: 'error',
      ru: 'Карточка устройства не прошла строгую проверку.',
      en: 'The device card failed strict validation.'
    },
    DUPLICATE_CATALOG_ID: {
      severity: 'error',
      ru: 'В каталоге найдено несколько записей с одним идентификатором.',
      en: 'The catalogue contains multiple records with the same identifier.'
    },
    DUPLICATE_DEVICE_ID: {
      severity: 'error',
      ru: 'На устройстве найдено несколько карточек с одним идентификатором.',
      en: 'The device contains multiple cards with the same identifier.'
    },
    VERSION_UNKNOWN: {
      severity: 'error',
      ru: 'Версия не подтверждена допустимым SemVer 2.0.',
      en: 'The version is not proven by a valid SemVer 2.0 value.'
    },
    STATUS_UNKNOWN: {
      severity: 'error',
      ru: 'Статус выпуска не указан явно.',
      en: 'The release status is not stated explicitly.'
    },
    REVIEWED_MIGRATION_APPLIED: {
      severity: 'warning',
      ru: 'Часть полей восстановлена из проверенного правила миграции.',
      en: 'Some fields were restored from a reviewed migration rule.'
    },
    DEVICE_CARD_MISSING: {
      severity: 'error',
      ru: 'Есть ссылка на установку, но строгой карточки устройства нет.',
      en: 'An installation reference exists, but no strict device card does.'
    },
    INSTALLED_VERSION_STALE: {
      severity: 'warning',
      ru: 'Установленная версия ниже объявленной версии.',
      en: 'The installed version is older than the declared version.'
    },
    CATALOG_BEHIND_INSTALLED: {
      severity: 'warning',
      ru: 'Версия каталога ниже установленной версии.',
      en: 'The catalogue version is older than the installed version.'
    },
    CATALOG_ORPHAN: {
      severity: 'warning',
      ru: 'Карточка установлена на устройстве, но отсутствует в каталоге.',
      en: 'The card is installed on the device but absent from the catalogue.'
    },
    LOCAL_REFERENCE_MISMATCH: {
      severity: 'warning',
      ru: 'Локальный список установленного расходится с карточкой устройства.',
      en: 'The local installed list disagrees with the device card.'
    },
    COMPOSER_REFERENCE_MISMATCH: {
      severity: 'warning',
      ru: 'Запись установки Композитора расходится с карточкой устройства.',
      en: 'The Composer installation record disagrees with the device card.'
    },
    CATALOG_INSTALLATION_MISMATCH: {
      severity: 'warning',
      ru: 'Поле installed в каталоге расходится с карточкой текущего устройства.',
      en: 'The catalogue installed field disagrees with the current-device card.'
    },
    PLATFORM_AGENT_MISSING: {
      severity: 'error',
      ru: 'Явно привязанный платформенный агент не найден в снимке источника.',
      en: 'An explicitly bound platform agent is absent from the source snapshot.'
    },
    PLATFORM_AGENT_AMBIGUOUS: {
      severity: 'error',
      ru: 'Платформенный агент встречается в источнике более одного раза.',
      en: 'The platform agent occurs more than once in the source.'
    },
    EXPERT_MISSING: {
      severity: 'error',
      ru: 'Объявленный Expert не найден в снимке источника.',
      en: 'A declared Expert is absent from the source snapshot.'
    },
    EXPERT_AMBIGUOUS: {
      severity: 'error',
      ru: 'Expert встречается в источнике более одного раза.',
      en: 'The Expert occurs more than once in the source.'
    },
    ORPHAN_COMPONENT: {
      severity: 'warning',
      ru: 'Компонент ссылается на автоматизацию, но не объявлен её карточкой.',
      en: 'A component refers to the automation but is not declared by its card.'
    },
    SOURCE_UNAVAILABLE: {
      severity: 'error',
      ru: 'Один из источников снимка недоступен.',
      en: 'One of the snapshot sources is unavailable.'
    }
  };

  function own(value, key) {
    return Object.prototype.hasOwnProperty.call(value || {}, key);
  }

  function object(value) {
    return value && typeof value === 'object' && !Array.isArray(value);
  }

  function stringValue(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function canonicalId(value) {
    var id = stringValue(value);
    return ID_RE.test(id) ? id : '';
  }

  function cloneMigration(id) {
    var source = KNOWN_MIGRATIONS[id];
    var result = {};
    var key;
    if (!source) return null;
    for (key in source) {
      if (own(source, key)) result[key] = source[key];
    }
    return result;
  }

  function cloneJson(value, fallback) {
    if (value == null) return fallback;
    try { return JSON.parse(JSON.stringify(value)); }
    catch (_) { return fallback; }
  }

  function reviewedComponents(migration) {
    var source = migration && migration.components;
    return {
      services: cloneJson(source && source.services, []),
      schedules: cloneJson(source && source.schedules, []),
      integrations: cloneJson(source && source.integrations, []),
      knowledge: cloneJson(source && source.knowledge, []),
      rules: cloneJson(source && source.rules, [])
    };
  }

  function parseSemver(value) {
    var exact = stringValue(value);
    var match;
    var pre;
    var index;
    if (!exact || exact !== value || !(match = SEMVER_RE.exec(exact))) {
      return null;
    }
    pre = match[4] ? match[4].split('.') : [];
    for (index = 0; index < pre.length; index += 1) {
      if (/^\d+$/.test(pre[index]) &&
          pre[index].length > 1 && pre[index].charAt(0) === '0') {
        return null;
      }
    }
    return {
      raw: exact,
      major: Number(match[1]),
      minor: Number(match[2]),
      patch: Number(match[3]),
      prerelease: pre,
      build: match[5] || ''
    };
  }

  function compareParsed(left, right) {
    var fields = ['major', 'minor', 'patch'];
    var index;
    var l;
    var r;
    var lNumeric;
    var rNumeric;
    for (index = 0; index < fields.length; index += 1) {
      if (left[fields[index]] !== right[fields[index]]) {
        return left[fields[index]] < right[fields[index]] ? -1 : 1;
      }
    }
    if (!left.prerelease.length && !right.prerelease.length) return 0;
    if (!left.prerelease.length) return 1;
    if (!right.prerelease.length) return -1;
    for (index = 0;
         index < left.prerelease.length && index < right.prerelease.length;
         index += 1) {
      l = left.prerelease[index];
      r = right.prerelease[index];
      if (l === r) continue;
      lNumeric = /^\d+$/.test(l);
      rNumeric = /^\d+$/.test(r);
      if (lNumeric && rNumeric) return Number(l) < Number(r) ? -1 : 1;
      if (lNumeric !== rNumeric) return lNumeric ? -1 : 1;
      return l < r ? -1 : 1;
    }
    if (left.prerelease.length === right.prerelease.length) return 0;
    return left.prerelease.length < right.prerelease.length ? -1 : 1;
  }

  function compareSemver(left, right) {
    var parsedLeft = parseSemver(left);
    var parsedRight = parseSemver(right);
    if (!parsedLeft || !parsedRight) return null;
    return compareParsed(parsedLeft, parsedRight);
  }

  function releaseStatus(value) {
    var status = stringValue(value).toLowerCase();
    return RELEASE_STATUSES[status] ? status : UNKNOWN;
  }

  function businessAutomation(manifest) {
    return Boolean(
      manifest &&
      ((manifest.category === 'automations' && manifest.type === 'process') ||
       manifest.schemaVersion === 'extella-process-pack-v1')
    );
  }

  function migrationView(manifest, id) {
    var migration = cloneMigration(id);
    var view = {
      category: manifest && manifest.category,
      type: manifest && manifest.type,
      schemaVersion: manifest && manifest.schemaVersion,
      status: releaseStatus(manifest && manifest.status),
      migrations: []
    };
    if (!migration) return view;
    if (!businessAutomation(view)) {
      view.category = migration.category;
      view.type = migration.type;
      view.schemaVersion = migration.schemaVersion;
      view.migrations.push('classification');
    }
    if (view.status === UNKNOWN) {
      view.status = migration.status;
      view.migrations.push('status');
    }
    return view;
  }

  function strictFileName(fileName, id) {
    var name = stringValue(fileName);
    return Boolean(
      id &&
      name === id + '.json' &&
      name.indexOf('/') === -1 &&
      name.indexOf('\\') === -1 &&
      name.indexOf('.bak_') === -1
    );
  }

  function rowRisk(row, code) {
    var template = RISK_TEXT[code];
    var index;
    if (!template) return;
    for (index = 0; index < row.risks.length; index += 1) {
      if (row.risks[index].code === code) return;
    }
    row.risks.push({
      code: code,
      severity: template.severity,
      ru: template.ru,
      en: template.en
    });
  }

  function discrepancy(row, code) {
    if (row.discrepancies.indexOf(code) === -1) {
      row.discrepancies.push(code);
    }
    rowRisk(row, code);
  }

  function countById(records, idGetter) {
    var counts = {};
    (records || []).forEach(function (record) {
      var id = canonicalId(idGetter(record));
      if (id) counts[id] = (counts[id] || 0) + 1;
    });
    return counts;
  }

  function catalogueId(record) {
    return record &&
      (record.automation_id || record.automationId || record.id);
  }

  function catalogueVersion(record) {
    return stringValue(record && (
      record.version_declared || record.versionDeclared || record.version
    ));
  }

  function catalogueStatus(record) {
    return record && record.state && record.state.status != null ?
      record.state.status : (record && record.status);
  }

  function conflictingStrings(left, right) {
    left = stringValue(left);
    right = stringValue(right);
    return Boolean(left && right && left !== right);
  }

  function catalogueShapeConflict(record) {
    return Boolean(record && (
      conflictingStrings(
        record.automation_id || record.automationId,
        record.id
      ) ||
      conflictingStrings(
        record.version_declared || record.versionDeclared,
        record.version
      ) ||
      conflictingStrings(
        record.state && record.state.status,
        record.status
      )
    ));
  }

  function deviceManifest(record) {
    return object(record && record.manifest) ? record.manifest : record;
  }

  function deviceId(record) {
    var manifest = deviceManifest(record);
    return manifest && manifest.id;
  }

  function deviceFileName(record) {
    return record && (record.fileName || record.filename || record.file_name);
  }

  function componentAutomationId(record) {
    return canonicalId(record &&
      (record.automation_id || record.automationId));
  }

  function platformId(record) {
    return canonicalId(record &&
      (record.platform_agent_id || record.platformAgentId || record.id));
  }

  function expertId(record) {
    if (typeof record === 'string') return canonicalId(record);
    return canonicalId(record && (record.name || record.id || record.expert_id));
  }

  function addUnique(list, value) {
    if (value && list.indexOf(value) === -1) list.push(value);
  }

  function extractPlatformIds(manifest) {
    var ids = [];
    if (!manifest) return ids;
    addUnique(ids, canonicalId(manifest.platform_agent_id));
    addUnique(ids, canonicalId(manifest.platformAgentId));
    addUnique(ids, canonicalId(manifest.agent &&
      (manifest.agent.platform_agent_id || manifest.agent.platformAgentId)));
    addUnique(ids, canonicalId(manifest.synthAgent && manifest.synthAgent.id));
    addUnique(ids, canonicalId(manifest.params && manifest.params.agent_id));
    addUnique(ids, canonicalId(manifest.runtime &&
      (manifest.runtime.platform_agent_id ||
       manifest.runtime.platformAgentId)));
    return ids.sort();
  }

  function extractExpertDeclarations(manifest) {
    var ids = [];
    var optional = [];
    var definitions;
    if (!manifest) return ids;
    (Array.isArray(manifest.experts) ? manifest.experts : []).forEach(
      function (entry) { addUnique(ids, expertId(entry)); }
    );
    definitions = manifest.expert_defs || manifest.expertDefs;
    (Array.isArray(definitions) ? definitions : []).forEach(
      function (entry) { addUnique(ids, expertId(entry)); }
    );
    (Array.isArray(manifest.optionalExperts) ?
      manifest.optionalExperts : []).forEach(function (entry) {
        var id = expertId(entry);
        if (id && ids.indexOf(id) === -1 &&
            optional.indexOf(id) === -1) optional.push(id);
      });
    if (!ids.length) addUnique(ids, canonicalId(manifest.orchestrator));
    return ids.sort().concat(optional.sort().map(function (id) {
      return { id: id, required: false };
    }));
  }

  function componentRows(declaredItems, sourceRecords, sourceAvailable,
                         idGetter, automationId, kind, row) {
    var counts = countById(sourceRecords, idGetter);
    var result = [];
    var declared = {};
    declaredItems.forEach(function (item) {
      var id = typeof item === 'string' ? item : canonicalId(item && item.id);
      var required = !(object(item) && item.required === false);
      var state = UNKNOWN;
      if (!id) return;
      declared[id] = true;
      if (sourceAvailable) {
        state = counts[id] === 1 ? 'PRESENT' :
          (counts[id] > 1 ? 'AMBIGUOUS' : 'MISSING');
      }
      var component = {
        id: id,
        state: state,
        declared: true,
        orphan: false
      };
      if (!required) component.required = false;
      result.push(component);
      if (state === 'MISSING' && required) {
        discrepancy(row, kind === 'platform' ?
          'PLATFORM_AGENT_MISSING' : 'EXPERT_MISSING');
      } else if (state === 'AMBIGUOUS') {
        discrepancy(row, kind === 'platform' ?
          'PLATFORM_AGENT_AMBIGUOUS' : 'EXPERT_AMBIGUOUS');
      }
    });
    if (!sourceAvailable) return result.sort(function (left, right) {
      return left.id < right.id ? -1 : (left.id > right.id ? 1 : 0);
    });
    (sourceRecords || []).forEach(function (record) {
      var id = idGetter(record);
      if (componentAutomationId(record) !== automationId ||
          !id || declared[id]) return;
      declared[id] = true;
      result.push({
        id: id,
        state: counts[id] === 1 ? 'PRESENT' : 'AMBIGUOUS',
        declared: false,
        orphan: true
      });
      discrepancy(row, 'ORPHAN_COMPONENT');
    });
    return result.sort(function (left, right) {
      return left.id < right.id ? -1 : (left.id > right.id ? 1 : 0);
    });
  }

  function scheduleFor(records, automationId) {
    var matches = (records || []).filter(function (record) {
      return componentAutomationId(record) === automationId ||
        canonicalId(record && record.id) === automationId;
    });
    var record;
    var raw;
    if (matches.length !== 1) return { state: UNKNOWN };
    record = matches[0];
    if (record.active === true) return { state: 'ACTIVE' };
    if (record.active === false) return { state: 'PAUSED' };
    raw = stringValue(record.status).toLowerCase();
    if (raw === 'active' || raw === 'running' || raw === 'enabled') {
      return { state: 'ACTIVE' };
    }
    if (raw === 'paused' || raw === 'stopped' || raw === 'disabled') {
      return { state: 'PAUSED' };
    }
    return { state: UNKNOWN };
  }

  function composerId(record) {
    return record && (record.id || record.automation_id || record.automationId);
  }

  function composerIsReference(record) {
    var status = stringValue(record && record.status).toLowerCase();
    return status === 'installed' || status === 'linked';
  }

  function knownAutomationId(value) {
    var id = canonicalId(value);
    return Boolean(id && KNOWN_MIGRATIONS[id]);
  }

  function composerIsAutomation(record) {
    var kind = stringValue(record && record.kind).toLowerCase();
    return kind === 'automation' ||
      businessAutomation(migrationView(
        record,
        canonicalId(composerId(record))
      ));
  }

  function safeSourceErrors(sourceErrors) {
    var allowedSources = {
      catalog: true,
      device: true,
      platform_agents: true,
      experts: true,
      schedules: true,
      local_installed: true,
      composer_installed: true
    };
    var list = Array.isArray(sourceErrors) ? sourceErrors :
      (object(sourceErrors) ? Object.keys(sourceErrors).map(function (key) {
        return { source: key, code: sourceErrors[key] };
      }) : []);
    return list.map(function (entry) {
      var source = stringValue(entry && entry.source);
      return {
        source: allowedSources[source] ? source : UNKNOWN,
        code: stringValue(entry && entry.code) || 'SOURCE_UNAVAILABLE'
      };
    });
  }

  function localizedName(value, language) {
    if (typeof value === 'string') return stringValue(value);
    if (!object(value)) return '';
    return stringValue(value[language]) ||
      stringValue(value.ru) ||
      stringValue(value.en);
  }

  function exactLocalizedName(value, language) {
    if (!object(value)) return '';
    return stringValue(value[language]);
  }

  function chooseName(id, device, catalogue, migration) {
    var deviceName = device && (device.name || device.title);
    var catalogueName = catalogue &&
      (catalogue.name || catalogue.title);
    var migrationName = migration && migration.name;
    return {
      ru: exactLocalizedName(deviceName, 'ru') ||
        exactLocalizedName(catalogueName, 'ru') ||
        exactLocalizedName(migrationName, 'ru') ||
        localizedName(deviceName, 'ru') ||
        localizedName(catalogueName, 'ru') ||
        localizedName(migrationName, 'ru') ||
        id,
      en: exactLocalizedName(deviceName, 'en') ||
        exactLocalizedName(catalogueName, 'en') ||
        exactLocalizedName(migrationName, 'en') ||
        localizedName(deviceName, 'en') ||
        localizedName(catalogueName, 'en') ||
        localizedName(migrationName, 'en') ||
        id
    };
  }

  function hasMissingDeclaredComponent(components) {
    return (components || []).some(function (component) {
      return component.declared === true &&
        component.required !== false &&
        component.state === 'MISSING';
    });
  }

  function sourceAvailable(spec, sourceName, inputKey, sourceErrors) {
    var explicit = spec.sourceAvailability;
    if (object(explicit) &&
        typeof explicit[sourceName] === 'boolean') {
      return explicit[sourceName];
    }
    return own(spec, inputKey) && !sourceErrors.some(function (error) {
      return error.source === sourceName;
    });
  }

  function project(input) {
    var spec = object(input) ? input : {};
    var catalogRecords = Array.isArray(spec.catalogRecords) ?
      spec.catalogRecords : [];
    var deviceRecords = Array.isArray(spec.deviceRecords) ?
      spec.deviceRecords : [];
    var platformAgents = Array.isArray(spec.platformAgents) ?
      spec.platformAgents : [];
    var experts = Array.isArray(spec.experts) ? spec.experts : [];
    var scheduleStates = Array.isArray(spec.scheduleStates) ?
      spec.scheduleStates : [];
    var localInstalledIds = Array.isArray(spec.localInstalledIds) ?
      spec.localInstalledIds : [];
    var composerInstalledRecords =
      Array.isArray(spec.composerInstalledRecords) ?
        spec.composerInstalledRecords : [];
    var sourceErrors = safeSourceErrors(spec.sourceErrors);
    var checkedAt = stringValue(spec.checkedAt) || UNKNOWN;
    var catalogCounts = countById(catalogRecords, catalogueId);
    var deviceCounts = countById(deviceRecords, deviceId);
    var localCounts = countById(localInstalledIds, function (id) { return id; });
    var composerCounts = countById(composerInstalledRecords, composerId);
    var ids = {};
    var rows = [];
    var inputContractComplete = [
      'catalogRecords',
      'deviceRecords',
      'platformAgents',
      'experts',
      'scheduleStates',
      'localInstalledIds',
      'composerInstalledRecords',
      'sourceErrors'
    ].every(function (key) {
      return Array.isArray(spec[key]);
    }) && Boolean(stringValue(spec.checkedAt));
    var complete = inputContractComplete &&
      spec.sourceSnapshotComplete !== false &&
      sourceErrors.length === 0;
    var catalogAvailable = sourceAvailable(
      spec, 'catalog', 'catalogRecords', sourceErrors
    );
    var deviceAvailable = sourceAvailable(
      spec, 'device', 'deviceRecords', sourceErrors
    );
    var platformAgentsAvailable = sourceAvailable(
      spec, 'platform_agents', 'platformAgents', sourceErrors
    );
    var expertsAvailable = sourceAvailable(
      spec, 'experts', 'experts', sourceErrors
    );
    var schedulesAvailable = sourceAvailable(
      spec, 'schedules', 'scheduleStates', sourceErrors
    );
    var localInstalledAvailable = sourceAvailable(
      spec, 'local_installed', 'localInstalledIds', sourceErrors
    );
    var composerInstalledAvailable = sourceAvailable(
      spec,
      'composer_installed',
      'composerInstalledRecords',
      sourceErrors
    );
    complete = complete &&
      catalogAvailable &&
      deviceAvailable &&
      platformAgentsAvailable &&
      expertsAvailable &&
      schedulesAvailable &&
      localInstalledAvailable &&
      composerInstalledAvailable;

    function collect(value) {
      var id = canonicalId(value);
      if (id) ids[id] = true;
      else if (stringValue(value)) complete = false;
    }

    catalogRecords.forEach(function (record) { collect(catalogueId(record)); });
    deviceRecords.forEach(function (record) {
      var id = canonicalId(deviceId(record));
      var manifest = deviceManifest(record);
      if (id && businessAutomation(migrationView(manifest, id))) collect(id);
    });
    localInstalledIds.forEach(function (id) {
      if (knownAutomationId(id)) collect(id);
    });
    composerInstalledRecords.forEach(function (record) {
      if (knownAutomationId(composerId(record)) ||
          composerIsAutomation(record)) {
        collect(composerId(record));
      }
    });
    if (spec.includeReviewedAutomations === true) {
      Object.keys(KNOWN_MIGRATIONS).forEach(collect);
    }

    Object.keys(ids).sort().forEach(function (id) {
      var catalogMatches = catalogRecords.filter(function (record) {
        return canonicalId(catalogueId(record)) === id;
      });
      var deviceMatches = deviceRecords.filter(function (record) {
        return canonicalId(deviceId(record)) === id;
      });
      var composerMatches = composerInstalledRecords.filter(function (record) {
        return canonicalId(composerId(record)) === id;
      });
      var migration = cloneMigration(id);
      var catalogue = catalogMatches.length === 1 ? catalogMatches[0] : null;
      var cataloguePresent = catalogMatches.length > 0;
      var catalogueConflict = catalogueShapeConflict(catalogue);
      var envelope = deviceMatches.length === 1 ? deviceMatches[0] : null;
      var device = envelope ? deviceManifest(envelope) : null;
      var catalogueVersionValue = catalogueVersion(catalogue);
      var catalogueVersionExact =
        parseSemver(catalogueVersionValue) ? catalogueVersionValue : UNKNOWN;
      var catalogueStatusExact = releaseStatus(catalogueStatus(catalogue));
      var deviceVersion = device && parseSemver(device.version) ?
        device.version : UNKNOWN;
      var deviceView = migrationView(device, id);
      var deviceStatus = deviceView.status;
      var migrationFields = deviceView.migrations.slice();
      var catalogueMigration = false;
      var catalogueValid;
      var deviceValid;
      var catalogFact;
      var installedFact;
      var localReference = Boolean(localCounts[id]);
      var composerReference = composerMatches.some(composerIsReference);
      var catalogueInstalledKnown = Boolean(
        catalogue && typeof catalogue.installed === 'boolean'
      );
      var catalogueInstalled = Boolean(
        catalogueInstalledKnown && catalogue.installed
      );
      var declaredVersion = migration && migration.declaredVersion ?
        migration.declaredVersion : catalogueVersionExact;
      var row;
      var reviewed = reviewedComponents(migration);
      var targetVersion;
      var comparison;

      if (catalogue && catalogueStatusExact === UNKNOWN && migration) {
        catalogueStatusExact = migration.status;
        catalogueMigration = true;
      }
      if (catalogue && catalogueVersionExact === UNKNOWN && migration &&
          parseSemver(migration.declaredVersion)) {
        catalogueVersionExact = migration.declaredVersion;
        catalogueMigration = true;
      }
      catalogueValid = Boolean(
        catalogue &&
        catalogMatches.length === 1 &&
        !catalogueConflict &&
        catalogueVersionExact !== UNKNOWN &&
        catalogueStatusExact !== UNKNOWN
      );
      deviceValid = Boolean(
        device &&
        deviceMatches.length === 1 &&
        strictFileName(deviceFileName(envelope), id) &&
        envelope.isSymlink !== true &&
        envelope.isRegularFile !== false &&
        businessAutomation(deviceView) &&
        deviceVersion !== UNKNOWN &&
        deviceStatus !== UNKNOWN
      );
      catalogFact = catalogAvailable ? cataloguePresent : UNKNOWN;
      installedFact = deviceAvailable ? deviceValid : UNKNOWN;
      row = {
        automation_id: id,
        name: chooseName(id, device, catalogue, migration),
        availability: 'catalog',
        flags: {
          catalog: catalogFact,
          catalog_valid: catalogAvailable ?
            (cataloguePresent ? catalogueValid : false) : UNKNOWN,
          installed: installedFact,
          installed_stale: deviceAvailable ? false : UNKNOWN,
          dead_reference:
            deviceAvailable && platformAgentsAvailable && expertsAvailable ?
              false : UNKNOWN
        },
        versions: {
          declared: parseSemver(declaredVersion) ? declaredVersion : UNKNOWN,
          catalog: catalogueVersionExact,
          installed: deviceVersion
        },
        version_declared:
          parseSemver(declaredVersion) ? declaredVersion : UNKNOWN,
        version_installed: deviceVersion,
        statuses: {
          catalog: catalogueStatusExact,
          installed: deviceStatus,
          effective: installedFact === true ? deviceStatus :
            (catalogAvailable && catalogueValid ? catalogueStatusExact :
              (migration ? migration.status : UNKNOWN))
        },
        enabled: UNKNOWN,
        orphan: installedFact === true ?
          (catalogAvailable ? !cataloguePresent : null) :
          (installedFact === UNKNOWN ? null : false),
        discrepancies: [],
        components: {
          platform_agents: [],
          experts: [],
          schedule: schedulesAvailable ?
            scheduleFor(scheduleStates, id) : { state: UNKNOWN },
          services: reviewed.services,
          schedules: reviewed.schedules,
          integrations: reviewed.integrations,
          knowledge: reviewed.knowledge,
          rules: reviewed.rules
        },
        evidence: {
          catalog: catalogFact,
          catalog_record_valid: catalogAvailable ?
            (cataloguePresent ? catalogueValid : false) : UNKNOWN,
          device: installedFact,
          catalog_installed: catalogAvailable && catalogueInstalledKnown ?
            catalogueInstalled : UNKNOWN,
          local_installed: localInstalledAvailable ?
            localReference : UNKNOWN,
          composer_installed: composerInstalledAvailable ?
            composerReference : UNKNOWN,
          reviewed_source: cloneJson(
            migration && migration.source,
            null
          ),
          migrations: [],
          checked_at: checkedAt
        },
        state: {
          source: UNKNOWN,
          status: installedFact === true ? deviceStatus :
            (catalogAvailable && catalogueValid ? catalogueStatusExact :
              (migration ? migration.status : UNKNOWN)),
          last_run: null,
          last_result: null,
          last_error: null,
          checked_at: checkedAt
        },
        actions: {
          enable: 'NOT_IMPLEMENTED',
          disable: 'NOT_IMPLEMENTED',
          update: 'NOT_IMPLEMENTED',
          rollback: 'NOT_IMPLEMENTED'
        },
        updated_at: checkedAt,
        risks: []
      };

      if (catalogAvailable && catalogMatches.length > 1) {
        complete = false;
        discrepancy(row, 'DUPLICATE_CATALOG_ID');
      } else if (catalogAvailable && catalogue && !catalogueValid) {
        complete = false;
        discrepancy(row, 'CATALOG_RECORD_INVALID');
        if (catalogueConflict) {
          discrepancy(row, 'CATALOG_RECORD_CONFLICT');
        }
        if (catalogueVersionExact === UNKNOWN) {
          discrepancy(row, 'VERSION_UNKNOWN');
        }
        if (catalogueStatusExact === UNKNOWN) {
          discrepancy(row, 'STATUS_UNKNOWN');
        }
      }
      if (deviceAvailable && deviceMatches.length > 1) {
        complete = false;
        discrepancy(row, 'DUPLICATE_DEVICE_ID');
      } else if (deviceAvailable && device && !deviceValid) {
        complete = false;
        discrepancy(row, 'DEVICE_RECORD_INVALID');
        if (deviceVersion === UNKNOWN) discrepancy(row, 'VERSION_UNKNOWN');
        if (deviceStatus === UNKNOWN) discrepancy(row, 'STATUS_UNKNOWN');
      }
      if (migrationFields.length || catalogueMigration) {
        row.evidence.migrations = migrationFields.slice();
        if (catalogueMigration) row.evidence.migrations.push('catalog');
        discrepancy(row, 'REVIEWED_MIGRATION_APPLIED');
      }
      if (catalogAvailable &&
          deviceAvailable &&
          catalogueInstalledKnown &&
          catalogueInstalled !== deviceValid) {
        discrepancy(row, 'CATALOG_INSTALLATION_MISMATCH');
      }

      if (installedFact === true) {
        targetVersion = row.versions.declared !== UNKNOWN ?
          row.versions.declared : row.versions.catalog;
        comparison = targetVersion !== UNKNOWN ?
          compareSemver(deviceVersion, targetVersion) : null;
        if (comparison !== null && comparison < 0) {
          row.flags.installed_stale = true;
          discrepancy(row, 'INSTALLED_VERSION_STALE');
        }
        if (catalogueVersionExact !== UNKNOWN &&
            compareSemver(deviceVersion, catalogueVersionExact) > 0) {
          discrepancy(row, 'CATALOG_BEHIND_INSTALLED');
        }
        if (catalogAvailable && !cataloguePresent) {
          discrepancy(row, 'CATALOG_ORPHAN');
        }
        if (localInstalledAvailable && !localReference) {
          discrepancy(row, 'LOCAL_REFERENCE_MISMATCH');
        }
        if (composerInstalledAvailable &&
            composerMatches.length &&
            !composerReference) {
          discrepancy(row, 'COMPOSER_REFERENCE_MISMATCH');
        }
      } else if (deviceAvailable &&
                 ((catalogAvailable && catalogueInstalled) ||
                  (localInstalledAvailable && localReference) ||
                  (composerInstalledAvailable && composerReference) ||
                  deviceMatches.length > 0)) {
        row.flags.dead_reference = true;
        discrepancy(row, 'DEVICE_CARD_MISSING');
        if (localInstalledAvailable && localReference) {
          discrepancy(row, 'LOCAL_REFERENCE_MISMATCH');
        }
        if (composerInstalledAvailable && composerReference) {
          discrepancy(row, 'COMPOSER_REFERENCE_MISMATCH');
        }
      }

      if (!catalogAvailable || !deviceAvailable) {
        discrepancy(row, 'SOURCE_UNAVAILABLE');
      }
      row.components.platform_agents = componentRows(
        installedFact === true ? extractPlatformIds(device) : [],
        platformAgents,
        platformAgentsAvailable,
        platformId,
        id,
        'platform',
        row
      );
      if (migration &&
          migration.missingPlatformAgentAtVersion &&
          installedFact === true &&
          migration.missingPlatformAgentAtVersion === deviceVersion &&
          row.components.platform_agents.length === 0) {
        row.components.platform_agents.push({
          id: UNKNOWN,
          state: 'MISSING',
          declared: true,
          orphan: false,
          source: 'REVIEWED_AGENT_PASSPORT_FACT',
          reviewed_at: migration.reviewedAt || UNKNOWN
        });
        addUnique(row.evidence.migrations, 'platform_agent_reference');
        discrepancy(row, 'PLATFORM_AGENT_MISSING');
        discrepancy(row, 'REVIEWED_MIGRATION_APPLIED');
      }
      row.components.experts = componentRows(
        installedFact === true ?
          extractExpertDeclarations(device) : [],
        experts,
        expertsAvailable,
        expertId,
        id,
        'expert',
        row
      );
      if (hasMissingDeclaredComponent(row.components.platform_agents) ||
          hasMissingDeclaredComponent(row.components.experts)) {
        row.flags.dead_reference = true;
      }

      if (row.flags.installed_stale === true) {
        row.availability = 'installed_stale';
      } else if (row.flags.dead_reference === true) {
        row.availability = 'dead_reference';
      } else if (row.flags.installed === true) row.availability = 'installed';
      else if (row.flags.catalog === true) row.availability = 'catalog';
      else row.availability = UNKNOWN;
      rows.push(row);
    });

    sourceErrors.forEach(function (error) {
      if (!RISK_TEXT[error.code]) error.code = 'SOURCE_UNAVAILABLE';
    });

    return {
      schema: SCHEMA,
      scope: 'CURRENT_DEVICE',
      checked_at: checkedAt,
      complete: complete,
      rows: rows,
      counters: {
        total: rows.length,
        catalog: rows.filter(function (row) {
          return row.flags.catalog === true;
        }).length,
        installed: rows.filter(function (row) {
          return row.flags.installed === true;
        }).length,
        installed_stale: rows.filter(function (row) {
          return row.flags.installed_stale === true;
        }).length,
        dead_reference: rows.filter(function (row) {
          return row.flags.dead_reference === true;
        }).length,
        with_risks: rows.filter(function (row) {
          return row.risks.length > 0;
        }).length,
        orphans: rows.filter(function (row) {
          return row.orphan;
        }).length
      },
      source_errors: sourceErrors
    };
  }

  return {
    SCHEMA: SCHEMA,
    UNKNOWN: UNKNOWN,
    KNOWN_MIGRATIONS: KNOWN_MIGRATIONS,
    parseSemver: parseSemver,
    compareSemver: compareSemver,
    project: project
  };
})();
