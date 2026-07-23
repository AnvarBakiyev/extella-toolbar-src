// ── HF ADD PANEL ──────────────────────────────────────────────────────────
// Agent-driven plugin install for HuggingFace Spaces and Models.
// Mirrors github-add.js but adds a run-mode selection step (Local vs HF remote)
// and resource estimation. For remote Spaces the agent simply registers a
// manifest pointing to the live hf.space URL. For remote Models the agent
// generates a control-panel UI that calls the HF Inference API with a token.
// For local installations the agent clones/downloads and runs on-device.
//
// Exposes: ETB.hfAdd.open(prefill?), ETB.hfAdd.close()

ETB.hfAdd = (function () {

  // ── Styles (share prefix _etbv2_hf_ to avoid collisions) ───────
  var STYLES = [
    '#_etbv2_hf_ov{',
      'position:fixed;inset:0;z-index:2147483645;',
      'background:rgba(0,0,0,.72);backdrop-filter:blur(6px);',
      'display:flex;align-items:center;justify-content:center;',
      'font-family:-apple-system,system-ui,sans-serif;',
      'animation:_etbv2_hf_fade .16s ease;',
    '}',
    'html[data-etb-light] #_etbv2_hf_ov{background:rgba(0,0,0,.35);}',
    '@keyframes _etbv2_hf_fade{from{opacity:0}to{opacity:1}}',
    '#_etbv2_hf_modal{',
      'background:var(--etb-s1,#fff);border:1px solid var(--etb-bd2,rgba(0,0,0,.14));border-radius:16px;',
      'width:500px;max-width:calc(100vw - 32px);max-height:90vh;overflow-y:auto;',
      'box-shadow:0 24px 80px rgba(0,0,0,.35);',
    '}',
    'html[data-etb-light] #_etbv2_hf_modal{box-shadow:0 16px 48px rgba(0,0,0,.12);}',
    '#_etbv2_hf_hdr{',
      'display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:1;',
      'padding:18px 22px 16px;border-bottom:1px solid var(--etb-bd,rgba(0,0,0,.07));',
      'background:var(--etb-s1,#fff);',
    '}',
    '#_etbv2_hf_hdr h3{flex:1;font-size:15px;font-weight:700;color:var(--etb-tx,#111);margin:0;}',
    '#_etbv2_hf_hdr button{',
      'background:none;border:none;color:var(--etb-tx2,#888);cursor:pointer;',
      'font-size:18px;padding:4px 6px;border-radius:5px;',
    '}',
    '#_etbv2_hf_hdr button:hover{background:var(--etb-s3,#f7f7f9);color:var(--etb-tx,#111);}',
    '#_etbv2_hf_body{padding:22px;}',
    '._etbv2_hf_title{font-size:14px;font-weight:700;color:var(--etb-tx,#111);margin-bottom:4px;}',
    '._etbv2_hf_sub{font-size:12px;color:var(--etb-tx2,#6b6b6b);line-height:1.6;}',
    '._etbv2_hf_sub_sm{font-size:11px;color:var(--etb-tx2,#6b6b6b);line-height:1.6;}',
    '._etbv2_hf_field{margin-bottom:16px;}',
    '._etbv2_hf_label{font-size:11px;font-weight:600;color:var(--etb-tx2,#6b6b6b);text-transform:uppercase;',
      'letter-spacing:.06em;margin-bottom:6px;display:block;}',
    '._etbv2_hf_input{',
      'width:100%;background:var(--etb-s2,#fff);border:1px solid var(--etb-bd2,rgba(0,0,0,.14));border-radius:9px;',
      'color:var(--etb-tx,#111);font-size:13px;padding:10px 14px;',
      'box-sizing:border-box;outline:none;transition:border-color .15s;',
      'font-family:-apple-system,system-ui,sans-serif;',
    '}',
    '._etbv2_hf_input:focus{border-color:rgba(198,126,52,.5);}',
    '._etbv2_hf_input::placeholder{color:var(--etb-tx3,#ccc);}',
    '._etbv2_hf_preview{',
      'background:var(--etb-s3,#f7f7f9);border:1px solid var(--etb-bd,rgba(0,0,0,.07));border-radius:10px;',
      'padding:14px 16px;margin-bottom:16px;',
    '}',
    '._etbv2_hf_prev_name{font-size:14px;font-weight:700;color:var(--etb-tx,#111);margin-bottom:3px;}',
    '._etbv2_hf_prev_desc{font-size:12px;color:var(--etb-tx2,#6b6b6b);line-height:1.5;margin-bottom:10px;}',
    '._etbv2_hf_pills{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px;}',
    '._etbv2_hf_pill{background:rgba(198,126,52,.1);color:var(--etb-a,#C67E34);',
      'border:1px solid rgba(198,126,52,.2);border-radius:5px;font-size:10px;font-weight:600;padding:2px 8px;}',
    '._etbv2_hf_hfbadge{background:rgba(255,176,47,.12);color:#d97706;',
      'border:1px solid rgba(255,176,47,.25);border-radius:5px;font-size:10px;font-weight:700;padding:2px 8px;}',
    /* Resources block */
    '._etbv2_hf_res{',
      'background:rgba(198,126,52,.04);border:1px solid rgba(198,126,52,.12);border-radius:8px;',
      'padding:10px 14px;margin-bottom:16px;',
    '}',
    '._etbv2_hf_res_title{font-size:11px;font-weight:700;color:var(--etb-tx,#111);',
      'text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px;}',
    '._etbv2_hf_res_row{display:flex;gap:16px;flex-wrap:wrap;}',
    '._etbv2_hf_res_item{font-size:11.5px;color:var(--etb-tx2,#6b6b6b);}',
    '._etbv2_hf_res_item b{color:var(--etb-tx,#111);font-weight:600;}',
    /* Run-mode selector */
    '._etbv2_hf_modes{display:flex;gap:10px;margin-bottom:16px;}',
    '._etbv2_hf_mode_card{flex:1;border:2px solid var(--etb-bd2,rgba(0,0,0,.14));border-radius:10px;',
      'padding:14px;cursor:pointer;transition:all .15s;user-select:none;}',
    '._etbv2_hf_mode_card:hover{border-color:rgba(198,126,52,.4);}',
    '._etbv2_hf_mode_card.selected{border-color:var(--etb-a,#C67E34);background:rgba(198,126,52,.05);}',
    '._etbv2_hf_mode_card .mode_icon{font-size:20px;margin-bottom:6px;}',
    '._etbv2_hf_mode_card .mode_title{font-size:12px;font-weight:700;color:var(--etb-tx,#111);margin-bottom:3px;}',
    '._etbv2_hf_mode_card .mode_desc{font-size:11px;color:var(--etb-tx2,#6b6b6b);line-height:1.5;}',
    '._etbv2_hf_mode_card .mode_badge{',
      'display:inline-block;margin-top:6px;font-size:9.5px;font-weight:700;',
      'background:rgba(34,197,94,.1);color:#16a34a;border:1px solid rgba(34,197,94,.2);',
      'border-radius:4px;padding:1px 7px;',
    '}',
    /* Status */
    '#_etbv2_hf_status{',
      'font-size:12px;color:var(--etb-tx2,#6b6b6b);margin-bottom:12px;',
      'display:flex;align-items:center;gap:8px;',
    '}',
    '#_etbv2_hf_status:empty{display:none;}',
    '._etbv2_hf_spinner{',
      'width:14px;height:14px;border:2px solid var(--etb-bd2,rgba(0,0,0,.14));',
      'border-top-color:var(--etb-a,#C67E34);border-radius:50%;',
      'animation:_etbv2_spin .7s linear infinite;flex-shrink:0;',
    '}',
    '@keyframes _etbv2_spin{to{transform:rotate(360deg)}}',
    '._etbv2_hf_actions{display:flex;gap:8px;justify-content:flex-end;}',
    '._etbv2_hf_btn_cancel{',
      'background:var(--etb-s3,#f7f7f9);border:1px solid var(--etb-bd2,rgba(0,0,0,.14));color:var(--etb-tx2,#6b6b6b);',
      'border-radius:9px;padding:9px 20px;cursor:pointer;font-size:12px;font-family:inherit;',
    '}',
    '._etbv2_hf_btn_cancel:hover{color:var(--etb-tx,#111);}',
    '._etbv2_hf_btn_primary{',
      'background:var(--etb-a,#C67E34);border:none;color:#000;font-weight:700;',
      'border-radius:9px;padding:9px 20px;cursor:pointer;font-size:12px;',
      'transition:opacity .12s;font-family:inherit;',
    '}',
    '._etbv2_hf_btn_primary:hover{opacity:.85;}',
    '._etbv2_hf_btn_primary:disabled{opacity:.4;cursor:not-allowed;}',
    /* Progress */
    '._etbv2_hf_prog{margin:6px 0 18px;}',
    '._etbv2_hf_prog_row{display:flex;align-items:center;gap:10px;margin-bottom:12px;}',
    '._etbv2_hf_prog_phase{flex:1;font-size:13px;font-weight:600;color:var(--etb-tx,#111);}',
    '._etbv2_hf_prog_time{font-size:12px;color:var(--etb-tx2,#6b6b6b);font-variant-numeric:tabular-nums;}',
    '._etbv2_hf_bar{position:relative;height:5px;border-radius:4px;background:var(--etb-bd2,rgba(0,0,0,.1));overflow:hidden;}',
    '._etbv2_hf_bar_fill{position:absolute;top:0;left:0;height:100%;width:38%;border-radius:4px;',
      'background:linear-gradient(90deg,rgba(198,126,52,.25),#C67E34,rgba(198,126,52,.25));',
      'animation:_etbv2_hf_indet 1.25s ease-in-out infinite;}',
    '@keyframes _etbv2_hf_indet{0%{left:-40%}100%{left:100%}}',
    '._etbv2_hf_activity{',
      'background:var(--etb-s3,#f7f7f9);border:1px solid var(--etb-bd,rgba(0,0,0,.07));',
      'border-radius:8px;padding:10px 12px;max-height:120px;overflow-y:auto;',
      'font-family:monospace;font-size:10.5px;color:var(--etb-tx2,#6b6b6b);line-height:1.6;',
      'margin-bottom:16px;word-break:break-word;',
    '}',
    '._etbv2_hf_activity:empty{display:none;}',
    '._etbv2_hf_token_note{font-size:11px;color:var(--etb-tx2,#6b6b6b);line-height:1.6;',
      'background:rgba(59,130,246,.05);border:1px solid rgba(59,130,246,.15);',
      'border-radius:8px;padding:10px 12px;margin-bottom:12px;}',
    '._etbv2_hf_token_note a{color:#3b82f6;text-decoration:none;}',
    '._etbv2_hf_token_note a:hover{text-decoration:underline;}',
    '._etbv2_hf_note{font-size:11px;color:var(--etb-tx2,#6b6b6b);line-height:1.5;margin-top:16px;}'
  ].join('');

  // ── State ──────────────────────────────────────────────────────
  var _state = {
    step: 'input', // input | fetching | preview | runmode | token_input | device_id_input | installing | error | done
    kind: 'space',
    id: '',
    prefill: '',
    hfToken: '',
    runMode: 'local', // 'local' | 'remote'
    harvest: null,
    pluginId: null,
    deviceId: null,
    installAgentText: '',
    installStartedAt: null,
    errorMsg: '',
    statusMsg: ''
  };

  var _installTicker = null;
  var _installLogLines = [];

  // ── Helpers ────────────────────────────────────────────────────
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

  function _fmtBytes(b) {
    if (!b || b <= 0) return null;
    if (b >= 1e9) return (b / 1e9).toFixed(1) + ' GB';
    if (b >= 1e6) return (b / 1e6).toFixed(1) + ' MB';
    return (b / 1e3).toFixed(0) + ' KB';
  }

  function _fmtTime(secs) {
    var m = Math.floor(secs / 60), s = secs % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  // Parse `hf:space:owner/name`, `hf:model:owner/name`, or HF URL
  function _parseHFPrefill(s) {
    if (!s) return null;
    s = s.trim();
    // hf:kind:id pattern
    var m1 = s.match(/^hf:(space|model):(.+)$/i);
    if (m1) return { kind: m1[1].toLowerCase(), id: m1[2].trim() };
    // HuggingFace URL: https://huggingface.co/{id} or https://huggingface.co/spaces/{id}
    var m2 = s.match(/huggingface\.co\/spaces\/([^/?#]+\/[^/?#]+)/i);
    if (m2) return { kind: 'space', id: m2[1] };
    var m3 = s.match(/huggingface\.co\/([^/?#]+\/[^/?#]+)/i);
    if (m3) return { kind: 'model', id: m3[1] };
    // bare owner/name — assume space if no path context
    var m4 = s.match(/^([a-z0-9_-]+\/[a-z0-9_.-]+)$/i);
    if (m4) return { kind: 'space', id: m4[1] };
    return null;
  }

  // ── Style injection ────────────────────────────────────────────
  function _ensureStyles() {
    if (document.getElementById('_etbv2_hf_styles')) return;
    var st = document.createElement('style');
    st.id = '_etbv2_hf_styles';
    st.textContent = STYLES;
    document.head.appendChild(st);
  }

  // ── Install ticker (fallback phase labels) ─────────────────────
  var INSTALL_PHASES = [
    'Preparing environment',
    'Downloading / cloning',
    'Installing dependencies',
    'Building the interface',
    'Starting service',
    'Validating'
  ];
  var INSTALL_SCHEDULE = [0, 10, 30, 60, 100, 140];

  function _installPhaseIdx(secs) {
    var idx = 0;
    for (var i = 0; i < INSTALL_SCHEDULE.length; i++) {
      if (secs >= INSTALL_SCHEDULE[i]) idx = i;
    }
    return Math.min(idx, INSTALL_PHASES.length - 1);
  }

  function _startInstallTicker() {
    _stopInstallTicker();
    _installTicker = setInterval(function () {
      var secs = Math.floor((Date.now() - _state.installStartedAt) / 1000);
      var pEl = document.getElementById('_etbv2_hf_prog_phase');
      var tEl = document.getElementById('_etbv2_hf_prog_time');
      if (tEl) tEl.textContent = _fmtTime(secs);
      if (pEl) {
        var label = _state.installAgentText ||
          INSTALL_PHASES[_installPhaseIdx(secs)];
        pEl.textContent = label.slice(0, 80);
      }
      var actEl = document.getElementById('_etbv2_hf_activity');
      if (actEl && _installLogLines.length) {
        actEl.style.display = '';
        actEl.innerHTML = _installLogLines.slice(-8).map(function (l) {
          return '<div>' + _esc(l) + '</div>';
        }).join('');
        actEl.scrollTop = actEl.scrollHeight;
      }
    }, 1000);
  }

  function _stopInstallTicker() {
    if (_installTicker) { clearInterval(_installTicker); _installTicker = null; }
  }

  function _makeInstallProgressTracker() {
    return function (text) {
      if (!text) return;
      _state.installAgentText = text.slice(0, 120);
      _installLogLines.push(text.slice(0, 200));
      if (_installLogLines.length > 50) _installLogLines = _installLogLines.slice(-50);
    };
  }

  // ── Device ID helpers ──────────────────────────────────────────
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

  // ── HF Token helpers ──────────────────────────────────────────
  function _getHFToken() {
    return ETB.api.kvGet('hf_token')
      .then(function (res) { return (res && res.value) || ''; })
      .catch(function () { return ''; });
  }

  // ── Render ─────────────────────────────────────────────────────
  function _render() {
    var modal = document.getElementById('_etbv2_hf_modal');
    if (!modal) return;
    modal.innerHTML = _buildModalHTML();

    // Auto-focus input on input step
    if (_state.step === 'input') {
      var inp = document.getElementById('_etbv2_hf_url_inp');
      if (inp) setTimeout(function () { inp.focus(); }, 50);
    }
  }

  function _buildModalHTML() {
    var kind = _state.kind;
    var kindLabel = kind === 'model' ? '🧠 Model' : '🤗 Space';
    var title = 'HuggingFace · ' + kindLabel;

    var body = '';
    switch (_state.step) {
      case 'input':       body = _htmlInput();       break;
      case 'fetching':    body = _htmlFetching();    break;
      case 'preview':     body = _htmlPreview();     break;
      case 'runmode':     body = _htmlRunMode();     break;
      case 'token_input': body = _htmlTokenInput();  break;
      case 'device_id_input': body = _htmlDeviceId(); break;
      case 'installing':  body = _htmlInstalling();  break;
      case 'error':       body = _htmlError();       break;
      case 'done':        body = _htmlDone();        break;
      default:            body = '';
    }

    return [
      '<div id="_etbv2_hf_hdr">',
        '<h3>' + _esc(title) + '</h3>',
        '<button onclick="ETB.hfAdd.close()" title="Close">✕</button>',
      '</div>',
      '<div id="_etbv2_hf_body">' + body + '</div>'
    ].join('');
  }

  function _htmlInput() {
    return [
      '<div class="_etbv2_hf_field">',
        '<label class="_etbv2_hf_label">HuggingFace URL or ID</label>',
        '<input class="_etbv2_hf_input" id="_etbv2_hf_url_inp"',
          ' placeholder="e.g. black-forest-labs/FLUX.1-schnell"',
          ' value="' + _esc(_state.prefill) + '"',
          ' onkeydown="if(event.key===\'Enter\')ETB.hfAdd._onInputSubmit()"',
        '>',
      '</div>',
      '<div class="_etbv2_hf_sub" style="margin-bottom:16px">',
        'Paste a HuggingFace URL, a <code>hf:space:owner/name</code> identifier, ',
        'or an <code>owner/name</code> slug.',
      '</div>',
      '<div id="_etbv2_hf_status"></div>',
      '<div class="_etbv2_hf_actions">',
        '<button class="_etbv2_hf_btn_cancel" onclick="ETB.hfAdd.close()">Cancel</button>',
        '<button class="_etbv2_hf_btn_primary" onclick="ETB.hfAdd._onInputSubmit()">Continue →</button>',
      '</div>'
    ].join('');
  }

  function _htmlFetching() {
    return [
      '<div id="_etbv2_hf_status">',
        '<div class="_etbv2_hf_spinner"></div>',
        '<span>' + _esc(_state.statusMsg || 'Fetching metadata…') + '</span>',
      '</div>'
    ].join('');
  }

  function _htmlPreview() {
    var h = _state.harvest || {};
    var res = h.resources || {};
    var pills = [];
    if (h.sdk) pills.push('<span class="_etbv2_hf_pill">' + _esc(h.sdk) + '</span>');
    if (h.pipelineTag) pills.push('<span class="_etbv2_hf_pill">' + _esc(h.pipelineTag) + '</span>');
    if (h.libraryName) pills.push('<span class="_etbv2_hf_pill">' + _esc(h.libraryName) + '</span>');
    var kindBadge = '<span class="_etbv2_hf_hfbadge">' + (h.kind === 'model' ? 'Model' : 'Space') + '</span>';

    var resHtml = '';
    var resItems = [];
    if (res.diskBytes) resItems.push('<span class="_etbv2_hf_res_item">💾 Disk: <b>' + _fmtBytes(res.diskBytes) + '</b></span>');
    if (res.vramEstimate) resItems.push('<span class="_etbv2_hf_res_item">🖥 VRAM: <b>~' + _fmtBytes(res.vramEstimate) + '</b></span>');
    if (res.hardware) resItems.push('<span class="_etbv2_hf_res_item">⚡ GPU: <b>' + _esc(res.hardware) + '</b></span>');
    if (resItems.length) {
      resHtml = [
        '<div class="_etbv2_hf_res">',
          '<div class="_etbv2_hf_res_title">Required on your device</div>',
          '<div class="_etbv2_hf_res_row">' + resItems.join('') + '</div>',
        '</div>'
      ].join('');
    }

    return [
      '<div class="_etbv2_hf_preview">',
        '<div class="_etbv2_hf_prev_name">' + _esc(h.name || h.id || '') + '&nbsp;' + kindBadge + '</div>',
        '<div class="_etbv2_hf_prev_desc">' + _esc((h.description || '').slice(0, 200)) + '</div>',
        pills.length ? '<div class="_etbv2_hf_pills">' + pills.join('') + '</div>' : '',
      '</div>',
      resHtml,
      '<div class="_etbv2_hf_actions">',
        '<button class="_etbv2_hf_btn_cancel" onclick="ETB.hfAdd.close()">Cancel</button>',
        '<button class="_etbv2_hf_btn_primary" onclick="ETB.hfAdd._goRunMode()">Choose run mode →</button>',
      '</div>'
    ].join('');
  }

  function _htmlRunMode() {
    var h = _state.harvest || {};
    var kind = _state.kind;
    var localDesc = kind === 'space'
      ? 'Clone and run the Space on your device (Python/Node required).'
      : 'Download model weights and run local inference.';
    var remoteDesc = kind === 'space'
      ? 'Open the live ' + _esc(h.name || '') + ' page hosted on HuggingFace.'
      : 'Call the HF Inference API (requires a free HF token).';
    var remoteBadge = kind === 'space' ? '' : '<span class="mode_badge">Free tier available</span>';

    return [
      '<div class="_etbv2_hf_title" style="margin-bottom:12px">Choose how to run this ' + (kind === 'model' ? 'model' : 'space') + '</div>',
      '<div class="_etbv2_hf_modes">',
        '<div class="_etbv2_hf_mode_card' + (_state.runMode === 'local' ? ' selected' : '') + '"',
          ' onclick="ETB.hfAdd._selectMode(\'local\')">',
          '<div class="mode_icon">💻</div>',
          '<div class="mode_title">Run locally</div>',
          '<div class="mode_desc">' + localDesc + '</div>',
        '</div>',
        '<div class="_etbv2_hf_mode_card' + (_state.runMode === 'remote' ? ' selected' : '') + '"',
          ' onclick="ETB.hfAdd._selectMode(\'remote\')">',
          '<div class="mode_icon">☁️</div>',
          '<div class="mode_title">Run on HuggingFace</div>',
          '<div class="mode_desc">' + remoteDesc + '</div>',
          remoteBadge,
        '</div>',
      '</div>',
      '<div class="_etbv2_hf_actions">',
        '<button class="_etbv2_hf_btn_cancel" onclick="ETB.hfAdd._goPreview()">← Back</button>',
        '<button class="_etbv2_hf_btn_primary" onclick="ETB.hfAdd._onRunModeNext()">Install →</button>',
      '</div>'
    ].join('');
  }

  function _htmlTokenInput() {
    return [
      '<div class="_etbv2_hf_title" style="margin-bottom:8px">HuggingFace Token Required</div>',
      '<div class="_etbv2_hf_token_note">',
        'To use the HF Inference API you need a <b>User Access Token</b>.<br>',
        'Get one at <a href="https://huggingface.co/settings/tokens" target="_blank">',
          'huggingface.co/settings/tokens</a> ',
        '(create with scope <b>Make calls to Inference Providers</b>).',
      '</div>',
      '<div class="_etbv2_hf_field">',
        '<label class="_etbv2_hf_label">Token</label>',
        '<input class="_etbv2_hf_input" id="_etbv2_hf_tok_inp" type="password"',
          ' placeholder="hf_..." autocomplete="off"',
          ' onkeydown="if(event.key===\'Enter\')ETB.hfAdd._onTokenSubmit()"',
        '>',
      '</div>',
      '<div id="_etbv2_hf_status"></div>',
      '<div class="_etbv2_hf_actions">',
        '<button class="_etbv2_hf_btn_cancel" onclick="ETB.hfAdd._goRunMode()">← Back</button>',
        '<button class="_etbv2_hf_btn_primary" onclick="ETB.hfAdd._onTokenSubmit()">Save &amp; Continue →</button>',
      '</div>'
    ].join('');
  }

  function _htmlDeviceId() {
    return [
      '<div class="_etbv2_hf_title" style="margin-bottom:4px">Device ID required</div>',
      '<div class="_etbv2_hf_sub" style="margin-bottom:12px">',
        'Enter the Extella device ID for your local machine to set up the plugin.',
      '</div>',
      '<div class="_etbv2_hf_field">',
        '<label class="_etbv2_hf_label">Device ID</label>',
        '<input class="_etbv2_hf_input" id="_etbv2_hf_did_inp"',
          ' placeholder="device_..."',
          ' onkeydown="if(event.key===\'Enter\')ETB.hfAdd._onDeviceIdSubmit()"',
        '>',
      '</div>',
      '<div id="_etbv2_hf_status"></div>',
      '<div class="_etbv2_hf_actions">',
        '<button class="_etbv2_hf_btn_cancel" onclick="ETB.hfAdd.close()">Cancel</button>',
        '<button class="_etbv2_hf_btn_primary" onclick="ETB.hfAdd._onDeviceIdSubmit()">Continue →</button>',
      '</div>'
    ].join('');
  }

  function _htmlInstalling() {
    var secs = _state.installStartedAt
      ? Math.floor((Date.now() - _state.installStartedAt) / 1000) : 0;
    var phase = _state.installAgentText || INSTALL_PHASES[_installPhaseIdx(secs)];
    // Always render the activity div so the ticker can update it in-place without _render().
    // Start hidden when empty; the ticker reveals it on first log line.
    var logItems = _installLogLines.slice(-8);
    var actHtml = '<div class="_etbv2_hf_activity" id="_etbv2_hf_activity"' +
      (logItems.length ? '' : ' style="display:none"') + '>' +
      logItems.map(function (l) { return '<div>' + _esc(l) + '</div>'; }).join('') +
    '</div>';

    return [
      '<div class="_etbv2_hf_title" style="margin-bottom:16px">Installing…</div>',
      '<div class="_etbv2_hf_prog">',
        '<div class="_etbv2_hf_prog_row">',
          '<div class="_etbv2_hf_prog_phase" id="_etbv2_hf_prog_phase">' + _esc(phase) + '</div>',
          '<div class="_etbv2_hf_prog_time" id="_etbv2_hf_prog_time">' + _fmtTime(secs) + '</div>',
        '</div>',
        '<div class="_etbv2_hf_bar"><div class="_etbv2_hf_bar_fill"></div></div>',
      '</div>',
      actHtml,
      '<div class="_etbv2_hf_note">The agent is setting up the plugin on your device. This may take a few minutes.</div>'
    ].join('');
  }

  function _htmlError() {
    return [
      '<div class="_etbv2_hf_title" style="color:#f87171;margin-bottom:8px">Installation failed</div>',
      '<div class="_etbv2_hf_sub" style="margin-bottom:16px">' + _esc(_state.errorMsg) + '</div>',
      '<div class="_etbv2_hf_actions">',
        '<button class="_etbv2_hf_btn_cancel" onclick="ETB.hfAdd.close()">Close</button>',
        '<button class="_etbv2_hf_btn_primary" onclick="ETB.hfAdd._retry()">Retry</button>',
      '</div>'
    ].join('');
  }

  function _htmlDone() {
    return [
      '<div style="text-align:center;padding:8px 0 16px">',
        '<div style="font-size:32px;margin-bottom:12px">✅</div>',
        '<div class="_etbv2_hf_title" style="font-size:15px">Plugin installed!</div>',
        '<div class="_etbv2_hf_sub" style="margin-top:6px">Open it from the Plugins tab.</div>',
      '</div>',
      '<div class="_etbv2_hf_actions" style="justify-content:center">',
        '<button class="_etbv2_hf_btn_primary" onclick="ETB.hfAdd._openPlugin()">Open Plugin</button>',
      '</div>'
    ].join('');
  }

  // ── Navigation ─────────────────────────────────────────────────
  function _goPreview() {
    _state.step = 'preview';
    _render();
  }

  function _goRunMode() {
    _state.step = 'runmode';
    _render();
  }

  function _selectMode(mode) {
    _state.runMode = mode;
    _render();
  }

  // ── Event handlers ─────────────────────────────────────────────
  function _onInputSubmit() {
    var inp = document.getElementById('_etbv2_hf_url_inp');
    var raw = inp ? inp.value.trim() : '';
    var parsed = _parseHFPrefill(raw);
    if (!parsed) {
      var stEl = document.getElementById('_etbv2_hf_status');
      if (stEl) stEl.textContent = 'Invalid URL or ID. Try e.g. black-forest-labs/FLUX.1-schnell';
      return;
    }
    _state.kind = parsed.kind;
    _state.id   = parsed.id;
    _state.step = 'fetching';
    _state.statusMsg = 'Fetching metadata from HuggingFace…';
    _render();

    _getHFToken().then(function (tok) {
      _state.hfToken = tok;
      return ETB.hfAnalyzer.harvest(parsed.kind, parsed.id, tok || undefined);
    }).then(function (h) {
      _state.harvest = h;
      _state.step = 'preview';
      _render();
    }).catch(function (e) {
      _state.step = 'error';
      _state.errorMsg = (e && e.message) || 'Failed to fetch metadata.';
      _render();
    });
  }

  function _onRunModeNext() {
    var runMode = _state.runMode;
    var kind    = _state.kind;
    // Remote model requires a token
    if (runMode === 'remote' && kind === 'model') {
      if (!_state.hfToken) {
        _state.step = 'token_input';
        _render();
        return;
      }
    }
    _startInstall();
  }

  function _onTokenSubmit() {
    var inp = document.getElementById('_etbv2_hf_tok_inp');
    var tok = inp ? inp.value.trim() : '';
    if (!tok) {
      var stEl = document.getElementById('_etbv2_hf_status');
      if (stEl) stEl.textContent = 'Please enter your HF token.';
      return;
    }
    _state.hfToken = tok;
    ETB.api.kvSet('hf_token', tok, 'HuggingFace access token').catch(function () {});
    _startInstall();
  }

  function _onDeviceIdSubmit() {
    var inp = document.getElementById('_etbv2_hf_did_inp');
    var did = inp ? inp.value.trim() : '';
    if (!did) return;
    ETB.api.kvSet('_device_id', did, 'Extella device ID').catch(function () {});
    _runAgentInstall(did);
  }

  function _retry() {
    _state.step = 'runmode';
    _state.errorMsg = '';
    _render();
  }

  function _openPlugin() {
    var pluginId = _state.pluginId;
    ETB.hfAdd.close();
    if (pluginId) {
      try {
        ETB.marketplace.close({ silent: true });
      } catch (_) {}
      try {
        ETB.router.openById(pluginId);
      } catch (_) {}
    }
  }

  // ── Install pipeline ───────────────────────────────────────────
  function _startInstall() {
    _getDeviceId().then(function (deviceId) {
      if (!deviceId) {
        _state.step = 'device_id_input';
        _render();
        return;
      }
      _runAgentInstall(deviceId);
    }).catch(function () {
      _state.step = 'device_id_input';
      _render();
    });
  }

  function _runAgentInstall(deviceId) {
    if (!ETB.installPrompt || !ETB.installPrompt.contextHF) {
      _state.step = 'error';
      _state.errorMsg = 'installPrompt.contextHF not available — rebuild required.';
      _render();
      return;
    }

    var h = _state.harvest || {};
    var ctx = ETB.installPrompt.contextHF(h, _state.runMode, _state.hfToken);
    _state.pluginId = ctx.pluginId;
    _state.deviceId = deviceId;
    // Снять девайсный тумбстоун прошлого удаления (см. github-add) — иначе
    // джанитор синка удалит свежий манифест.
    if (ETB.registry.clearDeviceTombstone) ETB.registry.clearDeviceTombstone(deviceId, ctx.pluginId);
    _state.step = 'installing';
    _state.installStartedAt = Date.now();
    _state.installAgentText = '';
    _installLogLines = [];
    _render();
    _startInstallTicker();

    function finalizeFromRegistry(agentErr, agentNotes) {
      _stopInstallTicker();
      return ETB.registry.syncFromDevice(deviceId, ctx.safeId).then(function () {
        var plugin = ETB.registry.getById(ctx.pluginId);
        if (plugin) {
          _state.step = 'done';
          ETB.tabs.refresh();
          _render();
          return;
        }
        _state.step = 'error';
        _state.errorMsg = agentErr ||
          ('No plugin manifest was written (' + ctx.registryPath + ').' +
            (agentNotes ? ' Agent notes: ' + agentNotes : ''));
        _render();
      }).catch(function (e) {
        _state.step = 'error';
        _state.errorMsg = (e && e.message) || 'Sync failed.';
        _render();
      });
    }

    function runMainInstall(analysis) {
      var prompt = ETB.installPrompt.buildHF(ctx, analysis);
      return ETB.api.runAgentAsync(prompt, {
        run_timeout: 3600,
        maxWait: 3000000,
        interval: 4000,
        stallTimeout: 18 * 60 * 1000,
        onProgress: _makeInstallProgressTracker()
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

    // Phase 1: LLM analysis (like github-add)
    var analysisPrompt = ETB.installPrompt.buildHFAnalysis
      ? ETB.installPrompt.buildHFAnalysis(ctx) : null;

    if (!analysisPrompt) {
      return runMainInstall(null);
    }

    _state.installAgentText = 'Analyzing project';
    return ETB.api.runAgentAsync(analysisPrompt, {
      run_timeout: 180,
      maxWait: 240000,
      interval: 3000,
      onProgress: function (t) { if (t) { _state.installAgentText = 'Analyzing: ' + t.slice(0, 80); } }
    }).then(function (analysisRes) {
      var analysis = null;
      try {
        var txt = ETB.api.extractAgentText(analysisRes);
        var m = txt.match(/\{[\s\S]+\}/);
        if (m) analysis = JSON.parse(m[0]);
      } catch (_) {}
      _state.installAgentText = analysis ? 'Installing' : 'Installing';
      return runMainInstall(analysis);
    }).catch(function () {
      _state.installAgentText = 'Installing';
      return runMainInstall(null);
    });
  }

  return {
    open: function (prefill) {
      if (document.getElementById('_etbv2_hf_ov')) return;
      _ensureStyles();

      var parsed = prefill ? _parseHFPrefill(prefill) : null;
      _state = {
        step: 'input',
        kind: (parsed && parsed.kind) || 'space',
        id: (parsed && parsed.id) || '',
        prefill: prefill || '',
        hfToken: '',
        runMode: 'local',
        harvest: null,
        pluginId: null,
        deviceId: null,
        installAgentText: '',
        installStartedAt: null,
        errorMsg: '',
        statusMsg: ''
      };

      var ov = document.createElement('div');
      ov.id = '_etbv2_hf_ov';

      var modal = document.createElement('div');
      modal.id = '_etbv2_hf_modal';
      ov.appendChild(modal);
      document.body.appendChild(ov);

      ov.addEventListener('click', function (e) {
        if (e.target === ov) ETB.hfAdd.close();
      });

      _render();

      // If prefill is given, immediately start fetching
      if (parsed) {
        setTimeout(function () { _onInputSubmit(); }, 150);
      }
    },

    close: function () {
      _stopInstallTicker();
      var ov = document.getElementById('_etbv2_hf_ov');
      if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
    },

    // Exposed for inline onclick handlers
    _onInputSubmit:   _onInputSubmit,
    _goPreview:       _goPreview,
    _goRunMode:       _goRunMode,
    _selectMode:      _selectMode,
    _onRunModeNext:   _onRunModeNext,
    _onTokenSubmit:   _onTokenSubmit,
    _onDeviceIdSubmit:_onDeviceIdSubmit,
    _retry:           _retry,
    _openPlugin:      _openPlugin
  };

})();
