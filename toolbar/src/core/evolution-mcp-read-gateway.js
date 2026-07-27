// ── EXTELLA EVOLUTION · READ-ONLY MCP GATEWAY ─────────────────────────────
// Transport-neutral adapter over the canonical Automation Registry and the
// declared MCP registry.
//
// The Gateway owns no persistence, active pointer, ledger or cross-call
// cache. Every invocation loads current read sources through injected
// dependencies and exposes only the fixed read allowlist from the contract.

ETB.evolutionMcpReadGateway = (function () {
  'use strict';

  var AUTOMATION_SCHEMA = 'extella.evolution.automation_registry.v1';
  var MAX_PAGE = 100;
  var DEFAULT_PAGE = 50;

  function error(code, message) {
    var result = new Error(message || code);
    result.code = code;
    return result;
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

  function text(value, code, label, optional) {
    var result = String(value == null ? '' : value).trim();
    if (!result && optional) return '';
    if (!result || result.length > 240 || /[*?\[\]{}]/.test(result)) {
      throw error(code, label + ' must be an exact bounded value');
    }
    return result;
  }

  function automationId(value) {
    var result = text(
      value,
      'MCP_AUTOMATION_ID_REQUIRED',
      'automation_id'
    );
    if (!/^[a-z0-9][a-z0-9._-]{1,79}$/.test(result)) {
      throw error(
        'MCP_AUTOMATION_ID_REQUIRED',
        'automation_id is invalid'
      );
    }
    return result;
  }

  function assertContext(options, supplied) {
    var actorId;
    var accountId;
    var tenantId;
    if (typeof options.assertContext === 'function') options.assertContext();
    supplied = supplied || {};
    actorId = text(
      supplied.actorId || options.actorId,
      'MCP_READ_CONTEXT_REQUIRED',
      'actorId'
    );
    accountId = text(
      supplied.accountId || options.accountId,
      'MCP_READ_CONTEXT_REQUIRED',
      'accountId'
    );
    tenantId = text(
      supplied.tenantId || options.tenantId,
      'MCP_READ_CONTEXT_REQUIRED',
      'tenantId'
    );
    if (actorId !== options.actorId ||
        accountId !== options.accountId ||
        tenantId !== options.tenantId) {
      throw error(
        'MCP_READ_CONTEXT_MISMATCH',
        'the MCP read request belongs to another authenticated context'
      );
    }
    return {
      actor_id: actorId,
      account_id: accountId,
      tenant_id: tenantId
    };
  }

  function validateAutomationRegistry(value) {
    if (!object(value) ||
        value.schema !== AUTOMATION_SCHEMA ||
        value.scope !== 'CURRENT_DEVICE' ||
        typeof value.complete !== 'boolean' ||
        !String(value.checked_at || '').trim() ||
        !Array.isArray(value.rows) ||
        !object(value.counters) ||
        !Array.isArray(value.source_errors)) {
      throw error(
        'MCP_AUTOMATION_REGISTRY_INVALID',
        'canonical Automation Registry is unavailable or invalid'
      );
    }
    return clone(value);
  }

  function warning(code, messageRu, messageEn, source) {
    return {
      code: String(code),
      message_ru: String(messageRu),
      message_en: String(messageEn),
      source: String(source)
    };
  }

  function automationWarnings(registry) {
    return registry.source_errors.map(function (row) {
      return warning(
        row && row.code || 'AUTOMATION_SOURCE_UNAVAILABLE',
        'Один из источников реестра автоматизаций недоступен.',
        'One of the Automation Registry sources is unavailable.',
        row && row.source || 'automation_registry'
      );
    });
  }

  function toolDefinition(name) {
    var definitions = ETB.evolutionMcpContract.READ_TOOLS;
    var found = definitions.filter(function (row) {
      return row.name === name;
    });
    return found[0] || null;
  }

  function validateArguments(name, supplied) {
    var definition = toolDefinition(name);
    var args = supplied == null ? {} : supplied;
    var allowed;
    var requiredAutomation = name !== 'automations.list';
    if (!definition) {
      throw error(
        'MCP_READ_TOOL_UNSUPPORTED',
        'unsupported Evolution MCP read tool'
      );
    }
    if (!object(args)) {
      throw error(
        'MCP_READ_ARGUMENTS_INVALID',
        'tool arguments must be an object'
      );
    }
    allowed = definition.arguments;
    Object.keys(args).forEach(function (key) {
      if (allowed.indexOf(key) === -1) {
        throw error(
          'MCP_READ_ARGUMENTS_INVALID',
          'unknown argument ' + key
        );
      }
    });
    args = clone(args);
    if (requiredAutomation) args.automation_id = automationId(args.automation_id);
    if (hasOwn(args, 'installed') && typeof args.installed !== 'boolean') {
      throw error(
        'MCP_READ_ARGUMENTS_INVALID',
        'installed must be boolean'
      );
    }
    if (hasOwn(args, 'limit')) {
      if (!Number.isInteger(args.limit) ||
          args.limit < 1 || args.limit > MAX_PAGE) {
        throw error(
          'MCP_READ_ARGUMENTS_INVALID',
          'limit must be between 1 and ' + MAX_PAGE
        );
      }
    } else {
      args.limit = DEFAULT_PAGE;
    }
    if (hasOwn(args, 'cursor')) {
      args.cursor = text(
        args.cursor,
        'MCP_READ_ARGUMENTS_INVALID',
        'cursor'
      );
    }
    if (hasOwn(args, 'platform_agent_id')) {
      args.platform_agent_id = text(
        args.platform_agent_id,
        'MCP_READ_ARGUMENTS_INVALID',
        'platform_agent_id'
      );
    }
    if (hasOwn(args, 'tool_id')) {
      args.tool_id = text(
        args.tool_id,
        'MCP_READ_ARGUMENTS_INVALID',
        'tool_id'
      );
    }
    return args;
  }

  function currentTime(options) {
    var value = typeof options.now === 'function' ?
      options.now() : options.now;
    value = String(value || new Date().toISOString());
    if (!isFinite(Date.parse(value)) ||
        !/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
      throw error(
        'MCP_READ_TIMESTAMP_INVALID',
        'Gateway time must have an explicit offset'
      );
    }
    return value;
  }

  function automationById(registry, id) {
    var matches = registry.rows.filter(function (row) {
      return String(row && row.automation_id || '') === id;
    });
    if (matches.length !== 1) {
      throw error(
        'MCP_AUTOMATION_NOT_FOUND',
        'automation_id is not present exactly once in the current snapshot'
      );
    }
    return matches[0];
  }

  function idsFromMcpRegistry(registry) {
    var ids = {};
    function add(id) {
      if (id) ids[String(id)] = true;
    }
    registry.connections.forEach(function (row) { add(row.automation_id); });
    registry.tools.forEach(function (row) { add(row.automation_id); });
    registry.bindings.forEach(function (row) { add(row.automation_id); });
    registry.run_evidence.forEach(function (row) { add(row.automation_id); });
    registry.extensions.forEach(function (row) {
      row.automation_ids.forEach(add);
    });
    return Object.keys(ids).sort();
  }

  function componentAgentStates(row) {
    var result = {};
    var components = row && row.components;
    var agents = components && Array.isArray(components.platform_agents) ?
      components.platform_agents : [];
    agents.forEach(function (component) {
      var id = String(component && component.id || '');
      if (id) result[id] = String(component && component.state || 'UNKNOWN');
    });
    return result;
  }

  function crossSourceWarnings(automationRegistry, mcpRegistry) {
    var known = {};
    var rows = {};
    var unresolved;
    var result;
    automationRegistry.rows.forEach(function (row) {
      known[String(row.automation_id)] = true;
      rows[String(row.automation_id)] = row;
    });
    unresolved = idsFromMcpRegistry(mcpRegistry).filter(function (id) {
      return !known[id];
    });
    if (unresolved.length &&
        automationRegistry.complete === true &&
        mcpRegistry.complete === true) {
      throw error(
        'MCP_AUTOMATION_REFERENCE_DANGLING',
        'complete registries disagree on automation_id'
      );
    }
    result = unresolved.map(function () {
      return warning(
        'MCP_AUTOMATION_REFERENCE_UNRESOLVED',
        'Одна ссылка MCP не сопоставлена с неполным реестром автоматизаций.',
        'An MCP reference is unresolved against the incomplete Automation Registry.',
        'evolution.mcp.registry'
      );
    });
    mcpRegistry.bindings.forEach(function (binding) {
      var row = rows[binding.automation_id];
      var agentStates;
      var agentState;
      if (!row) return;
      agentStates = componentAgentStates(row);
      agentState = agentStates[binding.platform_agent_id];
      if (agentState === 'PRESENT') return;
      if (automationRegistry.complete === true &&
          mcpRegistry.complete === true &&
          agentState !== 'UNKNOWN') {
        throw error(
          'MCP_PLATFORM_AGENT_REFERENCE_DANGLING',
          'a complete Tool Binding has no usable internal platform_agent_id'
        );
      }
      result.push(warning(
        'MCP_PLATFORM_AGENT_REFERENCE_UNRESOLVED',
        'Одна привязка инструмента не сопоставлена с подтверждённым внутренним агентом.',
        'A Tool Binding is unresolved against the proven internal agents.',
        'evolution.mcp.registry'
      ));
    });
    return result;
  }

  function page(rows, idField, args, compare) {
    var sorted = rows.slice().sort(compare || function (left, right) {
      var leftId = String(left && left[idField] || '');
      var rightId = String(right && right[idField] || '');
      return leftId < rightId ? -1 : (leftId > rightId ? 1 : 0);
    });
    var start = 0;
    var slice;
    var nextCursor = null;
    if (args.cursor) {
      start = sorted.findIndex(function (row) {
        return String(row && row[idField] || '') === args.cursor;
      });
      if (start === -1) {
        throw error(
          'MCP_READ_CURSOR_INVALID',
          'cursor is not part of the current snapshot'
        );
      }
      start += 1;
    }
    slice = sorted.slice(start, start + args.limit);
    if (start + slice.length < sorted.length && slice.length) {
      nextCursor = String(slice[slice.length - 1][idField]);
    }
    return {
      items: clone(slice),
      page: {
        limit: args.limit,
        next_cursor: nextCursor
      }
    };
  }

  function matchingMcp(registry, automationIdValue, automationRow) {
    var agentStates = componentAgentStates(automationRow);
    var unresolved = registry.bindings.some(function (row) {
      return row.automation_id === automationIdValue &&
        agentStates[row.platform_agent_id] !== 'PRESENT';
    });
    var bindings = registry.bindings.filter(function (row) {
      return row.automation_id === automationIdValue &&
        row.enabled === true &&
        agentStates[row.platform_agent_id] === 'PRESENT';
    });
    var bindingIds = {};
    bindings.forEach(function (row) {
      bindingIds[row.binding_id] = true;
    });
    return {
      complete: registry.complete === true && unresolved === false,
      connections: registry.connections.filter(function (row) {
        return row.automation_id === automationIdValue;
      }),
      tools: registry.tools.filter(function (row) {
        return row.automation_id === automationIdValue;
      }),
      extensions: registry.extensions.filter(function (row) {
        return row.automation_ids.indexOf(automationIdValue) !== -1;
      }),
      bindings: bindings,
      run_evidence: registry.run_evidence.filter(function (row) {
        return row.automation_id === automationIdValue &&
          bindingIds[row.binding_id] === true;
      })
    };
  }

  function agentCabinetProjection(composition) {
    var platformAgents = composition.components &&
      Array.isArray(composition.components.platform_agents) ?
      composition.components.platform_agents : [];
    return {
      surface: 'Agent Cabinet',
      agents: platformAgents.map(function (component) {
        var id = String(component && component.id || '');
        return {
          platform_agent_id: id || null,
          component_state: component && component.state || 'UNKNOWN',
          tool_binding_count: id ? composition.mcp.bindings.filter(
            function (bindingRow) {
              return bindingRow.platform_agent_id === id &&
                bindingRow.enabled === true;
            }
          ).length : 0
        };
      })
    };
  }

  function projectData(name, args, automationRegistry, mcpRegistry) {
    var row;
    var result;
    var scoped;
    if (name === 'automations.list') {
      result = automationRegistry.rows.filter(function (automationRow) {
        return !hasOwn(args, 'installed') ||
          automationRow.flags &&
          automationRow.flags.installed === args.installed;
      });
      result = page(result, 'automation_id', args);
      result.complete = automationRegistry.complete;
      return result;
    }
    row = automationById(automationRegistry, args.automation_id);
    if (name === 'automations.get') {
      return {
        complete: automationRegistry.complete,
        automation: clone(row)
      };
    }
    if (name === 'automations.get_state') {
      return {
        complete: automationRegistry.complete &&
          row.state &&
          row.state.operational_status !== 'STATE_UNAVAILABLE',
        automation_id: args.automation_id,
        state: clone(row.state || {
          operational_status: 'STATE_UNAVAILABLE'
        })
      };
    }
    scoped = matchingMcp(mcpRegistry, args.automation_id, row);
    if (name === 'automations.get_composition') {
      result = {
        complete: automationRegistry.complete && scoped.complete,
        automation_id: args.automation_id,
        components: clone(row.components || {}),
        mcp: clone(scoped)
      };
      result.agent_cabinet = agentCabinetProjection(result);
      return result;
    }
    if (name === 'mcp.connections.list') {
      result = page(scoped.connections, 'connection_id', args);
    } else if (name === 'mcp.tools.list') {
      result = page(scoped.tools, 'tool_id', args);
    } else if (name === 'mcp.extensions.list') {
      result = page(scoped.extensions, 'extension_id', args);
    } else if (name === 'mcp.bindings.list') {
      result = page(scoped.bindings.filter(function (bindingRow) {
        return !args.platform_agent_id ||
          bindingRow.platform_agent_id === args.platform_agent_id;
      }), 'binding_id', args);
    } else if (name === 'runs.get_evidence') {
      result = page(mcpRegistry.run_evidence.filter(function (evidenceRow) {
        return evidenceRow.automation_id === args.automation_id &&
          componentAgentStates(row)[evidenceRow.platform_agent_id] ===
            'PRESENT' &&
          (!args.platform_agent_id ||
           evidenceRow.platform_agent_id === args.platform_agent_id) &&
          (!args.tool_id || evidenceRow.tool_id === args.tool_id);
      }), 'evidence_id', args, function (left, right) {
        var byTime = String(right.occurred_at).localeCompare(
          String(left.occurred_at)
        );
        if (byTime) return byTime;
        return String(left.evidence_id).localeCompare(
          String(right.evidence_id)
        );
      });
    } else {
      throw error(
        'MCP_READ_TOOL_UNSUPPORTED',
        'unsupported Evolution MCP read tool'
      );
    }
    result.complete = automationRegistry.complete && scoped.complete;
    return result;
  }

  function create(options) {
    var actorId;
    var accountId;
    var tenantId;
    options = options || {};
    actorId = text(
      options.actorId,
      'MCP_READ_CONTEXT_REQUIRED',
      'actorId'
    );
    accountId = text(
      options.accountId,
      'MCP_READ_CONTEXT_REQUIRED',
      'accountId'
    );
    tenantId = text(
      options.tenantId,
      'MCP_READ_CONTEXT_REQUIRED',
      'tenantId'
    );
    if (typeof options.loadAutomationRegistry !== 'function' ||
        typeof options.loadMcpRegistry !== 'function' ||
        typeof options.hash !== 'function' ||
        !ETB.evolutionMcpContract) {
      throw error(
        'MCP_READ_GATEWAY_UNAVAILABLE',
        'Gateway read dependencies are unavailable'
      );
    }
    options.actorId = actorId;
    options.accountId = accountId;
    options.tenantId = tenantId;

    function loadSnapshot(suppliedContext) {
      var context = assertContext(options, suppliedContext);
      var capturedAt = currentTime(options);
      return Promise.all([
        Promise.resolve().then(options.loadAutomationRegistry),
        Promise.resolve().then(options.loadMcpRegistry)
      ]).then(function (loaded) {
        var automationResult;
        var automationRegistry;
        var mcpRegistry;
        var warnings;
        assertContext(options, suppliedContext);
        automationResult = loaded[0];
        automationRegistry = validateAutomationRegistry(
          automationResult && automationResult.registry ?
            automationResult.registry : automationResult
        );
        mcpRegistry = ETB.evolutionMcpContract.validateRegistry(
          loaded[1],
          { accountId: accountId }
        );
        warnings = automationWarnings(automationRegistry)
          .concat(clone(mcpRegistry.warnings))
          .concat(crossSourceWarnings(automationRegistry, mcpRegistry));
        return Promise.resolve(options.hash({
          account_id: accountId,
          tenant_id: tenantId,
          automation_registry: automationRegistry,
          mcp_registry: mcpRegistry
        })).then(function (hash) {
          if (!/^[a-f0-9]{64}$/.test(String(hash || ''))) {
            throw error(
              'MCP_READ_SNAPSHOT_HASH_INVALID',
              'snapshot hash must be SHA-256'
            );
          }
          assertContext(options, suppliedContext);
          return {
            context: context,
            automationRegistry: automationRegistry,
            mcpRegistry: mcpRegistry,
            warnings: warnings,
            meta: {
              schema: ETB.evolutionMcpContract.SNAPSHOT_SCHEMA,
              snapshot_id: 'mcp_read_' + String(hash),
              captured_at: capturedAt,
              complete: automationRegistry.complete === true &&
                mcpRegistry.complete === true &&
                warnings.length === 0,
              sources: [{
                id: 'automation_registry',
                schema: automationRegistry.schema,
                checked_at: automationRegistry.checked_at,
                complete: automationRegistry.complete
              }, {
                id: 'mcp_registry',
                schema: mcpRegistry.schema,
                checked_at: mcpRegistry.checked_at,
                complete: mcpRegistry.complete
              }]
            }
          };
        });
      });
    }

    function invoke(name, suppliedArguments, suppliedContext) {
      name = String(name || '');
      var args = validateArguments(name, suppliedArguments);
      var requestId = text(
        suppliedContext && suppliedContext.requestId,
        'MCP_READ_REQUEST_ID_REQUIRED',
        'requestId'
      );
      return loadSnapshot(suppliedContext).then(function (snapshot) {
        var response = {
          schema: ETB.evolutionMcpContract.RESPONSE_SCHEMA,
          tool: name,
          request_id: requestId,
          context: snapshot.context,
          snapshot: snapshot.meta,
          data: projectData(
            name,
            args,
            snapshot.automationRegistry,
            snapshot.mcpRegistry
          ),
          warnings: snapshot.warnings
        };
        ETB.evolutionMcpContract.assertNoSecrets(response);
        return clone(response);
      });
    }

    return {
      listTools: function () {
        return clone(ETB.evolutionMcpContract.READ_TOOLS);
      },
      invoke: invoke
    };
  }

  return {
    create: create
  };
}());
