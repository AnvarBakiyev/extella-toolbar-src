// ── EXTELLA EVOLUTION · BUSINESS-AUTOMATION REGISTRY PROJECTION ──────────
// Pure, read-only reconciliation of catalogue records and CURRENT_DEVICE
// manifest evidence. This module performs no I/O and never mutates its input.

ETB.evolutionAutomationRegistry = (function () {
  'use strict';

  var SCHEMA = 'extella.evolution.automation_registry.v1';
  var UNKNOWN = 'UNKNOWN';
  var ID_RE = /^[a-z0-9][a-z0-9._-]{1,79}$/;
  var ISO_TIMESTAMP_RE =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})?$/;
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
          state: 'NOT_APPLICABLE'
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
            id: 'campaigns_birthday',
            scheduler_sid: 'sched:wz_20260709_travel',
            kind: 'external-cron',
            required: true,
            interval_s: 900,
            state: 'UNKNOWN'
          },
          {
            id: 'inbound_poller',
            kind: 'internal-bridge',
            required: false,
            interval_s: 60,
            state: 'NOT_APPLICABLE'
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
    },
    STATE_CONTRACT_INVALID: {
      severity: 'error',
      ru: 'Операционное состояние не подтверждено полным согласованным снимком.',
      en: 'Operational state is not proven by a complete consistent snapshot.'
    },
    AUTOMATION_STATE_UNAVAILABLE: {
      severity: 'error',
      ru: 'Состояние автоматизации недоступно; зависимые действия заблокированы.',
      en: 'The automation state is unavailable; dependent actions are blocked.'
    },
    ACTIVE_VERSION_MISMATCH: {
      severity: 'error',
      ru: 'Активная версия расходится с версией карточки устройства.',
      en: 'The active version differs from the device-card version.'
    },
    SCHEDULE_REFERENCE_MISSING: {
      severity: 'error',
      ru: 'Обязательная ссылка расписания отсутствует в индексе планировщика.',
      en: 'A required schedule reference is absent from the scheduler index.'
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

  function isoTimestamp(value) {
    var exact = stringValue(value);
    var parsed;
    if (!exact || exact !== value || exact.length > 160 ||
        !ISO_TIMESTAMP_RE.test(exact)) {
      return false;
    }
    parsed = Date.parse(exact);
    return isFinite(parsed);
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

  function manifestScheduleDeclarations(manifest) {
    var componentSchedules = manifest && object(manifest.components) ?
      manifest.components.schedules : null;
    var source = [];
    var seen = {};
    if (Array.isArray(manifest && manifest.schedules)) {
      source = source.concat(manifest.schedules);
    }
    if (Array.isArray(componentSchedules)) {
      source = source.concat(componentSchedules);
    }
    return source.map(function (schedule) {
      var projected;
      var schedulerRef;
      var id;
      var kind;
      if (!object(schedule)) return null;
      schedulerRef = stringValue(
        schedule.scheduler_ref || schedule.schedulerRef
      );
      if (!schedulerRef) {
        schedulerRef = stringValue(schedule.kv_key || schedule.kvKey);
        if (schedulerRef.indexOf('sched:') !== 0) schedulerRef = '';
      }
      id = stringValue(schedule.id);
      if (!schedulerRef && id.indexOf('sched:') === 0) {
        schedulerRef = id;
      }
      if (!id) id = schedulerRef;
      if (!id) return null;
      kind = stringValue(schedule.kind || schedule.location)
        .toLowerCase().replace(/_/g, '-');
      if (!kind && schedulerRef) kind = 'external-cron';
      projected = {
        id: id,
        kind: kind || UNKNOWN,
        required: schedule.required !== false,
        state: UNKNOWN
      };
      if (schedulerRef) projected.scheduler_sid = schedulerRef;
      if (typeof schedule.interval_s === 'number' &&
          isFinite(schedule.interval_s)) {
        projected.interval_s = schedule.interval_s;
      }
      return projected;
    }).filter(function (schedule) {
      var key;
      if (!schedule) return false;
      key = [
        schedule.id,
        schedule.kind,
        schedule.scheduler_sid || '',
        schedule.required === false ? 'optional' : 'required',
        typeof schedule.interval_s === 'number' ?
          String(schedule.interval_s) : ''
      ].join('\u0000');
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });
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

  function stateRecordId(record) {
    return record &&
      (record.automation_id || record.automationId || record.id);
  }

  function matchingStateRecords(records, automationId) {
    return (records || []).filter(function (record) {
      return canonicalId(stateRecordId(record)) === automationId;
    });
  }

  function field(record, snake, camel) {
    if (own(record, snake)) return { present: true, value: record[snake] };
    if (camel && own(record, camel)) {
      return { present: true, value: record[camel] };
    }
    return { present: false, value: undefined };
  }

  function localizedFact(value) {
    if (value === null) return { valid: true, value: null };
    if (!object(value)) {
      return { valid: false, value: null };
    }
    if (stringValue(value.code) &&
        stringValue(value.message_ru) &&
        stringValue(value.message_en)) {
      return {
        valid: true,
        value: {
          code: stringValue(value.code),
          message_ru: stringValue(value.message_ru),
          message_en: stringValue(value.message_en)
        }
      };
    }
    if (!stringValue(value.ru) || !stringValue(value.en)) {
      return { valid: false, value: null };
    }
    return {
      valid: true,
      value: {
        ru: stringValue(value.ru),
        en: stringValue(value.en)
      }
    };
  }

  function lastRunFact(value) {
    var at;
    if (value === null) return { valid: true, value: null };
    if (typeof value === 'number' && isFinite(value)) {
      return { valid: true, value: value };
    }
    if (typeof value === 'string' && isoTimestamp(value)) {
      return { valid: true, value: value };
    }
    if (object(value)) {
      at = own(value, 'at') ? value.at : value.ts;
      if (typeof at === 'number' && isFinite(at)) {
        return { valid: true, value: at };
      }
      if (typeof at === 'string' && isoTimestamp(at)) {
        return { valid: true, value: at };
      }
    }
    return { valid: false, value: null };
  }

  function versionFact(record) {
    var exact = field(record, 'active_version', 'activeVersion');
    if (!exact.present) return { present: false, valid: true, value: null };
    if (exact.value === null) {
      return { present: true, valid: true, value: null };
    }
    if (!parseSemver(exact.value)) {
      return { present: true, valid: false, value: null };
    }
    return { present: true, valid: true, value: exact.value };
  }

  function runtimeStatus(record) {
    var value = stringValue(record &&
      (record.runtime_status || record.runtimeStatus || record.status))
      .toUpperCase();
    if (value === 'RUNNING') return 'RUNNING';
    if (value === 'STOPPED' || value === 'NOT_RUNNING') {
      return 'NOT_RUNNING';
    }
    return UNKNOWN;
  }

  function runtimeDesired(record) {
    var exact = field(record, 'desired', null);
    var value;
    if (!exact.present) return { valid: true, value: UNKNOWN };
    value = stringValue(exact.value).toUpperCase();
    if (value === 'ON' || value === 'OFF') {
      return { valid: true, value: value };
    }
    return { valid: false, value: UNKNOWN };
  }

  function automationEnabled(record) {
    var exact = field(record, 'enabled', null);
    var status;
    if (exact.present && typeof exact.value === 'boolean') {
      return { valid: true, value: exact.value };
    }
    if (exact.present) return { valid: false, value: null };
    status = stringValue(record && record.status).toLowerCase();
    if (status === 'active' || status === 'enabled') {
      return { valid: true, value: true };
    }
    if (status === 'paused' || status === 'frozen' ||
        status === 'disabled' || status === 'removed') {
      return { valid: true, value: false };
    }
    return { valid: false, value: null };
  }

  function legacyRunFacts(record) {
    var runs = record && record.runs;
    var latest;
    var lastRun;
    var result;
    var error = null;
    if (!Array.isArray(runs)) return null;
    if (!runs.length) {
      return {
        valid: true,
        last_run: null,
        last_result: null,
        last_error: null
      };
    }
    latest = runs[0];
    if (!object(latest)) return { valid: false };
    lastRun = lastRunFact(own(latest, 'ts') ? latest.ts : latest.ran_at);
    if (!lastRun.valid ||
        (latest.ok !== true && latest.ok !== false && latest.ok !== null)) {
      return { valid: false };
    }
    if (latest.ok === true) {
      result = 'ok';
    } else if (latest.ok === false) {
      result = 'failed';
      error = {
        code: 'RUN_FAILED',
        message_ru: 'Запуск завершился ошибкой',
        message_en: 'The run failed'
      };
    } else {
      result = 'running';
    }
    return {
      valid: true,
      last_run: lastRun.value,
      last_result: result,
      last_error: error
    };
  }

  function runFacts(record) {
    var lastRun = field(record, 'last_run', 'lastRun');
    var lastResult = field(record, 'last_result', 'lastResult');
    var lastError = field(record, 'last_error', 'lastError');
    var run;
    var result;
    var error;
    if (!lastRun.present && !lastResult.present && !lastError.present) {
      return legacyRunFacts(record) || { valid: false };
    }
    if (!lastRun.present || !lastResult.present || !lastError.present) {
      return { valid: false };
    }
    run = lastRunFact(lastRun.value);
    result = lastResult.value === null ?
      { valid: true, value: null } :
      (typeof lastResult.value === 'string' &&
       stringValue(lastResult.value) ?
        { valid: true, value: stringValue(lastResult.value) } :
        localizedFact(lastResult.value));
    error = localizedFact(lastError.value);
    if (!run.valid || !result.valid || !error.valid) {
      return { valid: false };
    }
    return {
      valid: true,
      last_run: run.value,
      last_result: result.value,
      last_error: error.value
    };
  }

  function runtimeContractFacts(value) {
    var activeVersion;
    var lastRunValid;
    var result;
    var error;
    var schedules;
    if (!object(value) || typeof value.enabled !== 'boolean') {
      return { valid: false };
    }
    activeVersion = versionFact(value);
    lastRunValid = value.last_run === null ||
      (typeof value.last_run === 'string' &&
       isoTimestamp(value.last_run)) ||
      (typeof value.last_run === 'number' && isFinite(value.last_run)) ||
      object(value.last_run);
    result = value.last_result === null ?
      { valid: true, value: null } :
      (value.last_result === 'ok' ||
       value.last_result === 'failed' ||
       value.last_result === 'partial' ?
        { valid: true, value: value.last_result } :
        { valid: false, value: null });
    error = localizedFact(value.last_error);
    schedules = value.schedules;
    if (!activeVersion.present || !activeVersion.valid ||
        !lastRunValid || !result.valid || !error.valid ||
        !Array.isArray(schedules) ||
        schedules.some(function (schedule) {
          return !object(schedule) ||
            !stringValue(schedule.id) ||
            typeof schedule.active !== 'boolean' ||
            (!own(schedule, 'next_run') ||
             (schedule.next_run !== null &&
              typeof schedule.next_run !== 'string' &&
              !(typeof schedule.next_run === 'number' &&
                isFinite(schedule.next_run))));
        })) {
      return { valid: false };
    }
    return {
      valid: true,
      enabled: value.enabled,
      active_version: activeVersion.value,
      last_run: null,
      last_result: result.value,
      last_error: error.value,
      schedules: cloneJson(schedules, []),
      checked_at: typeof value.checked_at === 'string' ?
        stringValue(value.checked_at) : null
    };
  }

  function supportingStateFact(record, kind) {
    var value;
    if (!object(record) ||
        record.available !== true ||
        typeof record.present !== 'boolean') {
      return { valid: false, present: false, value: null };
    }
    if (!record.present) return { valid: true, present: false, value: null };
    value = record.value;
    if (!object(value)) return { valid: false, present: true, value: null };
    if (kind === 'state') {
      if (typeof value.enabled !== 'boolean') {
        return { valid: false, present: true, value: null };
      }
      return { valid: true, present: true, value: value };
    }
    if (!own(value, 'latest') ||
        !(value.latest === null || object(value.latest)) ||
        typeof value.count !== 'number' ||
        !isFinite(value.count) ||
        value.count < 0) {
      return { valid: false, present: true, value: null };
    }
    return { valid: true, present: true, value: value };
  }

  function operationalState(automationId, runtimeStates, automationStates,
                            automationRuns, checkedAt) {
    var runtimeMatches;
    var automationMatches;
    var runMatches;
    var runtimeEnvelope;
    var runtimeContract;
    var stateSupport;
    var runSupport;
    var latest;
    var lastRun;
    var lastResult = null;
    var stateProbe;
    var serviceReachable = UNKNOWN;
    var unavailableRisk = 'AUTOMATION_STATE_UNAVAILABLE';
    function unavailable(runtimeRecord) {
      return {
        available: false,
        operational_status: 'STATE_UNAVAILABLE',
        source: UNKNOWN,
        enabled: UNKNOWN,
        active_version: null,
        last_run: null,
        last_result: null,
        last_error: null,
        checked_at: checkedAt,
        service_reachable: serviceReachable,
        contract_available: false,
        runtime_record: runtimeRecord || null,
        risk_code: unavailableRisk
      };
    }
    runtimeMatches = matchingStateRecords(runtimeStates, automationId);
    automationMatches = matchingStateRecords(automationStates, automationId);
    runMatches = matchingStateRecords(automationRuns, automationId);
    if (runtimeMatches.length !== 1 ||
        automationMatches.length !== 1) {
      return unavailable(
        runtimeMatches.length === 1 ? runtimeMatches[0] : null
      );
    }
    runtimeEnvelope = object(runtimeMatches[0].runtime) ?
      runtimeMatches[0].runtime : null;
    stateProbe = runtimeEnvelope && object(runtimeEnvelope.state) ?
      runtimeEnvelope.state : null;
    if (runtimeEnvelope &&
        (object(runtimeEnvelope.health) || stateProbe)) {
      serviceReachable = Boolean(
        runtimeEnvelope.health &&
        runtimeEnvelope.health.responded === true ||
        stateProbe && stateProbe.responded === true
      );
    }
    if (stateProbe && stateProbe.error_code === 'STATE_CONTRACT_INVALID') {
      unavailableRisk = 'STATE_CONTRACT_INVALID';
    }
    runtimeContract = runtimeEnvelope &&
      runtimeEnvelope.configured === true &&
      stateProbe &&
      stateProbe.available === true ?
        runtimeContractFacts(stateProbe.value) : { valid: false };
    if (stateProbe && stateProbe.available === true &&
        !runtimeContract.valid) {
      unavailableRisk = 'STATE_CONTRACT_INVALID';
    }
    stateSupport = supportingStateFact(
      automationMatches[0],
      'state'
    );
    if (!runtimeContract.valid ||
        !stateSupport.valid ||
        !stateSupport.present ||
        stateSupport.value.enabled !== runtimeContract.enabled) {
      return unavailable(runtimeContract.valid ? runtimeContract : null);
    }

    if (runMatches.length === 1) {
      runSupport = supportingStateFact(runMatches[0], 'runs');
      if (runSupport.valid && runSupport.present &&
          runSupport.value.latest !== null) {
        latest = runSupport.value.latest;
        lastRun = lastRunFact(latest && latest.ts);
        if (lastRun.valid &&
            (latest.ok === true ||
             latest.ok === false ||
             latest.ok === null)) {
          lastResult = latest.ok === true ? 'ok' :
            (latest.ok === false ? 'failed' : null);
        } else {
          lastRun = { valid: true, value: null };
        }
      }
    }
    return {
      available: true,
      operational_status:
        stateSupport.value.enabled ? 'WORKING' : 'NOT_RUNNING',
      source: 'LOCAL_STATE_CONTRACT+AGENT_STATE',
      enabled: stateSupport.value.enabled,
      active_version: runtimeContract.active_version,
      last_run: lastRun && lastRun.valid ? lastRun.value : null,
      last_result: lastResult,
      last_error: runtimeContract.last_error,
      checked_at: runtimeContract.checked_at || checkedAt,
      service_reachable: serviceReachable,
      contract_available: true,
      runtime_record: runtimeContract,
      risk_code: null
    };
  }

  function actionGates(operationalStatus) {
    var reason = operationalStatus === 'STATE_UNAVAILABLE' ?
      'STATE_REQUIRED' : 'NOT_IMPLEMENTED';
    var stateRequired = reason === 'STATE_REQUIRED';
    var gate = function () {
      return {
        allowed: false,
        enabled: false,
        reason: reason,
        reason_code: reason,
        message_ru: stateRequired ?
          'Действие заблокировано: достоверное состояние автоматизации не получено.' :
          'Действие пока недоступно: Evolution Console работает в режиме чтения.',
        message_en: stateRequired ?
          'Action blocked: a trustworthy automation state was not obtained.' :
          'Action is not available yet: Evolution Console is read-only.'
      };
    };
    return {
      enable_disable: gate(),
      start: gate(),
      stop: gate(),
      enable: gate(),
      disable: gate(),
      update: gate(),
      rollback: gate()
    };
  }

  function runtimeScheduleMap(runtimeRecord) {
    var source = runtimeRecord && runtimeRecord.schedules;
    var result = {};
    if (Array.isArray(source)) {
      source.forEach(function (entry) {
        var id = stringValue(entry &&
          (entry.id || entry.schedule_id || entry.scheduleId));
        if (id && !result[id]) result[id] = entry;
      });
    } else if (object(source)) {
      Object.keys(source).forEach(function (id) {
        if (object(source[id])) result[id] = source[id];
      });
    }
    return result;
  }

  function schedulerSid(value) {
    value = stringValue(value);
    if (value.indexOf('sched:') === 0) value = value.slice(6);
    return /^[A-Za-z0-9][A-Za-z0-9:._-]{0,159}$/.test(value) ?
      value : '';
  }

  function reviewedScheduleProjection(schedules, runtimeRecord,
                                      runtimeAvailable, schedulerIndexSids,
                                      schedulerAvailable, installed, row) {
    var runtimeMap = runtimeScheduleMap(runtimeRecord);
    var index = {};
    (schedulerIndexSids || []).forEach(function (value) {
      var sid = schedulerSid(value);
      if (sid) index[sid] = true;
    });
    return (schedules || []).map(function (schedule) {
      var projected = cloneJson(schedule, {});
      var runtimeId = stringValue(schedule && schedule.id);
      var schedulerRef = stringValue(schedule && (
        schedule.scheduler_sid || schedule.schedulerSid
      ));
      var sid = schedulerSid(schedulerRef);
      var runtimeSchedule = runtimeMap[runtimeId];
      var kind = stringValue(schedule && schedule.kind)
        .toLowerCase().replace(/_/g, '-');
      var external = kind === 'external-cron';
      var internal = kind === 'internal' ||
        kind === 'internal-bridge' ||
        kind === 'in-service';
      var active;
      var nextRun;
      projected.scheduler_ref = schedulerRef || null;
      projected.operational_status = UNKNOWN;
      if (runtimeAvailable && runtimeSchedule) {
        active = field(runtimeSchedule, 'active', null);
        nextRun = field(runtimeSchedule, 'next_run', 'nextRun');
        if (active.present && active.value === false &&
            nextRun.present && nextRun.value === null) {
          projected.operational_status = 'NO_SCHEDULE';
          projected.active = false;
          projected.next_run = null;
        } else if (active.present && active.value === true) {
          projected.operational_status = 'ACTIVE';
          projected.active = true;
          if (nextRun.present) projected.next_run = nextRun.value;
        } else if (active.present && active.value === false) {
          projected.operational_status = 'PAUSED';
          projected.active = false;
          if (nextRun.present) projected.next_run = nextRun.value;
        }
      }
      if (internal) {
        projected.reference_status = 'NOT_APPLICABLE';
        projected.state = projected.operational_status === UNKNOWN ?
          'NOT_APPLICABLE' : projected.operational_status;
        return projected;
      }
      if (!external) {
        projected.reference_status = UNKNOWN;
        projected.state = projected.operational_status === 'NO_SCHEDULE' ?
          'NO_SCHEDULE' : UNKNOWN;
        return projected;
      }
      if (!installed) {
        projected.reference_status = UNKNOWN;
        projected.state = projected.operational_status === 'NO_SCHEDULE' ?
          'NO_SCHEDULE' : UNKNOWN;
        return projected;
      }
      if (!schedulerAvailable || !sid) {
        projected.reference_status = UNKNOWN;
        projected.state = projected.operational_status === 'NO_SCHEDULE' ?
          'NO_SCHEDULE' : UNKNOWN;
        return projected;
      }
      projected.reference_status = index[sid] ? 'PRESENT' : 'MISSING';
      projected.state = projected.operational_status === 'NO_SCHEDULE' ?
        'NO_SCHEDULE' : projected.reference_status;
      if (projected.reference_status === 'MISSING' &&
          schedule.required !== false &&
          installed) {
        discrepancy(row, 'SCHEDULE_REFERENCE_MISSING');
      }
      return projected;
    });
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
      runtime_state: true,
      runtime_states: true,
      automation_state: true,
      automation_states: true,
      automation_runs: true,
      scheduler_index: true,
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
    var runtimeStates = Array.isArray(spec.runtimeStates) ?
      spec.runtimeStates : [];
    var automationStates = Array.isArray(spec.automationStates) ?
      spec.automationStates : [];
    var automationRuns = Array.isArray(spec.automationRuns) ?
      spec.automationRuns : [];
    var schedulerIndexSids = Array.isArray(spec.schedulerIndexSids) ?
      spec.schedulerIndexSids : [];
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
      'runtimeStates',
      'automationStates',
      'automationRuns',
      'schedulerIndexSids',
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
    var runtimeStatesAvailable = sourceAvailable(
      spec, 'runtime_state', 'runtimeStates', sourceErrors
    );
    var automationStatesAvailable = sourceAvailable(
      spec, 'automation_state', 'automationStates', sourceErrors
    );
    var automationRunsAvailable = sourceAvailable(
      spec, 'automation_runs', 'automationRuns', sourceErrors
    );
    var schedulerIndexAvailable = sourceAvailable(
      spec, 'scheduler_index', 'schedulerIndexSids', sourceErrors
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
      runtimeStatesAvailable &&
      automationStatesAvailable &&
      automationRunsAvailable &&
      schedulerIndexAvailable &&
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
      var declaredSchedules;
      var operational;
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
      declaredSchedules = installedFact === true ?
        manifestScheduleDeclarations(device) : [];
      if (!declaredSchedules.length) {
        declaredSchedules = reviewed.schedules;
      }
      operational = installedFact === true ? operationalState(
        id,
        runtimeStates,
        automationStates,
        automationRuns,
        checkedAt
      ) : {
        available: false,
        operational_status: UNKNOWN,
        source: UNKNOWN,
        enabled: UNKNOWN,
        active_version: null,
        last_run: null,
        last_result: null,
        last_error: null,
        checked_at: checkedAt,
        service_reachable: UNKNOWN,
        contract_available: false,
        runtime_record: null,
        risk_code: null
      };
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
        enabled: operational.enabled,
        operational_status: operational.operational_status,
        active_version: operational.active_version,
        last_run: operational.last_run,
        last_result: operational.last_result,
        last_error: operational.last_error,
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
          schedules: [],
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
          source: operational.source,
          status: installedFact === true ? deviceStatus :
            (catalogAvailable && catalogueValid ? catalogueStatusExact :
              (migration ? migration.status : UNKNOWN)),
          operational_status: operational.operational_status,
          active_version: operational.active_version,
          last_run: operational.last_run,
          last_result: operational.last_result,
          last_error: operational.last_error,
          checked_at: operational.checked_at,
          service_reachable: operational.service_reachable,
          contract_available: operational.contract_available
        },
        actions: {
          enable: 'NOT_IMPLEMENTED',
          disable: 'NOT_IMPLEMENTED',
          update: 'NOT_IMPLEMENTED',
          rollback: 'NOT_IMPLEMENTED'
        },
        action_gates: actionGates(operational.operational_status),
        updated_at: checkedAt,
        risks: []
      };
      row.components.schedules = reviewedScheduleProjection(
        declaredSchedules,
        operational.runtime_record,
        runtimeStatesAvailable &&
          matchingStateRecords(runtimeStates, id).length === 1,
        schedulerIndexSids,
        schedulerIndexAvailable,
        installedFact === true,
        row
      );

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
      if (installedFact === true &&
          operational.operational_status === 'STATE_UNAVAILABLE') {
        discrepancy(
          row,
          operational.risk_code || 'AUTOMATION_STATE_UNAVAILABLE'
        );
      }
      if (installedFact === true &&
          operational.operational_status !== 'STATE_UNAVAILABLE' &&
          operational.active_version !== null &&
          deviceVersion !== UNKNOWN &&
          operational.active_version !== deviceVersion) {
        discrepancy(row, 'ACTIVE_VERSION_MISMATCH');
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
      if (installedFact === true &&
          row.components.schedules.some(function (schedule) {
            return schedule.required !== false &&
              schedule.reference_status === 'MISSING';
          })) {
        row.flags.dead_reference = true;
      } else if (installedFact === true &&
                 row.flags.dead_reference === false &&
                 row.components.schedules.some(function (schedule) {
                   return schedule.required !== false &&
                     schedule.reference_status === UNKNOWN;
                 })) {
        row.flags.dead_reference = UNKNOWN;
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
