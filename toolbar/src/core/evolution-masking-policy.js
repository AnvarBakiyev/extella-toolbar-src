// ── EXTELLA EVOLUTION MASKING POSTURE CONTRACT ────────────────────────────
// Strict, read-only boundary between a local device masking adapter and the
// Evolution Console. This projection deliberately excludes policy bodies,
// field hints, reveal mappings, vault material, raw audit values and PII.

ETB.evolutionMaskingPolicy = (function () {
  'use strict';

  var SCHEMA = 'extella.evolution.masking_posture_snapshot.v1';
  var SOURCE = 'LOCAL_DEVICE';
  var MAX_AGE_MS = 5 * 60 * 1000;
  var MAX_FUTURE_SKEW_MS = 60 * 1000;
  var AVAILABILITY = {
    AVAILABLE: true,
    SOURCE_UNAVAILABLE: true
  };
  var STATUS = {
    ACTIVE: true,
    OFF: true,
    PARTIAL: true,
    UNKNOWN: true
  };
  var PRE_POST_STATUS = {
    ENFORCED: true,
    DISABLED: true,
    PROTOTYPE: true,
    UNAVAILABLE: true,
    UNKNOWN: true
  };
  var REVEAL_STATUS = {
    LOCAL_FILE_ONLY: true,
    UNGUARDED_RAW: true,
    DISABLED: true,
    UNAVAILABLE: true,
    UNKNOWN: true
  };
  var ROLES_STATUS = {
    PLATFORM_ROLES: true,
    LOCAL_SURROGATE: true,
    UNAVAILABLE: true,
    UNKNOWN: true
  };
  var AUDIT_STATUS = {
    AVAILABLE: true,
    UNAVAILABLE: true,
    UNKNOWN: true
  };
  var RISK_CODES = [
    'PRE_NOT_ENFORCED',
    'POST_NOT_ENFORCED',
    'POST_PROTOTYPE_ONLY',
    'REVEAL_OWNER_GUARD_UNAVAILABLE',
    'FIELD_HINTS_NOT_ENFORCED',
    'POLICY_VERSION_MISSING',
    'AUDIT_AGENT_SCOPE_UNAVAILABLE',
    'VAULT_UNAVAILABLE',
    'ROLES_UNAVAILABLE',
    'CROSS_DEVICE_BOUNDARY_UNVERIFIED',
    'SOURCE_UNAVAILABLE'
  ];
  var RISK_CODE_SET = {};
  var ROOT_KEYS = [
    'schema',
    'owner_account_id',
    'fleet_snapshot_id',
    'captured_at',
    'source',
    'availability',
    'error_code',
    'agents'
  ];
  var AGENT_KEYS = [
    'agent_id',
    'status',
    'pre',
    'post',
    'reveal',
    'roles',
    'audit',
    'policy_version',
    'risk_codes'
  ];

  RISK_CODES.forEach(function (code) {
    RISK_CODE_SET[code] = true;
  });

  function fail(code, message) {
    var error = new Error(message || code);
    error.code = code;
    throw error;
  }

  function hasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value, key);
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
    var i;
    if (actual.length !== wanted.length) {
      fail(code, label + ' must contain only the documented posture fields');
    }
    for (i = 0; i < wanted.length; i += 1) {
      if (actual[i] !== wanted[i]) {
        fail(code, label + ' must contain only the documented posture fields');
      }
    }
  }

  function exactId(value, code, label) {
    if (typeof value !== 'string' || !value ||
        value !== value.replace(/^\s+|\s+$/g, '') ||
        value.length > 240 ||
        !/^[A-Za-z0-9][A-Za-z0-9._:@/+()-]{0,239}$/.test(value)) {
      fail(code, label + ' must be an exact bounded identifier');
    }
    return value;
  }

  function exactIds(values, code, label) {
    var seen = {};
    var output = [];
    var i;
    var id;
    if (!Array.isArray(values)) {
      fail(code, label + ' must be an array');
    }
    for (i = 0; i < values.length; i += 1) {
      id = exactId(values[i], code, label + '[' + i + ']');
      if (hasOwn(seen, id)) {
        fail(code, label + ' contains duplicate id ' + id);
      }
      seen[id] = true;
      output.push(id);
    }
    return output.sort();
  }

  function enumValue(value, allowed, code, label) {
    if (typeof value !== 'string' || !hasOwn(allowed, value)) {
      fail(code, label + ' has an unsupported value');
    }
    return value;
  }

  function timestamp(value, code, label) {
    var text;
    var parsed;
    var field = label || 'captured_at';
    if (typeof value !== 'string') {
      fail(code, field + ' must be an ISO-8601 timestamp');
    }
    text = value;
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(text)) {
      fail(code, field + ' must include an explicit timezone');
    }
    parsed = Date.parse(text);
    if (!isFinite(parsed)) {
      fail(code, field + ' must be a valid ISO-8601 timestamp');
    }
    return text;
  }

  function errorCode(value, availability) {
    if (availability === 'AVAILABLE') {
      if (value !== null) {
        fail(
          'MASKING_POSTURE_ERROR_CODE_INVALID',
          'error_code must be null when the local source is available'
        );
      }
      return null;
    }
    if (typeof value !== 'string' ||
        !/^[A-Z][A-Z0-9_]{0,63}$/.test(value)) {
      fail(
        'MASKING_POSTURE_ERROR_CODE_INVALID',
        'error_code must identify why the local source is unavailable'
      );
    }
    return value;
  }

  function policyVersion(value) {
    if (value === null) return null;
    if (typeof value !== 'string' ||
        !/^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/.test(value)) {
      fail(
        'MASKING_POSTURE_POLICY_VERSION_INVALID',
        'policy_version must be null or a bounded version identifier'
      );
    }
    return value;
  }

  function riskCodes(values) {
    var output = [];
    var seen = {};
    var i;
    var code;
    if (!Array.isArray(values)) {
      fail(
        'MASKING_POSTURE_RISK_CODES_INVALID',
        'risk_codes must be an array'
      );
    }
    for (i = 0; i < values.length; i += 1) {
      code = values[i];
      if (typeof code !== 'string' || !hasOwn(RISK_CODE_SET, code)) {
        fail(
          'MASKING_POSTURE_RISK_CODE_UNSUPPORTED',
          'risk_codes contains a value outside the fixed allowlist'
        );
      }
      if (hasOwn(seen, code)) {
        fail(
          'MASKING_POSTURE_RISK_CODES_INVALID',
          'risk_codes must not contain duplicates'
        );
      }
      seen[code] = true;
      output.push(code);
    }
    return output.sort();
  }

  function deriveStatus(pre, post) {
    if (pre === 'ENFORCED' && post === 'ENFORCED') return 'ACTIVE';
    if (pre === 'DISABLED' && post === 'DISABLED') return 'OFF';
    if (pre === 'UNAVAILABLE' || pre === 'UNKNOWN' ||
        post === 'UNAVAILABLE' || post === 'UNKNOWN') {
      return 'UNKNOWN';
    }
    return 'PARTIAL';
  }

  function normalizeAgent(row) {
    var normalized;
    var derived;
    exactKeys(
      row,
      AGENT_KEYS,
      'MASKING_POSTURE_AGENT_INVALID',
      'masking posture agent'
    );
    normalized = {
      agent_id: exactId(
        row.agent_id,
        'MASKING_POSTURE_AGENT_ID_INVALID',
        'agent_id'
      ),
      status: enumValue(
        row.status,
        STATUS,
        'MASKING_POSTURE_STATUS_INVALID',
        'status'
      ),
      pre: enumValue(
        row.pre,
        PRE_POST_STATUS,
        'MASKING_POSTURE_PRE_INVALID',
        'pre'
      ),
      post: enumValue(
        row.post,
        PRE_POST_STATUS,
        'MASKING_POSTURE_POST_INVALID',
        'post'
      ),
      reveal: enumValue(
        row.reveal,
        REVEAL_STATUS,
        'MASKING_POSTURE_REVEAL_INVALID',
        'reveal'
      ),
      roles: enumValue(
        row.roles,
        ROLES_STATUS,
        'MASKING_POSTURE_ROLES_INVALID',
        'roles'
      ),
      audit: enumValue(
        row.audit,
        AUDIT_STATUS,
        'MASKING_POSTURE_AUDIT_INVALID',
        'audit'
      ),
      policy_version: policyVersion(row.policy_version),
      risk_codes: riskCodes(row.risk_codes)
    };
    derived = deriveStatus(normalized.pre, normalized.post);
    if (normalized.status !== derived) {
      fail(
        'MASKING_POSTURE_STATUS_MISMATCH',
        'status must be derived from the exact PRE and POST posture'
      );
    }
    normalized.status = derived;
    return normalized;
  }

  function isUnavailableAgent(row) {
    return row.status === 'UNKNOWN' &&
      row.pre === 'UNAVAILABLE' &&
      row.post === 'UNAVAILABLE' &&
      row.reveal === 'UNAVAILABLE' &&
      row.roles === 'UNAVAILABLE' &&
      row.audit === 'UNAVAILABLE' &&
      row.policy_version === null &&
      row.risk_codes.length === 1 &&
      row.risk_codes[0] === 'SOURCE_UNAVAILABLE';
  }

  function deepFreeze(value) {
    var keys;
    var i;
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
      return value;
    }
    keys = Object.keys(value);
    for (i = 0; i < keys.length; i += 1) {
      deepFreeze(value[keys[i]]);
    }
    return Object.freeze(value);
  }

  function normalizeSnapshot(input, options) {
    var opts = object(
      options,
      'MASKING_POSTURE_OPTIONS_INVALID',
      'masking posture options'
    );
    var expectedAgentIds = exactIds(
      opts.expectedAgentIds,
      'MASKING_POSTURE_EXPECTED_AGENTS_INVALID',
      'expectedAgentIds'
    );
    var expectedById = {};
    var seen = {};
    var agents = [];
    var ownerAccountId = exactId(
      opts.ownerAccountId,
      'MASKING_POSTURE_OWNER_INVALID',
      'ownerAccountId'
    );
    var fleetSnapshotId = exactId(
      opts.fleetSnapshotId,
      'MASKING_POSTURE_FLEET_INVALID',
      'fleetSnapshotId'
    );
    var now = timestamp(
      opts.now,
      'MASKING_POSTURE_NOW_INVALID',
      'normalization now'
    );
    var availability;
    var normalized;
    var capturedAt;
    var capturedMs;
    var nowMs;
    var i;
    var row;

    exactKeys(
      input,
      ROOT_KEYS,
      'MASKING_POSTURE_SNAPSHOT_INVALID',
      'masking posture snapshot'
    );
    if (input.schema !== SCHEMA) {
      fail(
        'MASKING_POSTURE_SCHEMA_INVALID',
        'masking posture snapshot schema is unsupported'
      );
    }
    if (input.owner_account_id !== ownerAccountId) {
      fail(
        'MASKING_POSTURE_OWNER_MISMATCH',
        'owner_account_id does not match the authenticated account'
      );
    }
    if (input.fleet_snapshot_id !== fleetSnapshotId) {
      fail(
        'MASKING_POSTURE_FLEET_MISMATCH',
        'fleet_snapshot_id does not match the active fleet snapshot'
      );
    }
    if (input.source !== SOURCE) {
      fail(
        'MASKING_POSTURE_SOURCE_INVALID',
        'masking posture source must be LOCAL_DEVICE'
      );
    }
    availability = enumValue(
      input.availability,
      AVAILABILITY,
      'MASKING_POSTURE_AVAILABILITY_INVALID',
      'availability'
    );
    capturedAt = timestamp(
      input.captured_at,
      'MASKING_POSTURE_CAPTURED_AT_INVALID'
    );
    capturedMs = Date.parse(capturedAt);
    nowMs = Date.parse(now);
    if (capturedMs < nowMs - MAX_AGE_MS ||
        capturedMs > nowMs + MAX_FUTURE_SKEW_MS) {
      fail(
        'MASKING_POSTURE_STALE',
        'captured_at is outside the accepted local posture freshness window'
      );
    }
    if (!Array.isArray(input.agents)) {
      fail(
        'MASKING_POSTURE_AGENTS_INVALID',
        'agents must be an array'
      );
    }

    for (i = 0; i < expectedAgentIds.length; i += 1) {
      expectedById[expectedAgentIds[i]] = true;
    }
    for (i = 0; i < input.agents.length; i += 1) {
      row = normalizeAgent(input.agents[i]);
      if (!hasOwn(expectedById, row.agent_id)) {
        fail(
          'MASKING_POSTURE_AGENT_SET_MISMATCH',
          'snapshot contains an agent outside the active fleet'
        );
      }
      if (hasOwn(seen, row.agent_id)) {
        fail(
          'MASKING_POSTURE_AGENT_SET_MISMATCH',
          'snapshot contains a duplicate agent'
        );
      }
      seen[row.agent_id] = true;
      agents.push(row);
    }
    if (agents.length !== expectedAgentIds.length) {
      fail(
        'MASKING_POSTURE_AGENT_SET_MISMATCH',
        'snapshot must cover the exact active fleet'
      );
    }
    for (i = 0; i < expectedAgentIds.length; i += 1) {
      if (!hasOwn(seen, expectedAgentIds[i])) {
        fail(
          'MASKING_POSTURE_AGENT_SET_MISMATCH',
          'snapshot must cover the exact active fleet'
        );
      }
    }
    agents.sort(function (left, right) {
      if (left.agent_id < right.agent_id) return -1;
      if (left.agent_id > right.agent_id) return 1;
      return 0;
    });
    if (availability === 'SOURCE_UNAVAILABLE') {
      for (i = 0; i < agents.length; i += 1) {
        if (!isUnavailableAgent(agents[i])) {
          fail(
            'MASKING_POSTURE_UNAVAILABLE_CLAIM_INVALID',
            'an unavailable source cannot publish stale posture claims'
          );
        }
      }
    }

    normalized = {
      schema: SCHEMA,
      owner_account_id: ownerAccountId,
      fleet_snapshot_id: fleetSnapshotId,
      captured_at: capturedAt,
      source: SOURCE,
      availability: availability,
      error_code: errorCode(input.error_code, availability),
      agents: agents
    };
    return deepFreeze(normalized);
  }

  function unavailableSnapshot(options) {
    var opts = object(
      options,
      'MASKING_POSTURE_OPTIONS_INVALID',
      'masking posture unavailable options'
    );
    var ownerAccountId = exactId(
      opts.ownerAccountId,
      'MASKING_POSTURE_OWNER_INVALID',
      'ownerAccountId'
    );
    var fleetSnapshotId = exactId(
      opts.fleetSnapshotId,
      'MASKING_POSTURE_FLEET_INVALID',
      'fleetSnapshotId'
    );
    var expectedAgentIds = exactIds(
      opts.expectedAgentIds,
      'MASKING_POSTURE_EXPECTED_AGENTS_INVALID',
      'expectedAgentIds'
    );
    var capturedAt = typeof opts.capturedAt === 'undefined' ?
      new Date().toISOString() : opts.capturedAt;
    var snapshot = {
      schema: SCHEMA,
      owner_account_id: ownerAccountId,
      fleet_snapshot_id: fleetSnapshotId,
      captured_at: capturedAt,
      source: SOURCE,
      availability: 'SOURCE_UNAVAILABLE',
      error_code: opts.errorCode,
      agents: expectedAgentIds.map(function (agentId) {
        return {
          agent_id: agentId,
          status: 'UNKNOWN',
          pre: 'UNAVAILABLE',
          post: 'UNAVAILABLE',
          reveal: 'UNAVAILABLE',
          roles: 'UNAVAILABLE',
          audit: 'UNAVAILABLE',
          policy_version: null,
          risk_codes: ['SOURCE_UNAVAILABLE']
        };
      })
    };
    return normalizeSnapshot(snapshot, {
      ownerAccountId: ownerAccountId,
      fleetSnapshotId: fleetSnapshotId,
      expectedAgentIds: expectedAgentIds,
      now: capturedAt
    });
  }

  return deepFreeze({
    SCHEMA: SCHEMA,
    SOURCE: SOURCE,
    MAX_AGE_MS: MAX_AGE_MS,
    MAX_FUTURE_SKEW_MS: MAX_FUTURE_SKEW_MS,
    AVAILABILITY: Object.keys(AVAILABILITY).sort(),
    STATUSES: Object.keys(STATUS).sort(),
    PRE_POST_STATUSES: Object.keys(PRE_POST_STATUS).sort(),
    REVEAL_STATUSES: Object.keys(REVEAL_STATUS).sort(),
    ROLES_STATUSES: Object.keys(ROLES_STATUS).sort(),
    AUDIT_STATUSES: Object.keys(AUDIT_STATUS).sort(),
    RISK_CODES: RISK_CODES.slice(),
    deriveStatus: deriveStatus,
    normalizeSnapshot: normalizeSnapshot,
    unavailableSnapshot: unavailableSnapshot
  });
}());
