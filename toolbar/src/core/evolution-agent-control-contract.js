// ── EXTELLA EVOLUTION AGENT CONTROL CONTRACT ─────────────────────────────
// Read-only normalizer for the exact `cabinet.agent_control` block generated
// by extella-agent-standards/tools/build_agent_cabinet.py.  A surface renders
// this canonical contract; it must not invent its own operation list, gates,
// or a second version ledger.

ETB.evolutionAgentControlContract = (function () {
  'use strict';

  var SURFACE = 'agent_control_center';
  var ENGINE = 'ETB.agentControl';
  var SHARED_LEDGER_WITH = 'agent_cabinet';
  var MAX_LOCALIZED_TEXT_LENGTH = 600;
  var ROOT_KEYS = [
    'surface',
    'engine',
    'shared_ledger_with',
    'operations',
    'publish_gates',
    'limits'
  ];
  var OPERATION_KEYS = ['code', 'order', 'ru', 'en', 'requires'];
  var GATE_KEYS = ['code', 'ru', 'en'];
  var LIMIT_KEYS = ['ru', 'en'];
  var OPERATION_SPECS = [
    { code: 'createDraft', order: 1, requires: [] },
    { code: 'analyzeImpact', order: 2, requires: ['createDraft'] },
    { code: 'runPlayground', order: 3, requires: ['createDraft'] },
    {
      code: 'publishDraft',
      order: 4,
      requires: ['analyzeImpact', 'runPlayground']
    },
    { code: 'runActive', order: 5, requires: ['publishDraft'] },
    { code: 'rollback', order: 6, requires: ['publishDraft'] }
  ];
  var PUBLISH_GATE_CODES = [
    'IMPACT_ANALYZED',
    'PLAYGROUND_GREEN',
    'ROLLBACK_AVAILABLE',
    'READ_BACK_CONFIRMED'
  ];
  var LIMIT_COUNT = 4;

  function fail(code, message) {
    var error = new Error(message || code);
    error.code = code;
    throw error;
  }

  function hasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value, key);
  }

  function plainObject(value, code, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        Object.prototype.toString.call(value) !== '[object Object]') {
      fail(code, label + ' must be an object');
    }
    return value;
  }

  function exactKeys(value, expected, code, label) {
    var actual = Object.keys(plainObject(value, code, label)).sort();
    var wanted = expected.slice().sort();
    var i;
    if (actual.length !== wanted.length) {
      fail(code, label + ' must contain only the documented fields');
    }
    for (i = 0; i < wanted.length; i += 1) {
      if (actual[i] !== wanted[i]) {
        fail(code, label + ' must contain only the documented fields');
      }
    }
  }

  function fixedString(value, expected, code, label) {
    if (value !== expected) {
      fail(code, label + ' does not match the canonical Agent Cabinet contract');
    }
    return expected;
  }

  function localizedText(value, language, code, label) {
    var hasExpectedAlphabet;
    if (typeof value !== 'string' || !value ||
        value !== value.replace(/^\s+|\s+$/g, '') ||
        value.length > MAX_LOCALIZED_TEXT_LENGTH ||
        /[<>&\u0000-\u001f\u007f]/.test(value)) {
      fail(code, label + ' must be bounded text without HTML or control characters');
    }
    hasExpectedAlphabet = language === 'ru' ? /[А-Яа-яЁё]/.test(value) :
      /[A-Za-z]/.test(value);
    if (!hasExpectedAlphabet) {
      fail(code, label + ' must contain ' + language + ' localized text');
    }
    return value;
  }

  function exactStringList(value, expected, code, label) {
    var output = [];
    var i;
    if (!Array.isArray(value) || value.length !== expected.length) {
      fail(code, label + ' does not match the canonical dependency list');
    }
    for (i = 0; i < expected.length; i += 1) {
      if (value[i] !== expected[i]) {
        fail(code, label + ' does not match the canonical dependency list');
      }
      output.push(expected[i]);
    }
    return output;
  }

  function normalizeOperation(row, spec, index) {
    var prefix = 'operations[' + index + ']';
    exactKeys(
      row,
      OPERATION_KEYS,
      'AGENT_CONTROL_CONTRACT_OPERATION_INVALID',
      prefix
    );
    return {
      code: fixedString(
        row.code,
        spec.code,
        'AGENT_CONTROL_CONTRACT_OPERATION_SEQUENCE_INVALID',
        prefix + '.code'
      ),
      order: (function () {
        if (row.order !== spec.order) {
          fail(
            'AGENT_CONTROL_CONTRACT_OPERATION_SEQUENCE_INVALID',
            prefix + '.order does not match the canonical operation sequence'
          );
        }
        return spec.order;
      }()),
      ru: localizedText(
        row.ru,
        'ru',
        'AGENT_CONTROL_CONTRACT_LOCALIZED_TEXT_INVALID',
        prefix + '.ru'
      ),
      en: localizedText(
        row.en,
        'en',
        'AGENT_CONTROL_CONTRACT_LOCALIZED_TEXT_INVALID',
        prefix + '.en'
      ),
      requires: exactStringList(
        row.requires,
        spec.requires,
        'AGENT_CONTROL_CONTRACT_OPERATION_SEQUENCE_INVALID',
        prefix + '.requires'
      )
    };
  }

  function normalizeOperations(rows) {
    var output = [];
    var i;
    if (!Array.isArray(rows) || rows.length !== OPERATION_SPECS.length) {
      fail(
        'AGENT_CONTROL_CONTRACT_OPERATIONS_INVALID',
        'operations must contain the six canonical ordered operations'
      );
    }
    for (i = 0; i < OPERATION_SPECS.length; i += 1) {
      output.push(normalizeOperation(rows[i], OPERATION_SPECS[i], i));
    }
    return output;
  }

  function normalizeGate(row, code, index) {
    var prefix = 'publish_gates[' + index + ']';
    exactKeys(
      row,
      GATE_KEYS,
      'AGENT_CONTROL_CONTRACT_GATE_INVALID',
      prefix
    );
    return {
      code: fixedString(
        row.code,
        code,
        'AGENT_CONTROL_CONTRACT_GATE_SEQUENCE_INVALID',
        prefix + '.code'
      ),
      ru: localizedText(
        row.ru,
        'ru',
        'AGENT_CONTROL_CONTRACT_LOCALIZED_TEXT_INVALID',
        prefix + '.ru'
      ),
      en: localizedText(
        row.en,
        'en',
        'AGENT_CONTROL_CONTRACT_LOCALIZED_TEXT_INVALID',
        prefix + '.en'
      )
    };
  }

  function normalizeGates(rows) {
    var output = [];
    var i;
    if (!Array.isArray(rows) || rows.length !== PUBLISH_GATE_CODES.length) {
      fail(
        'AGENT_CONTROL_CONTRACT_GATES_INVALID',
        'publish_gates must contain the four canonical publication gates'
      );
    }
    for (i = 0; i < PUBLISH_GATE_CODES.length; i += 1) {
      output.push(normalizeGate(rows[i], PUBLISH_GATE_CODES[i], i));
    }
    return output;
  }

  function normalizeLimit(row, index) {
    var prefix = 'limits[' + index + ']';
    exactKeys(
      row,
      LIMIT_KEYS,
      'AGENT_CONTROL_CONTRACT_LIMIT_INVALID',
      prefix
    );
    return {
      ru: localizedText(
        row.ru,
        'ru',
        'AGENT_CONTROL_CONTRACT_LOCALIZED_TEXT_INVALID',
        prefix + '.ru'
      ),
      en: localizedText(
        row.en,
        'en',
        'AGENT_CONTROL_CONTRACT_LOCALIZED_TEXT_INVALID',
        prefix + '.en'
      )
    };
  }

  function normalizeLimits(rows) {
    var output = [];
    var i;
    if (!Array.isArray(rows) || rows.length !== LIMIT_COUNT) {
      fail(
        'AGENT_CONTROL_CONTRACT_LIMITS_INVALID',
        'limits must contain the four canonical surface boundaries'
      );
    }
    for (i = 0; i < LIMIT_COUNT; i += 1) {
      output.push(normalizeLimit(rows[i], i));
    }
    return output;
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

  function normalize(input) {
    exactKeys(
      input,
      ROOT_KEYS,
      'AGENT_CONTROL_CONTRACT_INVALID',
      'cabinet.agent_control'
    );
    return deepFreeze({
      surface: fixedString(
        input.surface,
        SURFACE,
        'AGENT_CONTROL_CONTRACT_SURFACE_INVALID',
        'surface'
      ),
      engine: fixedString(
        input.engine,
        ENGINE,
        'AGENT_CONTROL_CONTRACT_ENGINE_INVALID',
        'engine'
      ),
      shared_ledger_with: fixedString(
        input.shared_ledger_with,
        SHARED_LEDGER_WITH,
        'AGENT_CONTROL_CONTRACT_LEDGER_INVALID',
        'shared_ledger_with'
      ),
      operations: normalizeOperations(input.operations),
      publish_gates: normalizeGates(input.publish_gates),
      limits: normalizeLimits(input.limits)
    });
  }

  return deepFreeze({
    SURFACE: SURFACE,
    ENGINE: ENGINE,
    SHARED_LEDGER_WITH: SHARED_LEDGER_WITH,
    OPERATION_CODES: OPERATION_SPECS.map(function (spec) { return spec.code; }),
    PUBLISH_GATE_CODES: PUBLISH_GATE_CODES.slice(),
    LIMIT_COUNT: LIMIT_COUNT,
    normalize: normalize
  });
}());
