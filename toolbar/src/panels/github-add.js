// ── GITHUB ADD PANEL ──────────────────────────────────────────────────────
// Agent-driven plugin install. The toolbar only collects a GitHub URL, gathers
// a light digest, then hands a standard prompt (see install-prompt.js) to the
// autonomous agent which installs the plugin on the device (CSPL/experts/files/
// local server), validates the render and writes a manifest to the local file
// registry. The toolbar reads that manifest back (registry.syncFromDevice) and
// shows the plugin in Plugins.
//
// Exposes: ETB.githubAdd.open(), ETB.githubAdd.close()

ETB.githubAdd = (function () {

  var GH_API = 'https://api.github.com';

  // ── Styles ─────────────────────────────────────────────────────
  var STYLES = [
    '#_etbv2_gh_ov{',
      'position:fixed;inset:0;z-index:2147483645;',
      'background:rgba(0,0,0,.72);backdrop-filter:blur(6px);',
      'display:flex;align-items:center;justify-content:center;',
      'font-family:-apple-system,system-ui,sans-serif;',
      'animation:_etbv2_gh_fade .16s ease;',
    '}',
    'html[data-etb-light] #_etbv2_gh_ov{background:rgba(0,0,0,.35);}',
    '@keyframes _etbv2_gh_fade{from{opacity:0}to{opacity:1}}',
    '#_etbv2_gh_modal{',
      'background:var(--etb-s1,#fff);border:1px solid var(--etb-bd2,rgba(0,0,0,.14));border-radius:12px;',
      'width:480px;max-width:calc(100vw - 32px);',
      'box-shadow:0 24px 80px rgba(0,0,0,.35);overflow:hidden;',
    '}',
    'html[data-etb-light] #_etbv2_gh_modal{box-shadow:0 16px 48px rgba(0,0,0,.12);}',
    '#_etbv2_gh_hdr{',
      'display:flex;align-items:center;gap:8px;',
      'padding:16px 24px 16px;border-bottom:1px solid var(--etb-bd,rgba(0,0,0,.07));',
    '}',
    '#_etbv2_gh_hdr h3{flex:1;font-size:15px;font-weight:700;color:var(--etb-tx,#111);margin:0;}',
    '#_etbv2_gh_hdr button{',
      'background:none;border:none;color:var(--etb-tx2,#888);cursor:pointer;',
      'font-size:18px;padding:4px 8px;border-radius:8px;',
    '}',
    '#_etbv2_gh_hdr button:hover{background:var(--etb-s3,#f7f7f9);color:var(--etb-tx,#111);}',
    '#_etbv2_gh_body{padding:24px;}',
    '._etbv2_gh_title{font-size:15px;font-weight:700;color:var(--etb-tx,#111);margin-bottom:4px;}',
    '._etbv2_gh_title_lg{font-size:16px;font-weight:700;color:var(--etb-tx,#111);margin-bottom:8px;}',
    '._etbv2_gh_sub{font-size:13px;color:var(--etb-tx2,#6b6b6b);line-height:1.6;}',
    '._etbv2_gh_sub_sm{font-size:11px;color:var(--etb-tx2,#6b6b6b);line-height:1.6;}',
    /* Inputs */
    '._etbv2_gh_field{margin-bottom:16px;}',
    '._etbv2_gh_label{font-size:11px;font-weight:600;color:var(--etb-tx2,#6b6b6b);text-transform:uppercase;',
      'letter-spacing:.06em;margin-bottom:8px;display:block;}',
    '._etbv2_gh_input{',
      'width:100%;background:var(--etb-s2,#fff);border:1px solid var(--etb-bd2,rgba(0,0,0,.14));border-radius:12px;',
      'color:var(--etb-tx,#111);font-size:13px;padding:8px 16px;',
      'box-sizing:border-box;outline:none;transition:border-color .15s;',
      'font-family:-apple-system,system-ui,sans-serif;',
    '}',
    '._etbv2_gh_input:focus{border-color:rgba(198,126,52,.5);}',
    '._etbv2_gh_input::placeholder{color:var(--etb-tx3,#ccc);}',
    /* Preview card */
    '#_etbv2_gh_preview{',
      'background:var(--etb-s3,#f7f7f9);border:1px solid var(--etb-bd,rgba(0,0,0,.07));border-radius:12px;',
      'padding:16px 16px;margin-bottom:16px;display:none;',
    '}',
    '#_etbv2_gh_preview.show{display:block;}',
    '._etbv2_gh_prev_name{font-size:15px;font-weight:700;color:var(--etb-tx,#111);margin-bottom:4px;}',
    '._etbv2_gh_prev_desc{font-size:13px;color:var(--etb-tx2,#6b6b6b);line-height:1.5;margin-bottom:8px;}',
    '._etbv2_gh_prev_meta{display:flex;gap:8px;flex-wrap:wrap;}',
    '._etbv2_gh_pill{',
      'background:rgba(198,126,52,.1);color:var(--etb-a,#C67E34);border:1px solid rgba(198,126,52,.2);',
      'border-radius:8px;font-size:11px;font-weight:600;padding:2px 8px;',
    '}',
    /* Info note */
    '._etbv2_gh_experts{',
      'background:var(--etb-s3,#f7f7f9);border:1px solid var(--etb-bd,rgba(0,0,0,.07));border-radius:12px;',
      'padding:8px 12px;margin-bottom:16px;font-size:11px;color:var(--etb-tx2,#6b6b6b);',
    '}',
    /* Status */
    '#_etbv2_gh_status{',
      'font-size:13px;color:var(--etb-tx2,#6b6b6b);min-height:18px;margin-bottom:12px;',
      'display:flex;align-items:center;gap:8px;',
    '}',
    '._etbv2_gh_spinner{',
      'width:14px;height:14px;border:2px solid var(--etb-bd2,rgba(0,0,0,.14));',
      'border-top-color:var(--etb-a,#C67E34);border-radius:50%;',
      'animation:_etbv2_spin .7s linear infinite;flex-shrink:0;',
    '}',
    '@keyframes _etbv2_spin{to{transform:rotate(360deg)}}',
    /* Buttons */
    '._etbv2_gh_actions{display:flex;gap:8px;justify-content:flex-end;}',
    '._etbv2_gh_btn_cancel{',
      'background:var(--etb-s3,#f7f7f9);border:1px solid var(--etb-bd2,rgba(0,0,0,.14));color:var(--etb-tx2,#6b6b6b);',
      'border-radius:12px;padding:8px 20px;cursor:pointer;font-size:13px;',
    '}',
    '._etbv2_gh_btn_cancel:hover{color:var(--etb-tx,#111);}',
    '._etbv2_gh_btn_primary{',
      'background:var(--etb-a,#C67E34);border:none;color:#000;font-weight:700;',
      'border-radius:12px;padding:8px 20px;cursor:pointer;font-size:13px;',
      'transition:opacity .12s;',
    '}',
    '._etbv2_gh_btn_primary:hover{opacity:.85;}',
    '._etbv2_gh_btn_primary:disabled{opacity:.4;cursor:not-allowed;}',
    /* Install progress */
    '._etbv2_gh_prog{margin:8px 0 16px;}',
    '._etbv2_gh_prog_row{display:flex;align-items:center;gap:8px;margin-bottom:12px;}',
    '._etbv2_gh_prog_phase{flex:1;font-size:13px;font-weight:600;color:var(--etb-tx,#111);}',
    '._etbv2_gh_prog_time{font-size:13px;color:var(--etb-tx2,#6b6b6b);font-variant-numeric:tabular-nums;}',
    '._etbv2_gh_bar{position:relative;height:5px;border-radius:8px;background:var(--etb-bd2,rgba(0,0,0,.1));overflow:hidden;}',
    '._etbv2_gh_bar_fill{position:absolute;top:0;left:0;height:100%;width:38%;border-radius:8px;',
      'background:linear-gradient(90deg,rgba(198,126,52,.25),#C67E34,rgba(198,126,52,.25));',
      'animation:_etbv2_gh_indet 1.25s ease-in-out infinite;}',
    '@keyframes _etbv2_gh_indet{0%{left:-40%}100%{left:100%}}',
    '._etbv2_gh_steps{margin-top:16px;display:flex;flex-direction:column;gap:8px;}',
    '._etbv2_gh_step{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--etb-tx3,#ccc);transition:color .2s;}',
    '._etbv2_gh_step._done{color:var(--etb-tx2,#6b6b6b);}',
    '._etbv2_gh_step._active{color:var(--etb-a,#C67E34);font-weight:600;}',
    '._etbv2_gh_dot{width:6px;height:6px;border-radius:50%;background:var(--etb-bd2,rgba(0,0,0,.2));flex-shrink:0;transition:background .2s;}',
    '._etbv2_gh_step._done ._etbv2_gh_dot{background:var(--etb-tx3,#ccc);}',
    '._etbv2_gh_step._active ._etbv2_gh_dot{background:var(--etb-a,#C67E34);box-shadow:0 0 7px rgba(198,126,52,.5);}',
    '._etbv2_gh_note{font-size:11px;color:var(--etb-tx2,#6b6b6b);line-height:1.5;margin-top:16px;}'
  ].join('');

  // ── State ──────────────────────────────────────────────────────
  var _state = {
    step: 'input', // input | preview | creating | runmode | hf_token_input | installing | device_id_input | analysis_error | error | done
    repoData: null,
    customName: '',
    heavyModel: null,   // { heavy, score, signals, hf } from repoAnalyzer.inferHeavyModel
    deviceCaps: null,   // { can_run_local_heavy, gpu_name, reason } from mkt_device_caps
    runMode: ''         // '' | 'local' | 'remote' — chosen for a heavy model
  };

  // ── Sanitize repo slug for plugin id ───────────────────────────
  function _slug(s) {
    return String(s).toLowerCase()
      .replace(/[^a-z0-9_]/g, '_')
      .replace(/__+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 30);
  }

  function _esc(s) {
    return String(s || '').replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function _tryParseJson(text) {
    var s = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
    try { return JSON.parse(s); } catch (e) {}
    var a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a !== -1 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch (e2) {} }
    return null;
  }

  // ── Install progress (hybrid: live agent text + timer fallback) ──
  // Agent output is shown in real time via onProgress. The time schedule is a
  // fallback only for the first ~15 s before the agent emits its first line.
  var INSTALL_PHASES = [
    'Analyzing the repository',
    'Preparing the install environment',
    'Setting up toolchain & dependencies',
    'Building / generating the interface',
    'Starting the local server',
    'Validating the interface'
  ];
  var INSTALL_SCHEDULE = [0, 8, 22, 45, 85, 125]; // seconds; soft fallback only
  var _installTicker = null;
  var _installCancel = null;  // {cancelled:bool} — токен отмены текущей установки
  var _installLogLines = []; // last 5 lines from agent, shown in Activity block

  // Отмена установки: агент прерван поллингом; best-effort убираем полу-созданную запись реестра.
  function _onInstallCancelled() {
    try {
      var pid = _state && _state.pluginId;
      if (pid && ETB.registry && typeof ETB.registry.remove === 'function') ETB.registry.remove(pid);
    } catch (e) {}
    return { cancelled: true };
  }

  function _fmtTime(secs) {
    var m = Math.floor(secs / 60), s = secs % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function _installPhaseIdx(secs) {
    var idx = 0;
    for (var i = 0; i < INSTALL_SCHEDULE.length; i++) {
      if (secs >= INSTALL_SCHEDULE[i]) idx = i;
    }
    return Math.min(idx, INSTALL_PHASES.length - 1);
  }

  function _installLogHtml() {
    if (!_installLogLines.length) return '';
    return [
      '<div style="margin-top:8px;border:1px solid var(--etb-bd,rgba(0,0,0,.07));border-radius:12px;overflow:hidden;">',
        '<div style="font-size:11px;font-weight:600;color:var(--etb-tx2,#6b6b6b);',
          'text-transform:uppercase;letter-spacing:.05em;padding:4px 8px 4px;',
          'background:var(--etb-s3,#f7f7f9);border-bottom:1px solid var(--etb-bd,rgba(0,0,0,.07));">',
          'Activity',
        '</div>',
        '<div id="_etbv2_gh_log" style="padding:8px 8px;font-size:11px;',
          'font-family:ui-monospace,monospace;line-height:1.6;',
          'color:var(--etb-tx2,#6b6b6b);max-height:72px;overflow:hidden;">',
          _installLogLines.map(function (l) {
            return '<div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + _esc(l) + '</div>';
          }).join(''),
        '</div>',
      '</div>'
    ].join('');
  }

  function _renderInstallProgress() {
    var secs = Math.round((Date.now() - (_state.installStartedAt || Date.now())) / 1000);
    var agentText = _state.installAgentText || '';
    var phaseLabel = agentText || (_installPhaseIdx(secs) === INSTALL_PHASES.length - 1 && secs > INSTALL_SCHEDULE[INSTALL_PHASES.length - 1] + 30
      ? 'Finishing up'
      : INSTALL_PHASES[_installPhaseIdx(secs)]);
    if (_state.installLongMode && !agentText) phaseLabel += ' (large repo — this can take a while)';

    var active = _installPhaseIdx(secs);
    var steps = INSTALL_PHASES.map(function (name, i) {
      var cls = i < active ? ' _done' : (i === active ? ' _active' : '');
      return '<div class="_etbv2_gh_step' + cls + '">' +
        '<span class="_etbv2_gh_dot"></span><span>' + _esc(name) + '</span></div>';
    }).join('');

    return [
      '<div class="_etbv2_gh_prog">',
      '<div class="_etbv2_gh_prog_row">',
      '<div class="_etbv2_gh_prog_phase" id="_etbv2_gh_phase">', _esc(phaseLabel), '…</div>',
      '<div class="_etbv2_gh_prog_time" id="_etbv2_gh_time">', _fmtTime(secs), '</div>',
      '</div>',
      '<div class="_etbv2_gh_bar"><div class="_etbv2_gh_bar_fill"></div></div>',
      '<div class="_etbv2_gh_steps" id="_etbv2_gh_steps">', steps, '</div>',
      _installLogHtml(),
      '<div class="_etbv2_gh_note">',
      'Extella\'s agent is installing this plugin on your device. You can hide this ',
      'window — it keeps running and the plugin appears in Plugins when ready.',
      '</div>',
      '</div>'
    ].join('');
  }

  function _tickInstall() {
    var phaseEl = document.getElementById('_etbv2_gh_phase');
    if (!phaseEl) return;
    var secs = Math.round((Date.now() - (_state.installStartedAt || Date.now())) / 1000);
    var agentText = _state.installAgentText || '';
    var active = _installPhaseIdx(secs);
    var last = INSTALL_PHASES.length - 1;

    // Agent text has priority; fall back to time-schedule only if agent is still silent.
    var phaseLabel = agentText || (active === last && secs > INSTALL_SCHEDULE[last] + 30
      ? 'Finishing up'
      : INSTALL_PHASES[active]);
    if (_state.installLongMode && !agentText) phaseLabel += ' (large repo — this can take a while)';
    phaseEl.textContent = phaseLabel + '…';

    var timeEl = document.getElementById('_etbv2_gh_time');
    if (timeEl) timeEl.textContent = _fmtTime(secs);

    var stepsEl = document.getElementById('_etbv2_gh_steps');
    if (stepsEl) {
      var nodes = stepsEl.children;
      for (var i = 0; i < nodes.length; i++) {
        nodes[i].className = '_etbv2_gh_step' +
          (i < active ? ' _done' : (i === active ? ' _active' : ''));
      }
    }

    // Update activity log in-place (avoids full re-render).
    var logEl = document.getElementById('_etbv2_gh_log');
    if (logEl && _installLogLines.length) {
      logEl.innerHTML = _installLogLines.map(function (l) {
        return '<div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + _esc(l) + '</div>';
      }).join('');
    }
  }

  function _startInstallTicker() {
    _stopInstallTicker();
    _installTicker = setInterval(_tickInstall, 1000);
  }

  function _stopInstallTicker() {
    if (_installTicker) { clearInterval(_installTicker); _installTicker = null; }
  }

  // Shared progress callback factory for install — updates state used by ticker.
  function _makeInstallProgressTracker(phasePrefix) {
    return ETB.api.createAgentProgressTracker({
      setPhase: function (line) {
        _state.installAgentText = phasePrefix ? phasePrefix + line : line;
      },
      addLog: function (line) {
        _installLogLines.push(line);
        if (_installLogLines.length > 5) _installLogLines.shift();
      },
      onSyncFallback: function () { _state.installLongMode = true; }
    });
  }

  // ── Render ─────────────────────────────────────────────────────
  function _render() {
    var ov = document.getElementById('_etbv2_gh_ov');
    if (!ov) return;

    var s = _state;
    var modalHtml;

    if (s.step === 'done') {
      modalHtml = [
        '<div id="_etbv2_gh_body" style="text-align:center;padding:40px 24px;">',
        '<div style="font-size:48px;margin-bottom:16px;">&#10003;</div>',
        '<div class="_etbv2_gh_title_lg">Plugin added!</div>',
        '<div class="_etbv2_gh_sub" style="margin-bottom:16px;">',
        _esc(s.customName || (s.repoData && s.repoData.name) || ''),
        ' is now available in Plugins.</div>',
        (s.doneWarning
          ? '<div style="margin:0 auto 16px;max-width:420px;text-align:left;background:rgba(198,126,52,.1);' +
            'border:1px solid rgba(198,126,52,.4);border-radius:12px;padding:8px 16px;font-size:13px;' +
            'line-height:1.55;color:var(--etb-tx,#f0f0f0);">&#9888; ' + _esc(s.doneWarning) + '</div>'
          : ''),
        '<div class="_etbv2_gh_actions" style="justify-content:center;">',
        '<button class="_etbv2_gh_btn_cancel" id="_etbv2_gh_close_done">Close</button>',
        '<button class="_etbv2_gh_btn_primary" id="_etbv2_gh_open_now">Open Plugin</button>',
        '</div></div>'
      ].join('');
    } else if (s.step === 'analysis_error') {
      modalHtml = _renderAnalysisError();
    } else if (s.step === 'device_id_input') {
      modalHtml = _renderDeviceIdInput();
    } else if (s.step === 'runmode') {
      modalHtml = _renderRunMode();
    } else if (s.step === 'hf_token_input') {
      modalHtml = _renderHfToken();
    } else if (s.step === 'installing') {
      modalHtml = [
        '<div id="_etbv2_gh_body">',
        '<div class="_etbv2_gh_title">Installing ',
        _esc(s.customName || (s.repoData && s.repoData.name) || 'plugin'),
        '</div>',
        _renderInstallProgress(),
        '<div class="_etbv2_gh_actions">',
        '<button class="_etbv2_gh_btn_cancel" id="_etbv2_gh_stopinstall">Отмена</button>',
        '<button class="_etbv2_gh_btn_cancel" id="_etbv2_gh_hide">Свернуть</button>',
        '</div>',
        '</div>'
      ].join('');
    } else if (s.step === 'skill') {
      modalHtml = _renderSkill();
    } else if (s.step === 'notapp') {
      modalHtml = _renderNotApp();
    } else {
      var rd = s.repoData || {};
      var working = s.step === 'creating' || s.step === 'analyzing' || s.step === 'installing';
      var _baseId = rd.full_name ? ('gh_' + _slug(rd.full_name.replace('/', '_'))) : '';
      var already = !!(_baseId && ETB.registry && ETB.registry.isInstalled && ETB.registry.isInstalled(_baseId));

      modalHtml = [
        '<div id="_etbv2_gh_body">',
        /* URL input */
        '<div class="_etbv2_gh_field">',
        '<label class="_etbv2_gh_label">GitHub Repository URL</label>',
        '<input class="_etbv2_gh_input" id="_etbv2_gh_url_inp"',
        ' placeholder="https://github.com/owner/repo"',
        ' value="' + _esc(s.urlValue || '') + '" />',
        '</div>',
        /* Preview section */
        '<div id="_etbv2_gh_preview"' + (rd.name ? ' class="show"' : '') + '>',
        '<div class="_etbv2_gh_field">',
        '<label class="_etbv2_gh_label">Plugin name</label>',
        '<input class="_etbv2_gh_input" id="_etbv2_gh_name_inp"',
        ' placeholder="' + _esc(rd.name || 'My Plugin') + '"',
        ' value="' + _esc(s.customName || rd.name || '') + '" />',
        '</div>',
        '<div class="_etbv2_gh_prev_desc">', _esc(rd.description || ''), '</div>',
        '<div class="_etbv2_gh_prev_meta">',
        rd.language ? '<span class="_etbv2_gh_pill">' + _esc(rd.language) + '</span>' : '',
        rd.stargazers_count != null ? '<span class="_etbv2_gh_pill">&#9733; ' + rd.stargazers_count + '</span>' : '',
        rd.license && rd.license.spdx_id ? '<span class="_etbv2_gh_pill">' + _esc(rd.license.spdx_id) + '</span>' : '',
        '</div>',
        '<div class="_etbv2_gh_experts" style="margin-top:12px;">',
        '<div class="_etbv2_gh_sub_sm">',
        already
          ? '&#10003; Этот плагин уже установлен. Открой его — или переустанови заново.'
          // РИСК НАЗЫВАЕТСЯ ДО УСТАНОВКИ (решение Анвара 30.07). Возможность
          // «вставил ссылку — получил приложение» остаётся, но человек больше не
          // соглашается вслепую: Extella выполнит на его компьютере сборочные команды
          // из ЧУЖОГО репозитория. Мы этот код не проверяли и обещать за него не можем.
          // Умолчание тут было бы тем же немым отказом, только наоборот — немым согласием.
          : 'Extella скачает этот репозиторий на твой компьютер и выполнит из него сборочные команды — как если бы ты собирал проект сам. Код чужой: мы его не проверяли.',
        '</div>',
        (already ? '' :
          '<div class="_etbv2_gh_sub_sm" style="margin-top:8px;color:var(--etb-tx2,#6b6b6b);">' +
          'Всё ляжет в отдельную папку <code>~/extella-plugins/' + _esc(_baseId || 'plugin') + '</code> и удаляется целиком одной кнопкой.' +
          '</div>'),
        '</div>',
        '</div>', // end preview
        /* Вердикт гейта стандартов: человек видит его ДО того, как нажмёт «Установить» */
        (s.step === 'preview' ? _passportVerdictHtml(s) : ''),
        /* Status */
        '<div id="_etbv2_gh_status">',
        working ? '<div class="_etbv2_gh_spinner"></div><span>' + _esc(s.statusMsg || 'Working...') + '</span>' : '',
        s.step === 'error' ? '<span style="color:#e74c3c;">' + _esc(s.errorMsg || 'Error') + '</span>' : '',
        '</div>',
        /* Actions */
        '<div class="_etbv2_gh_actions">',
        '<button class="_etbv2_gh_btn_cancel" id="_etbv2_gh_cancel">Cancel</button>',
        s.step === 'input' || s.step === 'error'
          ? '<button class="_etbv2_gh_btn_primary" id="_etbv2_gh_fetch">Fetch Repo</button>'
          : (rd.name && s.step === 'preview'
            ? (already
              ? '<button class="_etbv2_gh_btn_cancel" id="_etbv2_gh_reinstall">Переустановить</button><button class="_etbv2_gh_btn_primary" id="_etbv2_gh_open_existing">Открыть</button>'
              : (s.passportChecked === false
                ? '<button class="_etbv2_gh_btn_primary" disabled>Проверяю паспорт…</button>'
                : ((Array.isArray(s.passportProblems) && s.passportProblems.length)
                  ? '<button class="_etbv2_gh_btn_primary" disabled title="Паспорт агента не проходит стандарт">Установить нельзя</button>'
                  : '<button class="_etbv2_gh_btn_primary" id="_etbv2_gh_create">Понимаю, установить</button>')))
            : '<button class="_etbv2_gh_btn_primary" disabled>Working...</button>'),
        '</div>',
        '</div>'
      ].join('');
    }

    var modal = ov.querySelector('#_etbv2_gh_modal');
    modal.innerHTML = [
      '<div id="_etbv2_gh_hdr">',
      ETB.brand.icon(18),
      '<h3>Add GitHub Resource</h3>',
      '<button id="_etbv2_gh_x">&#10005;</button>',
      '</div>',
      modalHtml
    ].join('');

    _bindEvents(ov);
  }

  // ── Install failed: real error + retry ─────────────────────────
  // Промпт для чата Extella: НЕ шаблон, а конкретные факты этой установки. Человеку
  // незачем пересказывать модели то, что мы и так знаем — репозиторий, куда ставили,
  // на чём встало. Пересказ по памяти и есть то место, где разбор теряет минуты.

  // ── ГЕЙТ СТАНДАРТОВ НА ВХОДЕ ──────────────────────────────────────────────
  // Паспорт агента (agent_passport.yaml в корне) — условие установки, а не просьба.
  // Без него витрина не знает, что ставит и на какую полку класть, а канон платформы
  // («клиентские агенты только на платформенной Qwen») держится на честном слове.
  //
  // Проверяем ТЕ ЖЕ поля, что и tools/check_agent_repo.py в extella-agent-standards:
  // одна планка для своих и чужих, иначе смысла в стандарте нет.
  //
  // Паспорта нет вовсе — НЕ отказ: по ссылке ставят и обычные программы (excalidraw и
  // подобные). Тогда это просто не агент, и мы говорим это прямо, а не молчим.
  function _readPassport(owner, repo) {
    var branches = ['main', 'master'];
    function tryBranch(i) {
      if (i >= branches.length) return Promise.resolve(null);
      var url = 'https://raw.githubusercontent.com/' + owner + '/' + repo + '/' +
                branches[i] + '/agent_passport.yaml';
      return fetch(url).then(function (r) {
        return r.ok ? r.text() : tryBranch(i + 1);
      }).catch(function () { return tryBranch(i + 1); });
    }
    return tryBranch(0);
  }

  // Плоский разбор: паспорт — простой YAML, полноценный парсер тянуть незачем.
  function _passportField(text, path) {
    var re = new RegExp('^\\s*' + path + '\\s*:\\s*["\']?([^"\'#\\n]*)', 'm');
    var m = text.match(re);
    return m ? m[1].trim() : '';
  }

  function _passportProblems(text) {
    var out = [];
    if (!_passportField(text, 'name')) out.push('не указано имя агента');
    if (!_passportField(text, 'owner')) out.push('не указан владелец — кто отвечает за агента после запуска');
    if (!_passportField(text, 'business_goal')) out.push('не сказано, какую задачу агент закрывает');
    if (!_passportField(text, 'platform_agent_id'))
      out.push('нет platform_agent_id — агент не привязан к платформе (связывать по имени запрещено)');
    var model = _passportField(text, 'model_profile');
    if (model && !/qwen/i.test(model))
      out.push('модель «' + model + '»: клиентские агенты работают только на платформенной Qwen');
    if (!/^\s*capabilities\s*:/m.test(text)) out.push('не объявлено ни одной способности');
    else if (!/^\s*-\s*name\s*:/m.test(text)) out.push('в способностях нет ни одной с именем');
    if (!/^\s+limits\s*:/m.test(text))
      out.push('не сказано, чего агент НЕ делает — хотя бы одна честная строка обязательна');
    return out;
  }


  // Что человек видит на предпросмотре. Отказ обязан НАЗЫВАТЬ, чего не хватает: иначе
  // он пойдёт гадать, а гадать придёт к нам — ровно то, чего гейт и должен избежать.
  function _passportVerdictHtml(s) {
    if (s.passportChecked === false) {
      return '<div style="font-size:12px;color:var(--etb-tx2,#6b6b6b);margin:10px 0;">' +
             'Читаю паспорт агента…</div>';
    }
    if (s.passportProblems === undefined) {
      return '<div style="font-size:12px;line-height:1.5;color:#8a6a1f;' +
             'border-left:2px solid #C57E33;padding-left:10px;margin:10px 0;">' +
             '<b>Паспорт прочитать не удалось: репозиторий приватный.</b> ' +
             'Это не значит, что паспорта нет — GitHub отвечает одинаково и на закрытый ' +
             'репозиторий, и на отсутствующий файл. Добавь ключ доступа GitHub, ' +
             'и проверка пройдёт как обычно.</div>';
    }
    if (s.passportProblems === null) {
      // Паспорта нет — значит это не агент, а программа. Ставим, но говорим прямо.
      return '<div style="font-size:12px;line-height:1.5;color:var(--etb-tx2,#6b6b6b);' +
             'border-left:2px solid var(--etb-bd,#d7e0dc);padding-left:10px;margin:10px 0;">' +
             'Паспорта агента в репозитории нет — поставим как обычную программу. ' +
             'Если это должен быть агент Extella, добавь в корень <b>agent_passport.yaml</b>.' +
             '</div>';
    }
    if (s.passportProblems.length) {
      var items = s.passportProblems.map(function (x) {
        return '<li style="margin:3px 0;">' + _esc(x) + '</li>';
      }).join('');
      return '<div style="font-size:12px;line-height:1.5;color:#b4472e;' +
             'border-left:2px solid #b4472e;padding-left:10px;margin:10px 0;">' +
             '<b>Паспорт агента не проходит стандарт</b>' +
             '<ul style="margin:6px 0 0 14px;padding:0;">' + items + '</ul>' +
             '<div style="margin-top:6px;color:var(--etb-tx2,#6b6b6b);">' +
             'Поправь паспорт в репозитории и нажми «Fetch Repo» ещё раз. ' +
             'Шаблон — extella-agent-standards/templates/agent_passport.yaml.</div></div>';
    }
    return '<div style="font-size:12px;line-height:1.5;color:#2F6B66;' +
           'border-left:2px solid #2F6B66;padding-left:10px;margin:10px 0;">' +
           'Паспорт агента на месте и проходит стандарт.</div>';
  }

  function _chatPrompt() {
    var rd = _state.repoData || {};
    var id = _state.pluginId || '';
    var safe = id.replace(/[^a-z0-9]/gi, '_');
    return [
      'Установка плагина из GitHub не завершилась. Доведи её, пожалуйста, до конца.',
      '',
      'Репозиторий: ' + (rd.html_url || _state.urlValue || ''),
      'Что должно получиться: плагин «' + (_state.customName || rd.name || id) + '»',
      '  папка ~/extella-plugins/' + safe,
      '  манифест ~/extella-plugins/_registry/' + safe + '.json',
      (_state.deviceId ? 'Устройство: ' + _state.deviceId : 'Устройство: то, где открыта Extella'),
      '',
      'Где остановилось: ' + (_state.errorMsg || 'без внятной ошибки'),
      '',
      'Разберись в репозитории, доустанови недостающее, подними интерфейс и запиши манифест.',
      'Если это не приложение (библиотека, набор навыков, CLI) — скажи прямо и не собирай',
      'плагин вокруг пустой папки: пустая карточка хуже честного отказа.'
    ].join('\n');
  }

  function _renderAnalysisError() {
    return [
      '<div id="_etbv2_gh_body">',
      '<div class="_etbv2_gh_title" style="margin-bottom:8px;">Установка не завершилась</div>',
      '<div style="font-size:13px;color:#e74c3c;line-height:1.6;margin-bottom:16px;">',
      _esc(_state.errorMsg || 'Причина не названа'),
      '</div>',
      '<div class="_etbv2_gh_sub_sm" style="margin-bottom:16px;">',
      'Можно повторить — большие репозитории (сборка и инструментарий) занимают минуты. ',
      'Если повтор не помогает, доведи установку в чате Extella: там ты можешь спросить, ',
      'уточнить и поправить на ходу — окно установки этого не умеет.',
      '</div>',
      '<div style="background:var(--etb-s3,#f7f7f9);border:1px solid var(--etb-bd,rgba(0,0,0,.07));',
        'border-radius:12px;padding:8px 12px;margin-bottom:16px;">',
        '<div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;',
          'color:var(--etb-tx2,#6b6b6b);margin-bottom:8px;">Готовое сообщение для чата</div>',
        '<pre id="_etbv2_gh_prompt" style="margin:0;white-space:pre-wrap;word-break:break-word;',
          'font:11px/1.5 ui-monospace,monospace;color:var(--etb-tx2,#6b6b6b);max-height:132px;',
          'overflow:auto;">', _esc(_chatPrompt()), '</pre>',
      '</div>',
      '<div id="_etbv2_gh_status"></div>',
      '<div class="_etbv2_gh_actions">',
      '<button class="_etbv2_gh_btn_cancel" id="_etbv2_gh_cancel">Закрыть</button>',
      '<button class="_etbv2_gh_btn_cancel" id="_etbv2_gh_tochat">Скопировать и открыть чат</button>',
      '<button class="_etbv2_gh_btn_primary" id="_etbv2_gh_retry">Повторить</button>',
      '</div>',
      '</div>'
    ].join('');
  }

  // ── Device ID prompt: required so the agent installs locally ────
  function _renderDeviceIdInput() {
    return [
      '<div id="_etbv2_gh_body">',
      '<div class="_etbv2_gh_title" style="margin-bottom:8px;">Device ID required</div>',
      '<div class="_etbv2_gh_sub" style="margin-bottom:16px;">',
      'The plugin is installed on your machine, so Extella needs your device ID.<br>',
      'Find it in <b style="color:var(--etb-tx,#111);">Extella Desktop logs</b> — look for ',
      '<code style="color:var(--etb-a,#C67E34);font-size:11px;">Device ID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx</code>',
      '</div>',
      '<div class="_etbv2_gh_field">',
      '<label class="_etbv2_gh_label">Device ID</label>',
      '<input class="_etbv2_gh_input" id="_etbv2_gh_did_inp"',
      ' placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" autocomplete="off" />',
      '</div>',
      '<div id="_etbv2_gh_status"></div>',
      '<div class="_etbv2_gh_actions">',
      '<button class="_etbv2_gh_btn_cancel" id="_etbv2_gh_cancel">Cancel</button>',
      '<button class="_etbv2_gh_btn_primary" id="_etbv2_gh_did_submit">Continue</button>',
      '</div>',
      '</div>'
    ].join('');
  }

  // ── Run-mode picker for heavy AI models: local (NVIDIA) vs hosted (HF) ──
  function _renderRunMode() {
    var caps = _state.deviceCaps;
    var canLocal = !!(caps && caps.can_run_local_heavy);
    var localNote = !caps ? 'Проверяем ваше устройство…'
      : (canLocal ? ('Видеокарта: ' + _esc(caps.gpu_name || 'NVIDIA')) : _esc(caps.reason || 'Нужна видеокарта NVIDIA.'));
    var rm = _state.runMode;
    function card(mode, icon, title, desc, disabled) {
      var sel = rm === mode;
      return '<div class="_etbv2_gh_mode" data-mode="' + mode + '" style="' +
        'flex:1;min-width:0;border:1.5px solid ' + (sel ? '#C67E34' : 'var(--etb-bd2,rgba(0,0,0,.14))') + ';' +
        'border-radius:12px;padding:16px;cursor:' + (disabled ? 'not-allowed' : 'pointer') + ';' +
        'background:' + (sel ? 'rgba(198,126,52,.08)' : 'transparent') + ';opacity:' + (disabled ? '.5' : '1') + ';">' +
        '<div style="font-size:22px;margin-bottom:8px;">' + icon + '</div>' +
        '<div style="font-weight:700;font-size:15px;margin-bottom:3px;color:var(--etb-tx,#111);">' + title + '</div>' +
        '<div style="font-size:11px;color:var(--etb-tx2,#6b6b6b);line-height:1.4;">' + desc + '</div>' +
      '</div>';
    }
    return [
      '<div id="_etbv2_gh_body">',
      '<div class="_etbv2_gh_title">Как запустить эту модель?</div>',
      '<div class="_etbv2_gh_sub" style="margin-bottom:16px;">Это тяжёлая ИИ-модель. Запустите её локально (нужна видеокарта NVIDIA) или через HuggingFace — на любом компьютере.</div>',
      '<div style="display:flex;gap:8px;">',
      card('local', '&#128187;', 'Локально', localNote, !canLocal),
      card('remote', '&#9729;', 'Через HuggingFace', 'Работает везде. Понадобится ваш ключ HuggingFace (своя квота).', false),
      '</div>',
      '<div class="_etbv2_gh_actions" style="margin-top:16px;">',
      '<button class="_etbv2_gh_btn_cancel" id="_etbv2_gh_rm_back">&#8592; Назад</button>',
      '<button class="_etbv2_gh_btn_primary" id="_etbv2_gh_rm_next"' + (rm ? '' : ' disabled') + '>Установить &#8594;</button>',
      '</div></div>'
    ].join('');
  }

  function _renderHfToken() {
    return [
      '<div id="_etbv2_gh_body">',
      '<div class="_etbv2_gh_title">Ваш ключ HuggingFace</div>',
      '<div class="_etbv2_gh_sub" style="margin-bottom:12px;">Нужен, чтобы у вас была своя квота GPU. Ключ бесплатный — создайте и вставьте сюда. Он сохранится для будущих установок.</div>',
      '<div class="_etbv2_gh_field">',
      '<input class="_etbv2_gh_input" id="_etbv2_gh_hf_inp" type="password" placeholder="hf_..." autocomplete="off" spellcheck="false" />',
      '</div>',
      '<a href="https://huggingface.co/settings/tokens" target="_blank" style="font-size:11px;color:#C67E34;text-decoration:none;display:inline-block;margin-top:8px;">Открыть страницу токенов HuggingFace &#8594;</a>',
      '<div class="_etbv2_gh_actions" style="margin-top:16px;">',
      '<button class="_etbv2_gh_btn_cancel" id="_etbv2_gh_hf_back">&#8592; Назад</button>',
      '<button class="_etbv2_gh_btn_primary" id="_etbv2_gh_hf_save">Сохранить и установить &#8594;</button>',
      '</div></div>'
    ].join('');
  }

  function _bindEvents(ov) {
    var closeBtn = ov.querySelector('#_etbv2_gh_x');
    var cancelBtn = ov.querySelector('#_etbv2_gh_cancel');
    var fetchBtn = ov.querySelector('#_etbv2_gh_fetch');
    var createBtn = ov.querySelector('#_etbv2_gh_create');
    var closeDoneBtn = ov.querySelector('#_etbv2_gh_close_done');
    var openNowBtn = ov.querySelector('#_etbv2_gh_open_now');
    var urlInp = ov.querySelector('#_etbv2_gh_url_inp');
    var nameInp = ov.querySelector('#_etbv2_gh_name_inp');

    if (closeBtn) closeBtn.onclick = function () { ETB.githubAdd.close(); };
    if (cancelBtn) cancelBtn.onclick = function () { ETB.githubAdd.close(); };
    if (closeDoneBtn) closeDoneBtn.onclick = function () { ETB.githubAdd.close(); };

    if (urlInp) {
      urlInp.focus();
      urlInp.oninput = function () { _state.urlValue = urlInp.value; };
    }
    if (nameInp) {
      nameInp.oninput = function () { _state.customName = nameInp.value; };
    }

    if (fetchBtn) {
      fetchBtn.onclick = function () {
        var url = urlInp ? urlInp.value.trim() : _state.urlValue;
        _fetchRepo(url);
      };
    }

    if (createBtn) {
      createBtn.onclick = function () {
        // If the URL was edited after the last fetch, the preview is stale —
        // fetch the new URL first instead of silently installing the old repo.
        var cur = (urlInp ? urlInp.value : _state.urlValue || '').trim();
        if (cur && _state.fetchedUrl && cur !== _state.fetchedUrl) {
          _fetchRepo(cur);
          return;
        }
        var name = nameInp ? nameInp.value.trim() : '';
        _state.customName = name || (_state.repoData && _state.repoData.name) || '';
        _startAnalysis();
      };
    }

    var retryBtn = ov.querySelector('#_etbv2_gh_retry');
    if (retryBtn) retryBtn.onclick = function () { _startAnalysis(); };

    // «Открыть чат» = закрыть витрину: чат Extella и есть окно, поверх которого мы
    // лежим. Никаких адресов не угадываем — человек оказывается ровно там, где нужно,
    // с уже скопированным сообщением.
    var toChat = ov.querySelector('#_etbv2_gh_tochat');
    if (toChat) toChat.onclick = function () {
      var text = _chatPrompt();
      function done() {
        ETB.githubAdd.close();
        try { ETB.marketplace.close(); } catch (_) {}
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, done);
      } else {
        // Буфер недоступен (нет разрешения) — не молчим: оставляем текст выделенным,
        // человек скопирует руками. Молча закрыть окно значило бы потерять сообщение.
        try {
          var pre = ov.querySelector('#_etbv2_gh_prompt');
          var r = document.createRange(); r.selectNodeContents(pre);
          var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
        } catch (_) {}
        var st = ov.querySelector('#_etbv2_gh_status');
        if (st) st.innerHTML = '<span>Скопируй выделенное сообщение и открой чат Extella.</span>';
      }
    };

    var didSubmitBtn = ov.querySelector('#_etbv2_gh_did_submit');
    if (didSubmitBtn) didSubmitBtn.onclick = _onDeviceIdSubmit;

    // Already-installed repo: open it instead of silently re-installing.
    var openExisting = ov.querySelector('#_etbv2_gh_open_existing');
    if (openExisting) openExisting.onclick = function () {
      var rd = _state.repoData || {};
      var id = rd.full_name ? ('gh_' + _slug(rd.full_name.replace('/', '_'))) : '';
      ETB.githubAdd.close();
      if (id && ETB.router && ETB.router.openById) ETB.router.openById(id);
    };
    var reinstallBtn = ov.querySelector('#_etbv2_gh_reinstall');
    if (reinstallBtn) reinstallBtn.onclick = function () {
      var nm = ov.querySelector('#_etbv2_gh_name_inp');
      _state.customName = (nm && nm.value ? nm.value.trim() : '') || (_state.repoData && _state.repoData.name) || '';
      _startAnalysis();
    };

    // Run-mode picker (heavy models): mode cards + navigation.
    var modeCards = ov.querySelectorAll('._etbv2_gh_mode');
    for (var mi = 0; mi < modeCards.length; mi++) {
      (function (el) {
        el.onclick = function () {
          var m = el.getAttribute('data-mode');
          if (m === 'local' && !(_state.deviceCaps && _state.deviceCaps.can_run_local_heavy)) return;
          _state.runMode = m;
          _render();
        };
      })(modeCards[mi]);
    }
    var rmNext = ov.querySelector('#_etbv2_gh_rm_next');
    if (rmNext) rmNext.onclick = function () { if (_state.runMode) _onRunModeNext(); };
    var rmBack = ov.querySelector('#_etbv2_gh_rm_back');
    if (rmBack) rmBack.onclick = function () { _state.step = 'preview'; _render(); };
    var hfSave = ov.querySelector('#_etbv2_gh_hf_save');
    if (hfSave) hfSave.onclick = _onHfTokenSave;
    var hfBack = ov.querySelector('#_etbv2_gh_hf_back');
    if (hfBack) hfBack.onclick = function () { _state.step = 'runmode'; _render(); };

    var hideBtn = ov.querySelector('#_etbv2_gh_hide');
    if (hideBtn) hideBtn.onclick = function () { ETB.githubAdd.close(); };

    // Отмена установки: прерываем поллинг агента, закрываем окно (чистка — в _onInstallCancelled).
    var stopBtn = ov.querySelector('#_etbv2_gh_stopinstall');
    if (stopBtn) stopBtn.onclick = function () {
      if (_installCancel) _installCancel.cancelled = true;
      ETB.githubAdd.close();
    };

    // Honest-routing screens (skill / not-an-app).
    var skillClose = ov.querySelector('#_etbv2_gh_skill_close');
    if (skillClose) skillClose.onclick = function () { ETB.githubAdd.close(); };
    var skillOpen = ov.querySelector('#_etbv2_gh_skill_open');
    if (skillOpen) skillOpen.onclick = function () {
      ETB.githubAdd.close();
      if (ETB.router && ETB.router.openById) ETB.router.openById('mkt_skills');
    };
    var notappCancel = ov.querySelector('#_etbv2_gh_notapp_cancel');
    if (notappCancel) notappCancel.onclick = function () { ETB.githubAdd.close(); };
    var notappForce = ov.querySelector('#_etbv2_gh_notapp_force');
    if (notappForce) notappForce.onclick = function () { _state.forceInstall = true; _proceedInstall(); };

    if (openNowBtn && _state.lastPluginId) {
      openNowBtn.onclick = function () {
        ETB.githubAdd.close();
        ETB.router.openById(_state.lastPluginId);
      };
    }
  }

  function _parseGhUrl(url) {
    var m = url.match(/github\.com\/([^/]+)\/([^/?#]+)/);
    if (!m) return null;
    return { owner: m[1], repo: m[2].replace(/\.git$/, '') };
  }

  function _setStatus(msg) {
    _state.statusMsg = msg;
    var el = document.getElementById('_etbv2_gh_status');
    if (el) el.innerHTML = '<div class="_etbv2_gh_spinner"></div><span>' + _esc(msg) + '</span>';
  }

  // Resolve a promise to its value, or to undefined after `ms` — never rejects,
  // never hangs. Used to keep optional calls (the GitHub token) from blocking.
  function _withTimeout(promise, ms) {
    return new Promise(function (resolve) {
      var settled = false;
      var t = setTimeout(function () {
        if (!settled) { settled = true; resolve(undefined); }
      }, ms);
      Promise.resolve(promise).then(function (v) {
        if (!settled) { settled = true; clearTimeout(t); resolve(v); }
      }, function () {
        if (!settled) { settled = true; clearTimeout(t); resolve(undefined); }
      });
    });
  }

  // The GitHub token is OPTIONAL — it only raises rate limits and unlocks
  // private repos. A slow/unreachable api.extella.ai must never gate the
  // public GitHub request, so we read it with a short bound and move on.
  function _getGithubToken() {
    return _withTimeout(
      ETB.api.kvGet('github_token').then(function (res) {
        return (res && res.value) ? res.value : '';
      }).catch(function () { return ''; }),
      4000
    ).then(function (v) { return v || ''; });
  }

  // fetch() with a hard timeout so a blocked/slow host surfaces an error
  // instead of hanging forever (GitHub may be firewalled on some networks).
  function _fetchWithTimeout(url, options, ms) {
    options = options || {};
    if (typeof AbortController !== 'undefined') {
      var ctrl = new AbortController();
      options.signal = ctrl.signal;
      var t = setTimeout(function () { ctrl.abort(); }, ms);
      return fetch(url, options).then(
        function (r) { clearTimeout(t); return r; },
        function (e) { clearTimeout(t); throw e; }
      );
    }
    return Promise.race([
      fetch(url, options),
      new Promise(function (_, reject) {
        setTimeout(function () { reject(new Error('timeout')); }, ms);
      })
    ]);
  }

  // One GitHub repo request. Resolves { status, ok, data } (data may be null).
  function _ghRepoFetch(ghUrl, token) {
    var headers = { 'Accept': 'application/vnd.github.v3+json' };
    if (token) headers['Authorization'] = 'token ' + token;
    return _fetchWithTimeout(ghUrl, { headers: headers }, 15000).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (data) {
        return { status: r.status, ok: r.ok, data: data };
      });
    });
  }

  function _fetchRepo(url) {
    var parsed = _parseGhUrl(url || '');
    if (!parsed) {
      _state.step = 'error';
      _state.errorMsg = 'Invalid GitHub URL. Example: https://github.com/owner/repo';
      _render();
      return;
    }
    _state.step = 'creating';
    _state.statusMsg = 'Fetching repository info...';
    _state.urlValue = url;
    _render();

    var ghUrl = GH_API + '/repos/' + parsed.owner + '/' + parsed.repo;

    // Fire the GitHub request independently of the optional token lookup.
    _getGithubToken().then(function (token) {
      return _ghRepoFetch(ghUrl, token).then(function (resp) {
        // A stored-but-invalid token returns 401. The token is optional for
        // public repos, so drop the bad key and retry once unauthenticated.
        if (resp.status === 401 && token) {
          ETB.api.kvSet('github_token', '').catch(function () {});
          return _ghRepoFetch(ghUrl, '');
        }
        return resp;
      });
    }).then(function (resp) {
      var data = resp.data;
      if (resp.status === 404 || (data && data.message === 'Not Found')) {
        throw new Error('Repository not found. Check the URL or make it public.');
      }
      if (resp.status === 401) {
        throw new Error('GitHub authorization failed (401). This repo may be private — add a valid GitHub token.');
      }
      if (resp.status === 403) {
        var msg403 = (data && data.message) || '';
        throw new Error(/rate limit/i.test(msg403)
          ? 'GitHub API rate limit reached. Add a GitHub token or try again later.'
          : 'GitHub denied the request (403). ' + (msg403 || 'Try again later.'));
      }
      if (!resp.ok || !data || !data.name) {
        throw new Error('GitHub returned an unexpected response' +
          (resp.status ? ' (HTTP ' + resp.status + ')' : '') +
          '. Check your network and try again.');
      }
      _state.repoData = data;
      _state.customName = data.name || '';
      // Читаем паспорт до показа предпросмотра: человек должен увидеть вердикт ДО
      // того, как нажмёт «Установить», а не после десяти минут установки.
      _state.passportChecked = false;
      _state.repoPrivate = Boolean(data.private);
      _readPassport(data.owner && data.owner.login, data.name).then(function (txt) {
        _state.passportChecked = true;
        _state.passportText = txt || '';
        if (txt) {
          _state.passportProblems = _passportProblems(txt);
        } else if (_state.repoPrivate) {
          // ЛОВУШКА, НА КОТОРОЙ Я САМ СПОТКНУЛСЯ: raw.githubusercontent отдаёт 404 и на
          // приватный репозиторий, и на отсутствующий файл. Без этой ветки агент со
          // стандартом, лежащий в приватном репозитории, был бы принят за «программу»
          // и поставлен вообще без проверки — то есть гейт молча пропускал бы именно то,
          // ради чего его делали.
          _state.passportProblems = undefined;   // не знаем: прочитать не смогли
        } else {
          _state.passportProblems = null;        // публичный и файла нет → это не агент
        }
        _render();
      });
      // Remember which URL this preview belongs to — Install must never run
      // against a stale repo after the user edits the URL field.
      _state.fetchedUrl = url;
      _state.step = 'preview';
      _render();
    }).catch(function (e) {
      _state.step = 'error';
      var m = (e && e.message) || 'Network error';
      if (e && (e.name === 'AbortError' || /timeout/i.test(m))) {
        m = 'GitHub request timed out. Check your network/VPN and try again.';
      }
      _state.errorMsg = m;
      _render();
    });
  }

  // ── Device ID helpers ─────────────────────────────────────────
  // target ЭТОГО устройства — от моста Конструктора (/x/health отдаёт его с 5.32,
  // источник — текущая регистрация листенера в ~/.extella/device.txt).
  // Зачем: /api/expert/run без поля targets исполняется в песочнице платформы.
  // Для mkt_hf_install это значило: манифест и файлы плагина ложились в песочницу,
  // а витрина получала честный success — с чужой машины (корень HF-инцидента 30.07).
  // Поле называется targets и это МАССИВ — по документации платформы (api.html);
  // исполняется первый доступный из списка.
  function _selfTarget() {
    return new Promise(function (resolve) {
      var done = false;
      var t = setTimeout(function () { if (!done) { done = true; resolve(''); } }, 3000);
      fetch('http://127.0.0.1:8765/x/health')
        .then(function (r) { return r.json(); })
        .then(function (j) { if (!done) { done = true; clearTimeout(t); resolve((j && j.target) || ''); } })
        .catch(function () { if (!done) { done = true; clearTimeout(t); resolve(''); } });
    });
  }

  function _getDeviceId() {
    return ETB.api.kvGet('_device_id')
      .then(function (res) { return (res && res.value) || null; })
      .catch(function () { return null; })
      .then(function (id) {
        if (id) return id;
        try {
          return (window.extellaDesktop && typeof window.extellaDesktop.getDeviceID === 'function')
            ? (window.extellaDesktop.getDeviceID() || null) : null;
        } catch (_) { return null; }
      })
      .catch(function () { return null; });
  }

  function _onDeviceIdSubmit() {
    var inp = document.getElementById('_etbv2_gh_did_inp');
    var did = inp ? inp.value.trim() : '';
    if (!did) return;
    ETB.api.kvSet('_device_id', did, 'Extella device ID').catch(function () {});
    _runAgentInstall(_state.repoData, _state.digest, did);
  }

  // ── Analysis pipeline: harvest → device → agent install ────────
  // Honest screen for a Skill pack — abilities for the agent, not an app.
  function _renderSkill() {
    var rd = _state.repoData || {};
    var nm = _esc(_state.customName || rd.name || 'Этот репозиторий');
    return [
      '<div id="_etbv2_gh_body" style="padding:8px 4px;">',
      '<div class="_etbv2_gh_title">&#129504; Это Навык, а не приложение</div>',
      '<div class="_etbv2_gh_sub" style="margin-bottom:16px;">',
      '<b>' + nm + '</b> — это набор навыков (Skill) для ИИ-агента, а не программа с окном. ',
      'Такое не открывают — оно <b>учит ассистента</b> новому умению.</div>',
      '<div style="background:rgba(198,126,52,.09);border:1px solid rgba(198,126,52,.28);',
      'border-radius:12px;padding:12px 16px;font-size:13px;line-height:1.5;margin-bottom:16px;">',
      'Навыки ставятся прямо на твоего агента: пишешь ему по-человечески — а он уже умеет то, ',
      'чему научил навык. Открой полку «Навыки» — там готовые навыки можно установить, посмотреть, ',
      'как их запускать, и удалить. (Импорт навыков прямо с GitHub — на подходе.)',
      '</div>',
      '<div class="_etbv2_gh_actions" style="justify-content:flex-end;">',
      '<button class="_etbv2_gh_btn_cancel" id="_etbv2_gh_skill_close">Понятно</button>',
      '<button class="_etbv2_gh_btn_primary" id="_etbv2_gh_skill_open">Открыть Навыки</button>',
      '</div></div>'
    ].join('');
  }

  // Honest warning for a library / CLI — likely no runnable UI. User may force it.
  function _renderNotApp() {
    var rd = _state.repoData || {};
    var nm = _esc(_state.customName || rd.name || 'Этот репозиторий');
    var kind = (_state.classify && _state.classify.kind) === 'cli' ? 'инструмент командной строки (CLI)' : 'библиотека / фреймворк';
    return [
      '<div id="_etbv2_gh_body" style="padding:8px 4px;">',
      '<div class="_etbv2_gh_title">&#9888;&#65039; Похоже, это не приложение</div>',
      '<div class="_etbv2_gh_sub" style="margin-bottom:16px;">',
      '<b>' + nm + '</b> выглядит как <b>' + kind + '</b> — собственного окна у неё нет, ',
      'и как плагин магазина она, скорее всего, не запустится (пустой экран или ошибки). ',
      'Можно попробовать всё равно — но, вероятно, толку не будет.</div>',
      '<div class="_etbv2_gh_actions">',
      '<button class="_etbv2_gh_btn_cancel" id="_etbv2_gh_notapp_cancel">Отмена</button>',
      '<button class="_etbv2_gh_btn_primary" id="_etbv2_gh_notapp_force">Всё равно установить</button>',
      '</div></div>'
    ].join('');
  }

  function _startAnalysis() {
    var rd = _state.repoData;
    if (!rd) return;

    var pluginId = 'gh_' + _slug(rd.full_name.replace('/', '_'));
    _state.pluginId = pluginId;
    _state.step = 'analyzing';
    _state.statusMsg = 'Gathering context...';
    _state.errorMsg = '';
    _render();

    _getGithubToken()
      .then(function (token) {
        _state.ghToken = token;
        _setStatus('Gathering context...');
        return ETB.repoAnalyzer.harvest(rd, token);
      })
      .then(function (digest) {
        _state.digest = digest;
        // Heavy AI model (needs a GPU)? Offer local (NVIDIA) vs hosted (HF) first.
        var heavy = ETB.repoAnalyzer.inferHeavyModel && ETB.repoAnalyzer.inferHeavyModel(digest);
        _state.heavyModel = heavy || null;
        if (heavy && heavy.heavy && !_state.runMode) {
          _state.step = 'runmode';
          _fetchDeviceCaps();
          _render();
          return;
        }
        // Honest routing (the gstack lesson): don't fabricate a plugin around a
        // skill pack, library or CLI. Skills get their own screen; libraries/
        // CLIs warn before the user can force it through.
        var cls = (ETB.repoAnalyzer.classifyRepo && ETB.repoAnalyzer.classifyRepo(digest, rd)) || { kind: 'unknown' };
        _state.classify = cls;
        // Only the high-precision 'skill' signal diverts today (SKILL.md/.claude).
        // library/cli detection is too broad to hard-gate — left for a later,
        // signal-tightened pass so we never block a real app.
        if (cls.kind === 'skill') { _state.step = 'skill'; _render(); return; }
        return _proceedInstall();
      })
      .catch(function (e) {
        _state.step = 'analysis_error';
        _state.errorMsg = (e && e.message) || 'Analysis failed';
        _render();
      });
  }

  // Device resolution → install. Local/normal → agent; hosted → deterministic.
  function _proceedInstall() {
    if (_state.runMode === 'remote') return _hostedInstall();
    return _getDeviceId().then(function (deviceId) {
      if (!deviceId) {
        _state.step = 'device_id_input';
        _render();
        return;
      }
      return _runAgentInstall(_state.repoData, _state.digest, deviceId);
    });
  }

  // Deterministic hosted install (no LLM): resolve the model's HuggingFace
  // Space, then mkt_hf_install introspects its API and builds an adaptive
  // plugin that calls the shared mkt_hf_call proxy. Reliable for any Space.
  function _resolveHostedSpace(rd) {
    var hf = _state.heavyModel && _state.heavyModel.hf;
    if (hf && hf.kind === 'space' && hf.id) return Promise.resolve(hf.id);
    var q = (rd && (rd.name || rd.full_name)) || '';
    return fetch('https://huggingface.co/api/spaces?search=' + encodeURIComponent(q) + '&sort=likes&direction=-1&limit=5')
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (list) {
        if (Array.isArray(list) && list.length) return list[0].id;
        return (hf && hf.id) ? hf.id : null;
      })
      .catch(function () { return (hf && hf.id) ? hf.id : null; });
  }

  function _hostedInstall() {
    var rd = _state.repoData || {};
    var pluginId = 'gh_' + _slug(rd.full_name.replace('/', '_')) + '_hf';
    _state.pluginId = pluginId;
    if (ETB.registry.clearDeviceTombstone) ETB.registry.clearDeviceTombstone(null, pluginId);
    _state.step = 'installing';
    _state.installStartedAt = Date.now();
    _state.statusMsg = 'Подключаем модель через HuggingFace…';
    _state.installAgentText = 'Подключаем модель через HuggingFace…';
    _render();
    return Promise.all([_resolveHostedSpace(rd), _selfTarget()]).then(function (pair) {
      var space = pair[0], selfTgt = pair[1];
      if (!space) {
        _state.step = 'analysis_error';
        _state.errorMsg = 'Не нашли готовый HuggingFace-Space для этой модели. Попробуйте локальную установку (нужна видеокарта NVIDIA) или другую модель.';
        _render();
        return;
      }
      // Без target установка исполнится в облачной песочнице и притворится успешной —
      // честный отказ вместо ложного «Готово».
      if (!selfTgt) {
        _state.step = 'analysis_error';
        _state.errorMsg = 'Не удалось определить это устройство на платформе — плагин установился бы не на ваш компьютер. Перезапустите Extella (служба Конструктора и листенер поднимаются вместе с приложением) и попробуйте снова.';
        _render();
        return;
      }
      _state.statusMsg = 'Собираем плагин из ' + space + '…';
      _render();
      // hf_space_install — согласованный детерминированный установщик (30.07):
      // сам проверяет, что манифест лёг на устройство (_verify_on_device), и
      // отвечает not_on_device вместо ложного успеха. mkt_hf_install оставлен
      // старым плагинам ради их рантайма (mkt_hf_call).
      return ETB.api.runExpert('hf_space_install', { space: space, display_name: _state.customName || rd.name || space, plugin_id: pluginId }, { timeout: 150, targets: [selfTgt] })
        .then(function (res) {
          var out = (res && res.result !== undefined) ? res.result : res;
          if (typeof out === 'string') { try { out = JSON.parse(out); } catch (e) {} }
          if (out && out.status === 'success') {
            _state.lastPluginId = out.plugin_id || pluginId;
            return ETB.registry.syncFromDevice(null, out.plugin_id || pluginId).then(function () {
              _state.step = 'done';
              if (ETB.tabs && ETB.tabs.refresh) ETB.tabs.refresh();
              _render();
            });
          }
          _state.step = 'analysis_error';
          _state.errorMsg = (out && out.message) || 'Не удалось подключить модель через HuggingFace.';
          _render();
        });
    }).catch(function (e) {
      _state.step = 'analysis_error';
      _state.errorMsg = (e && e.message) || 'Ошибка установки.';
      _render();
    });
  }

  // Load device compute capability (cached in KV) to gate the "Local" option.
  // Замер обязан исполняться НА ЭТОМ устройстве (targets), иначе mkt_device_caps
  // меряет GPU песочницы платформы. Кэшу верим только если он снят с того же
  // target — старые записи без метки могли приехать из песочницы.
  function _fetchDeviceCaps() {
    if (_state.deviceCaps) return;
    _selfTarget().then(function (selfTgt) {
      if (!selfTgt) {
        return { can_run_local_heavy: false, reason: 'Не удалось определить это устройство — доступен только HuggingFace.' };
      }
      return ETB.api.kvGet('mkt_device_caps')
        .then(function (r) { if (r && r.value) { try { return JSON.parse(r.value); } catch (e) {} } return null; })
        .catch(function () { return null; })
        .then(function (cached) {
          if (cached && cached._target === selfTgt) return cached;
          return ETB.api.runExpert('mkt_device_caps', {}, { targets: [selfTgt] }).then(function (res) {
            var out = (res && res.result !== undefined) ? res.result : res;
            if (typeof out === 'string') { try { out = JSON.parse(out); } catch (e) { out = null; } }
            if (out) {
              out._target = selfTgt;
              try { ETB.api.kvSet('mkt_device_caps', JSON.stringify(out), 'device compute caps'); } catch (e) {}
            }
            return out;
          }).catch(function () { return null; });
        });
    })
      .then(function (caps) {
        _state.deviceCaps = caps || { can_run_local_heavy: false, reason: 'Не удалось проверить устройство — доступен только HuggingFace.' };
        if (!_state.runMode && !_state.deviceCaps.can_run_local_heavy) _state.runMode = 'remote';
        if (_state.step === 'runmode') _render();
      });
  }

  function _onRunModeNext() {
    if (_state.runMode === 'local') { _proceedInstall(); return; }
    ETB.api.kvGet('huggingface_token').then(function (r) {
      if (r && r.value) { _proceedInstall(); }
      else { _state.step = 'hf_token_input'; _render(); }
    }).catch(function () { _state.step = 'hf_token_input'; _render(); });
  }

  function _onHfTokenSave() {
    var inp = document.getElementById('_etbv2_gh_hf_inp');
    var tok = inp ? inp.value.trim() : '';
    if (!tok) return;
    ETB.api.kvSet('huggingface_token', tok, 'HuggingFace access token').catch(function () {});
    _proceedInstall();
  }

  // ── Agent install: smart orchestration.
  //    For simple repos (library/static/cli): heuristic analysis skips LLM Phase 1 entirely.
  //    For complex/ambiguous repos: LLM SubAgent-A runs first, then the main agent.
  //    This restores Toolbar-1.2.5 speed for simple plugins while keeping the two-phase
  //    flow only where it genuinely helps (monorepos, docker, apps with start scripts).
  // Deterministic fast-path classifier (no LLM). Returns a category hint only
  // when repoAnalyzer is confident the repo is simple; otherwise '' so the
  // normal LLM Phase-1 analysis runs. Kept conservative on purpose — web apps,
  // monorepos and services are ambiguous (static vs needs-build) and stay on
  // the full flow.
  function _fastInstallCategory(digest) {
    var cls = digest && digest.repo_class;
    if (cls === 'library') return '2';   // wrap the library in a generated UI
    if (cls === 'cli') return '1b';      // runnable CLI tool
    return '';
  }

  function _runAgentInstall(rd, digest, deviceId) {
    var ctx = ETB.installPrompt.context(rd, digest, {
      runMode: _state.runMode || 'local',
      hf: _state.heavyModel && _state.heavyModel.hf
    });
    if (_state.customName) ctx.displayName = _state.customName;
    _state.pluginId = ctx.pluginId;
    _state.deviceId = deviceId;
    // Переустановка после удаления: снять девайсный тумбстоун, иначе джанитор
    // синка удалит свежий манифест как позднюю запись зомби. Fire-and-forget:
    // установка идёт минуты, тумбстоун успевает сняться до finalize-синка.
    if (ETB.registry.clearDeviceTombstone) ETB.registry.clearDeviceTombstone(deviceId, ctx.pluginId);
    _state.step = 'installing';
    _state.installStartedAt = Date.now();
    _state.installLongMode = false;
    _state.installAgentText = '';
    _installLogLines = [];
    _render();
    _startInstallTicker();

    // After the agent finishes, the local manifest file is the source of truth.
    function finalizeFromRegistry(agentErr, agentNotes) {
      _stopInstallTicker();
      _state.installAgentText = 'Finishing up';
      return ETB.registry.syncFromDevice(deviceId, ctx.safeId).then(function () {
        var plugin = ETB.registry.getById(ctx.pluginId);
        if (plugin) {
          _registerConcepts(plugin);
          _state.lastPluginId = ctx.pluginId;
          // Пост-проверка «немого» плагина: агент мог молча провалить сохранение
          // экспертов (реальный кейс 16.07 — MarkMello/md_reader ставились без
          // своих экспертов и падали «Expert not found» на каждой кнопке).
          // Проверяем каждое заявленное имя + старт-эксперт; недостачу честно
          // показываем на экране успеха вместо тихой поломки.
          var declared = (plugin.experts || []).slice();
          var startEx = plugin.ui && plugin.ui.startExpert;
          if (startEx && declared.indexOf(startEx) < 0) declared.push(startEx);
          declared = declared.filter(Boolean);
          var checks = declared.map(function (n) {
            return ETB.api.expertGet(n)
              .then(function (r) { return (r && r.status === 'success') ? null : n; })
              .catch(function () { return null; });   // сеть упала ≠ эксперта нет: не пугаем зря
          });
          return Promise.all(checks).then(function (marks) {
            var missing = marks.filter(Boolean);
            _state.doneWarning = missing.length
              ? 'Installed, but ' + missing.length + ' expert(s) were NOT created: ' + missing.join(', ') +
                '. Buttons calling them will fail with "Expert not found". Open the plugin and use ✨ Repair to finish setup.'
              : '';
            _state.step = 'done';
            ETB.tabs.refresh();
            _render();
          });
        }
        _state.step = 'analysis_error';
        _state.errorMsg = agentErr ||
          ('No plugin manifest was written (' + ctx.registryPath + ').' +
            (agentNotes ? ' Agent notes: ' + agentNotes : ''));
        _render();
      });
    }

    function runMainInstall(analysis) {
      var prompt = ETB.installPrompt.build(ctx, analysis);
      _installCancel = { cancelled: false };   // токен для кнопки «Отмена»
      return ETB.api.runAgentAsync(prompt, {
        run_timeout: 3600,
        maxWait: 3000000,
        interval: 4000,
        stallTimeout: 18 * 60 * 1000,
        cancelRef: _installCancel,
        onProgress: _makeInstallProgressTracker('')
      }).then(function (res) {
        var agentErr = '';
        var notes = '';
        try {
          var j = _tryParseJson(ETB.api.extractAgentText(res));
          if (j) {
            notes = j.notes || '';
            if (j.ok === false) agentErr = j.error || 'Agent reported failure';
          }
        } catch (e) { /* registry is source of truth */ }
        return finalizeFromRegistry(agentErr, notes);
      }).catch(function (e) {
        if (e && e.message === '_cancelled_') { return _onInstallCancelled(); }
        return finalizeFromRegistry((e && e.message) || 'Agent install failed', '');
      });
    }

    // Fast path: when the deterministic repo classifier (repoAnalyzer, no LLM) is
    // confident the repo is simple — a plain library or a CLI tool — skip the LLM
    // Phase-1 round trip (~30–180s) and hand the main agent a minimal category
    // hint. Phase 2 is unchanged and self-correcting, so a mis-hint costs at most
    // one re-read, never a broken install. Ambiguous/complex repos (web apps,
    // monorepos, services, unknown) still get the full two-phase flow.
    // Hosted (remote) mode has its own build recipe — never take the local
    // fast-path for it.
    var fastCat = ctx.runMode === 'remote' ? '' : _fastInstallCategory(digest);
    if (fastCat) {
      _state.installAgentText = 'Fast install (simple repo)';
      _render();
      return runMainInstall({ category: fastCat, setup_steps: [], _fastpath: true });
    }
    // Remote mode: skip LLM Phase-1 analysis, go straight to the hosted build.
    if (ctx.runMode === 'remote') {
      return runMainInstall(null);
    }

    var analysisPrompt = ETB.installPrompt.buildAnalysis
      ? ETB.installPrompt.buildAnalysis(ctx) : null;

    if (!analysisPrompt) {
      return runMainInstall(null);
    }

    // Phase 1: pure LLM analysis, no CSPL. Wire progress so the ticker shows live text.
    var phase1Tracker = _makeInstallProgressTracker('Analyzing: ');
    _state.installAgentText = 'Analyzing repository';
    return ETB.api.runAgentAsync(analysisPrompt, {
      run_timeout: 180,
      maxWait: 240000,
      interval: 3000,
      onProgress: phase1Tracker
    }).then(function (analysisRes) {
      var analysis = null;
      try {
        var txt = ETB.api.extractAgentText(analysisRes);
        var m = txt.match(/\{[\s\S]+\}/);
        if (m) analysis = JSON.parse(m[0]);
      } catch (_) { /* fallback to no-analysis */ }
      _state.installAgentText = analysis && analysis.category
        ? 'Category ' + analysis.category + ' — installing'
        : 'Installing';
      return runMainInstall(analysis);
    }).catch(function () {
      _state.installAgentText = 'Installing';
      return runMainInstall(null);
    });
  }

  // Best-effort: register the plugin's knowledge concepts so the LLM can use them.
  function _registerConcepts(plugin) {
    (plugin.conceptTexts || []).filter(Boolean).forEach(function (text) {
      ETB.api.addConcept(text).catch(function () {});
    });
  }

  function _ensureStyles() {
    if (document.getElementById('_etbv2_gh_styles')) return;
    var s = document.createElement('style');
    s.id = '_etbv2_gh_styles';
    s.textContent = STYLES;
    document.head.appendChild(s);
  }

  // ── Public API ────────────────────────────────────────────────
  return {
    open: function (prefillUrl) {
      if (document.getElementById('_etbv2_gh_ov')) return;
      _ensureStyles();

      _state = {
        step: 'input', repoData: null, customName: '', urlValue: prefillUrl || '',
        statusMsg: '', errorMsg: '', lastPluginId: null,
        digest: null, pluginId: null, ghToken: '', deviceId: null, installAgentText: '',
        heavyModel: null, deviceCaps: null, runMode: ''
      };

      var ov = document.createElement('div');
      ov.id = '_etbv2_gh_ov';

      var modal = document.createElement('div');
      modal.id = '_etbv2_gh_modal';
      ov.appendChild(modal);

      document.body.appendChild(ov);

      ov.addEventListener('click', function (e) {
        if (e.target === ov) ETB.githubAdd.close();
      });

      _render();

      if (prefillUrl) {
        setTimeout(function () { _fetchRepo(prefillUrl); }, 150);
      }
    },

    close: function () {
      _stopInstallTicker();
      var ov = document.getElementById('_etbv2_gh_ov');
      if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
    }
  };
})();
