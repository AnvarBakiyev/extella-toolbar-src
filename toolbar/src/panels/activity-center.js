(function () {
  'use strict';
  if (window.__xtlActivityCenterLoaded) return;
  window.__xtlActivityCenterLoaded = true;

  var API_BASE = 'http://127.0.0.1:8799';
  var API = API_BASE + '/api/activity';
  var SERVICES_API = API_BASE + '/api/services';
  var state = {
    open: false, data: null, bridgeOnline: false, expanded: {},
    activityToken: '', taskBusy: {},
    services: null, servicesToken: '', servicesLoading: false,
    servicesUpdatedAt: 0, serviceBusy: {}, serviceMessage: ''
  };

  var css = [
    '#_xtlac_root{position:fixed;right:12px;bottom:12px;z-index:2147483638;font-family:-apple-system,system-ui,sans-serif;color:var(--etb-tx,#f0f0f0);pointer-events:auto}',
    '#_xtlac_pill{height:34px;display:flex;align-items:center;gap:8px;padding:0 12px;border:1px solid var(--etb-bd2,rgba(255,255,255,.13));border-radius:18px;background:var(--etb-s1,#111);color:var(--etb-tx,#f0f0f0);box-shadow:0 2px 20px rgba(0,0,0,.35);cursor:pointer;font:600 11px/1 -apple-system,system-ui,sans-serif;max-width:330px}',
    '#_xtlac_pill:hover{border-color:rgba(198,126,52,.55)}',
    '#_xtlac_dot{width:8px;height:8px;border-radius:50%;background:#22c55e;box-shadow:0 0 8px rgba(34,197,94,.45);flex:0 0 auto}',
    '#_xtlac_root[data-health="busy"] #_xtlac_dot{background:#c67e34;box-shadow:0 0 8px rgba(198,126,52,.5);animation:_xtlac_pulse 1.2s ease-in-out infinite}',
    '#_xtlac_root[data-health="warning"] #_xtlac_dot{background:#f59e0b;box-shadow:0 0 8px rgba(245,158,11,.5)}',
    '#_xtlac_text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '#_xtlac_count{color:var(--etb-tx2,#888);font-weight:500;white-space:nowrap}',
    '#_xtlac_panel{position:absolute;right:0;bottom:42px;width:410px;max-height:min(660px,calc(100vh - 64px));display:none;flex-direction:column;overflow:hidden;background:var(--etb-s1,#111);border:1px solid var(--etb-bd2,rgba(255,255,255,.13));border-radius:16px;box-shadow:0 18px 60px rgba(0,0,0,.5)}',
    '#_xtlac_panel.open{display:flex;animation:_xtlac_in .16s ease}',
    '#_xtlac_head{display:flex;align-items:flex-start;gap:10px;padding:15px 16px 12px;border-bottom:1px solid var(--etb-bd,rgba(255,255,255,.07))}',
    '#_xtlac_head h3{margin:0;font-size:14px;line-height:1.25}',
    '#_xtlac_clear{display:none;margin-left:auto;border:1px solid var(--etb-bd2,rgba(255,255,255,.13));border-radius:7px;background:transparent;color:var(--etb-tx2,#888);padding:5px 8px;font:600 9.5px/1 -apple-system,system-ui,sans-serif;cursor:pointer}',
    '#_xtlac_clear.show{display:block}',
    '#_xtlac_clear:hover{color:var(--etb-tx,#f0f0f0)}',
    '#_xtlac_close{border:0;background:transparent;color:var(--etb-tx2,#888);font-size:18px;cursor:pointer}',
    '#_xtlac_warning{display:none;margin:10px 12px 0;padding:9px 10px;border-radius:10px;background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.25);color:#f59e0b;font-size:11px;line-height:1.45}',
    '#_xtlac_warning.show{display:block}',
    '#_xtlac_body{overflow:auto;padding:10px 12px 14px;scrollbar-width:thin}',
    '._xtlac_section{margin:2px 2px 7px;color:var(--etb-tx2,#888);font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.08em}',
    '._xtlac_task{display:grid;grid-template-columns:22px 1fr auto;gap:9px;align-items:start;padding:10px;border-radius:11px;border:1px solid transparent;margin-bottom:5px;cursor:pointer;outline:none}',
    '._xtlac_task:hover{background:var(--etb-s3,#1c1c1c);border-color:var(--etb-bd,rgba(255,255,255,.07))}',
    '._xtlac_task:focus-visible{border-color:rgba(198,126,52,.65)}',
    '._xtlac_task.expanded{background:var(--etb-s3,#1c1c1c);border-color:var(--etb-bd2,rgba(255,255,255,.13))}',
    '._xtlac_icon{width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:rgba(34,197,94,.12);color:#22c55e;font-size:11px;font-weight:800}',
    '._xtlac_task.running ._xtlac_icon{background:rgba(198,126,52,.12);color:#c67e34}',
    '._xtlac_task.interrupted ._xtlac_icon{background:rgba(245,158,11,.12);color:#f59e0b}',
    '._xtlac_task.failed ._xtlac_icon{background:rgba(239,68,68,.12);color:#ef4444}',
    '._xtlac_title{font-size:12px;font-weight:650;line-height:1.35}',
    '._xtlac_detail{margin-top:3px;color:var(--etb-tx2,#888);font-size:10.5px;line-height:1.4}',
    '._xtlac_side{display:flex;align-items:center;gap:5px}',
    '._xtlac_badge{padding:3px 6px;border-radius:6px;background:var(--etb-s3,#1c1c1c);color:var(--etb-tx2,#888);font-size:9px;white-space:nowrap}',
    '._xtlac_chev{color:var(--etb-tx2,#888);font-size:10px;transition:transform .15s ease}',
    '._xtlac_task.expanded ._xtlac_chev{transform:rotate(180deg)}',
    '._xtlac_details{display:none;grid-column:2/4;padding:9px 0 2px;border-top:1px solid var(--etb-bd,rgba(255,255,255,.07));margin-top:2px}',
    '._xtlac_task.expanded ._xtlac_details{display:block}',
    '._xtlac_meta{display:grid;grid-template-columns:74px 1fr;gap:5px 8px;font-size:10.5px;line-height:1.45}',
    '._xtlac_meta dt{color:var(--etb-tx2,#888)}',
    '._xtlac_meta dd{margin:0;color:var(--etb-tx,#f0f0f0)}',
    '._xtlac_manage{margin-top:10px;border:1px solid rgba(198,126,52,.45);border-radius:8px;background:rgba(198,126,52,.1);color:#d99a58;padding:7px 10px;font:650 10.5px/1.2 -apple-system,system-ui,sans-serif;cursor:pointer}',
    '._xtlac_manage:hover{background:rgba(198,126,52,.18)}',
    '._xtlac_remove{margin:10px 0 0 7px;border:0;background:transparent;color:var(--etb-tx2,#888);padding:7px 5px;font:600 10px/1.2 -apple-system,system-ui,sans-serif;cursor:pointer}',
    '._xtlac_remove:hover{color:#ef4444}',
    '._xtlac_hint{margin-top:7px;color:var(--etb-tx2,#888);font-size:9.5px;line-height:1.4}',
    '#_xtlac_empty{padding:24px 12px;text-align:center;color:var(--etb-tx2,#888);font-size:11px;line-height:1.5}',
    '@keyframes _xtlac_pulse{50%{opacity:.45;transform:scale(.86)}}',
    '@keyframes _xtlac_in{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:none}}',
    '@media(max-width:860px){#_xtlac_root{right:8px;bottom:8px}#_xtlac_pill{max-width:150px}#_xtlac_text{display:none}#_xtlac_panel{width:min(410px,calc(100vw - 16px))}}'
  ].join('');

  function el(tag, attrs, text) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (key) {
      if (key === 'className') node.className = attrs[key];
      else node.setAttribute(key, attrs[key]);
    });
    if (text != null) node.textContent = text;
    return node;
  }

  function badge(category) {
    if (category === 'background') return 'Фоновая';
    if (category === 'system') return 'Системная';
    return 'Задача';
  }

  function closePanel() {
    state.open = false;
    var panel = document.getElementById('_xtlac_panel');
    var pill = document.getElementById('_xtlac_pill');
    if (panel) panel.classList.remove('open');
    if (pill) pill.setAttribute('aria-expanded', 'false');
  }

  function ensureStorefrontStyles(doc) {
    if (doc.getElementById('_xtlac_storefront_styles')) return;
    var style = doc.createElement('style');
    style.id = '_xtlac_storefront_styles';
    style.textContent = [
      '#_xtlac_schedule_shortcut{position:relative;width:100%;display:flex;align-items:center;gap:14px;margin:12px 0 4px;padding:15px 17px;border:1px solid var(--bd2);border-radius:var(--r);background:linear-gradient(135deg,color-mix(in srgb,var(--a) 10%,var(--s2)),var(--s2));color:var(--tx);text-align:left;cursor:pointer;overflow:hidden;font-family:var(--sans)}',
      '#_xtlac_schedule_shortcut::before{content:"";position:absolute;inset:0 auto 0 0;width:3px;background:var(--a)}',
      '#_xtlac_schedule_shortcut:hover{border-color:var(--a);transform:translateY(-1px)}',
      '._xtlac_desk_icon{width:42px;height:42px;display:flex;align-items:center;justify-content:center;flex:0 0 auto;border-radius:10px;background:rgba(var(--ar),.14);font-size:21px}',
      '._xtlac_desk_copy{min-width:0;flex:1}',
      '._xtlac_desk_title{display:block;font-size:15px;font-weight:750;line-height:1.3}',
      '._xtlac_desk_sub{display:block;margin-top:3px;color:var(--tx2);font-size:12px;line-height:1.4}',
      '._xtlac_desk_count{color:var(--tx3);font:600 10.5px var(--mono);white-space:nowrap}',
      '._xtlac_desk_go{color:var(--a);font-size:12px;font-weight:750;white-space:nowrap}',
      '#_xtlac_local_services{grid-column:1/-1;margin:0 0 14px;padding:16px;border:1px solid var(--bd2);border-radius:var(--r);background:var(--s2)}',
      '._xtlac_srv_head{display:flex;align-items:flex-start;gap:12px;margin-bottom:12px}',
      '._xtlac_srv_head_copy{min-width:0;flex:1}',
      '._xtlac_srv_title{font-size:15px;font-weight:760;color:var(--tx)}',
      '._xtlac_srv_sub{margin-top:3px;color:var(--tx2);font-size:11.5px;line-height:1.45}',
      '._xtlac_srv_summary{color:var(--tx3);font:650 10.5px var(--mono);white-space:nowrap}',
      '._xtlac_srv_message{display:none;margin:0 0 10px;padding:8px 10px;border-radius:8px;background:rgba(var(--ar),.1);color:var(--a);font-size:11px}',
      '._xtlac_srv_message.show{display:block}',
      '._xtlac_srv_grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:8px}',
      '._xtlac_srv_card{display:grid;grid-template-columns:9px minmax(0,1fr) auto;gap:9px;align-items:start;padding:11px;border:1px solid var(--bd);border-radius:10px;background:var(--bg)}',
      '._xtlac_srv_dot{width:8px;height:8px;margin-top:5px;border-radius:50%;background:var(--tx3)}',
      '._xtlac_srv_card.running ._xtlac_srv_dot{background:#2f9e56;box-shadow:0 0 7px rgba(47,158,86,.4)}',
      '._xtlac_srv_name{font-size:12px;font-weight:700;line-height:1.35;color:var(--tx)}',
      '._xtlac_srv_desc{margin-top:3px;color:var(--tx2);font-size:10.5px;line-height:1.35}',
      '._xtlac_srv_meta{display:flex;gap:5px;flex-wrap:wrap;margin-top:7px}',
      '._xtlac_srv_chip{padding:2px 5px;border-radius:5px;background:var(--s3);color:var(--tx3);font:600 9px var(--mono)}',
      '._xtlac_srv_link{display:inline-block;margin-top:7px;color:var(--a);font:600 10px var(--mono);text-decoration:none}',
      '._xtlac_srv_source{margin-top:6px;color:var(--tx3);font-size:9.5px;line-height:1.3}',
      '._xtlac_srv_btn{min-width:78px;border:1px solid var(--bd2);border-radius:7px;background:transparent;color:var(--tx2);padding:6px 8px;font:650 10px var(--sans);cursor:pointer}',
      '._xtlac_srv_btn.stop{border-color:rgba(181,66,62,.38);color:#c96b67}',
      '._xtlac_srv_btn.start{border-color:rgba(47,158,86,.4);color:#57a773}',
      '._xtlac_srv_btn:disabled{opacity:.45;cursor:default}',
      '._xtlac_srv_blocked{grid-column:2/4;margin-top:1px;color:#c67e34;font-size:9.5px;line-height:1.35}',
      '@media(max-width:680px){._xtlac_srv_grid{grid-template-columns:1fr}}'
    ].join('');
    doc.head.appendChild(style);
  }

  function injectScheduleShortcut(store) {
    if (!store || store.cur !== 'desktop' || !store.document) return;
    var doc = store.document;
    var wrap = doc.querySelector('.dt_wrap');
    var heroes = wrap ? wrap.querySelectorAll('.dt_hero') : null;
    var hero = heroes && heroes.length ? heroes[heroes.length - 1] : null;  // после ПОСЛЕДНЕГО героя: пара баннеров не разрывается
    if (!wrap || !hero) return;

    var packs = Array.isArray(store._autoReg) ? store._autoReg : [];
    var en = false;
    try { en = doc.defaultView.localStorage.getItem('etb_lang') === 'en'; } catch (e) {}
    var countText = packs.length
      ? (en ? packs.length + (packs.length === 1 ? ' process' : ' processes')
            : packs.length + ' ' + (packs.length === 1 ? 'процесс' : (packs.length < 5 ? 'процесса' : 'процессов')))
      : (en ? 'schedules, runs and settings' : 'расписания, запуски и настройки');
    var card = doc.getElementById('_xtlac_schedule_shortcut');
    if (card) {
      var count = card.querySelector('._xtlac_desk_count');
      if (count) count.textContent = countText;
      return;
    }

    ensureStorefrontStyles(doc);

    card = doc.createElement('button');
    card.id = '_xtlac_schedule_shortcut';
    card.type = 'button';
    card.innerHTML =
      '<span class="_xtlac_desk_icon">◷</span>' +
      '<span class="_xtlac_desk_copy">' +
        '<span class="_xtlac_desk_title">' + (en ? 'Recurring tasks' : 'Регулярные задачи') + '</span>' +
        '<span class="_xtlac_desk_sub">' + (en ? 'Schedules, recent runs and automation management.' : 'Расписания, последние запуски и управление автоматизациями.') + '</span>' +
      '</span>' +
      '<span class="_xtlac_desk_count"></span>' +
      '<span class="_xtlac_desk_go">' + (en ? 'Open →' : 'Открыть →') + '</span>';
    card.querySelector('._xtlac_desk_count').textContent = countText;
    card.addEventListener('click', function () {
      if (typeof store.setc === 'function') store.setc('automations');
    });
    hero.insertAdjacentElement('afterend', card);
  }

  function storefrontNode(doc, tag, className, text) {
    var node = doc.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function serviceCountText(services) {
    var total = services.length;
    var running = services.filter(function (service) { return service.status === 'running'; }).length;
    return running + ' из ' + total + ' работают';
  }

  function renderLocalServices(store) {
    if (!store || store.cur !== 'automations' || !store.document) return;
    var doc = store.document;
    var section = doc.getElementById('_xtlac_local_services');
    if (!section) return;
    section.replaceChildren();

    var head = storefrontNode(doc, 'div', '_xtlac_srv_head');
    var copy = storefrontNode(doc, 'div', '_xtlac_srv_head_copy');
    copy.appendChild(storefrontNode(doc, 'div', '_xtlac_srv_title', 'Локальные сервисы Extella'));
    copy.appendChild(storefrontNode(doc, 'div', '_xtlac_srv_sub', 'Поднятые localhost-сервисы, их PID и источник запуска. Здесь их можно безопасно выключить или включить.'));
    head.appendChild(copy);
    var summary = state.services
      ? serviceCountText(state.services)
      : (state.servicesLoading ? 'проверяю…' : 'нет данных');
    head.appendChild(storefrontNode(doc, 'div', '_xtlac_srv_summary', summary));
    section.appendChild(head);

    var message = storefrontNode(doc, 'div', '_xtlac_srv_message' + (state.serviceMessage ? ' show' : ''), state.serviceMessage);
    section.appendChild(message);
    if (!state.services) {
      section.appendChild(storefrontNode(doc, 'div', '_xtlac_srv_sub', state.servicesLoading ? 'Читаю реестр и проверяю локальные порты…' : 'Локальный bridge пока не ответил.'));
      return;
    }

    var grid = storefrontNode(doc, 'div', '_xtlac_srv_grid');
    state.services.forEach(function (service) {
      var running = service.status === 'running';
      var busy = !!state.serviceBusy[service.id];
      var card = storefrontNode(doc, 'div', '_xtlac_srv_card ' + service.status);
      card.appendChild(storefrontNode(doc, 'span', '_xtlac_srv_dot'));
      var info = storefrontNode(doc, 'div', '_xtlac_srv_info');
      info.appendChild(storefrontNode(doc, 'div', '_xtlac_srv_name', service.name));
      if (service.description) info.appendChild(storefrontNode(doc, 'div', '_xtlac_srv_desc', service.description));
      var meta = storefrontNode(doc, 'div', '_xtlac_srv_meta');
      meta.appendChild(storefrontNode(doc, 'span', '_xtlac_srv_chip', 'PORT ' + service.port));
      if (service.processes && service.processes.length) {
        service.processes.forEach(function (process) {
          meta.appendChild(storefrontNode(doc, 'span', '_xtlac_srv_chip', 'PID ' + process.pid + ' · ' + process.process));
        });
      } else {
        meta.appendChild(storefrontNode(doc, 'span', '_xtlac_srv_chip', 'PID —'));
      }
      info.appendChild(meta);
      if (running) {
        var link = storefrontNode(doc, 'a', '_xtlac_srv_link', service.url.replace(/^https?:\/\//, ''));
        link.href = service.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        info.appendChild(link);
      }
      info.appendChild(storefrontNode(doc, 'div', '_xtlac_srv_source', service.source + (service.project ? ' · ' + service.project : '')));
      card.appendChild(info);

      var action = running ? 'stop' : 'start';
      var allowed = running ? service.canStop : service.canStart;
      var button = storefrontNode(doc, 'button', '_xtlac_srv_btn ' + action, busy ? 'Подождите…' : (running ? 'Выключить' : 'Включить'));
      button.type = 'button';
      button.disabled = busy || !allowed;
      button.addEventListener('click', function () { controlLocalService(store, service, action); });
      card.appendChild(button);
      if (service.controlBlockedReason) {
        card.appendChild(storefrontNode(doc, 'div', '_xtlac_srv_blocked', service.controlBlockedReason));
      }
      grid.appendChild(card);
    });
    section.appendChild(grid);
    try { renderSystemAgents(section, doc); } catch (e) {}
  }

  function renderSystemAgents(section, doc) {
    // Системные агенты устройства (мост визарда /x/launchagents) + чистка сирот листенера.
    var wrap = storefrontNode(doc, 'div', '_xtlac_srv_sysagents');
    wrap.style.marginTop = '18px';
    var head = storefrontNode(doc, 'div', '_xtlac_srv_head');
    var copy = storefrontNode(doc, 'div', '_xtlac_srv_head_copy');
    copy.appendChild(storefrontNode(doc, 'div', '_xtlac_srv_title', 'Системные агенты (LaunchAgents)'));
    copy.appendChild(storefrontNode(doc, 'div', '_xtlac_srv_sub', 'Автозапускаемые фоновые агенты этого Мака. Семейство Dronor — не Extella: его активность может выглядеть как наша.'));
    head.appendChild(copy);
    wrap.appendChild(head);
    var body = storefrontNode(doc, 'div', '_xtlac_srv_sysagents_body', 'проверяю…');
    wrap.appendChild(body);
    section.appendChild(wrap);
    function bridgePost(url, payload) {
      return fetch('http://127.0.0.1:8765' + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload || {}) }).then(function (r) { return r.json(); });
    }
    fetch('http://127.0.0.1:8765/x/listener_procs').then(function (r) { return r.json(); }).then(function (lp) {
      if (!lp || !lp.orphans) return;
      var warn = doc.createElement('div');
      warn.style.cssText = 'margin:8px 0;padding:8px 12px;border:1px solid #C0392B;border-radius:8px;font-size:12.5px;display:flex;align-items:center;gap:10px';
      warn.appendChild(doc.createTextNode('Лишние процессы listener: ' + lp.orphans + ' — забирают фоновые задачи параллельно.'));
      var cbtn = doc.createElement('button');
      cbtn.type = 'button';
      cbtn.textContent = 'Закрыть лишние';
      cbtn.addEventListener('click', function () {
        cbtn.disabled = true;
        bridgePost('/x/listener_cleanup').then(function (res) { warn.textContent = (res && res.message) || 'готово'; });
      });
      warn.appendChild(cbtn);
      wrap.insertBefore(warn, body);
    }).catch(function () {});
    fetch('http://127.0.0.1:8765/x/launchagents').then(function (r) { return r.json(); }).then(function (d) {
      var agents = (d && d.agents) || [];
      body.textContent = '';
      if (!agents.length) { body.textContent = 'агентов не найдено'; return; }
      var famTitle = { extella: 'Extella', dronor: 'Dronor / personal AGI (не Extella)', other: 'Прочие' };
      ['extella', 'dronor', 'other'].forEach(function (fam) {
        var list = agents.filter(function (a) { return a.family === fam; });
        if (!list.length) return;
        var h = doc.createElement('div');
        h.style.cssText = 'font-weight:700;font-size:12.5px;margin:10px 0 4px;opacity:.85';
        h.textContent = famTitle[fam] + ' · ' + list.length;
        body.appendChild(h);
        list.forEach(function (a) {
          var row = doc.createElement('div');
          row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:5px 0;border-bottom:1px dashed rgba(128,128,128,.25);font-size:12.5px';
          var dot = a.running ? '\u{1F7E2}' : (a.enabled ? '⚪' : '⛔');
          row.appendChild(doc.createTextNode(dot + ' ' + a.label + (a.pid ? ' · pid ' + a.pid : '') + (a.enabled ? '' : ' · автозапуск выключен')));
          var b = doc.createElement('button');
          b.type = 'button';
          b.style.marginLeft = 'auto';
          var off = a.running || a.enabled;
          b.textContent = off ? 'Выключить' : 'Включить';
          b.addEventListener('click', function () {
            if (b.getAttribute('data-arm') !== '1') { b.setAttribute('data-arm', '1'); b.textContent = off ? 'Точно выключить?' : 'Точно включить?'; return; }
            b.disabled = true;
            bridgePost('/x/launchagent_action', { label: a.label, action: off ? 'disable' : 'enable' }).then(function (res) {
              b.textContent = (res && res.status === 'success') ? (off ? 'выключен ✓' : 'включён ✓') : 'ошибка';
            });
          });
          row.appendChild(b);
          body.appendChild(row);
        });
      });
    }).catch(function () { body.textContent = 'мост визарда недоступен (localhost:8765)'; });
  }

  function injectLocalServices(store) {
    if (!store || store.cur !== 'automations' || !store.document) return;
    var doc = store.document;
    var grid = doc.getElementById('grid');
    if (!grid) return;
    ensureStorefrontStyles(doc);
    var section = doc.getElementById('_xtlac_local_services');
    if (!section) {
      section = doc.createElement('section');
      section.id = '_xtlac_local_services';
      grid.insertBefore(section, grid.firstChild);
    }
    renderLocalServices(store);
    refreshServices(store, false);
  }

  function refreshServices(store, force) {
    if (!store || store.cur !== 'automations') return Promise.resolve();
    if (state.servicesLoading) return Promise.resolve();
    if (!force && state.services && Date.now() - state.servicesUpdatedAt < 3500) return Promise.resolve();
    state.servicesLoading = true;
    renderLocalServices(store);
    return fetch(SERVICES_API, { cache: 'no-store' })
      .then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json();
      })
      .then(function (payload) {
        state.services = Array.isArray(payload.services) ? payload.services : [];
        state.servicesToken = payload.controlToken || '';
        state.servicesUpdatedAt = Date.now();
        if (state.serviceMessage === 'Локальный список сервисов недоступен.') state.serviceMessage = '';
      })
      .catch(function () {
        state.serviceMessage = 'Локальный список сервисов недоступен.';
      })
      .then(function () {
        state.servicesLoading = false;
        renderLocalServices(store);
      });
  }

  function controlLocalService(store, service, action) {
    if (state.serviceBusy[service.id]) return;
    if (!state.servicesToken) {
      refreshServices(store, true).then(function () {
        if (state.servicesToken) controlLocalService(store, service, action);
        else {
          state.serviceMessage = 'Управление недоступно: локальный bridge не выдал разрешение.';
          renderLocalServices(store);
        }
      });
      return;
    }
    state.serviceBusy[service.id] = true;
    state.serviceMessage = (action === 'stop' ? 'Выключаю: ' : 'Включаю: ') + service.name;
    renderLocalServices(store);
    fetch(SERVICES_API + '/' + encodeURIComponent(service.id) + '/' + action, {
      method: 'POST',
      headers: { 'X-Extella-Control': state.servicesToken }
    })
      .then(function (response) {
        return response.json().then(function (payload) {
          if (!response.ok) throw new Error(payload.message || ('HTTP ' + response.status));
          return payload;
        });
      })
      .then(function () {
        state.serviceMessage = (action === 'stop' ? 'Выключено: ' : 'Включено: ') + service.name;
      })
      .catch(function (error) {
        state.serviceMessage = 'Не удалось изменить состояние: ' + (error.message || 'неизвестная ошибка');
      })
      .then(function () {
        delete state.serviceBusy[service.id];
        state.servicesUpdatedAt = 0;
        return refreshServices(store, true);
      });
  }

  function refreshVisibleServices() {
    try {
      var frame = document.getElementById('_etbv2_mkt_frame');
      var store = frame && frame.contentWindow;
      if (!store || store.cur !== 'automations') return;
      injectLocalServices(store);
    } catch (e) {}
  }

  function enhanceStorefront(frame) {
    try {
      var store = frame && frame.contentWindow;
      if (!store || !store.document || !store.document.getElementById('tabs')) return;

      var changed = false;
      if (Array.isArray(store.CATS)) {
        var schedules = store.CATS.filter(function (category) { return category.id === 'automations'; })[0];
        if (!schedules) {
          var beforeAgents = store.CATS.findIndex(function (category) { return category.id === 'agents'; });
          var entry = { id: 'automations', l: 'Расписания' };
          if (beforeAgents >= 0) store.CATS.splice(beforeAgents, 0, entry);
          else store.CATS.push(entry);
          changed = true;
        } else if (schedules.l !== 'Расписания') {
          schedules.l = 'Расписания';
          changed = true;
        }
      }
      if (store.I18N_EN) store.I18N_EN['Расписания'] = 'Schedules';
      if (changed && typeof store.rtabs === 'function') store.rtabs();

      if (!store.__xtlacDesktopObserver) {
        var grid = store.document.getElementById('grid');
        if (grid && store.MutationObserver) {
          store.__xtlacDesktopObserver = new store.MutationObserver(function () {
            injectScheduleShortcut(store);
            injectLocalServices(store);
          });
          store.__xtlacDesktopObserver.observe(grid, { childList: true });
        }
      }
      injectScheduleShortcut(store);
      injectLocalServices(store);
    } catch (e) {}
  }

  function enhanceMarketplace() {
    var frame = document.getElementById('_etbv2_mkt_frame');
    if (!frame) return;
    if (!frame.__xtlacEnhancementHook) {
      frame.__xtlacEnhancementHook = true;
      frame.addEventListener('load', function () {
        setTimeout(function () { enhanceStorefront(frame); }, 50);
      });
    }
    enhanceStorefront(frame);
  }

  function enterAutomations(task) {
    var sourceId = task.sourceIds && task.sourceIds[0];
    closePanel();
    try {
      if (window.ETB && ETB.nav && typeof ETB.nav.set === 'function') ETB.nav.set('plugins');
      else if (window.ETB && ETB.marketplace) ETB.marketplace.open();
    } catch (e) {}

    var attempts = 0;
    function enterStorefront() {
      attempts += 1;
      var frame = document.getElementById('_etbv2_mkt_frame');
      try {
        var store = frame && frame.contentWindow;
        if (!store || typeof store.renderGrid !== 'function') throw new Error('storefront-loading');
        enhanceStorefront(frame);
        store.cur = 'automations';
        store._autoReg = null;
        store._autoFetched = false;
        store.renderGrid();
        if (typeof store.rtabs === 'function') store.rtabs();

        if (!sourceId) return;
        var cabinetAttempts = 0;
        (function openSchedule() {
          cabinetAttempts += 1;
          var packs = store._autoReg;
          if (!Array.isArray(packs)) {
            if (cabinetAttempts < 30) setTimeout(openSchedule, 100);
            return;
          }
          var pack = packs.filter(function (item) {
            return item && (item.sessionId === sourceId || item.id === sourceId || item.orchestrator === sourceId);
          })[0];
          if (!pack || typeof store.openAgentCabinet !== 'function') return;
          var id = typeof store._agId === 'function' ? store._agId(pack) : (pack.id || pack.orchestrator);
          store.openAgentCabinet(id);
          if (typeof store.cabTab === 'function') store.cabTab('schedule');
        })();
      } catch (e) {
        if (attempts < 30) setTimeout(enterStorefront, 100);
      }
    }
    enterStorefront();
  }

  function metaRow(list, label, value) {
    if (!value) return;
    list.appendChild(el('dt', {}, label));
    list.appendChild(el('dd', {}, value));
  }

  function taskAction(path) {
    if (!state.activityToken) return Promise.reject(new Error('Нет разрешения локального журнала'));
    return fetch(API_BASE + path, {
      method: 'POST',
      headers: { 'X-Extella-Control': state.activityToken }
    }).then(function (response) {
      return response.json().then(function (payload) {
        if (!response.ok) throw new Error(payload.message || ('HTTP ' + response.status));
        return payload;
      });
    });
  }

  function dismissTask(task) {
    if (state.taskBusy[task.id]) return;
    state.taskBusy[task.id] = true;
    taskAction('/api/tasks/' + encodeURIComponent(task.id) + '/dismiss')
      .then(function () { delete state.expanded[task.id]; return refresh(); })
      .catch(function () { render(); })
      .then(function () { delete state.taskBusy[task.id]; });
  }

  function clearCompletedTasks() {
    if (!state.data || !state.data.history || !state.data.history.length) return;
    if (!window.confirm('Убрать все завершённые записи из этой ленты?')) return;
    taskAction('/api/tasks/clear-completed')
      .then(function () { return refresh(); })
      .catch(function () {});
  }

  function taskNode(task) {
    var expanded = !!state.expanded[task.id];
    var row = el('div', {
      className: '_xtlac_task ' + task.status + (expanded ? ' expanded' : ''),
      role: 'button', tabindex: '0', 'aria-expanded': expanded ? 'true' : 'false'
    });
    row.appendChild(el('div', { className: '_xtlac_icon' }, task.status === 'running' ? '…' : (task.status === 'failed' ? '!' : (task.status === 'interrupted' ? '↻' : '✓'))));
    var info = el('div');
    info.appendChild(el('div', { className: '_xtlac_title' }, task.title));
    info.appendChild(el('div', { className: '_xtlac_detail' }, task.detail));
    row.appendChild(info);
    var side = el('div', { className: '_xtlac_side' });
    side.appendChild(el('div', { className: '_xtlac_badge' }, badge(task.category)));
    side.appendChild(el('span', { className: '_xtlac_chev', 'aria-hidden': 'true' }, '⌄'));
    row.appendChild(side);

    var details = el('div', { className: '_xtlac_details' });
    var meta = el('dl', { className: '_xtlac_meta' });
    metaRow(meta, 'Источник', task.origin);
    metaRow(meta, 'Для чего', task.purpose);
    metaRow(meta, 'Режим', task.mode);
    if (task.sourceIds && task.sourceIds.length) metaRow(meta, 'ID запуска', task.sourceIds[0]);
    details.appendChild(meta);
    if (task.manageTarget === 'automations') {
      var manage = el('button', { className: '_xtlac_manage', type: 'button' }, task.manageLabel || 'Открыть AI Автоматизации');
      manage.addEventListener('click', function (event) {
        event.stopPropagation();
        enterAutomations(task);
      });
      details.appendChild(manage);
      details.appendChild(el('div', { className: '_xtlac_hint' }, sourceIdHint(task)));
    }
    if (task.status === 'running') {
      details.appendChild(el('div', { className: '_xtlac_hint' }, 'Если задача действительно выполняется и её нужно прервать, используйте красную кнопку Cancel в нижней панели Extella.'));
    } else {
      var remove = el('button', { className: '_xtlac_remove', type: 'button' }, state.taskBusy[task.id] ? 'Убираю…' : 'Убрать запись из ленты');
      remove.disabled = !!state.taskBusy[task.id];
      remove.addEventListener('click', function (event) {
        event.stopPropagation();
        dismissTask(task);
      });
      details.appendChild(remove);
    }
    row.appendChild(details);

    function toggle() {
      state.expanded[task.id] = !state.expanded[task.id];
      row.classList.toggle('expanded', state.expanded[task.id]);
      row.setAttribute('aria-expanded', state.expanded[task.id] ? 'true' : 'false');
    }
    row.addEventListener('click', toggle);
    row.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggle();
      }
    });
    return row;
  }

  function sourceIdHint(task) {
    if (task.sourceIds && task.sourceIds.length) {
      return 'Откроется кабинет связанного процесса. На вкладке «Расписание» можно выбрать «вручную (без расписания)».';
    }
    return 'Откроется список процессов. В кабинете нужной автоматизации можно снять расписание.';
  }

  function section(body, title, tasks) {
    if (!tasks || !tasks.length) return;
    body.appendChild(el('div', { className: '_xtlac_section' }, title));
    tasks.forEach(function (task) { body.appendChild(taskNode(task)); });
  }

  function render() {
    var data = state.data;
    var root = document.getElementById('_xtlac_root');
    if (!root) return;
    var health = data ? data.health : (state.bridgeOnline ? 'ok' : 'warning');
    root.setAttribute('data-health', health);
    document.getElementById('_xtlac_text').textContent = data ? data.headline : 'Подключение журнала…';
    document.getElementById('_xtlac_count').textContent = data ? ('✓ ' + data.counts.completed) : '';
    var clear = document.getElementById('_xtlac_clear');
    if (clear) clear.classList.toggle('show', !!(data && data.history && data.history.length));

    var warning = document.getElementById('_xtlac_warning');
    var orphaned = data && data.listeners && data.listeners.orphaned || 0;
    if (!state.bridgeOnline) {
      warning.textContent = 'Локальный журнал недоступен. Перезапустите Extella Activity Center.';
      warning.classList.add('show');
    } else if (orphaned) {
      // Задание Анвара: не только предупреждать, но и чинить в один клик —
      // POST /x/listener_cleanup закрывает только сирот, ответ показываем тут же.
      warning.replaceChildren(
        el('span', {}, 'Обнаружено лишних процессов listener: ' + orphaned + '. Они могут забирать фоновые задачи параллельно. '),
        (function () {
          var btn = el('button', { id: '_xtlac_fix', className: '_xtlac_fixbtn', type: 'button' }, 'Закрыть лишние');
          btn.addEventListener('click', cleanupListeners);
          return btn;
        })()
      );
      warning.classList.add('show');
    } else {
      warning.classList.remove('show');
    }

    var body = document.getElementById('_xtlac_body');
    body.replaceChildren();
    if (!data) {
      body.appendChild(el('div', { id: '_xtlac_empty' }, 'Жду первые события Extella.'));
      return;
    }
    section(body, 'Сейчас', data.active);
    section(body, 'Выполнено', data.history.slice(0, 15));
    if (!data.active.length && !data.history.length) {
      body.appendChild(el('div', { id: '_xtlac_empty' }, 'Пока задач нет. Фоновые проверки и действия появятся здесь автоматически.'));
    }
  }

  function mount() {
    if (!document.body || document.getElementById('_xtlac_root')) return;
    css += '._xtlac_fixbtn{margin-left:8px;border:1px solid var(--etb-bd2,rgba(0,0,0,.15));background:transparent;color:inherit;border-radius:5px;padding:2px 10px;font-size:11.5px;cursor:pointer}._xtlac_fixbtn:disabled{opacity:.6;cursor:default}';
    var style = el('style', { id: '_xtlac_styles' });
    style.textContent = css;
    document.head.appendChild(style);

    var root = el('div', { id: '_xtlac_root', 'data-health': 'warning' });
    var pill = el('button', { id: '_xtlac_pill', type: 'button', 'aria-label': 'Открыть журнал действий Extella' });
    pill.appendChild(el('span', { id: '_xtlac_dot' }));
    pill.appendChild(el('span', { id: '_xtlac_text' }, 'Подключение журнала…'));
    pill.appendChild(el('span', { id: '_xtlac_count' }));
    root.appendChild(pill);

    var panel = el('div', { id: '_xtlac_panel' });
    var head = el('div', { id: '_xtlac_head' });
    var heading = el('div');
    heading.appendChild(el('h3', {}, 'Что делает Extella'));
    head.appendChild(heading);
    head.appendChild(el('button', { id: '_xtlac_clear', type: 'button' }, 'Очистить выполненные'));
    head.appendChild(el('button', { id: '_xtlac_close', type: 'button', 'aria-label': 'Закрыть' }, '×'));
    panel.appendChild(head);
    panel.appendChild(el('div', { id: '_xtlac_warning' }));
    panel.appendChild(el('div', { id: '_xtlac_body' }));
    root.appendChild(panel);
    document.body.appendChild(root);

    function setOpen(open) {
      state.open = open;
      panel.classList.toggle('open', open);
      pill.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    pill.addEventListener('click', function () { setOpen(!state.open); });
    document.getElementById('_xtlac_close').addEventListener('click', closePanel);
    document.getElementById('_xtlac_clear').addEventListener('click', clearCompletedTasks);
    document.addEventListener('keydown', function (event) { if (event.key === 'Escape') closePanel(); });
    var marketplaceObserver = new MutationObserver(function () { enhanceMarketplace(); });
    marketplaceObserver.observe(document.body, { childList: true, subtree: true });
    enhanceMarketplace();
    render();
  }

  function fallbackStatus() {
    try {
      if (!window.extellaDesktop || !window.extellaDesktop.listener) return Promise.resolve(null);
      return window.extellaDesktop.listener.getStatus().then(function (status) {
        if (!status) return null;
        var active = status.isBusy ? [{
          id: status.currentTaskId || 'unknown', shortId: String(status.currentTaskId || '').slice(0, 8),
          status: 'running', title: 'Extella выполняет задачу',
          detail: 'Подробное название появится после подключения локального журнала.', category: 'action'
        }] : [];
        return {
          health: active.length ? 'busy' : 'warning',
          headline: active.length ? active[0].title : 'Журнал требует перезапуска',
          active: active, history: [],
          counts: { active: active.length, completed: status.tasksCompleted || 0, failed: status.tasksFailed || 0 },
          listeners: { count: status.running ? 1 : 0, orphaned: 0 }
        };
      }).catch(function () { return null; });
    } catch (e) { return Promise.resolve(null); }
  }

  function cleanupListeners() {
    var btn = document.getElementById('_xtlac_fix');
    if (btn) { btn.disabled = true; btn.textContent = 'Закрываю…'; }
    var w = document.getElementById('_xtlac_warning');
    fetch(API_BASE + '/x/listener_cleanup', { method: 'POST' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var killed = d && (d.killed != null ? d.killed : (Array.isArray(d.pids) ? d.pids.length : d.count));
        if (w) w.textContent = killed ? ('Закрыто лишних: ' + killed + '.') : 'Сирот нет.';
        setTimeout(refresh, 1200);
      })
      .catch(function () {
        if (w) w.textContent = 'Не удалось закрыть: мост недоступен.';
        if (btn) { btn.disabled = false; btn.textContent = 'Закрыть лишние'; }
      });
  }

  function refresh() {
    return fetch(API, { cache: 'no-store' })
      .then(function (response) { if (!response.ok) throw new Error('HTTP ' + response.status); return response.json(); })
      .then(function (data) { state.bridgeOnline = true; state.data = data; state.activityToken = data.controlToken || ''; render(); })
      .catch(function () {
        state.bridgeOnline = false;
        fallbackStatus().then(function (data) { if (data) state.data = data; render(); });
      });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
  refresh();
  window.__xtlActivityCenterTimer = setInterval(refresh, 2000);
  window.__xtlServiceCenterTimer = setInterval(refreshVisibleServices, 5000);
})();
