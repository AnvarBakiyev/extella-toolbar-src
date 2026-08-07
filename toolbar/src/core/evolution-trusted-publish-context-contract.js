// ── EXTELLA EVOLUTION · TRUSTED PUBLISH CONTEXT CONTRACT ─────────────────
// Closed, read-only projection of the one host-selected prepared publication.
// It intentionally carries references and durable outcomes only: never a
// credential, Agent Genome body, raw platform response or UI-authored draft.

ETB.evolutionTrustedPublishContextContract = (function () {
  'use strict';

  var SCHEMA = 'extella.evolution.trusted_publish_context.v1.1';
  var ROOT_KEYS = [
    'schema',
    'owner_account_id',
    'fleet_snapshot_id',
    'captured_at',
    'status',
    'error_code',
    'subject',
    'request',
    'result',
    'public_error'
  ];
  var STATUS = {
    READY: true,
    NO_DRAFT: true,
    PUBLISHED: true,
    FAILED: true,
    OUTCOME_UNKNOWN: true,
    UNAVAILABLE: true
  };
  var MAX_AGE_MS = 5 * 60 * 1000;
  var MAX_FUTURE_SKEW_MS = 60 * 1000;
  var ID = /^[A-Za-z0-9][A-Za-z0-9._:@/+()-]{0,239}$/;
  var ERROR_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
  var ISO_UTC =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
  var SUBJECT_KEYS = [
    'gene_id',
    'kind',
    'from_version',
    'version',
    'test_case_count'
  ];
  var SUBJECT_KIND = {
    rule: true,
    knowledge: true,
    expert: true,
    handler: true
  };

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

  function exactId(value, code, label) {
    if (typeof value !== 'string' || !ID.test(value)) {
      fail(code, label + ' must be an exact bounded identifier');
    }
    return value;
  }

  function timestamp(value, code, label) {
    if (typeof value !== 'string' || !ISO_UTC.test(value) ||
        !isFinite(Date.parse(value))) {
      fail(code, label + ' must be an ISO UTC timestamp');
    }
    return value;
  }

  function exactErrorCode(value, code, label, nullable) {
    if (nullable && value === null) return null;
    if (typeof value !== 'string' || !ERROR_CODE.test(value)) {
      fail(code, label + ' must be an exact bounded error code');
    }
    return value;
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

  function runtime() {
    var value = ETB.evolutionTrustedPublishContract;
    if (!value || typeof value.normalizeRequest !== 'function' ||
        typeof value.normalizeSuccess !== 'function' ||
        typeof value.normalizePublicError !== 'function' ||
        typeof value.isPublicErrorCode !== 'function') {
      fail(
        'TRUSTED_PUBLISH_CONTEXT_CONTRACT_UNAVAILABLE',
        'the trusted publish request contract is unavailable'
      );
    }
    return value;
  }

  function options(value) {
    var result = object(
      value,
      'TRUSTED_PUBLISH_CONTEXT_OPTIONS_INVALID',
      'trusted publish context options'
    );
    var now = timestamp(
      result.now,
      'TRUSTED_PUBLISH_CONTEXT_OPTIONS_INVALID',
      'now'
    );
    return {
      ownerAccountId: exactId(
        result.ownerAccountId,
        'TRUSTED_PUBLISH_CONTEXT_OPTIONS_INVALID',
        'ownerAccountId'
      ),
      fleetSnapshotId: exactId(
        result.fleetSnapshotId,
        'TRUSTED_PUBLISH_CONTEXT_OPTIONS_INVALID',
        'fleetSnapshotId'
      ),
      nowMs: Date.parse(now)
    };
  }

  function requireNull(value, code, label) {
    if (value !== null) fail(code, label + ' must be null in this state');
  }

  function requireRequest(value, publish, code) {
    if (value === null) fail(code, 'request is required in this state');
    return publish.normalizeRequest(value);
  }

  function normalizeSubject(value, nullable) {
    var kind;
    var count;
    if (nullable && value === null) return null;
    exactKeys(
      value,
      SUBJECT_KEYS,
      'TRUSTED_PUBLISH_CONTEXT_INVALID',
      'trusted publish subject'
    );
    kind = String(value.kind || '');
    if (!Object.prototype.hasOwnProperty.call(SUBJECT_KIND, kind)) {
      fail('TRUSTED_PUBLISH_CONTEXT_INVALID', 'subject kind is unsupported');
    }
    count = Number(value.test_case_count);
    if (!isFinite(count) || Math.floor(count) !== count || count < 1 || count > 50) {
      fail(
        'TRUSTED_PUBLISH_CONTEXT_INVALID',
        'subject test_case_count must be an integer from 1 to 50'
      );
    }
    return {
      gene_id: exactId(
        value.gene_id,
        'TRUSTED_PUBLISH_CONTEXT_INVALID',
        'subject gene_id'
      ),
      kind: kind,
      from_version: exactId(
        value.from_version,
        'TRUSTED_PUBLISH_CONTEXT_INVALID',
        'subject from_version'
      ),
      version: exactId(
        value.version,
        'TRUSTED_PUBLISH_CONTEXT_INVALID',
        'subject version'
      ),
      test_case_count: count
    };
  }

  function normalize(value, rawOptions) {
    var opts = options(rawOptions);
    var publish = runtime();
    var status;
    var capturedAt;
    var capturedMs;
    var errorCode;
    var request;
    var result;
    var publicError;
    var subject;

    exactKeys(
      value,
      ROOT_KEYS,
      'TRUSTED_PUBLISH_CONTEXT_INVALID',
      'trusted publish context'
    );
    if (value.schema !== SCHEMA) {
      fail('TRUSTED_PUBLISH_CONTEXT_INVALID', 'context schema is unsupported');
    }
    if (exactId(
        value.owner_account_id,
        'TRUSTED_PUBLISH_CONTEXT_INVALID',
        'owner_account_id'
      ) !== opts.ownerAccountId) {
      fail(
        'TRUSTED_PUBLISH_CONTEXT_ACCOUNT_MISMATCH',
        'context owner_account_id does not match the authenticated account'
      );
    }
    if (exactId(
        value.fleet_snapshot_id,
        'TRUSTED_PUBLISH_CONTEXT_INVALID',
        'fleet_snapshot_id'
      ) !== opts.fleetSnapshotId) {
      fail(
        'TRUSTED_PUBLISH_CONTEXT_SNAPSHOT_MISMATCH',
        'context fleet_snapshot_id does not match the current fleet'
      );
    }
    capturedAt = timestamp(
      value.captured_at,
      'TRUSTED_PUBLISH_CONTEXT_INVALID',
      'captured_at'
    );
    capturedMs = Date.parse(capturedAt);
    if (capturedMs < opts.nowMs - MAX_AGE_MS ||
        capturedMs > opts.nowMs + MAX_FUTURE_SKEW_MS) {
      fail(
        'TRUSTED_PUBLISH_CONTEXT_STALE',
        'context captured_at is stale or implausibly future-dated'
      );
    }
    status = String(value.status || '');
    if (!Object.prototype.hasOwnProperty.call(STATUS, status)) {
      fail('TRUSTED_PUBLISH_CONTEXT_INVALID', 'context status is unsupported');
    }
    errorCode = exactErrorCode(
      value.error_code,
      'TRUSTED_PUBLISH_CONTEXT_INVALID',
      'error_code',
      true
    );
    subject = normalizeSubject(value.subject, status === 'NO_DRAFT' ||
      status === 'UNAVAILABLE');

    if (status === 'READY') {
      request = requireRequest(value.request, publish,
        'TRUSTED_PUBLISH_CONTEXT_INVALID');
      requireNull(value.result, 'TRUSTED_PUBLISH_CONTEXT_INVALID', 'result');
      requireNull(value.public_error, 'TRUSTED_PUBLISH_CONTEXT_INVALID',
        'public_error');
      requireNull(errorCode, 'TRUSTED_PUBLISH_CONTEXT_INVALID', 'error_code');
      result = null;
      publicError = null;
    } else if (status === 'NO_DRAFT') {
      requireNull(subject, 'TRUSTED_PUBLISH_CONTEXT_INVALID', 'subject');
      requireNull(value.request, 'TRUSTED_PUBLISH_CONTEXT_INVALID', 'request');
      requireNull(value.result, 'TRUSTED_PUBLISH_CONTEXT_INVALID', 'result');
      requireNull(value.public_error, 'TRUSTED_PUBLISH_CONTEXT_INVALID',
        'public_error');
      requireNull(errorCode, 'TRUSTED_PUBLISH_CONTEXT_INVALID', 'error_code');
      request = null;
      result = null;
      publicError = null;
    } else if (status === 'PUBLISHED') {
      request = requireRequest(value.request, publish,
        'TRUSTED_PUBLISH_CONTEXT_INVALID');
      requireNull(value.public_error, 'TRUSTED_PUBLISH_CONTEXT_INVALID',
        'public_error');
      requireNull(errorCode, 'TRUSTED_PUBLISH_CONTEXT_INVALID', 'error_code');
      result = publish.normalizeSuccess(value.result, request);
      publicError = null;
    } else if (status === 'FAILED' || status === 'OUTCOME_UNKNOWN') {
      request = requireRequest(value.request, publish,
        'TRUSTED_PUBLISH_CONTEXT_INVALID');
      requireNull(value.result, 'TRUSTED_PUBLISH_CONTEXT_INVALID', 'result');
      if (!publish.isPublicErrorCode(errorCode)) {
        fail(
          'TRUSTED_PUBLISH_CONTEXT_INVALID',
          'known outcome must carry one trusted publish error code'
        );
      }
      if ((status === 'OUTCOME_UNKNOWN') !==
          (errorCode === 'PUBLISH_OUTCOME_UNKNOWN')) {
        fail(
          'TRUSTED_PUBLISH_CONTEXT_INVALID',
          'OUTCOME_UNKNOWN must carry only PUBLISH_OUTCOME_UNKNOWN'
        );
      }
      publicError = publish.normalizePublicError(
        value.public_error,
        errorCode
      );
      result = null;
    } else {
      if (publish.isPublicErrorCode(errorCode)) {
        fail(
          'TRUSTED_PUBLISH_CONTEXT_INVALID',
          'UNAVAILABLE must use a technical, not publication, error code'
        );
      }
      if (!errorCode) {
        fail(
          'TRUSTED_PUBLISH_CONTEXT_INVALID',
          'UNAVAILABLE must explain the unavailable source'
        );
      }
      requireNull(value.request, 'TRUSTED_PUBLISH_CONTEXT_INVALID', 'request');
      requireNull(value.result, 'TRUSTED_PUBLISH_CONTEXT_INVALID', 'result');
      requireNull(value.public_error, 'TRUSTED_PUBLISH_CONTEXT_INVALID',
        'public_error');
      request = null;
      result = null;
      publicError = null;
    }

    return deepFreeze({
      schema: SCHEMA,
      owner_account_id: opts.ownerAccountId,
      fleet_snapshot_id: opts.fleetSnapshotId,
      captured_at: capturedAt,
      status: status,
      error_code: errorCode,
      subject: subject,
      request: request,
      result: result,
      public_error: publicError
    });
  }

  function unavailable(rawOptions) {
    var raw = object(
      rawOptions,
      'TRUSTED_PUBLISH_CONTEXT_OPTIONS_INVALID',
      'unavailable trusted publish context options'
    );
    var code = exactErrorCode(
      raw.errorCode,
      'TRUSTED_PUBLISH_CONTEXT_OPTIONS_INVALID',
      'errorCode',
      false
    );
    return normalize({
      schema: SCHEMA,
      owner_account_id: raw.ownerAccountId,
      fleet_snapshot_id: raw.fleetSnapshotId,
      captured_at: raw.now,
      status: 'UNAVAILABLE',
      error_code: code,
      subject: null,
      request: null,
      result: null,
      public_error: null
    }, {
      ownerAccountId: raw.ownerAccountId,
      fleetSnapshotId: raw.fleetSnapshotId,
      now: raw.now
    });
  }

  return Object.freeze({
    SCHEMA: SCHEMA,
    STATUS: Object.freeze(Object.keys(STATUS).sort()),
    normalize: normalize,
    unavailable: unavailable,
    clone: clone
  });
}());
