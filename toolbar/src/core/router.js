// ── ROUTER MODULE ──────────────────────────────────────────────────────────
// Opens plugin UIs: inline iframe panel, external URL, or plugin chat.
// Panels are kept alive in an LRU cache (up to CACHE_MAX entries) so that
// navigating away and back preserves the full iframe state (chat history,
// scroll position, in-flight requests, etc.).
//
// Exposes: ETB.router.open(plugin), ETB.router.close(), ETB.router.isOpen()

ETB.router = (function () {
  var CACHE_MAX = 5; // max live panels in DOM simultaneously
  var STUDIO_GOV_SESSION_KEY = 'etb_capability_studio_governance_v1';
  var AGENT_CONTROL_LEDGER_KEY = 'xtl_agent_control:profitability_governance_v1';
  var AGENT_CONTROL_INDEX_SCHEMA = 'agent-control-index.v1';
  var AGENT_CONTROL_SHARD_SCHEMA = 'agent-control-shard.v1';
  var AGENT_CONTROL_CHUNK_SCHEMA = 'agent-control-chunk.v1';
  var AGENT_CONTROL_CHUNK_ENCODING = 'canonical-json-chunks.v1';
  var AGENT_CONTROL_MAX_SHARD_BYTES = 13000;
  var AGENT_CONTROL_CHUNK_CHARS = 2400;
  var AGENT_CONTROL_MAX_CHUNKS = 64;
  var STUDIO_HOST_INSTANCE = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  var _studioCleanupTimer = null;
  var _studioOperationChains = {};
  var _agentControlOperationChains = {};
  var _agentControlSessionEpoch = 0;
  var _agentControlRunSequence = 0;

  // cache entry: { panel, blobUrl, lastUsed (ms timestamp) }
  var _cache = {};
  var _activeId = null; // pluginId of currently visible panel
  // Bounded auto-start attempts per plugin — hard stop against any restart loop
  // (a start expert is a deferred task; re-triggering it in a cycle would spam it).
  var _autoTries = {};

  function _studioMarkerValid(marker) {
    return /^XTL-STUDIO-GOV-[A-Z0-9_-]{8,64}$/.test(String(marker || '').toUpperCase());
  }

  function _studioBoundedNumber(value, fallback, minimum, maximum) {
    var parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(minimum, Math.min(parsed, maximum));
  }

  function _studioCurrentUserId() {
    try { return String(ETB.auth.getUserId() || ''); } catch (_) { return ''; }
  }

  function _studioSessionAccountValid(session) {
    var currentUserId = _studioCurrentUserId();
    return Boolean(
      session &&
      session.userId &&
      currentUserId &&
      String(session.userId) === currentUserId
    );
  }

  function _studioSessionLoad() {
    try {
      var session = JSON.parse(localStorage.getItem(STUDIO_GOV_SESSION_KEY) || 'null');
      if (!session || !_studioMarkerValid(session.marker) || !session.ownerAgentId || !session.userId) return null;
      return session;
    } catch (_) { return null; }
  }

  function _studioSessionSave(session) {
    try { localStorage.setItem(STUDIO_GOV_SESSION_KEY, JSON.stringify(session)); } catch (_) {}
    if (_studioCleanupTimer) clearTimeout(_studioCleanupTimer);
    _studioCleanupTimer = setTimeout(function () {
      var current = _studioSessionLoad();
      if (current) _studioConfirmedCleanup(current).catch(function () {});
    }, 10 * 60 * 1000);
  }

  function _studioSessionClear(marker) {
    try {
      var current = _studioSessionLoad();
      var shouldClear = !current || !marker || current.marker === marker;
      if (shouldClear) localStorage.removeItem(STUDIO_GOV_SESSION_KEY);
      if (shouldClear && _studioCleanupTimer) {
        clearTimeout(_studioCleanupTimer);
        _studioCleanupTimer = null;
      }
    } catch (_) {}
  }

  function _studioApiOk(response, label) {
    if (!response || response.detail || response.error ||
        response.status === 'error' || response.status === 'not_found' ||
        response.status === 'failed') {
      var detail = response && response.detail;
      if (Array.isArray(detail)) detail = detail.map(function (row) {
        return row && (row.msg || row.message) || String(row);
      }).join('; ');
      throw new Error(detail || (response && (response.message || response.error)) || (label + ' failed'));
    }
    return response;
  }

  function _studioConceptRows(response) {
    return (response && (response.results || response.concepts)) || [];
  }

  function _studioRuleRows(response) {
    return (response && (response.results || response.rules)) || [];
  }

  function _studioConceptText(row) {
    return String((row && (row.text || row.concept_text)) || '');
  }

  function _studioRuleText(row) {
    return String((row && row.rule) || '');
  }

  function _studioObjectId(row) {
    return row && (row.id != null ? row.id : (row.concept_id != null ? row.concept_id : row.rule_id));
  }

  // Serialize every governance mutation and cleanup for a marker. Closing the
  // panel while an operation is in flight must not leave a late global object.
  function _studioSerialize(marker, task) {
    var key = String(marker || '').toUpperCase();
    if (!_studioMarkerValid(key)) return Promise.reject(new Error('invalid studio operation marker'));
    var previous = _studioOperationChains[key] || Promise.resolve();
    var operation = previous.catch(function () {}).then(task);
    var tail = operation.catch(function () {});
    _studioOperationChains[key] = tail;
    tail.then(function () {
      if (_studioOperationChains[key] === tail) delete _studioOperationChains[key];
    });
    return operation;
  }

  // Absence is security-sensitive: scan every page instead of treating the
  // first 500 Concepts as the complete account-global namespace.
  function _studioListAllConcepts(opts) {
    opts = opts || {};
    var limit = 500;
    var maxPages = 200;
    function readPage(offset, collected, page) {
      if (page >= maxPages) return Promise.reject(new Error('concept pagination safety limit reached'));
      if (opts.context) _agentControlAssertContext(opts.context);
      return ETB.api.conceptListScoped({
        agentId: opts.agentId,
        global: opts.global === true,
        limit: limit,
        offset: offset
      }).then(function (response) {
        if (opts.context) _agentControlAssertContext(opts.context);
        _studioApiOk(response, 'concept list');
        var rows = _studioConceptRows(response);
        var next = offset + rows.length;
        var reportedTotal = Number(
          response && (response.total != null ? response.total :
            (response.total_count != null ? response.total_count : response.count))
        );
        var totalHasMore = Number.isFinite(reportedTotal) && reportedTotal > next;
        if (!rows.length) {
          if (totalHasMore) throw new Error('concept pagination ended before reported total');
          return collected;
        }
        var combined = collected.concat(rows);
        if (rows.length === limit || totalHasMore) return readPage(next, combined, page + 1);
        return combined;
      });
    }
    return readPage(0, [], 0);
  }

  function _agentControlContext(actorId, operationId) {
    return {
      actorId: String(actorId || ''),
      epoch: _agentControlSessionEpoch,
      operationId: String(operationId || ''),
      deadlineAt: Date.now() + 210000
    };
  }

  function _agentControlAssertContext(context, allowExpired) {
    if (!context) {
      var missingContextError = new Error(
        'authenticated Agent Control operation context is required'
      );
      missingContextError.code = 'ACCOUNT_CONTEXT_REQUIRED';
      throw missingContextError;
    }
    if (!context.actorId || context.epoch !== _agentControlSessionEpoch ||
        String(_studioCurrentUserId() || '') !== context.actorId) {
      var accountError = new Error(
        'authenticated account changed; Agent Control operation was fenced before commit'
      );
      accountError.code = 'ACCOUNT_SESSION_CHANGED';
      throw accountError;
    }
    if (!allowExpired && Date.now() > context.deadlineAt) {
      var deadlineError = new Error(
        'operation deadline exceeded; outcome is unknown until the ledger is reloaded'
      );
      deadlineError.code = 'OPERATION_OUTCOME_UNKNOWN';
      throw deadlineError;
    }
  }

  function _agentControlSerialize(ownerAgentId, context, task) {
    if (!String(ownerAgentId || '')) {
      return Promise.reject(new Error('control-plane owner agent is required'));
    }
    var key = String(context && context.actorId || '') + ':' +
      String(context && context.epoch || 0) + ':' + String(ownerAgentId || '');
    var previous = _agentControlOperationChains[key] || Promise.resolve();
    var operation = previous.catch(function () {}).then(function () {
      _agentControlAssertContext(context);
      return task();
    });
    var tail = operation.catch(function () {});
    _agentControlOperationChains[key] = tail;
    tail.then(function () {
      if (_agentControlOperationChains[key] === tail) {
        delete _agentControlOperationChains[key];
      }
    });
    return operation;
  }

  function _agentControlIsMissingKv(response) {
    if (!response || typeof response !== 'object') return false;
    var status = String(response.status || '').toLowerCase();
    var httpStatus = Number(response.httpStatus || response.statusCode || 0);
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
    var explicitFailure = status === 'error' || status === 'not_found' ||
      status === 'failed' || httpStatus === 404 || httpStatus === 500;
    return explicitFailure &&
      /key not found|kv[^ ]* not found|ключ[^ ]* не найден/.test(message);
  }

  function _agentControlByteLength(value) {
    if (typeof TextEncoder === 'undefined') {
      throw new Error('TextEncoder is required for verified control-plane storage');
    }
    return new TextEncoder().encode(String(value || '')).length;
  }

  function _agentControlReadJson(key, ownerAgentId, allowMissing, context, allowExpired) {
    _agentControlAssertContext(context, allowExpired === true);
    return ETB.api.kvGet(key, { agentId: ownerAgentId }).then(function (response) {
      _agentControlAssertContext(context, allowExpired === true);
      if (_agentControlIsMissingKv(response) && allowMissing) return null;
      _studioApiOk(response, 'control-plane KV read');
      var value = response && (response.value != null ? response.value :
        (response.kv_value != null ? response.kv_value :
          (response.result && response.result.value != null ? response.result.value : null)));
      if (value == null || value === '') throw new Error('control-plane KV value is empty');
      if (typeof value !== 'string') return value;
      try { return JSON.parse(value); }
      catch (_) { throw new Error('control-plane KV value is not valid JSON'); }
    });
  }

  function _agentControlWriteJson(key, value, ownerAgentId, description, context) {
    var expected = ETB.agentControl.canonical(value);
    var bytes = _agentControlByteLength(expected);
    var writeError = null;
    if (bytes > AGENT_CONTROL_MAX_SHARD_BYTES) {
      return Promise.reject(new Error(
        'control-plane shard exceeds ' + AGENT_CONTROL_MAX_SHARD_BYTES +
        ' bytes (' + bytes + '): ' + key
      ));
    }
    _agentControlAssertContext(context);
    return ETB.api.kvSet(
      key,
      expected,
      description || 'Extella Agent Control Center v1',
      { agentId: ownerAgentId }
    ).then(function (response) {
      // Once kvSet has returned, an exact read-back reconciles the outcome even
      // if the UI deadline elapsed while the request was in flight. Account
      // switching is never ignored.
      _agentControlAssertContext(context, true);
      try { _studioApiOk(response, 'control-plane KV write'); }
      catch (error) { writeError = error; }
      return _agentControlReadJson(key, ownerAgentId, false, context, true);
    }).then(function (readBack) {
      if (ETB.agentControl.canonical(readBack) !== expected) {
        var suffix = writeError && writeError.message ? ': ' + writeError.message : '';
        throw new Error('control-plane shard read-back mismatch' + suffix);
      }
      return readBack;
    });
  }

  function _agentControlWriteImmutableJson(
    key,
    value,
    ownerAgentId,
    description,
    context
  ) {
    var expected = ETB.agentControl.canonical(value);
    return _agentControlReadJson(key, ownerAgentId, true, context).then(function (existing) {
      if (existing) {
        if (ETB.agentControl.canonical(existing) !== expected) {
          var collisionError = new Error(
            'immutable control-plane shard collision: ' + key
          );
          collisionError.code = 'IMMUTABLE_SHARD_COLLISION';
          throw collisionError;
        }
        return existing;
      }
      return _agentControlWriteJson(
        key,
        value,
        ownerAgentId,
        description,
        context
      );
    });
  }

  function _agentControlShardKey(kind, id) {
    var safeKind = String(kind || '');
    var safeId = String(id || '');
    if (!/^(version|draft|testrun|run|ledger)$/.test(safeKind) ||
        !/^[A-Za-z0-9_-]{8,96}$/.test(safeId)) {
      throw new Error('invalid control-plane shard identity');
    }
    return AGENT_CONTROL_LEDGER_KEY + ':' + safeKind + ':' + safeId;
  }

  function _agentControlShard(kind, id, payload) {
    return {
      schemaVersion: AGENT_CONTROL_SHARD_SCHEMA,
      kind: kind,
      id: id,
      payload: payload
    };
  }

  function _agentControlChunkKey(kind, id, payloadSha256, index) {
    _agentControlShardKey(kind, id);
    var hash = String(payloadSha256 || '');
    var position = Number(index);
    if (!/^[a-f0-9]{64}$/.test(hash) ||
        !Number.isInteger(position) || position < 0 || position >= AGENT_CONTROL_MAX_CHUNKS) {
      throw new Error('invalid control-plane chunk identity');
    }
    return AGENT_CONTROL_LEDGER_KEY + ':chunk:' + kind + ':' + id + ':' +
      hash.slice(0, 20) + ':' + position;
  }

  function _agentControlChunkPayload(canonicalPayload) {
    var chunks = [];
    var text = String(canonicalPayload || '');
    for (var offset = 0; offset < text.length; offset += AGENT_CONTROL_CHUNK_CHARS) {
      chunks.push(text.slice(offset, offset + AGENT_CONTROL_CHUNK_CHARS));
    }
    if (!chunks.length) chunks.push('');
    if (chunks.length > AGENT_CONTROL_MAX_CHUNKS) {
      throw new Error('control-plane payload exceeds bounded chunk count');
    }
    return chunks;
  }

  function _agentControlPrepareShard(shard) {
    var directBytes = _agentControlByteLength(ETB.agentControl.canonical(shard.value));
    if (directBytes <= AGENT_CONTROL_MAX_SHARD_BYTES) {
      return Promise.resolve([shard]);
    }
    var payloadCanonical = ETB.agentControl.canonical(shard.value.payload);
    var parts;
    try { parts = _agentControlChunkPayload(payloadCanonical); }
    catch (error) { return Promise.reject(error); }
    return ETB.agentControl.sha256(payloadCanonical).then(function (payloadSha256) {
      var total = parts.length;
      var chunkRows = parts.map(function (data, index) {
        return {
          key: _agentControlChunkKey(
            shard.value.kind,
            shard.value.id,
            payloadSha256,
            index
          ),
          value: {
            schemaVersion: AGENT_CONTROL_CHUNK_SCHEMA,
            parentKind: shard.value.kind,
            parentId: shard.value.id,
            payloadSha256: payloadSha256,
            index: index,
            total: total,
            data: data
          }
        };
      });
      chunkRows.push({
        key: shard.key,
        value: {
          schemaVersion: AGENT_CONTROL_SHARD_SCHEMA,
          kind: shard.value.kind,
          id: shard.value.id,
          payloadEncoding: AGENT_CONTROL_CHUNK_ENCODING,
          payloadSha256: payloadSha256,
          payloadByteLength: _agentControlByteLength(payloadCanonical),
          chunkRefs: chunkRows.map(function (row) { return row.key; })
        }
      });
      return chunkRows;
    });
  }

  function _agentControlReadShard(
    key,
    ownerAgentId,
    kind,
    id,
    context,
    allowExpired
  ) {
    return _agentControlReadJson(
      key,
      ownerAgentId,
      false,
      context,
      allowExpired === true
    ).then(function (shard) {
      if (!shard || shard.schemaVersion !== AGENT_CONTROL_SHARD_SCHEMA ||
          shard.kind !== kind || shard.id !== id) {
        throw new Error('control-plane shard envelope mismatch');
      }
      if (Object.prototype.hasOwnProperty.call(shard, 'payload')) {
        if (shard.payloadEncoding || shard.chunkRefs) {
          throw new Error('ambiguous control-plane shard envelope');
        }
        return shard.payload;
      }
      if (shard.payloadEncoding !== AGENT_CONTROL_CHUNK_ENCODING ||
          !/^[a-f0-9]{64}$/.test(String(shard.payloadSha256 || '')) ||
          !Array.isArray(shard.chunkRefs) || !shard.chunkRefs.length ||
          shard.chunkRefs.length > AGENT_CONTROL_MAX_CHUNKS ||
          !Number.isInteger(shard.payloadByteLength) || shard.payloadByteLength < 0) {
        throw new Error('invalid chunked control-plane shard');
      }
      var total = shard.chunkRefs.length;
      return Promise.all(shard.chunkRefs.map(function (ref, index) {
        var expectedRef = _agentControlChunkKey(kind, id, shard.payloadSha256, index);
        if (String(ref || '') !== expectedRef) {
          throw new Error('control-plane chunk reference mismatch');
        }
        return _agentControlReadJson(
          expectedRef,
          ownerAgentId,
          false,
          context,
          allowExpired === true
        ).then(function (chunk) {
          if (!chunk || chunk.schemaVersion !== AGENT_CONTROL_CHUNK_SCHEMA ||
              chunk.parentKind !== kind || chunk.parentId !== id ||
              chunk.payloadSha256 !== shard.payloadSha256 ||
              chunk.index !== index || chunk.total !== total ||
              typeof chunk.data !== 'string') {
            throw new Error('control-plane chunk envelope mismatch');
          }
          return chunk.data;
        });
      })).then(function (parts) {
        var payloadCanonical = parts.join('');
        if (_agentControlByteLength(payloadCanonical) !== shard.payloadByteLength) {
          throw new Error('control-plane chunked payload length mismatch');
        }
        return ETB.agentControl.sha256(payloadCanonical).then(function (payloadSha256) {
          var payload;
          if (payloadSha256 !== shard.payloadSha256) {
            throw new Error('control-plane chunked payload hash mismatch');
          }
          try { payload = JSON.parse(payloadCanonical); }
          catch (_) { throw new Error('control-plane chunked payload is not valid JSON'); }
          if (ETB.agentControl.canonical(payload) !== payloadCanonical) {
            throw new Error('control-plane chunked payload is not canonical');
          }
          return payload;
        });
      });
    });
  }

  function _agentControlDehydrate(ledger) {
    var skeleton = JSON.parse(ETB.agentControl.canonical(ledger));
    var shards = [];
    Object.keys(skeleton.versions || {}).forEach(function (versionId) {
      var version = skeleton.versions[versionId];
      var ref = _agentControlShardKey('version', versionId);
      shards.push({ key: ref, value: _agentControlShard('version', versionId, version.bundle) });
      delete version.bundle;
      version.bundleRef = ref;
    });
    Object.keys(skeleton.drafts || {}).forEach(function (draftId) {
      var draft = skeleton.drafts[draftId];
      if (!draft.candidateBundle) return;
      var ref = _agentControlShardKey('draft', draftId);
      shards.push({ key: ref, value: _agentControlShard('draft', draftId, draft.candidateBundle) });
      delete draft.candidateBundle;
      draft.candidateBundleRef = ref;
    });
    Object.keys(skeleton.testRuns || {}).forEach(function (testRunId) {
      var testRun = skeleton.testRuns[testRunId];
      var ref = _agentControlShardKey('testrun', testRunId);
      shards.push({ key: ref, value: _agentControlShard('testrun', testRunId, testRun) });
      skeleton.testRuns[testRunId] = {
        id: testRun.id,
        status: testRun.status,
        draftId: testRun.draftId,
        candidateVersionId: testRun.candidateVersionId,
        candidateBundleSha256: testRun.candidateBundleSha256,
        receiptSha256: testRun.receiptSha256,
        payloadRef: ref
      };
    });
    Object.keys(skeleton.runs || {}).forEach(function (runId) {
      var run = skeleton.runs[runId];
      var ref = _agentControlShardKey('run', runId);
      shards.push({ key: ref, value: _agentControlShard('run', runId, run) });
      skeleton.runs[runId] = {
        id: run.id,
        status: run.status,
        agentId: run.agentId,
        configurationVersionId: run.configurationVersionId,
        payloadRef: ref
      };
    });
    return ETB.agentControl.sha256(ledger).then(function (ledgerHash) {
      var stateId = 'state_' + ledgerHash.slice(0, 24);
      var stateRef = _agentControlShardKey('ledger', stateId);
      shards.push({
        key: stateRef,
        value: _agentControlShard('ledger', stateId, skeleton)
      });
      return {
        shards: shards,
        index: {
          schemaVersion: AGENT_CONTROL_INDEX_SCHEMA,
          ownerAgentId: ledger.ownerAgentId,
          ownerAccountId: ledger.ownerAccountId,
          ledgerSha256: ledgerHash,
          ledgerStateId: stateId,
          ledgerStateRef: stateRef,
          baselineVersionId: ledger.baselineVersionId,
          activeVersionByAgent: JSON.parse(
            ETB.agentControl.canonical(ledger.activeVersionByAgent)
          ),
          currentDraftId: ledger.currentDraftId,
          currentTestRunId: ledger.currentTestRunId,
          currentRunId: ledger.currentRunId
        }
      };
    });
  }

  function _agentControlHydrate(index, ownerAgentId, context, allowExpired) {
    if (!index || index.schemaVersion !== AGENT_CONTROL_INDEX_SCHEMA ||
        String(index.ownerAgentId || '') !== String(ownerAgentId || '') ||
        String(index.ownerAccountId || '') !== String(context.actorId || '') ||
        !/^[a-f0-9]{64}$/.test(String(index.ledgerSha256 || '')) ||
        !index.ledgerStateId || !index.ledgerStateRef) {
      return Promise.reject(new Error('invalid control-plane ledger index'));
    }
    var expectedStateRef;
    try {
      expectedStateRef = _agentControlShardKey('ledger', index.ledgerStateId);
    } catch (error) {
      return Promise.reject(error);
    }
    if (String(index.ledgerStateRef || '') !== expectedStateRef) {
      return Promise.reject(new Error('control-plane ledger state reference mismatch'));
    }
    return _agentControlReadShard(
      expectedStateRef,
      ownerAgentId,
      'ledger',
      index.ledgerStateId,
      context,
      allowExpired === true
    ).then(function (storedLedger) {
      return _agentControlHydrateState(
        storedLedger,
        index,
        ownerAgentId,
        context,
        allowExpired === true
      );
    });
  }

  function _agentControlHydrateState(
    storedLedger,
    index,
    ownerAgentId,
    context,
    allowExpired
  ) {
    var ledger = JSON.parse(ETB.agentControl.canonical(storedLedger));
    var refs = [];
    function addRef(ref, kind, id, apply) {
      var value = String(ref || '');
      if (value !== _agentControlShardKey(kind, id)) {
        throw new Error('control-plane shard reference mismatch');
      }
      refs.push({ key: value, kind: kind, id: id, apply: apply });
    }
    try {
      Object.keys(ledger.versions || {}).forEach(function (versionId) {
        var entry = ledger.versions[versionId];
        addRef(entry.bundleRef, 'version', versionId, function (payload) {
          entry.bundle = payload;
          delete entry.bundleRef;
        });
      });
      Object.keys(ledger.drafts || {}).forEach(function (draftId) {
        var entry = ledger.drafts[draftId];
        if (!entry.candidateBundleRef) return;
        addRef(entry.candidateBundleRef, 'draft', draftId, function (payload) {
          entry.candidateBundle = payload;
          delete entry.candidateBundleRef;
        });
      });
      Object.keys(ledger.testRuns || {}).forEach(function (testRunId) {
        var entry = ledger.testRuns[testRunId];
        addRef(entry.payloadRef, 'testrun', testRunId, function (payload) {
          ledger.testRuns[testRunId] = payload;
        });
      });
      Object.keys(ledger.runs || {}).forEach(function (runId) {
        var entry = ledger.runs[runId];
        addRef(entry.payloadRef, 'run', runId, function (payload) {
          ledger.runs[runId] = payload;
        });
      });
    } catch (error) {
      return Promise.reject(error);
    }
    return Promise.all(refs.map(function (ref) {
      return _agentControlReadShard(
        ref.key,
        ownerAgentId,
        ref.kind,
        ref.id,
        context,
        allowExpired === true
      ).then(function (payload) {
        ref.apply(payload);
      });
    })).then(function () {
      return ETB.agentControl.sha256(ledger);
    }).then(function (ledgerHash) {
      if (ledgerHash !== index.ledgerSha256) {
        throw new Error('control-plane hydrated ledger hash mismatch');
      }
      ETB.agentControl.validateLedger(ledger);
      if (String(ledger.ownerAgentId || '') !== String(ownerAgentId || '')) {
        throw new Error('control-plane ledger owner mismatch');
      }
      if (String(ledger.ownerAccountId || '') !== String(context.actorId || '')) {
        throw new Error('control-plane ledger account mismatch');
      }
      if (ETB.agentControl.canonical(ledger.activeVersionByAgent) !==
          ETB.agentControl.canonical(index.activeVersionByAgent) ||
          ledger.baselineVersionId !== index.baselineVersionId ||
          ledger.currentDraftId !== index.currentDraftId ||
          ledger.currentTestRunId !== index.currentTestRunId ||
          ledger.currentRunId !== index.currentRunId) {
        throw new Error('control-plane active pointer index mismatch');
      }
      return ledger;
    });
  }

  function _agentControlReadLedger(ownerAgentId, context, allowExpired) {
    if (!ETB.agentControl) {
      return Promise.reject(new Error('agent control core is unavailable'));
    }
    _agentControlAssertContext(context, allowExpired === true);
    return _agentControlReadJson(
      AGENT_CONTROL_LEDGER_KEY,
      ownerAgentId,
      true,
      context,
      allowExpired === true
    )
      .then(function (stored) {
        if (!stored) return null;
        // Pre-index ledgers from this feature branch are accepted only when
        // their account binding is already explicit and exact.
        if (stored.schemaVersion === ETB.agentControl.SCHEMA_VERSION) {
          ETB.agentControl.validateLedger(stored);
          if (String(stored.ownerAgentId || '') !== String(ownerAgentId || '') ||
              String(stored.ownerAccountId || '') !== String(context.actorId || '')) {
            throw new Error('control-plane ledger owner mismatch');
          }
          return stored;
        }
        return _agentControlHydrate(
          stored,
          ownerAgentId,
          context,
          allowExpired === true
        );
      });
  }

  function _agentControlWriteLedger(ownerAgentId, ledger, context) {
    if (!ETB.agentControl) {
      return Promise.reject(new Error('agent control core is unavailable'));
    }
    _agentControlAssertContext(context);
    ETB.agentControl.validateLedger(ledger);
    if (String(ledger.ownerAgentId || '') !== String(ownerAgentId || '') ||
        String(ledger.ownerAccountId || '') !== String(context.actorId || '')) {
      return Promise.reject(new Error('control-plane ledger owner/account mismatch'));
    }
    var expected = ETB.agentControl.canonical(ledger);
    return _agentControlDehydrate(ledger).then(function (stored) {
      _agentControlAssertContext(context);
      // Immutable candidate/evidence/state shards are written and verified
      // first. Within a chunked shard, content chunks land before its manifest.
      // The final single root-index write is the managed active-pointer commit.
      return Promise.all(stored.shards.map(_agentControlPrepareShard)).then(function (rows) {
        return Promise.all(rows.map(function (items) {
          return items.reduce(function (chain, shard) {
            return chain.then(function () {
              return _agentControlWriteImmutableJson(
                shard.key,
                shard.value,
                ownerAgentId,
                'Extella Agent Control Center v1 — immutable verified shard',
                context
              );
            });
          }, Promise.resolve());
        }));
      }).then(function () {
        _agentControlAssertContext(context);
        return _agentControlWriteJson(
          AGENT_CONTROL_LEDGER_KEY,
          stored.index,
          ownerAgentId,
          'Extella Agent Control Center v1 — active pointer index',
          context
        );
      });
    }).then(function () {
      // Reconcile the exact committed root and all referenced immutable data.
      // Deadline expiry is allowed only here; account/epoch fencing remains.
      return _agentControlReadLedger(ownerAgentId, context, true);
    }).then(function (readBack) {
      if (!readBack || ETB.agentControl.canonical(readBack) !== expected) {
        throw new Error('control-plane sharded ledger read-back mismatch');
      }
      return readBack;
    });
  }

  function _agentControlAgentRows(response) {
    if (Array.isArray(response)) return response;
    return (response && (response.agents || response.results || response.items)) || [];
  }

  function _agentControlAgentId(row) {
    return String((row && (row.id || row.agent_id)) || '');
  }

  function _agentControlSlimAgent(row) {
    var id = _agentControlAgentId(row);
    var provider = String((row && row.provider) || '');
    var model = String((row && row.model) || '');
    var providerKey = provider.trim().toLowerCase();
    var modelKey = model.trim().toLowerCase();
    var providerAlibaba = /(alibaba|aliyun|dashscope)/.test(providerKey);
    var modelQwen = /qwen/.test(modelKey);
    var forbidden = /(claude|anthropic)/.test(providerKey + ' ' + modelKey);
    var qwenConfirmed = !forbidden && providerAlibaba && modelQwen;
    return {
      id: id,
      name: String((row && (row.name || row.agent_name)) || id),
      provider: provider,
      model: model,
      category: String((row && row.category) || ''),
      role: String((row && row.role) || ''),
      eligible: Boolean(id && qwenConfirmed),
      eligibility: forbidden ? 'ANTHROPIC_FORBIDDEN' :
        (qwenConfirmed ? 'QWEN_PROVIDER_MODEL_CONFIRMED' :
          'QWEN_PROVIDER_MODEL_NOT_CONFIRMED')
    };
  }

  function _agentControlApiRead(context, task) {
    _agentControlAssertContext(context);
    return Promise.resolve().then(task).then(function (response) {
      _agentControlAssertContext(context);
      return response;
    });
  }

  function _agentControlVerifyExactAgent(agent, context) {
    return _agentControlApiRead(context, function () {
      return ETB.api.agentGetScoped(agent.id);
    }).then(function (response) {
      _studioApiOk(response, 'agent identity verification');
      var detail = (response && response.agent) || response || {};
      var exact = _agentControlSlimAgent(detail);
      if (!exact.id || exact.id !== agent.id) {
        throw new Error('agent/get identity does not match the requested agent id');
      }
      if (!exact.eligible) {
        throw new Error('agent/get must confirm a Qwen model on the Alibaba provider');
      }
      return exact;
    });
  }

  function _agentControlLoadAgents(requestedIds, context) {
    var requested = (requestedIds || []).map(String);
    return _agentControlApiRead(context, function () {
      return ETB.api.agentsList();
    }).then(function (response) {
      _studioApiOk(response, 'agents list');
      var agents = _agentControlAgentRows(response).map(_agentControlSlimAgent)
        .filter(function (agent) { return Boolean(agent.id); });
      if (!requested.length) return agents;
      var selected = requested.map(function (id) {
        return agents.filter(function (agent) { return agent.id === id; })[0] || null;
      });
      if (selected.some(function (agent) { return !agent; })) {
        throw new Error('one or more selected agents are not present in this account');
      }
      if (selected.some(function (agent) { return !agent.eligible; })) {
        throw new Error('selected agents must be confirmed Qwen/Alibaba agents');
      }
      if (new Set(requested).size !== requested.length) {
        throw new Error('selected agent ids must be distinct');
      }
      return Promise.all(selected.map(function (agent) {
        return _agentControlVerifyExactAgent(agent, context);
      }));
    });
  }

  function _agentControlRows(response, keys) {
    if (Array.isArray(response)) return response;
    for (var i = 0; i < keys.length; i++) {
      if (response && Array.isArray(response[keys[i]])) return response[keys[i]];
    }
    return [];
  }

  function _agentControlPreview(value, limit) {
    var compact = String(value || '').replace(/\s+/g, ' ').trim();
    var max = limit || 180;
    var sensitive = /(?:bearer\s+[A-Za-z0-9._~+/=-]{8,}|(?:api[_ -]?key|access[_ -]?token|secret|password|парол(?:ь|я))\s*[:=]\s*\S{4,}|sk-[A-Za-z0-9_-]{12,}|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\+?\d[\d\s().-]{8,}\d)/i;
    if (sensitive.test(compact)) {
      return '[СКРЫТО: возможный секрет или ПДн; в снимке сохранён только SHA-256]';
    }
    return compact.length > max ? compact.slice(0, max - 1) + '…' : compact;
  }

  function _agentControlInspectOne(agent, context) {
    var managedKnowledgeText =
      'Фактическая маржа учитывает себестоимость, возвраты, комиссии, логистику и рекламу.';
    return Promise.all([
      _agentControlApiRead(context, function () {
        return ETB.api.agentGetScoped(agent.id);
      }),
      _studioListAllConcepts({
        agentId: agent.id,
        global: false,
        context: context
      }),
      _studioListAllConcepts({
        agentId: agent.id,
        global: true,
        context: context
      }),
      _agentControlApiRead(context, function () {
        return ETB.api.ruleListScoped({ agentId: agent.id, global: false });
      }),
      _agentControlApiRead(context, function () {
        return ETB.api.ruleListScoped({ agentId: agent.id, global: true });
      }),
      _agentControlApiRead(context, function () {
        return ETB.api.expertsListScoped({ agentId: agent.id, global: true });
      })
    ]).then(function (responses) {
      _studioApiOk(responses[0], 'agent snapshot');
      _studioApiOk(responses[3], 'agent-local rule list');
      _studioApiOk(responses[4], 'account-global rule list');
      _studioApiOk(responses[5], 'expert list');
      var detail = (responses[0] && responses[0].agent) || responses[0] || {};
      var verifiedDetail = _agentControlSlimAgent(detail);
      if (!verifiedDetail.id || verifiedDetail.id !== agent.id) {
        throw new Error('agent snapshot identity does not match the requested agent id');
      }
      if (!verifiedDetail.eligible) {
        throw new Error('agent snapshot must confirm a Qwen model on the Alibaba provider');
      }
      var conceptsLocal = responses[1];
      var conceptsGlobal = responses[2];
      var rulesLocal = _agentControlRows(
        responses[3],
        ['results', 'rules', 'items']
      );
      var rulesGlobal = _agentControlRows(
        responses[4],
        ['results', 'rules', 'items']
      );
      var experts = _agentControlRows(
        responses[5],
        ['results', 'experts', 'items']
      );
      var exactAgent = {
        id: agent.id,
        name: verifiedDetail.name,
        provider: verifiedDetail.provider,
        model: verifiedDetail.model,
        category: verifiedDetail.category,
        role: String(detail.role || detail.category || agent.role || ''),
        instructions: String(detail.instructions || ''),
        tools: Array.isArray(detail.tools) ? detail.tools.map(String) : [],
        modelParameters: detail.model_parameters || detail.modelParameters || null
      };
      function exactConcept(row, scope) {
        var nativeId = String(
          _studioObjectId(row) == null ? '' : _studioObjectId(row)
        );
        return {
          id: scope + ':' + nativeId,
          nativeId: nativeId,
          scope: scope,
          text: _studioConceptText(row)
        };
      }
      function exactRule(row, scope) {
        var nativeId = String(
          _studioObjectId(row) == null ? '' : _studioObjectId(row)
        );
        return {
          id: scope + ':' + nativeId,
          nativeId: nativeId,
          scope: scope,
          text: _studioRuleText(row)
        };
      }
      var exactConceptsLocal = conceptsLocal.map(function (row) {
        return exactConcept(row, 'agent');
      }).filter(function (row) { return Boolean(row.nativeId); });
      var exactConceptsGlobal = conceptsGlobal.map(function (row) {
        return exactConcept(row, 'account_global');
      }).filter(function (row) { return Boolean(row.nativeId); });
      var exactRulesLocal = rulesLocal.map(function (row) {
        return exactRule(row, 'agent');
      }).filter(function (row) { return Boolean(row.nativeId); });
      var exactRulesGlobal = rulesGlobal.map(function (row) {
        return exactRule(row, 'account_global');
      }).filter(function (row) { return Boolean(row.nativeId); });
      var exactConcepts = exactConceptsLocal.concat(exactConceptsGlobal);
      var exactRules = exactRulesLocal.concat(exactRulesGlobal);
      var exactExperts = experts.map(function (row) {
        return {
          name: String((row && (row.name || row.expert_name)) || ''),
          description: String((row && (row.description || row.expert_description)) || ''),
          code: String((row && (row.code || row.expert_code)) || '')
        };
      }).filter(function (row) { return Boolean(row.name); });
      var seenExperts = {};
      exactExperts = exactExperts.filter(function (row) {
        if (seenExperts[row.name]) return false;
        seenExperts[row.name] = true;
        return true;
      });
      return Promise.all([
        ETB.agentControl.sha256(exactAgent.instructions),
        ETB.agentControl.sha256(ETB.agentControl.canonical(exactAgent)),
        ETB.agentControl.sha256(ETB.agentControl.canonical(exactConceptsLocal)),
        ETB.agentControl.sha256(ETB.agentControl.canonical(exactConceptsGlobal)),
        ETB.agentControl.sha256(ETB.agentControl.canonical(exactConcepts)),
        ETB.agentControl.sha256(ETB.agentControl.canonical(exactRulesLocal)),
        ETB.agentControl.sha256(ETB.agentControl.canonical(exactRulesGlobal)),
        ETB.agentControl.sha256(ETB.agentControl.canonical(exactRules)),
        ETB.agentControl.sha256(ETB.agentControl.canonical(exactExperts)),
        ETB.agentControl.sha256(managedKnowledgeText)
      ]).then(function (hashes) {
        var inventory = {
          agent: {
            id: exactAgent.id,
            name: exactAgent.name,
            provider: exactAgent.provider,
            model: exactAgent.model,
            category: exactAgent.category,
            role: exactAgent.role,
            tools: exactAgent.tools,
            instructionsSha256: hashes[0],
            configurationSnapshotSha256: hashes[1]
          },
          knowledge: [{
            id: 'knowledge.contribution_margin_definition.v1',
            scope: 'managed_policy',
            preview: managedKnowledgeText,
            contentSha256: hashes[9]
          }].concat(exactConcepts.slice(0, 24).map(function (row) {
            return {
              id: row.id,
              nativeId: row.nativeId,
              scope: row.scope,
              preview: _agentControlPreview(row.text, 80)
            };
          })),
          localRules: exactRules.slice(0, 24).map(function (row) {
            return {
              id: row.id,
              nativeId: row.nativeId,
              scope: row.scope,
              preview: _agentControlPreview(row.text, 80)
            };
          }),
          capabilities: exactExperts.filter(function (row) {
            return row.name !== 'profitability_gate';
          }).slice(0, 20).map(function (row) {
            return {
              id: row.name,
              name: row.name,
              scope: 'visible_from_agent',
              shared: false
            };
          }).concat([{
            id: 'profitability_gate',
            name: 'Управляемая проверка политики маржи',
            scope: 'managed_policy',
            shared: true,
            version: 'AGENT_CONTROL_POLICY_V1',
            description: 'Deterministic managed policy evaluator. It consumes caller-supplied marginBps and does not call an Extella Expert or native agent.'
          }]),
          processes: [{
            id: 'managed.profitability_governance',
            name: 'Контроль маржи перед решением о росте'
          }],
          hashes: {
            agent: hashes[1],
            conceptsAgent: hashes[2],
            conceptsAccountGlobal: hashes[3],
            concepts: hashes[4],
            rulesAgent: hashes[5],
            rulesAccountGlobal: hashes[6],
            rules: hashes[7],
            experts: hashes[8]
          },
          counts: {
            concepts: exactConcepts.length,
            conceptsAgent: exactConceptsLocal.length,
            conceptsAccountGlobal: exactConceptsGlobal.length,
            rules: exactRules.length,
            rulesAgent: exactRulesLocal.length,
            rulesAccountGlobal: exactRulesGlobal.length,
            experts: exactExperts.length
          }
        };
        return {
          agent: inventory.agent,
          inventory: inventory,
          display: {
            concepts: exactConcepts.slice(0, 40).map(function (row) {
              return {
                id: row.id,
                nativeId: row.nativeId,
                scope: row.scope,
                preview: _agentControlPreview(row.text)
              };
            }),
            rules: exactRules.slice(0, 40).map(function (row) {
              return {
                id: row.id,
                nativeId: row.nativeId,
                scope: row.scope,
                preview: _agentControlPreview(row.text)
              };
            }),
            experts: exactExperts.slice(0, 80).map(function (row) {
              return {
                name: row.name,
                scope: 'visible_from_agent',
                description: _agentControlPreview(row.description)
              };
            }),
            counts: {
              concepts: exactConcepts.length,
              conceptsAgent: exactConceptsLocal.length,
              conceptsAccountGlobal: exactConceptsGlobal.length,
              rules: exactRules.length,
              rulesAgent: exactRulesLocal.length,
              rulesAccountGlobal: exactRulesGlobal.length,
              experts: exactExperts.length
            },
            hashes: inventory.hashes
          }
        };
      });
    });
  }

  function _agentControlInspect(agentIds, context) {
    return _agentControlLoadAgents(agentIds, context).then(function (agents) {
      return Promise.all(agents.map(function (agent) {
        return _agentControlInspectOne(agent, context);
      }));
    });
  }

  function _agentControlPlatformStatus() {
    return {
      managedAdapter: 'AVAILABLE',
      nativeBundleVersioning: 'PLATFORM_UNAVAILABLE',
      nativeAtomicPublish: 'PLATFORM_UNAVAILABLE',
      nativeRunVersionBinding: 'PLATFORM_UNAVAILABLE',
      multiDeviceCompareAndSwap: 'PLATFORM_UNAVAILABLE',
      auditIntegrity: 'KV_READBACK_VERIFIED_NOT_TAMPER_EVIDENT',
      organizationScope: 'PLATFORM_RBAC_UNAVAILABLE',
      dependencyGraph: 'MANAGED_LEDGER_DECLARATION_NOT_NATIVE_EXPERT_BINDING',
      conflictDetection: 'MANAGED_POLICY_ONLY_NATIVE_RULES_NOT_EVALUATED',
      profileScope: 'DEFAULT_PROFILE_ONLY',
      effectiveConfigCompleteness: 'LOCAL_AND_ACCOUNT_GLOBAL_READ_DEFAULT_PROFILE',
      managedGuarantee: 'Every run launched here resolves one verified active pointer and executes the deterministic managed policy evaluator only.',
      nativeGuarantee: 'The managed evaluator does not call an Extella Expert or native agent. Native Rules are inventoried but not evaluated. Ordinary Extella chats and agent/run calls outside this adapter are not version-bound.'
    };
  }

  function _agentControlRuleText(value) {
    var text = String(value || '').replace(/\s+/g, ' ').trim();
    var percentages = text.match(/\d+(?:[.,]\d+)?\s*%/g) || [];
    if (text.length < 40 || text.length > 800) {
      throw new Error('business rule must contain between 40 and 800 characters');
    }
    if (!/(марж|margin)/i.test(text) ||
        !/(ниже|меньше|below|under|less\s+than)/i.test(text) ||
        !/20(?:[.,]0+)?\s*%/.test(text) ||
        !/(бюдж|budget)/i.test(text) ||
        !/(не\s+увелич|do\s+not\s+increase|not\s+increase)/i.test(text)) {
      throw new Error('business rule must explicitly say: margin below 20% must not increase the ad budget');
    }
    if (!percentages.length || percentages.some(function (value) {
      return Number(value.replace(/\s*%/, '').replace(',', '.')) !== 20;
    })) {
      throw new Error('business rule must contain no percentage threshold other than 20%');
    }
    if (/<script|function\s*\(|=>\s*\{|eval\s*\(|api[_ -]?token|bearer\s+/i.test(text)) {
      throw new Error('executable code and credentials are not accepted as business rules');
    }
    return text;
  }

  function _agentControlOwner(data) {
    return String((data && data.ownerAgentId) || '');
  }

  function _agentControlLoadOwned(data, context) {
    var owner = _agentControlOwner(data);
    if (!owner) return Promise.reject(new Error('control-plane owner agent is required'));
    return _agentControlLoadAgents([owner], context).then(function () {
      return _agentControlReadLedger(owner, context);
    }).then(function (ledger) {
      if (!ledger) throw new Error('managed baseline has not been captured');
      if (String(ledger.ownerAccountId || '') !== String(context.actorId || '')) {
        throw new Error('managed ledger belongs to a different authenticated account');
      }
      return ledger;
    });
  }

  function _agentControlEventId(prefix) {
    if (typeof crypto === 'undefined' ||
        typeof crypto.getRandomValues !== 'function') {
      throw new Error('WebCrypto random IDs are required for managed run receipts');
    }
    var bytes = new Uint32Array(4);
    crypto.getRandomValues(bytes);
    _agentControlRunSequence += 1;
    return String(prefix || 'event') + '_' +
      Array.prototype.map.call(bytes, function (value) {
        return ('00000000' + value.toString(16)).slice(-8);
      }).join('') + '_' + _agentControlRunSequence.toString(36);
  }

  function _agentControlAction(data) {
    var action = String((data && data.action) || '');
    var actorId = _studioCurrentUserId();
    var owner = _agentControlOwner(data);
    if (!actorId) return Promise.reject(new Error('authenticated Control Center account is required'));
    var context = _agentControlContext(actorId, data && data.reqId);

    if (action === 'bootstrap') {
      return _agentControlLoadAgents([], context).then(function (agents) {
        if (!owner) return { agents: agents, ledger: null, platform: _agentControlPlatformStatus() };
        return _agentControlLoadAgents([owner], context).then(function () {
          return _agentControlReadLedger(owner, context);
        }).then(function (ledger) {
          return { agents: agents, ledger: ledger, platform: _agentControlPlatformStatus() };
        });
      });
    }

    if (action === 'inspect') {
      var inspectIds = (data.agentIds || []).map(String);
      if (!inspectIds.length || inspectIds.length > 8) {
        return Promise.reject(new Error('inspect requires between one and eight agent ids'));
      }
      return _agentControlInspect(inspectIds, context).then(function (snapshots) {
        return {
          snapshots: snapshots.map(function (snapshot) {
            return { agent: snapshot.agent, inventory: snapshot.display };
          }),
          platform: _agentControlPlatformStatus()
        };
      });
    }

    if (action === 'baseline_create') {
      var baselineIds = (data.agentIds || []).map(String);
      if (baselineIds.length !== 2 || new Set(baselineIds).size !== 2) {
        return Promise.reject(new Error('the vertical slice requires exactly two distinct agents'));
      }
      owner = baselineIds[0];
      return _agentControlLoadAgents(baselineIds, context).then(function () {
        return _agentControlSerialize(owner, context, function () {
          return _agentControlReadLedger(owner, context).then(function (existing) {
            if (existing) {
              var existingIds = Object.keys(existing.agents || {}).sort();
              var requestedIds = baselineIds.slice().sort();
              if (ETB.agentControl.canonical(existingIds) !==
                  ETB.agentControl.canonical(requestedIds)) {
                throw new Error('the selected pair does not match the existing owner ledger');
              }
              return {
                ledger: existing,
                existing: true,
                platform: _agentControlPlatformStatus()
              };
            }
            return _agentControlInspect(baselineIds, context).then(function (snapshots) {
              var agents = [];
              var inventories = {};
              snapshots.forEach(function (snapshot, index) {
                var agent = Object.assign({}, snapshot.agent, {
                  managedRole: index === 0 ? 'one_c_controller' : 'targetologist'
                });
                snapshot.inventory.agent.managedRole = agent.managedRole;
                agents.push(agent);
                inventories[agent.id] = snapshot.inventory;
              });
              return ETB.agentControl.newLedger(agents, inventories, {
                ownerAgentId: owner,
                ownerAccountId: actorId,
                actorId: actorId,
                now: new Date().toISOString()
              }).then(function (ledger) {
                return _agentControlWriteLedger(owner, ledger, context);
              }).then(function (ledger) {
                return {
                  ledger: ledger,
                  existing: false,
                  snapshots: snapshots.map(function (snapshot) {
                    return { agent: snapshot.agent, inventory: snapshot.display };
                  }),
                  platform: _agentControlPlatformStatus()
                };
              });
            });
          });
        });
      });
    }

    if (action === 'load') {
      return _agentControlLoadOwned(data, context).then(function (ledger) {
        return { ledger: ledger, platform: _agentControlPlatformStatus() };
      });
    }

    if (action === 'draft_create') {
      return _agentControlSerialize(owner, context, function () {
        return _agentControlLoadOwned(data, context).then(function (ledger) {
          var requestedScope = data.scope || {};
          var kind = String(requestedScope.kind || 'selected');
          var agentIds = (requestedScope.agentIds || []).map(String);
          if (kind === 'organization') {
            throw new Error('organization scope requires platform RBAC and a complete organization registry');
          }
          var scope = kind === 'one' ?
            { kind: 'one', agentId: String(requestedScope.agentId || agentIds[0] || '') } :
            { kind: 'selected', agentIds: agentIds };
          return ETB.agentControl.createDraft(ledger, {
            scope: scope,
            capabilityId: 'profitability_gate',
            ruleId: 'shared.actual-margin-ad-budget-guard',
            text: _agentControlRuleText(data.ruleText),
            thresholdBps: 2000,
            operator: '<',
            actorId: actorId,
            now: new Date().toISOString()
          });
        }).then(function (ledger) {
          return _agentControlWriteLedger(owner, ledger, context);
        }).then(function (ledger) {
          var draft = ledger.drafts[ledger.currentDraftId];
          return {
            ledger: ledger,
            draft: draft,
            impact: ETB.agentControl.analyzeImpact(ledger, draft.id),
            platform: _agentControlPlatformStatus()
          };
        });
      });
    }

    if (action === 'playground_run') {
      return _agentControlSerialize(owner, context, function () {
        return _agentControlLoadOwned(data, context).then(function (ledger) {
          var draftId = String(data.draftId || ledger.currentDraftId || '');
          return ETB.agentControl.runPlayground(ledger, draftId, data.cases || null, {
            actorId: actorId,
            now: new Date().toISOString()
          });
        }).then(function (ledger) {
          return _agentControlWriteLedger(owner, ledger, context);
        }).then(function (ledger) {
          return {
            ledger: ledger,
            testRun: ledger.testRuns[ledger.currentTestRunId],
            platform: _agentControlPlatformStatus()
          };
        });
      });
    }

    if (action === 'publish') {
      return _agentControlSerialize(owner, context, function () {
        return _agentControlLoadOwned(data, context).then(function (ledger) {
          return ETB.agentControl.publishDraft(
            ledger,
            String(data.draftId || ledger.currentDraftId || ''),
            String(data.testRunId || ledger.currentTestRunId || ''),
            { actorId: actorId, now: new Date().toISOString() }
          );
        }).then(function (ledger) {
          return _agentControlWriteLedger(owner, ledger, context);
        }).then(function (ledger) {
          return {
            ledger: ledger,
            publication: ledger.audit[ledger.audit.length - 1],
            platform: _agentControlPlatformStatus()
          };
        });
      });
    }

    if (action === 'rollback') {
      return _agentControlSerialize(owner, context, function () {
        return _agentControlLoadOwned(data, context).then(function (ledger) {
          var target = String(data.targetVersionId || ledger.baselineVersionId || '');
          return ETB.agentControl.rollback(ledger, target, {
            actorId: actorId,
            now: new Date().toISOString(),
            agentIds: Object.keys(ledger.agents || {})
          });
        }).then(function (ledger) {
          return _agentControlWriteLedger(owner, ledger, context);
        }).then(function (ledger) {
          return {
            ledger: ledger,
            rollback: ledger.audit[ledger.audit.length - 1],
            platform: _agentControlPlatformStatus()
          };
        });
      });
    }

    if (action === 'active_run') {
      return _agentControlSerialize(owner, context, function () {
        return _agentControlLoadOwned(data, context).then(function (ledger) {
          var ids = (data.agentIds && data.agentIds.length ?
            data.agentIds.map(String) : Object.keys(ledger.agents || {}).sort());
          if (!ids.length || ids.length > 8 || new Set(ids).size !== ids.length) {
            throw new Error('managed run requires between one and eight distinct agent ids');
          }
          var marginBps = Number(data.marginBps);
          var next = ledger;
          var recordedAt = new Date().toISOString();
          var receipts = ids.map(function (agentId) {
            return ETB.agentControl.runActive(ledger, agentId, {
              marginBps: marginBps,
              runId: _agentControlEventId('managed')
            });
          });
          receipts.forEach(function (receipt) {
            next = ETB.agentControl.recordRun(next, receipt, {
              actorId: actorId,
              now: recordedAt
            });
          });
          return _agentControlWriteLedger(owner, next, context).then(function (saved) {
            return {
              ledger: saved,
              receipts: receipts.map(function (receipt) {
                return saved.runs[receipt.id];
              }),
              platform: _agentControlPlatformStatus()
            };
          });
        });
      });
    }

    return Promise.reject(new Error('unsupported Agent Control action'));
  }

  function _studioReadObjects(session) {
    var marker = String(session.marker || '').toUpperCase();
    return Promise.all([
      _studioListAllConcepts({ agentId: session.ownerAgentId, global: true }),
      ETB.api.ruleListScoped({ agentId: session.ownerAgentId, global: true })
    ]).then(function (responses) {
      _studioApiOk(responses[1], 'rule list');
      return {
        concepts: responses[0].filter(function (row) {
          return _studioConceptText(row).indexOf(marker) === 0;
        }),
        rules: _studioRuleRows(responses[1]).filter(function (row) {
          return _studioRuleText(row).indexOf(marker) === 0;
        })
      };
    });
  }

  function _studioConfirmedCleanupNow(session) {
    if (!session || !_studioMarkerValid(session.marker) || !session.ownerAgentId ||
        !_studioSessionAccountValid(session)) {
      return Promise.reject(new Error('invalid studio cleanup session'));
    }
    var before;
    return _studioReadObjects(session).then(function (rows) {
      before = rows;
      var deletes = [];
      rows.concepts.forEach(function (row) {
        var id = _studioObjectId(row);
        if (id == null) return;
        deletes.push(ETB.api.conceptDeleteScoped(id, { agentId: session.ownerAgentId }).then(function (response) {
          _studioApiOk(response, 'concept delete');
          if (response.deleted !== true) throw new Error('concept delete not confirmed');
        }));
      });
      rows.rules.forEach(function (row) {
        var id = _studioObjectId(row);
        if (id == null) return;
        deletes.push(ETB.api.ruleDeleteScoped(id, { agentId: session.ownerAgentId }).then(function (response) {
          _studioApiOk(response, 'rule delete');
          if (response.deleted !== true) throw new Error('rule delete not confirmed');
        }));
      });
      return Promise.all(deletes);
    }).then(function () {
      return _studioReadObjects(session);
    }).then(function (after) {
      if (after.concepts.length || after.rules.length) {
        throw new Error('studio cleanup verification failed');
      }
      _studioSessionClear(session.marker);
      return {
        agentId: session.ownerAgentId,
        marker: session.marker,
        deletedConcepts: before.concepts.length,
        deletedRules: before.rules.length,
        verifiedAbsent: true
      };
    });
  }

  function _studioConfirmedCleanup(session) {
    if (!session || !_studioMarkerValid(session.marker) || !session.ownerAgentId ||
        !_studioSessionAccountValid(session)) {
      return Promise.reject(new Error('invalid studio cleanup session'));
    }
    return _studioSerialize(session.marker, function () {
      return _studioConfirmedCleanupNow(session);
    });
  }

  // A crash or Desktop restart must not leave a temporary account-global Rule
  // behind. The host owns the recovery marker and retries confirmed cleanup.
  function _recoverStudioGovernance(attempt) {
    var session = _studioSessionLoad();
    if (!session) return;
    // Never prove absence against a different account. Keep the marker so a
    // later switch back to its owner can retry with the correct credential.
    if (!_studioSessionAccountValid(session)) return;
    if (session.hostInstanceId === STUDIO_HOST_INSTANCE &&
        _activeId === 'profit-growth-scenario') return;
    _studioConfirmedCleanup(session).catch(function () {
      if ((attempt || 0) < 11) {
        setTimeout(function () {
          _recoverStudioGovernance((attempt || 0) + 1);
        }, Math.min(60000, 5000 * Math.pow(2, Math.min((attempt || 0), 4))));
      }
    });
  }
  setTimeout(function () { _recoverStudioGovernance(0); }, 3500);

  if (!window.__etbRouterSessionHook) {
    window.__etbRouterSessionHook = true;
    ETB.auth.onSessionChange(function (ev) {
      // Fence every in-flight control operation before any new-account init is
      // delivered. The iframe also receives an explicit reset on clear/switch,
      // so cached previews from the previous account cannot remain authoritative.
      _agentControlSessionEpoch += 1;
      var controlEntry = _cache['profit-growth-scenario'];
      var controlIframe = controlEntry && controlEntry.panel &&
        controlEntry.panel.querySelector('iframe');
      if (controlIframe && controlIframe.contentWindow) {
        try {
          controlIframe.contentWindow.postMessage({
            type: 'etb_account_reset',
            reason: ev && ev.reason || 'session_change'
          }, '*');
        } catch (_) {}
      }
      if (ev.token && !ev.cleared && window.__etbResendInit) {
        window.__etbResendInit(ev.token);
      }
      if (ev.token && ev.userId && !ev.cleared) {
        setTimeout(function () { _recoverStudioGovernance(0); }, 0);
      }
    });
  }

  function _currentTheme() {
    return (ETB.theme && ETB.theme.current) ? ETB.theme.current() : 'dark';
  }

  // Язык витрины (localStorage общий у хоста и blob-iframe окон)
  function _currentLang() {
    try { return localStorage.getItem('etb_lang') === 'en' ? 'en' : 'ru'; } catch (e) { return 'ru'; }
  }

  function _postThemeToIframe(iframe, theme) {
    if (!iframe || !iframe.contentWindow) return;
    try {
      iframe.contentWindow.postMessage({ type: 'etb_theme', theme: theme || _currentTheme() }, '*');
    } catch (e) {}
  }

  // Push live theme changes into every cached plugin iframe (chat/form/html).
  if (!window.__etbRouterThemeHook && ETB.theme && ETB.theme.onChange) {
    window.__etbRouterThemeHook = true;
    ETB.theme.onChange(function (theme) {
      Object.keys(_cache).forEach(function (id) {
        var panel = _cache[id] && _cache[id].panel;
        if (!panel) return;
        var iframe = panel.querySelector('iframe');
        _postThemeToIframe(iframe, theme);
      });
    });
  }

  function _wireIframeToken(iframe, sendFn) {
    function _send(token) { sendFn(token); }
    var t = ETB.auth.getToken();
    _send(t);
    if (!t) ETB.auth.onToken(function (late) { if (iframe.isConnected) _send(late); });
    window.__etbResendInit = function (token) {
      if (iframe.isConnected) sendFn(token);
    };
  }

  function _beforePanelHidden(panel) {
    if (!panel || typeof panel.__etbBeforeHide !== 'function') return;
    try { panel.__etbBeforeHide(); } catch (_) {}
  }

  // Destroy a cached entry: remove from DOM, revoke blob URL.
  function _evict(pluginId) {
    var entry = _cache[pluginId];
    if (!entry) return;
    if (entry.panel) {
      _beforePanelHidden(entry.panel);
      if (entry.panel.__etbPmHandler) {
        window.removeEventListener('message', entry.panel.__etbPmHandler);
        entry.panel.__etbPmHandler = null;
      }
      if (entry.panel.parentNode) entry.panel.parentNode.removeChild(entry.panel);
    }
    if (entry.blobUrl) { try { URL.revokeObjectURL(entry.blobUrl); } catch (_) {} }
    delete _cache[pluginId];
    delete _autoTries[pluginId];
  }

  // Evict the least-recently-used entry when cache is full.
  function _evictLRU() {
    var ids = Object.keys(_cache);
    if (ids.length < CACHE_MAX) return;
    var oldest = ids.reduce(function (a, b) {
      return (_cache[a].lastUsed || 0) < (_cache[b].lastUsed || 0) ? a : b;
    });
    _evict(oldest);
  }

  // Inject the spinner keyframe once (router may render before any panel that
  // defines it). Idempotent via the style element id.
  function _ensureRepairStyles() {
    if (document.getElementById('_etbv2_router_styles')) return;
    var s = document.createElement('style');
    s.id = '_etbv2_router_styles';
    s.textContent = '@keyframes _etbv2_spin{to{transform:rotate(360deg)}}';
    document.head.appendChild(s);
  }

  // Фирменный лоадер Extella — анимированная бесконечность (тот же приём, что в
  // витрине и Workspace) вместо безликого спиннера, пока агент чинит/запускает.
  var _infN = 0;
  function _ensureInfStyles() {
    if (document.getElementById('_etb_inf_styles')) return;
    var s = document.createElement('style');
    s.id = '_etb_inf_styles';
    s.textContent = '@keyframes _etbinfrun{to{stroke-dashoffset:-200}}' +
      '._etbinf .tr{fill:none;stroke:#E7D8C1;stroke-width:7;stroke-linecap:round;opacity:.55}' +
      '._etbinf .run{fill:none;stroke-width:7;stroke-linecap:round;stroke-dasharray:46 154;animation:_etbinfrun 1.5s linear infinite}' +
      '@media (prefers-reduced-motion:reduce){._etbinf .run{animation:none;stroke-dasharray:none}}';
    document.head.appendChild(s);
  }
  function _infHTML(w) {
    w = w || 56; _ensureInfStyles();
    var gid = '_etbinfg' + (++_infN);   // свой id градиента на каждый экземпляр — иначе SVG-ссылки конфликтуют
    var d = 'M25,25 C25,11 43,11 50,25 C57,39 75,39 75,25 C75,11 57,11 50,25 C43,39 25,39 25,25 Z';
    return '<span class="_etbinf" style="display:inline-block;line-height:0"><svg viewBox="0 0 100 50" width="' + w + '" height="' + (w / 2) + '" aria-hidden="true">' +
      '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#C67A22"/><stop offset="1" stop-color="#E8B36A"/></linearGradient></defs>' +
      '<path class="tr" d="' + d + '" pathLength="200"/>' +
      '<path class="run" stroke="url(#' + gid + ')" d="' + d + '" pathLength="200"/></svg></span>';
  }

  // Slim, non-blocking progress strip pinned to the TOP of a panel's content
  // area. It overlays (does not replace) the live UI, so the agent run does not
  // feel like a separate popup window. Returns the bar element.
  function _renderRepairProgress(content, plugin, phase) {
    if (!content) return null;
    _ensureRepairStyles();
    var prev = content.querySelector('._etb_rep_bar');
    if (prev) prev.parentNode.removeChild(prev);
    var bar = document.createElement('div');
    bar.className = '_etb_rep_bar';
    bar.style.cssText = [
      'position:absolute;top:0;left:0;right:0;z-index:6;',
      'display:flex;align-items:center;gap:10px;',
      'padding:8px 14px;box-sizing:border-box;',
      'background:var(--etb-s1,#111);',
      'border-bottom:1px solid var(--etb-bd,rgba(255,255,255,.08));',
      'font-family:-apple-system,system-ui,sans-serif;',
      'animation:_etbv2_slide_in .18s ease;'
    ].join('');
    bar.innerHTML = [
      '<span style="flex-shrink:0;">', _infHTML(26), '</span>',
      '<div style="font-size:12px;font-weight:700;color:var(--etb-tx,#f0f0f0);flex-shrink:0;">',
      'Extella чинит</div>',
      '<div class="_etb_rep_phase" style="font-size:12px;color:var(--etb-tx2,#aaa);',
      'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;">',
      _esc(phase || 'Разбираюсь, что сломалось'), '…</div>'
    ].join('');
    content.appendChild(bar);
    return bar;
  }

  // Turn the progress strip into an inline error notice with optional Retry button.
  function _renderRepairError(bar, content, msg, onRetry) {
    if (!bar && content) bar = _renderRepairProgress(content, {}, '');
    if (!bar) return;
    bar.style.background = 'rgba(40,18,18,.97)';
    bar.style.borderBottomColor = 'rgba(220,90,90,.5)';
    var retryBtn = onRetry
      ? '<button class="_etb_rep_retry" style="background:rgba(198,126,52,.2);border:1px solid rgba(198,126,52,.5);' +
        'color:#C67E34;cursor:pointer;font-size:11px;padding:3px 10px;border-radius:5px;flex-shrink:0;">Retry</button>'
      : '';
    bar.innerHTML = [
      '<div style="font-size:14px;flex-shrink:0;">&#9888;</div>',
      '<div style="font-size:12px;color:#f0c9c9;flex:1;overflow:hidden;',
      'text-overflow:ellipsis;white-space:nowrap;">Починка не удалась: ',
      _esc(String(msg || 'unknown error').slice(0, 140)), '</div>',
      retryBtn,
      '<button class="_etb_rep_close" style="background:none;border:none;color:#f0c9c9;',
      'cursor:pointer;font-size:14px;padding:0 4px;flex-shrink:0;">&#10005;</button>'
    ].join('');
    var close = bar.querySelector('._etb_rep_close');
    if (close) close.onclick = function () { if (bar.parentNode) bar.parentNode.removeChild(bar); };
    if (onRetry) {
      var retryEl = bar.querySelector('._etb_rep_retry');
      if (retryEl) retryEl.onclick = function () {
        if (bar.parentNode) bar.parentNode.removeChild(bar);
        onRetry();
      };
    }
    // Auto-dismiss after 20s (longer when there's a Retry button).
    setTimeout(function () { if (bar && bar.parentNode) bar.parentNode.removeChild(bar); },
      onRetry ? 20000 : 8000);
  }

  // Resolve the live URL for a service/local_server plugin.
  function _serviceUrl(plugin) {
    var ui = plugin.ui || {};
    // Хостинговые плагины: сервер живёт не на устройстве, а на нашем VPS —
    // карточка несёт готовый https-URL (первый пример: Бага на baga.*.sslip.io).
    if (ui.url) return ui.url;
    var port = ui.port || (plugin.service && plugin.service.port);
    if (!port) return '';
    var mainFile = (ui.mainFile && ui.mainFile !== 'index.html') ? ui.mainFile : '';
    return 'http://localhost:' + port + (mainFile ? '/' + mainFile : '');
  }

  // Open a URL in the user's default browser. In Extella Desktop, window.open is
  // intercepted by setWindowOpenHandler → shell.openExternal (opens externally).
  function _openUrlExternal(url) {
    if (!url) return;
    try { window.open(url, '_blank'); } catch (e) {}
  }

  // Card shown for apps whose own web UI cannot be embedded in an iframe.
  function _renderOpenExternalCard(content, plugin) {
    if (!content) return;
    var pid = plugin.id ? plugin.id.replace(/'/g, '') : '';
    var url = _serviceUrl(plugin);
    content.innerHTML = [
      '<div style="display:flex;align-items:center;justify-content:center;height:100%;',
      'padding:32px;font-family:-apple-system,system-ui,sans-serif;">',
      '<div style="max-width:420px;text-align:center;">',
      '<div style="font-size:40px;margin-bottom:16px;">&#127759;</div>',
      '<div style="font-size:16px;font-weight:700;color:var(--etb-tx,#f0f0f0);margin-bottom:8px;">',
      _esc(plugin.name), _L(' работает</div>',' is running</div>'),
      '<div style="font-size:13px;color:var(--etb-tx2,#888);line-height:1.6;margin-bottom:22px;">',
      _L('Интерфейс этой программы не помещается во встроенную панель. ','This tool runs its own interface that can\'t be shown inside the panel. '),
      _L('Открой его в браузере','Open it in your browser'), url ? ' (' + _esc(url) + ')' : '', '.</div>',
      '<div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">',
      '<button onclick="ETB.router._openExternal(\'' + _esc(pid) + '\')" style="' +
      'background:#C67E34;border:none;color:#000;font-weight:700;border-radius:6px;' +
      'padding:10px 22px;cursor:pointer;font-size:12px;">' + _L('Открыть ','Open ') + _esc(plugin.name) + '</button>',
      '<button onclick="ETB.router._repairWithAgent(\'' + _esc(pid) + '\')" style="' +
      'background:var(--etb-s3,#1a1a1a);border:1px solid var(--etb-bd2,#333);color:var(--etb-tx,#f0f0f0);border-radius:6px;' +
      'padding:10px 22px;cursor:pointer;font-size:12px;">' + _L('Починить агентом','Repair with agent') + '</button>',
      '</div></div></div>'
    ].join('');
  }

  // ── Server fallback card ────────────────────────────────────────
  // Shown only after an auto-start attempt did not bring the server up — so the
  // copy is human ("needs a hand"), leads with one clear action (let the agent
  // install what's missing and run it), and tucks the technical bits behind a
  // details toggle instead of greeting the user with "port … / dependencies".
  function _renderServerFallback(content, plugin) {
    var ui = plugin.ui || {};
    var pid = plugin.id ? plugin.id.replace(/'/g, '') : '';
    content.innerHTML = [
      '<div style="display:flex;align-items:center;justify-content:center;height:100%;',
      'padding:32px;font-family:-apple-system,system-ui,sans-serif;">',
      '<div style="max-width:380px;text-align:center;">',
      '<div style="margin-bottom:14px;color:#C67E34"><svg class="lico" style="width:34px;height:34px"><use href="#ic-tech"/></svg></div>',
      '<div style="font-size:16px;font-weight:700;color:var(--etb-tx,#f0f0f0);margin-bottom:8px;">',
      _esc(plugin.name), _L(': нужна минутка на настройку</div>',' needs a moment to set up</div>'),
      '<div style="font-size:13px;color:var(--etb-tx2,#888);line-height:1.6;margin-bottom:22px;">',
      _L('Программа не запустилась сама. Позволь агенту доустановить её и открыть — ','It didn\'t start on its own. Let the agent finish setting it up and open it &#8212; '),
      _L('обычно это разовый шаг.</div>','usually a one-time step.</div>'),
      '<div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">',
      '<button onclick="ETB.router._repairWithAgent(\'' + _esc(pid) + '\')" style="' +
      'background:#C67E34;border:none;color:#000;font-weight:700;border-radius:6px;' +
      'padding:11px 24px;cursor:pointer;font-size:12.5px;">' + _L('Настроить и открыть','Set up &amp; open') + '</button>',
      '<button onclick="ETB.router._retryServer(\'' + _esc(pid) + '\')" style="' +
      'background:var(--etb-s3,#1a1a1a);border:1px solid var(--etb-bd2,#333);color:var(--etb-tx,#f0f0f0);border-radius:6px;' +
      'padding:11px 20px;cursor:pointer;font-size:12.5px;">&#8635; ' + _L('Ещё раз','Try again') + '</button>',
      '</div>',
      // Technical detail, collapsed — for power users, not in the user's face.
      '<details style="margin-top:18px;text-align:left;">',
      '<summary style="font-size:11px;color:var(--etb-tx3,#666);cursor:pointer;text-align:center;list-style:none;">' + _L('Подробности','Details') + '</summary>',
      '<div style="font-size:11px;color:var(--etb-tx3,#666);line-height:1.5;margin-top:8px;">',
      _L('Локальный сервер не отвечает на порту ','Local server offline on port '), String(ui.port || '&#8212;'), '.',
      ui.startExpert
        ? ' <a href="#" onclick="ETB.router._startServer(\'' + _esc(pid) + '\');return false;" style="color:#C67E34;">' + _L('Запустить только сервер','Start server only') + '</a>.'
        : '',
      '</div></details>',
      '</div></div>'
    ].join('');
  }

  // Runtime health overlay shown when an embedded/generated UI reports failure.
  function _renderHealthFallback(content, plugin, error) {
    var overlay = document.createElement('div');
    overlay.style.cssText = [
      'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;',
      'padding:32px;background:var(--etb-bg,#0a0a0a);',
      'font-family:-apple-system,system-ui,sans-serif;z-index:5;'
    ].join('');
    var pid = plugin.id ? plugin.id.replace(/'/g, '') : '';
    overlay.innerHTML = [
      '<div style="max-width:420px;text-align:center;">',
      '<div style="font-size:38px;margin-bottom:14px;">&#9888;</div>',
      '<div style="font-size:16px;font-weight:700;color:var(--etb-tx,#f0f0f0);margin-bottom:8px;">',
      _esc(plugin.name), _L(': интерфейс не загрузился</div>',' UI failed to load</div>'),
      '<div style="font-size:13px;color:var(--etb-tx2,#888);line-height:1.6;margin-bottom:20px;">',
      _L('Интерфейс не инициализировался. Позволь агенту разобраться и починить,','The interface did not initialize correctly. Let the agent diagnose and fix it,'),
      ' or remove the plugin and re-add it to rebuild.',
      error ? '<br><span style="color:#a55;font-size:11px;">' + _esc(String(error).slice(0, 200)) + '</span>' : '',
      '</div>',
      '<button onclick="ETB.router._repairWithAgent(\'' + _esc(pid) + '\')" style="' +
      'background:#C67E34;border:none;color:#000;font-weight:700;border-radius:6px;' +
      'padding:10px 22px;cursor:pointer;font-size:12px;">' + _L('Починить агентом','Fix with agent') + '</button>',
      '</div>'
    ].join('');
    content.appendChild(overlay);
  }

  // Listen for an etb_ui_health signal from a generated/CDN-embed iframe.
  // Only reacts to an explicit failure (ok:false) so UIs that never emit a
  // health signal (raw served sites, legacy plugins) are unaffected.
  function _attachHealthWatchdog(iframe, content, plugin) {
    var expectsHealth = !!(plugin && plugin.ui && plugin.ui.expectsHealth);
    var positiveTimer = null;
    function onMsg(e) {
      if (!e.data || e.data.type !== 'etb_ui_health') return;
      if (iframe.contentWindow && e.source !== iframe.contentWindow) return;
      window.removeEventListener('message', onMsg);
      if (positiveTimer) { clearTimeout(positiveTimer); positiveTimer = null; }
      if (e.data.ok === false) _renderHealthFallback(content, plugin, e.data.error);
    }
    window.addEventListener('message', onMsg);
    // For embeds we control (cdn), require a positive ok:true. If none arrives,
    // the component never mounted (blank) → fallback. Raw/build/legacy UIs that
    // never emit health are unaffected (expectsHealth=false).
    if (expectsHealth) {
      positiveTimer = setTimeout(function () {
        if (iframe.isConnected) {
          window.removeEventListener('message', onMsg);
          _renderHealthFallback(content, plugin, 'UI did not signal a successful render');
        }
      }, 12000);
    }
    // Auto-detach if the panel is torn down before any signal.
    setTimeout(function () {
      if (!iframe.isConnected) {
        window.removeEventListener('message', onMsg);
        if (positiveTimer) { clearTimeout(positiveTimer); positiveTimer = null; }
      }
    }, 30000);
  }

  // Check server availability then load iframe, or show fallback.
  // Must use no-cors: the local Python http.server has no CORS headers, so a
  // standard fetch from the HTTPS Extella page would always reject regardless
  // of whether the server is up. no-cors gives an opaque response when the
  // server responds (any status), and rejects only on network error (port closed).
  // AbortController adds a 4-second hard timeout for hung connections.
  function _checkAndLoadServer(iframe, serverUrl, content, plugin) {
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, 4000) : null;
    var fetchOpts = { method: 'HEAD', mode: 'no-cors' };
    if (controller) fetchOpts.signal = controller.signal;

    fetch(serverUrl, fetchOpts)
      .then(function () {
        if (timer) clearTimeout(timer);
        _autoTries[plugin.id] = 0;   // server is up — reset auto-start budget for next time
        // Hand the locally-served UI the same bridge html-type plugins get, so
        // its buttons can call /api/expert/run directly (token + apiBase).
        // For HuggingFace remote-model plugins, also pass the hf_token so the
        // generated UI can authenticate to the HF Inference API.
        iframe.addEventListener('load', function () {
          _wireIframeToken(iframe, function (token) {
            var needsHfToken = !!(plugin.hf && plugin.hf.needsToken && plugin.hf.tokenKvKey);
            var hfTokenPromise = needsHfToken
              ? ETB.api.kvGet(plugin.hf.tokenKvKey).then(function (r) { return (r && r.value) || ''; }).catch(function () { return ''; })
              : Promise.resolve('');
            hfTokenPromise.then(function (hfToken) {
              try {
                var initMsg = {
                  type: 'etb_init',
                  pluginId: plugin.id,
                  token: token,
                  apiBase: 'https://api.extella.ai',
                  experts: plugin.experts || [],
                  theme: _currentTheme(),
                  lang: _currentLang()
                };
                if (hfToken) initMsg.hf_token = hfToken;
                iframe.contentWindow.postMessage(initMsg, '*');
                _postThemeToIframe(iframe);
              } catch (e) {}
            });
          });
        }, { once: true });
        iframe.style.display = 'block';
        var _sep = serverUrl.indexOf('?') === -1 ? '?' : '&';
        iframe.src = serverUrl + _sep + '_t=' + Date.now();
      })
      .catch(function () {
        if (timer) clearTimeout(timer);
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
        var lui = plugin.ui || {};
        // Offline: silently start the server for the user and poll for it, showing
        // a friendly "starting…" state — no technical card unless it genuinely
        // doesn't come up. We poll on our OWN bounded timer (not the start expert's
        // promise, which may be a long/deferred task that never resolves) so the
        // spinner can never hang forever, and escalate to a friendly card on timeout.
        if (lui.startExpert && (_autoTries[plugin.id] || 0) < 2) {
          _autoTries[plugin.id] = (_autoTries[plugin.id] || 0) + 1;
          _autoStartAndWatch(content, plugin, serverUrl);
        } else {
          _renderServerFallback(content, plugin);
        }
      });
  }

  // Auto-start a local server and poll until it answers (load it) or a bounded
  // number of tries pass (show the friendly card). Renders into THIS content, so
  // it is robust even if another panel/container exists for the same plugin.
  function _autoStartAndWatch(content, plugin, serverUrl) {
    _renderStarting(content, plugin);
    // noRetry: we do our OWN polling below. _startServer's built-in retry would
    // re-enter this catch when its deferred task resolves → restart loop.
    try { ETB.router._startServer(plugin.id, { noRetry: true }); } catch (e) {}
    var tries = 0, maxTries = 6;   // ~18s at 3s spacing
    var iv = setInterval(function () {
      // Stop if this panel was torn down while we were waiting.
      if (!content.isConnected) { clearInterval(iv); return; }
      tries++;
      var c = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var t = c ? setTimeout(function () { c.abort(); }, 2500) : null;
      var opts = { method: 'HEAD', mode: 'no-cors' };
      if (c) opts.signal = c.signal;
      fetch(serverUrl, opts)
        .then(function () {
          if (t) clearTimeout(t);
          clearInterval(iv);
          // Server is up — load it into THIS content.
          content.innerHTML = '';
          var f = document.createElement('iframe');
          f.style.cssText = 'width:100%;height:100%;border:none;display:none;';
          f.setAttribute('allow', 'clipboard-read;clipboard-write');
          content.appendChild(f);
          _checkAndLoadServer(f, serverUrl, content, plugin);
        })
        .catch(function () {
          if (t) clearTimeout(t);
          if (tries >= maxTries) {
            clearInterval(iv);
            _renderServerFallback(content, plugin);   // escalate — no infinite spinner
          }
        });
    }, 3000);
  }

  // Friendly "the tool is starting" state — shown while we auto-start the local
  // server, so the user never meets a raw "server offline / port …" screen.
  function _renderStarting(content, plugin) {
    content.innerHTML = [
      '<div style="display:flex;align-items:center;justify-content:center;height:100%;',
      'padding:32px;font-family:-apple-system,system-ui,sans-serif;">',
      '<div style="max-width:360px;text-align:center;">',
      '<div style="margin-bottom:16px;">', _infHTML(84), '</div>',
      '<div style="font-size:15px;font-weight:700;color:var(--etb-tx,#f0f0f0);margin-bottom:6px;">',
      'Запускаю ', _esc(plugin.name), '&#8230;</div>',
      '<div style="font-size:12.5px;color:var(--etb-tx2,#888);line-height:1.55;">',
      'Первый запуск занимает несколько секунд.</div>',
      '</div></div>'
    ].join('');
  }

  function _buildPanel(plugin) {
    var panel = document.createElement('div');
    panel.style.cssText = [
      (ETB.shell && ETB.shell.isFallback && ETB.shell.isFallback())
        ? 'position:fixed;top:0;left:0;right:0;bottom:0;'
        : 'position:absolute;inset:0;',
      'z-index:2147483630;',
      'background:var(--etb-bg, #0a0a0a);',
      'display:flex;flex-direction:column;',
      'animation:_etbv2_slide_in .18s ease;'
    ].join('');

    // Header
    var hdr = document.createElement('div');
    hdr.style.cssText = [
      'display:flex;align-items:center;gap:10px;',
      'padding:10px 18px;',
      'border-bottom:1px solid var(--etb-bd, rgba(255,255,255,.07));',
      'background:var(--etb-s1, #111);flex-shrink:0;'
    ].join('');

    var ui = plugin.ui || {};

    // Build header content; add "Open in Finder" button if filePath is set
    var openFileBtn = '';
    if (ui.filePath) {
      var escapedPath = _esc(String(ui.filePath || ''));
      openFileBtn = '<button id="_etb_open_file_btn" title="Скопировать путь к файлу: ' + escapedPath + '" style="' +
        'background:none;border:none;color:var(--etb-tx2,#888);cursor:pointer;' +
        'font-size:14px;padding:4px 8px;border-radius:6px;transition:background .1s;">' +
        '<svg class="lico" style="width:14px;height:14px"><use href="#ic-docs"/></svg></button>';
    }

    // Open-in-browser button for server-backed plugins.
    var browserBtn = '';
    if (ui.type === 'local_server' || plugin.service) {
      var bpid = plugin.id ? plugin.id.replace(/'/g, '') : '';
      var _bLang = 'ru';
      try { _bLang = localStorage.getItem('etb_lang') || 'ru'; } catch (e) {}
      browserBtn = '<button onclick="ETB.router._openExternal(\'' + _esc(bpid) + '\')" ' +
        'title="' + (_bLang === 'en' ? 'Open in your browser' : 'Открыть в браузере') + '" style="' +
        'background:none;border:none;color:var(--etb-tx2,#888);cursor:pointer;' +
        'font-size:14px;padding:4px 8px;border-radius:6px;transition:background .1s;">' +
        '<svg class="lico" style="width:14px;height:14px"><use href="#ic-globe"/></svg></button>';
    }

    // Run-mode toggle for HuggingFace plugins
    var hfModeToggle = '';
    if (plugin.type === 'huggingface' && plugin.hf) {
      var currentMode = (plugin.hf && plugin.hf.runMode) || plugin.mode || 'local';
      var safePid = plugin.id ? plugin.id.replace(/'/g, '') : '';
      hfModeToggle = [
        '<div style="display:flex;gap:2px;background:var(--etb-s3,#1c1c1c);',
        'border:1px solid var(--etb-bd2,rgba(255,255,255,.13));border-radius:8px;padding:2px;">',
        '<button onclick="ETB.router._hfSwitchMode(\'' + _esc(safePid) + '\',\'local\')" style="',
        'background:' + (currentMode === 'local' ? 'var(--etb-s4,#242424)' : 'none') + ';',
        'border:none;color:' + (currentMode === 'local' ? 'var(--etb-tx,#f0f0f0)' : 'var(--etb-tx2,#888)') + ';',
        'font-size:11px;font-weight:' + (currentMode === 'local' ? '700' : '500') + ';',
        'padding:3px 10px;border-radius:6px;cursor:pointer;font-family:inherit;transition:all .14s;">',
        _L('Локально</button>','Local</button>'),
        '<button onclick="ETB.router._hfSwitchMode(\'' + _esc(safePid) + '\',\'remote\')" style="',
        'background:' + (currentMode === 'remote' ? 'var(--etb-s4,#242424)' : 'none') + ';',
        'border:none;color:' + (currentMode === 'remote' ? 'var(--etb-tx,#f0f0f0)' : 'var(--etb-tx2,#888)') + ';',
        'font-size:11px;font-weight:' + (currentMode === 'remote' ? '700' : '500') + ';',
        'padding:3px 10px;border-radius:6px;cursor:pointer;font-family:inherit;transition:all .14s;">',
        '☁️ HF</button>',
        '</div>'
      ].join('');
    }

    hdr.innerHTML = [
      ETB.brand.icon(18),
      '<span style="font-size:13px;font-weight:600;color:var(--etb-tx,#f0f0f0);">',
      _esc(plugin.name), '</span>',
      '<span style="font-size:11px;color:var(--etb-tx2,#888);">', _esc(plugin.tagline || ''), '</span>',
      '<div style="flex:1"></div>',
      // «? Как это работает» (правило §3.20) — если для поверхности есть справка.
      (_helpKey(plugin.id) ? '<button onclick="ETB.router.openHelp(\'' + _esc(plugin.id) + '\')" ' +
        'title="' + _esc(_L('Как это работает, что гарантировано, а что нет', 'How it works, what is guaranteed and what is not')) + '" ' +
        'style="background:none;border:1px solid rgba(140,140,140,.4);color:var(--etb-tx2,#aaa);cursor:pointer;' +
        'font-size:11.5px;padding:4px 10px;border-radius:7px;margin-right:6px;">? ' +
        _L('Как это работает', 'How it works') + '</button>' : ''),
      hfModeToggle,
      browserBtn,
      openFileBtn,
      '<button class="_etbv2_panel_close" style="background:none;border:none;',
      'color:var(--etb-tx2,#888);cursor:pointer;font-size:18px;padding:4px 8px;',
      'border-radius:6px;transition:background .1s;" title="Закрыть">&#10005;</button>'
    ].join('');
    panel.appendChild(hdr);

    // Wire "Open in Finder" click — copy path to clipboard as reliable cross-env action
    if (ui.filePath) {
      var openFileEl = hdr.querySelector('#_etb_open_file_btn');
      if (openFileEl) {
        openFileEl.onclick = function () {
          try { navigator.clipboard.writeText(String(ui.filePath)); } catch (_) {}
          openFileEl.title = 'Path copied!';
          setTimeout(function () { openFileEl.title = 'Copy file path: ' + _esc(String(ui.filePath)); }, 2000);
        };
      }
    }

    // Content area
    var content = document.createElement('div');
    content.style.cssText = 'flex:1;overflow:hidden;position:relative;';

    var uiType = ui.type || 'chat';
    var blobUrl = null;

    if (uiType === 'iframe' && ui.url) {
      var iframe = document.createElement('iframe');
      iframe.src = ui.url;
      iframe.style.cssText = 'width:100%;height:100%;border:none;display:block;';
      iframe.setAttribute('allow', 'clipboard-read;clipboard-write');
      content.appendChild(iframe);

    } else if (uiType === 'html' && ui.html) {
      var htmlBlob = new Blob([ui.html], { type: 'text/html' });
      blobUrl = URL.createObjectURL(htmlBlob);
      var iframe = document.createElement('iframe');
      // The Studio is bridge-only. An opaque sandboxed origin prevents its
      // scripts from reading host globals such as window._extellaApiToken.
      if (_isBuiltinCapabilityStudio()) {
        iframe.setAttribute('sandbox', 'allow-scripts');
      }
      iframe.src = blobUrl;
      iframe.style.cssText = 'width:100%;height:100%;border:none;display:block;';
      iframe.setAttribute('allow', 'clipboard-read;clipboard-write');
      iframe.addEventListener('load', function () {
        _wireIframeToken(iframe, function (token) {
          try {
            var initPayload = {
              type: 'etb_init',
              pluginId: plugin.id,
              apiBase: 'https://api.extella.ai',
              experts: plugin.experts || [],
              theme: _currentTheme(),
              lang: _currentLang()
            };
            // Bridge-only apps never receive the account credential.
            if (!ui.tokenless) initPayload.token = token;
            iframe.contentWindow.postMessage(initPayload, '*');
            _postThemeToIframe(iframe);
          } catch (e) {}
        });
      }, { once: true });
      _attachHealthWatchdog(iframe, content, plugin);
      content.appendChild(iframe);

    } else if (uiType === 'chat' || uiType === 'github') {
      var chatBlob = new Blob([_ETB_CHAT_HTML], { type: 'text/html' });
      blobUrl = URL.createObjectURL(chatBlob);
      var iframe = document.createElement('iframe');
      iframe.src = blobUrl;
      iframe.style.cssText = 'width:100%;height:100%;border:none;display:block;';
      iframe.setAttribute('allow', 'clipboard-read;clipboard-write');
      iframe.addEventListener('load', function () {
        _wireIframeToken(iframe, function (token) {
          try {
            iframe.contentWindow.postMessage(
              { type: 'etb_init', pluginId: plugin.id, token: token, theme: _currentTheme(), lang: _currentLang() },
              '*'
            );
            _postThemeToIframe(iframe);
          } catch (e) {}
        });
      }, { once: true });
      content.appendChild(iframe);

    } else if (uiType === 'form') {
      var formBlob = new Blob([_ETB_FORM_HTML], { type: 'text/html' });
      blobUrl = URL.createObjectURL(formBlob);
      var iframe = document.createElement('iframe');
      iframe.src = blobUrl;
      iframe.style.cssText = 'width:100%;height:100%;border:none;display:block;';
      iframe.setAttribute('allow', 'clipboard-read;clipboard-write');
      iframe.addEventListener('load', function () {
        _wireIframeToken(iframe, function (token) {
          try {
            iframe.contentWindow.postMessage(
              { type: 'etb_init', pluginId: plugin.id, token: token, theme: _currentTheme(), lang: _currentLang() },
              '*'
            );
            _postThemeToIframe(iframe);
          } catch (e) {}
        });
      }, { once: true });
      content.appendChild(iframe);

    } else if (uiType === 'local_server') {
      // Apps that block iframe embedding (X-Frame-Options / CSP frame-ancestors)
      // render as a black screen. The agent flags these as openInBrowser so we
      // show a clean card with an external-open button instead of a dead iframe.
      if (ui.openInBrowser) {
        _renderOpenExternalCard(content, plugin);
      } else if (ui.url) {
        // Хостинговый плагин: сервер на нашем VPS, открываем прямо в панели.
        // Без localhost-health и автостарта — состояние сервера не зависит от
        // устройства пользователя (первый пример: Бага, общая история команды).
        var hostedIframe = document.createElement('iframe');
        hostedIframe.style.cssText = 'width:100%;height:100%;border:none;display:block;';
        hostedIframe.setAttribute('allow', 'clipboard-read;clipboard-write');
        hostedIframe.src = ui.url;
        content.appendChild(hostedIframe);
      } else {
        var mainFile = (ui.mainFile && ui.mainFile !== 'index.html') ? ui.mainFile : '';
        var serverUrl = 'http://localhost:' + ui.port + (mainFile ? '/' + mainFile : '');
        var lsIframe = document.createElement('iframe');
        lsIframe.style.cssText = 'width:100%;height:100%;border:none;display:none;';
        lsIframe.setAttribute('allow', 'clipboard-read;clipboard-write');
        content.appendChild(lsIframe);
        _attachHealthWatchdog(lsIframe, content, plugin);
        _checkAndLoadServer(lsIframe, serverUrl, content, plugin);
      }

    } else {
      content.innerHTML = _renderInfoCard(plugin);
      var infoBtn = content.querySelector('[data-info-open]');
      if (infoBtn) infoBtn.onclick = function () {
        _openUrlExternal(infoBtn.getAttribute('data-info-open'));
      };
    }

    panel.appendChild(content);

    // Авто-показ «Как это работает» при ПЕРВОМ открытии поверхности (правило
    // §3.20). Дальше — по кнопке в шапке. Отложено, чтобы панель успела встать.
    if (_helpKey(plugin.id)) setTimeout(function () { helpFirstTime(plugin.id); }, 400);

    // Floating Repair overlay — always visible in the bottom-right corner.
    _injectRepairOverlay(content, plugin.id);

    // postMessage listeners scoped to this panel's iframe(s).
    function _srcIframe(e) {
      var iframes = content.querySelectorAll('iframe');
      for (var i = 0; i < iframes.length; i++) {
        try { if (iframes[i].contentWindow === e.source) return iframes[i]; } catch (_) {}
      }
      // Never fall back to an unrelated iframe. Every open plugin has its own
      // listener, so a fallback would duplicate privileged bridge calls.
      return null;
    }
    function _isBuiltinCapabilityStudio() {
      var builtins = ETB.registry && ETB.registry.getBuiltin ? ETB.registry.getBuiltin() : [];
      var canonical = builtins.filter(function (item) {
        return item && item.id === 'profit-growth-scenario';
      })[0];
      return Boolean(
        canonical &&
        plugin === canonical &&
        plugin.trust_tier === 'verified' &&
        ui.type === 'html' &&
        ui.tokenless === true
      );
    }
    var _pmHandler = function (e) {
      if (!e.data || typeof e.data.type !== 'string') return;
      if (e.data.type === 'etb_repair_request') {
        _showRepairModal(plugin.id, e.data.description || '');
      } else if (e.data.type === 'etb_config_request') {
        _showCredentialsModal(_srcIframe(e), e.data.fields, e.data.title);
      } else if (e.data.type === 'etb_run_expert') {
        // Expert bridge: the plugin iframe (localhost origin) cannot call
        // api.extella.ai directly (cross-origin → "Failed to fetch"). Run the
        // expert here in the toolbar context, which has API access, and post
        // the result back. The iframe never holds the token or hits the API.
        var src = _srcIframe(e);
        if (!src) return;
        var reqId = e.data.reqId;
        function reply(msg) { if (src && src.contentWindow) { try { src.contentWindow.postMessage(msg, '*'); } catch (_) {} } }
        if (_isBuiltinCapabilityStudio() &&
            (plugin.experts || []).indexOf(String(e.data.name || '')) === -1) {
          reply({ type: 'etb_expert_result', reqId: reqId, ok: false, error: 'expert is not allowed for Capability Studio' });
          return;
        }
        try {
          ETB.api.runExpert(e.data.name, e.data.params || {}, { global: true })
            .then(function (res) { reply({ type: 'etb_expert_result', reqId: reqId, ok: true, res: res }); })
            .catch(function (err) { reply({ type: 'etb_expert_result', reqId: reqId, ok: false, error: (err && err.message) || 'expert failed' }); });
        } catch (err) {
          reply({ type: 'etb_expert_result', reqId: reqId, ok: false, error: (err && err.message) || 'expert failed' });
        }
      } else if (e.data.type === 'etb_kv_get' || e.data.type === 'etb_kv_set') {
        // Scoped KV bridge: like the expert bridge, the iframe cannot reach
        // api.extella.ai directly. The toolbar performs the KV op with its own
        // session token — the SAME namespace the storefront reads — so a merch
        // edit is guaranteed visible. SECURITY: only keys prefixed '_mkt_' are
        // allowed, so a plugin can never read secrets (huggingface_token, …)
        // or write outside the merch surface.
        var src2 = _srcIframe(e);
        if (!src2) return;
        var reqId2 = e.data.reqId;
        var key = String(e.data.key || '');
        function reply2(msg) { if (src2 && src2.contentWindow) { try { src2.contentWindow.postMessage(msg, '*'); } catch (_) {} } }
        // + agent_runs:/cap_*_manifest: раньше гейт отбрасывал собственные данные
        // витрины — история запусков агентов и операции динамических CLI-тулов
        // были мертвы по конструкции у всех пользователей.
        var okMkt = key.indexOf('_mkt_') === 0;
        var okRuns = key.indexOf('agent_runs:') === 0;
        var okCapM = /^cap_[A-Za-z0-9_-]+_manifest$/.test(key);
        if (!okMkt && !okRuns && !okCapM) {
          reply2({ type: 'etb_kv_result', reqId: reqId2, ok: false, error: 'key not allowed' });
          return;
        }
        var scope2 = okRuns ? {} : { global: true };
        try {
          if (e.data.type === 'etb_kv_get') {
            ETB.api.kvGet(key, scope2)
              .then(function (r) { reply2({ type: 'etb_kv_result', reqId: reqId2, ok: true, value: (r && r.value != null) ? r.value : null }); })
              .catch(function (err) { reply2({ type: 'etb_kv_result', reqId: reqId2, ok: false, error: (err && err.message) || 'kv get failed' }); });
          } else {
            ETB.api.kvSet(key, e.data.value, e.data.description || 'Marketplace merch (toolbar editor)', scope2)
              .then(function () { reply2({ type: 'etb_kv_result', reqId: reqId2, ok: true }); })
              .catch(function (err) { reply2({ type: 'etb_kv_result', reqId: reqId2, ok: false, error: (err && err.message) || 'kv set failed' }); });
          }
        } catch (err) {
          reply2({ type: 'etb_kv_result', reqId: reqId2, ok: false, error: (err && err.message) || 'kv failed' });
        }
      } else if (e.data.type === 'etb_rule_add' || e.data.type === 'etb_rule_remove') {
        // Rules bridge: Skills install/uninstall as always-on agent rules. The
        // iframe can't reach the API directly; the toolbar performs the op with
        // the user's own credential. Skill rules carry a marker prefix so they
        // are identifiable; the plugin manages only what it added.
        var src3 = _srcIframe(e);
        if (!src3) return;
        var reqId3 = e.data.reqId;
        function reply3(msg) { if (src3 && src3.contentWindow) { try { src3.contentWindow.postMessage(msg, '*'); } catch (_) {} } }
        try {
          if (e.data.type === 'etb_rule_add') {
            ETB.api.rulesAdd(String(e.data.rule || ''), e.data.agents)
              .then(function (refs) { reply3({ type: 'etb_rule_result', reqId: reqId3, ok: !!(refs && refs.length), refs: refs || [] }); })
              .catch(function (err) { reply3({ type: 'etb_rule_result', reqId: reqId3, ok: false, error: (err && err.message) || 'rule add failed' }); });
          } else {
            ETB.api.rulesRemove(e.data.refs || e.data.ruleId)
              .then(function () { reply3({ type: 'etb_rule_result', reqId: reqId3, ok: true }); })
              .catch(function (err) { reply3({ type: 'etb_rule_result', reqId: reqId3, ok: false, error: (err && err.message) || 'rule remove failed' }); });
          }
        } catch (err) {
          reply3({ type: 'etb_rule_result', reqId: reqId3, ok: false, error: (err && err.message) || 'rule failed' });
        }
      } else if (e.data.type === 'etb_agents_list') {
        // Agents bridge: let the Skills UI ask which agent to install a skill on.
        var src4 = _srcIframe(e);
        if (!src4) return;
        var reqId4 = e.data.reqId;
        function reply4(msg) { if (src4 && src4.contentWindow) { try { src4.contentWindow.postMessage(msg, '*'); } catch (_) {} } }
        try {
          ETB.api.agentsList()
            .then(function (r) {
              var list = (r && r.agents) || [];
              var slim = list.map(function (a) {
                return {
                  id: a.id || a.agent_id,
                  name: a.name,
                  model: a.model,
                  provider: a.provider,
                  category: a.category
                };
              });
              reply4({ type: 'etb_agents_result', reqId: reqId4, ok: true, agents: slim });
            })
            .catch(function (err) { reply4({ type: 'etb_agents_result', reqId: reqId4, ok: false, error: (err && err.message) || 'agents list failed' }); });
        } catch (err) {
          reply4({ type: 'etb_agents_result', reqId: reqId4, ok: false, error: (err && err.message) || 'agents failed' });
        }
      } else if (e.data.type === 'etb_agent_control') {
        // Agent Control Center bridge. The tokenless iframe can request only
        // schema-bound control-plane operations; all API access, account
        // validation, hashing and verified KV read-back remain in the host.
        var src7 = _srcIframe(e);
        if (!src7) return;
        var reqId7 = e.data.reqId;
        function reply7(msg) {
          if (src7 && src7.contentWindow) {
            try { src7.contentWindow.postMessage(msg, '*'); } catch (_) {}
          }
        }
        if (!_isBuiltinCapabilityStudio()) {
          reply7({
            type: 'etb_agent_control_result',
            reqId: reqId7,
            ok: false,
            error: 'bridge not granted to this plugin'
          });
          return;
        }
        _agentControlAction(e.data).then(function (result) {
          reply7({
            type: 'etb_agent_control_result',
            reqId: reqId7,
            ok: true,
            result: result
          });
        }).catch(function (error) {
          reply7({
            type: 'etb_agent_control_result',
            reqId: reqId7,
            ok: false,
            error: (error && error.message) || 'Agent Control operation failed',
            errorCode: error && error.code || null
          });
        });
      } else if (e.data.type === 'etb_governance_probe') {
        // Capability Studio's bounded governance lab. It may manage only
        // temporary objects carrying its own high-entropy marker.
        var src6 = _srcIframe(e);
        if (!src6) return;
        var reqId6 = e.data.reqId;
        var marker6 = String(e.data.marker || '').toUpperCase();
        var action6 = String(e.data.action || '');
        var version6 = e.data.version === 'V2' ? 'V2' : 'V1';
        var owner6 = String(e.data.ownerAgentId || '');
        var viewer6 = String(e.data.viewerAgentId || owner6);
        function reply6(msg) {
          if (src6 && src6.contentWindow) {
            try { src6.contentWindow.postMessage(msg, '*'); } catch (_) {}
          }
        }
        if (!_isBuiltinCapabilityStudio()) {
          reply6({ type: 'etb_governance_result', reqId: reqId6, ok: false, error: 'bridge not granted to this plugin' });
          return;
        }
        if (!/^XTL-STUDIO-GOV-[A-Z0-9_-]{8,64}$/.test(marker6)) {
          reply6({ type: 'etb_governance_result', reqId: reqId6, ok: false, error: 'invalid studio marker' });
          return;
        }
        if (!owner6 || !viewer6 || owner6 === viewer6) {
          reply6({ type: 'etb_governance_result', reqId: reqId6, ok: false, error: 'two distinct agent ids required' });
          return;
        }
        var threshold6 = version6 === 'V2' ? 2500 : 1500;
        var conceptText6 = marker6 + ' CONCEPT: contribution margin includes COGS, returns, commission, logistics and advertising. This is temporary Capability Studio evidence.';
        var ruleText6 = marker6 + ' POLICY_' + version6 + ': margin_bps >= ' + threshold6 +
          ' => SCALE; otherwise HOLD. Explicit loader required. external_writes=false.';
        function ruleRows6(r) { return (r && (r.results || r.rules)) || []; }
        function conceptValue6(row) { return String((row && (row.text || row.concept_text)) || ''); }
        function ruleValue6(row) { return String((row && row.rule) || ''); }
        function id6(row) { return row && (row.id != null ? row.id : (row.concept_id != null ? row.concept_id : row.rule_id)); }
        function ensureOk6(r, label) { return _studioApiOk(r, label); }
        function validateAgentIds6(requireViewer) {
          return ETB.api.agentsList().then(function (response) {
            ensureOk6(response, 'agents list');
            var ids = ((response && response.agents) || []).map(function (agent) {
              return String(agent && (agent.id || agent.agent_id) || '');
            });
            if (ids.indexOf(owner6) === -1) throw new Error('owner agent is not present in this account');
            if (requireViewer && ids.indexOf(viewer6) === -1) throw new Error('viewer agent is not present in this account');
          });
        }
        function read6(agentId) {
          return Promise.all([
            _studioListAllConcepts({ agentId: agentId, global: true }),
            ETB.api.ruleListScoped({ agentId: agentId, global: true })
          ]).then(function (rows) {
            ensureOk6(rows[1], 'rule list');
            var concepts = rows[0].filter(function (row) {
              return conceptValue6(row).indexOf(marker6) === 0;
            });
            var rules = ruleRows6(rows[1]).filter(function (row) {
              return ruleValue6(row).indexOf(marker6) === 0;
            });
            return { concepts: concepts, rules: rules };
          });
        }
        function result6(rows, agentId) {
          var concept = rows.concepts[0] || null;
          var rule = rows.rules[0] || null;
          return {
            agentId: agentId,
            marker: marker6,
            concept: concept ? { id: id6(concept), global: concept.global === true, text: conceptValue6(concept) } : null,
            rule: rule ? { id: id6(rule), global: rule.global === true, rule: ruleValue6(rule) } : null
          };
        }
        var session6 = {
          marker: marker6,
          ownerAgentId: owner6,
          viewerAgentId: viewer6,
          userId: _studioCurrentUserId(),
          profileId: 'default',
          hostInstanceId: STUDIO_HOST_INSTANCE,
          createdAt: new Date().toISOString()
        };
        if (!session6.userId) {
          reply6({ type: 'etb_governance_result', reqId: reqId6, ok: false, error: 'authenticated Studio account is required' });
          return;
        }
        var operation6;
        if (action6 === 'create') {
          operation6 = _studioSerialize(marker6, function () {
            var sessionSaved6 = false;
            var primary6 = validateAgentIds6(true).then(function () {
              _studioSessionSave(session6);
              sessionSaved6 = true;
              return read6(owner6);
            }).then(function (existing) {
              var tasks = [];
              if (!existing.concepts.length) {
                tasks.push(ETB.api.conceptAddScoped(conceptText6, { agentId: owner6, global: true }).then(function (r) {
                  return ensureOk6(r, 'concept add');
                }));
              }
              if (!existing.rules.length) {
                tasks.push(ETB.api.ruleAddScoped(ruleText6, { agentId: owner6, global: true }).then(function (r) {
                  return ensureOk6(r, 'rule add');
                }));
              } else if (ruleValue6(existing.rules[0]) !== ruleText6) {
                tasks.push(ETB.api.ruleUpdateScoped(id6(existing.rules[0]), ruleText6, { agentId: owner6 }).then(function (r) {
                  return ensureOk6(r, 'rule restore');
                }));
              }
              return Promise.all(tasks).then(function () { return read6(owner6); });
            }).then(function (rows) { return result6(rows, owner6); });

            function settleClosed6(result, originalError) {
              if (!panel.__etbStudioClosing || !sessionSaved6) {
                if (originalError) throw originalError;
                return result;
              }
              return _studioConfirmedCleanupNow(session6).then(function () {
                throw originalError || new Error('Studio closed; temporary objects were cleaned');
              }, function (cleanupError) {
                var base = originalError && originalError.message ?
                  originalError.message : 'Studio closed during governance create';
                throw new Error(base + '; automatic cleanup pending: ' +
                  ((cleanupError && cleanupError.message) || 'unknown cleanup error'));
              });
            }

            return primary6.then(function (result) {
              return settleClosed6(result, null);
            }, function (error) {
              return settleClosed6(null, error);
            });
          });
        } else if (action6 === 'verify') {
          operation6 = _studioSerialize(marker6, function () {
            return validateAgentIds6(true).then(function () { return read6(viewer6); })
              .then(function (rows) { return result6(rows, viewer6); });
          });
        } else if (action6 === 'update') {
          operation6 = _studioSerialize(marker6, function () {
            return validateAgentIds6(true).then(function () { return read6(owner6); }).then(function (rows) {
              if (!rows.rules.length) throw new Error('studio rule not found');
              return ETB.api.ruleUpdateScoped(id6(rows.rules[0]), ruleText6, { agentId: owner6 })
                .then(function (r) { ensureOk6(r, 'rule update'); return read6(owner6); });
            }).then(function (rows) { return result6(rows, owner6); });
          });
        } else if (action6 === 'cleanup') {
          operation6 = validateAgentIds6(false).then(function () {
            return _studioConfirmedCleanup(session6);
          });
        } else {
          reply6({ type: 'etb_governance_result', reqId: reqId6, ok: false, error: 'unsupported governance action' });
          return;
        }
        operation6.then(function (result) {
          reply6({ type: 'etb_governance_result', reqId: reqId6, ok: true, result: result });
        }).catch(function (err) {
          reply6({ type: 'etb_governance_result', reqId: reqId6, ok: false, error: (err && err.message) || 'governance probe failed' });
        });
      } else if (e.data.type === 'etb_run_agent') {
        // Fan out one validated result to selected agents. The iframe never
        // receives the token, and workers cannot rerun the underlying Expert.
        var src5 = _srcIframe(e);
        if (!src5) return;
        var reqId5 = e.data.reqId;
        var started5 = Date.now();
        function reply5(msg) {
          if (src5 && src5.contentWindow) {
            try { src5.contentWindow.postMessage(msg, '*'); } catch (_) {}
          }
        }
        if (!_isBuiltinCapabilityStudio()) {
          reply5({ type: 'etb_agent_result', reqId: reqId5, ok: false, latencyMs: Date.now() - started5, error: 'bridge not granted to this plugin' });
          return;
        }
        var message5 = String(e.data.message || '');
        var agent5 = String(e.data.agentId || e.data.agent_id || '');
        if (!message5 || !agent5) {
          reply5({
            type: 'etb_agent_result',
            reqId: reqId5,
            ok: false,
            error: !agent5 ? 'agent id required' : 'message required'
          });
          return;
        }
        if (message5.length > 12000) {
          reply5({
            type: 'etb_agent_result',
            reqId: reqId5,
            ok: false,
            latencyMs: Date.now() - started5,
            error: 'message exceeds Studio limit'
          });
          return;
        }
        try {
          ETB.api.agentsList().then(function (listResponse) {
            _studioApiOk(listResponse, 'agents list');
            var selected = null;
            ((listResponse && listResponse.agents) || []).some(function (agent) {
              if (String(agent && (agent.id || agent.agent_id) || '') !== agent5) return false;
              selected = agent;
              return true;
            });
            if (!selected) throw new Error('agent is not present in this account');
            var signature = [
              selected.name,
              selected.provider,
              selected.model
            ].join(' ').toLowerCase();
            if (/(claude|anthropic)/.test(signature)) {
              throw new Error('Anthropic models are disabled for this Studio scenario');
            }
            return ETB.api.runAgent(message5, {
              agent_id: agent5,
              run_timeout: _studioBoundedNumber(e.data.runTimeout, 180, 10, 180),
              store: false,
              temperature: 0,
              max_output_tokens: _studioBoundedNumber(e.data.maxOutputTokens, 700, 128, 900),
              tool_choice: 'none',
              tools: []
            });
          }).then(function (res) {
            var answer = '';
            try { answer = ETB.api.extractAgentText(res); }
            catch (extractErr) {
              reply5({
                type: 'etb_agent_result',
                reqId: reqId5,
                ok: false,
                responseId: res && (res.id || res.response_id),
                latencyMs: Date.now() - started5,
                error: (extractErr && extractErr.message) || 'empty agent result'
              });
              return;
            }
            reply5({
              type: 'etb_agent_result',
              reqId: reqId5,
              ok: true,
              responseId: res && (res.id || res.response_id),
              status: res && res.status,
              model: res && res.model,
              usage: (res && (res.usage || res.token_usage)) || null,
              latencyMs: Date.now() - started5,
              answer: String(answer || '').slice(0, 8000)
            });
          }).catch(function (err) {
            reply5({
              type: 'etb_agent_result',
              reqId: reqId5,
              ok: false,
              latencyMs: Date.now() - started5,
              error: (err && err.message) || 'agent failed'
            });
          });
        } catch (err) {
          reply5({
            type: 'etb_agent_result',
            reqId: reqId5,
            ok: false,
            latencyMs: Date.now() - started5,
            error: (err && err.message) || 'agent failed'
          });
        }
      } else if (e.data.type === 'etb_plugin_action' && e.data.action === 'open' && e.data.pluginId) {
        // Плагин просит открыть ДРУГОЙ установленный плагин окном приложения.
        // Без этого встроенные UI (Визард → «Воркспейсес») делали window.open,
        // а хост уводил 127.0.0.1 во внешний браузер (setWindowOpenHandler).
        // Слушатель marketplace к этому моменту снят (оверлей Plugins закрыт),
        // поэтому просьбу обслуживает панель. Источник проверяем СТРОГО по
        // contentWindow — иначе сработали бы обработчики всех кэшированных панелей.
        var srcOk = false, _ifr = content.querySelectorAll('iframe');
        for (var _k = 0; _k < _ifr.length; _k++) {
          try { if (_ifr[_k].contentWindow === e.source) { srcOk = true; break; } } catch (_) {}
        }
        if (srcOk) ETB.router.openById(String(e.data.pluginId), { returnTo: 'plugins' });
      }
    };
    window.addEventListener('message', _pmHandler);
    // Store handler on panel element for cleanup on panel eviction.
    panel.__etbPmHandler = _pmHandler;
    if (_isBuiltinCapabilityStudio()) {
      panel.__etbStudioClosing = false;
      panel.__etbBeforeHide = function () {
        panel.__etbStudioClosing = true;
        var session = _studioSessionLoad();
        if (!session || session.hostInstanceId !== STUDIO_HOST_INSTANCE) return Promise.resolve(null);
        if (panel.__etbStudioCleanupPromise) return panel.__etbStudioCleanupPromise;
        panel.__etbStudioCleanupPromise = _studioConfirmedCleanup(session).then(function (result) {
          var target = content.querySelector('iframe');
          if (target && target.contentWindow) {
            try {
              target.contentWindow.postMessage({
                type: 'etb_governance_auto_cleanup',
                ok: true,
                result: result
              }, '*');
            } catch (_) {}
          }
          panel.__etbStudioCleanupPromise = null;
          return result;
        }).catch(function (error) {
          panel.__etbStudioCleanupPromise = null;
          throw error;
        });
        return panel.__etbStudioCleanupPromise;
      };
    }

    hdr.querySelector('._etbv2_panel_close').onclick = function () {
      ETB.router.close();
    };

    return { panel: panel, blobUrl: blobUrl };
  }

  // Мини-рендер markdown для завендоренных инструкций (guide): заголовки,
  // списки, жирный, `код`. Без внешних библиотек; всё экранируется.
  function _renderGuideMd(md) {
    var out = [], inList = false;
    String(md || '').split('\n').forEach(function (line) {
      var t = line.trim();
      var h = t.match(/^(#{1,3})\s+(.*)$/);
      var li = t.match(/^[-*]\s+(.*)$/);
      function fmt(s) {
        return _esc(s)
          .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
          .replace(/`([^`]+)`/g, '<code style="background:rgba(140,140,140,.18);padding:1px 5px;border-radius:4px;font-size:12px;">$1</code>')
          .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" style="color:#C67E34;word-break:break-all;">$1</a>');
      }
      if (!li && inList) { out.push('</ul>'); inList = false; }
      if (h) {
        var lvl = h[1].length;
        out.push('<div style="font-size:' + (lvl === 1 ? 16 : 14) + 'px;font-weight:700;color:var(--etb-tx,#f0f0f0);margin:' + (lvl === 1 ? '0 0 10px' : '18px 0 8px') + ';">' + fmt(h[2]) + '</div>');
      } else if (li) {
        if (!inList) { out.push('<ul style="margin:0 0 10px;padding-left:20px;">'); inList = true; }
        out.push('<li style="margin:3px 0;">' + fmt(li[1]) + '</li>');
      } else if (t) {
        out.push('<div style="margin:0 0 10px;">' + fmt(t) + '</div>');
      }
    });
    if (inList) out.push('</ul>');
    return out.join('');
  }

  function _renderInfoCard(plugin) {
    // mode:"info" — карточка-указатель (пример: Агент 1С у коллег): описание +
    // кнопка на инструкцию во внешнем браузере. Если в карточке есть guide
    // (завендоренный текст) — инструкция рендерится ПРЯМО в панели, без
    // GitHub-доступа; внешняя ссылка остаётся второй кнопкой.
    var src = String(plugin.source || '');
    var isLink = /^https?:\/\//.test(src);
    var isPrivateRepo = /github\.com\//.test(src);
    if (plugin.guide) {
      return [
        '<div style="height:100%;overflow:auto;padding:28px 32px;font-family:-apple-system,system-ui,sans-serif;">',
        '<div style="max-width:640px;margin:0 auto;font-size:13px;line-height:1.65;color:var(--etb-tx2,#bbb);">',
        _renderGuideMd(plugin.guide),
        isLink ? [
          '<div style="margin-top:20px;padding-top:16px;border-top:1px solid rgba(140,140,140,.25);">',
          '<button data-info-open="', _esc(src), '" style="min-height:36px;padding:8px 14px;',
          'background:transparent;color:var(--etb-tx,#f0f0f0);border:1px solid rgba(140,140,140,.45);border-radius:9px;font-size:12px;cursor:pointer;">',
          _L('Открыть в GitHub (нужен доступ)', 'Open on GitHub (access required)'), '</button></div>'
        ].join('') : '',
        '</div></div>'
      ].join('');
    }
    return [
      '<div style="display:flex;align-items:center;justify-content:center;',
      'height:100%;padding:32px;font-family:-apple-system,system-ui,sans-serif;">',
      '<div style="max-width:440px;text-align:center;">',
      '<div style="margin-bottom:16px;color:#C67E34"><svg class="lico" style="width:40px;height:40px"><use href="#ic-box"/></svg></div>',
      '<div style="font-size:18px;font-weight:700;color:var(--etb-tx,#f0f0f0);margin-bottom:8px;">',
      _esc(plugin.name), '</div>',
      '<div style="font-size:13px;color:var(--etb-tx2,#888);line-height:1.6;margin-bottom:24px;">',
      _esc(plugin.description || ''), '</div>',
      isLink ? [
        '<button data-info-open="', _esc(src), '" style="min-height:40px;padding:10px 18px;',
        'background:#C67E34;color:#000;border:none;border-radius:9px;font-size:13px;font-weight:700;cursor:pointer;">',
        _L('Открыть инструкцию', 'Open the guide'), '</button>',
        isPrivateRepo ? [
          '<div style="font-size:11px;color:var(--etb-tx2,#888);margin-top:12px;line-height:1.5;">',
          _L('Репозиторий приватный: если увидите 404 — запросите доступ у Анвара.',
             'The repository is private: if you see a 404, ask Anvar for access.'), '</div>'
        ].join('') : ''
      ].join('') : [
        '<div style="font-size:11px;color:#C67E34;">',
        _L('Плагин загружен. Работай с ним через чат Extella.', 'Plugin loaded. Use Extella chat to interact with this plugin.'),
        '</div>'
      ].join(''),
      '</div></div>'
    ].join('');
  }

  function _L(ru, en) { try { return localStorage.getItem('etb_lang') === 'en' ? en : ru; } catch (e) { return ru; } }
  function _esc(s) {
    return String(s || '').replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ── «? Как это работает» (правило продукта §3.20) ──────────────────────────
  // Единое окно из 4 частей на каждую поверхность: как работает, что
  // гарантировано, чего мы НЕ обещаем (границы — обязательны), кто раскрывает/
  // откатывает. Тексты — в одном справочнике XTL_HELP по plugin.id: добавить
  // пояснение новой поверхности = дописать запись, не верстать окно заново.
  // Урок: предел клиент должен узнать ОТ НАС, а не в проде.
  var XTL_HELP = {
    extella_connectors: {
      title: 'Как работают «Подключения»',
      sub: 'Ваши сервисы, CRM и рекламные кабинеты — один контур доступа для агентов',
      steps: [
        'Вы подключаете <b>свой</b> Composio: регистрируетесь, вставляете Project API key — открывается каталог из тысячи сервисов.',
        'Подключаете нужный сервис (Gmail, Slack, CRM…) через безопасное окно входа.',
        'Отдельно выдаёте выбранному агенту доступ — по умолчанию только на чтение.',
        'Агент пользуется подключением через мост Extella и получает лишь результат разрешённого действия.'
      ],
      sure: [
        'У каждого пользователя <b>свой</b> ключ Composio и свой зашифрованный сейф.',
        'Доступ агентов — <b>deny by default</b>: подключение сервиса само по себе прав не даёт.',
        'Есть журнал действий; выданный доступ отзывается в один клик и действует на агентов сразу.',
        'Ключ хранится только как шифротекст — в открытом виде агентам и в интерфейс не возвращается.'
      ],
      nope: [
        'Любое действие с записью или отправкой наружу требует <b>отдельного разрешения и подтверждения</b> — молча наружу ничего не уходит.',
        'Пароли и токены подключённых сервисов держит Composio, а не мы; мы их не храним в открытом виде.',
        'Каталог сервисов и их доступность зависят от Composio API — если сервис у них сменил условия, это отразится здесь.'
      ],
      who: { title: 'Кто раскрывает и откатывает', items: [
        'Доступ выдаёте и отзываете вы сами во вкладке «Доступ» — по конкретным действиям.',
        'Отзыв доступа немедленно прекращает возможность агента, перезапуск не нужен.'
      ]}
    },
    extella_predictive_sales: {
      title: 'Как работает Predictive Sales',
      sub: 'Ваша воронка Bitrix24 с AI-прогнозами — данные остаются у вас',
      steps: [
        'Вы подключаете <b>свой</b> входящий webhook Bitrix24 во вкладке «Подключения» кокпита.',
        'Кокпит показывает сделки воронки, работает поиск и фильтры по стадиям.',
        'AI-скоринг даёт рабочий шанс, риски и следующее действие по сделке.'
      ],
      sure: [
        'Подключение и накопленные оценки хранятся <b>локально у вас</b>, webhook — в вашем защищённом хранилище.',
        'Любая запись в CRM — только по схеме предпросмотр → ваше подтверждение → запись → сверка.',
        'Показывается вся выбранная воронка, включая сделки, созданные вне Predictive Sales.'
      ],
      nope: [
        'Без подключённого webhook воронка <b>пустая</b> — это не поломка, а отсутствие источника.',
        'AI-прогноз — это оценка вероятности, а не гарантия исхода сделки; путать их нельзя.',
        'Мы не пишем оценки обратно в CRM автоматически и не ищем персональные телефоны/почты.'
      ],
      who: { title: 'Кто раскрывает и откатывает', items: [
        'Webhook подключаете вы; любую запись в CRM подтверждаете тоже вы.',
        'Отключить источник можно в настройках кокпита — данные воронки перестанут обновляться.'
      ]}
    },
    targetologist_local: {
      title: 'Как работает Таргетолог AI',
      sub: 'Брифы, медиапланы и кампании — ваши рекламные кабинеты и данные',
      steps: [
        'Вы подключаете <b>свои</b> кабинеты: VK Ads, Meta, Google Ads, GA4 — ключи ложатся в ваш Keychain.',
        'Из брифа собирается медиаплан, затем черновик кампании.',
        'После вашего одобрения — переход к чтению метрик и ежедневному отчёту.'
      ],
      sure: [
        'Ключи кабинетов и данные кампаний — <b>только на вашей машине</b>.',
        'Любая внешняя запись или отправка — <b>только после явного approval</b>.',
        'Google Ads и GA4 в текущей версии работают на чтение.'
      ],
      nope: [
        'Без подключённых кабинетов живых данных нет — интерфейс откроется, но цифры не появятся.',
        'Черновики кампаний <b>не публикуются сами</b> — публикацию запускает человек.',
        'Это инструмент таргетолога, а не замена согласованию с площадками и клиентом.'
      ],
      who: { title: 'Кто раскрывает и откатывает', items: [
        'Кабинеты подключаете вы; каждую отправку наружу одобряете вы.',
        'Ключ кабинета отзывается на стороне самого кабинета — доступ прекращается.'
      ]}
    },
    extella_contract_agent: {
      title: 'Как работает Агент по договорам',
      sub: 'Проверка и согласование договоров с контролем человека',
      steps: [
        'Вы загружаете договор.',
        'Агент находит риски и скрытые условия, готовит протокол разногласий.',
        'Вы правите и решаете, что отправлять контрагенту.'
      ],
      sure: [
        'Документы остаются <b>на вашей машине</b>.',
        'Наружу — только черновики: письмо или протокол отправляет человек.',
        'Разбор опирается на загруженную нормативную базу вашего контура.'
      ],
      nope: [
        'Без подключённой базы Гражданского кодекса разбор будет <b>без ссылок на конкретные статьи</b>.',
        'Это помощник, а не юрист: итоговое решение и ответственность — за человеком.',
        'Мы не отправляем письма контрагенту автоматически.'
      ],
      who: { title: 'Кто раскрывает и откатывает', items: [
        'Отправку любого документа наружу выполняете вы.',
        'Базу и настройки контура заводит владелец.'
      ]}
    },
    extella_travel_agency: {
      title: 'Как работает «Турагентство»',
      sub: 'Заявки, предложения, документы и сообщения клиентам в одном контуре',
      steps: [
        'Заявка клиента попадает в контур.',
        'Идёт подбор и подготовка предложения, документы и переписка — в одном месте.',
        'Эксперты аккаунта помогают на каждом шаге.'
      ],
      sure: [
        'Профильные эксперты уже подключены к вашему аккаунту.',
        'Загрузки и договоры клиентов остаются <b>на вашей машине</b>.',
        'Сообщения клиентам автоматически не отправляются.'
      ],
      nope: [
        'Живой поиск туров <b>сейчас недоступен</b>: ключ Tourvisor истёк — интерфейс работает, но реальные туры появятся после нового ключа от владельца.',
        'Это рабочий контур агентства, а не замена договорённостям с туроператором.',
        'Персональные контакты клиентов мы не ищем и не угадываем.'
      ],
      who: { title: 'Кто раскрывает и откатывает', items: [
        'Ключ Tourvisor обновляет владелец — тогда включается живой поиск.',
        'Отправку клиенту выполняет человек.'
      ]}
    },
    extella_1c_agent: {
      title: 'Как работает Агент 1С',
      sub: 'Безопасное чтение живой 1С 8.3 через выделенного Qwen-агента',
      steps: [
        'Установщик записывает подключение к 1С в зашифрованное хранилище Extella.',
        'Вы спрашиваете об остатках, регистрах, документах.',
        'Первый запрос — интроспекция схемы базы, дальше идут чтения.'
      ],
      sure: [
        'Режим <b>только чтение</b>: запись, проведение и удаление не выполняются.',
        'Пароль подключения хранится как шифротекст, не попадает в код, чат и логи.',
        'Работает выделенный Qwen-агент; платный Claude для этого сценария запрещён.'
      ],
      nope: [
        'Запись и проведение документов <b>не реализованы</b> — это сознательная граница.',
        'Нужна Windows-машина с лицензионной 1С 8.3 и правом внешнего соединения.',
        'Названия регистров у разных конфигураций отличаются — агент сначала уточняет схему, а не угадывает.'
      ],
      who: { title: 'Кто раскрывает и откатывает', items: [
        'Устанавливает и подключает 1С владелец на Windows-стенде.',
        'Расширение прав (запись) — отдельное решение, в этой версии его нет.'
      ]}
    },
    'profit-growth-scenario': {
      title: { ru: 'Как работает Центр управления агентами', en: 'How the Agent Control Center works' },
      sub: {
        ru: 'Управляемая версия конфигурации агентов: черновик → проверка → публикация → запуск → откат',
        en: 'A managed version of your agents’ configuration: draft → test → publish → run → rollback'
      },
      steps: {
        ru: [
          'Выбираете двух подтверждённых Qwen-агентов; хост сверяет их точный ID, провайдера и модель.',
          'Снимается baseline-версия: снимок агентов, концепты и правила, видимые эксперты — с полными хэшами.',
          'Правите правило как <b>черновик</b> и проверяете его на полигоне (например, кейсы маржи 18/20/30%).',
          'Публикация возможна только при неизменном черновике и пройденной проверке; один коммит переключает конфигурацию.',
          'Каждый запуск даёт квитанцию (кто, когда, версия, сработавшие правила); откат возвращает точную прежнюю версию.'
        ],
        en: [
          'You pick two verified Qwen agents; the host re-checks their exact ID, provider and model.',
          'A baseline version is captured: agent snapshot, concepts and rules, visible experts — with full hashes.',
          'You edit a rule as a <b>draft</b> and test it on the playground (e.g. margin cases 18/20/30%).',
          'Publish is allowed only with an unchanged draft and a passed test; one commit switches the configuration.',
          'Every run yields a receipt (who, when, version, fired rules); rollback restores the exact prior version.'
        ]
      },
      sure: {
        ru: [
          'Каждая версия и каждый запуск связаны точными хэшами SHA-256 — видно, что именно опубликовано и откуда.',
          'Полигон проверяет правило <b>без вызова агента и эксперта и без внешних записей</b> (ноль записей).',
          'Работают только подтверждённые Qwen-агенты; Claude/Anthropic исключены.',
          'Публикация — только при неизменном черновике и пройденной проверке; откат возвращает точную прежнюю версию.'
        ],
        en: [
          'Every version and run are bound by exact SHA-256 hashes — you see what was published and from where.',
          'The playground checks a rule <b>without calling the agent or expert and with no external writes</b> (zero writes).',
          'Only verified Qwen agents run; Claude/Anthropic are excluded.',
          'Publish only with an unchanged draft and a passed test; rollback restores the exact prior version.'
        ]
      },
      nope: {
        ru: [
          'Это <b>управляемая надстройка</b>, а не встроенное версионирование агентов в самой Extella — платформа не исполняет версии нативно.',
          'Ролей и прав (RBAC) пока нет: уровень организации <b>виден, но заблокирован</b> до появления реестра/ролей платформы.',
          'Журнал <b>не защищён от подделки</b> (нет tamper-evidence) — это доказуемость через хэши, а не криптографическая неизменяемость.',
          'Полигон проверяет срабатывание правила, но не запускает реального агента — это не сквозной прогон боевого действия.'
        ],
        en: [
          'This is a <b>managed layer</b>, not native agent versioning inside Extella — the platform does not execute versions natively.',
          'There are no roles/RBAC yet: the organization scope is <b>visible but locked</b> until the platform has a registry/roles.',
          'The audit log is <b>not tamper-evident</b> — it is provable via hashes, not cryptographic immutability.',
          'The playground checks that a rule fires, but does not run the real agent — it is not an end-to-end live action.'
        ]
      },
      who: {
        title: { ru: 'Кто раскрывает и откатывает', en: 'Who publishes and rolls back' },
        items: {
          ru: [
            'Публикацию и откат выполняете вы; один коммит переключает конфигурацию обоих агентов.',
            'Откат возвращает точную неизменную прежнюю версию — без создания копии.'
          ],
          en: [
            'You publish and roll back; one commit switches both agents’ configuration.',
            'Rollback restores the exact immutable prior version — without making a copy.'
          ]
        }
      }
    }
  };
  // Синонимы id (локальные копии, team-версии) → та же запись справки.
  var _HELP_ALIAS = {
    extella_predictive_sales_local: 'extella_predictive_sales',
    targetologist_team: 'targetologist_local'
  };
  function _helpKey(id) {
    id = String(id || '');
    if (XTL_HELP[id]) return id;
    if (_HELP_ALIAS[id] && XTL_HELP[_HELP_ALIAS[id]]) return _HELP_ALIAS[id];
    return null;
  }
  function _helpCard(accent) {
    return '<div style="border:1px solid rgba(140,140,140,.28);border-left:3px solid ' +
      (accent || 'rgba(140,140,140,.5)') + ';border-radius:8px;padding:14px 16px;margin-bottom:12px;background:var(--etb-s1,#141414);">';
  }
  function openHelp(id) {
    var key = _helpKey(id); if (!key) return;
    var d = XTL_HELP[key];
    var back = document.getElementById('_etb_help_ov');
    if (!back) {
      back = document.createElement('div');
      back.id = '_etb_help_ov';
      back.style.cssText = 'position:fixed;inset:0;z-index:2147483646;background:rgba(10,10,12,.62);overflow:auto;padding:36px 18px;';
      back.addEventListener('click', function (e) { if (e.target === back) closeHelp(); });
      document.body.appendChild(back);
    }
    // Двуязычие (правило §3.26): поле может быть строкой/массивом (одноязычная
    // запись) или {ru, en} — тогда берём язык интерфейса. _pick разворачивает.
    var _pick = function (v) {
      if (v && !Array.isArray(v) && typeof v === 'object' && v.ru !== undefined) return _L(v.ru, v.en);
      return v;
    };
    var list = function (arr, acc, title) {
      return _helpCard(acc) + '<div style="font-weight:700;font-size:13.5px;color:var(--etb-tx,#f0f0f0);margin-bottom:8px;">' + _esc(_pick(title)) +
        '</div><div style="font-size:12.5px;line-height:1.7;color:var(--etb-tx,#e8e8e8);">• ' + _pick(arr).join('<br>• ') + '</div></div>';
    };
    var steps = _helpCard('') + '<div style="font-weight:700;font-size:13.5px;color:var(--etb-tx,#f0f0f0);margin-bottom:8px;">' +
      _L('Как это работает', 'How it works') + '</div><div style="font-size:12.5px;line-height:1.65;color:var(--etb-tx,#e8e8e8);">' +
      _pick(d.steps).map(function (s, i) { return '<b>' + (i + 1) + '.</b> ' + s; }).join('<br>') + '</div></div>';
    var html = '<div style="max-width:560px;margin:0 auto;background:var(--etb-bg,#0d0d0f);border:1px solid rgba(140,140,140,.4);border-radius:14px;padding:22px 22px 18px;box-shadow:0 20px 60px rgba(0,0,0,.5);">' +
      '<div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:16px;">' +
      '<div style="flex:1;"><div style="font:700 18px system-ui;color:var(--etb-tx,#f0f0f0);">' + _esc(_pick(d.title)) + '</div>' +
      '<div style="font-size:12px;color:var(--etb-tx2,#999);margin-top:3px;">' + _esc(_pick(d.sub)) + '</div></div>' +
      '<button onclick="ETB.router.closeHelp()" style="background:none;border:none;color:var(--etb-tx2,#999);font-size:20px;cursor:pointer;padding:0 4px;">&times;</button></div>' +
      steps +
      list(d.sure, '#4b7f52', _L('Что гарантировано', 'Guaranteed')) +
      list(d.nope, '#b8862f', _L('Чего мы НЕ обещаем — важно знать', 'What we do NOT promise')) +
      (d.who ? list(d.who.items, '#4a6fa5', d.who.title) : '') +
      '</div>';
    back.innerHTML = html;
    back.style.display = 'block';
  }
  function closeHelp() {
    var b = document.getElementById('_etb_help_ov');
    if (b) b.style.display = 'none';
  }
  function helpFirstTime(id) {
    var key = _helpKey(id); if (!key) return;
    try {
      if (localStorage.getItem('_etb_help_seen_' + key) === '1') return;
      localStorage.setItem('_etb_help_seen_' + key, '1');
    } catch (e) {}
    openHelp(key);
  }

  // ── Repair / Credentials modals ────────────────────────────────────────────

  // Shared modal backdrop + card builder. Returns { backdrop, card }.
  function _buildModalShell(onBackdropClick) {
    var bd = document.createElement('div');
    bd.style.cssText = [
      'position:fixed;inset:0;z-index:2147483647;',
      'background:rgba(0,0,0,.45);backdrop-filter:blur(4px);',
      'display:flex;align-items:center;justify-content:center;',
      'animation:_etbv2_gh_fade .14s ease;',
      'font-family:-apple-system,system-ui,sans-serif;'
    ].join('');
    if (onBackdropClick) bd.addEventListener('click', function (e) {
      if (e.target === bd) onBackdropClick();
    });
    var card = document.createElement('div');
    card.style.cssText = [
      'background:var(--etb-s1,#fff);border:1px solid var(--etb-bd2,rgba(0,0,0,.14));',
      'border-radius:8px;width:440px;max-width:calc(100vw - 32px);',
      'box-shadow:none;overflow:hidden;'
    ].join('');
    bd.appendChild(card);
    document.body.appendChild(bd);
    return { backdrop: bd, card: card };
  }

  function _modalClose(bd) {
    if (bd && bd.parentNode) bd.parentNode.removeChild(bd);
  }

  // Repair modal: textarea describing the issue + confirmation.
  // Always performs a full reinstall from GitHub (no soft-reset option).
  function _showRepairModal(pluginId, prefillText) {
    var plugin = ETB.registry.getById(pluginId);
    var name = (plugin && plugin.name) || pluginId;
    var sh = _buildModalShell(function () { _modalClose(sh.backdrop); });

    // Step 1 — description textarea.
    function renderMain() {
      sh.card.innerHTML = [
        '<div style="display:flex;align-items:center;gap:10px;padding:18px 22px 16px;',
          'border-bottom:1px solid var(--etb-bd,rgba(0,0,0,.07));">',
          ETB.brand.icon(18),
          '<span style="flex:1;font-size:15px;font-weight:700;color:var(--etb-tx,#111);">Repair Plugin</span>',
          '<button id="_etb_rm_close" style="background:none;border:none;color:var(--etb-tx2,#888);',
            'cursor:pointer;font-size:18px;padding:4px 6px;border-radius:5px;">&#10005;</button>',
        '</div>',
        '<div style="padding:20px 22px;">',
          '<div style="font-size:12px;color:var(--etb-tx2,#6b6b6b);margin-bottom:10px;">',
            'Plugin: <b style="color:var(--etb-tx,#111);">' + _esc(name) + '</b>',
          '</div>',
          '<label style="font-size:11px;font-weight:600;color:var(--etb-tx2,#6b6b6b);',
            'letter-spacing:.06em;display:block;margin-bottom:6px;">',
            _L('Опиши проблему (необязательно)','Describe the issue (optional)'),
          '</label>',
          '<textarea id="_etb_rm_desc" rows="4" style="width:100%;background:#fff;',
            'border:1px solid var(--etb-bd2,rgba(0,0,0,.14));border-radius:6px;',
            'color:var(--etb-tx,#111);font-size:13px;padding:10px 14px;box-sizing:border-box;',
            'outline:none;resize:vertical;font-family:-apple-system,system-ui,sans-serif;">',
            _esc(prefillText || ''),
          '</textarea>',
          '<div style="font-size:11px;color:var(--etb-tx2,#aaa);margin-top:6px;line-height:1.4;">',
            _L('Агент разберёт ошибку, прочитает свежие логи, затем удалит и переустановит плагин с нуля.','The agent will analyse the error, read recent logs, then delete and reinstall the plugin from scratch.'),
          '</div>',
          '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px;">',
            '<button id="_etb_rm_cancel" style="background:var(--etb-s3,#f7f7f9);',
              'border:1px solid var(--etb-bd2,rgba(0,0,0,.14));color:var(--etb-tx2,#6b6b6b);',
              'border-radius:6px;padding:9px 18px;cursor:pointer;font-size:12px;">' + _L('Отмена','Cancel') + '</button>',
            '<button id="_etb_rm_go" style="background:#C67E34;border:none;color:#000;font-weight:700;',
              'border-radius:6px;padding:9px 24px;cursor:pointer;font-size:12px;">' + _L('Починить','Repair') + '</button>',
          '</div>',
        '</div>'
      ].join('');

      sh.card.querySelector('#_etb_rm_close').onclick  = function () { _modalClose(sh.backdrop); };
      sh.card.querySelector('#_etb_rm_cancel').onclick = function () { _modalClose(sh.backdrop); };
      sh.card.querySelector('#_etb_rm_go').onclick     = function () {
        var desc = sh.card.querySelector('#_etb_rm_desc').value || '';
        renderConfirm(desc);
      };
    }

    // Step 2 — confirmation: shows what will happen + the note the user wrote.
    function renderConfirm(desc) {
      var noteHtml = desc
        ? '<div style="margin-bottom:16px;"><div style="font-size:11px;font-weight:600;color:var(--etb-tx2,#6b6b6b);' +
          'letter-spacing:.06em;margin-bottom:5px;">' + _L('Твоя записка агенту','Your note to the agent') + '</div>' +
          '<div style="background:var(--etb-s3,#f7f7f9);border:1px solid var(--etb-bd2,rgba(0,0,0,.1));' +
          'border-radius:8px;padding:10px 12px;font-size:12px;color:var(--etb-tx,#111);line-height:1.5;">' +
          _esc(desc) + '</div></div>'
        : '';
      sh.card.innerHTML = [
        '<div style="display:flex;align-items:center;gap:10px;padding:18px 22px 16px;',
          'border-bottom:1px solid var(--etb-bd,rgba(0,0,0,.07));">',
          ETB.brand.icon(18),
          '<span style="flex:1;font-size:15px;font-weight:700;color:var(--etb-tx,#111);">Confirm Repair</span>',
        '</div>',
        '<div style="padding:22px;">',
          '<div style="font-size:13px;color:var(--etb-tx,#111);line-height:1.6;margin-bottom:16px;">',
            _L('Плагин будет целиком удалён и переустановлен с GitHub. ','The entire plugin will be removed and reinstalled from GitHub. '),
            _L('Служба будет остановлена и запущена заново.','The service will be stopped and restarted.'),
          '</div>',
          noteHtml,
          '<div style="font-size:12px;color:var(--etb-tx2,#6b6b6b);margin-bottom:20px;">',
            'Plugin: <b style="color:var(--etb-tx,#111);">' + _esc(name) + '</b>',
          '</div>',
          '<div style="display:flex;gap:8px;justify-content:flex-end;">',
            '<button id="_etb_rc_back" style="background:var(--etb-s3,#f7f7f9);',
              'border:1px solid var(--etb-bd2,rgba(0,0,0,.14));color:var(--etb-tx2,#6b6b6b);',
              'border-radius:6px;padding:9px 18px;cursor:pointer;font-size:12px;">&#8592; Back</button>',
            '<button id="_etb_rc_go" style="background:#C67E34;border:none;color:#000;font-weight:700;',
              'border-radius:6px;padding:9px 20px;cursor:pointer;font-size:12px;">',
              _L('Удалить и переустановить','Delete &amp; Reinstall'),
            '</button>',
          '</div>',
        '</div>'
      ].join('');

      sh.card.querySelector('#_etb_rc_back').onclick = function () { renderMain(); };
      sh.card.querySelector('#_etb_rc_go').onclick   = function () {
        _modalClose(sh.backdrop);
        ETB.router._cleanRebuildWithAgent(pluginId, true, desc);
      };
    }

    renderMain();
  }

  // Credentials modal: dynamic fields form, saves to KV, sends etb_config_response.
  function _showCredentialsModal(targetIframe, fields, title) {
    fields = Array.isArray(fields) ? fields : [];
    var sh = _buildModalShell(function () {
      _sendConfigResponse(targetIframe, null, true);
      _modalClose(sh.backdrop);
    });

    function _sendConfigResponse(iframe, values, cancelled) {
      try {
        if (iframe && iframe.contentWindow) {
          iframe.contentWindow.postMessage({
            type: 'etb_config_response',
            values: values || {},
            cancelled: !!cancelled
          }, '*');
        }
      } catch (e) {}
    }

    var fieldsHtml = fields.map(function (f) {
      var fid = _esc(f.id || '');
      var lbl = _esc(f.label || f.id || '');
      var typ = (f.type === 'password' || f.type === 'url') ? _esc(f.type) : 'text';
      return [
        '<div style="margin-bottom:14px;">',
          '<label style="font-size:11px;font-weight:600;color:var(--etb-tx2,#6b6b6b);',
            'letter-spacing:.06em;display:block;margin-bottom:6px;">',
            lbl,
          '</label>',
          '<input type="' + typ + '" data-field-id="' + fid + '"',
            ' style="width:100%;background:#fff;border:1px solid var(--etb-bd2,rgba(0,0,0,.14));',
            'border-radius:6px;color:var(--etb-tx,#111);font-size:13px;padding:10px 14px;',
            'box-sizing:border-box;outline:none;font-family:-apple-system,system-ui,sans-serif;"',
            ' autocomplete="off" />',
        '</div>'
      ].join('');
    }).join('');

    sh.card.innerHTML = [
      '<div style="display:flex;align-items:center;gap:10px;padding:18px 22px 16px;',
        'border-bottom:1px solid var(--etb-bd,rgba(0,0,0,.07));">',
        ETB.brand.icon(18),
        '<span style="flex:1;font-size:15px;font-weight:700;color:var(--etb-tx,#111);">',
          _esc(title || 'Configure Plugin'),
        '</span>',
        '<button id="_etb_cm_close" style="background:none;border:none;color:var(--etb-tx2,#888);',
          'cursor:pointer;font-size:18px;padding:4px 6px;border-radius:5px;">&#10005;</button>',
      '</div>',
      '<div style="padding:20px 22px;">',
        fieldsHtml || '<div style="font-size:13px;color:var(--etb-tx2,#6b6b6b);">No fields provided.</div>',
        '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:6px;">',
          '<button id="_etb_cm_cancel" style="background:var(--etb-s3,#f7f7f9);',
            'border:1px solid var(--etb-bd2,rgba(0,0,0,.14));color:var(--etb-tx2,#6b6b6b);',
            'border-radius:6px;padding:9px 18px;cursor:pointer;font-size:12px;">' + _L('Отмена','Cancel') + '</button>',
          '<button id="_etb_cm_save" style="background:#C67E34;border:none;color:#000;font-weight:700;',
            'border-radius:6px;padding:9px 20px;cursor:pointer;font-size:12px;">Save</button>',
        '</div>',
      '</div>'
    ].join('');

    function doCancel() {
      _sendConfigResponse(targetIframe, null, true);
      _modalClose(sh.backdrop);
    }

    function doSave() {
      var inputs = sh.card.querySelectorAll('[data-field-id]');
      var values = {};
      var saves = [];
      for (var i = 0; i < inputs.length; i++) {
        var inp = inputs[i];
        var key = inp.getAttribute('data-field-id');
        var val = inp.value || '';
        values[key] = val;
        if (val) saves.push(ETB.api.kvSet(key, val).catch(function () {}));
      }
      Promise.all(saves).then(function () {
        _sendConfigResponse(targetIframe, values, false);
      }).catch(function () {
        _sendConfigResponse(targetIframe, values, false);
      });
      _modalClose(sh.backdrop);
    }

    sh.card.querySelector('#_etb_cm_close').onclick  = doCancel;
    sh.card.querySelector('#_etb_cm_cancel').onclick = doCancel;
    sh.card.querySelector('#_etb_cm_save').onclick   = doSave;
  }

  // Floating status modal shown while clean-rebuild runs (detached from any panel).
  // Returns a controller object: { setPhase, done, error, close }.
  function _showRepairStatusModal(plugin, opts) {
    opts = opts || {};
    var pluginName = (plugin && plugin.name) || 'Плагин';
    var fullReset  = !!opts.fullReset;
    var title      = fullReset ? 'Переустанавливаю плагин' : 'Пересобираю интерфейс плагина';

    // No backdrop-close — user must wait or explicitly close/retry.
    var bd = document.createElement('div');
    bd.style.cssText = [
      'position:fixed;inset:0;z-index:2147483647;',
      'background:rgba(0,0,0,.45);backdrop-filter:blur(4px);',
      'display:flex;align-items:center;justify-content:center;',
      'animation:_etbv2_gh_fade .14s ease;',
      'font-family:-apple-system,system-ui,sans-serif;'
    ].join('');

    var card = document.createElement('div');
    card.style.cssText = [
      'background:var(--etb-s1,#fff);border:1px solid var(--etb-bd2,rgba(0,0,0,.14));',
      'border-radius:8px;width:420px;max-width:calc(100vw - 32px);',
      'box-shadow:none;overflow:hidden;'
    ].join('');
    bd.appendChild(card);
    document.body.appendChild(bd);

    function _setCardContent(html) { card.innerHTML = html; }

    function _headerHtml(dot, titleText) {
      return [
        '<div style="display:flex;align-items:center;gap:10px;padding:18px 22px 16px;',
          'border-bottom:1px solid var(--etb-bd,rgba(0,0,0,.07));">',
          (String(dot).toLowerCase() === '#c67e34' ? ETB.brand.icon(18) :
            '<div style="width:8px;height:8px;border-radius:50%;background:' + dot + ';flex-shrink:0;"></div>'),
          '<span style="font-size:15px;font-weight:700;color:var(--etb-tx,#111);">' + _esc(titleText) + '</span>',
        '</div>'
      ].join('');
    }

    // Activity log — keep last 5 entries, updated live during agent run.
    var _logLines = [];

    function _logHtml() {
      if (!_logLines.length) return '';
      return [
        '<div style="margin-top:14px;border:1px solid var(--etb-bd,rgba(0,0,0,.07));',
          'border-radius:8px;overflow:hidden;">',
          '<div style="font-size:10px;font-weight:600;color:var(--etb-tx2,#6b6b6b);',
            'letter-spacing:.05em;padding:6px 10px 5px;',
            'background:var(--etb-s3,#f7f7f9);border-bottom:1px solid var(--etb-bd,rgba(0,0,0,.07));">',
            'Activity',
          '</div>',
          '<div id="_etb_rsm_log" style="padding:8px 10px;font-size:11px;',
            'font-family:ui-monospace,monospace;line-height:1.6;',
            'color:var(--etb-tx2,#6b6b6b);max-height:80px;overflow:hidden;">',
            _logLines.map(function (l) {
              return '<div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + _esc(l) + '</div>';
            }).join(''),
          '</div>',
        '</div>'
      ].join('');
    }

    // ── Progress state ─────────────────────────────────────────────
    function renderProgress(phase) {
      _setCardContent([
        _headerHtml('#C67E34', title),
        '<div style="padding:24px 22px;">',
          '<div style="text-align:center;margin-bottom:6px;">', _infHTML(72), '</div>',
          '<div id="_etb_rsm_phase" style="font-size:13px;color:var(--etb-tx,#111);',
            'font-weight:500;text-align:center;margin-bottom:14px;">' + _esc(phase || 'Разбираюсь, что сломалось') + '…</div>',
          '<div style="font-size:12px;color:var(--etb-tx2,#6b6b6b);margin-bottom:4px;">',
            'Плагин: <b style="color:var(--etb-tx,#111);">' + _esc(pluginName) + '</b>',
          '</div>',
          _logHtml(),
          '<div style="font-size:11px;color:var(--etb-tx2,#aaa);margin-top:12px;">',
            'Обычно это несколько минут. Можно спокойно заниматься другим — окно останется и покажет результат.',
          '</div>',
        '</div>'
      ].join(''));
    }

    // ── Done state ─────────────────────────────────────────────────
    function renderDone(freshPlugin, summary) {
      var summaryHtml = '';
      if (summary && summary.trim()) {
        var short = summary.trim().slice(0, 400);
        summaryHtml = [
          '<div style="background:var(--etb-s3,#f7f7f9);border:1px solid var(--etb-bd,rgba(0,0,0,.07));',
            'border-radius:8px;padding:10px 12px;font-size:11px;font-family:ui-monospace,monospace;',
            'line-height:1.6;color:var(--etb-tx2,#6b6b6b);max-height:80px;overflow:auto;',
            'margin-bottom:16px;white-space:pre-wrap;word-break:break-word;">',
            _esc(short),
          '</div>'
        ].join('');
      }
      _setCardContent([
        _headerHtml('#4caf50', 'Плагин готов'),
        '<div style="padding:24px 22px;">',
          '<div style="font-size:13px;color:var(--etb-tx,#111);margin-bottom:6px;">',
            '<b>' + _esc(pluginName) + '</b> ' + (fullReset ? 'переустановлен' : 'пересобран') + ' — всё получилось.',
          '</div>',
          '<div style="font-size:12px;color:var(--etb-tx2,#6b6b6b);margin-bottom:' +
            (summaryHtml ? '12px' : '20px') + ';">',
            'Открой плагин и убедись, что всё работает.',
          '</div>',
          summaryHtml,
          '<div style="display:flex;gap:8px;justify-content:flex-end;">',
            '<button id="_etb_rsm_close" style="background:var(--etb-s3,#f7f7f9);',
              'border:1px solid var(--etb-bd2,rgba(0,0,0,.14));color:var(--etb-tx2,#6b6b6b);',
              'border-radius:6px;padding:9px 18px;cursor:pointer;font-size:12px;">Закрыть</button>',
            '<button id="_etb_rsm_open" style="background:#C67E34;border:none;color:#000;',
              'font-weight:700;border-radius:6px;padding:9px 22px;cursor:pointer;font-size:12px;">',
              'Открыть плагин</button>',
          '</div>',
        '</div>'
      ].join(''));

      card.querySelector('#_etb_rsm_close').onclick = function () { _modalClose(bd); };
      card.querySelector('#_etb_rsm_open').onclick  = function () {
        _modalClose(bd);
        var p = freshPlugin || (plugin && ETB.registry.getById(plugin.id));
        if (p) ETB.router.open(p);
      };
    }

    // ── Error state ────────────────────────────────────────────────
    function renderError(msg, onRetry) {
      _setCardContent([
        _headerHtml('rgba(180,50,50,.85)', 'Починить не удалось'),
        '<div style="padding:24px 22px;">',
          '<div style="font-size:13px;color:var(--etb-tx,#111);margin-bottom:6px;">',
            'Плагин: <b>' + _esc(pluginName) + '</b>',
          '</div>',
          '<div style="background:rgba(220,50,50,.06);border:1px solid rgba(220,50,50,.18);',
            'border-radius:6px;padding:10px 14px;font-size:12px;color:rgba(160,40,40,.9);',
            'line-height:1.5;margin-bottom:20px;">',
            _esc(String(msg || 'Unknown error').slice(0, 200)),
          '</div>',
          '<div style="display:flex;gap:8px;justify-content:flex-end;">',
            '<button id="_etb_rsm_close2" style="background:var(--etb-s3,#f7f7f9);',
              'border:1px solid var(--etb-bd2,rgba(0,0,0,.14));color:var(--etb-tx2,#6b6b6b);',
              'border-radius:6px;padding:9px 18px;cursor:pointer;font-size:12px;">Закрыть</button>',
            onRetry
              ? '<button id="_etb_rsm_retry" style="background:#C67E34;border:none;color:#000;font-weight:700;border-radius:6px;padding:9px 20px;cursor:pointer;font-size:12px;">Ещё раз</button>'
              : '',
          '</div>',
        '</div>'
      ].join(''));

      card.querySelector('#_etb_rsm_close2').onclick = function () { _modalClose(bd); };
      if (onRetry) {
        var retryBtn = card.querySelector('#_etb_rsm_retry');
        if (retryBtn) retryBtn.onclick = function () { _modalClose(bd); onRetry(); };
      }
    }

    // Initial render
    renderProgress(fullReset ? 'Deleting' : 'Cleaning UI');

    return {
      setPhase: function (text) {
        var el = card.querySelector('#_etb_rsm_phase');
        if (el) el.textContent = text + '...';
      },
      addLog: function (text) {
        if (!text || !text.trim()) return;
        _logLines.push(text.trim());
        if (_logLines.length > 5) _logLines = _logLines.slice(-5);
        var logDiv = card.querySelector('#_etb_rsm_log');
        if (logDiv) {
          logDiv.innerHTML = _logLines.map(function (l) {
            return '<div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + _esc(l) + '</div>';
          }).join('');
          logDiv.scrollTop = logDiv.scrollHeight;
        }
      },
      done:  function (freshPlugin, summary) { renderDone(freshPlugin, summary); },
      error: function (msg, onRetry) { renderError(msg, onRetry); },
      close: function () { _modalClose(bd); }
    };
  }

  // Floating ✦ Repair overlay — injected into the content div for every plugin panel.
  function _injectRepairOverlay(content, pluginId) {
    var pid = _esc(pluginId.replace(/'/g, ''));
    var fab = document.createElement('div');
    fab.id = '_etb_fab_' + String(pluginId).replace(/[^a-z0-9]/gi, '_');
    fab.style.cssText = [
      'position:absolute;bottom:14px;right:14px;z-index:10;pointer-events:auto;',
      'transition:opacity .15s;'
    ].join('');
    fab.innerHTML = [
      '<button onclick="ETB.router._showRepairModal(\'' + pid + '\',\'\')"',
        ' title="Починить или перенастроить этот плагин"',
        ' style="background:var(--etb-s1,#fff);border:1px solid var(--etb-bd2,rgba(0,0,0,.14));',
        'color:var(--etb-tx2,#6b6b6b);border-radius:8px;padding:5px 13px;cursor:pointer;',
        'font-size:11px;font-family:-apple-system,system-ui,sans-serif;',
        'box-shadow:none;transition:background .12s,color .12s;',
        'display:flex;align-items:center;gap:5px;">',
        '</span>' + _L('Починить','Repair') + '',
      '</button>'
    ].join('');
    content.appendChild(fab);
  }

  return {
    // «? Как это работает» (правило §3.20): открыть/закрыть окно поверхности.
    openHelp: openHelp,
    closeHelp: closeHelp,
    // Start a local_server plugin's HTTP server via its saved expert.
    // Must run with target: deviceId so the server starts on the user's device.
    _startServer: function (pluginId, opts) {
      var plugin = ETB.registry.getById(pluginId);
      if (!plugin || !plugin.ui || !plugin.ui.startExpert) return;
      var _noRetry = !!(opts && opts.noRetry);
      var startExpert = plugin.ui.startExpert;
      var port = plugin.ui.port;
      var rootPath = plugin.ui.rootPath;
      ETB.api.kvGet('_device_id')
        .then(function (res) { return (res && res.value) || null; })
        .catch(function () { return null; })
        .then(function (deviceId) {
          var runOpts = deviceId ? { target: deviceId } : {};
          return ETB.api.runExpert(startExpert, { port: String(port || ''), root_path: rootPath || '' }, runOpts);
        })
        .then(function () { if (!_noRetry) ETB.router._retryServer(pluginId); })
        .catch(function (e) { console.warn('[ETB.router] Failed to start server:', e && e.message); });
    },

    // Re-check server availability and reload the iframe when ready.
    _retryServer: function (pluginId) {
      var entry = _cache[pluginId];
      if (!entry) return;
      var plugin = ETB.registry.getById(pluginId);
      if (!plugin || !plugin.ui) return;
      var content = entry.panel.querySelector('div[style*="flex:1"]');
      if (!content) return;
      // Clear fallback, create fresh iframe
      content.innerHTML = '';
      var mainFile = (plugin.ui.mainFile && plugin.ui.mainFile !== 'index.html') ? plugin.ui.mainFile : '';
      var serverUrl = 'http://localhost:' + plugin.ui.port + (mainFile ? '/' + mainFile : '');
      var retryIframe = document.createElement('iframe');
      retryIframe.style.cssText = 'width:100%;height:100%;border:none;display:none;';
      retryIframe.setAttribute('allow', 'clipboard-read;clipboard-write');
      content.appendChild(retryIframe);
      _checkAndLoadServer(retryIframe, serverUrl, content, plugin);
    },

    // Open a service/local_server plugin's live URL in the external browser.
    _openExternal: function (pluginId) {
      var plugin = ETB.registry.getById(pluginId);
      if (!plugin) return;
      _openUrlExternal(_serviceUrl(plugin));
    },

    // Show the repair modal so the user can optionally describe the issue.
    _showRepairModal: function (pluginId, prefillText) {
      _showRepairModal(pluginId, prefillText || '');
    },

    // Hand the plugin to the agent: install deps, (re)start the real service,
    // health-validate, and pick up any manifest changes — then reload the panel.
    _repairWithAgent: function (pluginId, description) {
      var self = this;
      var plugin = ETB.registry.getById(pluginId);
      if (!plugin) return;
      if (!ETB.installPrompt || !ETB.installPrompt.buildRepair) {
        console.warn('[ETB.router] installPrompt.buildRepair unavailable');
        return;
      }
      var entry = _cache[pluginId];
      var content = entry && entry.panel ? entry.panel.querySelector('div[style*="flex:1"]') : null;
      var safeId = String(pluginId).replace(/[^a-z0-9]/gi, '_');
      var ticker = null;

      var bar = _renderRepairProgress(content, plugin, _L('Определяю устройство','Resolving device'));
      function setPhase(txt) {
        if (!bar) return;
        var el = bar.querySelector('._etb_rep_phase');
        if (el) el.textContent = txt + '…';
      }
      function removeBar() {
        if (bar && bar.parentNode) bar.parentNode.removeChild(bar);
        bar = null;
      }
      function stopTicker() {
        if (ticker) { clearInterval(ticker); ticker = null; }
      }

      ETB.api.kvGet('_device_id')
        .then(function (res) { return (res && res.value) || null; })
        .catch(function () { return null; })
        .then(function (did) {
          if (did) return did;
          try {
            return (window.extellaDesktop && window.extellaDesktop.getDeviceID)
              ? window.extellaDesktop.getDeviceID() : null;
          } catch (e) { return null; }
        })
        .then(function (deviceId) {
          var port = (plugin.ui && plugin.ui.port) ||
            (plugin.service && plugin.service.port) || '';
          var defaultFailure = 'The toolbar could not load http://localhost:' + port +
            '/ — the service is not responding (installed UI shell only, real app not running).';
          var failure = (description && description.trim())
            ? description.trim() + '\n\n' + defaultFailure
            : defaultFailure;
          var prompt = ETB.installPrompt.buildRepair(plugin, failure);

          // Run the agent, auto-retry once if the device listener is interrupted mid-task.
          var _lastAgentText = '';
          function runOnce(isRetry) {
            var t0 = Date.now();
            stopTicker();
            _lastAgentText = '';
            ticker = setInterval(function () {
              var secs = Math.round((Date.now() - t0) / 1000);
              // Show real agent text when available, fallback to timer
              var baseLabel = isRetry ? 'Retry — ' : '';
              setPhase(_lastAgentText
                ? baseLabel + _lastAgentText
                : baseLabel + 'Working (' + secs + 's)');
            }, 1000);
            return ETB.api.runAgentAsync(prompt, {
              run_timeout: 3600,
              maxWait: 3000000,
              interval: 4000,
              stallTimeout: 18 * 60 * 1000,
              onProgress: function (data) {
                var text = '';
                try { text = ETB.api.extractAgentText(data); } catch (_) {}
                if (text && text.trim()) {
                  var lines = text.trim().split('\n');
                  for (var i = lines.length - 1; i >= 0; i--) {
                    var l = lines[i].trim();
                    if (l.length > 5 && l.length < 80) { _lastAgentText = l; break; }
                  }
                }
              }
            });
          }

          return runOnce(false)
            .catch(function (e1) {
              // First attempt failed (likely listener restart/SIGKILL mid-task).
              // Wait 4s and retry automatically once.
              console.warn('[ETB.router] Repair attempt 1 failed:', e1 && e1.message,
                '— auto-retrying in 4s');
              stopTicker();
              setPhase('Interrupted — retrying in 4s');
              return new Promise(function (resolve) { setTimeout(resolve, 4000); })
                .then(function () { return runOnce(true); });
            })
            .then(function () {
              stopTicker();
              setPhase('Reloading');
              if (deviceId) return ETB.registry.syncFromDevice(deviceId, safeId);
              return null;
            }).then(function () {
              removeBar();
              self._retryServer(pluginId);
            });
        })
        .catch(function (e) {
          stopTicker();
          console.warn('[ETB.router] Agent repair failed (both attempts):', e && e.message);
          // Retry button lets the user manually re-trigger the full repair flow.
          _renderRepairError(bar, content, (e && e.message) || 'unknown error', function () {
            ETB.router._repairWithAgent(pluginId, description);
          });
          bar = null;
        });
    },

    // Delete plugin files and regenerate the UI (soft) or do a full reinstall (hard).
    // Called after the user confirms in the Repair modal.
    // Closes the panel, evicts cache, shows a detached status modal, and reopens when done.
    // Flow: Phase 0 (get deviceId) → Phase 1 (read plugin logs via fython) →
    //       Phase 2 (LLM analysis SubAgent) → Phase 3 (full rebuild agent) → sync → done.
    _cleanRebuildWithAgent: function (pluginId, fullReset, description) {
      var plugin = ETB.registry.getById(pluginId);
      if (!plugin) return;
      if (!ETB.installPrompt || !ETB.installPrompt.buildCleanReinstall) {
        console.warn('[ETB.router] installPrompt.buildCleanReinstall unavailable');
        return;
      }
      var safeId = String(pluginId).replace(/[^a-z0-9]/gi, '_');
      var ticker = null;

      // 1. Close the panel immediately — user should not see a half-deleted plugin.
      ETB.router.close({ silent: true });
      // 2. Evict from cache so the panel is fully rebuilt from the fresh manifest later.
      _evict(pluginId);

      // 3. Show the detached floating status modal (always full reset now).
      var status = _showRepairStatusModal(plugin, { fullReset: true });

      function stopTicker() {
        if (ticker) { clearInterval(ticker); ticker = null; }
      }

      var _lastRebuildText = '';
      ticker = setInterval(function () {
        status.setPhase(_lastRebuildText || 'Reading logs\u2026');
      }, 1000);

      var _onRebuildProgress = ETB.api.createAgentProgressTracker({
        setPhase: function (line) { _lastRebuildText = line; },
        addLog: function (line) { status.addLog(line); }
      });

      // ── Phase 0: resolve deviceId ──────────────────────────────────────────
      ETB.api.kvGet('_device_id')
        .then(function (res) { return (res && res.value) || null; })
        .catch(function () { return null; })
        .then(function (did) {
          if (did) return did;
          try {
            return (window.extellaDesktop && window.extellaDesktop.getDeviceID)
              ? window.extellaDesktop.getDeviceID() : null;
          } catch (e) { return null; }
        })

        // ── Phase 1: read plugin log files via fython ──────────────────────
        .then(function (deviceId) {
          _lastRebuildText = 'Reading logs\u2026';
          var installDir = (plugin.artifacts && plugin.artifacts.rootPath) ||
            (plugin.ui && plugin.ui.rootPath) || ('~/extella-plugins/' + safeId);
          var fnLog = '_etb_logs_' + safeId;
          var logCode = [
            'def ' + fnLog + '() -> str:',
            '    import os, glob, json',
            '    d = os.path.expanduser("' + installDir.replace(/"/g, '\\"') + '")',
            '    collected = []',
            '    for pat in ["server.log", "nohup.out", "*.log", "logs/*.log", ".next/dev/logs/*.log"]:',
            '        for fp in sorted(glob.glob(os.path.join(d, pat)))[:2]:',
            '            try:',
            '                with open(fp, "r", encoding="utf-8", errors="replace") as f:',
            '                    lines = f.readlines()',
            '                collected.append("=== " + os.path.basename(fp) + " (last " + str(min(len(lines), 60)) + " lines) ===")',
            '                collected.extend(lines[-60:])',
            '                if len(collected) >= 120: break',
            '            except Exception:',
            '                pass',
            '        if len(collected) >= 120: break',
            '    return json.dumps({"log": "".join(collected[-120:])})'
          ].join('\n');

          var logsPromise;
          if (deviceId) {
            logsPromise = ETB.api.saveExpert({
              name: fnLog, description: 'Read plugin logs for repair', code: logCode, kwargs: {}, cspl: 'fython'
            }).then(function () {
              return ETB.api.runExpert(fnLog, {}, { target: deviceId, timeout: 20 });
            }).then(function (res) {
              ETB.api.deleteExpert(fnLog).catch(function () {});
              try {
                var raw = typeof res === 'string' ? res : (ETB.api.extractAgentText(res) || '');
                var m = raw.match(/\{[\s\S]*\}/);
                return m ? (JSON.parse(m[0]).log || '') : '';
              } catch (_) { return ''; }
            }).catch(function () { return ''; });
          } else {
            logsPromise = Promise.resolve('');
          }

          return logsPromise.then(function (logs) {
            return { deviceId: deviceId, logs: logs };
          });
        })

        // ── Phase 2: LLM analysis SubAgent ────────────────────────────────
        .then(function (ctx) {
          if (!ETB.installPrompt || !ETB.installPrompt.buildRepairAnalysis) {
            return { deviceId: ctx.deviceId, logs: ctx.logs, analysis: null };
          }
          _lastRebuildText = 'Analyzing error\u2026';
          var aPrompt = ETB.installPrompt.buildRepairAnalysis(plugin, description, ctx.logs);
          return ETB.api.runAgentAsync(aPrompt, {
            run_timeout: 180,
            maxWait: 4 * 60 * 1000,
            interval: 4000
          }).then(function (ar) {
            var analysis = null;
            try {
              var txt = ETB.api.extractAgentText(ar) || '';
              var m = txt.match(/\{[\s\S]*\}/);
              if (m) analysis = JSON.parse(m[0]);
            } catch (_) {}
            return { deviceId: ctx.deviceId, logs: ctx.logs, analysis: analysis };
          }).catch(function () {
            return { deviceId: ctx.deviceId, logs: ctx.logs, analysis: null };
          });
        })

        // ── Phase 3: main full-rebuild agent ──────────────────────────────
        .then(function (ctx) {
          _lastRebuildText = '';
          var prompt = ETB.installPrompt.buildCleanReinstall(plugin, true, description, ctx.analysis, ctx.logs);
          return ETB.api.runAgentAsync(prompt, {
            run_timeout: 3600,
            maxWait: 3000000,
            interval: 4000,
            stallTimeout: 18 * 60 * 1000,
            onProgress: _onRebuildProgress
          }).then(function (agentResult) {
            stopTicker();
            status.setPhase('Syncing');
            if (ctx.deviceId) return ETB.registry.syncFromDevice(ctx.deviceId, safeId)
              .then(function () { return agentResult; });
            return agentResult;
          }).then(function (agentResult) {
            stopTicker();
            var summary = '';
            try { summary = ETB.api.extractAgentText(agentResult); } catch (_) {}
            var freshPlugin = ETB.registry.getById(pluginId);
            status.done(freshPlugin || plugin, summary);
          });
        })

        .catch(function (e) {
          stopTicker();
          console.warn('[ETB.router] Clean rebuild failed:', e && e.message);
          status.error((e && e.message) || 'Unknown error', function () {
            ETB.router._cleanRebuildWithAgent(pluginId, true, description);
          });
        });
    },

    open: function (plugin, opts) {
      var id = plugin.id;

      // Hide currently visible panel (keep it in cache).
      // Update lastUsed so a panel that was active moments ago is not
      // immediately the LRU candidate when a new panel needs to be evicted.
      if (_activeId && _activeId !== id && _cache[_activeId]) {
        _cache[_activeId].lastUsed = Date.now();
        _beforePanelHidden(_cache[_activeId].panel);
        _cache[_activeId].panel.style.display = 'none';
      }

      if (_cache[id]) {
        // Re-show cached panel — full iframe state is preserved.
        var entry = _cache[id];
        if (typeof entry.panel.__etbStudioClosing === 'boolean') {
          entry.panel.__etbStudioClosing = false;
        }
        entry.panel.style.display = 'flex';
        entry.panel.style.animation = '_etbv2_slide_in .18s ease';
        entry.lastUsed = Date.now();
        _activeId = id;
      } else {
        // Evict oldest entry if cache is full.
        _evictLRU();

        var built = _buildPanel(plugin);
        var mount = (ETB.shell && ETB.shell.getViewport)
          ? ETB.shell.getViewport()
          : document.body;
        mount.appendChild(built.panel);

        _cache[id] = { panel: built.panel, blobUrl: built.blobUrl, lastUsed: Date.now() };
        _activeId = id;
      }

      // Where to land when this panel is closed. A plugin opened from the
      // Plugins storefront returns TO the storefront (it is the user's home
      // surface); without this the ✕ dropped the user into chat with no way
      // back except reopening Plugins from the pill.
      _cache[id].returnTo = (opts && opts.returnTo) || _cache[id].returnTo || '';

      if (ETB.nav) ETB.nav.syncUI();
    },

    openById: function (id, opts) {
      var plugin = ETB.registry.getById(id);
      if (plugin) this.open(plugin, opts);
    },

    close: function (opts) {
      var returnTo = '';
      if (_activeId && _cache[_activeId]) {
        var panel = _cache[_activeId].panel;
        returnTo = _cache[_activeId].returnTo || '';
        _cache[_activeId].lastUsed = Date.now(); // keep it fresh in LRU
        _beforePanelHidden(panel);
        panel.style.animation = '_etbv2_slide_out .15s ease forwards';
        setTimeout(function () {
          // Hide (not remove) — preserves iframe state for next visit.
          panel.style.display = 'none';
          panel.style.animation = 'none';
        }, 150);
      }
      _activeId = null;
      window.__etbResendInit = null;
      if (returnTo === 'plugins' && (!opts || !opts.silent) && ETB.nav) {
        ETB.nav.set('plugins');
        return;
      }
      if (ETB.nav && (!opts || !opts.silent)) ETB.nav.syncUI();
    },

    isOpen: function () {
      return !!_activeId;
    },

    evict: function (pluginId) {
      if (_activeId === pluginId) {
        _activeId = null;
        window.__etbResendInit = null;
      }
      _evict(pluginId);
    },

    // Toggle run-mode for a HuggingFace plugin (Local ↔ Remote) and reload the panel.
    _hfSwitchMode: function (pluginId, newMode) {
      var plugin = ETB.registry.getById(pluginId);
      if (!plugin || plugin.type !== 'huggingface') return;

      var currentMode = (plugin.hf && plugin.hf.runMode) || plugin.mode || 'local';
      if (currentMode === newMode) return;

      // Update in-memory manifest so the rebuilt panel uses the new mode.
      // Persisting to device registry is left to the agent during next repair.
      if (!plugin.hf) plugin.hf = {};
      plugin.hf.runMode = newMode;
      plugin.mode = newMode;

      // Evict the cached panel so it rebuilds from scratch with the updated mode.
      _evict(pluginId);
      ETB.router.openById(pluginId);
    }
  };
})();
