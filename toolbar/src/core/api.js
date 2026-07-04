// ── API MODULE ─────────────────────────────────────────────────────────────
// Thin wrapper around Extella REST API.
// Exposes: ETB.api.runExpert(), runExpertAsync(), runAgent(), runAgentAsync(),
//          extractAgentText(), taskCheck(), pollTask(), saveExpert(), …

ETB.api = (function () {
  var BASE = 'https://api.extella.ai';
  var DEFAULT_AGENT = 'agent_extella_default';

  function _hdrs() {
    return {
      'Content-Type': 'application/json',
      'X-Auth-Token': ETB.auth.getToken(),
      'X-Profile-Id': 'default',
      'X-Agent-Id': DEFAULT_AGENT
    };
  }

  function _post(path, body) {
    return fetch(BASE + path, {
      method: 'POST',
      headers: _hdrs(),
      body: JSON.stringify(body)
    }).then(function (r) {
      if (r.status === 401) {
        ETB.auth.refreshSession('401-retry').catch(function () {});
        return { status: 'error', message: 'Unauthorized — token required' };
      }
      if (r.status === 404) {
        return { status: 'not_found', httpStatus: 404, message: 'Endpoint not found' };
      }
      return r.json().catch(function () {
        return { status: 'error', message: 'Invalid JSON response' };
      });
    }).catch(function (e) {
      return { status: 'error', message: e.message };
    });
  }

  function _agentResponseError(res) {
    if (!res) return 'Empty API response';
    if (res.status === 'error') return res.message || 'API error';
    if (res.status === 'not_found') return res.message || 'API endpoint not found';
    if (res.error) {
      return typeof res.error === 'string' ? res.error : (res.error.message || 'API error');
    }
    if (res.status === 'failed' || res.status === 'cancelled') {
      var detail = res.incomplete_details && res.incomplete_details.reason;
      return detail || res.message || ('Agent run ' + res.status);
    }
    return null;
  }

  function _isAgentComplete(res) {
    var st = String((res && res.status) || '').toLowerCase();
    return st === 'completed' || st === 'success';
  }

  function _isAgentPending(res) {
    var st = String((res && res.status) || '').toLowerCase();
    return st === 'in_progress' || st === 'queued' || st === 'busy';
  }

  function extractAgentText(res) {
    var err = _agentResponseError(res);
    if (err) throw new Error(err);

    if (Array.isArray(res.output)) {
      var parts = [];
      res.output.forEach(function (item) {
        if (item && item.type === 'message' && Array.isArray(item.content)) {
          item.content.forEach(function (c) {
            if (c && c.type === 'output_text' && c.text) parts.push(c.text);
          });
        }
      });
      if (parts.length) return parts.join('\n');
    }

    var t = res.answer || res.response || res.text || '';
    if (!t && res.result != null) {
      t = typeof res.result === 'string' ? res.result : JSON.stringify(res.result);
    }
    if (typeof t !== 'string') t = String(t || '');
    if (!t.trim()) throw new Error('Empty agent reply');
    return t;
  }

  function _sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function taskCheck(taskId) {
    return _post('/api/task/check', { task_id: taskId });
  }

  function pollTask(taskId, opts) {
    opts = opts || {};
    var interval = opts.interval || 2500;
    var maxWait = opts.maxWait || 900000;
    // stallTimeout: reject if agent output hasn't changed for this long (ms).
    // Catches the case where the LLM is stuck generating after a mid-task SIGKILL.
    // Default 18 min — long enough for legitimate slow npm installs, short enough
    // to surface a real stall rather than wait 50 min.
    var stallTimeout = (opts.stallTimeout !== undefined) ? opts.stallTimeout : 18 * 60 * 1000;
    var started = Date.now();
    var _lastSeenOutput = null;
    var _lastOutputChangeAt = Date.now();

    function tick() {
      if (Date.now() - started > maxWait) {
        return Promise.reject(new Error('Task timed out after ' + Math.round(maxWait / 1000) + 's'));
      }
      return taskCheck(taskId).then(function (data) {
        if (data && data.httpStatus === 404) {
          return Promise.reject(new Error('Task polling is not available on this server (404)'));
        }
        if (opts.onProgress) opts.onProgress(data);

        var err = _agentResponseError(data);
        if (err && data.status !== 'busy') {
          return Promise.reject(new Error(err));
        }

        var st = String((data && data.status) || '').toLowerCase();
        // Docs: running = done, busy = still executing
        if (st === 'running' || st === 'completed' || st === 'success') {
          return data;
        }
        if (data && (data.result != null || data.output || data.answer)) {
          return data;
        }
        if (st === 'failed' || st === 'error') {
          return Promise.reject(new Error(data.message || 'Task failed'));
        }

        // Stall detection: track whether agent output is making progress.
        if (stallTimeout > 0 && st === 'busy') {
          var currentOutput = '';
          try { currentOutput = extractAgentText(data); } catch (_) {}
          if (currentOutput !== _lastSeenOutput) {
            _lastSeenOutput = currentOutput;
            _lastOutputChangeAt = Date.now();
          } else if (Date.now() - _lastOutputChangeAt > stallTimeout) {
            var stallMins = Math.round(stallTimeout / 60000);
            return Promise.reject(new Error(
              'Agent stalled — no progress for ' + stallMins + ' min. ' +
              'The device listener may have been interrupted mid-task.'
            ));
          }
        }

        return _sleep(interval).then(tick);
      });
    }

    return tick();
  }

  function _runAgentRequest(body) {
    return _post('/api/agent/run', Object.assign(
      { agent_id: DEFAULT_AGENT, run_timeout: 600 },
      body
    ));
  }

  function runAgent(message, opts) {
    opts = opts || {};
    var body = Object.assign({ input: message }, opts);
    delete body.onProgress;
    delete body.maxWait;
    delete body.interval;
    if (!body.run_timeout) body.run_timeout = 600;
    return _runAgentRequest(body).then(function (res) {
      var err = _agentResponseError(res);
      if (err) throw new Error(err);
      if (!_isAgentComplete(res) && _isAgentPending(res)) {
        throw new Error('Agent still in progress — use runAgentAsync for long operations');
      }
      return res;
    });
  }

  // Status keywords the agent commonly emits as human-readable progress lines.
  var _STATUS_KW = /clone|cloning|install|npm|pip|pip3|yarn|pnpm|start|launch|run|server|port|validat|poll|manifest|build|compil|download|resolv|detect|check|creat|writ|read|copy|deploy|generat|expert|setup|patch|restart|repair|diagnos/i;

  // Extract the most meaningful progress line from a poll data object.
  // Priority: 1) emoji-prefixed lines (🔄 ✅ ❌ ⚠️), 2) keyword lines, 3) any short line.
  // Returns '' when nothing useful is present.
  function _pickProgressLine(data, minLen, maxLen) {
    var text = '';
    try { text = extractAgentText(data); } catch (_) {}
    if (!text || !text.trim()) return '';
    var min = minLen || 5;
    var max = maxLen || 120;
    var lines = text.trim().split('\n');

    // Collect candidate lines that fit length constraints.
    var candidates = [];
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i].trim();
      if (l.length >= min && l.length <= max) candidates.push(l);
    }
    if (!candidates.length) return '';

    // Pass 1: emoji-prefixed lines — most reliable status indicators.
    // Emoji and special symbols start at code point 0x2500 (Box Drawing and above).
    for (var j = candidates.length - 1; j >= 0; j--) {
      var cp = candidates[j].charCodeAt(0);
      if (cp >= 0x2500) return candidates[j];
    }

    // Pass 2: lines containing status keywords — agent reasoning sentences.
    for (var k = candidates.length - 1; k >= 0; k--) {
      if (_STATUS_KW.test(candidates[k])) return candidates[k];
    }

    // Pass 3: fallback — last candidate that fits length constraints.
    return candidates[candidates.length - 1];
  }

  // Factory for a reusable onProgress callback wired to UI update functions.
  // opts: { setPhase(text), addLog(text) [optional], onSyncFallback() [optional] }
  // Returns the onProgress(data) function to pass to runAgentAsync.
  function createAgentProgressTracker(opts) {
    opts = opts || {};
    var setPhase = opts.setPhase || function () {};
    var addLog = opts.addLog || null;
    var onSyncFallback = opts.onSyncFallback || function () {};
    var _last = '';
    return function (data) {
      if (data && data.status === 'sync_fallback') { onSyncFallback(); return; }
      var line = _pickProgressLine(data, 5, 120);
      if (!line || line === _last) return;
      _last = line;
      setPhase(line);
      if (addLog) addLog(line);
    };
  }

  function runAgentAsync(message, opts) {
    opts = opts || {};
    var onProgress = opts.onProgress;
    var pollOpts = {
      interval: opts.interval || 2500,
      maxWait: opts.maxWait || 900000,
      stallTimeout: opts.stallTimeout,   // forward caller-supplied stall window
      onProgress: onProgress
    };

    var asyncBody = Object.assign({}, opts, {
      input: message,
      async: true,
      run_timeout: opts.run_timeout || 600
    });
    delete asyncBody.onProgress;
    delete asyncBody.maxWait;
    delete asyncBody.interval;

    return _runAgentRequest(asyncBody).then(function (res) {
      var err = _agentResponseError(res);
      if (err) throw new Error(err);

      if (res.task_id) {
        return pollTask(res.task_id, pollOpts);
      }
      if (_isAgentComplete(res)) {
        return res;
      }
      if (_isAgentPending(res) && res.id) {
        return pollTask(res.id, pollOpts).catch(function (pollErr) {
          // task/check may not support response ids — fall through to sync
          if (pollErr && pollErr.message && pollErr.message.indexOf('404') !== -1) {
            return null;
          }
          throw pollErr;
        }).then(function (polled) {
          if (polled) return polled;
          return _runAgentRequest(Object.assign({}, asyncBody, { async: false }));
        });
      }

      return res;
    }).catch(function (asyncErr) {
      var errMsg = (asyncErr && asyncErr.message) || '';
      if (!errMsg || (errMsg.indexOf('404') === -1 && errMsg.indexOf('not available') === -1)) {
        throw asyncErr;
      }
      if (onProgress) onProgress({ status: 'sync_fallback' });
      var syncBody = Object.assign({}, opts, {
        input: message,
        async: false,
        run_timeout: opts.run_timeout || 900
      });
      delete syncBody.onProgress;
      delete syncBody.maxWait;
      delete syncBody.interval;
      return _runAgentRequest(syncBody).then(function (res) {
        var syncErr = _agentResponseError(res);
        if (syncErr) throw new Error(syncErr);
        return res;
      });
    });
  }

  function runExpert(name, params, opts) {
    return _post('/api/expert/run', Object.assign(
      { expert_name: name, params: params || {} },
      opts || {}
    ));
  }

  function runExpertAsync(name, params, opts) {
    opts = opts || {};
    return runExpert(name, params, Object.assign({ wait: false }, opts)).then(function (res) {
      if (res.status === 'error') throw new Error(res.message || 'Expert run failed');
      if (!res.task_id) {
        if (res.result != null) return res;
        throw new Error('No task_id in async expert response');
      }
      return pollTask(res.task_id, opts);
    });
  }

  return {
    runExpert: runExpert,
    runExpertAsync: runExpertAsync,
    runAgent: runAgent,
    runAgentAsync: runAgentAsync,
    extractAgentText: extractAgentText,
    createAgentProgressTracker: createAgentProgressTracker,
    taskCheck: taskCheck,
    pollTask: pollTask,

    saveExpert: function (def) {
      return _post('/api/expert/save', def);
    },

    deleteExpert: function (name) {
      return _post('/api/expert/delete', { name: name });
    },

    searchExperts: function (query, limit) {
      return _post('/api/blocks/search', { query: query, limit: limit || 10 });
    },

    addConcept: function (text) {
      return _post('/api/concept/add', { text: text });
    },

    searchConcepts: function (query, limit) {
      return _post('/api/concept/search', { query: query, limit: limit || 5 });
    },

    kvGet: function (key) {
      return _post('/api/kv/get', { key: key });
    },

    kvSet: function (key, value, desc) {
      return _post('/api/kv/set', { key: key, value: value, description: desc || '' });
    },

    health: function () {
      return fetch(BASE + '/api/health').then(function (r) { return r.json(); })
        .catch(function () { return { status: 'error' }; });
    }
  };
})();
