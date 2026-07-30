// ── CODEX CONNECTOR INSTALLER ──────────────────────────────────────────────
// Trusted host-side installer used only by the dedicated Codex button in the
// Extella storefront. The iframe never supplies an Expert name, shell command,
// repository, ref, credential, or target device. Every mutable value below is
// pinned in this signed toolbar release.

ETB.codexInstaller = (function () {
  var EXPERT_NAME = '_etb_codex_setup_v2';
  var EXPERT_SHA256 = 'b80a59fbcd73fdc67650d42e7c2b784b07668890fa22e0cee9c5be31e3ba044e';
  var PLUGIN_VERSION = '0.4.0';
  var STANDARDS_REF = 'v0.1.0';
  var STATE_KEY = 'extella:codex-connection:v1';
  var _running = false;
  var _fleetRunning = false;

  var EXPERT_CODE = [
    'def _etb_codex_setup_v2(step="preflight") -> str:',
    '    import json, os, platform, secrets, shutil, subprocess, urllib.request',
    '    BUILDER_REPO = "https://github.com/AnvarBakiyev/extella-agent-builder.git"',
    '    BUILDER_REF = "v0.4.0"',
    '    STANDARDS_REF = "v0.1.0"',
    '    MARKETPLACE = "extella-team"',
    '    PLUGIN = "extella-agent-builder@extella-team"',
    '',
    '    def result(status, code, message, **extra):',
    '        payload = {"status": status, "code": code, "message": message,',
    '                   "step": step, "model_called": False,',
    '                   "agent_called": False, "paid": False}',
    '        payload.update(extra)',
    '        return json.dumps(payload, ensure_ascii=False)',
    '',
    '    def find_command(name):',
    '        found = shutil.which(name)',
    '        if found:',
    '            return found',
    '        home = os.path.expanduser("~")',
    '        for root in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin",',
    '                     os.path.join(home, ".local", "bin"),',
    '                     os.path.join(home, ".npm-global", "bin")]:',
    '            candidate = os.path.join(root, name)',
    '            if os.path.isfile(candidate) and os.access(candidate, os.X_OK):',
    '                return candidate',
    '        return ""',
    '',
    '    def safe_env():',
    '        env = dict(os.environ)',
    '        env["GIT_TERMINAL_PROMPT"] = "0"',
    '        env["GH_PROMPT_DISABLED"] = "1"',
    '        for key in ["EXTELLA_API_TOKEN", "EXTELLA_SECONDARY_API_TOKEN",',
    '                    "EXTELLA_BRIDGE_SECRET", "OPENAI_API_KEY", "CODEX_API_KEY"]:',
    '            env.pop(key, None)',
    '        return env',
    '',
    '    def run(args, timeout=120, allow_failure=False):',
    '        try:',
    '            completed = subprocess.run(args, stdout=subprocess.PIPE,',
    '                stderr=subprocess.PIPE, text=True, timeout=timeout,',
    '                env=safe_env(), shell=False)',
    '        except subprocess.TimeoutExpired:',
    '            if allow_failure:',
    '                return None',
    '            raise RuntimeError("command_timeout")',
    '        except Exception:',
    '            if allow_failure:',
    '                return None',
    '            raise RuntimeError("command_failed")',
    '        if completed.returncode != 0:',
    '            if allow_failure:',
    '                return None',
    '            raise RuntimeError("command_exit_" + str(completed.returncode))',
    '        return completed.stdout or ""',
    '',
    '    def current_token():',
    '        try:',
    '            from extella_expert_bridge import account_config',
    '            token = str(account_config().get("auth_token", "") or "").strip()',
    '        except Exception:',
    '            token = ""',
    '        return token',
    '',
    '    def validate_token(token):',
    '        if len(token) < 8:',
    '            return False',
    '        body = json.dumps({"token": token}).encode("utf-8")',
    '        request = urllib.request.Request(',
    '            "https://api.extella.ai/api/token/validate", data=body,',
    '            headers={"Content-Type": "application/json"}, method="POST")',
    '        try:',
    '            with urllib.request.urlopen(request, timeout=15) as response:',
    '                if response.status < 200 or response.status >= 300:',
    '                    return False',
    '                payload = json.loads(response.read(65537).decode("utf-8"))',
    '                return payload.get("valid") is True',
    '        except Exception:',
    '            return False',
    '',
    '    def parse_json(text):',
    '        try:',
    '            return json.loads(text)',
    '        except Exception:',
    '            return None',
    '',
    '    def installed_plugin():',
    '        listing = parse_json(run([codex, "plugin", "list", "--json"],',
    '            timeout=60)) or {}',
    '        for item in listing.get("installed", []):',
    '            if (item.get("pluginId") == PLUGIN and',
    '                    item.get("installed") is True and',
    '                    item.get("enabled") is True and',
    '                    item.get("version") == BUILDER_REF[1:]):',
    '                source = item.get("source") or {}',
    '                path = str(source.get("path", "") or "")',
    '                if os.path.isabs(path):',
    '                    return item, path',
    '        return None, ""',
    '',
    '    if platform.system() != "Darwin":',
    '        return result("error", "unsupported_os",',
    '            "Автоматическая установка пока поддерживает только macOS.")',
    '',
    '    codex = find_command("codex")',
    '    git = find_command("git")',
    '    launchctl = find_command("launchctl")',
    '    node = find_command("node")',
    '    if not codex:',
    '        return result("error", "codex_not_installed",',
    '            "Codex не установлен на этом компьютере.")',
    '    if not git or not launchctl or not node:',
    '        return result("error", "system_tools_missing",',
    '            "На компьютере не найдены системные инструменты git, node или launchctl.")',
    '',
    '    if step == "preflight":',
    '        token = current_token()',
    '        if not validate_token(token):',
    '            return result("error", "extella_token_unavailable",',
    '                "Extella не передала действующий токен текущего аккаунта.")',
    '        try:',
    '            version = run([codex, "--version"], timeout=20).strip()[:120]',
    '            run([codex, "login", "status"], timeout=30)',
    '        except Exception:',
    '            return result("error", "codex_not_ready",',
    '                "Codex найден, но вход в аккаунт не подтверждён.")',
    '        if run([git, "ls-remote", "--exit-code", BUILDER_REPO,',
    '                "refs/tags/" + BUILDER_REF], timeout=45, allow_failure=True) is None:',
    '            return result("error", "builder_release_unavailable",',
    '                "Не удалось получить опубликованный релиз Agent Builder.")',
    '        return result("success", "preflight_ok", "Проверки пройдены.",',
    '            codex_version=version, builder_ref=BUILDER_REF,',
    '            standards_ref=STANDARDS_REF)',
    '',
    '    if step == "install":',
    '        try:',
    '            listing = parse_json(run([codex, "plugin", "marketplace",',
    '                "list", "--json"], timeout=45)) or {}',
    '            exists = any(item.get("name") == MARKETPLACE',
    '                for item in listing.get("marketplaces", []))',
    '            if exists:',
    '                run([codex, "plugin", "marketplace", "remove", MARKETPLACE,',
    '                    "--json"], timeout=90)',
    '            run([codex, "plugin", "marketplace", "add",',
    '                "AnvarBakiyev/extella-agent-builder", "--ref", BUILDER_REF,',
    '                "--json"], timeout=180)',
    '            run([codex, "plugin", "add", PLUGIN, "--json"], timeout=180)',
    '        except Exception:',
    '            return result("error", "plugin_install_failed",',
    '                "Не удалось установить Agent Builder. Можно безопасно повторить.")',
    '        return result("success", "plugin_installed",',
    '            "Agent Builder установлен.", plugin_version="0.4.0")',
    '',
    '    if step == "credentials":',
    '        token = current_token()',
    '        if not validate_token(token):',
    '            return result("error", "extella_token_unavailable",',
    '                "Не удалось подтвердить токен текущего аккаунта Extella.")',
    '        try:',
    '            run([launchctl, "setenv", "EXTELLA_API_TOKEN", token], timeout=20)',
    '            existing = run([launchctl, "getenv", "EXTELLA_BRIDGE_SECRET"],',
    '                timeout=20, allow_failure=True) or ""',
    '            if len(existing.strip()) < 32:',
    '                bridge_secret = secrets.token_hex(32)',
    '                run([launchctl, "setenv", "EXTELLA_BRIDGE_SECRET",',
    '                    bridge_secret], timeout=20)',
    '                bridge_secret = ""',
    '        except Exception:',
    '            return result("error", "credential_setup_failed",',
    '                "Не удалось подключить локальные переменные Extella к Codex.")',
    '        token = ""',
    '        return result("success", "credentials_configured",',
    '            "Аккаунт Extella подключён локально.")',
    '',
    '    if step == "bridge":',
    '        try:',
    '            _, plugin_path = installed_plugin()',
    '            script = os.path.join(plugin_path, "scripts",',
    '                "configure-bridge-macos.mjs")',
    '            if not plugin_path or not os.path.isfile(script):',
    '                return result("error", "bridge_script_unavailable",',
    '                    "Не найден проверенный установщик локального моста.")',
    '            output = parse_json(run([node, script,',
    '                "--account-wide",',
    '                "--confirm-account-scope", "I_UNDERSTAND_ALL_AGENTS",',
    '                "--capability", "general-assistance",',
    '                "--provider", "codex",',
    '                "--confirm-live-cost", "I_UNDERSTAND_COST"],',
    '                timeout=180)) or {}',
    '            if (output.get("status") != "configured" or',
    '                    output.get("authorization_scope") != "account"):',
    '                raise RuntimeError("bridge_not_configured")',
    '        except Exception:',
    '            return result("error", "bridge_setup_failed",',
    '                "Не удалось запустить локальный мост Codex.")',
    '        return result("success", "bridge_ready",',
    '            "Локальный мост Codex запущен.", live_enabled=True)',
    '',
    '    if step == "verify":',
    '        try:',
    '            installed, _ = installed_plugin()',
    '            if not installed:',
    '                return result("error", "plugin_verification_failed",',
    '                    "Codex не подтвердил установленную версию Agent Builder.")',
    '            token_present = run([launchctl, "getenv", "EXTELLA_API_TOKEN"],',
    '                timeout=20, allow_failure=True) or ""',
    '            secret_present = run([launchctl, "getenv", "EXTELLA_BRIDGE_SECRET"],',
    '                timeout=20, allow_failure=True) or ""',
    '            binding = run([launchctl, "getenv",',
    '                "EXTELLA_BRIDGE_ACCOUNT_BINDING"],',
    '                timeout=20, allow_failure=True) or ""',
    '            port = run([launchctl, "getenv", "EXTELLA_BRIDGE_PORT"],',
    '                timeout=20, allow_failure=True) or "8787"',
    '            if (len(token_present.strip()) < 8 or',
    '                    len(secret_present.strip()) < 32 or',
    '                    len(binding.strip()) != 64):',
    '                return result("error", "environment_verification_failed",',
    '                    "Локальные параметры подключения не сохранились.")',
    '            with urllib.request.urlopen("http://127.0.0.1:" +',
    '                    str(int(port.strip())) + "/health", timeout=10) as response:',
    '                health = json.loads(response.read(65536).decode("utf-8"))',
    '            if (health.get("status") != "ok" or',
    '                    health.get("live_enabled") is not True or',
    '                    "codex" not in health.get("providers", []) or',
    '                    "account" not in health.get("authorization_scopes", [])):',
    '                return result("error", "bridge_verification_failed",',
    '                    "Локальный мост не подтвердил account-wide режим.")',
    '        except Exception:',
    '            return result("error", "verification_failed",',
    '                "Не удалось проверить итоговую конфигурацию Codex.")',
    '        return result("success", "ready", "Codex подключён к Extella.",',
    '            plugin_version="0.4.0", restart_required=False,',
    '            live_enabled=True, authorization_scope="account")',
    '',
    '    return result("error", "unsupported_step",',
    '        "Установщик получил неизвестный этап.")'
  ].join('\n');

  function metadata() {
    return {
      expertName: EXPERT_NAME,
      expertSha256: EXPERT_SHA256,
      bridgeExpertName: ETB.codexAccountBridge.name,
      bridgeExpertSha256: ETB.codexAccountBridge.sha256,
      pluginVersion: PLUGIN_VERSION,
      standardsRef: STANDARDS_REF
    };
  }

  function _parseRunResult(response) {
    var value = response;
    if (value && value.result !== undefined) value = value.result;
    if (typeof value === 'string') {
      try { value = JSON.parse(value); } catch (_) {
        throw new Error('Установщик вернул некорректный результат.');
      }
    }
    if (!value || value.status !== 'success') {
      var error = new Error((value && value.message) || 'Этап установки завершился ошибкой.');
      error.code = (value && value.code) || 'installer_failed';
      throw error;
    }
    return value;
  }

  function _resolveDeviceId() {
    var direct = '';
    try {
      direct = (window.extellaDesktop &&
        typeof window.extellaDesktop.getDeviceID === 'function')
        ? String(window.extellaDesktop.getDeviceID() || '') : '';
    } catch (_) {}
    if (direct) return Promise.resolve(direct);
    return ETB.api.kvGet('_device_id')
      .then(function (response) {
        var value = response && response.value;
        if (!value) throw new Error('Не удалось определить текущий компьютер Extella.');
        return String(value);
      });
  }

  function _readExpertCode(response) {
    var value = response && response.result !== undefined ? response.result : response;
    return String((value && (value.expert_code || value.code)) || '');
  }

  function _agentRows(response) {
    var value = response && response.content ? response.content : response;
    return (value && Array.isArray(value.agents)) ? value.agents : [];
  }

  function _agentDetail(response) {
    var value = response && response.content ? response.content : response;
    return (value && value.agent) || value || {};
  }

  function _mapLimit(items, limit, worker) {
    var index = 0;
    var results = new Array(items.length);
    function runner() {
      function next() {
        var current = index++;
        if (current >= items.length) return Promise.resolve();
        return Promise.resolve(worker(items[current], current))
          .then(function (value) {
            results[current] = value;
            return next();
          });
      }
      return next();
    }
    var runners = [];
    for (var i = 0; i < Math.min(limit, items.length); i++) {
      runners.push(runner());
    }
    return Promise.all(runners).then(function () { return results; });
  }

  function _installForAgent(agent) {
    var agentId = String((agent && (agent.id || agent.agent_id)) || '');
    if (!/^agent_[A-Za-z0-9_-]{8,128}$/.test(agentId)) {
      throw new Error('Extella вернула некорректный ID агента.');
    }
    var bridge = ETB.codexAccountBridge;
    var beforeTools = [];
    var added = false;
    return ETB.api.agentGetScoped(agentId)
      .then(function (beforeResponse) {
        var detail = _agentDetail(beforeResponse);
        beforeTools = Array.isArray(detail.tools) ?
          detail.tools.map(String) : [];
        added = beforeTools.indexOf(bridge.name) === -1;
        return ETB.api.getExpertScoped(
          bridge.name,
          agentId,
          { global: false }
        ).catch(function () { return null; });
      })
      .then(function (existing) {
        if (_readExpertCode(existing) === bridge.code) return null;
        return ETB.api.saveExpertScoped({
          name: bridge.name,
          description: bridge.description,
          code: bridge.code,
          kwargs: bridge.kwargs,
          cspl: 'fython',
          global: false
        }, agentId).then(function (saved) {
          if (saved && saved.status === 'error') {
            throw new Error(saved.message || 'Не удалось сохранить Codex Expert.');
          }
        });
      })
      .then(function () {
        if (!added) return null;
        return ETB.api.agentToolsUpdateScoped(
          agentId,
          beforeTools.concat([bridge.name])
        ).then(function (updated) {
          if (updated && updated.status === 'error') {
            throw new Error(updated.message || 'Не удалось подключить Codex к агенту.');
          }
        });
      })
      .then(function () {
        return Promise.all([
          ETB.api.getExpertScoped(bridge.name, agentId, { global: false }),
          ETB.api.agentGetScoped(agentId)
        ]);
      })
      .then(function (readback) {
        var detail = _agentDetail(readback[1]);
        var tools = Array.isArray(detail.tools) ? detail.tools.map(String) : [];
        if (_readExpertCode(readback[0]) !== bridge.code ||
            tools.indexOf(bridge.name) === -1) {
          throw new Error('Проверка Codex Expert у агента ' + agentId + ' не прошла.');
        }
        return { agentId: agentId, added: added };
      });
  }

  function _writeConnectionState(agentCount) {
    var value = JSON.stringify({
      schema_version: '1.0',
      enabled: true,
      scope: 'account',
      provider: 'codex',
      capability: 'general-assistance',
      plugin_version: PLUGIN_VERSION,
      expert_name: ETB.codexAccountBridge.name,
      expert_sha256: ETB.codexAccountBridge.sha256,
      current_agent_count: agentCount,
      reconcile_future_agents: true,
      updated_at: new Date().toISOString()
    });
    return ETB.api.kvSet(
      STATE_KEY,
      value,
      'Account-wide Codex connection state',
      { global: true }
    );
  }

  function _readConnectionState() {
    return ETB.api.kvGet(STATE_KEY, { global: true }).then(function (response) {
      var value = response && response.value !== undefined ?
        response.value : response;
      if (typeof value === 'string') {
        try { value = JSON.parse(value); } catch (_) { return null; }
      }
      return value && value.enabled === true ? value : null;
    }).catch(function () { return null; });
  }

  function reconcileFleet(options) {
    options = options || {};
    if (_fleetRunning) return Promise.resolve({ status: 'busy' });
    _fleetRunning = true;
    var rows = [];
    return ETB.api.agentsList()
      .then(function (response) {
        rows = _agentRows(response);
        if (!rows.length) throw new Error('В аккаунте Extella не найдены агенты.');
        return _mapLimit(rows, 3, _installForAgent);
      })
      .then(function (receipts) {
        return _writeConnectionState(rows.length).then(function () {
          return {
            status: 'ready',
            agentCount: rows.length,
            addedCount: receipts.filter(function (item) {
              return item && item.added;
            }).length,
            expertSha256: ETB.codexAccountBridge.sha256
          };
        });
      })
      .finally(function () { _fleetRunning = false; });
  }

  function _startAutoReconcile() {
    if (typeof setTimeout !== 'function' || !ETB.api) return;
    function tick() {
      _readConnectionState().then(function (state) {
        if (!state ||
            state.expert_sha256 !== ETB.codexAccountBridge.sha256 ||
            state.plugin_version !== PLUGIN_VERSION) return;
        reconcileFleet({ automatic: true }).catch(function () {});
      });
    }
    setTimeout(tick, 10000);
    if (typeof setInterval === 'function') setInterval(tick, 120000);
  }

  function _provision() {
    return ETB.api.saveExpert({
      name: EXPERT_NAME,
      description: 'Pinned local installer for Extella Agent Builder in Codex',
      code: EXPERT_CODE,
      kwargs: {},
      cspl: 'fython'
    }).then(function (saved) {
      if (saved && saved.status === 'error') {
        throw new Error(saved.message || 'Не удалось подготовить локальный установщик.');
      }
      return ETB.api.getExpert(EXPERT_NAME, { global: false });
    }).then(function (readback) {
      if (_readExpertCode(readback) !== EXPERT_CODE) {
        throw new Error('Проверка кода установщика после сохранения не прошла.');
      }
    });
  }

  function _runStep(deviceId, step) {
    var longStep = step === 'install' || step === 'bridge';
    return ETB.api.runExpertAsync(
      EXPERT_NAME,
      { step: step },
      {
        target: deviceId,
        timeout: longStep ? 360 : 120,
        maxWait: longStep ? 420000 : 180000,
        interval: 1500,
        stallTimeout: 0
      }
    ).then(_parseRunResult);
  }

  function install(options) {
    options = options || {};
    var progress = options.onProgress || function () {};
    if (_running) {
      var busy = new Error('Подключение Codex уже выполняется.');
      busy.code = 'already_running';
      return Promise.reject(busy);
    }
    _running = true;
    var deviceId;
    var finalResult;
    return _resolveDeviceId()
      .then(function (resolved) {
        deviceId = resolved;
        progress({ stage: 'provisioning', metadata: metadata() });
        return _provision();
      })
      .then(function () {
        progress({ stage: 'preflight', metadata: metadata() });
        return _runStep(deviceId, 'preflight');
      })
      .then(function () {
        progress({ stage: 'install', metadata: metadata() });
        return _runStep(deviceId, 'install');
      })
      .then(function () {
        progress({ stage: 'credentials', metadata: metadata() });
        return _runStep(deviceId, 'credentials');
      })
      .then(function () {
        progress({ stage: 'bridge', metadata: metadata() });
        return _runStep(deviceId, 'bridge');
      })
      .then(function () {
        progress({ stage: 'agents', metadata: metadata() });
        return reconcileFleet();
      })
      .then(function (fleet) {
        progress({ stage: 'verify', metadata: metadata() });
        return _runStep(deviceId, 'verify').then(function (result) {
          result.fleet = fleet;
          return result;
        });
      })
      .then(function (result) {
        finalResult = result;
        progress({ stage: 'done', metadata: metadata() });
        return {
          status: 'success',
          code: 'ready',
          pluginVersion: result.plugin_version || PLUGIN_VERSION,
          restartRequired: result.restart_required === true,
          liveEnabled: result.live_enabled === true,
          authorizationScope: result.authorization_scope,
          agentCount: result.fleet && result.fleet.agentCount,
          modelCalled: false,
          agentCalled: false,
          paid: false,
          metadata: metadata()
        };
      })
      .finally(function () {
        _running = false;
        finalResult = null;
      });
  }

  _startAutoReconcile();
  return {
    install: install,
    reconcileFleet: reconcileFleet,
    metadata: metadata,
    expertCode: function () { return EXPERT_CODE; },
    bridgeExpertCode: function () { return ETB.codexAccountBridge.code; }
  };
})();
