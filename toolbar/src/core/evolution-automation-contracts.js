// ── EVOLUTION AUTOMATION CONTRACTS ────────────────────────────────────────
// Read-only, release-pinned projection of the canonical surface table and
// release-ready Automation Passports supplied on 2026-08-06.  Runtime code
// consumes only this bounded projection; it never invents a passport from a
// device card and never treats a port response as proven automation state.

ETB.evolutionAutomationContracts = (function () {
  var SURFACE_SOURCE = {
    commit: 'd3341a2874db7730c750fd32ddb5da44207c3ea4',
    path: 'surface_classes.yaml',
    sha256: 'faccf0217126a24defe50f315238823096f27f00130b15c8317e96a88c11907e'
  };
  var SURFACES = {
    baga_thin: { class: 'automation', automation_id: 'extella_kz_grocery' },
    extella_1c_agent: { class: 'automation', automation_id: 'extella_1c_agent' },
    extella_contract_agent: { class: 'automation', automation_id: 'extella_contract_agent' },
    extella_predictive_sales: { class: 'automation', automation_id: 'extella_predictive_sales' },
    extella_recruiter: { class: 'automation', automation_id: 'extella_recruiter' },
    extella_travel_agency: { class: 'automation', automation_id: 'extella_travel_agency' },
    targetologist_team: { class: 'automation', automation_id: 'targetologist_team' },
    extella_adoption_wizard: { class: 'system' },
    extella_connectors: { class: 'system' },
    copilot_ctl: { class: 'system' },
    workspace: { class: 'system' },
    extella_composer_studio: { class: 'system' },
    extella_cspl_studio: { class: 'system' },
    extella_anon: { class: 'system' },
    extella_team: { class: 'system' },
    gh_excalidraw_excalidraw: { class: 'installed_app' },
    thindemo: { class: 'probe' }
  };
  var PASSPORTS = {
    extella_kz_grocery: {
      automation_id: 'extella_kz_grocery', registry_card_id: 'baga_thin',
      name: { ru: 'Баға — цены Казахстана', en: 'Baga — Kazakhstan grocery prices' },
      version: '0.4.0', hosting_profile: 'client_server',
      state_reader: { expert: 'kzg_state', method: '', schema: 'kzg_state.v1', execution_device: '85800354-f7b7-449f-b526-9357cd91f780', data_device: '85800354-f7b7-449f-b526-9357cd91f780', evidence: 'exact_target' },
      source: { commit: 'a9ef96d1079745f8d8b8ee63b94ed33ad564bf1e', path: 'docs/automation_passport.yaml', sha256: '43e5ac6d001a14edefd334323d53f994f4b3caf6ad4bba8b70d69a1fd30c263d' }
    },
    extella_predictive_sales: {
      automation_id: 'extella_predictive_sales', registry_card_id: 'extella_predictive_sales',
      name: { ru: 'Predictive Sales', en: 'Predictive Sales' }, version: '0.9.0', hosting_profile: 'local',
      state_reader: { expert: 'ps_call', method: 'read_state', schema: 'ps_read_state.v1', execution_device: '24f37e45-8c9f-4896-b64f-0dcd0cd8b0e4', data_device: '24f37e45-8c9f-4896-b64f-0dcd0cd8b0e4', evidence: 'exact_target' },
      source: { commit: '1edb839dd10bc8fc800d4987bed1df7c73b45aeb', path: 'docs/automation_passport.yaml', sha256: 'd12a9862aa394709826020462607984a9cb69e541515c3ec3a07600bfd59813e' }
    },
    extella_recruiter: {
      automation_id: 'extella_recruiter', registry_card_id: 'extella_recruiter',
      name: { ru: 'Агент-рекрутёр', en: 'Recruiting Agent' }, version: '0.1.0', hosting_profile: 'local',
      state_reader: { expert: 'rec_call', method: 'settings_status', schema: 'rec_settings_status.v1', execution_device: '24f37e45-8c9f-4896-b64f-0dcd0cd8b0e4', data_device: '24f37e45-8c9f-4896-b64f-0dcd0cd8b0e4', evidence: 'exact_target' },
      source: { commit: '7c94f46a64edda5554d32f66c48b3ff4fc6bc9c7', path: 'docs/automation_passport.yaml', sha256: 'd14e666d25c5b9962cee458724761364b142929bc6133dc673ee7f49e2ff2261' }
    },
    targetologist_team: {
      automation_id: 'targetologist_team', registry_card_id: 'targetologist_team',
      name: { ru: 'Таргетолог AI', en: 'Targetolog AI' }, version: '0.1.0', hosting_profile: 'local',
      state_reader: { expert: 'tgt_call', method: 'status_snapshot', schema: 'tgt_status_snapshot.v1', execution_device: '24f37e45-8c9f-4896-b64f-0dcd0cd8b0e4', data_device: '24f37e45-8c9f-4896-b64f-0dcd0cd8b0e4', evidence: 'exact_target' },
      source: { commit: '2b28c56182cabc5367a42a1f8e00f3e46d43d519', path: 'docs/automation_passport.yaml', sha256: 'cc44bacfa93a9afe1c0190ec9efe686c9b55dddc49f36f93dba436d33581e997' }
    },
    extella_contract_agent: {
      automation_id: 'extella_contract_agent', registry_card_id: 'extella_contract_agent',
      name: { ru: 'Агент по договорам', en: 'Contract Agent' }, version: '0.1.0', hosting_profile: 'local',
      state_reader: { expert: 'law_call', method: '/x/status', schema: 'law_status.v1', execution_device: '24f37e45-8c9f-4896-b64f-0dcd0cd8b0e4', data_device: '24f37e45-8c9f-4896-b64f-0dcd0cd8b0e4', evidence: 'exact_target' },
      source: { commit: '58ffcbc7e7f5916ac9f92e5c3717d08c1c4b949c', path: 'docs/automation_passport.yaml', sha256: '4ea3f28b91076c2d7afc1bc8108e5040cf91cb91ee980c9dbade2da4761f5944' }
    },
    extella_travel_agency: {
      automation_id: 'extella_travel_agency', registry_card_id: 'extella_travel_agency',
      name: { ru: 'Турагентство: лиды и подогрев базы', en: 'Travel agency: leads and base nurture' },
      version: '1.0.0', hosting_profile: 'local', state_reader: null,
      service: { port: 8766, health: '/api/health', state: '/api/state' },
      source: { commit: '672f5c4d4d1120ffaaff3d5d736a39f178360c36', path: 'extella-travel-agency-pack/docs/automation_passport.yaml', sha256: '8bb3cc3088301cc2954aded3d5df3d96d46f8188719da499678aac8a9778ebb8' }
    }
  };

  function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
  function surfaceForCard(cardId) { return clone(SURFACES[String(cardId || '')] || null); }
  function passportForAutomation(automationId) { return clone(PASSPORTS[String(automationId || '')] || null); }
  function passports() { return Object.keys(PASSPORTS).sort().map(function (id) { return clone(PASSPORTS[id]); }); }

  return {
    schema: 'extella.evolution.automation_contracts.v1',
    captured_at: '2026-08-06',
    surface_source: clone(SURFACE_SOURCE),
    surfaceForCard: surfaceForCard,
    passportForAutomation: passportForAutomation,
    passports: passports
  };
}());
