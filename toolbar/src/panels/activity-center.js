(function () {
  'use strict';
  if (window.__xtlActivityCenterLoaded) return;
  window.__xtlActivityCenterLoaded = true;

  // Язык панели = язык витрины (общий localStorage); живо при каждом рендере
  function T(ru, en) { try { return localStorage.getItem('etb_lang') === 'en' ? en : ru; } catch (e) { return ru; } }
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
    '#_xtlac_pill{height:34px;display:flex;align-items:center;gap:8px;padding:0 12px;border:1px solid var(--etb-bd2,rgba(255,255,255,.13));border-radius:8px;background:var(--etb-s1,#111);color:var(--etb-tx,#f0f0f0);box-shadow:0 2px 20px rgba(0,0,0,.35);cursor:pointer;font:600 11px/1 -apple-system,system-ui,sans-serif;max-width:330px}',
    '#_xtlac_pill:hover{border-color:rgba(198,126,52,.55)}',
    // Ручка перетаскивания: видимая аффорданса + курсор говорят «меня можно двигать»
    '#_xtlac_grip{color:var(--etb-tx2,#888);font-size:10px;letter-spacing:1px;cursor:grab;user-select:none;margin-right:2px;flex:0 0 auto}',
    '#_xtlac_pill:hover #_xtlac_grip{color:var(--etb-tx,#f0f0f0)}',
    '#_xtlac_root.dragging #_xtlac_pill{cursor:grabbing}',
    '#_xtlac_root.dragging #_xtlac_grip{cursor:grabbing}',
    '#_xtlac_dot{width:8px;height:8px;border-radius:50%;background:#22c55e;box-shadow:0 0 8px rgba(34,197,94,.45);flex:0 0 auto}',
    '#_xtlac_root[data-health="busy"] #_xtlac_dot{background:#c67e34;box-shadow:0 0 8px rgba(198,126,52,.5);animation:_xtlac_pulse 1.2s ease-in-out infinite}',
    '#_xtlac_root[data-health="warning"] #_xtlac_dot{background:#f59e0b;box-shadow:0 0 8px rgba(245,158,11,.5)}',
    '#_xtlac_text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '#_xtlac_count{color:var(--etb-tx2,#888);font-weight:500;white-space:nowrap}',
    '#_xtlac_panel{position:absolute;right:0;bottom:42px;width:410px;max-height:min(660px,calc(100vh - 64px));display:none;flex-direction:column;overflow:hidden;background:var(--etb-s1,#111);border:1px solid var(--etb-bd2,rgba(255,255,255,.13));border-radius:8px;box-shadow:0 18px 60px rgba(0,0,0,.5)}',
    '#_xtlac_panel.open{display:flex;animation:_xtlac_in .16s ease}',
    '#_xtlac_head{display:flex;align-items:flex-start;gap:10px;padding:15px 16px 12px;border-bottom:1px solid var(--etb-bd,rgba(255,255,255,.07))}',
    '#_xtlac_head h3{margin:0;font-size:14px;line-height:1.25}',
    '#_xtlac_clear{display:none;margin-left:auto;border:1px solid var(--etb-bd2,rgba(255,255,255,.13));border-radius:7px;background:transparent;color:var(--etb-tx2,#888);padding:5px 8px;font:600 9.5px/1 -apple-system,system-ui,sans-serif;cursor:pointer}',
    '#_xtlac_clear.show{display:block}',
    '#_xtlac_clear:hover{color:var(--etb-tx,#f0f0f0)}',
    '#_xtlac_head{display:flex;align-items:center;gap:10px}',
    '#_xtlac_head>div:first-child{margin-right:auto}',
    '#_xtlac_close{border:0;background:transparent;color:var(--etb-tx2,#888);font-size:17px;line-height:1;cursor:pointer;padding:6px 9px;border-radius:5px}',
    '#_xtlac_close:hover{background:rgba(0,0,0,.06);color:var(--etb-tx,#222)}',
    '#_xtlac_warning{display:none;margin:10px 12px 0;padding:9px 10px;border-radius:6px;background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.25);color:#f59e0b;font-size:11px;line-height:1.45}',
    '#_xtlac_warning.show{display:block}',
    '#_xtlac_body{overflow:auto;padding:10px 12px 14px;scrollbar-width:thin}',
    '._xtlac_section{margin:2px 2px 7px;color:var(--etb-tx2,#888);font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.08em}',
    '._xtlac_task{display:grid;grid-template-columns:22px 1fr auto;gap:9px;align-items:start;padding:10px;border-radius:6px;border:1px solid transparent;margin-bottom:5px;cursor:pointer;outline:none}',
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
    if (category === 'background') return T('Фоновая','Background');
    if (category === 'system') return T('Системная','System');
    return T('Задача','Task');
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
      '._xtlac_desk_icon{width:42px;height:42px;display:flex;align-items:center;justify-content:center;flex:0 0 auto;border-radius:6px;background:rgba(var(--ar),.14);font-size:21px}',
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
      '._xtlac_srv_card{display:grid;grid-template-columns:9px minmax(0,1fr) auto;gap:9px;align-items:start;padding:11px;border:1px solid var(--bd);border-radius:6px;background:var(--bg)}',
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
      '._xtlac_srv_btn.restart{border-color:rgba(var(--ar),.4);color:var(--a)}',
      '._xtlac_srv_btn:disabled{opacity:.45;cursor:default}',
      '._xtlac_srv_actions{display:flex;flex-direction:column;gap:6px}',
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
    var pair = hero.closest('.dt_hero_pair');
    (pair || hero).insertAdjacentElement('afterend', card);
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
    return running + T(' из ',' of ') + total + T(' работают',' running');
  }

  function renderLocalServices(store) {
    if (!store || store.cur !== 'automations' || !store.document) return;
    var doc = store.document;
    var section = doc.getElementById('_xtlac_local_services');
    if (!section) return;
    section.replaceChildren();

    var head = storefrontNode(doc, 'div', '_xtlac_srv_head');
    var copy = storefrontNode(doc, 'div', '_xtlac_srv_head_copy');
    copy.appendChild(storefrontNode(doc, 'div', '_xtlac_srv_title', T('Что работает в фоне','Running in the background')));
    copy.appendChild(storefrontNode(doc, 'div', '_xtlac_srv_sub', T('Программы Extella, запущенные на этом компьютере. Любую можно выключить и включить обратно — ничего не сломается.','Extella programs running on this computer. Switch any off and back on — nothing will break.')));
    head.appendChild(copy);
    var summary = state.services
      ? serviceCountText(state.services)
      : (state.servicesLoading ? T('проверяю…','checking…') : T('нет данных','no data'));
    head.appendChild(storefrontNode(doc, 'div', '_xtlac_srv_summary', summary));
    section.appendChild(head);

    var message = storefrontNode(doc, 'div', '_xtlac_srv_message' + (state.serviceMessage ? ' show' : ''), state.serviceMessage);
    section.appendChild(message);
    if (!state.services) {
      if (state.servicesLoading) {
        section.appendChild(storefrontNode(doc, 'div', '_xtlac_srv_sub', T('Проверяю, что сейчас запущено…','Checking what is running…')));
      } else if (!state.serviceMessage) {
        section.appendChild(storefrontNode(doc, 'div', '_xtlac_srv_sub', T('Список фоновых программ пока недоступен.','The background program list is currently unavailable.')));
      }
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

      var actions = storefrontNode(doc, 'div', '_xtlac_srv_actions');
      if (running) {
        var restart = storefrontNode(doc, 'button', '_xtlac_srv_btn restart', busy ? T('Подождите…','Please wait…') : T('Перезапустить','Restart'));
        restart.type = 'button';
        restart.disabled = busy || !service.canRestart;
        restart.addEventListener('click', function () { controlLocalService(store, service, 'restart'); });
        actions.appendChild(restart);
      }
      var action = running ? 'stop' : 'start';
      var allowed = running ? service.canStop : service.canStart;
      var button = storefrontNode(doc, 'button', '_xtlac_srv_btn ' + action, busy ? T('Подождите…','Please wait…') : (running ? T('Выключить','Switch off') : T('Включить','Switch on')));
      button.type = 'button';
      button.disabled = busy || !allowed;
      button.addEventListener('click', function () { controlLocalService(store, service, action); });
      actions.appendChild(button);
      card.appendChild(actions);
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
    copy.appendChild(storefrontNode(doc, 'div', '_xtlac_srv_title', T('Системные агенты (LaunchAgents)','System agents (LaunchAgents)')));
    copy.appendChild(storefrontNode(doc, 'div', '_xtlac_srv_sub', T('Автозапускаемые фоновые агенты этого Мака. Агенты Extella — отдельной группой, остальные — не наши.','Auto-started background agents on this Mac. Extella agents are grouped separately; the rest are not ours.')));
    head.appendChild(copy);
    wrap.appendChild(head);
    var body = storefrontNode(doc, 'div', '_xtlac_srv_sysagents_body', T('проверяю…','checking…'));
    wrap.appendChild(body);
    section.appendChild(wrap);
    function bridgePost(url, payload) {
      return fetch('http://127.0.0.1:8765' + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload || {}) }).then(function (r) { return r.json(); });
    }
    fetch('http://127.0.0.1:8765/x/listener_procs').then(function (r) { return r.json(); }).then(function (lp) {
      if (!lp || !lp.orphans) return;
      var warn = doc.createElement('div');
      warn.style.cssText = 'margin:8px 0;padding:8px 12px;border:1px solid #C0392B;border-radius:8px;font-size:12.5px;display:flex;align-items:center;gap:10px';
      warn.appendChild(doc.createTextNode(T('Лишние процессы listener: ','Extra listener processes: ') + lp.orphans + T(' — забирают фоновые задачи параллельно.',' — they may grab background tasks in parallel.')));
      var cbtn = doc.createElement('button');
      cbtn.type = 'button';
      cbtn.textContent = T('Закрыть лишние','Close extras');
      cbtn.addEventListener('click', function () {
        cbtn.disabled = true;
        bridgePost('/x/listener_cleanup').then(function (res) { warn.textContent = (res && res.message) || T('готово','done'); });
      });
      warn.appendChild(cbtn);
      wrap.insertBefore(warn, body);
    }).catch(function () {});
    fetch('http://127.0.0.1:8765/x/launchagents').then(function (r) { return r.json(); }).then(function (d) {
      var agents = (d && d.agents) || [];
      body.textContent = '';
      if (!agents.length) { body.textContent = T('агентов не найдено','no agents found'); return; }
      var famTitle = { extella: 'Extella', dronor: T('Не Extella','Not Extella'), other: T('Прочие','Other') };
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
          row.appendChild(doc.createTextNode(dot + ' ' + a.label + (a.pid ? ' · pid ' + a.pid : '') + (a.enabled ? '' : T(' · автозапуск выключен',' · autostart off'))));
          var b = doc.createElement('button');
          b.type = 'button';
          b.style.marginLeft = 'auto';
          var off = a.running || a.enabled;
          b.textContent = off ? T('Выключить','Switch off') : T('Включить','Switch on');
          b.addEventListener('click', function () {
            if (b.getAttribute('data-arm') !== '1') { b.setAttribute('data-arm', '1'); b.textContent = off ? T('Точно выключить?','Really switch off?') : T('Точно включить?','Really switch on?'); return; }
            b.disabled = true;
            bridgePost('/x/launchagent_action', { label: a.label, action: off ? 'disable' : 'enable' }).then(function (res) {
              b.textContent = (res && res.status === 'success') ? (off ? T('выключен ✓','off ✓') : T('включён ✓','on ✓')) : T('ошибка','error');
            });
          });
          row.appendChild(b);
          body.appendChild(row);
        });
      });
    }).catch(function () { body.textContent = T('Конструктор сейчас не отвечает — загляни через минуту.','The Wizard is not responding — check back in a minute.'); });
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
        state.serviceMessage = '';
      })
      .catch(function () {
        state.serviceMessage = T('Служебная часть Extella на этом компьютере не запущена — список фоновых программ недоступен. Это не поломка: компонент ещё не установлен.','The Extella service component is not running on this computer, so the background program list is unavailable. Nothing is broken — the component is not installed yet.');
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
          state.serviceMessage = T('Управление недоступно: локальный bridge не выдал разрешение.','Control unavailable: the local bridge did not grant permission.');
          renderLocalServices(store);
        }
      });
      return;
    }
    state.serviceBusy[service.id] = true;
    state.serviceMessage = (action === 'stop'
      ? T('Выключаю: ','Switching off: ')
      : (action === 'restart' ? T('Перезапускаю: ','Restarting: ') : T('Включаю: ','Switching on: '))) + service.name;
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
        state.serviceMessage = (action === 'stop'
          ? T('Выключено: ','Switched off: ')
          : (action === 'restart' ? T('Перезапущено: ','Restarted: ') : T('Включено: ','Switched on: '))) + service.name;
      })
      .catch(function (error) {
        state.serviceMessage = T('Не удалось изменить состояние: ','Could not change the state: ') + (error.message || T('неизвестная ошибка','unknown error'));
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

      // Решение Эллы 20.07: «Автоматизации» — служебный пульт, а не полка магазина.
      // Из основного ряда вкладок УБРАНО; входы: кнопка-календарь в шапке витрины
      // и ярлык на Рабочем столе. Здесь только вычищаем вкладку, если её успела
      // добавить старая версия этой панели.
      var changed = false;
      if (Array.isArray(store.CATS)) {
        var idx = store.CATS.findIndex(function (category) { return category.id === 'automations'; });
        if (idx >= 0) { store.CATS.splice(idx, 1); changed = true; }
      }
      if (store.I18N_EN) store.I18N_EN['Автоматизации'] = 'Automations';
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
    if (!state.activityToken) return Promise.reject(new Error(T('Список действий пока недоступен — перезапусти Extella','The action list is unavailable — restart Extella')));
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
    if (!window.confirm(T('Убрать все завершённые записи из этой ленты?','Remove all completed entries from this feed?'))) return;
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
    metaRow(meta, T('Источник','Source'), task.origin);
    metaRow(meta, T('Для чего','Purpose'), task.purpose);
    metaRow(meta, T('Режим','Mode'), task.mode);
    if (task.sourceIds && task.sourceIds.length) metaRow(meta, T('ID запуска','Run ID'), task.sourceIds[0]);
    details.appendChild(meta);
    if (task.manageTarget === 'automations') {
      var manage = el('button', { className: '_xtlac_manage', type: 'button' }, task.manageLabel || T('Открыть AI Автоматизации','Open AI Automations'));
      manage.addEventListener('click', function (event) {
        event.stopPropagation();
        enterAutomations(task);
      });
      details.appendChild(manage);
      details.appendChild(el('div', { className: '_xtlac_hint' }, sourceIdHint(task)));
    }
    if (task.status === 'running') {
      details.appendChild(el('div', { className: '_xtlac_hint' }, T('Прервать задачу можно красной кнопкой Cancel внизу панели Extella.','To interrupt a task, use the red Cancel button at the bottom of the Extella panel.')));
    } else {
      var remove = el('button', { className: '_xtlac_remove', type: 'button' }, state.taskBusy[task.id] ? T('Убираю…','Removing…') : T('Убрать запись из ленты','Remove from the feed'));
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
      return T('Откроется кабинет связанного процесса. На вкладке «Расписание» можно выбрать «вручную (без расписания)».','Opens the linked process cabinet. On the Schedule tab you can pick manual (no schedule).');
    }
    return T('Откроется список процессов. В кабинете нужной автоматизации можно снять расписание.','Opens the process list. In the automation cabinet you can remove its schedule.');
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
    // Нет данных ≠ тревога: у части устройств движка фоновых задач просто нет —
    // чип остаётся спокойным, никакого вечного «подключаюсь…» с оранжевой точкой.
    var health = data ? data.health : 'ok';
    root.setAttribute('data-health', health);
    document.getElementById('_xtlac_text').textContent = data ? data.headline : T('Фоновых задач нет','No background tasks');
    // Счётчик без подписи читался как противоречие («задач нет» + «✓ 3») —
    // подписываем, что это выполненные, и прячем ноль
    document.getElementById('_xtlac_count').textContent = (data && data.counts.completed) ? ('✓ ' + data.counts.completed + T(' выполнено',' done')) : '';
    var clear = document.getElementById('_xtlac_clear');
    if (clear) clear.classList.toggle('show', !!(data && data.history && data.history.length));

    var warning = document.getElementById('_xtlac_warning');
    var orphaned = data && data.listeners && data.listeners.orphaned || 0;
    if (!state.bridgeOnline && !state.data) {
      // Ни детального списка, ни базового статуса. Честно: перезапуск может и
      // не помочь (движка задач на устройстве может не быть) — не обещаем.
      warning.textContent = T('Не вижу фоновых задач. Если ты их не запускала — так и должно быть. Если запускала, а список пропал — перезапусти Extella (⌘Q и открой заново).','No background tasks visible. If you have not started any — that is normal. If you did and the list vanished — restart Extella (⌘Q and open again).');
      warning.classList.add('show');
    } else if (orphaned) {
      // Задание Анвара: не только предупреждать, но и чинить в один клик —
      // POST /x/listener_cleanup закрывает только сирот, ответ показываем тут же.
      warning.replaceChildren(
        el('span', {}, T('Обнаружено лишних процессов listener: ','Found extra listener processes: ') + orphaned + T('. Они могут забирать фоновые задачи параллельно. ','. They may grab background tasks in parallel. ')),
        (function () {
          var btn = el('button', { id: '_xtlac_fix', className: '_xtlac_fixbtn', type: 'button' }, T('Закрыть лишние','Close extras'));
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
      body.appendChild(el('div', { id: '_xtlac_empty' }, T('Жду первые события Extella.','Waiting for the first Extella events.')));
      return;
    }
    section(body, T('Сейчас','Now'), data.active);
    section(body, T('Выполнено','Done'), data.history.slice(0, 15));
    if (!data.active.length && !data.history.length) {
      var _h3=document.querySelector('#_xtlac_head h3'); if(_h3)_h3.textContent=T('Что делает Extella','What Extella is doing');
      var _clr=document.getElementById('_xtlac_clear'); if(_clr)_clr.textContent=T('Очистить выполненные','Clear completed');
      body.appendChild(el('div', { id: '_xtlac_empty' }, T('Пока пусто. Когда Extella что-то делает — ставит программу, запускает процесс, проверяет данные, — здесь видна каждая задача и её статус.','Quiet for now. When Extella is doing something — installing a program, running a process, checking data — every task and its status shows up here.')));
    }
  }

  function mount() {
    if (!document.body || document.getElementById('_xtlac_root')) return;
    css += '._xtlac_fixbtn{margin-left:8px;border:1px solid var(--etb-bd2,rgba(0,0,0,.15));background:transparent;color:inherit;border-radius:5px;padding:2px 10px;font-size:11.5px;cursor:pointer}._xtlac_fixbtn:disabled{opacity:.6;cursor:default}';
    var style = el('style', { id: '_xtlac_styles' });
    style.textContent = css;
    document.head.appendChild(style);

    var root = el('div', { id: '_xtlac_root', 'data-health': 'warning' });
    var pill = el('button', { id: '_xtlac_pill', type: 'button', 'aria-label': T('Что делает Extella — открыть список','What Extella is doing — open the list') });
    pill.appendChild(el('span', { id: '_xtlac_grip', title: T('Перетащи, чтобы сдвинуть плашку','Drag to move this chip') }, '⠿'));
    pill.appendChild(el('span', { id: '_xtlac_dot' }));
    pill.appendChild(el('span', { id: '_xtlac_text' }, T('Подключаюсь…','Connecting…')));
    pill.appendChild(el('span', { id: '_xtlac_count' }));
    root.appendChild(pill);

    var panel = el('div', { id: '_xtlac_panel' });
    var head = el('div', { id: '_xtlac_head' });
    var heading = el('div');
    heading.appendChild(el('h3', {}, T('Что делает Extella','What Extella is doing')));
    head.appendChild(heading);
    head.appendChild(el('button', { id: '_xtlac_clear', type: 'button' }, T('Очистить выполненные','Clear completed')));
    head.appendChild(el('button', { id: '_xtlac_close', type: 'button', 'aria-label': T('Закрыть','Close') }, '×'));
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
    // Перетаскивание по горизонтали: плашка прибита к правому нижнему углу и в
    // узких окнах перекрывала чат. Сдвиг хранится и переживает перезапуск.
    var POS_KEY = '_xtlac_pos_x';
    function _applyPos(x) {
      var pw = pill.offsetWidth || 160;
      var min = -(window.innerWidth - pw - 24);           // до левого края
      x = Math.min(0, Math.max(min, x));                  // 0 = родной правый угол
      root.style.transform = x ? ('translateX(' + x + 'px)') : '';
      return x;
    }
    var _savedX = 0;
    try { _savedX = parseInt(localStorage.getItem(POS_KEY) || '0', 10) || 0; } catch (e) {}
    if (_savedX) _applyPos(_savedX);
    var _drag = null, _dragged = false;
    pill.addEventListener('pointerdown', function (ev) {
      _drag = { startX: ev.clientX, baseX: _savedX };
      _dragged = false;
      try { pill.setPointerCapture(ev.pointerId); } catch (e) {}
    });
    pill.addEventListener('pointermove', function (ev) {
      if (!_drag) return;
      var dx = ev.clientX - _drag.startX;
      if (Math.abs(dx) > 4) _dragged = true;
      if (_dragged) {
        root.classList.add('dragging');
        _savedX = _applyPos(_drag.baseX + dx);
      }
    });
    pill.addEventListener('pointerup', function () {
      if (_dragged) { try { localStorage.setItem(POS_KEY, String(_savedX)); } catch (e) {} }
      _drag = null;
      root.classList.remove('dragging');
    });
    window.addEventListener('resize', function () { _savedX = _applyPos(_savedX); });
    pill.addEventListener('click', function (ev) {
      if (_dragged) { _dragged = false; ev.stopPropagation(); return; }  // конец перетаскивания ≠ клик
      setOpen(!state.open);
    });
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
          status: 'running', title: T('Extella выполняет задачу','Extella is working on a task'),
          detail: T('Что именно — в этом режиме не видно; обычно это установка или фоновая сборка.','What exactly is not visible in this mode; usually an install or a background build.'), category: 'action'
        }] : [];
        return {
          // Спокойный чип: без деталей журнала он всё равно знает счётчик задач.
          // Про перезапуск объясняет предупреждение ВНУТРИ панели, чипу ныть не нужно.
          health: active.length ? 'busy' : 'ok',
          headline: active.length ? active[0].title : T('Сейчас ничего не выполняется','Nothing running right now'),
          active: active, history: [],
          counts: { active: active.length, completed: status.tasksCompleted || 0, failed: status.tasksFailed || 0 },
          listeners: { count: status.running ? 1 : 0, orphaned: 0 }
        };
      }).catch(function () { return null; });
    } catch (e) { return Promise.resolve(null); }
  }

  function cleanupListeners() {
    var btn = document.getElementById('_xtlac_fix');
    if (btn) { btn.disabled = true; btn.textContent = T('Закрываю…','Closing…'); }
    var w = document.getElementById('_xtlac_warning');
    fetch(API_BASE + '/x/listener_cleanup', { method: 'POST' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var killed = d && (d.killed != null ? d.killed : (Array.isArray(d.pids) ? d.pids.length : d.count));
        if (w) w.textContent = killed ? ('Закрыто лишних: ' + killed + '.') : 'Сирот нет.';
        setTimeout(refresh, 1200);
      })
      .catch(function () {
        if (w) w.textContent = 'Не получилось закрыть: Extella не отвечает. Попробуй ещё раз через минуту.';
        if (btn) { btn.disabled = false; btn.textContent = T('Закрыть лишние','Close extras'); }
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
