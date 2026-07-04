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
      'background:var(--etb-s1,#fff);border:1px solid var(--etb-bd2,rgba(0,0,0,.14));border-radius:16px;',
      'width:480px;max-width:calc(100vw - 32px);',
      'box-shadow:0 24px 80px rgba(0,0,0,.35);overflow:hidden;',
    '}',
    'html[data-etb-light] #_etbv2_gh_modal{box-shadow:0 16px 48px rgba(0,0,0,.12);}',
    '#_etbv2_gh_hdr{',
      'display:flex;align-items:center;gap:10px;',
      'padding:18px 22px 16px;border-bottom:1px solid var(--etb-bd,rgba(0,0,0,.07));',
    '}',
    '#_etbv2_gh_hdr h3{flex:1;font-size:15px;font-weight:700;color:var(--etb-tx,#111);margin:0;}',
    '#_etbv2_gh_hdr button{',
      'background:none;border:none;color:var(--etb-tx2,#888);cursor:pointer;',
      'font-size:18px;padding:4px 6px;border-radius:5px;',
    '}',
    '#_etbv2_gh_hdr button:hover{background:var(--etb-s3,#f7f7f9);color:var(--etb-tx,#111);}',
    '#_etbv2_gh_body{padding:22px;}',
    '._etbv2_gh_title{font-size:14px;font-weight:700;color:var(--etb-tx,#111);margin-bottom:4px;}',
    '._etbv2_gh_title_lg{font-size:16px;font-weight:700;color:var(--etb-tx,#111);margin-bottom:8px;}',
    '._etbv2_gh_sub{font-size:12px;color:var(--etb-tx2,#6b6b6b);line-height:1.6;}',
    '._etbv2_gh_sub_sm{font-size:11px;color:var(--etb-tx2,#6b6b6b);line-height:1.6;}',
    /* Inputs */
    '._etbv2_gh_field{margin-bottom:16px;}',
    '._etbv2_gh_label{font-size:11px;font-weight:600;color:var(--etb-tx2,#6b6b6b);text-transform:uppercase;',
      'letter-spacing:.06em;margin-bottom:6px;display:block;}',
    '._etbv2_gh_input{',
      'width:100%;background:var(--etb-s2,#fff);border:1px solid var(--etb-bd2,rgba(0,0,0,.14));border-radius:9px;',
      'color:var(--etb-tx,#111);font-size:13px;padding:10px 14px;',
      'box-sizing:border-box;outline:none;transition:border-color .15s;',
      'font-family:-apple-system,system-ui,sans-serif;',
    '}',
    '._etbv2_gh_input:focus{border-color:rgba(198,126,52,.5);}',
    '._etbv2_gh_input::placeholder{color:var(--etb-tx3,#ccc);}',
    /* Preview card */
    '#_etbv2_gh_preview{',
      'background:var(--etb-s3,#f7f7f9);border:1px solid var(--etb-bd,rgba(0,0,0,.07));border-radius:10px;',
      'padding:14px 16px;margin-bottom:16px;display:none;',
    '}',
    '#_etbv2_gh_preview.show{display:block;}',
    '._etbv2_gh_prev_name{font-size:14px;font-weight:700;color:var(--etb-tx,#111);margin-bottom:4px;}',
    '._etbv2_gh_prev_desc{font-size:12px;color:var(--etb-tx2,#6b6b6b);line-height:1.5;margin-bottom:10px;}',
    '._etbv2_gh_prev_meta{display:flex;gap:10px;flex-wrap:wrap;}',
    '._etbv2_gh_pill{',
      'background:rgba(198,126,52,.1);color:var(--etb-a,#C67E34);border:1px solid rgba(198,126,52,.2);',
      'border-radius:5px;font-size:10px;font-weight:600;padding:2px 8px;',
    '}',
    /* Info note */
    '._etbv2_gh_experts{',
      'background:var(--etb-s3,#f7f7f9);border:1px solid var(--etb-bd,rgba(0,0,0,.07));border-radius:8px;',
      'padding:10px 12px;margin-bottom:16px;font-size:11px;color:var(--etb-tx2,#6b6b6b);',
    '}',
    /* Status */
    '#_etbv2_gh_status{',
      'font-size:12px;color:var(--etb-tx2,#6b6b6b);min-height:18px;margin-bottom:12px;',
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
      'border-radius:9px;padding:9px 20px;cursor:pointer;font-size:12px;',
    '}',
    '._etbv2_gh_btn_cancel:hover{color:var(--etb-tx,#111);}',
    '._etbv2_gh_btn_primary{',
      'background:var(--etb-a,#C67E34);border:none;color:#000;font-weight:700;',
      'border-radius:9px;padding:9px 20px;cursor:pointer;font-size:12px;',
      'transition:opacity .12s;',
    '}',
    '._etbv2_gh_btn_primary:hover{opacity:.85;}',
    '._etbv2_gh_btn_primary:disabled{opacity:.4;cursor:not-allowed;}',
    /* Install progress */
    '._etbv2_gh_prog{margin:6px 0 18px;}',
    '._etbv2_gh_prog_row{display:flex;align-items:center;gap:10px;margin-bottom:12px;}',
    '._etbv2_gh_prog_phase{flex:1;font-size:13px;font-weight:600;color:var(--etb-tx,#111);}',
    '._etbv2_gh_prog_time{font-size:12px;color:var(--etb-tx2,#6b6b6b);font-variant-numeric:tabular-nums;}',
    '._etbv2_gh_bar{position:relative;height:5px;border-radius:4px;background:var(--etb-bd2,rgba(0,0,0,.1));overflow:hidden;}',
    '._etbv2_gh_bar_fill{position:absolute;top:0;left:0;height:100%;width:38%;border-radius:4px;',
      'background:linear-gradient(90deg,rgba(198,126,52,.25),#C67E34,rgba(198,126,52,.25));',
      'animation:_etbv2_gh_indet 1.25s ease-in-out infinite;}',
    '@keyframes _etbv2_gh_indet{0%{left:-40%}100%{left:100%}}',
    '._etbv2_gh_steps{margin-top:16px;display:flex;flex-direction:column;gap:7px;}',
    '._etbv2_gh_step{display:flex;align-items:center;gap:9px;font-size:12px;color:var(--etb-tx3,#ccc);transition:color .2s;}',
    '._etbv2_gh_step._done{color:var(--etb-tx2,#6b6b6b);}',
    '._etbv2_gh_step._active{color:var(--etb-a,#C67E34);font-weight:600;}',
    '._etbv2_gh_dot{width:6px;height:6px;border-radius:50%;background:var(--etb-bd2,rgba(0,0,0,.2));flex-shrink:0;transition:background .2s;}',
    '._etbv2_gh_step._done ._etbv2_gh_dot{background:var(--etb-tx3,#ccc);}',
    '._etbv2_gh_step._active ._etbv2_gh_dot{background:var(--etb-a,#C67E34);box-shadow:0 0 7px rgba(198,126,52,.5);}',
    '._etbv2_gh_note{font-size:11px;color:var(--etb-tx2,#6b6b6b);line-height:1.5;margin-top:16px;}'
  ].join('');

  // ── State ──────────────────────────────────────────────────────
  var _state = {
    step: 'input', // input | preview | creating | installing | device_id_input | analysis_error | error | done
    repoData: null,
    customName: ''
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
  var _installLogLines = []; // last 5 lines from agent, shown in Activity block

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
      '<div style="margin-top:10px;border:1px solid var(--etb-bd,rgba(0,0,0,.07));border-radius:8px;overflow:hidden;">',
        '<div style="font-size:10px;font-weight:600;color:var(--etb-tx2,#6b6b6b);',
          'text-transform:uppercase;letter-spacing:.05em;padding:5px 10px 4px;',
          'background:var(--etb-s3,#f7f7f9);border-bottom:1px solid var(--etb-bd,rgba(0,0,0,.07));">',
          'Activity',
        '</div>',
        '<div id="_etbv2_gh_log" style="padding:6px 10px;font-size:11px;',
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
        '<div id="_etbv2_gh_body" style="text-align:center;padding:40px 22px;">',
        '<div style="font-size:48px;margin-bottom:14px;">&#10003;</div>',
        '<div class="_etbv2_gh_title_lg">Plugin added!</div>',
        '<div class="_etbv2_gh_sub" style="margin-bottom:18px;">',
        _esc(s.customName || (s.repoData && s.repoData.name) || ''),
        ' is now available in Plugins.</div>',
        '<div class="_etbv2_gh_actions" style="justify-content:center;">',
        '<button class="_etbv2_gh_btn_cancel" id="_etbv2_gh_close_done">Close</button>',
        '<button class="_etbv2_gh_btn_primary" id="_etbv2_gh_open_now">Open Plugin</button>',
        '</div></div>'
      ].join('');
    } else if (s.step === 'analysis_error') {
      modalHtml = _renderAnalysisError();
    } else if (s.step === 'device_id_input') {
      modalHtml = _renderDeviceIdInput();
    } else if (s.step === 'installing') {
      modalHtml = [
        '<div id="_etbv2_gh_body">',
        '<div class="_etbv2_gh_title">Installing ',
        _esc(s.customName || (s.repoData && s.repoData.name) || 'plugin'),
        '</div>',
        _renderInstallProgress(),
        '<div class="_etbv2_gh_actions">',
        '<button class="_etbv2_gh_btn_cancel" id="_etbv2_gh_hide">Hide</button>',
        '</div>',
        '</div>'
      ].join('');
    } else {
      var rd = s.repoData || {};
      var working = s.step === 'creating' || s.step === 'analyzing' || s.step === 'installing';

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
        'Extella\'s agent will analyze this repository and autonomously install it ',
        'as a plugin — reusing or generating a working interface on your device.',
        '</div>',
        '</div>',
        '</div>', // end preview
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
          : rd.name && s.step === 'preview'
            ? '<button class="_etbv2_gh_btn_primary" id="_etbv2_gh_create">Install Plugin</button>'
            : '<button class="_etbv2_gh_btn_primary" disabled>Working...</button>',
        '</div>',
        '</div>'
      ].join('');
    }

    var modal = ov.querySelector('#_etbv2_gh_modal');
    modal.innerHTML = [
      '<div id="_etbv2_gh_hdr">',
      '<div style="width:8px;height:8px;border-radius:50%;background:#C67E34;',
      'box-shadow:0 0 8px rgba(198,126,52,.4);flex-shrink:0;"></div>',
      '<h3>Add GitHub Resource</h3>',
      '<button id="_etbv2_gh_x">&#10005;</button>',
      '</div>',
      modalHtml
    ].join('');

    _bindEvents(ov);
  }

  // ── Install failed: real error + retry ─────────────────────────
  function _renderAnalysisError() {
    return [
      '<div id="_etbv2_gh_body">',
      '<div class="_etbv2_gh_title" style="margin-bottom:10px;">Installation failed</div>',
      '<div style="font-size:12px;color:#e74c3c;line-height:1.6;margin-bottom:16px;">',
      _esc(_state.errorMsg || 'Unknown error'),
      '</div>',
      '<div class="_etbv2_gh_sub_sm" style="margin-bottom:16px;">',
      'The agent could not complete the install. You can retry — long repositories ',
      '(build + toolchain) can take a few minutes.',
      '</div>',
      '<div id="_etbv2_gh_status"></div>',
      '<div class="_etbv2_gh_actions">',
      '<button class="_etbv2_gh_btn_cancel" id="_etbv2_gh_cancel">Cancel</button>',
      '<button class="_etbv2_gh_btn_primary" id="_etbv2_gh_retry">Retry</button>',
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

    var didSubmitBtn = ov.querySelector('#_etbv2_gh_did_submit');
    if (didSubmitBtn) didSubmitBtn.onclick = _onDeviceIdSubmit;

    var hideBtn = ov.querySelector('#_etbv2_gh_hide');
    if (hideBtn) hideBtn.onclick = function () { ETB.githubAdd.close(); };

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
        return _getDeviceId();
      })
      .then(function (deviceId) {
        if (!deviceId) {
          _state.step = 'device_id_input';
          _render();
          return;
        }
        return _runAgentInstall(rd, _state.digest, deviceId);
      })
      .catch(function (e) {
        _state.step = 'analysis_error';
        _state.errorMsg = (e && e.message) || 'Analysis failed';
        _render();
      });
  }

  // ── Agent install: smart orchestration.
  //    For simple repos (library/static/cli): heuristic analysis skips LLM Phase 1 entirely.
  //    For complex/ambiguous repos: LLM SubAgent-A runs first, then the main agent.
  //    This restores Toolbar-1.2.5 speed for simple plugins while keeping the two-phase
  //    flow only where it genuinely helps (monorepos, docker, apps with start scripts).
  function _runAgentInstall(rd, digest, deviceId) {
    var ctx = ETB.installPrompt.context(rd, digest);
    if (_state.customName) ctx.displayName = _state.customName;
    _state.pluginId = ctx.pluginId;
    _state.deviceId = deviceId;
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
          _state.step = 'done';
          ETB.tabs.refresh();
          _render();
          return;
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
      return ETB.api.runAgentAsync(prompt, {
        run_timeout: 3600,
        maxWait: 3000000,
        interval: 4000,
        stallTimeout: 18 * 60 * 1000,
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
        return finalizeFromRegistry((e && e.message) || 'Agent install failed', '');
      });
    }

    // All repos go through LLM SubAgent-A (Phase 1) for consistent, stable classification.
    // The heuristic fast-path is intentionally removed — the LLM decides category for everyone.
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
        digest: null, pluginId: null, ghToken: '', deviceId: null, installAgentText: ''
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
