// ── EXTELLA EVOLUTION · MCP READ CONTRACT ────────────────────────────────
// Closed schemas and validation for the declared MCP topology shown by
// Evolution Console and Agent Cabinet.
//
// This module performs no I/O, stores no state and never reads credential
// values. A registry may contain an opaque credential reference, never the
// credential itself.

ETB.evolutionMcpContract = (function () {
  'use strict';

  var CONTRACT_SCHEMA = 'extella.evolution.mcp_read_contract.v1.1';
  var REGISTRY_SCHEMA = 'extella.evolution.mcp_registry.v1.1';
  var LEGACY_REGISTRY_SCHEMA = 'extella.evolution.mcp_registry.v1';
  var RESPONSE_SCHEMA = 'extella.evolution.mcp_read_response.v1.1';
  var SNAPSHOT_SCHEMA = 'extella.evolution.mcp_read_snapshot.v1.1';
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

  var LEGACY_ROOT_KEYS = [
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
  var ROOT_KEYS = LEGACY_ROOT_KEYS.concat([
    'access_posture',
    'availability'
  ]);
  var AVAILABILITY_STATES = [
    'OBSERVED',
    'OBSERVED_EMPTY',
    'PARTIAL',
    'NOT_EXPOSED',
    'NOT_APPLICABLE',
    'UNAVAILABLE',
    'UNKNOWN'
  ];
  var INCOMPLETE_AVAILABILITY_STATES = [
    'PARTIAL',
    'NOT_EXPOSED',
    'UNAVAILABLE',
    'UNKNOWN'
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

  function provenance(value, code, label, allowPlatformObserved) {
    exactKeys(
      value,
      ['kind', 'sha256', 'source_id', 'source_version'],
      code,
      label
    );
    enumValue(
      value.kind,
      allowPlatformObserved
        ? ['local', 'shared', 'platform_observed']
        : ['local', 'shared'],
      code,
      label + '.kind'
    );
    exactId(value.source_id, code, label + '.source_id');
    if (value.kind === 'platform_observed') {
      if (value.source_version !== null || value.sha256 !== null) {
        fail(
          code,
          label + ' platform_observed provenance cannot invent version/hash'
        );
      }
    } else {
      semver(value.source_version, code, label + '.source_version');
      sha256(value.sha256, code, label + '.sha256');
    }
  }

  function source(value, currentSchema) {
    exactKeys(
      value,
      ['id', 'kind', 'sha256', 'version'],
      'MCP_REGISTRY_SOURCE_INVALID',
      'registry source'
    );
    enumValue(
      value.kind,
      currentSchema
        ? [
          'ACCOUNT_SCOPED_HOST_PROVIDER',
          'AUTOMATION_PASSPORT',
          'DEMO_FIXTURE',
          'REVIEWED_LIVE_FACTS',
          'UNAVAILABLE'
        ]
        : [
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
    if (value.kind === 'REVIEWED_LIVE_FACTS') {
      if (value.version !== null) {
        fail(
          'MCP_REGISTRY_SOURCE_INVALID',
          'reviewed live facts cannot invent a source version'
        );
      }
    } else {
      semver(
        value.version,
        'MCP_REGISTRY_SOURCE_INVALID',
        'registry source.version'
      );
    }
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

  function connection(value, currentSchema) {
    var sharedConsumers = false;
    var directConsumer = false;
    var currentKeys = [
      'connection_id',
      'credential_ref',
      'endpoint',
      'health',
      'name',
      'platform_managed',
      'provenance',
      'scope_boundary',
      'transport'
    ];
    if (!object(value)) {
      fail('MCP_CONNECTION_INVALID', 'MCP Connection must be an object');
    }
    if (currentSchema) {
      sharedConsumers = hasOwn(value, 'automation_ids');
      directConsumer = hasOwn(value, 'automation_id');
      if (sharedConsumers === directConsumer) {
        fail(
          'MCP_CONNECTION_INVALID',
          'Connection must declare exactly one consumer form'
        );
      }
    }
    exactKeys(
      value,
      currentSchema
        ? currentKeys.concat(
          sharedConsumers ? ['automation_ids'] : ['automation_id']
        )
        : [
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
    if (currentSchema && sharedConsumers) {
      uniqueStrings(
        value.automation_ids,
        'MCP_CONNECTION_INVALID',
        'connection automation_ids',
        false
      ).forEach(function (id) {
        automationId(
          id,
          'MCP_CONNECTION_INVALID',
          'connection automation_id'
        );
      });
    } else {
      automationId(
        value.automation_id,
        'MCP_CONNECTION_INVALID',
        'connection automation_id'
      );
    }
    localizedName(value.name, 'MCP_CONNECTION_INVALID', 'connection name');
    if (currentSchema) {
      if (typeof value.platform_managed !== 'boolean') {
        fail(
          'MCP_CONNECTION_INVALID',
          'connection platform_managed must be boolean'
        );
      }
      enumValue(
        value.scope_boundary,
        ['AUTOMATION_SCOPED', 'ACCOUNT_SHARED_PLATFORM', 'UNKNOWN'],
        'MCP_CONNECTION_INVALID',
        'connection scope_boundary'
      );
    }
    if (currentSchema && sharedConsumers) {
      if (value.transport !== null) {
        fail(
          'MCP_CONNECTION_INVALID',
          'account-shared platform transport must remain unknown'
        );
      }
    } else {
      enumValue(
        value.transport,
        ['stdio', 'streamable_http', 'sse'],
        'MCP_CONNECTION_INVALID',
        'connection transport'
      );
    }
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
      'connection provenance',
      currentSchema
    );
    if (currentSchema && sharedConsumers &&
        (value.endpoint !== null ||
         value.credential_ref !== null ||
         value.platform_managed !== true ||
         value.scope_boundary !== 'ACCOUNT_SHARED_PLATFORM' ||
         value.provenance.kind !== 'platform_observed' ||
         value.provenance.source_version !== null ||
         value.provenance.sha256 !== null)) {
      fail(
        'MCP_CONNECTION_INVALID',
        'shared platform Connection must remain an unversioned account fact'
      );
    }
    if (currentSchema && directConsumer &&
        (value.platform_managed !== false ||
         value.scope_boundary === 'ACCOUNT_SHARED_PLATFORM' ||
         value.provenance.kind === 'platform_observed')) {
      fail(
        'MCP_CONNECTION_INVALID',
        'direct Connection cannot claim account-shared platform provenance'
      );
    }
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

  function warning(value, currentSchema) {
    exactKeys(
      value,
      ['code', 'message_en', 'message_ru', 'source'].concat(
        currentSchema ? ['affects_completeness', 'severity'] : []
      ),
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
    if (currentSchema) {
      enumValue(
        value.severity,
        ['info', 'warning', 'error'],
        'MCP_REGISTRY_WARNING_INVALID',
        'warning severity'
      );
      if (typeof value.affects_completeness !== 'boolean') {
        fail(
          'MCP_REGISTRY_WARNING_INVALID',
          'warning affects_completeness must be boolean'
        );
      }
    }
  }

  function availability(value) {
    exactKeys(
      value,
      [
        'automation_id',
        'bindings',
        'connections',
        'extensions',
        'run_evidence',
        'tool_contracts'
      ],
      'MCP_AVAILABILITY_INVALID',
      'automation availability'
    );
    automationId(
      value.automation_id,
      'MCP_AVAILABILITY_INVALID',
      'availability automation_id'
    );
    [
      'connections',
      'tool_contracts',
      'extensions',
      'bindings',
      'run_evidence'
    ].forEach(function (field) {
      enumValue(
        value[field],
        AVAILABILITY_STATES,
        'MCP_AVAILABILITY_INVALID',
        'availability ' + field
      );
    });
  }

  function accessPosture(value) {
    exactKeys(
      value,
      [
        'business_tool_count',
        'observed_tool_count',
        'platform_agent_id',
        'policy',
        'risk',
        'risk_evidence_tool_ids',
        'scope'
      ],
      'MCP_ACCESS_POSTURE_INVALID',
      'access posture'
    );
    exactId(
      value.platform_agent_id,
      'MCP_ACCESS_POSTURE_INVALID',
      'access posture platform_agent_id'
    );
    enumValue(
      value.scope,
      ['AUTOMATION_SCOPED', 'ACCOUNT_WIDE', 'UNKNOWN'],
      'MCP_ACCESS_POSTURE_INVALID',
      'access posture scope'
    );
    enumValue(
      value.policy,
      ['SCOPED', 'UNSCOPED', 'UNKNOWN'],
      'MCP_ACCESS_POSTURE_INVALID',
      'access posture policy'
    );
    enumValue(
      value.risk,
      ['LEAST_PRIVILEGE', 'EXCESSIVE', 'UNKNOWN'],
      'MCP_ACCESS_POSTURE_INVALID',
      'access posture risk'
    );
    ['observed_tool_count', 'business_tool_count'].forEach(function (field) {
      if (!Number.isInteger(value[field]) ||
          value[field] < 0 || value[field] > 100000) {
        fail(
          'MCP_ACCESS_POSTURE_INVALID',
          'access posture ' + field + ' must be between 0 and 100000'
        );
      }
    });
    if (value.business_tool_count > value.observed_tool_count) {
      fail(
        'MCP_ACCESS_POSTURE_INVALID',
        'business_tool_count cannot exceed observed_tool_count'
      );
    }
    var riskEvidence = uniqueStrings(
      value.risk_evidence_tool_ids,
      'MCP_ACCESS_POSTURE_INVALID',
      'access posture risk_evidence_tool_ids',
      true
    );
    if (value.risk === 'EXCESSIVE' && riskEvidence.length === 0) {
      fail(
        'MCP_ACCESS_POSTURE_INVALID',
        'EXCESSIVE risk requires exact risk evidence tool ids'
      );
    }
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

  function connectionAutomationIds(row) {
    return Array.isArray(row.automation_ids)
      ? row.automation_ids
      : [row.automation_id];
  }

  function connectionConsumesAutomation(row, automationIdValue) {
    return connectionAutomationIds(row).indexOf(automationIdValue) !== -1;
  }

  function validateRelations(registry, maps) {
    registry.tools.forEach(function (row) {
      var linked = maps.connections[row.connection_id];
      if (!linked ||
          !connectionConsumesAutomation(linked, row.automation_id)) {
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

  function rowsForAutomation(registry, field, automationId) {
    if (field === 'connections') {
      return registry.connections.filter(function (row) {
        return connectionConsumesAutomation(row, automationId);
      });
    }
    if (field === 'extensions') {
      return registry.extensions.filter(function (row) {
        return row.automation_ids.indexOf(automationId) !== -1;
      });
    }
    var registryField = field === 'tool_contracts' ? 'tools' : field;
    return registry[registryField].filter(function (row) {
      return row.automation_id === automationId;
    });
  }

  function validateAvailability(registry, availabilityMap) {
    var topologyAutomationIds = {};
    var emptyStates = [
      'OBSERVED_EMPTY',
      'NOT_EXPOSED',
      'NOT_APPLICABLE',
      'UNAVAILABLE',
      'UNKNOWN'
    ];
    var fields = [
      'connections',
      'tool_contracts',
      'extensions',
      'bindings',
      'run_evidence'
    ];
    registry.connections.forEach(function (row) {
      connectionAutomationIds(row).forEach(function (automationIdValue) {
        topologyAutomationIds[automationIdValue] = true;
      });
    });
    [
      registry.tools,
      registry.bindings,
      registry.run_evidence
    ].forEach(function (rows) {
      rows.forEach(function (row) {
        topologyAutomationIds[row.automation_id] = true;
      });
    });
    registry.extensions.forEach(function (row) {
      row.automation_ids.forEach(function (automationIdValue) {
        topologyAutomationIds[automationIdValue] = true;
      });
    });
    Object.keys(topologyAutomationIds).forEach(function (automationIdValue) {
      if (!availabilityMap[automationIdValue]) {
        fail(
          'MCP_REGISTRY_AVAILABILITY_MISSING',
          'every automation topology row requires one availability row'
        );
      }
    });
    registry.availability.forEach(function (row) {
      fields.forEach(function (field) {
        var count = rowsForAutomation(
          registry,
          field,
          row.automation_id
        ).length;
        if (row[field] === 'OBSERVED' && count === 0) {
          fail(
            'MCP_AVAILABILITY_INVALID',
            'OBSERVED availability requires at least one matching row'
          );
        }
        if (emptyStates.indexOf(row[field]) !== -1 && count !== 0) {
          fail(
            'MCP_AVAILABILITY_INVALID',
            row[field] + ' availability forbids matching rows'
          );
        }
        if (INCOMPLETE_AVAILABILITY_STATES.indexOf(row[field]) !== -1 &&
            registry.complete !== false) {
          fail(
            'MCP_REGISTRY_AVAILABILITY_COMPLETENESS_INVALID',
            row[field] + ' availability requires complete:false'
          );
        }
      });
      if (row.bindings === 'NOT_APPLICABLE' &&
          registry.access_posture.length === 0) {
        fail(
          'MCP_AVAILABILITY_INVALID',
          'bindings NOT_APPLICABLE requires an observed access posture'
        );
      }
      if (registry.bindings.some(function (bindingRow) {
        return bindingRow.automation_id === row.automation_id &&
          bindingRow.enabled === 'UNKNOWN';
      }) && row.bindings !== 'PARTIAL') {
        fail(
          'MCP_AVAILABILITY_INVALID',
          'an UNKNOWN binding state requires PARTIAL availability'
        );
      }
    });
  }

  function validateRegistry(value, context) {
    var maps;
    var currentSchema;
    if (!object(value)) {
      fail('MCP_REGISTRY_INVALID', 'MCP registry must be an object');
    }
    currentSchema = value.schema === REGISTRY_SCHEMA;
    if (!currentSchema && value.schema !== LEGACY_REGISTRY_SCHEMA) {
      fail('MCP_REGISTRY_INVALID', 'MCP registry schema is unsupported');
    }
    exactKeys(
      value,
      currentSchema ? ROOT_KEYS : LEGACY_ROOT_KEYS,
      'MCP_REGISTRY_INVALID',
      'MCP registry'
    );
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
    source(value.source, currentSchema);
    if (value.source.kind === 'UNAVAILABLE' && value.complete !== false) {
      fail(
        'MCP_REGISTRY_SOURCE_COMPLETENESS_INVALID',
        'an unavailable MCP registry source cannot be complete'
      );
    }
    if (!Array.isArray(value.warnings)) {
      fail('MCP_REGISTRY_INVALID', 'registry warnings must be an array');
    }
    value.warnings.forEach(function (row) {
      warning(row, currentSchema);
    });
    if (value.complete === false && value.warnings.length === 0) {
      fail(
        'MCP_REGISTRY_INCOMPLETE_WITHOUT_WARNING',
        'an incomplete MCP registry must explain why'
      );
    }
    if (currentSchema && value.complete === false &&
        !value.warnings.some(function (row) {
          return row.affects_completeness === true;
        })) {
      fail(
        'MCP_REGISTRY_INCOMPLETE_WITHOUT_WARNING',
        'an incomplete MCP registry needs an affecting warning'
      );
    }
    if (currentSchema && value.complete === true &&
        value.warnings.some(function (row) {
          return row.affects_completeness === true;
        })) {
      fail(
        'MCP_REGISTRY_WARNING_COMPLETENESS_INVALID',
        'a complete MCP registry cannot contain an affecting warning'
      );
    }
    maps = {
      connections: uniqueRows(
        value.connections,
        'connection_id',
        function (row) { connection(row, currentSchema); },
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
    if (currentSchema) {
      maps.availability = uniqueRows(
        value.availability,
        'automation_id',
        availability,
        'MCP_AVAILABILITY_INVALID',
        'automation availability'
      );
      maps.accessPosture = uniqueRows(
        value.access_posture,
        'platform_agent_id',
        accessPosture,
        'MCP_ACCESS_POSTURE_INVALID',
        'access postures'
      );
    }
    if (value.source.kind === 'UNAVAILABLE' &&
        (value.connections.length || value.tools.length ||
         value.extensions.length || value.bindings.length ||
         value.run_evidence.length ||
         (currentSchema &&
          (value.availability.length || value.access_posture.length)))) {
      fail(
        'MCP_REGISTRY_SOURCE_COMPLETENESS_INVALID',
        'an unavailable MCP registry source cannot claim topology facts'
      );
    }
    validateRelations(value, maps);
    if (currentSchema) {
      validateAvailability(value, maps.availability);
    }
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
      availability: [],
      access_posture: [],
      connections: [],
      tools: [],
      extensions: [],
      bindings: [],
      run_evidence: [],
      warnings: [{
        code: String(code || 'MCP_REGISTRY_UNAVAILABLE'),
        message_ru: 'Состав MCP пока не подтверждён источником аккаунта.',
        message_en: 'MCP composition is not yet proven by the account source.',
        source: 'evolution.mcp.registry',
        severity: 'warning',
        affects_completeness: true
      }]
    };
  }

  function toolNames() {
    return READ_TOOLS.map(function (row) { return row.name; });
  }

  return {
    CONTRACT_SCHEMA: CONTRACT_SCHEMA,
    REGISTRY_SCHEMA: REGISTRY_SCHEMA,
    LEGACY_REGISTRY_SCHEMA: LEGACY_REGISTRY_SCHEMA,
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
