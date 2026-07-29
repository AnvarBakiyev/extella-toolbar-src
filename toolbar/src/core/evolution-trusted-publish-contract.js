// ── EXTELLA EVOLUTION · TRUSTED PUBLISH CONTRACT ─────────────────────────
// Closed, transport-safe shapes for the one host-mediated publication action.
// This module performs no I/O, keeps no idempotency state and never handles a
// credential. The host adapter owns all of those concerns.

ETB.evolutionTrustedPublishContract = (function () {
  'use strict';

  var REQUEST_KEYS = [
    'draft_id',
    'agent_id',
    'expected_version',
    'ledger_sha256',
    'gates',
    'idempotency_key'
  ];
  var PREWRITE_GATE_CODES = [
    'IMPACT_ANALYZED',
    'PLAYGROUND_GREEN',
    'ROLLBACK_AVAILABLE'
  ];
  var SUCCESS_KEYS = [
    'status',
    'agent_id',
    'version_before',
    'version_after',
    'read_back',
    'receipt_id',
    'rollback'
  ];
  var READ_BACK_KEYS = ['id', 'confirmed', 'source', 'at'];
  var ROLLBACK_KEYS = ['available', 'to_version', 'how'];
  var PUBLIC_ERROR_KEYS = [
    'code',
    'message_ru',
    'message_en',
    'next_step_ru',
    'next_step_en',
    'platform_reason',
    'gate',
    'receipt_id',
    'rollback'
  ];
  var PUBLIC_ERROR_CODES = [
    'ACCOUNT_MISMATCH',
    'AGENT_NOT_IN_FLEET',
    'VERSION_CONFLICT',
    'GATE_MISSING',
    'STALE_EVIDENCE',
    'READ_BACK_FAILED',
    'IDEMPOTENCY_CONFLICT',
    'PUBLISH_REJECTED',
    'PUBLISH_OUTCOME_UNKNOWN'
  ];
  var SHA256 = /^[a-f0-9]{64}$/;
  var AGENT_ID = /^agent_[A-Za-z0-9_-]{1,160}$/;
  var REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,239}$/;
  var ISO_TIMESTAMP =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?Z$/;
  var SECRET_KEY =
    /(?:password|passwd|token|access[_-]?token|refresh[_-]?token|api[_-]?key|apikey|secret|client[_-]?secret|authorization|cookie|private[_-]?key|credential)/i;
  var SECRET_VALUE = new RegExp([
    '-----BEGIN [A-Z ]*PRIVATE KEY-----',
    '\\bBearer\\s+[A-Za-z0-9._~+/-]{8,}={0,2}\\b',
    '\\b(?:sk|ghp|github_pat|xox[abprs])[-_][A-Za-z0-9_-]{12,}\\b',
    '[?&](?:token|access[_-]?token|refresh[_-]?token|api[_-]?key|apikey|client[_-]?secret|secret|password)='
  ].join('|'), 'i');

  function fail(code, message) {
    var error = new Error(message || code);
    error.code = code;
    throw error;
  }

  function object(value, code, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        Object.prototype.toString.call(value) !== '[object Object]') {
      fail(code, label + ' must be an object');
    }
    return value;
  }

  function exactKeys(value, expected, code, label) {
    var actual = Object.keys(object(value, code, label)).sort();
    var wanted = expected.slice().sort();
    if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
      fail(code, label + ' has missing or unsupported fields');
    }
  }

  function fixedText(value, code, label, maxLength) {
    if (typeof value !== 'string' || !value || value !== value.trim() ||
        value.length > (maxLength || 240) || /[\u0000-\u001f\u007f]/.test(value)) {
      fail(code, label + ' must be bounded exact text');
    }
    return value;
  }

  function displayText(value, code, label, nullable) {
    if (nullable && value === null) return null;
    if (typeof value !== 'string' || !value || value.length > 600 ||
        /[\u0000-\u001f\u007f]/.test(value) || SECRET_VALUE.test(value)) {
      fail(code, label + ' must be bounded safe display text');
    }
    return value;
  }

  function reference(value, code, label) {
    var result = fixedText(value, code, label, 240);
    if (!REFERENCE.test(result)) {
      fail(code, label + ' must be an exact reference');
    }
    return result;
  }

  function version(value, code, label) {
    var result = fixedText(value, code, label, 120);
    if (/[?*\[\]{}]/.test(result)) {
      fail(code, label + ' must be an exact version');
    }
    return result;
  }

  function rollback(value, code, label, nullable) {
    if (nullable && value === null) return null;
    exactKeys(value, ROLLBACK_KEYS, code, label);
    if (value.available !== true) {
      fail(code, label + '.available must be true');
    }
    return {
      available: true,
      to_version: version(value.to_version, code, label + '.to_version'),
      how: displayText(value.how, code, label + '.how', false)
    };
  }

  function assertNoSecrets(value, code, path, seen) {
    var keys;
    var i;
    if (value === null || typeof value === 'undefined') return;
    if (typeof value === 'string') {
      if (SECRET_VALUE.test(value)) {
        fail(code, 'secret-like value is forbidden at ' + path);
      }
      return;
    }
    if (typeof value !== 'object') return;
    seen = seen || [];
    if (seen.indexOf(value) !== -1) {
      fail(code, 'cyclic values are forbidden at ' + path);
    }
    seen.push(value);
    keys = Object.keys(value);
    for (i = 0; i < keys.length; i += 1) {
      if (SECRET_KEY.test(keys[i])) {
        fail(code, 'secret-like field is forbidden at ' + path + '.' + keys[i]);
      }
      assertNoSecrets(value[keys[i]], code, path + '.' + keys[i], seen);
    }
    seen.pop();
  }

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
      return value;
    }
    Object.keys(value).forEach(function (key) {
      deepFreeze(value[key]);
    });
    return Object.freeze(value);
  }

  function normalizeRequest(value) {
    var gates;
    exactKeys(value, REQUEST_KEYS, 'TRUSTED_PUBLISH_REQUEST_INVALID',
      'trusted publish request');
    exactKeys(value.gates, PREWRITE_GATE_CODES,
      'TRUSTED_PUBLISH_REQUEST_INVALID', 'trusted publish gates');
    if (!AGENT_ID.test(String(value.agent_id || ''))) {
      fail('TRUSTED_PUBLISH_REQUEST_INVALID',
        'agent_id must be an exact platform agent id');
    }
    gates = {};
    PREWRITE_GATE_CODES.forEach(function (code) {
      gates[code] = reference(
        value.gates[code],
        'TRUSTED_PUBLISH_REQUEST_INVALID',
        'gates.' + code
      );
    });
    return deepFreeze({
      draft_id: reference(
        value.draft_id,
        'TRUSTED_PUBLISH_REQUEST_INVALID',
        'draft_id'
      ),
      agent_id: String(value.agent_id),
      expected_version: version(
        value.expected_version,
        'TRUSTED_PUBLISH_REQUEST_INVALID',
        'expected_version'
      ),
      ledger_sha256: (function () {
        var hash = String(value.ledger_sha256 || '');
        if (!SHA256.test(hash)) {
          fail('TRUSTED_PUBLISH_REQUEST_INVALID',
            'ledger_sha256 must be lowercase SHA-256');
        }
        return hash;
      }()),
      gates: gates,
      idempotency_key: reference(
        value.idempotency_key,
        'TRUSTED_PUBLISH_REQUEST_INVALID',
        'idempotency_key'
      )
    });
  }

  function normalizeSuccess(value, request) {
    var at;
    var result;
    exactKeys(value, SUCCESS_KEYS, 'TRUSTED_PUBLISH_RESPONSE_INVALID',
      'trusted publish response');
    if (value.status !== 'published') {
      fail('TRUSTED_PUBLISH_RESPONSE_INVALID',
        'trusted publish response must be published');
    }
    if (String(value.agent_id || '') !== request.agent_id) {
      fail('TRUSTED_PUBLISH_RESPONSE_INVALID',
        'response agent_id does not match the requested agent');
    }
    exactKeys(value.read_back, READ_BACK_KEYS,
      'TRUSTED_PUBLISH_RESPONSE_INVALID', 'read_back');
    if (value.read_back.confirmed !== true ||
        value.read_back.source !== 'agent/get') {
      fail('TRUSTED_PUBLISH_RESPONSE_INVALID',
        'read_back must be host-confirmed from agent/get');
    }
    at = fixedText(
      value.read_back.at,
      'TRUSTED_PUBLISH_RESPONSE_INVALID',
      'read_back.at',
      64
    );
    if (!ISO_TIMESTAMP.test(at) || !isFinite(Date.parse(at))) {
      fail('TRUSTED_PUBLISH_RESPONSE_INVALID',
        'read_back.at must be an ISO UTC timestamp');
    }
    result = {
      status: 'published',
      agent_id: request.agent_id,
      version_before: version(
        value.version_before,
        'TRUSTED_PUBLISH_RESPONSE_INVALID',
        'version_before'
      ),
      version_after: version(
        value.version_after,
        'TRUSTED_PUBLISH_RESPONSE_INVALID',
        'version_after'
      ),
      read_back: {
        id: reference(
          value.read_back.id,
          'TRUSTED_PUBLISH_RESPONSE_INVALID',
          'read_back.id'
        ),
        confirmed: true,
        source: 'agent/get',
        at: at
      },
      receipt_id: reference(
        value.receipt_id,
        'TRUSTED_PUBLISH_RESPONSE_INVALID',
        'receipt_id'
      ),
      rollback: rollback(
        value.rollback,
        'TRUSTED_PUBLISH_RESPONSE_INVALID',
        'rollback',
        false
      )
    };
    if (result.version_before !== request.expected_version ||
        result.rollback.to_version !== result.version_before) {
      fail('TRUSTED_PUBLISH_RESPONSE_INVALID',
        'response versions do not preserve the requested rollback path');
    }
    assertNoSecrets(result, 'TRUSTED_PUBLISH_RESPONSE_INVALID', 'response');
    return deepFreeze(result);
  }

  function isPublicErrorCode(value) {
    return PUBLIC_ERROR_CODES.indexOf(String(value || '')) !== -1;
  }

  function normalizePublicError(value, expectedCode) {
    var code = String(expectedCode || value && value.code || '');
    var result;
    exactKeys(value, PUBLIC_ERROR_KEYS, 'TRUSTED_PUBLISH_ERROR_INVALID',
      'trusted publish public_error');
    if (!isPublicErrorCode(code) || value.code !== code) {
      fail('TRUSTED_PUBLISH_ERROR_INVALID',
        'public_error.code is not an allowed trusted publish outcome');
    }
    result = {
      code: code,
      message_ru: displayText(
        value.message_ru,
        'TRUSTED_PUBLISH_ERROR_INVALID',
        'public_error.message_ru',
        false
      ),
      message_en: displayText(
        value.message_en,
        'TRUSTED_PUBLISH_ERROR_INVALID',
        'public_error.message_en',
        false
      ),
      next_step_ru: displayText(
        value.next_step_ru,
        'TRUSTED_PUBLISH_ERROR_INVALID',
        'public_error.next_step_ru',
        false
      ),
      next_step_en: displayText(
        value.next_step_en,
        'TRUSTED_PUBLISH_ERROR_INVALID',
        'public_error.next_step_en',
        false
      ),
      platform_reason: displayText(
        value.platform_reason,
        'TRUSTED_PUBLISH_ERROR_INVALID',
        'public_error.platform_reason',
        true
      ),
      gate: value.gate === null ? null : String(value.gate || ''),
      receipt_id: value.receipt_id === null ? null : reference(
        value.receipt_id,
        'TRUSTED_PUBLISH_ERROR_INVALID',
        'public_error.receipt_id'
      ),
      rollback: rollback(
        value.rollback,
        'TRUSTED_PUBLISH_ERROR_INVALID',
        'public_error.rollback',
        true
      )
    };
    if (code === 'GATE_MISSING' &&
        PREWRITE_GATE_CODES.indexOf(result.gate) === -1) {
      fail('TRUSTED_PUBLISH_ERROR_INVALID',
        'GATE_MISSING must identify one pre-write gate');
    }
    if (code !== 'GATE_MISSING' && result.gate !== null) {
      fail('TRUSTED_PUBLISH_ERROR_INVALID',
        'only GATE_MISSING may include gate');
    }
    if (code === 'PUBLISH_REJECTED' && !result.platform_reason) {
      fail('TRUSTED_PUBLISH_ERROR_INVALID',
        'PUBLISH_REJECTED must preserve the platform reason');
    }
    if (code === 'READ_BACK_FAILED' &&
        (!result.receipt_id || !result.rollback)) {
      fail('TRUSTED_PUBLISH_ERROR_INVALID',
        'READ_BACK_FAILED must include receipt and rollback');
    }
    if ((result.receipt_id === null) !== (result.rollback === null)) {
      fail('TRUSTED_PUBLISH_ERROR_INVALID',
        'receipt_id and rollback must be present together');
    }
    assertNoSecrets(result, 'TRUSTED_PUBLISH_ERROR_INVALID', 'public_error');
    return deepFreeze(result);
  }

  function unknownOutcome() {
    return deepFreeze({
      code: 'PUBLISH_OUTCOME_UNKNOWN',
      message_ru: 'Исход публикации пока неизвестен.',
      message_en: 'The publication outcome is currently unknown.',
      next_step_ru: 'Перечитай квитанцию и черновик тем же ключом; не публикуй с новым ключом.',
      next_step_en: 'Re-read the receipt and draft with the same key; do not publish with a new key.',
      platform_reason: null,
      gate: null,
      receipt_id: null,
      rollback: null
    });
  }

  return Object.freeze({
    REQUEST_KEYS: Object.freeze(REQUEST_KEYS.slice()),
    PREWRITE_GATE_CODES: Object.freeze(PREWRITE_GATE_CODES.slice()),
    PUBLIC_ERROR_CODES: Object.freeze(PUBLIC_ERROR_CODES.slice()),
    normalizeRequest: normalizeRequest,
    normalizeSuccess: normalizeSuccess,
    normalizePublicError: normalizePublicError,
    isPublicErrorCode: isPublicErrorCode,
    unknownOutcome: unknownOutcome,
    clone: clone
  });
}());
