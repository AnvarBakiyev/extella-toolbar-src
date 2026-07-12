// ── PLUGINS MODULE ─────────────────────────────────────────────────────────
// Universal provision logic for all plugins — both curated (featured) and
// user-added (via the GitHub wizard). Replaces the old featured.js.
//
// When a plugin has pre-authored expert_defs (most form-driven plugins),
// those definitions are saved directly via /api/expert/save.
//
// When expert_defs is empty (LLM-driven plugins like api-docs-writer,
// brainstorm, code-explainer, etc.), the Extella agent is asked to
// auto-generate and save appropriate experts using the plugin manifest
// as context — conceptTexts, description, tagline, and initialPrompt.
// The agent calls save_expert via its own MCP tools, so the experts
// land in the same account as any manually authored expert.
//
// Flow:
//   installFeatured() → provision(manifest, 'install')
//     ├─ expert_defs present → saveExpert x N
//     └─ expert_defs empty  → _autoProvision(manifest) → runAgent()
//   → addConcept x M (conceptTexts)
//   → ETB.registry.install(id)  |  ETB.registry.addCustom(manifest)
//
// Exposes: ETB.plugins.provision(manifest, registryAction)

ETB.plugins = (function () {

  // ── Auto-provision via agent ────────────────────────────────────
  // Called when expert_defs is empty.  Asks the Extella agent to design
  // and save 1-3 experts that expose the plugin's core capabilities.
  // Uses the structured plugin manifest as context (not a repo digest), so
  // the prompt is concise and the agent has enough signal to make useful
  // experts immediately.
  function _autoProvision(manifest) {
    var id = manifest.id || 'plugin';

    // Truncate conceptTexts to keep the prompt under the agent token limit.
    // Each concept can be several KB; 3000 chars per concept is plenty
    // of context for the agent to understand the plugin's purpose.
    var concepts = (manifest.conceptTexts || [])
      .map(function (c) { return String(c).slice(0, 3000); })
      .join('\n\n---\n\n');

    var ctx = [
      'Plugin id: ' + id,
      'Name: ' + (manifest.name || ''),
      'Tagline: ' + (manifest.tagline || ''),
      'Description: ' + (manifest.description || ''),
      'Initial prompt shown to user: ' + ((manifest.ui && manifest.ui.initialPrompt) || ''),
      '',
      '=== PLUGIN CONCEPTS / SYSTEM CONTEXT ===',
      concepts || '(none)'
    ].join('\n');

    var prompt = [
      'You are the Extella Plugin Architect. The toolbar plugin below is LLM-driven: it has',
      'no pre-authored experts. Your job is to create 1-3 callable Extella experts for it',
      'using your save_expert tool.',
      '',
      'Rules:',
      '- Every expert name MUST start with "' + id + '_" in snake_case.',
      '- Use cspl "fython". Install any pip deps via $extens("include.py") + include(...).',
      '- Each expert must return {"status": "success"|"error", ...}.',
      '- Never hardcode secrets/tokens in expert code — accept them as kwargs.',
      '- Save each expert with your save_expert tool.',
      '',
      'After saving, reply with ONLY this JSON (no markdown fences):',
      '{"experts":[{"name":"...","description":"..."}]}',
      '',
      ctx
    ].join('\n');

    return ETB.api.runAgent(prompt);
  }

  // manifest.expert_defs / manifest.expertDefs:
  //   [{name, description, code (string or string[]), cspl, kwargs}]
  // manifest.conceptTexts: string[]
  // registryAction: 'install' (featured one-click) | 'addCustom' (wizard)
  return {
    provision: function (manifest, registryAction) {
      var action = registryAction || 'install';
      // Support both new (expert_defs) and legacy (expertDefs) field names
      var defs = manifest.expert_defs || manifest.expertDefs || [];
      var errors = [];
      var chain = Promise.resolve();

      if (defs.length === 0) {
        if ((manifest.mode || '') === 'llm_driven') {
          // Разговорная карточка: работает через чат напрямую (plugin-chat →
          // agent/run), эксперты ей не нужны. Раньше здесь гонялся агент-
          // «архитектор» — лишний чат, лишние кредиты и минуты ожидания,
          // а установка по сути локальная. Ставим мгновенно.
        } else {
          // No pre-authored experts — ask the Extella agent to generate them.
          // Best-effort: a failed agent call must not block the install itself.
          chain = chain
            .then(function () { return _autoProvision(manifest); })
            .catch(function (err) {
              console.warn('[ETB.plugins] auto-provision failed for ' +
                (manifest.id || '?') + ':', err && err.message || err);
            });
        }
      } else {
        // 1. Save all pre-authored expert definitions
        defs.forEach(function (def) {
          chain = chain.then(function () {
            var code = Array.isArray(def.code) ? def.code.join('\n') : (def.code || '');
            return ETB.api.saveExpert({
              name: def.name,
              description: def.description || '',
              code: code,
              kwargs: def.kwargs || {},
              cspl: def.cspl || 'fython'
            }).then(function (res) {
              if (!res || res.status !== 'success') {
                errors.push(def.name + ': ' + ((res && res.message) || 'save failed'));
              }
            }).catch(function (e) {
              errors.push(def.name + ': ' + e.message);
            });
          });
        });
      }

      // 2. Save concept texts (supplementary knowledge for the agent)
      (manifest.conceptTexts || []).forEach(function (text) {
        chain = chain.then(function () {
          return ETB.api.addConcept(text).catch(function () {});
        });
      });

      // 3. Register the plugin
      return chain.then(function () {
        // Fail hard only when there were pre-authored defs but ALL of them failed
        if (defs.length && errors.length === defs.length) {
          throw new Error('All experts failed to save: ' + errors[0]);
        }
        if (action === 'addCustom') {
          ETB.registry.addCustom(manifest);
        } else {
          ETB.registry.install(manifest.id);
        }
        return { installed: true, errors: errors };
      });
    }
  };
})();
