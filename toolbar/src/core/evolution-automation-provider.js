// ── EVOLUTION AUTOMATION PROVIDER ─────────────────────────────────────────
// Host projection of automation manifests and runtime evidence from the
// current device. Device registry sync is the existing registry read path;
// Activity Center is queried with the same loopback contract as its panel.
// The only mutation exposed is exact start/stop with fresh capability check
// and confirmed read-back. Its control token never leaves this module.
//
// Exposes:
//   ETB.evolutionAutomationProvider.loadCurrentDevice({ actorId, epoch })
//   ETB.evolutionAutomationProvider.controlCurrentDevice({
//     actorId, epoch, automationId, action
//   })

ETB.evolutionAutomationProvider = (function () {
  var ACTIVITY_BASE = 'http://127.0.0.1:8799';
  var SCOPE = 'CURRENT_DEVICE';
  var latestEpochByActor = {};
  var controlInFlight = Object.create(null);

  function _error(code, message) {
    var error = new Error(message || code);
    error.code = code;
    return error;
  }

  function _assertSession(context) {
    if (latestEpochByActor[context.actorId] !== context.epoch) {
      throw _error(
        'ACCOUNT_SESSION_CHANGED',
        'Evolution automation inventory session changed while reading'
      );
    }
    if (!ETB.auth || typeof ETB.auth.getUserId !== 'function') return;
    var currentActorId = '';
    try {
      currentActorId = String(ETB.auth.getUserId() || '');
    } catch (_) {}
    if (!currentActorId || currentActorId !== context.actorId) {
      throw _error(
        'ACCOUNT_SESSION_CHANGED',
        'authenticated account changed while reading automation inventory'
      );
    }
  }

  function _context(options) {
    var actorId = String(options && options.actorId || '').trim();
    var epoch = options && options.epoch;
    if (!actorId || actorId.length > 240) {
      throw _error(
        'ACCOUNT_CONTEXT_REQUIRED',
        'authenticated account is required for automation inventory'
      );
    }
    if (typeof epoch !== 'number' || !Number.isFinite(epoch) ||
        Math.floor(epoch) !== epoch || epoch < 0) {
      throw _error(
        'ACCOUNT_CONTEXT_REQUIRED',
        'a valid account session epoch is required for automation inventory'
      );
    }
    if (Object.prototype.hasOwnProperty.call(latestEpochByActor, actorId) &&
        epoch < latestEpochByActor[actorId]) {
      throw _error(
        'ACCOUNT_SESSION_CHANGED',
        'stale automation inventory session was fenced'
      );
    }
    latestEpochByActor[actorId] = epoch;
    var context = { actorId: actorId, epoch: epoch };
    _assertSession(context);
    return context;
  }

  function _isSecretKey(key) {
    var raw = String(key || '');
    if (/^(secret|password|passwd|credential|credentials)$/i.test(raw)) {
      return true;
    }
    if (/(^|[_-])(token|secret|password|passwd|credential|api[_-]?key|private[_-]?key)$/i.test(raw) &&
        !/(^|[_-])(secret|credential)[_-]?ref$/i.test(raw)) {
      return true;
    }
    var compact = raw.replace(/[^a-z0-9]/gi, '').toLowerCase();
    return [
      'controltoken', 'accesstoken', 'refreshtoken', 'authtoken',
      'apitoken', 'sessiontoken', 'idtoken', 'apikey', 'clientsecret',
      'privatekey', 'authorization', 'cookie', 'setcookie',
      'xextellacontrol'
    ].indexOf(compact) !== -1;
  }

  function _safeString(value) {
    return String(value)
      .replace(
        /([a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@/gi,
        '$1[REDACTED]@'
      )
      .replace(
        /([?&](?:access_token|refresh_token|token|api_key|password)=)[^&#\s]*/gi,
        '$1[REDACTED]'
      );
  }

  function _sanitize(value, stack) {
    if (value == null || typeof value === 'number' ||
        typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'string') return _safeString(value);
    if (typeof value !== 'object') return undefined;
    stack = stack || [];
    if (stack.indexOf(value) !== -1) return null;
    stack.push(value);
    var output;
    if (Array.isArray(value)) {
      output = value.map(function (item) {
        var sanitized = _sanitize(item, stack);
        return sanitized === undefined ? null : sanitized;
      });
    } else {
      output = {};
      Object.keys(value).forEach(function (key) {
        if (key === '__proto__' || key === 'prototype' ||
            key === 'constructor' || _isSecretKey(key)) {
          return;
        }
        var sanitized = _sanitize(value[key], stack);
        if (sanitized !== undefined) output[key] = sanitized;
      });
    }
    stack.pop();
    return output;
  }

  function _desktopDeviceId() {
    try {
      if (typeof window !== 'undefined' && window.extellaDesktop &&
          typeof window.extellaDesktop.getDeviceID === 'function') {
        return Promise.resolve(window.extellaDesktop.getDeviceID())
          .then(function (value) {
            return String(value || '').trim();
          })
          .catch(function () { return ''; });
      }
    } catch (_) {}
    return Promise.resolve('');
  }

  function _resolveDeviceId(context) {
    return _desktopDeviceId().then(function (deviceId) {
      _assertSession(context);
      if (deviceId) return deviceId;
      if (!ETB.api || typeof ETB.api.kvGet !== 'function') return '';
      return ETB.api.kvGet('_device_id')
        .then(function (response) {
          _assertSession(context);
          return String(response && response.value || '').trim();
        })
        .catch(function (error) {
          if (error && error.code === 'ACCOUNT_SESSION_CHANGED') throw error;
          return '';
        });
    });
  }

  function _loadManifests(context) {
    if (!ETB.registry ||
        typeof ETB.registry.syncFromDevice !== 'function' ||
        typeof ETB.registry.getCustom !== 'function') {
      return Promise.reject(_error(
        'DEVICE_REGISTRY_UNAVAILABLE',
        'device registry reader is unavailable'
      ));
    }
    return _resolveDeviceId(context).then(function (deviceId) {
      _assertSession(context);
      if (!deviceId) {
        throw _error(
          'CURRENT_DEVICE_UNRESOLVED',
          'current device identity is unavailable'
        );
      }
      return ETB.registry.syncFromDevice(deviceId);
    }).then(function (synced) {
      _assertSession(context);
      if (!Array.isArray(synced)) {
        throw _error(
          'DEVICE_REGISTRY_INVALID',
          'device registry returned an invalid manifest list'
        );
      }
      var byId = Object.create(null);
      var order = [];
      synced.forEach(function (manifest) {
        var id = String(manifest && manifest.id || '');
        if (!id) return;
        if (byId[id]) {
          throw _error(
            'DEVICE_REGISTRY_DUPLICATE_ID',
            'device registry returned duplicate manifest IDs'
          );
        }
        byId[id] = manifest;
        order.push(id);
      });
      var custom = ETB.registry.getCustom();
      if (!Array.isArray(custom)) {
        throw _error(
          'DEVICE_REGISTRY_INVALID',
          'device registry cache returned an invalid manifest list'
        );
      }
      custom.forEach(function (manifest) {
        var id = String(manifest && manifest.id || '');
        if (byId[id]) byId[id] = manifest;
      });
      return _sanitize(order.map(function (id) { return byId[id]; }));
    });
  }

  function _readActivity(path, context) {
    if (typeof fetch !== 'function') {
      return Promise.reject(_error(
        'ACTIVITY_CENTER_UNAVAILABLE',
        'Activity Center transport is unavailable'
      ));
    }
    return fetch(ACTIVITY_BASE + path, { cache: 'no-store' })
      .then(function (response) {
        _assertSession(context);
        if (!response || !response.ok) {
          throw _error(
            'ACTIVITY_CENTER_UNAVAILABLE',
            'Activity Center endpoint is unavailable'
          );
        }
        return response.json();
      })
      .then(function (payload) {
        _assertSession(context);
        if (!payload || typeof payload !== 'object' ||
            Array.isArray(payload)) {
          throw _error(
            'ACTIVITY_CENTER_INVALID',
            'Activity Center returned an invalid payload'
          );
        }
        return _sanitize(payload);
      });
  }

  function _controlId(value) {
    var id = String(value == null ? '' : value).trim();
    if (!id || id.length > 160 ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(id)) {
      throw _error(
        'AUTOMATION_ID_INVALID',
        'an exact current-device automation ID is required'
      );
    }
    return id;
  }

  function _readControlServices(context) {
    if (typeof fetch !== 'function') {
      return Promise.reject(_error(
        'ACTIVITY_CENTER_UNAVAILABLE',
        'Activity Center transport is unavailable'
      ));
    }
    return fetch(ACTIVITY_BASE + '/api/services', { cache: 'no-store' })
      .then(function (response) {
        _assertSession(context);
        if (!response || !response.ok) {
          throw _error(
            'ACTIVITY_CENTER_UNAVAILABLE',
            'Activity Center service control is unavailable'
          );
        }
        return response.json();
      }).then(function (payload) {
        _assertSession(context);
        if (!payload || typeof payload !== 'object' ||
            !Array.isArray(payload.services)) {
          throw _error(
            'ACTIVITY_CENTER_INVALID',
            'Activity Center returned an invalid services payload'
          );
        }
        return payload;
      });
  }

  function _exactControlService(payload, automationId) {
    var matches = payload.services.filter(function (service) {
      return String(service && service.id || '') === automationId;
    });
    if (matches.length !== 1) {
      throw _error(
        matches.length ?
          'DUPLICATE_SERVICE_ID' : 'SERVICE_NOT_FOUND',
        'Activity Center must return exactly one service for the automation ID'
      );
    }
    return matches[0];
  }

  function _controlLockKey(automationId) {
    return SCOPE + ':' + automationId.length + ':' + automationId;
  }

  function _authorizeControlTarget(context, automationId, action) {
    var inventory = ETB.evolutionAutomationInventory;
    if (!inventory || typeof inventory.normalize !== 'function') {
      return Promise.reject(_error(
        'AUTOMATION_INVENTORY_UNAVAILABLE',
        'the canonical current-device automation inventory is unavailable'
      ));
    }
    return loadCurrentDevice({
      actorId: context.actorId,
      epoch: context.epoch
    }).then(function (raw) {
      _assertSession(context);
      var projection = inventory.normalize(
        raw.manifests,
        raw.services,
        {
          checkedAt: raw.checkedAt,
          complete: raw.complete,
          sourceErrors: raw.sourceErrors,
          evidence: raw.evidence
        }
      );
      if (!projection ||
          projection.schema !==
            'extella.evolution.automation_inventory.v1' ||
          projection.scope !== SCOPE ||
          projection.complete !== true ||
          !Array.isArray(projection.rows)) {
        throw _error(
          'AUTOMATION_CONTROL_INVENTORY_INCOMPLETE',
          'service control requires a complete current-device automation inventory'
        );
      }
      var matches = projection.rows.filter(function (row) {
        return String(row && row.id || '') === automationId;
      });
      if (matches.length !== 1) {
        throw _error(
          'AUTOMATION_CONTROL_TARGET_UNAUTHORIZED',
          'the exact service is not an installed application agent on this device'
        );
      }
      if (!matches[0].actions ||
          matches[0].actions[action] !== 'AVAILABLE') {
        throw _error(
          'SERVICE_CONTROL_NOT_ALLOWED',
          'the canonical inventory does not allow this action in the current state'
        );
      }
      return true;
    });
  }

  function controlCurrentDevice(options) {
    var context;
    var automationId;
    var action;
    var expectedStatus;
    var lockKey;
    var postStarted = false;
    try {
      context = _context(options);
      automationId = _controlId(options && options.automationId);
      action = String(options && options.action || '');
      if (action !== 'start' && action !== 'stop') {
        throw _error(
          'SERVICE_CONTROL_ACTION_UNSUPPORTED',
          'only exact start or stop is supported'
        );
      }
      expectedStatus = action === 'start' ? 'running' : 'stopped';
      lockKey = _controlLockKey(automationId);
      if (controlInFlight[lockKey]) {
        throw _error(
          'SERVICE_CONTROL_IN_PROGRESS',
          'a service-control operation is already in progress for this automation'
        );
      }
    } catch (error) {
      return Promise.reject(error);
    }
    var operation = _authorizeControlTarget(
      context,
      automationId,
      action
    ).then(function () {
      return _readControlServices(context);
    }).then(function (beforePayload) {
      var service = _exactControlService(beforePayload, automationId);
      var allowed = action === 'start' ?
        service.canStart === true : service.canStop === true;
      var token = String(beforePayload.controlToken || '');
      if (!allowed) {
        throw _error(
          'SERVICE_CONTROL_NOT_ALLOWED',
          'Activity Center does not allow this action in the current state'
        );
      }
      if (!token || token.length > 1000) {
        throw _error(
          'SERVICE_CONTROL_TOKEN_UNAVAILABLE',
          'Activity Center did not grant local service control'
        );
      }
      postStarted = true;
      return fetch(
        ACTIVITY_BASE + '/api/services/' +
          encodeURIComponent(automationId) + '/' + action,
        {
          method: 'POST',
          headers: { 'X-Extella-Control': token }
        }
      );
    }).then(function (response) {
      _assertSession(context);
      if (!response || !response.ok) {
        throw _error(
          'SERVICE_CONTROL_FAILED',
          'Activity Center did not confirm the service action'
        );
      }
      return response.json().catch(function () { return {}; });
    }).then(function () {
      _assertSession(context);
      return _readControlServices(context);
    }).then(function (afterPayload) {
      var service = _exactControlService(afterPayload, automationId);
      var status = String(service.status || '').toLowerCase();
      if (status !== expectedStatus) {
        throw _error(
          'SERVICE_CONTROL_READBACK_MISMATCH',
          'Activity Center read-back does not confirm the requested state'
        );
      }
      return {
        automationId: automationId,
        action: action,
        outcome: 'CONFIRMED',
        status: expectedStatus.toUpperCase(),
        desired: String(service.desired || '').toUpperCase() || 'UNKNOWN',
        scope: SCOPE,
        source: 'ACTIVITY_CENTER',
        checkedAt: new Date().toISOString()
      };
    }).catch(function (error) {
      if (!postStarted ||
          error && error.code === 'OPERATION_OUTCOME_UNKNOWN') {
        throw error;
      }
      var unknown = _error(
        'OPERATION_OUTCOME_UNKNOWN',
        'OUTCOME UNKNOWN · Activity Center did not prove the requested state; refresh before retrying'
      );
      unknown.causeCode = String(error && error.code || 'UNKNOWN');
      throw unknown;
    });
    controlInFlight[lockKey] = operation;
    return operation.then(function (result) {
      delete controlInFlight[lockKey];
      return result;
    }, function (error) {
      delete controlInFlight[lockKey];
      throw error;
    });
  }

  function _settle(promise, code) {
    return promise.then(function (value) {
      return { available: true, value: value };
    }).catch(function (error) {
      if (error && error.code === 'ACCOUNT_SESSION_CHANGED') throw error;
      return { available: false, code: code };
    });
  }

  function loadCurrentDevice(options) {
    var context;
    try {
      context = _context(options);
    } catch (error) {
      return Promise.reject(error);
    }
    return Promise.all([
      _settle(
        _loadManifests(context),
        'DEVICE_REGISTRY_UNAVAILABLE'
      ),
      _settle(
        _readActivity('/api/services', context).then(function (payload) {
          if (!Array.isArray(payload.services)) {
            throw _error(
              'ACTIVITY_CENTER_INVALID',
              'Activity Center returned an invalid services list'
            );
          }
          return payload.services;
        }),
        'ACTIVITY_CENTER_SERVICES_UNAVAILABLE'
      )
    ]).then(function (results) {
      _assertSession(context);
      var registry = results[0];
      var services = results[1];
      var checkedAt = new Date().toISOString();
      var sourceErrors = [];
      if (!registry.available) {
        sourceErrors.push({
          source: 'DEVICE_REGISTRY',
          code: registry.code
        });
      }
      if (!services.available) {
        sourceErrors.push({
          source: 'ACTIVITY_CENTER',
          endpoint: '/api/services',
          code: services.code
        });
      }
      var activityEvidence = {
        source: 'ACTIVITY_CENTER',
        scope: SCOPE,
        checkedAt: checkedAt,
        status: services.available ? 'READ' : 'UNAVAILABLE'
      };
      return {
        scope: SCOPE,
        manifests: registry.available ? registry.value : null,
        services: services.available ? services.value : null,
        evidence: [{
          source: 'DEVICE_REGISTRY',
          scope: SCOPE,
          checkedAt: checkedAt,
          status: registry.available ? 'READ' : 'UNAVAILABLE'
        }, activityEvidence],
        checkedAt: checkedAt,
        complete: sourceErrors.length === 0,
        sourceErrors: sourceErrors
      };
    });
  }

  return {
    loadCurrentDevice: loadCurrentDevice,
    controlCurrentDevice: controlCurrentDevice
  };
})();
