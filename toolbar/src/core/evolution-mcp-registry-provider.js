// ── EXTELLA EVOLUTION · MCP REGISTRY PROVIDER ─────────────────────────────
// Account-bound read-only provider for declared MCP topology.
//
// The provider reads one exact global KV key. It has no fallback key, no
// local cache and no write method. Missing or malformed topology remains an
// explicit incomplete registry; an account mismatch fails closed.

ETB.evolutionMcpRegistryProvider = (function () {
  'use strict';

  var REGISTRY_KEY = 'xtl_evolution:mcp_registry:v1';

  function error(code, message) {
    var result = new Error(message || code);
    result.code = code;
    return result;
  }

  function hasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value, key);
  }

  function text(value) {
    return String(value == null ? '' : value).trim();
  }

  function assertContext(options) {
    if (options && typeof options.assertContext === 'function') {
      try {
        options.assertContext();
      } catch (contextError) {
        contextError.__evolutionMcpContext = true;
        throw contextError;
      }
    }
  }

  function rethrowContext(value) {
    if (value && value.__evolutionMcpContext === true) throw value;
  }

  function apiFailed(response) {
    var status = text(response && response.status).toLowerCase();
    var httpStatus = Number(response && (
      response.httpStatus != null ? response.httpStatus :
        response.http_status
    ));
    return status === 'error' || status === 'failed' ||
      status === 'not_found' || httpStatus >= 400;
  }

  function responseValue(response) {
    if (response == null) return null;
    if (hasOwn(response, 'value')) return response.value;
    if (hasOwn(response, 'kv_value')) return response.kv_value;
    if (response.result && hasOwn(response.result, 'value')) {
      return response.result.value;
    }
    return response;
  }

  function parseDocument(response) {
    var value;
    if (apiFailed(response)) {
      throw error(
        'MCP_REGISTRY_UNAVAILABLE',
        'account MCP registry is unavailable'
      );
    }
    value = responseValue(response);
    if (value == null || value === '') {
      throw error(
        'MCP_REGISTRY_UNAVAILABLE',
        'account MCP registry is empty'
      );
    }
    if (typeof value !== 'string') return value;
    try {
      return JSON.parse(value);
    } catch (_) {
      throw error(
        'MCP_REGISTRY_INVALID',
        'account MCP registry is not valid JSON'
      );
    }
  }

  function checkedAt(options) {
    var value = options && options.now;
    if (typeof value === 'function') value = value();
    value = value || new Date().toISOString();
    return String(value);
  }

  function unavailable(accountId, options, code) {
    return ETB.evolutionMcpContract.unavailableRegistry(
      accountId,
      checkedAt(options),
      code
    );
  }

  function load(options) {
    var api;
    var accountId;
    options = options || {};
    api = options.api || ETB.api;
    accountId = text(options.accountId || options.actorId);
    if (!accountId) {
      return Promise.reject(error(
        'MCP_REGISTRY_ACCOUNT_REQUIRED',
        'an exact authenticated account is required'
      ));
    }
    if (!api || typeof api.kvGet !== 'function' ||
        !ETB.evolutionMcpContract ||
        typeof ETB.evolutionMcpContract.validateRegistry !== 'function') {
      return Promise.reject(error(
        'MCP_REGISTRY_PROVIDER_UNAVAILABLE',
        'the read-only MCP registry provider is unavailable'
      ));
    }
    try {
      assertContext(options);
    } catch (contextError) {
      return Promise.reject(contextError);
    }
    return Promise.resolve().then(function () {
      return api.kvGet(REGISTRY_KEY, { global: true });
    }).then(function (response) {
      var document;
      assertContext(options);
      document = parseDocument(response);
      if (text(document && document.owner_account_id) !== accountId) {
        throw error(
          'MCP_REGISTRY_ACCOUNT_MISMATCH',
          'account MCP registry belongs to another account'
        );
      }
      document = ETB.evolutionMcpContract.validateRegistry(
        document,
        { accountId: accountId }
      );
      assertContext(options);
      return document;
    }).catch(function (readError) {
      rethrowContext(readError);
      if (readError && readError.code === 'MCP_REGISTRY_ACCOUNT_MISMATCH') {
        throw readError;
      }
      return unavailable(
        accountId,
        options,
        readError && readError.code === 'MCP_REGISTRY_UNAVAILABLE' ?
          'MCP_REGISTRY_UNAVAILABLE' : 'MCP_REGISTRY_INVALID'
      );
    });
  }

  return {
    REGISTRY_KEY: REGISTRY_KEY,
    load: load
  };
}());
