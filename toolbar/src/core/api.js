// ── API MODULE ─────────────────────────────────────────────────────────────
// Thin wrapper around Extella REST API.
// Exposes: ETB.api.runExpert(), runExpertAsync(), runAgent(), runAgentAsync(),
//          extractAgentText(), taskCheck(), pollTask(), saveExpert(), …

ETB.api = (function () {
  var BASE = 'https://api.extella.ai';
  // Агент НЕ зашивается: у каждого пользователя свой. Определяем динамически
  // из /api/agent/list (правило: платформенный Qwen/alibaba, при нескольких —
  // с пометкой DEFAULT; иначе первый в списке). Фолбэк — общий платформенный
  // агент, который есть у всех аккаунтов. Значение X-Agent-Id обязано
  // присутствовать в заголовках, но сервером не валидируется (проверено).
  // Заголовок X-Agent-Id обязателен синтаксически даже для /api/agent/list —
  // самого вызова, которым мы ТОЛЬКО И УЗНАЁМ агентов аккаунта. Значение при
  // этом сервером не проверяется (живая проверка 26.07), поэтому здесь стоит
  // заведомо ненастоящая заглушка, а не чей-то id. Для запусков экспертов,
  // агентов, KV и правил эту заглушку использовать НЕЛЬЗЯ.
  var BOOTSTRAP_AGENT_SCOPE = 'agent_XXXXXXXX';
  var FALLBACK_AGENT = 'agent_extella_alibaba_default';  // платформенный Qwen (канон: клиентам Qwen, НЕ Claude); доступен любому аккаунту, проверено
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
    // платформенный Qwen: свежие копии → обычные → помеченные DEFAULT → фолбэк
    return newer.concat(plain, marked, [FALLBACK_AGENT]);
  }
  function _resolveAgent() {
    if (window.__etbAgentId) return Promise.resolve(window.__etbAgentId);
    return _post('/api/agent/list', {}, { 'X-Agent-Id': BOOTSTRAP_AGENT_SCOPE }).then(function (d) {
      var cands = _rankAgents((d && d.agents) || []);
      window.__etbAgentCands = cands;
      window.__etbAgentIdx = 0;
      window.__etbAgentId = cands[0] || FALLBACK_AGENT;
      console.log('[ETB:api] agent resolved: ' + window.__etbAgentId +
        ' (кандидатов: ' + cands.length + ')');
      return window.__etbAgentId;
    }).catch(function () { return FALLBACK_AGENT; });
  }
  function _agent() { return window.__etbAgentId || FALLBACK_AGENT; }
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
  // Agents the user actually chats with. Rules are scoped per (account, agent),
  // and the desktop chat resolves to a default Qwen agent whose exact id varies
  // (alibaba default vs the Qwen id). We can't reliably detect which at runtime,
  // so a Skill installs its rule on BOTH — whichever the chat uses, it's there.
  // Writing under the user's own token only affects that user's chat.
  // Портируемость: второй элемент раньше был личным ID с одного устройства
  // (agent_XwZ…) — у остальных пользователей правило навыка молча не ложилось
  // на их чат-агента. Теперь второй адресат — динамически определённый агент
  // аккаунта (_resolveAgent), дедуп на случай совпадения ниже по месту записи.
  var CHAT_AGENTS = ['agent_extella_alibaba_default'];
  function _chatAgents() {
    var out = CHAT_AGENTS.slice();
    try { var a = _agent(); if (a && out.indexOf(a) < 0) out.push(a); } catch (e) {}
    return out;
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
    return {
      'Content-Type': 'application/json',
      'X-Auth-Token': ETB.auth.getToken(),
      'X-Profile-Id': 'default',
      'X-Agent-Id': _agent()
    };
  }

  function _post(path, body, extraHdrs, opts) {
    // Таймаут: зависшая платформа раньше вешала всё, что не идёт через skBridge
    // (у того свои 20с). 90с — с запасом на длинные агентные ответы.
    // opts.timeoutMs поднимает лимит для запросов, которые сервер легитимно
    // держит дольше (agent/run): обрыв клиента НЕ останавливает ран на
    // устройстве — получается «зомби»-ран при ошибке в UI.
    opts = opts || {};
    var timeoutMs = opts.timeoutMs || 90000;
    var ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var tmr = ctl ? setTimeout(function () { try { ctl.abort(); } catch (e) {} }, timeoutMs) : null;
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
        if (opts.retried) {
          return { status: 'error', message: 'Unauthorized — token required' };
        }
        try {
          if (window.parent && window.parent !== window) {
            window.parent.postMessage({ type: 'etb_request_token' }, '*');
          }
        } catch (e) {}
        return new Promise(function (resolve) {
          Promise.resolve(ETB.auth.refreshSession('401-retry')).catch(function () {}).then(function () {
            setTimeout(function () { resolve(_post(path, body, extraHdrs, Object.assign({}, opts, { retried: true }))); }, 500);
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
        // Платформа использует running буквально: задача ещё исполняется.
        // Возвращать такой ответ как финальный нельзя — у отложенного Expert в
        // нём ещё нет result. Из-за этого чтение HTML панели с устройства
        // завершалось пустым ответом и витрина навсегда оставалась на заставке.
        if (st === 'completed' || st === 'success' || st === 'done') {
          return data;
        }
        if (data && (data.result != null || data.output || data.answer)) {
          return data;
        }
        if (st === 'failed' || st === 'error') {
          return Promise.reject(new Error(data.message || 'Task failed'));
        }

        // Stall detection: track whether agent output is making progress.
        if (stallTimeout > 0 && (st === 'busy' || st === 'running' || st === 'in_progress' || st === 'queued')) {
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
    var full = Object.assign({ run_timeout: 600 }, body, { agent_id: agent });
    // Клиентский таймаут ≥ серверного run_timeout: платформа может держать
    // agent/run открытым (даже с async:true) дольше 90с. Дефолтный 90с-abort
    // ронял установку в UI («signal is aborted»), а ран на устройстве
    // продолжался — источник зомби-хвостов, дописывающих манифест после Retry.
    return _post('/api/agent/run', full, { 'X-Agent-Id': agent },
      { timeoutMs: ((full.run_timeout || 600) + 60) * 1000 });
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
    opts = opts || {};
    var clientTimeoutMs = Number(opts.clientTimeoutMs || 0);
    var bodyOptions = Object.assign({}, opts);
    // clientTimeoutMs belongs to the Desktop transport only. Passing it in the
    // /api/expert/run JSON body makes it look like a platform run option and
    // couples the UI deadline to server semantics. Keep the two clocks separate.
    delete bodyOptions.clientTimeoutMs;
    return _post('/api/expert/run', Object.assign(
      { expert_name: name, params: params || {} },
      bodyOptions
    ), null, clientTimeoutMs > 0 ? { timeoutMs: clientTimeoutMs } : undefined);
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

    saveExpertScoped: function (def, agentId) {
      return _post(
        '/api/expert/save',
        def,
        agentId ? { 'X-Agent-Id': String(agentId) } : null
      );
    },

    getExpert: function (name, opts) {
      opts = opts || {};
      return _post('/api/expert/get', {
        name: name,
        global: opts.global === true
      });
    },

    getExpertScoped: function (name, agentId, opts) {
      opts = opts || {};
      return _post(
        '/api/expert/get',
        {
          name: name,
          global: opts.global === true
        },
        agentId ? { 'X-Agent-Id': String(agentId) } : null
      );
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

    // Narrow scoped primitives used by the built-in Capability Studio.
    // Agent ID is accepted only for an explicit cross-agent visibility probe;
    // the account credential and Profile remain in the toolbar context.
    conceptAddScoped: function (text, opts) {
      opts = opts || {};
      return _post('/api/concept/add', {
        text: text,
        global: opts.global === true
      }, opts.agentId ? { 'X-Agent-Id': opts.agentId } : null);
    },
    conceptListScoped: function (opts) {
      opts = opts || {};
      return _post('/api/concept/list', {
        global: opts.global === true,
        limit: Math.min(Number(opts.limit || 500), 500),
        offset: Math.max(0, Number(opts.offset || 0))
      }, opts.agentId ? { 'X-Agent-Id': opts.agentId } : null);
    },
    conceptDeleteScoped: function (conceptId, opts) {
      opts = opts || {};
      return _post('/api/concept/delete', {
        concept_id: Number(conceptId)
      }, opts.agentId ? { 'X-Agent-Id': opts.agentId } : null);
    },
    ruleAddScoped: function (rule, opts) {
      opts = opts || {};
      return _post('/api/rules/add', {
        rule: rule,
        global: opts.global === true
      }, opts.agentId ? { 'X-Agent-Id': opts.agentId } : null);
    },
    ruleListScoped: function (opts) {
      opts = opts || {};
      return _post('/api/rules/list', {
        global: opts.global === true
      }, opts.agentId ? { 'X-Agent-Id': opts.agentId } : null);
    },
    ruleUpdateScoped: function (ruleId, rule, opts) {
      opts = opts || {};
      return _post('/api/rules/update', {
        rule_id: String(ruleId),
        rule: rule
      }, opts.agentId ? { 'X-Agent-Id': opts.agentId } : null);
    },
    ruleDeleteScoped: function (ruleId, opts) {
      opts = opts || {};
      return _post('/api/rules/delete', {
        rule_id: String(ruleId)
      }, opts.agentId ? { 'X-Agent-Id': opts.agentId } : null);
    },
    // ── ОДНОРАЗОВАЯ ПЕСОЧНИЦА EVOLUTION LAB (host-only) ──────────────────
    // Агента для полигона готовит ВЛАДЕЛЕЦ руками; создания через API здесь нет
    // намеренно — платформа всё равно отбивает такой запуск (`pro_key_required`), а
    // лишний рычаг «создай агента из кода» нам не нужен. Осталось только удаление:
    // одноразовую среду обязаны сносить мы, а не человек. Маршрута из iframe у этих
    // обёрток НЕТ; роутер их не публикует, зовёт только host-runner.
    // Инструкции одноразовой среды задаёт host: агент без инструментов иначе отвечает
    // текстом вызовов, и измерять нечего. Значение фиксированное, из iframe не приходит.
    agentInstructionsUpdateScoped: function (agentId, instructions) {
      return _post('/api/agent/update', {
        agent_id: String(agentId || ''),
        instructions: String(instructions || '')
      }, agentId ? { 'X-Agent-Id': String(agentId) } : null);
    },
    agentDeleteSandbox: function (agentId) {
      return _post('/api/agent/delete', { agent_id: String(agentId || '') });
    },
    // Удаление правила в точном скоупе. Отдельно от rulesRemove: тот глотает ошибки
    // (для чата это терпимо), а полигону нужен честный ответ — неподтверждённая
    // уборка не имеет права стать PASSED.
    ruleRemoveScoped: function (ruleId, opts) {
      opts = opts || {};
      return _post('/api/rules/remove', {
        rule_id: ruleId
      }, opts.agentId ? { 'X-Agent-Id': opts.agentId } : null);
    },
    agentGetScoped: function (agentId) {
      return _post('/api/agent/get', {
        agent_id: String(agentId || '')
      }, agentId ? { 'X-Agent-Id': String(agentId) } : null);
    },
    agentToolsUpdateScoped: function (agentId, tools) {
      return _post(
        '/api/agent/update',
        {
          agent_id: String(agentId || ''),
          tools: Array.isArray(tools) ? tools.slice() : []
        },
        agentId ? { 'X-Agent-Id': String(agentId) } : null
      );
    },
    expertsListScoped: function (opts) {
      opts = opts || {};
      return _post('/api/experts_db/list', {
        global: opts.global === true
      }, opts.agentId ? { 'X-Agent-Id': opts.agentId } : null);
    },

    // Rules = always-on behavioral instructions injected into every agent turn.
    // This is the reliable vehicle for Skills (concepts are only search-retrieved,
    // so they don't fire on their own). Verified: a rule changes agent output.
    // List the user's agents. NOTE: the working path is singular /api/agent/list
    // (plural /api/agents/list is 404 — the known "agents/list пуст" bug).
    agentsList: function () {
      return _post('/api/agent/list', {});
    },

    // Платформенный Qwen отдаём наружу, чтобы панели не хардкодили его у себя:
    // правило check-account-scope разрешает этот id только здесь. Платного Claude
    // тут нет намеренно — его не нужно называть даже для того, чтобы отфильтровать
    // (см. github-add.js: фильтр по платформенной Qwen отсекает его сам).
    platformTrialAgent: FALLBACK_AGENT,

    // Текущий агент пользователя (динамический) и его принудительное
    // определение. currentAgent() до резолва отдаёт платформенный фолбэк.
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
    // Back-compat: a bare ruleId removes from the first candidate.
    rulesRemove: function (refs) {
      if (!Array.isArray(refs)) refs = [{ agent: CHAT_AGENTS[0], ruleId: refs }];
      return Promise.all(refs.map(function (ref) {
        if (!ref || ref.ruleId == null) return Promise.resolve();
        return _post('/api/rules/remove', { rule_id: ref.ruleId }, { 'X-Agent-Id': ref.agent })
          .catch(function () {});
      }));
    },
    rulesList: function () {
      return _post('/api/rules/list', {}, { 'X-Agent-Id': CHAT_AGENTS[0] });
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
      return _post('/api/kv/get', body,
        opts && opts.agentId ? { 'X-Agent-Id': opts.agentId } : null);
    },

    kvSet: function (key, value, desc, opts) {
      var body = { key: key, value: value, description: desc || '' };
      if (opts && opts.global) body.global = true;
      return _post('/api/kv/set', body,
        opts && opts.agentId ? { 'X-Agent-Id': opts.agentId } : null);
    },

    health: function () {
      return fetch(BASE + '/api/health').then(function (r) { return r.json(); })
        .catch(function () { return { status: 'error' }; });
    }
  };
})();

// Определить агента, как только появился токен; при смене аккаунта — заново.
ETB.auth.onToken(function () { ETB.api.resolveAgent(); });
ETB.auth.onSessionChange(function () { window.__etbAgentId = null; if (ETB.auth.getToken()) ETB.api.resolveAgent(); });
