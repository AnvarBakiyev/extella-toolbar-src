// ── EVOLUTION AUTOMATION INVENTORY ────────────────────────────────────────
// Pure normalization for installed, user-facing business automations.
// Platform agents, Experts and local services are components, not fleet rows.
//
// Inputs are already account/device-fenced by evolutionAutomationProvider.
// This module never reads APIs, never calculates Agent Passport risks and
// never treats a running process as proof of application health.

ETB.evolutionAutomationInventory = (function () {
  var SCHEMA = 'extella.evolution.automation_inventory.v1';
  var SCOPE = 'CURRENT_DEVICE';

  function _string(value, max) {
    var output = String(value == null ? '' : value)
      .replace(/\s+/g, ' ')
      .trim();
    return output.slice(0, max || 240);
  }

  function _id(value) {
    var output = _string(value, 160);
    if (!output || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(output)) return '';
    return output;
  }

  function _array(value) {
    return Array.isArray(value) ? value : [];
  }

  function _eligible(manifest) {
    var category = _string(manifest && manifest.category, 80).toLowerCase();
    var type = _string(manifest && manifest.type, 80).toLowerCase();
    var schema = _string(
      manifest && (manifest.schemaVersion || manifest.schema_version),
      120
    );
    return Boolean(
      manifest && typeof manifest === 'object' &&
      (
        category === 'automations' ||
        type === 'process' ||
        type === 'automation' ||
        schema === 'extella-process-pack-v1' ||
        manifest.wizardSession ||
        manifest.orchestrator ||
        (manifest.standalone === true &&
          manifest.service && manifest.service.isApp === true)
      )
    );
  }

  function _warning(code, ru, en, source) {
    var row = {
      code: code,
      messageRu: ru,
      messageEn: en
    };
    if (source) row.source = source;
    return row;
  }

  function _componentName(value) {
    if (typeof value === 'string') return _string(value, 200);
    return _string(value && (value.name || value.id), 200);
  }

  function _expertRows(manifest) {
    var rows = [];
    var seen = {};
    function add(value, required, source) {
      var name = _componentName(value);
      if (!name || seen[name]) return;
      seen[name] = true;
      rows.push({
        name: name,
        version: _string(value && value.version, 120) || null,
        required: required === true,
        source: source
      });
    }
    _array(manifest && manifest.experts).forEach(function (value) {
      add(value, true, 'manifest.experts');
    });
    _array(manifest && manifest.optionalExperts).forEach(function (value) {
      add(value, false, 'manifest.optionalExperts');
    });
    _array(manifest && (manifest.expert_defs || manifest.expertDefs))
      .forEach(function (value) {
        add(value, true, 'manifest.expert_defs');
      });
    return rows.sort(function (left, right) {
      return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
    });
  }

  function _platformAgentRows(manifest) {
    var candidates = [];
    var seen = {};
    var rows = [];
    var components = manifest && manifest.components || {};
    _array(components.platform_agents || components.platformAgents)
      .forEach(function (value) {
        candidates.push({
          value: value,
          source: 'manifest.components.platform_agents'
        });
      });
    if (manifest && manifest.synthAgent) {
      candidates.push({
        value: manifest.synthAgent,
        source: 'manifest.synthAgent'
      });
    }
    if (manifest && manifest.platform_agent_id) {
      candidates.push({
        value: { id: manifest.platform_agent_id },
        source: 'manifest.platform_agent_id'
      });
    }
    if (manifest && manifest.params && manifest.params.agent_id) {
      candidates.push({
        value: { id: manifest.params.agent_id },
        source: 'manifest.params.agent_id'
      });
    }
    candidates.forEach(function (candidate) {
      var value = candidate.value;
      var id = _id(typeof value === 'string' ? value :
        value && (value.id || value.platform_agent_id));
      if (!id || seen[id]) return;
      seen[id] = true;
      rows.push({
        id: id,
        name: _string(value && value.name, 200) || null,
        role: _string(value && value.role, 160) || null,
        source: candidate.source,
        verified: false
      });
    });
    return rows.sort(function (left, right) {
      return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
    });
  }

  function _serviceRows(manifest) {
    var service = manifest && manifest.service;
    var ui = manifest && manifest.ui;
    if (!service && !(ui && ui.type === 'local_server')) return [];
    service = service || {};
    return [{
      id: _id(service.id || manifest.id) || null,
      port: Number.isInteger(Number(service.port || (ui && ui.port))) ?
        Number(service.port || (ui && ui.port)) : null,
      healthPath: _string(
        service.healthPath || (ui && ui.healthPath),
        240
      ) || null,
      declaredReady: service.ready === true ? true :
        (service.ready === false ? false : null)
    }];
  }

  function _scheduleRows(manifest) {
    var values = _array(manifest && manifest.schedules).slice();
    if (manifest && manifest.schedule &&
        typeof manifest.schedule === 'object') {
      values.push(manifest.schedule);
    }
    return values.map(function (value, index) {
      return {
        id: _id(value && (
          value.id || value.kvKey || value.schedule_id
        )) || ('schedule_' + String(index + 1)),
        kind: _string(value && (
          value.kind || value.mechanism || value.cadence
        ), 160) || 'unknown',
        enabled: value && value.active === true ? true :
          (value && value.active === false ? false : null)
      };
    });
  }

  function _integrationRows(manifest) {
    var values = _array(manifest && manifest.integrations);
    var channels = manifest && manifest.channels;
    var seen = {};
    var rows = [];
    values.forEach(function (value) {
      var id = _id(typeof value === 'string' ? value :
        value && (value.id || value.kind || value.name));
      if (!id || seen[id]) return;
      seen[id] = true;
      rows.push({
        id: id,
        kind: _string(value && value.kind, 160) ||
          _string(typeof value === 'string' ? value : value && value.name, 160),
        secretRef: _string(value && (
          value.secret_ref || value.secretRef
        ), 200) || null
      });
    });
    if (channels && typeof channels === 'object' &&
        !Array.isArray(channels)) {
      Object.keys(channels).sort().forEach(function (key) {
        var id = _id(key);
        if (!id || seen[id]) return;
        seen[id] = true;
        rows.push({ id: id, kind: id, secretRef: null });
      });
    }
    return rows;
  }

  function _knowledgeRows(manifest) {
    var rows = [];
    _array(manifest && manifest.conceptTexts).forEach(function (_, index) {
      rows.push({
        id: 'concept_text_' + String(index + 1),
        kind: 'concept'
      });
    });
    if (manifest && manifest.knowledgeBase &&
        manifest.knowledgeBase.name) {
      rows.push({
        id: _id(manifest.knowledgeBase.name) ||
          'knowledge_base_1',
        kind: 'knowledge_base',
        name: _string(manifest.knowledgeBase.name, 200)
      });
    }
    return rows;
  }

  function _ruleRows(manifest) {
    return _array(manifest && manifest.rules).map(function (value, index) {
      var name = _componentName(value);
      return {
        id: _id(name) || ('rule_' + String(index + 1)),
        name: name || null
      };
    });
  }

  function _runtimeStatus(service) {
    var value = _string(service && service.status, 80).toLowerCase();
    if (value === 'running') return 'RUNNING';
    if (['stopped', 'not_running', 'offline', 'exited']
        .indexOf(value) !== -1) return 'STOPPED';
    return 'UNKNOWN';
  }

  function _desiredStatus(service) {
    var value = _string(service && service.desired, 80).toLowerCase();
    if (['on', 'enabled', 'running'].indexOf(value) !== -1) return 'ON';
    if (['off', 'disabled', 'stopped'].indexOf(value) !== -1) return 'OFF';
    return 'UNKNOWN';
  }

  function _healthStatus(service) {
    var value = _string(service && (
      service.healthStatus || service.health_status || service.health
    ), 80).toLowerCase();
    if (['ok', 'healthy', 'success', 'passing'].indexOf(value) !== -1) {
      return 'OK';
    }
    if (['degraded', 'warning', 'unhealthy'].indexOf(value) !== -1) {
      return 'DEGRADED';
    }
    if (['error', 'failed', 'critical'].indexOf(value) !== -1) {
      return 'ERROR';
    }
    return 'UNKNOWN';
  }

  function _exactService(services, id) {
    var matches = _array(services).filter(function (service) {
      return _id(service && service.id) === id;
    });
    return {
      row: matches.length === 1 ? matches[0] : null,
      duplicate: matches.length > 1
    };
  }

  function _normalizeRow(manifest, services, checkedAt) {
    var id = _id(manifest && manifest.id);
    var serviceMatch = _exactService(services, id);
    var service = serviceMatch.row;
    var runtimeStatus = _runtimeStatus(service);
    var desiredStatus = _desiredStatus(service);
    var healthStatus = _healthStatus(service);
    var platformAgents = _platformAgentRows(manifest);
    var warnings = [];
    if (!_string(manifest && manifest.version, 120)) {
      warnings.push(_warning(
        'INSTALLED_VERSION_UNKNOWN',
        'Установленная версия не указана в манифесте.',
        'The installed version is missing from the manifest.',
        'DEVICE_REGISTRY'
      ));
    }
    if (services === null) {
      warnings.push(_warning(
        'ACTIVITY_CENTER_UNAVAILABLE',
        'Activity Center недоступен; runtime не подтверждён.',
        'Activity Center is unavailable; runtime is not confirmed.',
        'ACTIVITY_CENTER'
      ));
    } else if (serviceMatch.duplicate) {
      warnings.push(_warning(
        'DUPLICATE_SERVICE_ID',
        'Activity Center вернул несколько служб с одним ID.',
        'Activity Center returned duplicate services for the same ID.',
        'ACTIVITY_CENTER'
      ));
    } else if (!service) {
      warnings.push(_warning(
        'SERVICE_NOT_FOUND',
        'Для прикладного агента не найдена служба с точным ID.',
        'No service with the exact ID was found for this application agent.',
        'ACTIVITY_CENTER'
      ));
    }
    if (runtimeStatus === 'UNKNOWN') {
      warnings.push(_warning(
        'RUNTIME_STATUS_UNKNOWN',
        'Состояние runtime неизвестно.',
        'Runtime status is unknown.',
        'ACTIVITY_CENTER'
      ));
    }
    if (healthStatus === 'UNKNOWN') {
      warnings.push(_warning(
        'HEALTH_UNKNOWN',
        'Health не подтверждён отдельным источником.',
        'Health is not confirmed by a separate source.',
        'ACTIVITY_CENTER'
      ));
    }
    if (platformAgents.length) {
      warnings.push(_warning(
        'PLATFORM_AGENT_BINDING_UNVERIFIED',
        'Связь с внутренним агентом платформы заявлена, но не проверена.',
        'The platform-agent binding is declared but not verified.',
        'DEVICE_REGISTRY'
      ));
    }
    return {
      id: id,
      name: _string(manifest && manifest.name, 200) || id,
      installedVersion: _string(manifest && manifest.version, 120) || null,
      manifestSource: 'DEVICE_REGISTRY',
      components: {
        platformAgents: platformAgents,
        experts: _expertRows(manifest),
        services: _serviceRows(manifest),
        schedules: _scheduleRows(manifest),
        integrations: _integrationRows(manifest),
        knowledge: _knowledgeRows(manifest),
        rules: _ruleRows(manifest)
      },
      runtime: {
        status: runtimeStatus,
        desired: desiredStatus,
        health: healthStatus,
        lastRun: null,
        lastResult: null,
        lastError: null,
        checkedAt: checkedAt
      },
      actions: {
        start: service && service.canStart === true ?
          'AVAILABLE' : 'UNAVAILABLE',
        stop: service && service.canStop === true ?
          'AVAILABLE' : 'UNAVAILABLE',
        update: 'UNAVAILABLE',
        rollback: 'UNAVAILABLE'
      },
      warnings: warnings,
      evidence: [{
        source: 'DEVICE_REGISTRY',
        scope: SCOPE,
        checkedAt: checkedAt,
        status: 'READ'
      }, {
        source: 'ACTIVITY_CENTER',
        scope: SCOPE,
        checkedAt: checkedAt,
        status: service ? 'READ' : 'UNAVAILABLE'
      }]
    };
  }

  function normalize(deviceManifests, activityServices, options) {
    var opts = options || {};
    var checkedAt = _string(opts.checkedAt, 80) ||
      new Date().toISOString();
    var manifests = Array.isArray(deviceManifests) ?
      deviceManifests : [];
    var services = activityServices === null ? null :
      (Array.isArray(activityServices) ? activityServices : null);
    var candidates = manifests.filter(_eligible);
    var idCounts = {};
    var warnings = [];
    var rows;
    candidates.forEach(function (manifest) {
      var id = _id(manifest && manifest.id);
      if (!id) {
        warnings.push(_warning(
          'AUTOMATION_ID_INVALID',
          'Манифест прикладного агента не содержит допустимый стабильный ID.',
          'An application-agent manifest has no valid stable ID.',
          'DEVICE_REGISTRY'
        ));
        return;
      }
      idCounts[id] = (idCounts[id] || 0) + 1;
    });
    Object.keys(idCounts).sort().forEach(function (id) {
      if (idCounts[id] > 1) {
        warnings.push(_warning(
          'DUPLICATE_AUTOMATION_ID',
          'Несколько манифестов используют один stable ID: ' + id,
          'Multiple manifests use the same stable ID: ' + id,
          'DEVICE_REGISTRY'
        ));
      }
    });
    _array(opts.sourceErrors).forEach(function (error) {
      warnings.push(_warning(
        _string(error && error.code, 120) || 'SOURCE_UNAVAILABLE',
        'Источник данных недоступен: ' +
          (_string(error && error.source, 120) || 'unknown'),
        'A data source is unavailable: ' +
          (_string(error && error.source, 120) || 'unknown'),
        _string(error && error.source, 120) || null
      ));
    });
    rows = candidates.filter(function (manifest) {
      var id = _id(manifest && manifest.id);
      return id && idCounts[id] === 1;
    }).map(function (manifest) {
      return _normalizeRow(manifest, services, checkedAt);
    }).sort(function (left, right) {
      var leftName = left.name.toLowerCase();
      var rightName = right.name.toLowerCase();
      if (leftName !== rightName) return leftName < rightName ? -1 : 1;
      return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
    });
    return {
      schema: SCHEMA,
      scope: SCOPE,
      checkedAt: checkedAt,
      complete: deviceManifests !== null &&
        services !== null &&
        opts.complete !== false &&
        warnings.length === 0,
      source: {
        manifests: 'DEVICE_REGISTRY',
        runtime: 'ACTIVITY_CENTER'
      },
      evidence: _array(opts.evidence),
      rows: rows,
      counters: {
        total: rows.length,
        running: rows.filter(function (row) {
          return row.runtime.status === 'RUNNING';
        }).length,
        stopped: rows.filter(function (row) {
          return row.runtime.status === 'STOPPED';
        }).length,
        unknown: rows.filter(function (row) {
          return row.runtime.status === 'UNKNOWN';
        }).length,
        withWarnings: rows.filter(function (row) {
          return row.warnings.length > 0;
        }).length
      },
      warnings: warnings
    };
  }

  return {
    normalize: normalize
  };
})();
