// ── EXTELLA EVOLUTION CONSOLE MODULE ──────────────────────────────────────
// Pure ES5-compatible primitives for the Evolution Console fleet projection,
// Shared Genes map, Agent Cabinet escalation and gated bulk operations.
//
// This module does not call Extella APIs and does not implement Agent Passport
// rules. Exact checker errors/warnings and generated Agent Cabinet documents
// are inputs from extella-agent-standards.
//
// The Evolution Loop is an extension of the existing managed ledger:
// ledger.evolution. It is deliberately not a second version ledger.

ETB.evolutionConsole = (function () {
  var EXTENSION_SCHEMA = 'extella.evolution.ledger-extension.v1';
  var RECEIPT_SCHEMA = 'extella.evolution_receipt.v1';
  var SHARED_GENE_MAP_SCHEMA = 'extella.shared_genes.map.v1';
  var FLEET_SCHEMA = 'extella.evolution.fleet-projection.v1';
  var CABINET_SCHEMA = 'extella.agent_cabinet.v1.1';
  var PLAYGROUND_ISOLATION_SCHEMA =
    'extella.evolution.playground_isolation.v1';
  var PLAYGROUND_ISOLATION_KEYS = [
    'schema',
    'status',
    'runner_id',
    'run_id',
    'environment_id',
    'environment_class',
    'target_resolution',
    'owner_device_access',
    'external_write_policy',
    'teardown_status',
    'receipt_ref',
    'receipt_sha256',
    'candidate_sha256',
    'target_list_sha256',
    'started_at',
    'completed_at'
  ];
  var BULK_TYPES = {
    shared_gene_change: true,
    schedule_pause: true,
    schedule_resume: true,
    dead_reference_remove: true
  };

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
        if (!isFinite(current)) {
          fail('CANONICAL_NON_FINITE', 'Canonical JSON does not accept non-finite numbers');
        }
        return JSON.stringify(current === 0 ? 0 : current);
      }
      if (type !== 'object') {
        fail('CANONICAL_UNSUPPORTED_TYPE', 'Canonical JSON accepts only JSON values');
      }
      if (stack.indexOf(current) !== -1) {
        fail('CANONICAL_CYCLE', 'Canonical JSON does not accept cycles');
      }
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
      var unavailable = new Error('WebCrypto SHA-256 is unavailable');
      unavailable.code = 'SHA256_UNAVAILABLE';
      return Promise.reject(unavailable);
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

  function requiredString(value, code, label) {
    var result = String(value == null ? '' : value).trim();
    if (!result) fail(code, label + ' is required');
    if (result.length > 240) fail(code, label + ' is too long');
    return result;
  }

  function exactIds(values, code, label) {
    var input = Array.isArray(values) ? values : [];
    var seen = {};
    var output = [];
    var i;
    var id;
    if (!input.length) fail(code, label + ' must not be empty');
    for (i = 0; i < input.length; i += 1) {
      id = requiredString(input[i], code, label + ' id');
      if (hasOwn(seen, id)) fail(code, label + ' contains duplicate id ' + id);
      seen[id] = true;
      output.push(id);
    }
    return output.sort();
  }

  function optionalIds(values, code, label) {
    if (!Array.isArray(values) || !values.length) return [];
    return exactIds(values, code, label);
  }

  function sameIds(left, right) {
    return canonical(left || []) === canonical(right || []);
  }

  function isHash(value) {
    return /^[a-f0-9]{64}$/.test(String(value || ''));
  }

  function requireHash(value, code, label) {
    var hash = String(value || '');
    if (!isHash(hash)) fail(code, label + ' must be a lowercase SHA-256 hash');
    return hash;
  }

  function requireExactKeys(value, keys, code, label) {
    var actual;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      fail(code, label + ' must be an object');
    }
    actual = Object.keys(value).sort();
    if (canonical(actual) !== canonical(keys.slice().sort())) {
      fail(code, label + ' contains unsupported or missing fields');
    }
  }

  function requireIsoTime(value, code, label) {
    var text = requiredString(value, code, label);
    var milliseconds = Date.parse(text);
    if (!isFinite(milliseconds) || new Date(milliseconds).toISOString() !== text) {
      fail(code, label + ' must be an exact UTC timestamp');
    }
    return text;
  }

  function nowValue(opts) {
    return String(opts && opts.now || new Date().toISOString());
  }

  function actorValue(value, opts, code) {
    var actor = requiredString(value, code, 'actor_id');
    if (opts && opts.actorId != null &&
        actor !== requiredString(opts.actorId, code, 'operation actor')) {
      fail(code, 'actor_id does not match the authenticated operation actor');
    }
    return actor;
  }

  function fact(value, source) {
    var known = value !== null && typeof value !== 'undefined' && value !== '';
    return {
      state: known ? 'KNOWN' : 'UNKNOWN',
      value: known ? clone(value) : null,
      source: known ? String(source || 'DECLARED') : null
    };
  }

  function checkerResult(row) {
    var checker = row && row.checker && typeof row.checker === 'object' ?
      row.checker : (row && row.passportCheck &&
      typeof row.passportCheck === 'object' ? row.passportCheck :
      (row && row.validation && typeof row.validation === 'object' ?
      row.validation : (row && row.checker_report &&
      typeof row.checker_report === 'object' ? row.checker_report : {})));
    var issues = Array.isArray(checker.issues) ? checker.issues : null;
    var errors = [];
    var warnings = [];
    if (issues) {
      issues.forEach(function (issue) {
        var preserved = clone(issue);
        var severity = String(
          issue && issue.severity != null ? issue.severity : ''
        ).toLowerCase();
        if (severity === 'warning') warnings.push(preserved);
        else errors.push(preserved);
      });
      return {
        errors: errors,
        warnings: warnings
      };
    }
    return {
      errors: clone(Array.isArray(checker.errors) ? checker.errors : []),
      warnings: clone(Array.isArray(checker.warnings) ? checker.warnings : [])
    };
  }

  function platformRows(input) {
    if (Array.isArray(input)) return input;
    if (input && Array.isArray(input.agents)) return input.agents;
    if (input && Array.isArray(input.results)) return input.results;
    return [];
  }

  function standardsRows(input) {
    var output = [];
    var keys;
    var i;
    if (Array.isArray(input)) return input;
    if (input && Array.isArray(input.agents)) return input.agents;
    if (input && input.byPlatformAgentId &&
        typeof input.byPlatformAgentId === 'object') {
      keys = Object.keys(input.byPlatformAgentId);
      for (i = 0; i < keys.length; i += 1) {
        output.push(input.byPlatformAgentId[keys[i]]);
      }
    } else if (input && input.by_platform_agent_id &&
               typeof input.by_platform_agent_id === 'object') {
      keys = Object.keys(input.by_platform_agent_id);
      for (i = 0; i < keys.length; i += 1) {
        output.push(input.by_platform_agent_id[keys[i]]);
      }
    }
    return output;
  }

  function platformId(row) {
    return requiredString(
      row && (row.platformAgentId || row.platform_agent_id ||
        row.id || row.agent_id),
      'PLATFORM_AGENT_ID_REQUIRED',
      'platformAgentId'
    );
  }

  function standardsId(row) {
    return requiredString(
      row && (row.platformAgentId || row.platform_agent_id),
      'STANDARDS_PLATFORM_AGENT_ID_REQUIRED',
      'standards platformAgentId'
    );
  }

  function cabinetIdentity(row) {
    var cabinet = row && row.cabinet;
    if (!cabinet || cabinet.schema !== CABINET_SCHEMA ||
        !cabinet.passport || !cabinet.passport.identity) {
      return {};
    }
    return cabinet.passport.identity;
  }

  function generatedGenome(row) {
    var cabinet = row && row.cabinet;
    if (!cabinet || cabinet.schema !== CABINET_SCHEMA ||
        !cabinet.passport || !Array.isArray(cabinet.passport.genome)) {
      return null;
    }
    return cabinet.passport.genome;
  }

  function exactLastActivity(platform, standard) {
    var value = null;
    var source = null;
    if (platform) {
      if (platform.last_activity_at != null) value = platform.last_activity_at;
      else if (platform.lastActivityAt != null) value = platform.lastActivityAt;
      if (value != null) source = 'PLATFORM';
    }
    if (value == null && standard) {
      if (standard.lastActivityAt != null) value = standard.lastActivityAt;
      else if (standard.last_activity_at != null) value = standard.last_activity_at;
      if (value != null) source = 'STANDARDS_BUNDLE';
    }
    return fact(value, source);
  }

  function buildFleetProjection(platformInput, standardsInput, opts) {
    var platform = platformRows(platformInput);
    var standards = standardsRows(standardsInput);
    var platformById = {};
    var standardsById = {};
    var all = {};
    var ledger = opts && opts.ledger || null;
    var i;
    var id;

    for (i = 0; i < platform.length; i += 1) {
      id = platformId(platform[i]);
      if (hasOwn(platformById, id)) {
        fail('DUPLICATE_PLATFORM_AGENT_ID', 'Duplicate platformAgentId ' + id);
      }
      platformById[id] = platform[i];
      all[id] = true;
    }
    for (i = 0; i < standards.length; i += 1) {
      id = standardsId(standards[i]);
      if (hasOwn(standardsById, id)) {
        fail('DUPLICATE_STANDARDS_AGENT_ID', 'Duplicate standards platformAgentId ' + id);
      }
      standardsById[id] = standards[i];
      all[id] = true;
    }

    var rows = Object.keys(all).sort().map(function (agentId) {
      var live = platformById[agentId] || null;
      var standard = standardsById[agentId] || null;
      var identity = cabinetIdentity(standard);
      var genome = generatedGenome(standard);
      var checker = checkerResult(standard);
      var passportPresent = Boolean(standard && (
        standard.passportPresent === true ||
        standard.passport_present === true ||
        standard.passport ||
        standard.cabinet
      ));
      var reconciliationRisks = [];
      var activeManagedVersion = ledger && ledger.activeVersionByAgent &&
        ledger.activeVersionByAgent[agentId] || null;
      var declaredVersion = identity.active_version != null ?
        identity.active_version : (standard &&
        (standard.activeVersion != null ? standard.activeVersion :
        standard.active_version));
      var capabilityCountValue = standard &&
        (standard.capabilityCount != null ? standard.capabilityCount :
        standard.capability_count);
      var hasSharedGenesValue = standard &&
        (standard.hasSharedGenes != null ? standard.hasSharedGenes :
        standard.has_shared_genes);
      var modelValue = null;
      var modelSource = null;

      if (live && !passportPresent) {
        reconciliationRisks.push({
          code: 'PASSPORT_MISSING',
          platformAgentId: agentId
        });
      }
      if (standard && !live) {
        reconciliationRisks.push({
          code: 'DEAD_REFERENCE',
          platformAgentId: agentId
        });
      }
      if (live) {
        modelValue = {
          provider: live.provider == null ? null : String(live.provider),
          model: live.model == null ? null : String(live.model)
        };
        if (!modelValue.provider && !modelValue.model) modelValue = null;
        modelSource = 'PLATFORM';
      } else if (identity.model_profile != null) {
        modelValue = { provider: null, model: String(identity.model_profile) };
        modelSource = 'AGENT_PASSPORT';
      }
      if (capabilityCountValue == null && genome) {
        capabilityCountValue = genome.length;
      }
      if (hasSharedGenesValue == null && genome) {
        hasSharedGenesValue = genome.some(function (gene) {
          return gene && gene.provenance === 'global';
        });
      }
      if (hasSharedGenesValue == null && standard &&
          Array.isArray(standard.shared_genes)) {
        hasSharedGenesValue = standard.shared_genes.length > 0;
      }

      var activeVersionFact = activeManagedVersion != null ?
        fact(activeManagedVersion, 'EVOLUTION_LEDGER') :
        fact(declaredVersion, 'AGENT_PASSPORT');
      var ownerFact = fact(identity.owner != null ? identity.owner :
        (standard && standard.owner), 'AGENT_PASSPORT');
      var modelFact = fact(modelValue, modelSource);
      var activityFact = exactLastActivity(live, standard);
      var capabilityFact = fact(capabilityCountValue, genome ?
        'GENERATED_AGENT_CABINET' : 'STANDARDS_BUNDLE');
      var sharedFact = fact(hasSharedGenesValue, genome ?
        'GENERATED_AGENT_CABINET' : 'STANDARDS_BUNDLE');
      var standardStatus;
      if (!passportPresent && live) standardStatus = 'PASSPORT_MISSING';
      else if (standard && !live) standardStatus = 'DEAD_REFERENCE';
      else if (!standard) standardStatus = 'UNKNOWN';
      else if (checker.errors.length) standardStatus = 'FAIL';
      else standardStatus = 'PASS';

      return {
        platformAgentId: agentId,
        platformPresent: Boolean(live),
        passportPresent: passportPresent,
        name: live && (live.name || live.agent_name) ||
          identity.name || standard && standard.name || null,
        owner: ownerFact.value,
        ownerState: ownerFact.state,
        model: modelFact.value,
        modelState: modelFact.state,
        activeVersion: activeVersionFact.value,
        activeVersionState: activeVersionFact.state,
        lastActivity: activityFact.value,
        lastActivityState: activityFact.state,
        capabilityCount: capabilityFact.value,
        capabilityCountState: capabilityFact.state,
        hasSharedGenes: sharedFact.value,
        hasSharedGenesState: sharedFact.state,
        facts: {
          owner: ownerFact,
          model: modelFact,
          activeVersion: activeVersionFact,
          lastActivity: activityFact,
          capabilityCount: capabilityFact,
          hasSharedGenes: sharedFact
        },
        standardStatus: standardStatus,
        checker: checker,
        reconciliationRisks: reconciliationRisks,
        shared_genes: standard && Array.isArray(standard.shared_genes) ?
          clone(standard.shared_genes) : (standard &&
          Array.isArray(standard.sharedGenes) ?
          clone(standard.sharedGenes) : null),
        cabinet: standard && standard.cabinet ? clone(standard.cabinet) : null
      };
    });

    return deepFreeze({
      schemaVersion: FLEET_SCHEMA,
      rows: rows,
      counts: {
        total: rows.length,
        platform: rows.filter(function (row) { return row.platformPresent; }).length,
        passportMissing: rows.filter(function (row) {
          return row.standardStatus === 'PASSPORT_MISSING';
        }).length,
        deadReferences: rows.filter(function (row) {
          return row.standardStatus === 'DEAD_REFERENCE';
        }).length,
        standardFailed: rows.filter(function (row) {
          return row.standardStatus === 'FAIL';
        }).length
      }
    });
  }

  function geneDescriptors(gene) {
    var descriptors = [];
    var explicit = gene && (gene.shared_gene_id || gene.gene_id);
    var i;
    if (explicit) {
      descriptors.push({
        stableGeneId: requiredString(
          explicit,
          'INVALID_SHARED_GENE',
          'Shared Gene id'
        ),
        kind: String(gene.kind || gene.gene_kind || 'declared'),
        objectId: String(gene.objectId || gene.object_id ||
          gene.shared_handler || gene.expert || gene.capability || explicit)
      });
      return descriptors;
    }
    if (gene && gene.shared_handler) {
      descriptors.push({ kind: 'handler', objectId: String(gene.shared_handler) });
    }
    if (gene && gene.expert) {
      descriptors.push({ kind: 'expert', objectId: String(gene.expert) });
    }
    if (gene && Array.isArray(gene.rules)) {
      for (i = 0; i < gene.rules.length; i += 1) {
        descriptors.push({ kind: 'rule', objectId: String(gene.rules[i]) });
      }
    }
    if (gene && Array.isArray(gene.concepts)) {
      for (i = 0; i < gene.concepts.length; i += 1) {
        descriptors.push({ kind: 'knowledge', objectId: String(gene.concepts[i]) });
      }
    }
    if (!descriptors.length && gene && gene.capability) {
      descriptors.push({ kind: 'capability', objectId: String(gene.capability) });
    }
    if (!descriptors.length) {
      fail('SHARED_GENE_IDENTITY_MISSING',
        'A generated global Agent Genome entry has no stable Shared Gene identity');
    }
    return descriptors;
  }

  function geneIdentity(descriptor) {
    var core = {
      schemaVersion: 'extella.shared_gene.identity.v1',
      kind: requiredString(descriptor.kind, 'INVALID_SHARED_GENE', 'Shared Gene kind'),
      objectId: requiredString(
        descriptor.objectId,
        'INVALID_SHARED_GENE',
        'Shared Gene object id'
      )
    };
    if (descriptor.stableGeneId) {
      core.geneId = requiredString(
        descriptor.stableGeneId,
        'INVALID_SHARED_GENE',
        'Shared Gene id'
      );
    }
    return sha256(core).then(function (hash) {
      return {
        geneId: core.geneId || 'shared_gene_' + hash.slice(0, 32),
        identitySha256: hash,
        kind: core.kind,
        objectId: core.objectId
      };
    });
  }

  function buildSharedGenesMap(fleet, liveBindings) {
    var rows = fleet && Array.isArray(fleet.rows) ? fleet.rows : [];
    var bindings = Array.isArray(liveBindings) ? liveBindings : [];
    var pending = [];
    var i;

    rows.forEach(function (fleetRow) {
      var cabinet = fleetRow.cabinet;
      var canonicalGenes = Array.isArray(fleetRow.shared_genes) ?
        fleetRow.shared_genes : (Array.isArray(fleetRow.sharedGenes) ?
        fleetRow.sharedGenes : (cabinet &&
        Array.isArray(cabinet.shared_genes) ? cabinet.shared_genes :
        (cabinet && cabinet.passport &&
        Array.isArray(cabinet.passport.shared_genes) ?
        cabinet.passport.shared_genes : null)));
      var genome = cabinet && cabinet.schema === CABINET_SCHEMA &&
        cabinet.passport && Array.isArray(cabinet.passport.genome) ?
        cabinet.passport.genome : [];
      if (canonicalGenes) {
        canonicalGenes.forEach(function (gene) {
          geneDescriptors(gene).forEach(function (descriptor) {
            pending.push({
              platformAgentId: requiredString(
                fleetRow.platformAgentId || fleetRow.platform_agent_id,
                'INVALID_SHARED_GENE',
                'Shared Gene platformAgentId'
              ),
              descriptor: descriptor,
              displayName: gene.display_name || gene.displayName ||
                gene.name || gene.capability || descriptor.objectId,
              activeVersion: gene.active_version != null ?
                gene.active_version : (gene.activeVersion != null ?
                gene.activeVersion : (gene.version != null ? gene.version :
                (fleetRow.activeVersion != null ? fleetRow.activeVersion :
                fleetRow.active_version))),
              lastChangedAt: gene.last_changed_at || gene.lastChangedAt || null,
              source: 'CANONICAL_SHARED_GENES'
            });
          });
        });
        return;
      }
      genome.forEach(function (gene) {
        if (!gene || gene.provenance !== 'global') return;
        geneDescriptors(gene).forEach(function (descriptor) {
          pending.push({
            platformAgentId: fleetRow.platformAgentId ||
              fleetRow.platform_agent_id,
            descriptor: descriptor,
            displayName: gene.display_name || gene.displayName || gene.name ||
              (descriptor.kind === 'capability' ||
              descriptor.kind === 'declared' ?
              gene.capability : descriptor.objectId) ||
              descriptor.objectId,
            activeVersion: gene.version != null ? gene.version :
              fleetRow.activeVersion,
            lastChangedAt: null,
            source: 'GENERATED_AGENT_CABINET'
          });
        });
      });
    });

    for (i = 0; i < bindings.length; i += 1) {
      var binding = bindings[i] || {};
      pending.push({
        platformAgentId: requiredString(
          binding.platformAgentId || binding.platform_agent_id,
          'INVALID_SHARED_GENE_BINDING',
          'binding platformAgentId'
        ),
        descriptor: {
          stableGeneId: binding.geneId || binding.gene_id || null,
          kind: requiredString(binding.kind || binding.gene_kind || 'declared',
            'INVALID_SHARED_GENE_BINDING', 'binding kind'),
          objectId: requiredString(binding.objectId || binding.object_id ||
            binding.geneId || binding.gene_id,
            'INVALID_SHARED_GENE_BINDING', 'binding objectId')
        },
        displayName: binding.displayName || binding.display_name ||
          binding.objectId || binding.object_id ||
          binding.geneId || binding.gene_id,
        activeVersion: (binding.activeVersion == null &&
          binding.active_version == null) ? null :
          String(binding.activeVersion != null ? binding.activeVersion :
          binding.active_version),
        lastChangedAt: (binding.lastChangedAt == null &&
          binding.last_changed_at == null) ? null :
          String(binding.lastChangedAt != null ? binding.lastChangedAt :
          binding.last_changed_at),
        source: 'LIVE_BINDING'
      });
    }

    return Promise.all(pending.map(function (entry) {
      return geneIdentity(entry.descriptor).then(function (identity) {
        return {
          geneId: identity.geneId,
          identitySha256: identity.identitySha256,
          kind: identity.kind,
          objectId: identity.objectId,
          platformAgentId: entry.platformAgentId,
          displayName: String(entry.displayName || identity.objectId),
          activeVersion: entry.activeVersion == null ? null :
            String(entry.activeVersion),
          lastChangedAt: entry.lastChangedAt,
          source: entry.source
        };
      });
    })).then(function (resolved) {
      var byGeneId = {};
      var byAgentId = {};
      resolved.forEach(function (entry) {
        var gene = byGeneId[entry.geneId];
        var existing;
        if (!gene) {
          gene = {
            geneId: entry.geneId,
            identitySha256: entry.identitySha256,
            kind: entry.kind,
            objectId: entry.objectId,
            displayName: entry.displayName,
            consumers: []
          };
          byGeneId[entry.geneId] = gene;
        } else if (gene.identitySha256 !== entry.identitySha256 ||
                   gene.kind !== entry.kind || gene.objectId !== entry.objectId) {
          fail('SHARED_GENE_ID_COLLISION',
            'Shared Gene identity collision for ' + entry.geneId);
        }
        existing = gene.consumers.filter(function (consumer) {
          return consumer.platformAgentId === entry.platformAgentId;
        })[0];
        if (existing) {
          if (entry.source === 'LIVE_BINDING') {
            existing.activeVersion = entry.activeVersion;
            existing.lastChangedAt = entry.lastChangedAt;
            existing.source = entry.source;
          } else if (canonical(existing) !== canonical({
            platformAgentId: entry.platformAgentId,
            activeVersion: entry.activeVersion,
            lastChangedAt: entry.lastChangedAt,
            source: entry.source
          })) {
            fail('SHARED_GENE_CONSUMER_CONFLICT',
              'Conflicting Shared Gene declaration for ' + entry.platformAgentId);
          }
          return;
        }
        gene.consumers.push({
          platformAgentId: entry.platformAgentId,
          activeVersion: entry.activeVersion,
          lastChangedAt: entry.lastChangedAt,
          source: entry.source
        });
      });
      var genes = Object.keys(byGeneId).sort().map(function (geneId) {
        var gene = byGeneId[geneId];
        gene.consumers.sort(function (left, right) {
          return left.platformAgentId < right.platformAgentId ? -1 :
            left.platformAgentId > right.platformAgentId ? 1 : 0;
        });
        gene.consumerAgentIds = gene.consumers.map(function (consumer) {
          return consumer.platformAgentId;
        });
        gene.consumerCount = gene.consumerAgentIds.length;
        gene.lastChangedAt = gene.consumers.reduce(function (latest, consumer) {
          if (!consumer.lastChangedAt) return latest;
          if (!latest || consumer.lastChangedAt > latest) return consumer.lastChangedAt;
          return latest;
        }, null);
        gene.consumers.forEach(function (consumer) {
          if (!byAgentId[consumer.platformAgentId]) {
            byAgentId[consumer.platformAgentId] = [];
          }
          byAgentId[consumer.platformAgentId].push({
            geneId: gene.geneId,
            kind: gene.kind,
            objectId: gene.objectId,
            displayName: gene.displayName,
            consumerCount: gene.consumerCount,
            otherConsumerCount: Math.max(0, gene.consumerCount - 1),
            activeVersion: consumer.activeVersion,
            lastChangedAt: consumer.lastChangedAt
          });
        });
        return gene;
      });
      Object.keys(byAgentId).forEach(function (agentId) {
        byAgentId[agentId].sort(function (left, right) {
          return left.geneId < right.geneId ? -1 :
            left.geneId > right.geneId ? 1 : 0;
        });
      });
      var output = {
        schemaVersion: SHARED_GENE_MAP_SCHEMA,
        genes: genes,
        byGeneId: byGeneId,
        byAgentId: byAgentId
      };
      return sha256(output).then(function (hash) {
        output.mapSha256 = hash;
        return deepFreeze(output);
      });
    });
  }

  function cabinetSharedGeneCount(map, platformAgentId, geneId) {
    var rows = map && map.byAgentId && map.byAgentId[platformAgentId] || [];
    var match = rows.filter(function (row) { return row.geneId === geneId; })[0];
    if (!match) {
      fail('SHARED_GENE_CONSUMER_NOT_FOUND',
        'Agent is not an exact consumer of the requested Shared Gene');
    }
    return match.otherConsumerCount;
  }

  function validateBaseLedger(ledger) {
    var ids;
    var i;
    var pointer;
    if (!ledger || typeof ledger !== 'object' ||
        !ledger.agents || typeof ledger.agents !== 'object' ||
        !ledger.versions || typeof ledger.versions !== 'object' ||
        !ledger.activeVersionByAgent ||
        typeof ledger.activeVersionByAgent !== 'object') {
      fail('INVALID_EVOLUTION_LEDGER', 'Existing managed ledger is required');
    }
    ids = Object.keys(ledger.agents);
    if (!ids.length) fail('INVALID_EVOLUTION_LEDGER', 'Managed ledger has no agents');
    for (i = 0; i < ids.length; i += 1) {
      pointer = ledger.activeVersionByAgent[ids[i]];
      if (!pointer || !ledger.versions[pointer]) {
        fail('INVALID_EVOLUTION_LEDGER',
          'Managed ledger has no active version for ' + ids[i]);
      }
    }
    if (ledger.evolution &&
        ledger.evolution.schemaVersion !== EXTENSION_SCHEMA) {
      fail('INVALID_EVOLUTION_EXTENSION', 'Unsupported ledger.evolution schema');
    }
    return true;
  }

  function extensionFor(next) {
    if (!next.evolution) {
      next.evolution = {
        schemaVersion: EXTENSION_SCHEMA,
        escalations: {},
        bulkOperations: {},
        receipts: {},
        currentEscalationId: null,
        currentBulkOperationId: null
      };
    }
    if (!next.evolution.escalations) next.evolution.escalations = {};
    if (!next.evolution.bulkOperations) next.evolution.bulkOperations = {};
    if (!next.evolution.receipts) next.evolution.receipts = {};
    return next.evolution;
  }

  function nextLedger(ledger) {
    validateBaseLedger(ledger);
    var next = clone(ledger);
    extensionFor(next);
    return next;
  }

  function receiptCore(receipt) {
    var core = clone(receipt);
    delete core.id;
    delete core.sha256;
    return core;
  }

  function putReceipt(extension, core) {
    var normalized = clone(core);
    normalized.schemaVersion = RECEIPT_SCHEMA;
    return sha256(normalized).then(function (hash) {
      var receipt = clone(normalized);
      var id = 'evolution_receipt_' + hash.slice(0, 32);
      receipt.id = id;
      receipt.sha256 = hash;
      if (extension.receipts[id] &&
          canonical(extension.receipts[id]) !== canonical(receipt)) {
        fail('EVOLUTION_RECEIPT_COLLISION',
          'Evolution Receipt id refers to different evidence');
      }
      extension.receipts[id] = receipt;
      return receipt;
    });
  }

  function verifyReceipt(extension, receiptId, expectedHash) {
    var receipt = extension.receipts[receiptId];
    if (!receipt) {
      return Promise.reject((function () {
        var error = new Error('Evolution Receipt was not found');
        error.code = 'EVOLUTION_RECEIPT_NOT_FOUND';
        return error;
      }()));
    }
    return sha256(receiptCore(receipt)).then(function (hash) {
      if (hash !== receipt.sha256 || hash !== expectedHash ||
          receipt.id !== 'evolution_receipt_' + hash.slice(0, 32)) {
        fail('EVOLUTION_RECEIPT_MISMATCH',
          'Evolution Receipt no longer matches its exact evidence');
      }
      return receipt;
    });
  }

  function assertLedgerTargets(ledger, ids) {
    ids.forEach(function (id) {
      if (!ledger.agents[id]) {
        fail('UNKNOWN_EVOLUTION_TARGET', 'Unknown managed ledger agent ' + id);
      }
      if (!ledger.activeVersionByAgent[id] ||
          !ledger.versions[ledger.activeVersionByAgent[id]]) {
        fail('UNKNOWN_EVOLUTION_TARGET',
          'Target has no active managed version ' + id);
      }
    });
  }

  function classScope(scope) {
    var kind = typeof scope === 'string' ? scope :
      scope && (scope.kind || scope.type);
    if (kind !== 'class') {
      fail('CLASS_SCOPE_REQUIRED', 'Agent Cabinet escalation scope must be class');
    }
    return { kind: 'class' };
  }

  function escalationContractCore(change) {
    return {
      schemaVersion: 'extella.evolution.cabinet-escalation.v1',
      candidateId: change.candidateId,
      candidateBundleSha256: change.candidateBundleSha256,
      scope: clone(change.scope),
      affectedAgentIds: clone(change.affectedAgentIds),
      targetListSha256: change.targetListSha256,
      actorId: change.actorId,
      baselineVersionByAgent: clone(change.baselineVersionByAgent),
      baselineVersionSha256ByAgent:
        clone(change.baselineVersionSha256ByAgent)
    };
  }

  function verifyEscalationIntegrity(ledger, change) {
    var extension = ledger.evolution;
    var currentIds;
    var hashPromises;
    if (!change || !extension ||
        extension.escalations[change.candidateId] !== change) {
      return Promise.reject((function () {
        var error = new Error('Cabinet escalation was not found');
        error.code = 'CABINET_ESCALATION_NOT_FOUND';
        return error;
      }()));
    }
    try {
      currentIds = exactIds(change.affectedAgentIds,
        'CABINET_ESCALATION_TAMPERED', 'affected agent ids');
      assertLedgerTargets(ledger, currentIds);
    } catch (error) {
      return Promise.reject(error);
    }
    hashPromises = [
      sha256(change.candidateBundle),
      sha256(currentIds),
      sha256(escalationContractCore(change))
    ];
    currentIds.forEach(function (id) {
      var versionId = change.baselineVersionByAgent[id];
      var version = ledger.versions[versionId];
      if (!version || !version.bundle ||
          !isHash(version.bundleSha256) ||
          change.baselineVersionSha256ByAgent[id] !== version.bundleSha256) {
        hashPromises.push(rejected(
          'CABINET_ESCALATION_TAMPERED',
          'Cabinet escalation exact baseline is unavailable for ' + id
        ));
      } else {
        hashPromises.push(sha256(version.bundle));
      }
    });
    return Promise.all(hashPromises).then(function (hashes) {
      var baselineMismatch = currentIds.some(function (id, index) {
        return hashes[index + 3] !==
          change.baselineVersionSha256ByAgent[id];
      });
      if (hashes[0] !== change.candidateBundleSha256 ||
          hashes[1] !== change.targetListSha256 ||
          hashes[2] !== change.contractSha256 ||
          baselineMismatch) {
        fail('CABINET_ESCALATION_TAMPERED',
          'Cabinet escalation content changed after acceptance');
      }
      return verifyReceipt(
        extension,
        change.acceptanceReceiptId,
        change.acceptanceReceiptSha256
      );
    }).then(function (receipt) {
      if (receipt.type !== 'CABINET_ESCALATION_ACCEPTED' ||
          receipt.status !== 'SUCCESS' ||
          receipt.candidateId !== change.candidateId ||
          receipt.candidateBundleSha256 !== change.candidateBundleSha256 ||
          receipt.targetListSha256 !== change.targetListSha256 ||
          !sameIds(receipt.affectedAgentIds, change.affectedAgentIds) ||
          canonical(receipt.baselineVersionByAgent) !==
            canonical(change.baselineVersionByAgent) ||
          canonical(receipt.baselineVersionSha256ByAgent) !==
            canonical(change.baselineVersionSha256ByAgent)) {
        fail('CABINET_ACCEPTANCE_RECEIPT_BINDING_MISMATCH',
          'Cabinet acceptance Evolution Receipt no longer binds exact evidence');
      }
      return change;
    });
  }

  function acceptCabinetEscalation(ledger, contract, opts) {
    var next;
    var extension;
    var candidateId;
    var candidateBundle;
    var suppliedHash;
    var affected;
    var actor;
    var baseline = {};
    var baselineHashes = {};
    var hashPromises;
    var acceptedAt = nowValue(opts);
    try {
      next = nextLedger(ledger);
      extension = next.evolution;
      contract = contract || {};
      candidateId = requiredString(
        contract.candidate_id,
        'CANDIDATE_ID_REQUIRED',
        'candidate_id'
      );
      if (extension.escalations[candidateId]) {
        fail('CANDIDATE_ID_COLLISION',
          'candidate_id already exists in this Evolution Loop');
      }
      if (!contract.candidate_bundle ||
          typeof contract.candidate_bundle !== 'object' ||
          Array.isArray(contract.candidate_bundle)) {
        fail('CANDIDATE_BUNDLE_REQUIRED', 'candidate_bundle object is required');
      }
      candidateBundle = clone(contract.candidate_bundle);
      suppliedHash = requireHash(
        contract.candidate_sha256,
        'CANDIDATE_SHA256_REQUIRED',
        'candidate_sha256'
      );
      classScope(contract.scope);
      affected = exactIds(
        contract.affected_agent_ids,
        'AFFECTED_AGENT_IDS_REQUIRED',
        'affected agent ids'
      );
      assertLedgerTargets(next, affected);
      var allLedgerIds = Object.keys(next.agents).sort();
      var candidateAgentIds = candidateBundle.agents &&
        typeof candidateBundle.agents === 'object' &&
        !Array.isArray(candidateBundle.agents) ?
        Object.keys(candidateBundle.agents).sort() : [];
      var evolutionChange = candidateBundle.evolutionChange;
      if (candidateBundle.schemaVersion !==
            'agent-configuration-bundle.v1' ||
          !sameIds(candidateAgentIds, allLedgerIds) ||
          !candidateBundle.sharedCapabilities ||
          typeof candidateBundle.sharedCapabilities !== 'object' ||
          Array.isArray(candidateBundle.sharedCapabilities) ||
          !Array.isArray(candidateBundle.sharedRules) ||
          !evolutionChange ||
          evolutionChange.schemaVersion !==
            'extella.evolution.shared_gene_change.v1' ||
          !String(evolutionChange.sharedGeneId || '') ||
          !String(evolutionChange.desiredVersion || '') ||
          !isHash(evolutionChange.sharedGeneMapSha256) ||
          !evolutionChange.beforeVersionByAgent ||
          !sameIds(
            Object.keys(evolutionChange.beforeVersionByAgent || {}).sort(),
            affected
          ) ||
          !sameIds(
            exactIds(
              evolutionChange.affectedAgentIds,
              'CANDIDATE_BUNDLE_INCOMPLETE',
              'candidate evolution affected agent ids'
            ),
            affected
          )) {
        fail('CANDIDATE_BUNDLE_INCOMPLETE',
          'candidate_bundle must be one full immutable Agent configuration bundle');
      }
      allLedgerIds.forEach(function (id) {
        var entry = candidateBundle.agents[id];
        if (!entry || typeof entry !== 'object' ||
            String(entry.agentId || '') !== id ||
            !entry.agent || String(entry.agent.id || '') !== id) {
          fail('CANDIDATE_BUNDLE_INCOMPLETE',
            'candidate_bundle has no exact full Agent entry for ' + id);
        }
      });
      actor = actorValue(
        contract.actor_id,
        opts,
        'CABINET_ESCALATION_ACTOR_MISMATCH'
      );
      affected.forEach(function (id) {
        baseline[id] = next.activeVersionByAgent[id];
        if (!next.versions[baseline[id]].bundle ||
            !isHash(next.versions[baseline[id]].bundleSha256)) {
          fail('CABINET_BASELINE_INVALID',
            'Exact immutable baseline is unavailable for ' + id);
        }
      });
    } catch (error) {
      return Promise.reject(error);
    }
    hashPromises = [
      sha256(candidateBundle),
      sha256(affected)
    ];
    affected.forEach(function (id) {
      hashPromises.push(sha256(next.versions[baseline[id]].bundle));
    });
    return Promise.all(hashPromises).then(function (hashes) {
      var change;
      affected.forEach(function (id, index) {
        var declaredHash = next.versions[baseline[id]].bundleSha256;
        if (hashes[index + 2] !== declaredHash) {
          fail('CABINET_BASELINE_HASH_MISMATCH',
            'Managed baseline bundle hash mismatch for ' + id);
        }
        baselineHashes[id] = declaredHash;
      });
      if (hashes[0] !== suppliedHash) {
        fail('CANDIDATE_SHA256_MISMATCH',
          'candidate_sha256 does not match the recomputed candidate bundle');
      }
      change = {
        candidateId: candidateId,
        candidateBundleSha256: hashes[0],
        candidateBundle: candidateBundle,
        candidateVersionId: 'evolution_cfg_' + hashes[0].slice(0, 24),
        scope: { kind: 'class' },
        affectedAgentIds: affected,
        targetListSha256: hashes[1],
        actorId: actor,
        baselineVersionByAgent: baseline,
        baselineVersionSha256ByAgent: baselineHashes,
        status: 'PENDING_CLASS_DECISION',
        acceptedAt: acceptedAt,
        test: null,
        approval: null,
        activation: null,
        publication: null,
        observation: null,
        rollback: null,
        contractSha256: null
      };
      return sha256(escalationContractCore(change)).then(function (contractHash) {
        change.contractSha256 = contractHash;
        extension.escalations[candidateId] = change;
        extension.currentEscalationId = candidateId;
        return putReceipt(extension, {
          type: 'CABINET_ESCALATION_ACCEPTED',
          status: 'SUCCESS',
          candidateId: candidateId,
          candidateBundleSha256: hashes[0],
          targetListSha256: hashes[1],
          affectedAgentIds: affected,
          baselineVersionByAgent: baseline,
          baselineVersionSha256ByAgent: baselineHashes,
          actorId: actor,
          at: acceptedAt
        }).then(function (receipt) {
          change.acceptanceReceiptId = receipt.id;
          change.acceptanceReceiptSha256 = receipt.sha256;
          return deepFreeze(next);
        });
      });
    });
  }

  function caseRows(value, label) {
    var rows = Array.isArray(value) ? value : [];
    var seen = {};
    var output = [];
    if (!rows.length) {
      fail('CLASS_TEST_CASES_REQUIRED', label + ' cases are required');
    }
    rows.forEach(function (row) {
      var id = requiredString(
        row && (row.case_id || row.id),
        'INVALID_CLASS_TEST_CASE',
        label + ' case id'
      );
      if (hasOwn(seen, id)) {
        fail('DUPLICATE_CLASS_TEST_CASE', 'Duplicate ' + label + ' case ' + id);
      }
      if (!row || !hasOwn(row, 'input') || !hasOwn(row, 'result')) {
        fail('INVALID_CLASS_TEST_CASE',
          label + ' case must contain input and result');
      }
      seen[id] = true;
      output.push({
        caseId: id,
        input: clone(row.input),
        result: clone(row.result)
      });
    });
    return output.sort(function (left, right) {
      return left.caseId < right.caseId ? -1 :
        left.caseId > right.caseId ? 1 : 0;
    });
  }

  function classTestIsolation(evidence, change) {
    var isolation = evidence && evidence.isolation;
    var receiptRef;
    var receiptSha256;
    var startedAt;
    var completedAt;
    requireExactKeys(
      isolation,
      PLAYGROUND_ISOLATION_KEYS,
      'CLASS_TEST_ISOLATION_REQUIRED',
      'Evolution Lab isolation evidence'
    );
    if (isolation.schema !== PLAYGROUND_ISOLATION_SCHEMA ||
        isolation.status !== 'PASSED' ||
        isolation.environment_class !== 'DISPOSABLE_SANDBOX' ||
        isolation.target_resolution !== 'RUNNER_ONLY' ||
        isolation.owner_device_access !== 'DENIED' ||
        isolation.external_write_policy !== 'DENY' ||
        isolation.teardown_status !== 'CONFIRMED') {
      fail(
        'CLASS_TEST_NOT_ISOLATED',
        'Evolution Lab must prove a disposed runner-only sandbox with no owner-device access'
      );
    }
    requiredString(
      isolation.runner_id,
      'CLASS_TEST_ISOLATION_INVALID',
      'playground runner_id'
    );
    requiredString(
      isolation.run_id,
      'CLASS_TEST_ISOLATION_INVALID',
      'playground run_id'
    );
    requiredString(
      isolation.environment_id,
      'CLASS_TEST_ISOLATION_INVALID',
      'playground environment_id'
    );
    receiptRef = requiredString(
      isolation.receipt_ref,
      'CLASS_TEST_ISOLATION_RECEIPT_REQUIRED',
      'playground receipt_ref'
    );
    receiptSha256 = requireHash(
      isolation.receipt_sha256,
      'CLASS_TEST_ISOLATION_RECEIPT_REQUIRED',
      'playground receipt_sha256'
    );
    if (!/^xtl_evolution:playground_receipt:[a-f0-9]{32}$/.test(receiptRef) ||
        receiptRef.slice(-32) !== receiptSha256.slice(0, 32)) {
      fail(
        'CLASS_TEST_ISOLATION_RECEIPT_MISMATCH',
        'Evolution Lab isolation receipt must be addressed by its content hash'
      );
    }
    if (requireHash(
      isolation.candidate_sha256,
      'CLASS_TEST_ISOLATION_BINDING_REQUIRED',
      'playground candidate_sha256'
    ) !== change.candidateBundleSha256 || requireHash(
      isolation.target_list_sha256,
      'CLASS_TEST_ISOLATION_BINDING_REQUIRED',
      'playground target_list_sha256'
    ) !== change.targetListSha256) {
      fail(
        'CLASS_TEST_ISOLATION_BINDING_MISMATCH',
        'Evolution Lab isolation receipt must bind the exact candidate and target list'
      );
    }
    startedAt = requireIsoTime(
      isolation.started_at,
      'CLASS_TEST_ISOLATION_TIME_INVALID',
      'playground started_at'
    );
    completedAt = requireIsoTime(
      isolation.completed_at,
      'CLASS_TEST_ISOLATION_TIME_INVALID',
      'playground completed_at'
    );
    if (Date.parse(completedAt) < Date.parse(startedAt)) {
      fail(
        'CLASS_TEST_ISOLATION_TIME_INVALID',
        'Evolution Lab isolation completion cannot precede its start'
      );
    }
    return clone(isolation);
  }

  function recordClassTest(ledger, candidateId, evidence, opts) {
    var next;
    var extension;
    var change;
    var before;
    var after;
    var targets;
    var isolation;
    var evidenceCandidateId;
    var actor;
    var at = nowValue(opts);
    try {
      next = nextLedger(ledger);
      extension = next.evolution;
      change = extension.escalations[String(candidateId || '')];
      if (!change) fail('CABINET_ESCALATION_NOT_FOUND', 'Cabinet escalation was not found');
      if (change.status !== 'PENDING_CLASS_DECISION' &&
          change.status !== 'TESTED') {
        fail('CLASS_TEST_NOT_ALLOWED', 'Class test is not allowed in the current status');
      }
      evidence = evidence || {};
      if (evidence.status !== 'PASSED') {
        fail('CLASS_TEST_NOT_PASSED', 'Evolution Lab evidence must be PASSED');
      }
      if ((evidence.externalWrites || []).length ||
          Number(evidence.writeAttempts || 0) !== 0) {
        fail('CLASS_TEST_SIDE_EFFECTS',
          'Evolution Lab class test must prove zero external writes');
      }
      isolation = classTestIsolation(evidence, change);
      evidenceCandidateId = requiredString(
        evidence.candidate_id,
        'CLASS_TEST_CANDIDATE_BINDING_REQUIRED',
        'class test candidate_id'
      );
      if (evidenceCandidateId !== change.candidateId ||
          requireHash(
            evidence.candidate_sha256,
            'CLASS_TEST_CANDIDATE_HASH_REQUIRED',
            'class test candidate_sha256'
          ) !== change.candidateBundleSha256 ||
          requireHash(
            evidence.target_list_sha256,
            'CLASS_TEST_TARGET_HASH_REQUIRED',
            'class test target_list_sha256'
          ) !== change.targetListSha256) {
        fail('CLASS_TEST_BINDING_MISMATCH',
          'Evolution Lab evidence must bind the exact candidate and target list');
      }
      before = caseRows(evidence.before_cases, 'before');
      after = caseRows(evidence.after_cases, 'after');
      if (before.length !== after.length) {
        fail('CLASS_TEST_CASE_MISMATCH',
          'Before and after must contain the exact same cases');
      }
      before.forEach(function (row, index) {
        if (row.caseId !== after[index].caseId ||
            canonical(row.input) !== canonical(after[index].input)) {
          fail('CLASS_TEST_CASE_MISMATCH',
            'Before and after must use identical case ids and inputs');
        }
      });
      targets = exactIds(
        evidence.target_agent_ids,
        'CLASS_TEST_TARGETS_REQUIRED',
        'class test target ids'
      );
      if (!sameIds(targets, change.affectedAgentIds)) {
        fail('CLASS_TEST_TARGET_MISMATCH',
          'Class test must cover every exact affected agent');
      }
      actor = actorValue(
        evidence.actor_id,
        opts,
        'CLASS_TEST_ACTOR_MISMATCH'
      );
    } catch (error) {
      return Promise.reject(error);
    }
    return verifyEscalationIntegrity(next, change).then(function () {
      return Promise.all([
        sha256(before.map(function (row) {
          return { caseId: row.caseId, input: row.input };
        })),
        sha256(evidence)
      ]);
    }).then(function (hashes) {
      return putReceipt(extension, {
        type: 'CLASS_TEST_COMPLETED',
        status: 'PASSED',
        candidateId: change.candidateId,
        candidateBundleSha256: change.candidateBundleSha256,
        targetListSha256: change.targetListSha256,
        targetAgentIds: change.affectedAgentIds,
        caseSetSha256: hashes[0],
        evidenceSha256: hashes[1],
        beforeCases: before,
        afterCases: after,
        externalWrites: [],
        writeAttempts: 0,
        isolation: isolation,
        actorId: actor,
        at: at
      }).then(function (receipt) {
        change.test = {
          receiptId: receipt.id,
          receiptSha256: receipt.sha256,
          caseSetSha256: hashes[0],
          evidenceSha256: hashes[1],
          isolationReceiptRef: isolation.receipt_ref,
          isolationReceiptSha256: isolation.receipt_sha256,
          playgroundRunnerId: isolation.runner_id,
          playgroundRunId: isolation.run_id,
          candidateBundleSha256: change.candidateBundleSha256,
          targetListSha256: change.targetListSha256,
          status: 'PASSED'
        };
        change.approval = null;
        change.activation = null;
        change.status = 'TESTED';
        return deepFreeze(next);
      });
    });
  }

  function approveClassChange(ledger, candidateId, approval, opts) {
    var next;
    var extension;
    var change;
    var targets;
    var actor;
    var at = nowValue(opts);
    try {
      next = nextLedger(ledger);
      extension = next.evolution;
      change = extension.escalations[String(candidateId || '')];
      if (!change || change.status !== 'TESTED' || !change.test) {
        fail('CLASS_APPROVAL_REQUIRES_TEST',
          'Exact PASSED class test is required before approval');
      }
      approval = approval || {};
      targets = exactIds(
        approval.target_agent_ids,
        'CLASS_APPROVAL_TARGETS_REQUIRED',
        'approval target ids'
      );
      if (!sameIds(targets, change.affectedAgentIds) ||
          requireHash(approval.target_list_sha256,
            'CLASS_APPROVAL_TARGET_HASH_REQUIRED',
            'target_list_sha256') !== change.targetListSha256) {
        fail('CLASS_APPROVAL_TARGET_MISMATCH',
          'Approval must bind the exact affected target list');
      }
      if (requireHash(approval.candidate_sha256,
            'CLASS_APPROVAL_CANDIDATE_HASH_REQUIRED',
            'candidate_sha256') !== change.candidateBundleSha256 ||
          requireHash(approval.test_receipt_sha256,
            'CLASS_APPROVAL_TEST_HASH_REQUIRED',
            'test_receipt_sha256') !== change.test.receiptSha256) {
        fail('CLASS_APPROVAL_EVIDENCE_MISMATCH',
          'Approval must bind the exact candidate and Test Evolution Receipt');
      }
      actor = actorValue(
        approval.actor_id,
        opts,
        'CLASS_APPROVAL_ACTOR_MISMATCH'
      );
    } catch (error) {
      return Promise.reject(error);
    }
    return verifyEscalationIntegrity(next, change).then(function () {
      return verifyReceipt(
        extension,
        change.test.receiptId,
        change.test.receiptSha256
      );
    }).then(function () {
      return putReceipt(extension, {
        type: 'CLASS_CHANGE_APPROVED',
        status: 'SUCCESS',
        candidateId: change.candidateId,
        candidateBundleSha256: change.candidateBundleSha256,
        testReceiptSha256: change.test.receiptSha256,
        targetListSha256: change.targetListSha256,
        targetAgentIds: change.affectedAgentIds,
        actorId: actor,
        at: at
      });
    }).then(function (receipt) {
      change.approval = {
        receiptId: receipt.id,
        receiptSha256: receipt.sha256,
        candidateBundleSha256: change.candidateBundleSha256,
        testReceiptSha256: change.test.receiptSha256,
        targetListSha256: change.targetListSha256
      };
      change.status = 'APPROVED';
      return deepFreeze(next);
    });
  }

  function normalizeStages(stages, exactTargets, code) {
    var input = Array.isArray(stages) ? stages : [];
    var seen = {};
    var output = [];
    if (!input.length) fail(code, 'At least one activation stage is required');
    input.forEach(function (stage, index) {
      var ids = exactIds(
        Array.isArray(stage) ? stage : stage && stage.target_agent_ids,
        code,
        'stage ' + index + ' target ids'
      );
      ids.forEach(function (id) {
        if (hasOwn(seen, id)) fail(code, 'Target appears in more than one stage: ' + id);
        seen[id] = true;
      });
      output.push({
        index: index,
        targetAgentIds: ids,
        status: 'PENDING',
        receiptIds: []
      });
    });
    if (!sameIds(Object.keys(seen).sort(), exactTargets)) {
      fail(code, 'Activation stages must cover the exact confirmed target list');
    }
    return output;
  }

  function rejected(code, message) {
    var error = new Error(message || code);
    error.code = code;
    return Promise.reject(error);
  }

  function exactObjectBindings(value, bindings) {
    return Object.keys(bindings).every(function (key) {
      return value && value[key] === bindings[key];
    });
  }

  function verifyActivationState(extension, activation, targets, descriptor) {
    var stageLists = [];
    var activated = [];
    var nextIndex;
    try {
      if (!activation || !Array.isArray(activation.stages) ||
          !activation.stages.length) {
        fail(descriptor.code, 'Activation plan is missing');
      }
      nextIndex = Number(activation.nextStageIndex);
      if (nextIndex < 0 || nextIndex > activation.stages.length ||
          Math.floor(nextIndex) !== nextIndex) {
        fail(descriptor.code, 'Activation next stage index is invalid');
      }
      activation.stages.forEach(function (stage, index) {
        var ids;
        if (!stage || stage.index !== index) {
          fail(descriptor.code, 'Activation stage index changed');
        }
        ids = exactIds(
          stage.targetAgentIds,
          descriptor.code,
          'activation stage target ids'
        );
        stageLists.push(ids);
        if (index < nextIndex) {
          if (stage.status !== 'ACTIVATED' ||
              !Array.isArray(stage.receiptIds) ||
              stage.receiptIds.length !== ids.length) {
            fail(descriptor.code,
              'Completed activation stage has incomplete target receipts');
          }
          activated = activated.concat(ids);
        } else if (stage.status !== 'PENDING' ||
                   (stage.receiptIds && stage.receiptIds.length)) {
          fail(descriptor.code,
            'Future activation stage was modified before its turn');
        }
      });
      normalizeStages(stageLists, targets, descriptor.code);
      if (!sameIds(activated.sort(), optionalIds(
            activation.activatedAgentIds,
            descriptor.code,
            'activated agent ids'
          ))) {
        fail(descriptor.code,
          'Activated agent set does not match completed stages');
      }
    } catch (error) {
      return Promise.reject(error);
    }
    return verifyReceipt(
      extension,
      activation.planReceiptId,
      activation.planReceiptSha256
    ).then(function (receipt) {
      if (receipt.type !== descriptor.receiptType ||
          !exactObjectBindings(receipt, descriptor.bindings) ||
          canonical(receipt.stages) !== canonical(stageLists)) {
        fail(descriptor.code,
          'Activation plan no longer matches its exact Evolution Receipt');
      }
      return Promise.all(activation.stages.slice(0, nextIndex).map(
        function (stage) {
          var seen = {};
          var targetChecks = stage.receiptIds.map(function (receiptId) {
            var stored = extension.receipts[receiptId];
            return verifyReceipt(
              extension,
              receiptId,
              stored && stored.sha256
            ).then(function (targetReceipt) {
              var targetId = targetReceipt.platformAgentId;
              if (targetReceipt.type !== descriptor.targetReceiptType ||
                  targetReceipt.status !== 'SUCCESS' ||
                  targetReceipt.stageIndex !== stage.index ||
                  stage.targetAgentIds.indexOf(targetId) === -1 ||
                  hasOwn(seen, targetId) ||
                  !descriptor.validateTargetReceipt(
                    targetReceipt,
                    targetId,
                    stage
                  )) {
                fail(descriptor.code,
                  'Per-target Evolution Receipt does not match activation');
              }
              seen[targetId] = true;
            });
          });
          targetChecks.push(verifyReceipt(
            extension,
            stage.summaryReceiptId,
            stage.summaryReceiptSha256
          ).then(function (summaryReceipt) {
            if (summaryReceipt.type !== descriptor.summaryReceiptType ||
                summaryReceipt.status !== 'SUCCESS' ||
                summaryReceipt.stageIndex !== stage.index ||
                !exactObjectBindings(summaryReceipt, descriptor.bindings) ||
                !sameIds(summaryReceipt.targetAgentIds,
                  stage.targetAgentIds) ||
                canonical(summaryReceipt.targetReceiptIds) !==
                  canonical(stage.receiptIds)) {
              fail(descriptor.code,
                'Stage summary Evolution Receipt does not match activation');
            }
          }));
          return Promise.all(targetChecks).then(function () {
            if (!sameIds(Object.keys(seen).sort(), stage.targetAgentIds)) {
              fail(descriptor.code,
                'Per-target Evolution Receipts do not cover exact stage targets');
            }
          });
        }
      ));
    }).then(function () {
      return activation;
    });
  }

  function verifyClassGates(ledger, change) {
    if (!change.test || !change.approval) {
      return rejected(
        'CLASS_GATES_REQUIRED',
        'Class activation requires exact test and approval'
      );
    }
    if (change.test.status !== 'PASSED' ||
        change.test.candidateBundleSha256 !== change.candidateBundleSha256 ||
        change.test.targetListSha256 !== change.targetListSha256 ||
        change.approval.candidateBundleSha256 !==
          change.candidateBundleSha256 ||
        change.approval.testReceiptSha256 !== change.test.receiptSha256 ||
        change.approval.targetListSha256 !== change.targetListSha256) {
      return rejected(
        'CLASS_GATE_BINDING_MISMATCH',
        'Class test or approval no longer binds the exact candidate and targets'
      );
    }
    return verifyEscalationIntegrity(ledger, change).then(function () {
      return verifyReceipt(
        ledger.evolution,
        change.test.receiptId,
        change.test.receiptSha256
      );
    }).then(function (receipt) {
      if (receipt.type !== 'CLASS_TEST_COMPLETED' ||
          receipt.status !== 'PASSED' ||
          receipt.candidateId !== change.candidateId ||
          receipt.candidateBundleSha256 !== change.candidateBundleSha256 ||
          receipt.targetListSha256 !== change.targetListSha256 ||
          !sameIds(receipt.targetAgentIds, change.affectedAgentIds) ||
          receipt.writeAttempts !== 0 ||
          !Array.isArray(receipt.externalWrites) ||
          receipt.externalWrites.length) {
        fail('CLASS_TEST_RECEIPT_BINDING_MISMATCH',
          'Class test Evolution Receipt does not bind the exact safe test');
      }
      return verifyReceipt(
        ledger.evolution,
        change.approval.receiptId,
        change.approval.receiptSha256
      );
    }).then(function (receipt) {
      if (receipt.type !== 'CLASS_CHANGE_APPROVED' ||
          receipt.status !== 'SUCCESS' ||
          receipt.candidateId !== change.candidateId ||
          receipt.candidateBundleSha256 !== change.candidateBundleSha256 ||
          receipt.testReceiptSha256 !== change.test.receiptSha256 ||
          receipt.targetListSha256 !== change.targetListSha256 ||
          !sameIds(receipt.targetAgentIds, change.affectedAgentIds)) {
        fail('CLASS_APPROVAL_RECEIPT_BINDING_MISMATCH',
          'Class approval Evolution Receipt does not bind the exact test and targets');
      }
      return change;
    });
  }

  function verifyClassActivationState(ledger, change) {
    return verifyActivationState(
      ledger.evolution,
      change.activation,
      change.affectedAgentIds,
      {
        code: 'CLASS_ACTIVATION_PLAN_TAMPERED',
        receiptType: 'CLASS_ACTIVATION_PLANNED',
        targetReceiptType: 'CLASS_TARGET_ACTIVATED',
        summaryReceiptType: 'CLASS_STAGE_ACTIVATED',
        bindings: {
          candidateId: change.candidateId,
          candidateBundleSha256: change.candidateBundleSha256,
          targetListSha256: change.targetListSha256
        },
        validateTargetReceipt: function (receipt) {
          return receipt.candidateId === change.candidateId &&
            receipt.toVersionId === change.candidateVersionId &&
            receipt.toVersionSha256 === change.candidateBundleSha256;
        }
      }
    );
  }

  function planClassActivation(ledger, candidateId, plan, opts) {
    var next;
    var extension;
    var change;
    var stages;
    var actor;
    var at = nowValue(opts);
    try {
      next = nextLedger(ledger);
      extension = next.evolution;
      change = extension.escalations[String(candidateId || '')];
      if (!change || change.status !== 'APPROVED') {
        fail('CLASS_ACTIVATION_REQUIRES_APPROVAL',
          'Target-bound class approval is required');
      }
      plan = plan || {};
      stages = normalizeStages(
        plan.stages,
        change.affectedAgentIds,
        'INVALID_CLASS_ACTIVATION_PLAN'
      );
      actor = actorValue(
        plan.actor_id,
        opts,
        'CLASS_ACTIVATION_ACTOR_MISMATCH'
      );
    } catch (error) {
      return Promise.reject(error);
    }
    return verifyClassGates(next, change).then(function () {
      return putReceipt(extension, {
        type: 'CLASS_ACTIVATION_PLANNED',
        status: 'SUCCESS',
        candidateId: change.candidateId,
        candidateBundleSha256: change.candidateBundleSha256,
        targetListSha256: change.targetListSha256,
        stages: stages.map(function (stage) {
          return stage.targetAgentIds;
        }),
        actorId: actor,
        at: at
      });
    }).then(function (receipt) {
      change.activation = {
        planReceiptId: receipt.id,
        planReceiptSha256: receipt.sha256,
        stages: stages,
        nextStageIndex: 0,
        activatedAgentIds: []
      };
      change.status = 'ACTIVATION_PLANNED';
      return deepFreeze(next);
    });
  }

  function ensureCandidateVersion(next, change, actor, at) {
    var existing = next.versions[change.candidateVersionId];
    if (existing) {
      if (existing.immutable !== true ||
          existing.bundleSha256 !== change.candidateBundleSha256 ||
          canonical(existing.bundle) !== canonical(change.candidateBundle)) {
        fail('CANDIDATE_VERSION_COLLISION',
          'Candidate version id refers to different immutable content');
      }
      return existing;
    }
    var parents = {};
    Object.keys(change.baselineVersionByAgent).forEach(function (id) {
      parents[change.baselineVersionByAgent[id]] = true;
    });
    existing = {
      id: change.candidateVersionId,
      sequence: Object.keys(next.versions).length + 1,
      status: 'STAGED',
      immutable: true,
      parentVersionIds: Object.keys(parents).sort(),
      createdAt: at,
      createdBy: actor,
      bundleSha256: change.candidateBundleSha256,
      bundle: clone(change.candidateBundle)
    };
    next.versions[existing.id] = existing;
    return existing;
  }

  function exactStageResults(results, ids, code) {
    var rows = Array.isArray(results) ? results : [];
    var byId = {};
    if (rows.length !== ids.length) fail(code, 'A result is required for every stage target');
    rows.forEach(function (row) {
      var id = requiredString(
        row && (row.agent_id || row.platformAgentId),
        code,
        'stage result agent id'
      );
      if (hasOwn(byId, id)) fail(code, 'Duplicate stage result for ' + id);
      if (row.status !== 'SUCCESS') fail(code, 'Every stage target must report SUCCESS');
      byId[id] = row;
    });
    if (!sameIds(Object.keys(byId).sort(), ids)) {
      fail(code, 'Stage results do not match the exact stage target list');
    }
    return byId;
  }

  function activateClassStage(ledger, candidateId, stageIndex, results, opts) {
    var next;
    var extension;
    var change;
    var activation;
    var stage;
    var resultById;
    var actor;
    var at = nowValue(opts);
    try {
      next = nextLedger(ledger);
      extension = next.evolution;
      change = extension.escalations[String(candidateId || '')];
      if (!change || (change.status !== 'ACTIVATION_PLANNED' &&
          change.status !== 'STAGING')) {
        fail('CLASS_STAGE_NOT_ALLOWED', 'Class activation has not been planned');
      }
      activation = change.activation;
      if (!activation || Number(stageIndex) !== activation.nextStageIndex) {
        fail('CLASS_STAGE_ORDER_MISMATCH', 'Only the exact next activation stage may run');
      }
      stage = activation.stages[activation.nextStageIndex];
      if (!stage || stage.status !== 'PENDING') {
        fail('CLASS_STAGE_ORDER_MISMATCH', 'Activation stage is not pending');
      }
      resultById = exactStageResults(
        results,
        stage.targetAgentIds,
        'INVALID_CLASS_STAGE_RESULTS'
      );
      stage.targetAgentIds.forEach(function (id) {
        var row = resultById[id];
        if (String(row.applied_candidate_id || '') !== change.candidateId ||
            requireHash(
              row.applied_candidate_sha256,
              'CLASS_STAGE_CANDIDATE_HASH_REQUIRED',
              'applied_candidate_sha256'
            ) !== change.candidateBundleSha256) {
          fail('CLASS_STAGE_CANDIDATE_MISMATCH',
            'Class activation read-back does not match the exact candidate for ' + id);
        }
      });
      actor = actorValue(
        opts && opts.actorId,
        opts,
        'CLASS_ACTIVATION_ACTOR_MISMATCH'
      );
      stage.targetAgentIds.forEach(function (id) {
        if (next.activeVersionByAgent[id] !== change.baselineVersionByAgent[id]) {
          fail('STALE_CLASS_ACTIVATION_BASE',
            'Active version changed after Cabinet escalation acceptance for ' + id);
        }
      });
    } catch (error) {
      return Promise.reject(error);
    }
    return verifyClassGates(next, change).then(function () {
      return verifyClassActivationState(next, change);
    }).then(function () {
      var version = ensureCandidateVersion(next, change, actor, at);
      return Promise.all(stage.targetAgentIds.map(function (id) {
        var previousId = next.activeVersionByAgent[id];
        next.activeVersionByAgent[id] = version.id;
        return putReceipt(extension, {
          type: 'CLASS_TARGET_ACTIVATED',
          status: 'SUCCESS',
          candidateId: change.candidateId,
          platformAgentId: id,
          fromVersionId: previousId,
          toVersionId: version.id,
          toVersionSha256: version.bundleSha256,
          result: clone(resultById[id]),
          stageIndex: stage.index,
          actorId: actor,
          at: at
        });
      }));
    }).then(function (receipts) {
      stage.status = 'ACTIVATED';
      stage.receiptIds = receipts.map(function (receipt) { return receipt.id; });
      activation.activatedAgentIds = activation.activatedAgentIds.concat(
        stage.targetAgentIds
      ).sort();
      activation.nextStageIndex += 1;
      change.status = activation.nextStageIndex === activation.stages.length ?
        'STAGED' : 'STAGING';
      return putReceipt(extension, {
        type: 'CLASS_STAGE_ACTIVATED',
        status: 'SUCCESS',
        candidateId: change.candidateId,
        candidateBundleSha256: change.candidateBundleSha256,
        targetListSha256: change.targetListSha256,
        stageIndex: stage.index,
        targetAgentIds: stage.targetAgentIds,
        targetReceiptIds: stage.receiptIds,
        actorId: actor,
        at: at
      });
    }).then(function (receipt) {
      stage.summaryReceiptId = receipt.id;
      stage.summaryReceiptSha256 = receipt.sha256;
      return deepFreeze(next);
    });
  }

  function publishClassChange(ledger, candidateId, opts) {
    var next;
    var extension;
    var change;
    var version;
    var actor;
    var at = nowValue(opts);
    try {
      next = nextLedger(ledger);
      extension = next.evolution;
      change = extension.escalations[String(candidateId || '')];
      if (!change || change.status !== 'STAGED' || !change.activation ||
          !sameIds(change.activation.activatedAgentIds, change.affectedAgentIds)) {
        fail('CLASS_PUBLISH_REQUIRES_STAGED_ACTIVATION',
          'Every exact class target must complete staged activation');
      }
      actor = actorValue(
        opts && opts.actorId,
        opts,
        'CLASS_PUBLISH_ACTOR_REQUIRED'
      );
      version = next.versions[change.candidateVersionId];
      if (!version || version.immutable !== true ||
          version.bundleSha256 !== change.candidateBundleSha256 ||
          canonical(version.bundle) !== canonical(change.candidateBundle)) {
        fail('CLASS_PUBLISH_CANDIDATE_MISMATCH',
          'Staged candidate version does not match the accepted Cabinet escalation');
      }
      change.affectedAgentIds.forEach(function (id) {
        if (next.activeVersionByAgent[id] !== change.candidateVersionId) {
          fail('CLASS_PUBLISH_POINTER_MISMATCH',
            'Class target is not bound to the staged candidate ' + id);
        }
      });
    } catch (error) {
      return Promise.reject(error);
    }
    return verifyClassGates(next, change).then(function () {
      return verifyClassActivationState(next, change);
    }).then(function () {
      return sha256(version.bundle);
    }).then(function (hash) {
      if (hash !== change.candidateBundleSha256) {
        fail('CLASS_PUBLISH_CANDIDATE_MISMATCH',
          'Candidate version bundle hash changed before publish');
      }
      version.status = 'PUBLISHED';
      return putReceipt(extension, {
        type: 'CLASS_CHANGE_PUBLISHED',
        status: 'SUCCESS',
        candidateId: change.candidateId,
        versionId: change.candidateVersionId,
        versionSha256: hash,
        targetAgentIds: change.affectedAgentIds,
        targetListSha256: change.targetListSha256,
        actorId: actor,
        at: at
      });
    }).then(function (receipt) {
      change.publication = {
        receiptId: receipt.id,
        receiptSha256: receipt.sha256,
        versionId: change.candidateVersionId,
        versionSha256: change.candidateBundleSha256
      };
      change.status = 'PUBLISHED';
      return deepFreeze(next);
    });
  }

  function recordClassObservation(ledger, candidateId, observation, opts) {
    var next;
    var extension;
    var change;
    var targets;
    var activeVersionByAgent;
    var actor;
    var at = nowValue(opts);
    try {
      next = nextLedger(ledger);
      extension = next.evolution;
      change = extension.escalations[String(candidateId || '')];
      if (!change || change.status !== 'PUBLISHED' || !change.publication) {
        fail('CLASS_OBSERVATION_REQUIRES_PUBLISH',
          'Published class change is required before observation');
      }
      if (!observation || typeof observation !== 'object' ||
          Array.isArray(observation) || !Object.keys(observation).length) {
        fail('CLASS_OBSERVATION_REQUIRED', 'Observation evidence is required');
      }
      targets = exactIds(
        observation.target_agent_ids,
        'CLASS_OBSERVATION_TARGETS_REQUIRED',
        'class observation target ids'
      );
      activeVersionByAgent = stateMap(
        observation.active_version_by_agent,
        change.affectedAgentIds,
        'CLASS_OBSERVATION_CURRENT_VERSIONS_REQUIRED',
        'class observation active_version_by_agent'
      );
      if (requiredString(
            observation.candidate_id,
            'CLASS_OBSERVATION_CANDIDATE_REQUIRED',
            'class observation candidate_id'
          ) !== change.candidateId ||
          requireHash(
            observation.candidate_sha256,
            'CLASS_OBSERVATION_CANDIDATE_HASH_REQUIRED',
            'class observation candidate_sha256'
          ) !== change.candidateBundleSha256 ||
          requireHash(
            observation.target_list_sha256,
            'CLASS_OBSERVATION_TARGET_HASH_REQUIRED',
            'class observation target_list_sha256'
          ) !== change.targetListSha256 ||
          !sameIds(targets, change.affectedAgentIds)) {
        fail('CLASS_OBSERVATION_BINDING_MISMATCH',
          'Observation must bind the exact candidate and target list');
      }
      change.affectedAgentIds.forEach(function (id) {
        if (requiredString(
              activeVersionByAgent[id],
              'CLASS_OBSERVATION_CURRENT_VERSION_REQUIRED',
              'class observation active version for ' + id
            ) !== change.candidateVersionId ||
            next.activeVersionByAgent[id] !== change.candidateVersionId) {
          fail('CLASS_OBSERVATION_CURRENT_VERSION_MISMATCH',
            'Observation did not read back the exact current version for ' + id);
        }
      });
      actor = actorValue(
        opts && opts.actorId,
        opts,
        'CLASS_OBSERVATION_ACTOR_REQUIRED'
      );
    } catch (error) {
      return Promise.reject(error);
    }
    return verifyClassGates(next, change).then(function () {
      return verifyClassActivationState(next, change);
    }).then(function () {
      return sha256(observation);
    }).then(function (evidenceHash) {
      return putReceipt(extension, {
        type: 'CLASS_CHANGE_OBSERVED',
        status: 'SUCCESS',
        candidateId: change.candidateId,
        candidateBundleSha256: change.candidateBundleSha256,
        versionId: change.candidateVersionId,
        targetAgentIds: change.affectedAgentIds,
        targetListSha256: change.targetListSha256,
        activeVersionByAgent: activeVersionByAgent,
        observationSha256: evidenceHash,
        observation: clone(observation),
        actorId: actor,
        at: at
      });
    }).then(function (receipt) {
      change.observation = {
        receiptId: receipt.id,
        receiptSha256: receipt.sha256
      };
      change.status = 'OBSERVED';
      return deepFreeze(next);
    });
  }

  function rollbackClassChange(ledger, candidateId, results, opts) {
    var next;
    var extension;
    var change;
    var actor;
    var before = {};
    var activated;
    var resultById = {};
    var at = nowValue(opts);
    try {
      next = nextLedger(ledger);
      extension = next.evolution;
      change = extension.escalations[String(candidateId || '')];
      if (!change || ['STAGING', 'STAGED', 'PUBLISHED', 'OBSERVED']
          .indexOf(change.status) === -1) {
        fail('CLASS_ROLLBACK_NOT_ALLOWED',
          'Class change has no staged or published state to roll back');
      }
      actor = actorValue(
        opts && opts.actorId,
        opts,
        'CLASS_ROLLBACK_ACTOR_REQUIRED'
      );
      activated = change.activation &&
        change.activation.activatedAgentIds ?
        change.activation.activatedAgentIds.slice().sort() : [];
      if (!activated.length || !Array.isArray(results) ||
          results.length !== activated.length) {
        fail('CLASS_ROLLBACK_RESULTS_REQUIRED',
          'Exact adapter read-back is required for every activated class target');
      }
      results.forEach(function (row) {
        var id = requiredString(
          row && (row.agent_id || row.platformAgentId),
          'INVALID_CLASS_ROLLBACK_RESULT',
          'class rollback result agent id'
        );
        if (hasOwn(resultById, id) || activated.indexOf(id) === -1 ||
            row.status !== 'SUCCESS' ||
            String(row.restored_version_id || '') !==
              change.baselineVersionByAgent[id] ||
            requireHash(
              row.restored_sha256,
              'CLASS_ROLLBACK_HASH_REQUIRED',
              'restored_sha256'
            ) !== change.baselineVersionSha256ByAgent[id]) {
          fail('CLASS_ROLLBACK_RESULT_MISMATCH',
            'Class rollback read-back does not restore the exact baseline for ' + id);
        }
        resultById[id] = row;
      });
      if (!sameIds(Object.keys(resultById).sort(), activated)) {
        fail('CLASS_ROLLBACK_TARGET_MISMATCH',
          'Class rollback results must match every activated target');
      }
      change.affectedAgentIds.forEach(function (id) {
        var pointer = next.activeVersionByAgent[id];
        if (pointer !== change.candidateVersionId &&
            pointer !== change.baselineVersionByAgent[id]) {
          fail('CLASS_ROLLBACK_POINTER_CONFLICT',
            'Target active pointer changed outside this Evolution Loop: ' + id);
        }
        before[id] = pointer;
      });
    } catch (error) {
      return Promise.reject(error);
    }
    return verifyClassGates(next, change).then(function () {
      return verifyClassActivationState(next, change);
    }).then(function () {
      return Promise.all(change.affectedAgentIds.map(function (id) {
        var baselineId = change.baselineVersionByAgent[id];
        var version = next.versions[baselineId];
        if (!version || !version.bundle || !isHash(version.bundleSha256)) {
          fail('CLASS_ROLLBACK_BASELINE_INVALID',
            'Exact baseline version is unavailable for ' + id);
        }
        return sha256(version.bundle).then(function (hash) {
          if (hash !== version.bundleSha256 ||
              hash !== change.baselineVersionSha256ByAgent[id]) {
            fail('CLASS_ROLLBACK_BASELINE_HASH_MISMATCH',
              'Exact baseline hash mismatch for ' + id);
          }
          return { platformAgentId: id, versionId: baselineId, sha256: hash };
        });
      }));
    }).then(function (baselines) {
      return Promise.all(baselines.map(function (baseline) {
        next.activeVersionByAgent[baseline.platformAgentId] = baseline.versionId;
        return putReceipt(extension, {
          type: 'CLASS_TARGET_ROLLED_BACK',
          status: 'SUCCESS',
          candidateId: change.candidateId,
          platformAgentId: baseline.platformAgentId,
          fromVersionId: before[baseline.platformAgentId],
          restoredVersionId: baseline.versionId,
          restoredSha256: baseline.sha256,
          verifiedExact: true,
          adapterReadBack: resultById[baseline.platformAgentId] ?
            clone(resultById[baseline.platformAgentId]) : null,
          adapterReadBackVerified:
            Boolean(resultById[baseline.platformAgentId]),
          actorId: actor,
          at: at
        });
      }));
    }).then(function (receipts) {
      return putReceipt(extension, {
        type: 'CLASS_CHANGE_ROLLED_BACK',
        status: 'SUCCESS',
        candidateId: change.candidateId,
        targetAgentIds: change.affectedAgentIds,
        targetReceiptIds: receipts.map(function (receipt) { return receipt.id; }),
        verifiedExact: true,
        adapterReadBackTargetIds: activated,
        adapterReadBackVerified: true,
        oneAction: true,
        actorId: actor,
        at: at
      });
    }).then(function (receipt) {
      change.rollback = {
        receiptId: receipt.id,
        receiptSha256: receipt.sha256,
        verifiedExact: true,
        adapterReadBackTargetIds: activated,
        adapterReadBackVerified: true,
        oneAction: true
      };
      change.status = 'ROLLED_BACK';
      return deepFreeze(next);
    });
  }

  function stateMap(value, targets, code, label) {
    var input = value && typeof value === 'object' && !Array.isArray(value) ?
      value : {};
    if (!sameIds(Object.keys(input).sort(), targets)) {
      fail(code, label + ' must contain the exact target list');
    }
    var output = {};
    targets.forEach(function (id) { output[id] = clone(input[id]); });
    return output;
  }

  function bulkIntegrityCore(operation) {
    return {
      schemaVersion: 'extella.evolution.bulk-operation.v1',
      operationId: operation.operationId,
      operationType: operation.operationType,
      targetAgentIds: clone(operation.targetAgentIds),
      targetListSha256: operation.targetListSha256,
      payloadSha256: operation.payloadSha256,
      impactSha256: operation.impactSha256,
      beforeStateSha256ByTarget: clone(operation.beforeStateSha256ByTarget),
      desiredStateSha256ByTarget: clone(operation.desiredStateSha256ByTarget)
    };
  }

  function verifyBulkIntegrity(ledger, operation) {
    if (!operation || !ledger.evolution ||
        ledger.evolution.bulkOperations[operation.operationId] !== operation) {
      return Promise.reject((function () {
        var error = new Error('Bulk operation was not found');
        error.code = 'BULK_OPERATION_NOT_FOUND';
        return error;
      }()));
    }
    return Promise.all([
      sha256(operation.targetAgentIds),
      sha256(operation.payload),
      sha256(operation.impact),
      sha256(operation.beforeStateByTarget),
      sha256(operation.desiredStateByTarget),
      sha256(bulkIntegrityCore(operation))
    ]).then(function (hashes) {
      if (hashes[0] !== operation.targetListSha256 ||
          hashes[1] !== operation.payloadSha256 ||
          hashes[2] !== operation.impactSha256 ||
          hashes[3] !== operation.beforeStateMapSha256 ||
          hashes[4] !== operation.desiredStateMapSha256 ||
          hashes[5] !== operation.integritySha256) {
        fail('BULK_OPERATION_TAMPERED',
          'Bulk operation changed after impact preview');
      }
      return verifyReceipt(
        ledger.evolution,
        operation.impactReceiptId,
        operation.impactReceiptSha256
      );
    }).then(function (receipt) {
      if (receipt.type !== 'BULK_IMPACT_PREVIEWED' ||
          receipt.status !== 'SUCCESS' ||
          receipt.operationId !== operation.operationId ||
          receipt.operationType !== operation.operationType ||
          receipt.targetListSha256 !== operation.targetListSha256 ||
          receipt.payloadSha256 !== operation.payloadSha256 ||
          receipt.impactSha256 !== operation.impactSha256 ||
          !sameIds(receipt.targetAgentIds, operation.targetAgentIds)) {
        fail('BULK_IMPACT_RECEIPT_BINDING_MISMATCH',
          'Bulk impact preview no longer binds the exact operation');
      }
      return operation;
    });
  }

  function verifyBulkConfirmation(ledger, operation) {
    var confirmation = operation && operation.confirmation;
    if (!confirmation ||
        confirmation.targetListSha256 !== operation.targetListSha256 ||
        confirmation.impactSha256 !== operation.impactSha256 ||
        confirmation.payloadSha256 !== operation.payloadSha256) {
      return rejected(
        'BULK_CONFIRMATION_BINDING_MISMATCH',
        'Bulk confirmation no longer binds exact targets, impact and payload'
      );
    }
    return verifyReceipt(
      ledger.evolution,
      confirmation.receiptId,
      confirmation.receiptSha256
    ).then(function (receipt) {
      if (receipt.type !== 'BULK_OPERATION_CONFIRMED' ||
          receipt.status !== 'SUCCESS' ||
          receipt.operationId !== operation.operationId ||
          receipt.operationType !== operation.operationType ||
          receipt.targetListSha256 !== operation.targetListSha256 ||
          receipt.impactSha256 !== operation.impactSha256 ||
          receipt.payloadSha256 !== operation.payloadSha256 ||
          !sameIds(receipt.targetAgentIds, operation.targetAgentIds)) {
        fail('BULK_CONFIRMATION_RECEIPT_BINDING_MISMATCH',
          'Bulk confirmation Evolution Receipt does not bind exact operation');
      }
      return operation;
    });
  }

  function verifyBulkActivationState(ledger, operation) {
    return verifyActivationState(
      ledger.evolution,
      operation.activation,
      operation.targetAgentIds,
      {
        code: 'BULK_ACTIVATION_PLAN_TAMPERED',
        receiptType: 'BULK_ACTIVATION_PLANNED',
        targetReceiptType: 'BULK_TARGET_ACTIVATED',
        summaryReceiptType: 'BULK_STAGE_ACTIVATED',
        bindings: {
          operationId: operation.operationId,
          operationType: operation.operationType,
          targetListSha256: operation.targetListSha256
        },
        validateTargetReceipt: function (receipt, targetId) {
          return receipt.operationId === operation.operationId &&
            receipt.operationType === operation.operationType &&
            receipt.beforeStateSha256 ===
              operation.beforeStateSha256ByTarget[targetId] &&
            receipt.afterStateSha256 ===
              operation.desiredStateSha256ByTarget[targetId];
        }
      }
    );
  }

  function createBulkOperation(ledger, spec, opts) {
    var next;
    var extension;
    var operationId;
    var operationType;
    var targets;
    var impact;
    var payload;
    var before;
    var desired;
    var actor;
    var at = nowValue(opts);
    try {
      next = nextLedger(ledger);
      extension = next.evolution;
      spec = spec || {};
      operationId = requiredString(
        spec.operation_id,
        'BULK_OPERATION_ID_REQUIRED',
        'operation_id'
      );
      if (extension.bulkOperations[operationId]) {
        fail('BULK_OPERATION_ID_COLLISION',
          'operation_id already exists in this Evolution Loop');
      }
      operationType = requiredString(
        spec.operation_type,
        'BULK_OPERATION_TYPE_REQUIRED',
        'operation_type'
      );
      if (!BULK_TYPES[operationType]) {
        fail('BULK_OPERATION_TYPE_UNSUPPORTED',
          'Unsupported bulk operation type');
      }
      targets = exactIds(
        spec.target_agent_ids,
        'BULK_TARGETS_REQUIRED',
        'bulk target ids'
      );
      assertLedgerTargets(next, targets);
      if (!spec.impact || typeof spec.impact !== 'object' ||
          Array.isArray(spec.impact) || !Object.keys(spec.impact).length) {
        fail('BULK_IMPACT_PREVIEW_REQUIRED',
          'Non-empty impact preview is required before bulk operation');
      }
      impact = clone(spec.impact);
      if (!spec.payload || typeof spec.payload !== 'object' ||
          Array.isArray(spec.payload) || !Object.keys(spec.payload).length) {
        fail('BULK_PAYLOAD_REQUIRED', 'Bulk operation payload is required');
      }
      payload = clone(spec.payload);
      before = stateMap(
        spec.before_state_by_target,
        targets,
        'BULK_BEFORE_STATE_REQUIRED',
        'before_state_by_target'
      );
      desired = stateMap(
        spec.desired_state_by_target,
        targets,
        'BULK_DESIRED_STATE_REQUIRED',
        'desired_state_by_target'
      );
      actor = actorValue(
        spec.actor_id,
        opts,
        'BULK_ACTOR_MISMATCH'
      );
    } catch (error) {
      return Promise.reject(error);
    }
    var hashPromises = [
      sha256(targets),
      sha256(payload),
      sha256(impact),
      sha256(before),
      sha256(desired)
    ];
    targets.forEach(function (id) {
      hashPromises.push(sha256(before[id]));
      hashPromises.push(sha256(desired[id]));
    });
    return Promise.all(hashPromises).then(function (hashes) {
      var beforeHashes = {};
      var desiredHashes = {};
      var offset = 5;
      targets.forEach(function (id) {
        beforeHashes[id] = hashes[offset];
        desiredHashes[id] = hashes[offset + 1];
        offset += 2;
      });
      var operation = {
        operationId: operationId,
        operationType: operationType,
        targetAgentIds: targets,
        targetListSha256: hashes[0],
        payload: payload,
        payloadSha256: hashes[1],
        impact: impact,
        impactSha256: hashes[2],
        beforeStateByTarget: before,
        beforeStateMapSha256: hashes[3],
        beforeStateSha256ByTarget: beforeHashes,
        desiredStateByTarget: desired,
        desiredStateMapSha256: hashes[4],
        desiredStateSha256ByTarget: desiredHashes,
        actorId: actor,
        createdAt: at,
        status: 'IMPACT_PREVIEWED',
        confirmation: null,
        activation: null,
        publication: null,
        observation: null,
        rollback: null,
        integritySha256: null
      };
      return sha256(bulkIntegrityCore(operation)).then(function (integrityHash) {
        operation.integritySha256 = integrityHash;
        extension.bulkOperations[operationId] = operation;
        extension.currentBulkOperationId = operationId;
        return putReceipt(extension, {
          type: 'BULK_IMPACT_PREVIEWED',
          status: 'SUCCESS',
          operationId: operationId,
          operationType: operationType,
          targetAgentIds: targets,
          targetListSha256: hashes[0],
          payloadSha256: hashes[1],
          impactSha256: hashes[2],
          actorId: actor,
          at: at
        });
      }).then(function (receipt) {
        operation.impactReceiptId = receipt.id;
        operation.impactReceiptSha256 = receipt.sha256;
        return deepFreeze(next);
      });
    });
  }

  function confirmBulkOperation(ledger, operationId, confirmation, opts) {
    var next;
    var extension;
    var operation;
    var targets;
    var actor;
    var at = nowValue(opts);
    try {
      next = nextLedger(ledger);
      extension = next.evolution;
      operation = extension.bulkOperations[String(operationId || '')];
      if (!operation || operation.status !== 'IMPACT_PREVIEWED') {
        fail('BULK_CONFIRMATION_REQUIRES_PREVIEW',
          'Bulk impact preview is required before confirmation');
      }
      confirmation = confirmation || {};
      targets = exactIds(
        confirmation.target_agent_ids,
        'BULK_CONFIRMATION_TARGETS_REQUIRED',
        'bulk confirmation target ids'
      );
      if (!sameIds(targets, operation.targetAgentIds) ||
          requireHash(confirmation.target_list_sha256,
            'BULK_CONFIRMATION_TARGET_HASH_REQUIRED',
            'target_list_sha256') !== operation.targetListSha256 ||
          requireHash(confirmation.impact_sha256,
            'BULK_CONFIRMATION_IMPACT_HASH_REQUIRED',
            'impact_sha256') !== operation.impactSha256 ||
          requireHash(confirmation.payload_sha256,
            'BULK_CONFIRMATION_PAYLOAD_HASH_REQUIRED',
            'payload_sha256') !== operation.payloadSha256) {
        fail('BULK_CONFIRMATION_MISMATCH',
          'Bulk confirmation must bind exact targets, impact and payload');
      }
      actor = actorValue(
        confirmation.actor_id,
        opts,
        'BULK_CONFIRMATION_ACTOR_MISMATCH'
      );
    } catch (error) {
      return Promise.reject(error);
    }
    return verifyBulkIntegrity(next, operation).then(function () {
      return verifyReceipt(
        extension,
        operation.impactReceiptId,
        operation.impactReceiptSha256
      );
    }).then(function () {
      return putReceipt(extension, {
        type: 'BULK_OPERATION_CONFIRMED',
        status: 'SUCCESS',
        operationId: operation.operationId,
        operationType: operation.operationType,
        targetAgentIds: operation.targetAgentIds,
        targetListSha256: operation.targetListSha256,
        impactSha256: operation.impactSha256,
        payloadSha256: operation.payloadSha256,
        actorId: actor,
        at: at
      });
    }).then(function (receipt) {
      operation.confirmation = {
        receiptId: receipt.id,
        receiptSha256: receipt.sha256,
        targetListSha256: operation.targetListSha256,
        impactSha256: operation.impactSha256,
        payloadSha256: operation.payloadSha256
      };
      operation.status = 'CONFIRMED';
      return deepFreeze(next);
    });
  }

  function planBulkActivation(ledger, operationId, plan, opts) {
    var next;
    var extension;
    var operation;
    var stages;
    var actor;
    var at = nowValue(opts);
    try {
      next = nextLedger(ledger);
      extension = next.evolution;
      operation = extension.bulkOperations[String(operationId || '')];
      if (!operation || operation.status !== 'CONFIRMED' ||
          !operation.confirmation) {
        fail('BULK_ACTIVATION_REQUIRES_CONFIRMATION',
          'Exact bulk confirmation is required before activation');
      }
      plan = plan || {};
      stages = normalizeStages(
        plan.stages,
        operation.targetAgentIds,
        'INVALID_BULK_ACTIVATION_PLAN'
      );
      actor = actorValue(
        plan.actor_id,
        opts,
        'BULK_ACTIVATION_ACTOR_MISMATCH'
      );
    } catch (error) {
      return Promise.reject(error);
    }
    return verifyBulkIntegrity(next, operation).then(function () {
      return verifyBulkConfirmation(next, operation);
    }).then(function () {
      return putReceipt(extension, {
        type: 'BULK_ACTIVATION_PLANNED',
        status: 'SUCCESS',
        operationId: operation.operationId,
        operationType: operation.operationType,
        targetListSha256: operation.targetListSha256,
        stages: stages.map(function (stage) { return stage.targetAgentIds; }),
        actorId: actor,
        at: at
      });
    }).then(function (receipt) {
      operation.activation = {
        planReceiptId: receipt.id,
        planReceiptSha256: receipt.sha256,
        stages: stages,
        nextStageIndex: 0,
        activatedAgentIds: []
      };
      operation.status = 'ACTIVATION_PLANNED';
      return deepFreeze(next);
    });
  }

  function bulkResultRows(results, stage, operation) {
    var byId = exactStageResults(
      results,
      stage.targetAgentIds,
      'INVALID_BULK_STAGE_RESULTS'
    );
    stage.targetAgentIds.forEach(function (id) {
      var row = byId[id];
      if (requireHash(
            row.before_state_sha256,
            'BULK_STAGE_BEFORE_HASH_REQUIRED',
            'before_state_sha256'
          ) !== operation.beforeStateSha256ByTarget[id] ||
          requireHash(
            row.after_state_sha256,
            'BULK_STAGE_AFTER_HASH_REQUIRED',
            'after_state_sha256'
          ) !== operation.desiredStateSha256ByTarget[id]) {
        fail('BULK_STAGE_STATE_MISMATCH',
          'Bulk target result does not match exact before/desired state for ' + id);
      }
    });
    return byId;
  }

  function activateBulkStage(ledger, operationId, stageIndex, results, opts) {
    var next;
    var extension;
    var operation;
    var activation;
    var stage;
    var resultById;
    var actor;
    var at = nowValue(opts);
    try {
      next = nextLedger(ledger);
      extension = next.evolution;
      operation = extension.bulkOperations[String(operationId || '')];
      if (!operation || (operation.status !== 'ACTIVATION_PLANNED' &&
          operation.status !== 'STAGING')) {
        fail('BULK_STAGE_NOT_ALLOWED', 'Bulk activation has not been planned');
      }
      activation = operation.activation;
      if (!activation || Number(stageIndex) !== activation.nextStageIndex) {
        fail('BULK_STAGE_ORDER_MISMATCH',
          'Only the exact next bulk activation stage may run');
      }
      stage = activation.stages[activation.nextStageIndex];
      resultById = bulkResultRows(results, stage, operation);
      actor = actorValue(
        opts && opts.actorId,
        opts,
        'BULK_ACTIVATION_ACTOR_REQUIRED'
      );
    } catch (error) {
      return Promise.reject(error);
    }
    return verifyBulkIntegrity(next, operation).then(function () {
      return verifyBulkConfirmation(next, operation);
    }).then(function () {
      return verifyBulkActivationState(next, operation);
    }).then(function () {
      return Promise.all(stage.targetAgentIds.map(function (id) {
        return putReceipt(extension, {
          type: 'BULK_TARGET_ACTIVATED',
          status: 'SUCCESS',
          operationId: operation.operationId,
          operationType: operation.operationType,
          platformAgentId: id,
          beforeStateSha256: operation.beforeStateSha256ByTarget[id],
          afterStateSha256: operation.desiredStateSha256ByTarget[id],
          result: clone(resultById[id]),
          stageIndex: stage.index,
          actorId: actor,
          at: at
        });
      }));
    }).then(function (receipts) {
      stage.status = 'ACTIVATED';
      stage.receiptIds = receipts.map(function (receipt) { return receipt.id; });
      activation.activatedAgentIds = activation.activatedAgentIds.concat(
        stage.targetAgentIds
      ).sort();
      activation.nextStageIndex += 1;
      operation.status = activation.nextStageIndex === activation.stages.length ?
        'STAGED' : 'STAGING';
      return putReceipt(extension, {
        type: 'BULK_STAGE_ACTIVATED',
        status: 'SUCCESS',
        operationId: operation.operationId,
        operationType: operation.operationType,
        targetListSha256: operation.targetListSha256,
        stageIndex: stage.index,
        targetAgentIds: stage.targetAgentIds,
        targetReceiptIds: stage.receiptIds,
        actorId: actor,
        at: at
      });
    }).then(function (receipt) {
      stage.summaryReceiptId = receipt.id;
      stage.summaryReceiptSha256 = receipt.sha256;
      return deepFreeze(next);
    });
  }

  function publishBulkOperation(ledger, operationId, opts) {
    var next;
    var extension;
    var operation;
    var actor;
    var at = nowValue(opts);
    try {
      next = nextLedger(ledger);
      extension = next.evolution;
      operation = extension.bulkOperations[String(operationId || '')];
      if (!operation || operation.status !== 'STAGED' ||
          !operation.activation ||
          !sameIds(operation.activation.activatedAgentIds,
            operation.targetAgentIds)) {
        fail('BULK_PUBLISH_REQUIRES_STAGED_ACTIVATION',
          'Every exact bulk target must complete staged activation');
      }
      actor = actorValue(
        opts && opts.actorId,
        opts,
        'BULK_PUBLISH_ACTOR_REQUIRED'
      );
    } catch (error) {
      return Promise.reject(error);
    }
    return verifyBulkIntegrity(next, operation).then(function () {
      return verifyBulkConfirmation(next, operation);
    }).then(function () {
      return verifyBulkActivationState(next, operation);
    }).then(function () {
      return putReceipt(extension, {
        type: 'BULK_OPERATION_PUBLISHED',
        status: 'SUCCESS',
        operationId: operation.operationId,
        operationType: operation.operationType,
        targetAgentIds: operation.targetAgentIds,
        targetListSha256: operation.targetListSha256,
        actorId: actor,
        at: at
      });
    }).then(function (receipt) {
      operation.publication = {
        receiptId: receipt.id,
        receiptSha256: receipt.sha256
      };
      operation.status = 'PUBLISHED';
      return deepFreeze(next);
    });
  }

  function recordBulkObservation(ledger, operationId, observation, opts) {
    var next;
    var extension;
    var operation;
    var targets;
    var desiredStateSha256ByTarget;
    var actor;
    var at = nowValue(opts);
    try {
      next = nextLedger(ledger);
      extension = next.evolution;
      operation = extension.bulkOperations[String(operationId || '')];
      if (!operation || operation.status !== 'PUBLISHED') {
        fail('BULK_OBSERVATION_REQUIRES_PUBLISH',
          'Published bulk operation is required before observation');
      }
      if (!observation || typeof observation !== 'object' ||
          Array.isArray(observation) || !Object.keys(observation).length) {
        fail('BULK_OBSERVATION_REQUIRED', 'Bulk observation evidence is required');
      }
      targets = exactIds(
        observation.target_agent_ids,
        'BULK_OBSERVATION_TARGETS_REQUIRED',
        'bulk observation target ids'
      );
      desiredStateSha256ByTarget = stateMap(
        observation.desired_state_sha256_by_target,
        operation.targetAgentIds,
        'BULK_OBSERVATION_DESIRED_STATE_REQUIRED',
        'bulk observation desired_state_sha256_by_target'
      );
      if (requiredString(
            observation.operation_id,
            'BULK_OBSERVATION_OPERATION_REQUIRED',
            'bulk observation operation_id'
          ) !== operation.operationId ||
          requiredString(
            observation.operation_type,
            'BULK_OBSERVATION_TYPE_REQUIRED',
            'bulk observation operation_type'
          ) !== operation.operationType ||
          requireHash(
            observation.target_list_sha256,
            'BULK_OBSERVATION_TARGET_HASH_REQUIRED',
            'bulk observation target_list_sha256'
          ) !== operation.targetListSha256 ||
          !sameIds(targets, operation.targetAgentIds)) {
        fail('BULK_OBSERVATION_BINDING_MISMATCH',
          'Bulk observation must bind the exact operation and target list');
      }
      operation.targetAgentIds.forEach(function (id) {
        if (requireHash(
              desiredStateSha256ByTarget[id],
              'BULK_OBSERVATION_DESIRED_STATE_HASH_REQUIRED',
              'bulk observation desired state SHA-256 for ' + id
            ) !== operation.desiredStateSha256ByTarget[id]) {
          fail('BULK_OBSERVATION_DESIRED_STATE_MISMATCH',
            'Bulk observation did not read back the exact desired state for ' + id);
        }
      });
      actor = actorValue(
        opts && opts.actorId,
        opts,
        'BULK_OBSERVATION_ACTOR_REQUIRED'
      );
    } catch (error) {
      return Promise.reject(error);
    }
    return verifyBulkIntegrity(next, operation).then(function () {
      return verifyBulkConfirmation(next, operation);
    }).then(function () {
      return verifyBulkActivationState(next, operation);
    }).then(function () {
      return sha256(observation);
    }).then(function (hash) {
      return putReceipt(extension, {
        type: 'BULK_OPERATION_OBSERVED',
        status: 'SUCCESS',
        operationId: operation.operationId,
        operationType: operation.operationType,
        targetAgentIds: operation.targetAgentIds,
        targetListSha256: operation.targetListSha256,
        desiredStateSha256ByTarget: desiredStateSha256ByTarget,
        observationSha256: hash,
        observation: clone(observation),
        actorId: actor,
        at: at
      });
    }).then(function (receipt) {
      operation.observation = {
        receiptId: receipt.id,
        receiptSha256: receipt.sha256
      };
      operation.status = 'OBSERVED';
      return deepFreeze(next);
    });
  }

  function rollbackBulkOperation(ledger, operationId, results, opts) {
    var next;
    var extension;
    var operation;
    var targets;
    var byId = {};
    var actor;
    var at = nowValue(opts);
    try {
      next = nextLedger(ledger);
      extension = next.evolution;
      operation = extension.bulkOperations[String(operationId || '')];
      if (!operation || ['STAGING', 'STAGED', 'PUBLISHED', 'OBSERVED']
          .indexOf(operation.status) === -1 ||
          !operation.activation ||
          !operation.activation.activatedAgentIds.length) {
        fail('BULK_ROLLBACK_NOT_ALLOWED',
          'Bulk operation has no activated targets to roll back');
      }
      targets = operation.activation.activatedAgentIds.slice().sort();
      if (!Array.isArray(results) || results.length !== targets.length) {
        fail('BULK_ROLLBACK_RESULTS_REQUIRED',
          'One-action rollback requires a result for every activated target');
      }
      results.forEach(function (row) {
        var id = requiredString(
          row && (row.agent_id || row.platformAgentId),
          'INVALID_BULK_ROLLBACK_RESULT',
          'rollback result agent id'
        );
        if (hasOwn(byId, id)) {
          fail('INVALID_BULK_ROLLBACK_RESULT',
            'Duplicate rollback result for ' + id);
        }
        if (row.status !== 'SUCCESS' ||
            requireHash(row.restored_state_sha256,
              'BULK_ROLLBACK_HASH_REQUIRED',
              'restored_state_sha256') !==
              operation.beforeStateSha256ByTarget[id]) {
          fail('BULK_ROLLBACK_STATE_MISMATCH',
            'Rollback did not restore the exact previous state for ' + id);
        }
        byId[id] = row;
      });
      if (!sameIds(Object.keys(byId).sort(), targets)) {
        fail('BULK_ROLLBACK_TARGET_MISMATCH',
          'Rollback results must match every exact activated target');
      }
      actor = actorValue(
        opts && opts.actorId,
        opts,
        'BULK_ROLLBACK_ACTOR_REQUIRED'
      );
    } catch (error) {
      return Promise.reject(error);
    }
    return verifyBulkIntegrity(next, operation).then(function () {
      return verifyBulkConfirmation(next, operation);
    }).then(function () {
      return verifyBulkActivationState(next, operation);
    }).then(function () {
      return Promise.all(targets.map(function (id) {
        return putReceipt(extension, {
          type: 'BULK_TARGET_ROLLED_BACK',
          status: 'SUCCESS',
          operationId: operation.operationId,
          operationType: operation.operationType,
          platformAgentId: id,
          restoredStateSha256: operation.beforeStateSha256ByTarget[id],
          result: clone(byId[id]),
          verifiedExact: true,
          actorId: actor,
          at: at
        });
      }));
    }).then(function (receipts) {
      return putReceipt(extension, {
        type: 'BULK_OPERATION_ROLLED_BACK',
        status: 'SUCCESS',
        operationId: operation.operationId,
        operationType: operation.operationType,
        targetAgentIds: targets,
        targetReceiptIds: receipts.map(function (receipt) { return receipt.id; }),
        verifiedExact: true,
        oneAction: true,
        actorId: actor,
        at: at
      });
    }).then(function (receipt) {
      operation.rollback = {
        receiptId: receipt.id,
        receiptSha256: receipt.sha256,
        verifiedExact: true,
        oneAction: true
      };
      operation.status = 'ROLLED_BACK';
      return deepFreeze(next);
    });
  }

  function validateEvolutionLedger(ledger) {
    validateBaseLedger(ledger);
    if (ledger.evolution) {
      if (!ledger.evolution.escalations ||
          !ledger.evolution.bulkOperations ||
          !ledger.evolution.receipts) {
        fail('INVALID_EVOLUTION_EXTENSION',
          'Evolution extension collections are required');
      }
    }
    return true;
  }

  return {
    EXTENSION_SCHEMA: EXTENSION_SCHEMA,
    RECEIPT_SCHEMA: RECEIPT_SCHEMA,
    FLEET_SCHEMA: FLEET_SCHEMA,
    SHARED_GENE_MAP_SCHEMA: SHARED_GENE_MAP_SCHEMA,
    CABINET_SCHEMA: CABINET_SCHEMA,
    canonical: canonical,
    sha256: sha256,
    buildFleetProjection: buildFleetProjection,
    buildSharedGenesMap: buildSharedGenesMap,
    cabinetSharedGeneCount: cabinetSharedGeneCount,
    acceptCabinetEscalation: acceptCabinetEscalation,
    recordClassTest: recordClassTest,
    approveClassChange: approveClassChange,
    planClassActivation: planClassActivation,
    activateClassStage: activateClassStage,
    publishClassChange: publishClassChange,
    recordClassObservation: recordClassObservation,
    rollbackClassChange: rollbackClassChange,
    createBulkOperation: createBulkOperation,
    confirmBulkOperation: confirmBulkOperation,
    planBulkActivation: planBulkActivation,
    activateBulkStage: activateBulkStage,
    publishBulkOperation: publishBulkOperation,
    recordBulkObservation: recordBulkObservation,
    rollbackBulkOperation: rollbackBulkOperation,
    validateEvolutionLedger: validateEvolutionLedger
  };
}());
