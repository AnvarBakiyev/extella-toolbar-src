// ── EXTELLA EVOLUTION · MCP READ CONTRACT ────────────────────────────────
// Closed schemas and validation for the declared MCP topology shown by
// Evolution Console and Agent Cabinet.
//
// This module performs no I/O, stores no state and never reads credential
// values. A registry may contain an opaque credential reference, never the
// credential itself.

ETB.evolutionMcpContract = (function () {
  'use strict';

  var CONTRACT_SCHEMA = 'extella.evolution.mcp_read_contract.v1';
  var REGISTRY_SCHEMA = 'extella.evolution.mcp_registry.v1';
  var RESPONSE_SCHEMA = 'extella.evolution.mcp_read_response.v1';
  var SNAPSHOT_SCHEMA = 'extella.evolution.mcp_read_snapshot.v1';
  var AUTOMATION_ID = /^[a-z0-9][a-z0-9._-]{1,79}$/;
  var OBJECT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$/;
  var SEMVER =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
  var SHA256 = /^[a-f0-9]{64}$/;
  var ISO_TIMESTAMP =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;
  var CREDENTIAL_REF =
    /^(?:credential|vault|keychain):[A-Za-z0-9._:/-]{1,200}$/;
  var SECRET_KEY =
    /^(?:password|passwd|token|access_token|refresh_token|api_key|apikey|secret|client_secret|authorization|cookie|private_key|credential_value)$/i;
  var SECRET_VALUE = new RegExp([
    '-----BEGIN [A-Z ]*PRIVATE KEY-----',
    '\\bBearer\\s+[A-Za-z0-9._~+/-]{8,}={0,2}\\b',
    '\\b(?:sk|ghp|github_pat|xox[abprs])[-_][A-Za-z0-9_-]{12,}\\b',
    '[?&](?:token|access[_-]?token|refresh[_-]?token|api[_-]?key|apikey|client[_-]?secret|secret|password)='
  ].join('|'), 'i');

  var ROOT_KEYS = [
    'bindings',
    'checked_at',
    'complete',
    'connections',
    'extensions',
    'owner_account_id',
    'run_evidence',
    'schema',
    'source',
    'tools',
    'warnings'
  ];
  var READ_TOOLS = [
    {
      name: 'automations.list',
      description_ru: 'Список бизнес-автоматизаций текущего аккаунта',
      description_en: 'List business automations in the current account',
      arguments: ['cursor', 'installed', 'limit']
    },
    {
      name: 'automations.get',
      description_ru: 'Факты одной бизнес-автоматизации',
      description_en: 'Facts for one business automation',
      arguments: ['automation_id']
    },
    {
      name: 'automations.get_state',
      description_ru: 'Честное состояние одной автоматизации',
      description_en: 'Honest state of one automation',
      arguments: ['automation_id']
    },
    {
      name: 'automations.get_composition',
      description_ru: 'Состав автоматизации и привязки внутренних агентов',
      description_en: 'Automation composition and internal-agent bindings',
      arguments: ['automation_id']
    },
    {
      name: 'mcp.connections.list',
      description_ru: 'MCP Connections одной автоматизации',
      description_en: 'MCP Connections for one automation',
      arguments: ['automation_id', 'cursor', 'limit']
    },
    {
      name: 'mcp.tools.list',
      description_ru: 'Tool Contracts одной автоматизации',
      description_en: 'Tool Contracts for one automation',
      arguments: ['automation_id', 'cursor', 'limit']
    },
    {
      name: 'mcp.extensions.list',
      description_ru: 'MCP Extensions, используемые автоматизацией',
      description_en: 'MCP Extensions used by an automation',
      arguments: ['automation_id', 'cursor', 'limit']
    },
    {
      name: 'mcp.bindings.list',
      description_ru: 'Effective Tool Bindings внутренних агентов',
      description_en: 'Effective Tool Bindings for internal agents',
      arguments: [
        'automation_id',
        'cursor',
        'limit',
        'platform_agent_id'
      ]
    },
    {
      name: 'runs.get_evidence',
      description_ru: 'Последние Run Evidence без payload и секретов',
      description_en: 'Latest Run Evidence without payloads or secrets',
      arguments: [
        'automation_id',
        'cursor',
        'limit',
        'platform_agent_id',
        'tool_id'
      ]
    }
  ];

  function fail(code, message) {
    var error = new Error(message || code);
    error.code = code;
    throw error;
  }

  function hasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value, key);
  }

  function object(value) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
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

  function text(value, code, label, maxLength) {
    var result = String(value == null ? '' : value).trim();
    if (!result || result.length > (maxLength || 240)) {
      fail(code, label + ' is required and must be bounded');
    }
    return result;
  }

  function exactKeys(value, expected, code, label) {
    var actual;
    var sortedExpected = expected.slice().sort();
    if (!object(value)) fail(code, label + ' must be an object');
    actual = Object.keys(value).sort();
    if (JSON.stringify(actual) !== JSON.stringify(sortedExpected)) {
      fail(code, label + ' has missing or unknown fields');
    }
  }

  function exactId(value, code, label) {
    var result = text(value, code, label);
    if (!OBJECT_ID.test(result) || /[*?\[\]{}]/.test(result)) {
      fail(code, label + ' must be an exact canonical id');
    }
    return result;
  }

  function automationId(value, code, label) {
    var result = text(value, code, label, 80);
    if (!AUTOMATION_ID.test(result)) {
      fail(code, label + ' must be a canonical automation_id');
    }
    return result;
  }

  function timestamp(value, code, label, nullable) {
    if (nullable && value === null) return null;
    var result = text(value, code, label);
    if (!ISO_TIMESTAMP.test(result) || !isFinite(Date.parse(result))) {
      fail(code, label + ' must be an ISO timestamp with an explicit offset');
    }
    return result;
  }

  function semver(value, code, label) {
    var result = text(value, code, label, 120);
    if (!SEMVER.test(result)) fail(code, label + ' must be SemVer 2.0');
    return result;
  }

  function sha256(value, code, label, nullable) {
    if (nullable && value === null) return null;
    var result = String(value == null ? '' : value);
    if (!SHA256.test(result)) fail(code, label + ' must be SHA-256');
    return result;
  }

  function enumValue(value, allowed, code, label) {
    var result = String(value == null ? '' : value);
    if (allowed.indexOf(result) === -1) {
      fail(code, label + ' has an unsupported value');
    }
    return result;
  }

  function uniqueStrings(values, code, label, allowEmpty) {
    var seen = {};
    var output = [];
    if (!Array.isArray(values) || (!allowEmpty && !values.length)) {
      fail(code, label + ' must be an array');
    }
    values.forEach(function (value) {
      var item = exactId(value, code, label + ' item');
      if (seen[item]) fail(code, label + ' contains a duplicate');
      seen[item] = true;
      output.push(item);
    });
    return output;
  }

  function localizedName(value, code, label) {
    exactKeys(value, ['en', 'ru'], code, label);
    text(value.ru, code, label + '.ru', 500);
    text(value.en, code, label + '.en', 500);
  }

  function secretKey(value) {
    var raw = String(value == null ? '' : value);
    var candidates = [raw].concat(raw.split(/[.\[\]]+/));
    return candidates.some(function (candidate) {
      var normalized = candidate
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .replace(/[^A-Za-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
      return SECRET_KEY.test(normalized);
    });
  }

  function assertNoSecrets(value, path, seen) {
    var keys;
    var nextPath;
    var i;
    if (value === null || typeof value === 'undefined') return;
    if (typeof value === 'string') {
      if (SECRET_VALUE.test(value)) {
        fail(
          'MCP_SECRET_VALUE_FORBIDDEN',
          'secret-like value is forbidden at ' + path
        );
      }
      return;
    }
    if (typeof value !== 'object') return;
    seen = seen || [];
    if (seen.indexOf(value) !== -1) {
      fail('MCP_REGISTRY_CYCLE', 'cyclic values are forbidden at ' + path);
    }
    seen.push(value);
    if (Array.isArray(value)) {
      for (i = 0; i < value.length; i += 1) {
        assertNoSecrets(value[i], path + '[' + i + ']', seen);
      }
      seen.pop();
      return;
    }
    keys = Object.keys(value);
    for (i = 0; i < keys.length; i += 1) {
      nextPath = path + '.' + keys[i];
      if (secretKey(keys[i])) {
        fail(
          'MCP_SECRET_FIELD_FORBIDDEN',
          'secret-like field is forbidden at ' + nextPath
        );
      }
      assertNoSecrets(value[keys[i]], nextPath, seen);
    }
    seen.pop();
  }

  function provenance(value, code, label) {
    exactKeys(
      value,
      ['kind', 'sha256', 'source_id', 'source_version'],
      code,
      label
    );
    enumValue(value.kind, ['local', 'shared'], code, label + '.kind');
    exactId(value.source_id, code, label + '.source_id');
    semver(value.source_version, code, label + '.source_version');
    sha256(value.sha256, code, label + '.sha256');
  }

  function source(value) {
    exactKeys(
      value,
      ['id', 'kind', 'sha256', 'version'],
      'MCP_REGISTRY_SOURCE_INVALID',
      'registry source'
    );
    enumValue(
      value.kind,
      [
        'ACCOUNT_SCOPED_HOST_PROVIDER',
        'AUTOMATION_PASSPORT',
        'DEMO_FIXTURE',
        'UNAVAILABLE'
      ],
      'MCP_REGISTRY_SOURCE_INVALID',
      'registry source.kind'
    );
    exactId(
      value.id,
      'MCP_REGISTRY_SOURCE_INVALID',
      'registry source.id'
    );
    semver(
      value.version,
      'MCP_REGISTRY_SOURCE_INVALID',
      'registry source.version'
    );
    if (value.kind === 'UNAVAILABLE') {
      if (value.sha256 !== null) {
        fail(
          'MCP_REGISTRY_SOURCE_INVALID',
          'an unavailable registry source cannot claim a content hash'
        );
      }
    } else {
      sha256(
        value.sha256,
        'MCP_REGISTRY_SOURCE_INVALID',
        'registry source.sha256'
      );
    }
  }

  function jsonSchema(value, code, label) {
    if (!object(value)) fail(code, label + ' must be a JSON Schema object');
    if (value.type !== 'object' || value.additionalProperties !== false ||
        !object(value.properties)) {
      fail(
        code,
        label + ' must be a closed object schema with properties'
      );
    }
    assertNoSecrets(value, label);
  }

  function health(value) {
    exactKeys(
      value,
      ['checked_at', 'status'],
      'MCP_CONNECTION_HEALTH_INVALID',
      'connection health'
    );
    enumValue(
      value.status,
      ['UP', 'DOWN', 'UNKNOWN'],
      'MCP_CONNECTION_HEALTH_INVALID',
      'connection health.status'
    );
    timestamp(
      value.checked_at,
      'MCP_CONNECTION_HEALTH_INVALID',
      'connection health.checked_at',
      true
    );
  }

  function endpoint(value, transport) {
    var match;
    var authority;
    var query;
    if (value === null) {
      if (transport === 'streamable_http' || transport === 'sse') {
        fail(
          'MCP_CONNECTION_INVALID',
          'HTTP and SSE connections require an exact endpoint'
        );
      }
      return;
    }
    value = text(
      value,
      'MCP_CONNECTION_INVALID',
      'connection endpoint',
      500
    );
    if (transport !== 'streamable_http' && transport !== 'sse') return;
    match = /^(https?):\/\/([^/?#]+)([^?#]*)(?:\?([^#]*))?(?:#.*)?$/i.exec(
      value
    );
    if (!match) {
      fail(
        'MCP_CONNECTION_INVALID',
        'HTTP and SSE endpoints must use an exact http or https URL'
      );
    }
    authority = match[2];
    if (authority.indexOf('@') !== -1 || /[\s\\]/.test(authority)) {
      fail(
        'MCP_CONNECTION_INVALID',
        'connection endpoint must not contain URL userinfo'
      );
    }
    query = match[4] || '';
    if (!query) return;
    query.split('&').forEach(function (part) {
      var rawKey = String(part || '').split('=')[0].replace(/\+/g, ' ');
      var decodedKey;
      try {
        decodedKey = decodeURIComponent(rawKey);
      } catch (_) {
        fail(
          'MCP_CONNECTION_INVALID',
          'connection endpoint query key is invalid'
        );
      }
      if (secretKey(decodedKey)) {
        fail(
          'MCP_SECRET_VALUE_FORBIDDEN',
          'connection endpoint must not contain secret query parameters'
        );
      }
    });
  }

  function connection(value) {
    exactKeys(
      value,
      [
        'automation_id',
        'connection_id',
        'credential_ref',
        'endpoint',
        'health',
        'name',
        'provenance',
        'transport'
      ],
      'MCP_CONNECTION_INVALID',
      'MCP Connection'
    );
    exactId(
      value.connection_id,
      'MCP_CONNECTION_INVALID',
      'connection_id'
    );
    automationId(
      value.automation_id,
      'MCP_CONNECTION_INVALID',
      'connection automation_id'
    );
    localizedName(value.name, 'MCP_CONNECTION_INVALID', 'connection name');
    enumValue(
      value.transport,
      ['stdio', 'streamable_http', 'sse'],
      'MCP_CONNECTION_INVALID',
      'connection transport'
    );
    endpoint(value.endpoint, value.transport);
    if (value.credential_ref !== null &&
        !CREDENTIAL_REF.test(String(value.credential_ref))) {
      fail(
        'MCP_CONNECTION_INVALID',
        'credential_ref must be an opaque credential-store reference'
      );
    }
    health(value.health);
    provenance(
      value.provenance,
      'MCP_CONNECTION_INVALID',
      'connection provenance'
    );
  }

  function tool(value) {
    var expectedSideEffect;
    exactKeys(
      value,
      [
        'automation_id',
        'connection_id',
        'input_schema',
        'name',
        'output_schema',
        'permissions',
        'provenance',
        'risk_class',
        'side_effects',
        'timeout_ms',
        'tool_id',
        'version'
      ],
      'MCP_TOOL_CONTRACT_INVALID',
      'Tool Contract'
    );
    exactId(value.tool_id, 'MCP_TOOL_CONTRACT_INVALID', 'tool_id');
    exactId(
      value.connection_id,
      'MCP_TOOL_CONTRACT_INVALID',
      'tool connection_id'
    );
    automationId(
      value.automation_id,
      'MCP_TOOL_CONTRACT_INVALID',
      'tool automation_id'
    );
    localizedName(value.name, 'MCP_TOOL_CONTRACT_INVALID', 'tool name');
    semver(value.version, 'MCP_TOOL_CONTRACT_INVALID', 'tool version');
    jsonSchema(
      value.input_schema,
      'MCP_TOOL_CONTRACT_INVALID',
      'tool input_schema'
    );
    jsonSchema(
      value.output_schema,
      'MCP_TOOL_CONTRACT_INVALID',
      'tool output_schema'
    );
    enumValue(
      value.risk_class,
      ['read', 'reversible_write', 'irreversible_or_external_write'],
      'MCP_TOOL_CONTRACT_INVALID',
      'tool risk_class'
    );
    enumValue(
      value.side_effects,
      ['none', 'reversible', 'external'],
      'MCP_TOOL_CONTRACT_INVALID',
      'tool side_effects'
    );
    expectedSideEffect = {
      read: 'none',
      reversible_write: 'reversible',
      irreversible_or_external_write: 'external'
    }[value.risk_class];
    if (expectedSideEffect !== value.side_effects) {
      fail(
        'MCP_TOOL_CONTRACT_INVALID',
        'tool risk_class and side_effects disagree'
      );
    }
    if (!Number.isInteger(value.timeout_ms) ||
        value.timeout_ms < 1 || value.timeout_ms > 300000) {
      fail(
        'MCP_TOOL_CONTRACT_INVALID',
        'tool timeout_ms must be between 1 and 300000'
      );
    }
    uniqueStrings(
      value.permissions,
      'MCP_TOOL_CONTRACT_INVALID',
      'tool permissions',
      true
    );
    provenance(
      value.provenance,
      'MCP_TOOL_CONTRACT_INVALID',
      'tool provenance'
    );
  }

  function extension(value) {
    var hooks;
    exactKeys(
      value,
      [
        'automation_ids',
        'extension_id',
        'hooks',
        'name',
        'package_sha256',
        'provenance',
        'version'
      ],
      'MCP_EXTENSION_INVALID',
      'MCP Extension'
    );
    exactId(
      value.extension_id,
      'MCP_EXTENSION_INVALID',
      'extension_id'
    );
    localizedName(value.name, 'MCP_EXTENSION_INVALID', 'extension name');
    semver(value.version, 'MCP_EXTENSION_INVALID', 'extension version');
    uniqueStrings(
      value.automation_ids,
      'MCP_EXTENSION_INVALID',
      'extension automation_ids',
      false
    ).forEach(function (id) {
      automationId(id, 'MCP_EXTENSION_INVALID', 'extension automation_id');
    });
    hooks = uniqueStrings(
      value.hooks,
      'MCP_EXTENSION_INVALID',
      'extension hooks',
      false
    );
    hooks.forEach(function (hook) {
      enumValue(
        hook,
        ['after_call', 'authorize', 'before_call', 'on_error', 'on_timeout'],
        'MCP_EXTENSION_INVALID',
        'extension hook'
      );
    });
    sha256(
      value.package_sha256,
      'MCP_EXTENSION_INVALID',
      'extension package_sha256'
    );
    provenance(
      value.provenance,
      'MCP_EXTENSION_INVALID',
      'extension provenance'
    );
  }

  function permissionPolicy(value) {
    exactKeys(
      value,
      ['allow', 'deny'],
      'MCP_BINDING_INVALID',
      'binding permission_policy'
    );
    uniqueStrings(
      value.allow,
      'MCP_BINDING_INVALID',
      'binding permission_policy.allow',
      true
    );
    uniqueStrings(
      value.deny,
      'MCP_BINDING_INVALID',
      'binding permission_policy.deny',
      true
    );
  }

  function binding(value) {
    exactKeys(
      value,
      [
        'automation_id',
        'binding_id',
        'enabled',
        'extension_ids',
        'permission_policy',
        'platform_agent_id',
        'provenance',
        'tool_id'
      ],
      'MCP_BINDING_INVALID',
      'Tool Binding'
    );
    exactId(value.binding_id, 'MCP_BINDING_INVALID', 'binding_id');
    automationId(
      value.automation_id,
      'MCP_BINDING_INVALID',
      'binding automation_id'
    );
    exactId(
      value.platform_agent_id,
      'MCP_BINDING_INVALID',
      'binding platform_agent_id'
    );
    exactId(value.tool_id, 'MCP_BINDING_INVALID', 'binding tool_id');
    uniqueStrings(
      value.extension_ids,
      'MCP_BINDING_INVALID',
      'binding extension_ids',
      true
    );
    if (value.enabled !== true && value.enabled !== false &&
        value.enabled !== 'UNKNOWN') {
      fail(
        'MCP_BINDING_INVALID',
        'binding enabled must be true, false or UNKNOWN'
      );
    }
    permissionPolicy(value.permission_policy);
    provenance(
      value.provenance,
      'MCP_BINDING_INVALID',
      'binding provenance'
    );
  }

  function evidenceCost(value) {
    if (value === null) return;
    exactKeys(
      value,
      ['amount', 'currency', 'estimated'],
      'MCP_RUN_EVIDENCE_INVALID',
      'Run Evidence cost'
    );
    if (typeof value.amount !== 'number' ||
        !isFinite(value.amount) || value.amount < 0) {
      fail('MCP_RUN_EVIDENCE_INVALID', 'evidence cost.amount is invalid');
    }
    if (!/^[A-Z]{3}$/.test(String(value.currency || ''))) {
      fail('MCP_RUN_EVIDENCE_INVALID', 'evidence cost.currency is invalid');
    }
    if (typeof value.estimated !== 'boolean') {
      fail('MCP_RUN_EVIDENCE_INVALID', 'evidence cost.estimated is invalid');
    }
  }

  function runEvidence(value) {
    exactKeys(
      value,
      [
        'automation_id',
        'binding_id',
        'cost',
        'evidence_id',
        'input_sha256',
        'latency_ms',
        'occurred_at',
        'output_sha256',
        'platform_agent_id',
        'provenance',
        'status',
        'tool_id'
      ],
      'MCP_RUN_EVIDENCE_INVALID',
      'Run Evidence'
    );
    exactId(
      value.evidence_id,
      'MCP_RUN_EVIDENCE_INVALID',
      'evidence_id'
    );
    automationId(
      value.automation_id,
      'MCP_RUN_EVIDENCE_INVALID',
      'evidence automation_id'
    );
    exactId(
      value.platform_agent_id,
      'MCP_RUN_EVIDENCE_INVALID',
      'evidence platform_agent_id'
    );
    exactId(value.tool_id, 'MCP_RUN_EVIDENCE_INVALID', 'evidence tool_id');
    exactId(
      value.binding_id,
      'MCP_RUN_EVIDENCE_INVALID',
      'evidence binding_id'
    );
    timestamp(
      value.occurred_at,
      'MCP_RUN_EVIDENCE_INVALID',
      'evidence occurred_at'
    );
    enumValue(
      value.status,
      ['FAILED', 'PARTIAL', 'SUCCEEDED', 'UNKNOWN'],
      'MCP_RUN_EVIDENCE_INVALID',
      'evidence status'
    );
    if (value.latency_ms !== null &&
        (!Number.isInteger(value.latency_ms) ||
         value.latency_ms < 0 || value.latency_ms > 86400000)) {
      fail(
        'MCP_RUN_EVIDENCE_INVALID',
        'evidence latency_ms is invalid'
      );
    }
    evidenceCost(value.cost);
    sha256(
      value.input_sha256,
      'MCP_RUN_EVIDENCE_INVALID',
      'evidence input_sha256',
      true
    );
    sha256(
      value.output_sha256,
      'MCP_RUN_EVIDENCE_INVALID',
      'evidence output_sha256',
      true
    );
    provenance(
      value.provenance,
      'MCP_RUN_EVIDENCE_INVALID',
      'evidence provenance'
    );
  }

  function warning(value) {
    exactKeys(
      value,
      ['code', 'message_en', 'message_ru', 'source'],
      'MCP_REGISTRY_WARNING_INVALID',
      'registry warning'
    );
    exactId(
      value.code,
      'MCP_REGISTRY_WARNING_INVALID',
      'warning code'
    );
    text(
      value.message_ru,
      'MCP_REGISTRY_WARNING_INVALID',
      'warning message_ru',
      1000
    );
    text(
      value.message_en,
      'MCP_REGISTRY_WARNING_INVALID',
      'warning message_en',
      1000
    );
    exactId(
      value.source,
      'MCP_REGISTRY_WARNING_INVALID',
      'warning source'
    );
  }

  function uniqueRows(rows, idField, validator, code, label) {
    var seen = {};
    if (!Array.isArray(rows)) fail(code, label + ' must be an array');
    rows.forEach(function (row) {
      validator(row);
      var id = String(row[idField]);
      if (seen[id]) fail(code, label + ' contains duplicate id ' + id);
      seen[id] = row;
    });
    return seen;
  }

  function validateRelations(registry, maps) {
    registry.tools.forEach(function (row) {
      var linked = maps.connections[row.connection_id];
      if (!linked || linked.automation_id !== row.automation_id) {
        fail(
          'MCP_TOOL_CONNECTION_DANGLING',
          'Tool Contract must reference a Connection in the same automation'
        );
      }
    });
    registry.bindings.forEach(function (row) {
      var linkedTool = maps.tools[row.tool_id];
      if (!linkedTool || linkedTool.automation_id !== row.automation_id) {
        fail(
          'MCP_BINDING_TOOL_DANGLING',
          'Tool Binding must reference a Tool Contract in the same automation'
        );
      }
      row.extension_ids.forEach(function (extensionId) {
        var linkedExtension = maps.extensions[extensionId];
        if (!linkedExtension ||
            linkedExtension.automation_ids.indexOf(row.automation_id) === -1) {
          fail(
            'MCP_BINDING_EXTENSION_DANGLING',
            'Tool Binding must reference an Extension used by the automation'
          );
        }
      });
    });
    registry.run_evidence.forEach(function (row) {
      var linkedTool = maps.tools[row.tool_id];
      var linkedBinding = maps.bindings[row.binding_id];
      if (!linkedTool || !linkedBinding ||
          linkedTool.automation_id !== row.automation_id ||
          linkedBinding.automation_id !== row.automation_id ||
          linkedBinding.tool_id !== row.tool_id ||
          linkedBinding.platform_agent_id !== row.platform_agent_id) {
        fail(
          'MCP_RUN_EVIDENCE_REFERENCE_DANGLING',
          'Run Evidence must bind an exact Tool Contract and Tool Binding'
        );
      }
    });
  }

  function validateRegistry(value, context) {
    var maps;
    exactKeys(
      value,
      ROOT_KEYS,
      'MCP_REGISTRY_INVALID',
      'MCP registry'
    );
    if (value.schema !== REGISTRY_SCHEMA) {
      fail('MCP_REGISTRY_INVALID', 'MCP registry schema is unsupported');
    }
    exactId(
      value.owner_account_id,
      'MCP_REGISTRY_INVALID',
      'owner_account_id'
    );
    if (context && context.accountId != null &&
        String(context.accountId) !== value.owner_account_id) {
      fail(
        'MCP_REGISTRY_ACCOUNT_MISMATCH',
        'MCP registry belongs to another account'
      );
    }
    timestamp(
      value.checked_at,
      'MCP_REGISTRY_INVALID',
      'registry checked_at'
    );
    if (typeof value.complete !== 'boolean') {
      fail('MCP_REGISTRY_INVALID', 'registry complete must be boolean');
    }
    source(value.source);
    if (value.source.kind === 'UNAVAILABLE' && value.complete !== false) {
      fail(
        'MCP_REGISTRY_SOURCE_COMPLETENESS_INVALID',
        'an unavailable MCP registry source cannot be complete'
      );
    }
    if (!Array.isArray(value.warnings)) {
      fail('MCP_REGISTRY_INVALID', 'registry warnings must be an array');
    }
    value.warnings.forEach(warning);
    if (value.complete === false && value.warnings.length === 0) {
      fail(
        'MCP_REGISTRY_INCOMPLETE_WITHOUT_WARNING',
        'an incomplete MCP registry must explain why'
      );
    }
    maps = {
      connections: uniqueRows(
        value.connections,
        'connection_id',
        connection,
        'MCP_CONNECTION_INVALID',
        'MCP Connections'
      ),
      tools: uniqueRows(
        value.tools,
        'tool_id',
        tool,
        'MCP_TOOL_CONTRACT_INVALID',
        'Tool Contracts'
      ),
      extensions: uniqueRows(
        value.extensions,
        'extension_id',
        extension,
        'MCP_EXTENSION_INVALID',
        'MCP Extensions'
      ),
      bindings: uniqueRows(
        value.bindings,
        'binding_id',
        binding,
        'MCP_BINDING_INVALID',
        'Tool Bindings'
      ),
      evidence: uniqueRows(
        value.run_evidence,
        'evidence_id',
        runEvidence,
        'MCP_RUN_EVIDENCE_INVALID',
        'Run Evidence'
      )
    };
    if (value.source.kind === 'UNAVAILABLE' &&
        (value.connections.length || value.tools.length ||
         value.extensions.length || value.bindings.length ||
         value.run_evidence.length)) {
      fail(
        'MCP_REGISTRY_SOURCE_COMPLETENESS_INVALID',
        'an unavailable MCP registry source cannot claim topology facts'
      );
    }
    validateRelations(value, maps);
    assertNoSecrets(value, 'registry');
    return clone(value);
  }

  function unavailableRegistry(accountId, checkedAt, code) {
    var owner = exactId(
      accountId,
      'MCP_REGISTRY_ACCOUNT_REQUIRED',
      'accountId'
    );
    var at = timestamp(
      checkedAt,
      'MCP_REGISTRY_TIMESTAMP_REQUIRED',
      'checkedAt'
    );
    return {
      schema: REGISTRY_SCHEMA,
      owner_account_id: owner,
      checked_at: at,
      complete: false,
      source: {
        kind: 'UNAVAILABLE',
        id: 'evolution.mcp.registry',
        version: '1.0.0',
        sha256: null
      },
      connections: [],
      tools: [],
      extensions: [],
      bindings: [],
      run_evidence: [],
      warnings: [{
        code: String(code || 'MCP_REGISTRY_UNAVAILABLE'),
        message_ru: 'Состав MCP пока не подтверждён источником аккаунта.',
        message_en: 'MCP composition is not yet proven by the account source.',
        source: 'evolution.mcp.registry'
      }]
    };
  }

  function toolNames() {
    return READ_TOOLS.map(function (row) { return row.name; });
  }

  return {
    CONTRACT_SCHEMA: CONTRACT_SCHEMA,
    REGISTRY_SCHEMA: REGISTRY_SCHEMA,
    RESPONSE_SCHEMA: RESPONSE_SCHEMA,
    SNAPSHOT_SCHEMA: SNAPSHOT_SCHEMA,
    READ_TOOLS: deepFreeze(clone(READ_TOOLS)),
    toolNames: toolNames,
    validateRegistry: validateRegistry,
    unavailableRegistry: unavailableRegistry,
    assertNoSecrets: function (value) {
      assertNoSecrets(value, 'value');
      return true;
    }
  };
}());
