// ── CODEX CONNECTOR INSTALLER ──────────────────────────────────────────────
// Trusted host-side installer used only by the dedicated Codex button in the
// Extella storefront. The iframe never supplies an Expert name, shell command,
// repository, ref, credential, or target device. Every mutable value below is
// pinned in this signed toolbar release.

ETB.codexInstaller = (function () {
  var EXPERT_NAME = '_etb_codex_setup_v1';
  var EXPERT_SHA256 = '43b1acdf06fff012d1c6e716c04cb87c9a96b163b4ba7b4b9b9b98defea9c3ce';
  var PLUGIN_VERSION = '0.3.2';
  var STANDARDS_REF = 'v0.1.0';
  var _running = false;

  var EXPERT_CODE = [
    'def _etb_codex_setup_v1(step="preflight") -> str:',
    '    import json, os, platform, secrets, shutil, subprocess, urllib.request',
    '    BUILDER_REPO = "https://github.com/AnvarBakiyev/extella-agent-builder.git"',
    '    BUILDER_REF = "v0.3.2"',
    '    STANDARDS_REPO = "https://github.com/AnvarBakiyev/extella-agent-standards.git"',
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
    '    if platform.system() != "Darwin":',
    '        return result("error", "unsupported_os",',
    '            "Автоматическая установка пока поддерживает только macOS.")',
    '',
    '    codex = find_command("codex")',
    '    git = find_command("git")',
    '    launchctl = find_command("launchctl")',
    '    if not codex:',
    '        return result("error", "codex_not_installed",',
    '            "Codex не установлен на этом компьютере.")',
    '    if not git or not launchctl:',
    '        return result("error", "system_tools_missing",',
    '            "На компьютере не найдены системные инструменты git или launchctl.")',
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
    '        standards_ok = run([git, "ls-remote", "--exit-code", STANDARDS_REPO,',
    '            "refs/tags/" + STANDARDS_REF], timeout=45, allow_failure=True)',
    '        if standards_ok is None:',
    '            gh = find_command("gh")',
    '            if gh and run([gh, "auth", "status"], timeout=30,',
    '                          allow_failure=True) is not None:',
    '                run([gh, "auth", "setup-git"], timeout=30, allow_failure=True)',
    '                standards_ok = run([git, "ls-remote", "--exit-code",',
    '                    STANDARDS_REPO, "refs/tags/" + STANDARDS_REF],',
    '                    timeout=45, allow_failure=True)',
    '        if standards_ok is None:',
    '            return result("error", "standards_access_denied",',
    '                "Нет доступа к репозиторию стандартов Extella в GitHub.")',
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
    '            "Agent Builder установлен.", plugin_version="0.3.2")',
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
    '    if step == "verify":',
    '        try:',
    '            plugins = parse_json(run([codex, "plugin", "list", "--json"],',
    '                timeout=60)) or {}',
    '            installed = [item for item in plugins.get("installed", [])',
    '                if item.get("pluginId") == PLUGIN and item.get("installed") is True',
    '                and item.get("enabled") is True]',
    '            if not installed or installed[0].get("version") != "0.3.2":',
    '                return result("error", "plugin_verification_failed",',
    '                    "Codex не подтвердил установленную версию Agent Builder.")',
    '            token_present = run([launchctl, "getenv", "EXTELLA_API_TOKEN"],',
    '                timeout=20, allow_failure=True) or ""',
    '            secret_present = run([launchctl, "getenv", "EXTELLA_BRIDGE_SECRET"],',
    '                timeout=20, allow_failure=True) or ""',
    '            if len(token_present.strip()) < 8 or len(secret_present.strip()) < 32:',
    '                return result("error", "environment_verification_failed",',
    '                    "Локальные параметры подключения не сохранились.")',
    '        except Exception:',
    '            return result("error", "verification_failed",',
    '                "Не удалось проверить итоговую конфигурацию Codex.")',
    '        return result("success", "ready", "Codex подключён к Extella.",',
    '            plugin_version="0.3.2", restart_required=True)',
    '',
    '    return result("error", "unsupported_step",',
    '        "Установщик получил неизвестный этап.")'
  ].join('\n');

  function metadata() {
    return {
      expertName: EXPERT_NAME,
      expertSha256: EXPERT_SHA256,
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
    return ETB.api.runExpertAsync(
      EXPERT_NAME,
      { step: step },
      {
        target: deviceId,
        timeout: step === 'install' ? 360 : 120,
        maxWait: step === 'install' ? 420000 : 180000,
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
        progress({ stage: 'verify', metadata: metadata() });
        return _runStep(deviceId, 'verify');
      })
      .then(function (result) {
        finalResult = result;
        progress({ stage: 'done', metadata: metadata() });
        return {
          status: 'success',
          code: 'ready',
          pluginVersion: result.plugin_version || PLUGIN_VERSION,
          restartRequired: result.restart_required !== false,
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

  return {
    install: install,
    metadata: metadata,
    expertCode: function () { return EXPERT_CODE; }
  };
})();
