// ── AGENT CONTROL MODULE ───────────────────────────────────────────────────
// Pure, deterministic control-plane primitives for the Agent Control Center.
// The module never calls Extella APIs and never mutates a supplied ledger.
//
// Exposes: ETB.agentControl.newLedger(), createDraft(), analyzeImpact(),
//          runPlayground(), publishDraft(), rollback(), runActive(),
//          canonical(), sha256(), validateLedger()

ETB.agentControl = (function () {
  var SCHEMA_VERSION = 'agent-control-ledger.v1';
  var RULE_TEXT = 'Если фактическая маржа продукта ниже 20%, не увеличивать рекламный бюджет. Предложить остановку или пересмотр кампании.';
  var RULE_ID = 'shared.actual-margin-ad-budget-guard';
  var THRESHOLD_BPS = 2000;

  function fail(code, message) {
    var error = new Error(message || code);
    error.code = code;
    throw error;
  }

  function hasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value, key);
  }

  function canonical(value) {
    function encode(current, stack) {
      var type;
      var keys;
      var parts;
      var i;

      if (current === null) return 'null';
      type = typeof current;
      if (type === 'string' || type === 'boolean') return JSON.stringify(current);
      if (type === 'number') {
        if (!isFinite(current)) fail('CANONICAL_NON_FINITE', 'Canonical JSON does not accept non-finite numbers');
        return JSON.stringify(current === 0 ? 0 : current);
      }
      if (type !== 'object') {
        fail('CANONICAL_UNSUPPORTED_TYPE', 'Canonical JSON accepts only JSON values');
      }
      if (stack.indexOf(current) !== -1) fail('CANONICAL_CYCLE', 'Canonical JSON does not accept cycles');
      stack.push(current);
      if (Array.isArray(current)) {
        parts = [];
        for (i = 0; i < current.length; i += 1) {
          parts.push(encode(current[i], stack));
        }
        stack.pop();
        return '[' + parts.join(',') + ']';
      }
      keys = Object.keys(current).sort();
      parts = [];
      for (i = 0; i < keys.length; i += 1) {
        if (typeof current[keys[i]] === 'undefined') {
          fail('CANONICAL_UNSUPPORTED_TYPE', 'Canonical JSON does not accept undefined values');
        }
        parts.push(JSON.stringify(keys[i]) + ':' + encode(current[keys[i]], stack));
      }
      stack.pop();
      return '{' + parts.join(',') + '}';
    }
    return encode(value, []);
  }

  function sha256(value) {
    var cryptoApi = typeof crypto !== 'undefined' ? crypto :
      (typeof window !== 'undefined' ? window.crypto : null);
    var Encoder = typeof TextEncoder !== 'undefined' ? TextEncoder :
      (typeof window !== 'undefined' ? window.TextEncoder : null);
    var text;
    var bytes;

    if (!cryptoApi || !cryptoApi.subtle || !Encoder) {
      return Promise.reject((function () {
        var error = new Error('WebCrypto SHA-256 is unavailable; verified operation stopped');
        error.code = 'SHA256_UNAVAILABLE';
        return error;
      }()));
    }
    try {
      text = typeof value === 'string' ? value : canonical(value);
      bytes = new Encoder().encode(text);
    } catch (error) {
      return Promise.reject(error);
    }
    return cryptoApi.subtle.digest('SHA-256', bytes).then(function (digest) {
      var view = new Uint8Array(digest);
      var output = '';
      var i;
      for (i = 0; i < view.length; i += 1) {
        output += ('0' + view[i].toString(16)).slice(-2);
      }
      return output;
    });
  }

  function clone(value) {
    return JSON.parse(canonical(value));
  }

  function deepFreeze(value) {
    var keys;
    var i;
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    keys = Object.keys(value);
    for (i = 0; i < keys.length; i += 1) deepFreeze(value[keys[i]]);
    return Object.freeze(value);
  }

  function nowValue(opts) {
    return String(opts && opts.now || new Date().toISOString());
  }

  function cleanId(value, code, label) {
    var result = String(value || '').trim();
    if (!result) fail(code, label + ' is required');
    return result;
  }

  function uniqueSorted(values) {
    var seen = {};
    var output = [];
    var i;
    var value;
    for (i = 0; i < values.length; i += 1) {
      value = String(values[i] || '');
      if (value && !hasOwn(seen, value)) {
        seen[value] = true;
        output.push(value);
      }
    }
    return output.sort();
  }

  function normalizeNamedRows(rows, kind) {
    var input = Array.isArray(rows) ? rows : [];
    var output = [];
    var seen = {};
    var i;
    var row;
    var id;
    var normalized;
    for (i = 0; i < input.length; i += 1) {
      row = input[i];
      if (typeof row === 'string') {
        id = cleanId(row, 'INVALID_' + kind.toUpperCase(), kind + ' id');
        normalized = { id: id, name: id };
        if (kind === 'local rule') normalized.text = row;
      } else if (row && typeof row === 'object') {
        id = cleanId(row.id || row.ruleId || row.rule_id || row.knowledgeId ||
          row.concept_id || row.processId,
          'INVALID_' + kind.toUpperCase().replace(/ /g, '_'), kind + ' id');
        normalized = clone(row);
        normalized.id = id;
        if (kind === 'local rule' && !normalized.text) normalized.text = normalized.rule || id;
        if (kind === 'knowledge' && !normalized.text) normalized.text = normalized.concept_text || null;
        if (!normalized.name) {
          normalized.name = normalized.title || normalized.text ||
            normalized.rule || normalized.description || id;
        }
      } else {
        fail('INVALID_' + kind.toUpperCase().replace(/ /g, '_'), 'Invalid ' + kind + ' entry');
      }
      if (hasOwn(seen, id)) fail('DUPLICATE_INVENTORY_ID', 'Duplicate ' + kind + ': ' + id);
      seen[id] = true;
      output.push(normalized);
    }
    return output.sort(function (left, right) {
      return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
    });
  }

  function normalizeCapabilities(rows) {
    var input = Array.isArray(rows) ? rows : [];
    var output = [];
    var seen = {};
    var i;
    var row;
    var normalized;
    var id;
    for (i = 0; i < input.length; i += 1) {
      row = input[i];
      if (typeof row === 'string') {
        id = cleanId(row, 'INVALID_CAPABILITY', 'capability id');
        normalized = { id: id, name: id, shared: false, version: null };
      } else if (row && typeof row === 'object') {
        id = cleanId(row.id || row.capabilityId || row.name,
          'INVALID_CAPABILITY', 'capability id');
        normalized = clone(row);
        normalized.id = id;
        normalized.name = String(normalized.name || id);
        normalized.shared = normalized.shared === true || normalized.global === true ||
          normalized.scope === 'global' || normalized.scope === 'organization';
        normalized.version = normalized.version == null ? null : String(normalized.version);
      } else {
        fail('INVALID_CAPABILITY', 'Invalid capability entry');
      }
      if (hasOwn(seen, id)) fail('DUPLICATE_INVENTORY_ID', 'Duplicate capability: ' + id);
      seen[id] = true;
      output.push(normalized);
    }
    return output.sort(function (left, right) {
      return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
    });
  }

  function inventoryMap(inventories) {
    var output = {};
    var i;
    var row;
    var id;
    if (Array.isArray(inventories)) {
      for (i = 0; i < inventories.length; i += 1) {
        row = inventories[i] || {};
        id = cleanId(row.agentId || row.agent_id || row.id, 'INVENTORY_AGENT_REQUIRED', 'inventory agent id');
        if (hasOwn(output, id)) fail('DUPLICATE_INVENTORY', 'Duplicate inventory for agent ' + id);
        output[id] = row;
      }
      return output;
    }
    if (!inventories || typeof inventories !== 'object') {
      fail('INVENTORIES_REQUIRED', 'Per-agent inventories are required');
    }
    Object.keys(inventories).forEach(function (key) {
      output[String(key)] = inventories[key] || {};
    });
    return output;
  }

  function normalizeInputs(agents, inventories) {
    var inventoryByAgent = inventoryMap(inventories);
    var normalizedAgents = {};
    var bundleAgents = {};
    var sharedCapabilities = {};
    var ids = [];
    var seen = {};
    var i;
    var source;
    var id;
    var inventory;
    var inventoryAgent;
    var mergedAgent;
    var capabilities;

    if (!Array.isArray(agents) || agents.length < 2) {
      fail('TWO_AGENTS_REQUIRED', 'At least two real agents are required');
    }
    for (i = 0; i < agents.length; i += 1) {
      source = agents[i] || {};
      id = cleanId(source.id || source.agent_id, 'AGENT_ID_REQUIRED', 'agent id');
      if (hasOwn(seen, id)) fail('DUPLICATE_AGENT', 'Duplicate agent id: ' + id);
      seen[id] = true;
      ids.push(id);
      inventory = inventoryByAgent[id];
      if (!inventory) fail('INVENTORY_REQUIRED', 'Inventory is required for agent ' + id);
      inventoryAgent = inventory.agent && typeof inventory.agent === 'object' ?
        inventory.agent : {};
      mergedAgent = {
        id: id,
        name: source.name || inventoryAgent.name || id,
        role: source.role || source.category || inventoryAgent.role ||
          inventoryAgent.category || 'agent',
        managedRole: source.managedRole || inventoryAgent.managedRole || null,
        provider: source.provider != null ? source.provider : inventoryAgent.provider,
        model: source.model != null ? source.model : inventoryAgent.model,
        tools: source.tools != null ? source.tools : inventoryAgent.tools,
        instructionsSha256: source.instructionsSha256 ||
          inventoryAgent.instructionsSha256 || null,
        instructionsPreview: source.instructionsPreview ||
          inventoryAgent.instructionsPreview || null
      };
      capabilities = normalizeCapabilities(inventory.capabilities || inventory.experts);
      normalizedAgents[id] = {
        id: id,
        name: String(mergedAgent.name),
        role: String(mergedAgent.role),
        managedRole: mergedAgent.managedRole == null ? null : String(mergedAgent.managedRole),
        provider: mergedAgent.provider == null ? null : String(mergedAgent.provider),
        model: mergedAgent.model == null ? null : String(mergedAgent.model)
      };
      bundleAgents[id] = {
        agentId: id,
        agent: {
          id: id,
          name: String(mergedAgent.name),
          role: String(mergedAgent.role),
          managedRole: mergedAgent.managedRole == null ? null : String(mergedAgent.managedRole),
          provider: mergedAgent.provider == null ? null : String(mergedAgent.provider),
          model: mergedAgent.model == null ? null : String(mergedAgent.model),
          tools: clone(Array.isArray(mergedAgent.tools) ? mergedAgent.tools : []),
          instructionsSha256: mergedAgent.instructionsSha256 == null ?
            null : String(mergedAgent.instructionsSha256),
          instructionsPreview: mergedAgent.instructionsPreview == null ?
            null : String(mergedAgent.instructionsPreview)
        },
        inventoryHashes: clone(inventory.hashes || inventory.inventoryHashes || {}),
        inventoryCounts: clone(inventory.counts || inventory.inventoryCounts || {}),
        knowledge: normalizeNamedRows(inventory.knowledge || inventory.concepts, 'knowledge'),
        localRules: normalizeNamedRows(inventory.localRules || inventory.rules, 'local rule'),
        capabilities: capabilities,
        processes: normalizeNamedRows(inventory.processes, 'process')
      };
      capabilities.forEach(function (capability) {
        var current;
        if (!capability.shared) return;
        current = sharedCapabilities[capability.id];
        if (!current) {
          current = {
            id: capability.id,
            name: capability.name,
            version: capability.version,
            consumerAgentIds: []
          };
          sharedCapabilities[capability.id] = current;
        } else if (current.version !== capability.version) {
          fail('SHARED_CAPABILITY_VERSION_CONFLICT',
            'Shared capability version conflict: ' + capability.id);
        }
        current.consumerAgentIds.push(id);
      });
    }
    ids = uniqueSorted(ids);
    Object.keys(sharedCapabilities).forEach(function (capabilityId) {
      sharedCapabilities[capabilityId].consumerAgentIds =
        uniqueSorted(sharedCapabilities[capabilityId].consumerAgentIds);
    });
    return {
      agentIds: ids,
      agents: normalizedAgents,
      bundleAgents: bundleAgents,
      sharedCapabilities: sharedCapabilities
    };
  }

  function makeVersionId(hash) {
    return 'cfg_' + String(hash).slice(0, 24);
  }

  function validateLedger(ledger) {
    var agentIds;
    var versionIds;
    var i;
    var pointer;
    var version;
    if (!ledger || ledger.schemaVersion !== SCHEMA_VERSION) {
      fail('INVALID_LEDGER', 'Unsupported or missing Agent Control ledger');
    }
    agentIds = Object.keys(ledger.agents || {});
    if (agentIds.length < 2) fail('INVALID_LEDGER', 'Ledger must contain at least two agents');
    if (!ledger.ownerAgentId || !ledger.agents[ledger.ownerAgentId]) {
      fail('INVALID_LEDGER_OWNER', 'Ledger owner must be one of its real agents');
    }
    if (!ledger.ownerAccountId) {
      fail('INVALID_LEDGER_ACCOUNT', 'Ledger must be bound to one authenticated account');
    }
    versionIds = Object.keys(ledger.versions || {});
    if (!versionIds.length) fail('INVALID_LEDGER', 'Ledger has no configuration versions');
    for (i = 0; i < agentIds.length; i += 1) {
      pointer = ledger.activeVersionByAgent && ledger.activeVersionByAgent[agentIds[i]];
      if (!pointer || !ledger.versions[pointer]) {
        fail('INVALID_ACTIVE_POINTER', 'Missing active version for agent ' + agentIds[i]);
      }
      version = ledger.versions[pointer];
      if (version.immutable !== true || !version.bundleSha256 || !version.bundle) {
        fail('INVALID_VERSION', 'Active configuration is not immutable and content-addressed');
      }
      if (!version.bundle.agents || !version.bundle.agents[agentIds[i]]) {
        fail('INVALID_VERSION', 'Active configuration has no inventory for agent ' + agentIds[i]);
      }
    }
    return true;
  }

  function newLedger(agents, inventories, opts) {
    var normalized;
    var createdAt;
    var actorId;
    var ownerAgentId;
    var ownerAccountId;
    var bundle;
    opts = opts || {};
    try {
      normalized = normalizeInputs(agents, inventories);
      createdAt = nowValue(opts);
      actorId = String(opts.actorId || 'system');
      ownerAccountId = cleanId(opts.ownerAccountId || actorId,
        'LEDGER_ACCOUNT_REQUIRED', 'ledger owner account id');
      ownerAgentId = cleanId(opts.ownerAgentId,
        'LEDGER_OWNER_REQUIRED', 'ledger owner agent id');
      if (!normalized.agents[ownerAgentId]) {
        fail('INVALID_LEDGER_OWNER', 'Ledger owner must be one of its real agents');
      }
      bundle = {
        schemaVersion: 'agent-configuration-bundle.v1',
        agents: normalized.bundleAgents,
        sharedCapabilities: normalized.sharedCapabilities,
        sharedRules: []
      };
    } catch (error) {
      return Promise.reject(error);
    }
    return sha256(bundle).then(function (bundleHash) {
      var versionId = makeVersionId(bundleHash);
      var pointers = {};
      var ledger;
      normalized.agentIds.forEach(function (agentId) { pointers[agentId] = versionId; });
      ledger = {
        schemaVersion: SCHEMA_VERSION,
        ledgerId: 'ledger_' + bundleHash.slice(0, 20),
        createdAt: createdAt,
        ownerAgentId: ownerAgentId,
        ownerAccountId: ownerAccountId,
        baselineVersionId: versionId,
        agents: normalized.agents,
        versions: {},
        activeVersionByAgent: pointers,
        drafts: {},
        testRuns: {},
        runs: {},
        audit: [{
          type: 'BASELINE_CAPTURED',
          status: 'SUCCESS',
          actorId: actorId,
          at: createdAt,
          versionId: versionId,
          bundleSha256: bundleHash,
          agentIds: normalized.agentIds
        }],
        currentDraftId: null,
        currentTestRunId: null,
        currentRunId: null
      };
      ledger.versions[versionId] = {
        id: versionId,
        sequence: 1,
        status: 'PUBLISHED',
        immutable: true,
        parentVersionIds: [],
        createdAt: createdAt,
        createdBy: actorId,
        bundleSha256: bundleHash,
        bundle: bundle
      };
      validateLedger(ledger);
      return deepFreeze(ledger);
    });
  }

  function scopeAgentIds(ledger, scope) {
    var allIds = Object.keys(ledger.agents || {}).sort();
    var kind = String(scope && scope.kind || '');
    var ids;
    var i;
    if (kind === 'organization') return allIds;
    if (kind === 'one') {
      ids = [scope.agentId || (scope.agentIds && scope.agentIds[0])];
    } else if (kind === 'selected') {
      ids = scope.agentIds || [];
    } else {
      fail('INVALID_SCOPE', 'Scope must be one, selected, or organization');
    }
    ids = uniqueSorted(ids);
    if (!ids.length || (kind === 'one' && ids.length !== 1)) {
      fail('INVALID_SCOPE', 'Scope has an invalid number of agents');
    }
    for (i = 0; i < ids.length; i += 1) {
      if (!hasOwn(ledger.agents, ids[i])) fail('UNKNOWN_AGENT', 'Unknown agent in scope: ' + ids[i]);
    }
    return ids;
  }

  function resolveDraft(ledger, draftOrId) {
    var draft = typeof draftOrId === 'string' ?
      (ledger.drafts && ledger.drafts[draftOrId]) : draftOrId;
    if (!draft || !draft.id || !ledger.drafts || !ledger.drafts[draft.id]) {
      fail('DRAFT_NOT_FOUND', 'Draft was not found in this ledger');
    }
    return ledger.drafts[draft.id];
  }

  function resolveTestRun(ledger, runOrId) {
    var run = typeof runOrId === 'string' ?
      (ledger.testRuns && ledger.testRuns[runOrId]) : runOrId;
    if (!run || !run.id || !ledger.testRuns || !ledger.testRuns[run.id]) {
      fail('TEST_RUN_NOT_FOUND', 'TestRun was not found in this ledger');
    }
    return ledger.testRuns[run.id];
  }

  function firstSharedCapability(bundle) {
    var ids = Object.keys(bundle.sharedCapabilities || {}).sort();
    return ids.length ? ids[0] : null;
  }

  function impactFor(ledger, draft) {
    var baseVersion = ledger.versions[draft.primaryBaseVersionId];
    var bundle = baseVersion && baseVersion.bundle;
    var agentIds = scopeAgentIds(ledger, draft.scope);
    var capability = bundle && bundle.sharedCapabilities &&
      bundle.sharedCapabilities[draft.rule.capabilityId];
    var processes = [];
    var knowledge = [];
    if (!bundle) fail('BASE_VERSION_NOT_FOUND', 'Draft baseline version is unavailable');
    if (!capability) {
      fail('SHARED_CAPABILITY_NOT_FOUND',
        'Shared capability is unavailable: ' + draft.rule.capabilityId);
    }
    agentIds.forEach(function (agentId) {
      var inventory = bundle.agents[agentId];
      (inventory.processes || []).forEach(function (row) { processes.push(row.id); });
      (inventory.knowledge || []).forEach(function (row) { knowledge.push(row.id); });
    });
    return {
      scope: clone(draft.scope),
      agentIds: agentIds,
      agentCount: agentIds.length,
      processIds: uniqueSorted(processes),
      knowledgeIds: [],
      availableKnowledgeIds: uniqueSorted(knowledge),
      capabilityIds: [capability.id],
      sharedCapabilityConsumers: [{
        capabilityId: capability.id,
        consumerAgentIds: uniqueSorted(capability.consumerAgentIds || []),
        consumerCount: uniqueSorted(capability.consumerAgentIds || []).length
      }]
    };
  }

  function analyzeImpact(ledger, draftOrId) {
    validateLedger(ledger);
    return deepFreeze(impactFor(ledger, resolveDraft(ledger, draftOrId)));
  }

  function draftHashCore(draft) {
    return {
      createdAt: draft.createdAt,
      createdBy: draft.createdBy,
      baseVersionByAgent: draft.baseVersionByAgent,
      primaryBaseVersionId: draft.primaryBaseVersionId,
      scope: draft.scope,
      rule: draft.rule,
      candidateVersionId: draft.candidateVersionId,
      candidateBundleSha256: draft.candidateBundleSha256,
      impact: draft.impact
    };
  }

  function verifyDraftIntegrity(ledger, draft) {
    var derivedImpact;
    var baseVersion;
    var expectedCandidate;
    var expectedRule;
    try {
      derivedImpact = impactFor(ledger, draft);
      if (canonical(derivedImpact) !== canonical(draft.impact)) {
        fail('DRAFT_IMPACT_MISMATCH', 'Draft impact no longer matches its declared scope');
      }
      if (!draft.candidateBundle) {
        fail('DRAFT_CANDIDATE_MISSING', 'Draft candidate bundle is unavailable');
      }
      if (draft.rule.id !== RULE_ID ||
          draft.rule.kind !== 'BUSINESS_POLICY' ||
          !draft.rule.condition ||
          draft.rule.condition.field !== 'actual_margin_bps' ||
          draft.rule.condition.operator !== '<' ||
          Number(draft.rule.condition.value) !== THRESHOLD_BPS ||
          canonical(draft.rule.effect) !== canonical({
            prohibitedAction: 'INCREASE_AD_BUDGET',
            proposedActions: ['STOP_CAMPAIGN', 'REVIEW_CAMPAIGN']
          })) {
        fail('DRAFT_RULE_MISMATCH',
          'Draft rule does not match the managed 20% profitability policy');
      }
      baseVersion = ledger.versions[draft.primaryBaseVersionId];
      if (!baseVersion || !baseVersion.bundle) {
        fail('BASE_VERSION_NOT_FOUND', 'Draft baseline version is unavailable');
      }
      expectedRule = {
        id: draft.rule.id,
        text: draft.rule.text,
        kind: draft.rule.kind,
        capabilityId: draft.rule.capabilityId,
        condition: clone(draft.rule.condition),
        effect: clone(draft.rule.effect),
        scope: {
          kind: String(draft.scope.kind),
          agentIds: derivedImpact.agentIds
        }
      };
      expectedCandidate = clone(baseVersion.bundle);
      expectedCandidate.sharedRules = (expectedCandidate.sharedRules || []).filter(
        function (row) { return row.id !== draft.rule.id; }
      );
      expectedCandidate.sharedRules.push(expectedRule);
      if (canonical(expectedCandidate) !== canonical(draft.candidateBundle)) {
        fail('DRAFT_CANDIDATE_CONTENT_MISMATCH',
          'Draft candidate contains changes outside the declared managed rule');
      }
    } catch (error) {
      return Promise.reject(error);
    }
    return Promise.all([
      sha256(draft.candidateBundle),
      sha256(draftHashCore(draft))
    ]).then(function (hashes) {
      if (hashes[0] !== draft.candidateBundleSha256 ||
          makeVersionId(hashes[0]) !== draft.candidateVersionId) {
        fail('CANDIDATE_HASH_MISMATCH', 'Draft candidate bundle no longer matches its approved hash');
      }
      if (hashes[1] !== draft.draftSha256 ||
          ('draft_' + hashes[1].slice(0, 20)) !== draft.id) {
        fail('DRAFT_HASH_MISMATCH', 'Draft metadata no longer matches its approved hash');
      }
      return derivedImpact;
    });
  }

  function createDraft(ledger, spec) {
    var input = spec || {};
    var scopedIds;
    var baseByAgent = {};
    var baseIds;
    var primaryBase;
    var baseVersion;
    var capabilityId;
    var createdAt;
    var actorId;
    var rule;
    var scope;
    var draftCore;
    validateLedger(ledger);
    try {
      scope = clone(input.scope || {});
      scopedIds = scopeAgentIds(ledger, scope);
      scopedIds.forEach(function (agentId) {
        baseByAgent[agentId] = ledger.activeVersionByAgent[agentId];
      });
      baseIds = uniqueSorted(Object.keys(baseByAgent).map(function (agentId) {
        return baseByAgent[agentId];
      }));
      if (baseIds.length !== 1) {
        fail('MIXED_BASE_VERSIONS', 'A draft requires one shared baseline across its scope');
      }
      primaryBase = baseIds[0];
      baseVersion = ledger.versions[primaryBase];
      capabilityId = String(input.capabilityId ||
        (baseVersion.bundle.sharedCapabilities.profitability_gate ?
          'profitability_gate' : firstSharedCapability(baseVersion.bundle)) || '');
      if (!capabilityId || !baseVersion.bundle.sharedCapabilities[capabilityId]) {
        fail('SHARED_CAPABILITY_NOT_FOUND', 'A real shared capability is required');
      }
      if (input.thresholdBps != null && Number(input.thresholdBps) !== THRESHOLD_BPS) {
        fail('INVALID_BUSINESS_RULE', 'The margin guard threshold must be exactly 2000 bps');
      }
      if (input.operator != null && String(input.operator) !== '<') {
        fail('INVALID_BUSINESS_RULE', 'The margin guard comparison must be strict <');
      }
      createdAt = nowValue(input);
      actorId = String(input.actorId || 'user');
      rule = {
        id: String(input.ruleId || RULE_ID),
        text: String(input.text || RULE_TEXT),
        kind: 'BUSINESS_POLICY',
        capabilityId: capabilityId,
        condition: {
          field: 'actual_margin_bps',
          operator: '<',
          value: THRESHOLD_BPS
        },
        effect: {
          prohibitedAction: 'INCREASE_AD_BUDGET',
          proposedActions: ['STOP_CAMPAIGN', 'REVIEW_CAMPAIGN']
        }
      };
      draftCore = {
        createdAt: createdAt,
        createdBy: actorId,
        baseVersionByAgent: baseByAgent,
        primaryBaseVersionId: primaryBase,
        scope: {
          kind: String(scope.kind),
          agentIds: scopedIds
        },
        rule: rule
      };
    } catch (error) {
      return Promise.reject(error);
    }
    return (function () {
      var candidateBundle = clone(baseVersion.bundle);
      candidateBundle.sharedRules = candidateBundle.sharedRules.filter(function (existingRule) {
        return existingRule.id !== rule.id;
      });
      candidateBundle.sharedRules.push({
        id: rule.id,
        text: rule.text,
        kind: rule.kind,
        capabilityId: rule.capabilityId,
        condition: clone(rule.condition),
        effect: clone(rule.effect),
        scope: { kind: String(scope.kind), agentIds: scopedIds }
      });
      return sha256(candidateBundle).then(function (hash) {
        return { bundle: candidateBundle, hash: hash };
      });
    }()).then(function (candidate) {
      var draft = {
        id: null,
        status: 'DRAFT',
        createdAt: createdAt,
        createdBy: actorId,
        draftSha256: null,
        baseVersionByAgent: baseByAgent,
        primaryBaseVersionId: primaryBase,
        candidateVersionId: makeVersionId(candidate.hash),
        candidateBundleSha256: candidate.hash,
        candidateBundle: candidate.bundle,
        scope: { kind: String(scope.kind), agentIds: scopedIds },
        rule: rule
      };
      if (candidate.hash === baseVersion.bundleSha256) {
        fail('DRAFT_NO_CHANGES', 'Draft candidate is identical to its active base version');
      }
      draft.impact = impactFor(ledger, draft);
      return sha256(draftHashCore(draft)).then(function (draftHash) {
        var next = clone(ledger);
        var draftId = 'draft_' + draftHash.slice(0, 20);
        draft.id = draftId;
        draft.draftSha256 = draftHash;
      next.drafts[draftId] = draft;
      next.currentDraftId = draftId;
      next.currentTestRunId = null;
      next.audit.push({
        type: 'DRAFT_CREATED',
        status: 'SUCCESS',
        actorId: actorId,
        at: createdAt,
        draftId: draftId,
        draftSha256: draftHash,
        baseVersionByAgent: baseByAgent,
        candidateVersionId: draft.candidateVersionId,
        impactedAgentIds: draft.impact.agentIds
      });
      validateLedger(next);
      return deepFreeze(next);
      });
    });
  }

  function roleKind(agent) {
    var value = (String(agent && agent.managedRole || '') + ' ' +
      String(agent && agent.role || '') + ' ' +
      String(agent && agent.name || '')).toLowerCase();
    if (value.indexOf('target') !== -1 || value.indexOf('таргет') !== -1 ||
        value.indexOf('advert') !== -1 || value.indexOf('реклам') !== -1) return 'target';
    if (value.indexOf('one_c') !== -1 || value.indexOf('1c') !== -1 ||
        value.indexOf('1с') !== -1) return 'one_c';
    return 'generic';
  }

  function normalActions(agent, marginBps) {
    var role = roleKind(agent);
    if (role === 'target') return ['INCREASE_AD_BUDGET'];
    if (role === 'one_c') return ['ALLOW_GROWTH_PLAN'];
    return ['CONTINUE_PLAN'];
  }

  function guardedActions(agent) {
    var role = roleKind(agent);
    if (role === 'target') return ['STOP_OR_REVIEW_CAMPAIGN'];
    if (role === 'one_c') return ['FLAG_LOW_MARGIN_FOR_REVIEW'];
    return ['REVIEW_CAMPAIGN'];
  }

  function applicableSharedRule(version, agentId) {
    var rules = version.bundle.sharedRules || [];
    var i;
    var scopeIds;
    for (i = rules.length - 1; i >= 0; i -= 1) {
      scopeIds = rules[i].scope && rules[i].scope.agentIds || [];
      if (rules[i].id === RULE_ID && scopeIds.indexOf(agentId) !== -1) return rules[i];
    }
    return null;
  }

  function decisionFor(ledger, version, agentId, marginBps) {
    var agent = ledger.agents[agentId];
    var inventory = version.bundle.agents[agentId];
    var sharedRule = applicableSharedRule(version, agentId);
    var fired = Boolean(sharedRule && marginBps < Number(sharedRule.condition.value));
    return {
      agentId: agentId,
      configurationVersionId: version.id,
      configurationSha256: version.bundleSha256,
      marginBps: marginBps,
      firedRuleIds: fired ? [sharedRule.id] : [],
      availableLocalRuleIds: (inventory.localRules || []).map(function (row) { return row.id; }),
      availableKnowledgeIds: (inventory.knowledge || []).map(function (row) { return row.id; }),
      availableCapabilityIds: (inventory.capabilities || []).map(function (row) { return row.id; }),
      knowledgeIds: [],
      usedKnowledgeIds: [],
      capabilityIds: sharedRule ? [sharedRule.capabilityId] : [],
      usedCapabilityIds: sharedRule ? [sharedRule.capabilityId] : [],
      evaluationMode: 'DETERMINISTIC_MANAGED_POLICY',
      expertInvoked: false,
      nativeAgentInvoked: false,
      plannedActions: fired ? guardedActions(agent) : normalActions(agent, marginBps),
      externalWrites: [],
      writeAttempts: 0
    };
  }

  function normalizeCases(cases) {
    var input = cases || [
      { id: 'below-18', marginBps: 1800 },
      { id: 'boundary-20', marginBps: 2000 },
      { id: 'above-30', marginBps: 3000 }
    ];
    var output = [];
    var seen = {};
    if (!Array.isArray(input) || !input.length) fail('PLAYGROUND_CASES_REQUIRED', 'Playground cases are required');
    input.forEach(function (row, index) {
      var margin = typeof row === 'number' ? row : Number(row && row.marginBps);
      var id = typeof row === 'number' ? 'case-' + index : String(row.id || 'case-' + index);
      if (!isFinite(margin)) fail('INVALID_MARGIN', 'Playground margin must be finite');
      if (hasOwn(seen, id)) fail('DUPLICATE_CASE', 'Duplicate playground case: ' + id);
      seen[id] = true;
      output.push({ id: id, marginBps: margin });
    });
    return output;
  }

  function testRunReceiptCore(testRun) {
    var core = clone(testRun);
    delete core.id;
    delete core.receiptSha256;
    return core;
  }

  function runPlayground(ledger, draftOrId, cases, opts) {
    var draft;
    var testCases;
    var testAt;
    var testActor;
    validateLedger(ledger);
    try {
      draft = resolveDraft(ledger, draftOrId);
      if (draft.status !== 'DRAFT') fail('DRAFT_NOT_TESTABLE', 'Only a draft can be tested');
      testCases = normalizeCases(cases);
      testAt = nowValue(opts || {});
      testActor = cleanId(opts && opts.actorId || 'user',
        'TEST_ACTOR_REQUIRED', 'TestRun actor id');
    } catch (error) {
      return Promise.reject(error);
    }
    return verifyDraftIntegrity(ledger, draft).then(function (derivedImpact) {
      var baseVersion = ledger.versions[draft.primaryBaseVersionId];
      var candidateVersion = {
        id: draft.candidateVersionId,
        bundleSha256: draft.candidateBundleSha256,
        bundle: draft.candidateBundle
      };
      var rows = [];
      var assertionRows = [];
      var changedAgentIds = [];
      var firedRuleIds = [];
      var usedKnowledgeIds = [];
      var usedCapabilityIds = [];
      var coverage = { below: false, boundary: false, above: false };
      var status;
      var testCore;
      testCases.forEach(function (testCase) {
        var caseRows = [];
        var shouldFire = testCase.marginBps < THRESHOLD_BPS;
        if (testCase.marginBps < THRESHOLD_BPS) coverage.below = true;
        if (testCase.marginBps === THRESHOLD_BPS) coverage.boundary = true;
        if (testCase.marginBps > THRESHOLD_BPS) coverage.above = true;
        derivedImpact.agentIds.forEach(function (agentId) {
          var before = decisionFor(ledger, baseVersion, agentId, testCase.marginBps);
          var after = decisionFor(ledger, candidateVersion, agentId, testCase.marginBps);
          var changed = canonical(before.plannedActions) !== canonical(after.plannedActions) ||
            canonical(before.firedRuleIds) !== canonical(after.firedRuleIds);
          if (changed) changedAgentIds.push(agentId);
          firedRuleIds = firedRuleIds.concat(after.firedRuleIds || []);
          usedKnowledgeIds = usedKnowledgeIds.concat(after.usedKnowledgeIds || []);
          usedCapabilityIds = usedCapabilityIds.concat(after.usedCapabilityIds || []);
          caseRows.push({
            agentId: agentId,
            before: before,
            after: after,
            changed: changed
          });
        });
        rows.push({
          id: testCase.id,
          marginBps: testCase.marginBps,
          agentResults: caseRows,
          externalWrites: [],
          writeAttempts: 0
        });
        var candidateBound = caseRows.every(function (result) {
          return result.after.configurationVersionId === draft.candidateVersionId &&
            result.after.configurationSha256 === draft.candidateBundleSha256 &&
            result.before.configurationVersionId === draft.baseVersionByAgent[result.agentId] &&
            result.before.configurationSha256 === baseVersion.bundleSha256;
        });
        var exactRuleObserved = caseRows.every(function (result) {
          return canonical(result.after.firedRuleIds || []) ===
            canonical(shouldFire ? [draft.rule.id] : []);
        });
        var expectedDiffObserved = caseRows.every(function (result) {
          return result.changed === shouldFire;
        });
        var prohibitedActionAbsent = !shouldFire || caseRows.every(function (result) {
          return (result.after.plannedActions || []).indexOf('INCREASE_AD_BUDGET') === -1;
        });
        var noWrites = caseRows.every(function (result) {
          return !(result.after.externalWrites || []).length &&
            Number(result.after.writeAttempts || 0) === 0;
        });
        assertionRows.push({
          caseId: testCase.id,
          marginBps: testCase.marginBps,
          shouldFire: shouldFire,
          candidateBound: candidateBound,
          exactRuleObserved: exactRuleObserved,
          expectedDiffObserved: expectedDiffObserved,
          prohibitedActionAbsent: prohibitedActionAbsent,
          noWrites: noWrites,
          passed: candidateBound && exactRuleObserved && expectedDiffObserved &&
            prohibitedActionAbsent && noWrites
        });
      });
      var allAssertionsPassed = assertionRows.length === rows.length &&
        assertionRows.every(function (row) { return row.passed === true; });
      status = coverage.below && coverage.boundary && coverage.above &&
        allAssertionsPassed ? 'PASSED' : 'FAILED';
      testCore = {
        draftId: draft.id,
        draftSha256: draft.draftSha256,
        baseVersionByAgent: draft.baseVersionByAgent,
        candidateVersionId: draft.candidateVersionId,
        candidateBundleSha256: draft.candidateBundleSha256,
        mode: 'DRY_RUN',
        status: status,
        coverage: coverage,
        assertions: {
          allPassed: allAssertionsPassed,
          cases: assertionRows
        },
        cases: rows,
        changedAgentIds: uniqueSorted(changedAgentIds),
        firedRuleIds: uniqueSorted(firedRuleIds),
        knowledgeIds: uniqueSorted(usedKnowledgeIds),
        usedKnowledgeIds: uniqueSorted(usedKnowledgeIds),
        capabilityIds: uniqueSorted(usedCapabilityIds),
        usedCapabilityIds: uniqueSorted(usedCapabilityIds),
        plannedActions: uniqueSorted(rows.reduce(function (all, row) {
          row.agentResults.forEach(function (result) {
            all = all.concat(result.after.plannedActions);
          });
          return all;
        }, [])),
        externalWrites: [],
        writeAttempts: 0,
        completedAt: testAt,
        executedBy: testActor
      };
      return sha256(testCore).then(function (testHash) {
      var next = clone(ledger);
      var testRunId = 'testrun_' + testHash.slice(0, 20);
      var testRun = clone(testCore);
      testRun.id = testRunId;
      testRun.receiptSha256 = testHash;
      if (next.testRuns[testRunId] &&
          canonical(next.testRuns[testRunId]) !== canonical(testRun)) {
        fail('TEST_RUN_ID_COLLISION', 'TestRun id already refers to different evidence');
      }
      next.testRuns[testRunId] = testRun;
      next.currentTestRunId = testRunId;
      next.audit.push({
        type: 'PLAYGROUND_COMPLETED',
        status: status,
        actorId: testActor,
        at: testAt,
        draftId: draft.id,
        testRunId: testRunId,
        draftSha256: draft.draftSha256,
        candidateVersionId: draft.candidateVersionId,
        externalWrites: [],
        writeAttempts: 0
      });
      return deepFreeze(next);
      });
    });
  }

  function publishDraft(ledger, draftOrId, testRunOrId, opts) {
    var draft;
    var testRun;
    var publishedAt;
    var actorId;
    validateLedger(ledger);
    opts = opts || {};
    try {
      draft = resolveDraft(ledger, draftOrId);
      testRun = resolveTestRun(ledger, testRunOrId);
      if (draft.status !== 'DRAFT') fail('DRAFT_NOT_PUBLISHABLE', 'Only a draft can be published');
      if (testRun.status !== 'PASSED') fail('TEST_RUN_NOT_GREEN', 'A successful TestRun is required');
      if (!testRun.assertions || testRun.assertions.allPassed !== true ||
          !Array.isArray(testRun.assertions.cases) || !testRun.assertions.cases.length ||
          testRun.assertions.cases.some(function (row) { return row.passed !== true; })) {
        fail('TEST_RUN_ASSERTIONS_FAILED', 'TestRun semantic assertions are missing or failed');
      }
      if ((testRun.externalWrites || []).length ||
          Number(testRun.writeAttempts || 0) !== 0) {
        fail('TEST_RUN_SIDE_EFFECTS', 'TestRun must prove zero external writes');
      }
      if (testRun.draftId !== draft.id ||
          testRun.draftSha256 !== draft.draftSha256 ||
          testRun.candidateVersionId !== draft.candidateVersionId ||
          testRun.candidateBundleSha256 !== draft.candidateBundleSha256) {
        fail('STALE_TEST_RUN', 'TestRun does not match the exact draft candidate');
      }
      publishedAt = nowValue(opts);
      actorId = cleanId(opts.actorId || 'user',
        'PUBLISH_ACTOR_REQUIRED', 'publication actor id');
    } catch (error) {
      return Promise.reject(error);
    }
    return verifyDraftIntegrity(ledger, draft).then(function (derivedImpact) {
      var currentPointers = {};
      derivedImpact.agentIds.forEach(function (agentId) {
        currentPointers[agentId] = ledger.activeVersionByAgent[agentId];
        if (currentPointers[agentId] !== draft.baseVersionByAgent[agentId]) {
          fail('STALE_DRAFT_BASE', 'Active configuration changed after the draft was created');
        }
      });
      return sha256(testRunReceiptCore(testRun)).then(function (receiptHash) {
        if (receiptHash !== testRun.receiptSha256 ||
            ('testrun_' + receiptHash.slice(0, 20)) !== testRun.id) {
          fail('TEST_RUN_RECEIPT_MISMATCH', 'TestRun receipt no longer matches its evidence');
        }
        return {
          derivedImpact: derivedImpact,
          currentPointers: currentPointers
        };
      });
    }).then(function (verified) {
      var next;
      var parentIds;
      var existingVersion;
      var versionReused = false;
      next = clone(ledger);
      parentIds = uniqueSorted(Object.keys(draft.baseVersionByAgent).map(function (agentId) {
        return draft.baseVersionByAgent[agentId];
      }));
      existingVersion = next.versions[draft.candidateVersionId];
      if (existingVersion) {
        if (existingVersion.immutable !== true ||
            existingVersion.status !== 'PUBLISHED' ||
            existingVersion.bundleSha256 !== draft.candidateBundleSha256 ||
            canonical(existingVersion.bundle) !== canonical(draft.candidateBundle)) {
          fail('IMMUTABLE_VERSION_COLLISION',
            'Published version id already refers to different immutable content');
        }
        versionReused = true;
      } else {
        next.versions[draft.candidateVersionId] = {
          id: draft.candidateVersionId,
          sequence: Object.keys(next.versions).length + 1,
          status: 'PUBLISHED',
          immutable: true,
          parentVersionIds: parentIds,
          createdAt: publishedAt,
          createdBy: actorId,
          bundleSha256: draft.candidateBundleSha256,
          bundle: clone(draft.candidateBundle)
        };
      }
      verified.derivedImpact.agentIds.forEach(function (agentId) {
        next.activeVersionByAgent[agentId] = draft.candidateVersionId;
      });
      next.drafts[draft.id].status = 'PUBLISHED';
      next.drafts[draft.id].publishedVersionId = draft.candidateVersionId;
      next.drafts[draft.id].publishedAt = publishedAt;
      delete next.drafts[draft.id].candidateBundle;
      next.audit.push({
        type: 'PUBLISHED',
        status: 'SUCCESS',
        actorId: actorId,
        at: publishedAt,
        draftId: draft.id,
        testRunId: testRun.id,
        fromVersionByAgent: verified.currentPointers,
        toVersionId: draft.candidateVersionId,
        versionReused: versionReused,
        changeSetSha256: draft.draftSha256,
        bundleSha256: draft.candidateBundleSha256,
        scope: clone(draft.scope),
        impactedAgentIds: verified.derivedImpact.agentIds
      });
      if (opts.failBeforeCommit === true) {
        fail('PUBLISH_INJECTED_FAILURE', 'Injected failure before atomic ledger commit');
      }
      validateLedger(next);
      return deepFreeze(next);
    });
  }

  function rollback(ledger, targetVersionId, opts) {
    var targetId = String(targetVersionId || '');
    var target = ledger && ledger.versions && ledger.versions[targetId];
    var agentIds;
    var rolledBackAt;
    var actorId;
    var before = {};
    var versionCount;
    validateLedger(ledger);
    opts = opts || {};
    try {
      if (!target || target.immutable !== true || target.status !== 'PUBLISHED') {
        fail('ROLLBACK_TARGET_NOT_FOUND', 'Rollback target must be an immutable published version');
      }
      agentIds = opts.agentIds ? uniqueSorted(opts.agentIds) :
        Object.keys(ledger.activeVersionByAgent).filter(function (agentId) {
          return ledger.activeVersionByAgent[agentId] !== targetId;
        }).sort();
      if (!agentIds.length) fail('ROLLBACK_NOOP', 'No active pointer requires rollback');
      agentIds.forEach(function (agentId) {
        if (!ledger.agents[agentId]) fail('UNKNOWN_AGENT', 'Unknown rollback agent: ' + agentId);
        if (!target.bundle.agents[agentId]) {
          fail('ROLLBACK_TARGET_INCOMPLETE', 'Rollback target has no agent inventory: ' + agentId);
        }
        before[agentId] = ledger.activeVersionByAgent[agentId];
      });
      rolledBackAt = nowValue(opts);
      actorId = String(opts.actorId || 'user');
      versionCount = Object.keys(ledger.versions).length;
    } catch (error) {
      return Promise.reject(error);
    }
    return sha256(target.bundle).then(function (readBackHash) {
      var next;
      if (readBackHash !== target.bundleSha256 || makeVersionId(readBackHash) !== target.id) {
        fail('ROLLBACK_HASH_MISMATCH', 'Rollback target does not match its immutable canonical hash');
      }
      next = clone(ledger);
      agentIds.forEach(function (agentId) {
        next.activeVersionByAgent[agentId] = targetId;
      });
      next.audit.push({
        type: 'ROLLED_BACK',
        status: 'SUCCESS',
        actorId: actorId,
        at: rolledBackAt,
        fromVersionByAgent: before,
        targetVersionId: targetId,
        restoredVersionId: targetId,
        restoredSha256: readBackHash,
        verifiedExact: true,
        copyCreated: false,
        agentIds: agentIds
      });
      if (Object.keys(next.versions).length !== versionCount) {
        fail('ROLLBACK_CREATED_COPY', 'Rollback must not create a configuration copy');
      }
      validateLedger(next);
      return deepFreeze(next);
    });
  }

  function runActive(ledger, agentId, input) {
    var id = String(agentId || '');
    var versionId;
    var version;
    var marginBps;
    var receipt;
    validateLedger(ledger);
    if (!ledger.agents[id]) fail('UNKNOWN_AGENT', 'Unknown run agent: ' + id);
    versionId = ledger.activeVersionByAgent[id];
    version = ledger.versions[versionId];
    marginBps = Number(input && input.marginBps);
    if (!isFinite(marginBps)) fail('INVALID_MARGIN', 'Active run margin must be finite');
    receipt = decisionFor(ledger, version, id, marginBps);
    receipt.id = String(input && input.runId ||
      ('run_' + id + '_' + marginBps + '_' + versionId.slice(-10)));
    receipt.mode = 'ACTIVE';
    receipt.status = 'SUCCESS';
    return deepFreeze(receipt);
  }

  function recordRun(ledger, receipt, opts) {
    var next;
    var run;
    var version;
    var actorId;
    var recordedAt;
    validateLedger(ledger);
    opts = opts || {};
    actorId = cleanId(opts.actorId,
      'RUN_ACTOR_REQUIRED', 'managed run actor id');
    recordedAt = nowValue(opts);
    if (!receipt || typeof receipt !== 'object' || !receipt.id) {
      fail('INVALID_RUN_RECEIPT', 'A run receipt with an id is required');
    }
    run = clone(receipt);
    run.executedBy = actorId;
    run.executedAt = recordedAt;
    if (!ledger.agents[run.agentId]) {
      fail('INVALID_RUN_RECEIPT', 'Run receipt refers to an unknown agent');
    }
    version = ledger.versions[run.configurationVersionId];
    if (!version || version.bundleSha256 !== run.configurationSha256) {
      fail('INVALID_RUN_RECEIPT', 'Run receipt configuration version is not active in the ledger');
    }
    if (ledger.activeVersionByAgent[run.agentId] !== run.configurationVersionId) {
      fail('STALE_RUN_RECEIPT', 'Run receipt does not use the agent active configuration');
    }
    if (run.externalWrites && run.externalWrites.length) {
      fail('RUN_EXTERNAL_WRITES', 'Control Center run receipts cannot claim external writes');
    }
    if (Number(run.writeAttempts || 0) !== 0) {
      fail('RUN_WRITE_ATTEMPTS', 'Control Center run receipts cannot record write attempts');
    }
    if (ledger.runs && hasOwn(ledger.runs, run.id)) {
      fail('RUN_ID_COLLISION', 'Managed run id already exists');
    }
    next = clone(ledger);
    next.runs[run.id] = run;
    next.currentRunId = run.id;
    next.audit.push({
      type: 'ACTIVE_RUN_RECORDED',
      status: String(run.status || 'SUCCESS'),
      actorId: actorId,
      at: recordedAt,
      runId: run.id,
      agentId: run.agentId,
      configurationVersionId: run.configurationVersionId,
      configurationSha256: run.configurationSha256,
      externalWrites: [],
      writeAttempts: 0
    });
    validateLedger(next);
    return deepFreeze(next);
  }

  return {
    SCHEMA_VERSION: SCHEMA_VERSION,
    BUSINESS_RULE_TEXT: RULE_TEXT,
    BUSINESS_RULE_ID: RULE_ID,
    BUSINESS_RULE_THRESHOLD_BPS: THRESHOLD_BPS,
    canonical: canonical,
    sha256: sha256,
    createBaseline: newLedger,
    newLedger: newLedger,
    createDraft: createDraft,
    analyzeImpact: analyzeImpact,
    runPlayground: runPlayground,
    publishDraft: publishDraft,
    rollback: rollback,
    runActive: runActive,
    recordRun: recordRun,
    validateLedger: validateLedger
  };
}());
