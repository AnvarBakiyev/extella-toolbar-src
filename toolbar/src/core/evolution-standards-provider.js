// ── EVOLUTION STANDARDS PROVIDER ──────────────────────────────────────────
// Read-only host provider for a prebuilt, canonical and attested PRODUCTION
// Agent Passport bundle. The bundle is provisioned into managed account KV by
// the release/integration pipeline; this runtime never invents passports or
// reimplements check_agent_passport.py.
//
// Exposes:
//   ETB.evolutionStandardsProvider.loadForActor({
//     actorId, epoch, platformAgentIds
//   })

ETB.evolutionStandardsProvider = (function () {
  var BUNDLE_KEY = 'xtl_evolution:production_standards_bundle:v1';
  var OWNER_LOCATOR_PREFIX = 'etb_evolution_standards_owner_v1:';
  var MANIFEST_SCHEMA = 'extella.evolution.standards_kv_manifest.v1';
  var CHUNK_ENCODING = 'canonical-json-chunks.v1';
  var MAX_LIVE_AGENTS = 500;
  var READ_CONCURRENCY = 4;
  var MAX_CHUNKS = 128;
  var MAX_BUNDLE_BYTES = 2 * 1024 * 1024;

  function _error(code, message) {
    var error = new Error(message || code);
    error.code = code;
    return error;
  }

  function _assertActor(actorId) {
    var currentActorId;
    if (!ETB.auth || typeof ETB.auth.getUserId !== 'function') return;
    try {
      currentActorId = String(ETB.auth.getUserId() || '');
    } catch (_) {
      currentActorId = '';
    }
    if (!currentActorId || currentActorId !== actorId) {
      throw _error(
        'ACCOUNT_SESSION_CHANGED',
        'authenticated account changed during production standards loading'
      );
    }
  }

  function _exactIds(values) {
    var rows = Array.isArray(values) ? values : [];
    var seen = {};
    var ids = [];
    if (!rows.length || rows.length > MAX_LIVE_AGENTS) {
      throw _error(
        'PRODUCTION_STANDARDS_LIVE_IDS_REQUIRED',
        'production standards provider requires the exact current live fleet'
      );
    }
    rows.forEach(function (value) {
      var id = String(value == null ? '' : value).trim();
      if (!id || id.length > 240 || /[*?\[\]{}]/.test(id) || seen[id]) {
        throw _error(
          'PRODUCTION_STANDARDS_LIVE_IDS_INVALID',
          'production standards provider accepts only unique exact live agent IDs'
        );
      }
      seen[id] = true;
      ids.push(id);
    });
    return ids.sort();
  }

  function _ownerLoad(actorId) {
    try {
      return String(localStorage.getItem(
        OWNER_LOCATOR_PREFIX + encodeURIComponent(actorId)
      ) || '');
    } catch (_) {
      return '';
    }
  }

  function _ownerSave(actorId, ownerAgentId) {
    try {
      localStorage.setItem(
        OWNER_LOCATOR_PREFIX + encodeURIComponent(actorId),
        ownerAgentId
      );
    } catch (_) {}
  }

  function _isMissing(response) {
    if (!response || typeof response !== 'object') return false;
    var status = String(response.status || '').toLowerCase();
    var httpStatus = Number(
      response.httpStatus || response.statusCode || 0
    );
    var detail = response.detail;
    if (Array.isArray(detail)) {
      detail = detail.map(function (row) {
        return row && (row.msg || row.message) || '';
      }).join('; ');
    } else if (detail && typeof detail === 'object') {
      detail = detail.message || detail.msg || '';
    }
    var message = [
      response.message,
      typeof response.error === 'string' ? response.error :
        (response.error && response.error.message),
      detail
    ].filter(Boolean).join(' ').toLowerCase();
    var failed = status === 'error' || status === 'not_found' ||
      status === 'failed' || httpStatus === 404 || httpStatus === 500;
    return failed &&
      /key not found|kv[^ ]* not found|ключ[^ ]* не найден/.test(message);
  }

  function _responseError(response) {
    if (!response || typeof response !== 'object') {
      return 'managed KV returned no response';
    }
    var status = String(response.status || '').toLowerCase();
    if (status !== 'error' && status !== 'failed' &&
        status !== 'not_found') {
      return '';
    }
    return String(
      response.message ||
      (typeof response.error === 'string' ? response.error :
        (response.error && response.error.message)) ||
      'managed KV read failed'
    );
  }

  function _value(response) {
    if (_isMissing(response)) return null;
    var responseError = _responseError(response);
    if (responseError) {
      throw _error(
        'PRODUCTION_STANDARDS_KV_READ_FAILED',
        responseError
      );
    }
    var value = response && (
      response.value != null ? response.value :
      (response.kv_value != null ? response.kv_value :
        (response.result && response.result.value != null ?
          response.result.value : null))
    );
    if (value == null || value === '') return null;
    if (typeof value === 'string') {
      try {
        value = JSON.parse(value);
      } catch (_) {
        throw _error(
          'PRODUCTION_STANDARDS_KV_INVALID',
          'managed KV production standards bundle is not valid JSON'
        );
      }
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw _error(
        'PRODUCTION_STANDARDS_KV_INVALID',
        'managed KV production standards bundle must be an object'
      );
    }
    return value;
  }

  function _rawValue(response) {
    if (_isMissing(response)) return null;
    var responseError = _responseError(response);
    if (responseError) {
      throw _error(
        'PRODUCTION_STANDARDS_KV_READ_FAILED',
        responseError
      );
    }
    var value = response && (
      response.value != null ? response.value :
      (response.kv_value != null ? response.kv_value :
        (response.result && response.result.value != null ?
          response.result.value : null))
    );
    return value == null ? null : value;
  }

  function _chunkKey(bundleSha256, index) {
    return BUNDLE_KEY + ':chunk:' + bundleSha256.slice(0, 20) + ':' +
      String(index);
  }

  function _byteLength(value) {
    if (typeof TextEncoder === 'undefined') {
      throw _error(
        'PRODUCTION_STANDARDS_CHUNK_INVALID',
        'TextEncoder is required to verify the managed KV standards bundle'
      );
    }
    return new TextEncoder().encode(String(value || '')).length;
  }

  function _mapLimit(items, limit, worker) {
    var output = new Array(items.length);
    var next = 0;
    function consume() {
      if (next >= items.length) return Promise.resolve();
      var index = next;
      next += 1;
      return Promise.resolve().then(function () {
        return worker(items[index], index);
      }).then(function (value) {
        output[index] = value;
        return consume();
      });
    }
    var workers = [];
    var count = Math.min(limit, items.length);
    while (workers.length < count) workers.push(consume());
    return Promise.all(workers).then(function () { return output; });
  }

  function _hydrateManifest(manifest, ownerAgentId, actorId) {
    var keys = Object.keys(manifest || {}).sort();
    var expectedKeys = [
      'bundle_byte_length',
      'bundle_sha256',
      'chunk_count',
      'encoding',
      'owner_account_id',
      'schema'
    ].sort();
    var hash = String(manifest && manifest.bundle_sha256 || '');
    var chunkCount = Number(manifest && manifest.chunk_count);
    var byteLength = Number(manifest && manifest.bundle_byte_length);
    if (ETB.evolutionConsole.canonical(keys) !==
          ETB.evolutionConsole.canonical(expectedKeys) ||
        manifest.schema !== MANIFEST_SCHEMA ||
        manifest.encoding !== CHUNK_ENCODING ||
        String(manifest.owner_account_id || '') !== actorId ||
        !/^[a-f0-9]{64}$/.test(hash) ||
        !Number.isInteger(chunkCount) || chunkCount < 1 ||
        chunkCount > MAX_CHUNKS ||
        !Number.isInteger(byteLength) || byteLength < 2 ||
        byteLength > MAX_BUNDLE_BYTES) {
      return Promise.reject(_error(
        'PRODUCTION_STANDARDS_MANIFEST_INVALID',
        'managed KV production standards manifest is invalid'
      ));
    }
    var indexes = [];
    var index;
    for (index = 0; index < chunkCount; index += 1) indexes.push(index);
    return _mapLimit(indexes, READ_CONCURRENCY, function (position) {
      _assertActor(actorId);
      return ETB.api.kvGet(
        _chunkKey(hash, position),
        { agentId: ownerAgentId }
      ).then(function (response) {
        _assertActor(actorId);
        var part = _rawValue(response);
        if (typeof part !== 'string' || !part.length) {
          throw _error(
            'PRODUCTION_STANDARDS_CHUNK_MISSING',
            'managed KV production standards chunk is missing'
          );
        }
        return part;
      });
    }).then(function (parts) {
      var canonicalBundle = parts.join('');
      var bundle;
      if (_byteLength(canonicalBundle) !== byteLength) {
        throw _error(
          'PRODUCTION_STANDARDS_CHUNK_INVALID',
          'managed KV production standards byte length does not match'
        );
      }
      try {
        bundle = JSON.parse(canonicalBundle);
      } catch (_) {
        throw _error(
          'PRODUCTION_STANDARDS_CHUNK_INVALID',
          'managed KV production standards chunks are not valid JSON'
        );
      }
      if (ETB.evolutionConsole.canonical(bundle) !== canonicalBundle) {
        throw _error(
          'PRODUCTION_STANDARDS_CHUNK_INVALID',
          'managed KV production standards chunks are not canonical JSON'
        );
      }
      return ETB.evolutionConsole.sha256(bundle).then(function (
        actualHash
      ) {
        if (actualHash !== hash) {
          throw _error(
            'PRODUCTION_STANDARDS_CHUNK_INVALID',
            'managed KV production standards bundle SHA-256 does not match'
          );
        }
        return bundle;
      });
    });
  }

  function _readBundle(ownerAgentId, actorId) {
    _assertActor(actorId);
    return ETB.api.kvGet(
      BUNDLE_KEY,
      { agentId: ownerAgentId }
    ).then(function (response) {
      _assertActor(actorId);
      var value = _value(response);
      if (!value) return null;
      if (value.schema === MANIFEST_SCHEMA) {
        return _hydrateManifest(value, ownerAgentId, actorId);
      }
      return value;
    });
  }

  function loadForActor(request) {
    request = request || {};
    var actorId = String(request.actorId || '').trim();
    var ids;
    if (!actorId || actorId.length > 240) {
      return Promise.reject(_error(
        'PRODUCTION_STANDARDS_ACTOR_REQUIRED',
        'production standards provider requires an exact authenticated actor'
      ));
    }
    try {
      _assertActor(actorId);
      ids = _exactIds(request.platformAgentIds);
    } catch (error) {
      return Promise.reject(error);
    }
    var remembered = _ownerLoad(actorId);
    if (remembered && ids.indexOf(remembered) !== -1) {
      ids = [remembered].concat(ids.filter(function (id) {
        return id !== remembered;
      }));
    }
    return _mapLimit(ids, READ_CONCURRENCY, function (id) {
      return _readBundle(id, actorId).then(function (bundle) {
        if (!bundle) return null;
        if (String(bundle.owner_account_id || '') !== actorId) {
          throw _error(
            'PRODUCTION_STANDARDS_ACCOUNT_MISMATCH',
            'managed KV production standards bundle belongs to another account'
          );
        }
        if (bundle.data_mode !== 'PRODUCTION' ||
            bundle.delivery_mode !== 'ACCOUNT_SCOPED_HOST_PROVIDER') {
          throw _error(
            'PRODUCTION_STANDARDS_KV_INVALID',
            'managed KV contains no eligible PRODUCTION standards bundle'
          );
        }
        return { ownerAgentId: id, bundle: bundle };
      });
    }).then(function (rows) {
      _assertActor(actorId);
      var found = rows.filter(Boolean);
      if (!found.length) {
        throw _error(
          'PRODUCTION_STANDARDS_UNAVAILABLE',
          'no prebuilt production Agent Passport bundle exists in the exact live fleet managed KV'
        );
      }
      var canonical = ETB.evolutionConsole.canonical(found[0].bundle);
      if (found.some(function (row) {
        return ETB.evolutionConsole.canonical(row.bundle) !== canonical;
      })) {
        throw _error(
          'PRODUCTION_STANDARDS_MULTIPLE_BUNDLES',
          'the exact live fleet contains conflicting production Agent Passport bundles'
        );
      }
      _ownerSave(actorId, found[0].ownerAgentId);
      return found[0].bundle;
    });
  }

  return {
    BUNDLE_KEY: BUNDLE_KEY,
    MANIFEST_SCHEMA: MANIFEST_SCHEMA,
    CHUNK_ENCODING: CHUNK_ENCODING,
    loadForActor: loadForActor
  };
})();
