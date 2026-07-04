// ── AUTH MODULE ────────────────────────────────────────────────────────────
// Session-based auth: the token is NEVER persisted to localStorage.
//
// Flow:
//   1. Resolve the signed-in userId from the live session. Sources, in order:
//        a. PRIMARY — POST /api/auth/refresh (httpOnly refreshToken cookie)
//        b. Amplitude analytics cookie (AMP_*)
//        c. DOM / extella-user-id postMessage / localStorage fallback
//   2. Call api.extella.ai POST /api/token/list with X-User-Id headers
//   3. Reuse a working 'toolbar' token or generate one
//   4. Keep token + bound userId in memory only
//
// Account switching: refreshSession() re-resolves userId on every login /
// postMessage / tokenUpdated event. When userId changes the old token is
// cleared, a new one is fetched, and onSessionChange subscribers remount
// Library / plugin iframes with the fresh credential.

ETB.auth = (function () {
  // Survive toolbar re-injection on full page navigations (Extella runs
  // executeJavaScript(toolbar.js) on every did-navigate). Token and bound
  // userId live on window; listeners are registered once per page lifetime.
  window.__etbSessionCbs = window.__etbSessionCbs || [];
  window.__etbPendingTokenCbs = window.__etbPendingTokenCbs || [];
  var _cached = window._extellaApiToken || null;
  var _boundUserId = window.__etbBoundUserId || null;
  var _pendingCallbacks = window.__etbPendingTokenCbs;
  var _sessionChangeCallbacks = window.__etbSessionCbs;

  var API_BASE = 'https://api.extella.ai';

  function _userIdHeaders(userId) {
    return {
      'Content-Type': 'application/json',
      'X-User-Id': userId,
      'X-Profile-Id': 'default',
      'X-Agent-Id': 'agent_extella_default'
    };
  }

  function _emitSessionChange(ev) {
    _sessionChangeCallbacks.slice().forEach(function (cb) {
      try { cb(ev); } catch (e) {}
    });
  }

  function _setMemoryToken(t, userId) {
    var prevToken = _cached;
    var prevUserId = _boundUserId;
    _cached = t;
    window._extellaApiToken = t;
    if (userId) {
      _boundUserId = userId;
      window.__etbBoundUserId = userId;
    }
    try { localStorage.removeItem('extella_tb_token'); } catch (e) {}
    try { localStorage.removeItem('extella_tb_token_enc'); } catch (e) {}
    _pendingCallbacks.splice(0).forEach(function (cb) {
      try { cb(t); } catch (e) {}
    });
    if (t !== prevToken || (userId && userId !== prevUserId)) {
      _emitSessionChange({
        userId: _boundUserId,
        token: t,
        prevUserId: prevUserId,
        reason: 'setToken'
      });
    }
  }

  function _decodeJwtPayload(jwt) {
    try {
      var parts = String(jwt).split('.');
      if (parts.length < 2) return null;
      var b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      b64 += '==='.slice((b64.length + 3) % 4);
      return JSON.parse(atob(b64));
    } catch (e) {
      return null;
    }
  }

  function _fetchUserIdViaRefresh() {
    return fetch('https://prod.extella.ai/api/auth/refresh', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' }
    }).then(function (r) {
      if (!r.ok) return null;
      return r.json();
    }).then(function (d) {
      if (!d) return null;
      var id = d.user && (d.user.id || d.user._id);
      if (!id && d.token) {
        var payload = _decodeJwtPayload(d.token);
        if (payload) id = payload.id || payload._id || payload.sub;
      }
      id = id && String(id).trim();
      return (id && /^[a-f0-9]{24}$/i.test(id)) ? id : null;
    }).catch(function () { return null; });
  }

  function _extractUserId(s) {
    if (!s) return null;
    var m = /"userId"\s*:\s*"([a-f0-9]{24})"/i.exec(s);
    return m ? m[1] : null;
  }

  function _readUserIdFromCookie() {
    try {
      var cookies = (document.cookie || '').split(';');
      for (var i = 0; i < cookies.length; i++) {
        var c = cookies[i].trim();
        var eq = c.indexOf('=');
        if (eq < 0) continue;
        var name = c.slice(0, eq);
        if (name.indexOf('AMP_') !== 0 || name.indexOf('MKTG') !== -1) continue;
        var raw = c.slice(eq + 1);
        var candidates = [raw];
        var urlDecoded = null, b64 = null;
        try { urlDecoded = decodeURIComponent(raw); candidates.push(urlDecoded); } catch (e) {}
        try { b64 = atob(raw); candidates.push(b64); } catch (e) {}
        if (b64) { try { candidates.push(decodeURIComponent(b64)); } catch (e) {} }
        if (urlDecoded) { try { candidates.push(atob(urlDecoded)); } catch (e) {} }
        for (var j = 0; j < candidates.length; j++) {
          var id = _extractUserId(candidates[j]);
          if (id) return id;
        }
      }
    } catch (e) {}
    return null;
  }

  function _readUserIdFromDOM() {
    var fromCookie = _readUserIdFromCookie();
    if (fromCookie) return fromCookie;
    try {
      var el = document.querySelector('code[data-testid="user-id-display"]');
      var id = el && el.textContent && el.textContent.trim();
      if (id && /^[a-f0-9]{24}$/i.test(id)) return id;
      var codes = document.querySelectorAll('code');
      for (var i = 0; i < codes.length; i++) {
        var text = codes[i].textContent && codes[i].textContent.trim();
        if (text && /^[a-f0-9]{24}$/i.test(text)) return text;
      }
    } catch (e) {}
    try {
      var ls = (localStorage.getItem('dtd_last_user_id') || '').trim();
      if (/^[a-f0-9]{24}$/i.test(ls)) return ls;
    } catch (e) {}
    return null;
  }

  function _probeTokenStatus(token) {
    return fetch(API_BASE + '/api/token/list', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Auth-Token': token,
        'X-Profile-Id': 'default',
        'X-Agent-Id': 'agent_extella_default'
      },
      body: '{}'
    }).then(function (r) { return r.status; }).catch(function () { return -1; });
  }

  function _probeToken(token) {
    return _probeTokenStatus(token).then(function (st) {
      return st > 0 && st !== 401 && st !== 403;
    });
  }

  function _pickWorkingToken(candidates, idx) {
    if (idx >= candidates.length) return Promise.resolve(null);
    var tok = candidates[idx];
    return _probeToken(tok).then(function (ok) {
      return ok ? tok : _pickWorkingToken(candidates, idx + 1);
    });
  }

  function _getOrCreateToken(userId) {
    var headers = _userIdHeaders(userId);
    return fetch(API_BASE + '/api/token/list', {
      method: 'POST',
      headers: headers,
      body: '{}'
    }).then(function (r) { return r.json(); })
      .then(function (d) {
        var tokens = (d && d.tokens) || [];
        var named = [], rest = [];
        for (var i = 0; i < tokens.length; i++) {
          if (!tokens[i].token) continue;
          if (tokens[i].name === 'toolbar') named.push(tokens[i].token);
          else rest.push(tokens[i].token);
        }
        var ordered = named.concat(rest);

        return _pickWorkingToken(ordered, 0).then(function (good) {
          if (good) {
            _setMemoryToken(good, userId);
            return good;
          }
          return fetch(API_BASE + '/api/token/generate', {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({ name: 'toolbar' })
          }).then(function (r) { return r.json(); })
            .then(function (g) {
              if (g && g.token) {
                _setMemoryToken(g.token, userId);
                return g.token;
              }
              throw new Error('token generation failed');
            });
        });
      });
  }

  function _resolveUserId(hintUserId) {
    return _fetchUserIdViaRefresh().then(function (userId) {
      if (!userId && hintUserId && /^[a-f0-9]{24}$/i.test(hintUserId)) userId = hintUserId;
      if (!userId) userId = _readUserIdFromDOM();
      return userId;
    });
  }

  return {
    getToken: function () {
      if (window._extellaApiToken && window._extellaApiToken.length > 10) {
        _cached = window._extellaApiToken;
      }
      return _cached || '';
    },

    getUserId: function () {
      return window.__etbBoundUserId || '';
    },

    setToken: function (t) {
      _setMemoryToken(t);
    },

    onToken: function (cb) {
      if (typeof cb !== 'function') return;
      var t = this.getToken();
      if (t) { cb(t); return; }
      _pendingCallbacks.push(cb);
    },

    onSessionChange: function (cb) {
      if (typeof cb !== 'function') return;
      _sessionChangeCallbacks.push(cb);
    },

    clearSession: function (reason) {
      var had = !!(_cached || _boundUserId);
      var prevUserId = _boundUserId;
      _cached = null;
      _boundUserId = null;
      window._extellaApiToken = '';
      window.__etbBoundUserId = null;
      if (had) {
        console.log('[ETB:auth] session cleared (' + (reason || 'unknown') + ')');
        _emitSessionChange({
          userId: null,
          token: '',
          prevUserId: prevUserId,
          reason: reason || 'clear',
          cleared: true
        });
      }
    },

    // Re-resolve userId from the live session and refresh the API token when
    // the signed-in account changes. Safe to call repeatedly.
    refreshSession: function (reason, hintUserId) {
      var self = this;
      return _resolveUserId(hintUserId).then(function (userId) {
        if (!userId) throw new Error('no userId from session');

        if (userId === window.__etbBoundUserId && _cached) {
          return _cached;
        }

        if (window.__etbBoundUserId && userId !== window.__etbBoundUserId) {
          console.log('[ETB:auth] session refresh: userId ' +
            window.__etbBoundUserId + ' → ' + userId + ' (' + reason + ')');
          _cached = null;
          window._extellaApiToken = '';
          _boundUserId = null;
          window.__etbBoundUserId = null;
        }

        return _getOrCreateToken(userId);
      });
    },

    initFromSession: function () {
      var self = this;

      // Toolbar re-injected after a full navigation — refresh credential,
      // but do not register duplicate global listeners.
      if (window.__etbAuthListeners) {
        return this.refreshSession('reinject');
      }
      window.__etbAuthListeners = true;

      console.log('[ETB:auth] init — starting session auth flow');

      // Permanent listeners — registered once; delegate to window.ETB.auth
      // so re-injected toolbar modules stay in sync.
      window.addEventListener('message', function (e) {
        if (!e.data || e.data.type !== 'extella-user-id' || !e.data.userId) return;
        if (!window.ETB || !window.ETB.auth) return;
        console.log('[ETB:auth] got extella-user-id via postMessage');
        window.ETB.auth.refreshSession('postMessage', e.data.userId).then(function () {
          console.log('[ETB:auth] token acquired via postMessage userId');
        }).catch(function (err) {
          console.warn('[ETB:auth] postMessage refresh failed:', err && err.message);
        });
      });

      window.addEventListener('tokenUpdated', function () {
        if (!window.ETB || !window.ETB.auth) return;
        window.ETB.auth.refreshSession('tokenUpdated').then(function () {
          console.log('[ETB:auth] token acquired via tokenUpdated event');
        }).catch(function () {});
      });

      // Detect navigation to the login page (logout / account switch).
      var _lastUrl = location.href;
      function _watchLoginPage() {
        var url = location.href;
        if (url === _lastUrl) return;
        _lastUrl = url;
        if (url.indexOf('/login') !== -1) {
          if (window.ETB && window.ETB.auth) window.ETB.auth.clearSession('login-page');
        }
      }
      window.addEventListener('popstate', _watchLoginPage);
      setInterval(_watchLoginPage, 1000);

      var attempts = 0;
      var timer = null;

      function _stopRetry() {
        if (timer) { clearInterval(timer); timer = null; }
      }

      // Always refresh on boot — do NOT skip when window._extellaApiToken
      // from a previous injection still holds the old account's token.
      self.refreshSession('boot').then(function () {
        console.log('[ETB:auth] token acquired via session refresh / DOM');
        _stopRetry();
      }).catch(function () {
        console.log('[ETB:auth] session refresh failed — starting retry interval');

        timer = setInterval(function () {
          attempts++;
          if (self.getToken() && self.getUserId()) { _stopRetry(); return; }

          if (attempts > 20) {
            _stopRetry();
            console.warn('[ETB:auth] all ' + attempts + ' retries exhausted — waiting for login event');
            return;
          }

          console.log('[ETB:auth] retry ' + attempts + '/20 — attempting session refresh');
          self.refreshSession('retry-' + attempts).then(function () {
            console.log('[ETB:auth] token acquired on retry ' + attempts);
            _stopRetry();
          }).catch(function () {});
        }, 3000);
      });
    },

  };
})();
