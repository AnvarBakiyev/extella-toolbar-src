// ── API MODULE ─────────────────────────────────────────────────────────────
// Thin wrapper around Extella REST API.
// Exposes: ETB.api.runExpert(), runExpertAsync(), runAgent(), runAgentAsync(),
//          extractAgentText(), taskCheck(), pollTask(), saveExpert(), …

ETB.api = (function () {
  var BASE = 'https://api.extella.ai';
  // The list call happens before an account agent is known. The API requires an
  // X-Agent-Id header syntactically for that bootstrap request, but does not
  // scope /api/agent/list by its value. Never use this non-real placeholder for
  // expert, KV, rule, or agent runs.
  var BOOTSTRAP_AGENT_SCOPE = 'agent_XXXXXXXX';
  var _agentResolvePromise = null;
  // Кандидаты ранжируются, а не выбирается один: пометка DEFAULT не гарантирует
  // рабочий ключ (проверено: у DEFAULT-копии ключ может быть битым, 401). Если
  // текущий агент отвечает ошибкой ключа, advanceAgent() переключает на
  // следующего кандидата — самовосстановление без участия пользователя.
  function _rankAgents(list) {
    var newer = [], plain = [], marked = [], rest = [];
    for (var i = 0; i < list.length; i++) {
      var a = list[i] || {};
      var id = a.id || a.agent_id;
      if (!id) continue;
      var nm = String(a.name || '');
      if (String(a.provider || '').toLowerCase() === 'alibaba') {
        if (nm.indexOf('NEW') >= 0) newer.push(id);
        else if (nm.indexOf('DEFAULT') >= 0) marked.push(id);
        else plain.push(id);
      } else rest.push(id);
    }
    // Prefer account-local Qwen, then any other account-local agent. No
    // cross-account/global fallback: every returned id came from this token.
    return newer.concat(plain, marked, rest);
  }
  function _resolveAgent() {
    if (window.__etbAgentId) return Promise.resolve(window.__etbAgentId);
    if (_agentResolvePromise) return _agentResolvePromise;
    _agentResolvePromise = _post('/api/agent/list', {}).then(function (d) {
      var cands = _rankAgents((d && d.agents) || []);
      if (!cands.length) {
        throw new Error('No runnable agent exists in the current Extella account');
      }
      window.__etbAgentCands = cands;
      window.__etbAgentIdx = 0;
      window.__etbAgentId = cands[0];
      console.log('[ETB:api] agent resolved: ' + window.__etbAgentId +
        ' (кандидатов: ' + cands.length + ')');
      return window.__etbAgentId;
    }).finally(function () { _agentResolvePromise = null; });
    return _agentResolvePromise;
  }
  function _agent() { return window.__etbAgentId || ''; }
  // Переключить на следующего кандидата (зовётся при ошибке ключа текущего).
  function _advanceAgent() {
    var cands = window.__etbAgentCands || [];
    var i = (window.__etbAgentIdx || 0) + 1;
    if (i >= cands.length) return null;
    window.__etbAgentIdx = i;
    window.__etbAgentId = cands[i];
    console.log('[ETB:api] agent advanced → ' + cands[i]);
    return cands[i];
  }
  // Rules are scoped per (account, agent). Target only the agent resolved from
  // the current account; never mirror rules into a hard-coded global scope.
  function _chatAgents() {
    var a = _agent();
    return a ? [a] : [];
  }

  // ── Install agent override ──────────────────────────────────────────────
  // Which backend agent executes plugin install / repair / auto-provision
  // runs (/api/agent/run). Unset → the account default agent, unchanged
  // behavior. Set → batch install work runs on a cheaper stock agent while
  // interactive chat panels keep their own hardcoded agent.
  // localStorage survives toolbar re-injection on navigation; the KV mirror
  // ('_install_agent_id') lets the value be set centrally and synced across
  // devices at boot via syncInstallAgentFromKV().
  var INSTALL_AGENT_LS = 'etb_install_agent_id';

  function _getInstallAgent() {
    try { return localStorage.getItem(INSTALL_AGENT_LS) || ''; } catch (e) { return ''; }
  }

  function setInstallAgent(id) {
    id = String(id || '').trim();
    try {
      if (id) localStorage.setItem(INSTALL_AGENT_LS, id);
      else localStorage.removeItem(INSTALL_AGENT_LS);
    } catch (e) {}
    // Best-effort cloud mirror; ignore failures (offline, token not ready).
    try {
      _post('/api/kv/set', { key: '_install_agent_id', value: id, description: 'Agent that runs plugin installs (toolbar)' })
        .catch(function () {});
    } catch (e) {}
    return id;
  }

  function syncInstallAgentFromKV() {
    return _post('/api/kv/get', { key: '_install_agent_id' }).then(function (r) {
      var id = (r && r.value != null) ? String(r.value).trim() : '';
      if (id) { try { localStorage.setItem(INSTALL_AGENT_LS, id); } catch (e) {} }
      return id;
    }).catch(function () { return ''; });
  }

  function _hdrs() {
    var agent = _agent() || BOOTSTRAP_AGENT_SCOPE;
    return {
      'Content-Type': 'application/json',
      'X-Auth-Token': ETB.auth.getToken(),
      'X-Profile-Id': 'default',
      'X-Agent-Id': agent
    };
  }

  function _post(path, body, extraHdrs, _retried) {
    // Apart from the list request itself, no account-scoped operation may run
    // against the bootstrap placeholder. Resolve once and retry transparently.
    if (!_agent() && path !== '/api/agent/list') {
      return _resolveAgent().then(function () {
        return _post(path, body, extraHdrs, _retried);
      }).catch(function (e) {
        return { status: 'error', message: e && e.message ? e.message : 'Unable to resolve current account agent' };
      });
    }
    // Таймаут: зависшая платформа раньше вешала всё, что не идёт через skBridge
    // (у того свои 20с). 90с — с запасом на длинные агентные ответы.
    var ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var tmr = ctl ? setTimeout(function () { try { ctl.abort(); } catch (e) {} }, 90000) : null;
    return fetch(BASE + path, {
      method: 'POST',
      headers: extraHdrs ? Object.assign(_hdrs(), extraHdrs) : _hdrs(),
      body: JSON.stringify(body),
      signal: ctl ? ctl.signal : undefined
    }).finally(function () { if (tmr) clearTimeout(tmr); }).then(function (r) {
      if (r.status === 401) {
        // Absent/stale iframe session token (blob: origin has no cookies). Ask the
        // parent host for the live token AND try a session refresh, wait briefly for
        // the token postMessage to land, then retry the request ONCE (guarded).
        // Fixes GitHub install → "Unauthorized — token required" from the storefront.
        if (_retried) {
          return { status: 'error', message: 'Unauthorized — token required' };
        }
        try {
          if (window.parent && window.parent !== window) {
            window.parent.postMessage({ type: 'etb_request_token' }, '*');
          }
        } catch (e) {}
        return new Promise(function (resolve) {
          Promise.resolve(ETB.auth.refreshSession('401-retry')).catch(function () {}).then(function () {
            setTimeout(function () { resolve(_post(path, body, extraHdrs, true)); }, 500);
          });
        });
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
    return _post('/api/tasks/check', { task_id: taskId });
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
      if (opts.cancelRef && opts.cancelRef.cancelled) {
        return Promise.reject(new Error('_cancelled_'));
      }
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
    // Explicit caller agent_id wins; otherwise the configured install agent;
    // otherwise the account default. The backend reads the agent from both
    // the body and the X-Agent-Id header — keep them in sync.
    var agent = body.agent_id || _getInstallAgent() || _agent();
    return _post('/api/agent/run',
      Object.assign({ run_timeout: 600 }, body, { agent_id: agent }),
      { 'X-Agent-Id': agent });
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
      onProgress: onProgress,
      cancelRef: opts.cancelRef          // {cancelled:bool} — прерывание поллинга (кнопка «Отмена»)
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
    getInstallAgent: _getInstallAgent,
    setInstallAgent: setInstallAgent,
    syncInstallAgentFromKV: syncInstallAgentFromKV,
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

    // Rules = always-on behavioral instructions injected into every agent turn.
    // This is the reliable vehicle for Skills (concepts are only search-retrieved,
    // so they don't fire on their own). Verified: a rule changes agent output.
    // List the user's agents. NOTE: the working path is singular /api/agent/list
    // (plural /api/agents/list is 404 — the known "agents/list пуст" bug).
    agentsList: function () {
      return _post('/api/agent/list', {});
    },

    // Текущий агент пользователя (динамический) и его принудительное
    // определение. currentAgent() до резолва возвращает пустую строку.
    currentAgent: _agent,
    resolveAgent: _resolveAgent,
    advanceAgent: _advanceAgent,

    // Add a rule. `agents` (array of ids) targets specific agents; omit to fall
    // back to the chat-agent candidates. Resolves to an array of { agent, ruleId }
    // refs (skipping failures) so uninstall can remove exactly what was added.
    rulesAdd: function (rule, agents) {
      var targets = (agents && agents.length) ? agents : _chatAgents();
      return Promise.all(targets.map(function (ag) {
        return _post('/api/rules/add', { rule: rule }, { 'X-Agent-Id': ag })
          .then(function (r) {
            var id = r && r.rule_id;
            return (id != null) ? { agent: ag, ruleId: id } : null;
          })
          .catch(function () { return null; });
      })).then(function (refs) { return refs.filter(Boolean); });
    },
    // Remove by the refs returned from rulesAdd (array of {agent, ruleId}).
    // Back-compat: a bare ruleId removes from the current account agent.
    rulesRemove: function (refs) {
      if (!Array.isArray(refs)) refs = [{ agent: _agent(), ruleId: refs }];
      return Promise.all(refs.map(function (ref) {
        if (!ref || ref.ruleId == null) return Promise.resolve();
        return _post('/api/rules/remove', { rule_id: ref.ruleId }, { 'X-Agent-Id': ref.agent })
          .catch(function () {});
      }));
    },
    rulesList: function () {
      return _post('/api/rules/list', {});
    },

    // Существует ли эксперт (глобальный скоуп). Пост-проверка установщика:
    // агент может молча провалить сохранение экспертов — тогда плагин ставится
    // «немым» и падает «Expert not found» на каждой кнопке.
    expertGet: function (name) {
      return _post('/api/expert/get', { name: name, global: true });
    },

    kvGet: function (key, opts) {
      var body = { key: key };
      if (opts && opts.global) body.global = true;
      return _post('/api/kv/get', body);
    },

    kvSet: function (key, value, desc, opts) {
      var body = { key: key, value: value, description: desc || '' };
      if (opts && opts.global) body.global = true;
      return _post('/api/kv/set', body);
    },

    health: function () {
      return fetch(BASE + '/api/health').then(function (r) { return r.json(); })
        .catch(function () { return { status: 'error' }; });
    }
  };
})();

// Определить агента, как только появился токен; при смене аккаунта — заново.
ETB.auth.onToken(function () { ETB.api.resolveAgent().catch(function () {}); });
ETB.auth.onSessionChange(function () {
  window.__etbAgentId = null;
  window.__etbAgentCands = [];
  window.__etbAgentIdx = 0;
  if (ETB.auth.getToken()) ETB.api.resolveAgent().catch(function () {});
});
