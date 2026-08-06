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
      state_reader: { expert: 'kzg_state', params: { args_json: '[]' }, method: '', schema: 'kzg_state.v1', execution_device: '85800354-f7b7-449f-b526-9357cd91f780', data_device: '85800354-f7b7-449f-b526-9357cd91f780', evidence: 'exact_target' },
      source: { commit: '740db9c56ad677199d8ae263c11b3b29e57637e0', path: 'docs/automation_passport.yaml', sha256: '1c039bec41dac2c29236fd37c41a425d04fa3edfce0211021c313f4c9cbf3c04' }
    },
    extella_predictive_sales: {
      automation_id: 'extella_predictive_sales', registry_card_id: 'extella_predictive_sales',
      name: { ru: 'Predictive Sales', en: 'Predictive Sales' }, version: '0.9.0', hosting_profile: 'local',
      state_reader: { expert: 'ps_call', params: { method: 'read_state', args_json: '[]', kwargs_json: '{}' }, method: 'read_state', schema: 'ps_read_state.v1', execution_device: '24f37e45-8c9f-4896-b64f-0dcd0cd8b0e4', data_device: '24f37e45-8c9f-4896-b64f-0dcd0cd8b0e4', evidence: 'exact_target' },
      source: { commit: '545d9bb05a258cf57aefe03a2b4a1a3736c9cccc', path: 'docs/automation_passport.yaml', sha256: '1c27d95a98eddf83e84187aa3177cea1e96c9bafef068ff3594836956d1db7a8' }
    },
    extella_recruiter: {
      automation_id: 'extella_recruiter', registry_card_id: 'extella_recruiter',
      name: { ru: 'Агент-рекрутёр', en: 'Recruiting Agent' }, version: '0.1.0', hosting_profile: 'local',
      state_reader: { expert: 'rec_call', params: { method: 'settings_status', args_json: '[]' }, method: 'settings_status', schema: 'rec_settings_status.v1', execution_device: '24f37e45-8c9f-4896-b64f-0dcd0cd8b0e4', data_device: '24f37e45-8c9f-4896-b64f-0dcd0cd8b0e4', evidence: 'exact_target' },
      source: { commit: 'e9ab25690f94d2e36297b1668a74aacf2abef645', path: 'docs/automation_passport.yaml', sha256: '06328c54a50e36b6953d94feb4064f66403beb4462d4265898d04fa851a26f4b' }
    },
    targetologist_team: {
      automation_id: 'targetologist_team', registry_card_id: 'targetologist_team',
      name: { ru: 'Таргетолог AI', en: 'Targetolog AI' }, version: '0.1.0', hosting_profile: 'local',
      state_reader: { expert: 'tgt_call', params: { method: 'status_snapshot', args_json: '[]', kwargs_json: '{}' }, method: 'status_snapshot', schema: 'tgt_status_snapshot.v1', execution_device: '24f37e45-8c9f-4896-b64f-0dcd0cd8b0e4', data_device: '24f37e45-8c9f-4896-b64f-0dcd0cd8b0e4', evidence: 'exact_target' },
      source: { commit: '2d76cb58f52488f57fb235015161bc103dfcc9d2', path: 'docs/automation_passport.yaml', sha256: '78cdc0a97051f11dfe22b29adcc4f2d1edf25ca34cd4e6c91c162182b1c56761' }
    },
    extella_contract_agent: {
      automation_id: 'extella_contract_agent', registry_card_id: 'extella_contract_agent',
      name: { ru: 'Агент по договорам', en: 'Contract Agent' }, version: '0.1.0', hosting_profile: 'local',
      state_reader: { expert: 'law_call', params: { route: '/x/status', body_json: '{}' }, method: '/x/status', schema: 'law_status.v1', execution_device: '24f37e45-8c9f-4896-b64f-0dcd0cd8b0e4', data_device: '24f37e45-8c9f-4896-b64f-0dcd0cd8b0e4', evidence: 'exact_target' },
      source: { commit: 'c0ff3c403a2ef0aec30b97f4850b82f3ccb548e6', path: 'docs/automation_passport.yaml', sha256: '1458ec4c85faef006f06de5f29175af9490a4a5448815544fec3b90326ce5d28' }
    },
    extella_travel_agency: {
      automation_id: 'extella_travel_agency', registry_card_id: 'extella_travel_agency',
      name: { ru: 'Турагентство: лиды и подогрев базы', en: 'Travel agency: leads and base nurture' },
      version: '1.0.0', hosting_profile: 'local',
      state_reader: { expert: 'trv_call', params: { route: '/x/status', body_json: '{}' }, method: '/x/status', schema: 'trv_status.v1', execution_device: '24f37e45-8c9f-4896-b64f-0dcd0cd8b0e4', data_device: '24f37e45-8c9f-4896-b64f-0dcd0cd8b0e4', evidence: 'exact_target' },
      service: { port: 8766, health: '/api/health', state: '/api/state' },
      source: { commit: 'ddcef133e95b0ee2cc94908869dd230f82ff6c38', path: 'extella-travel-agency-pack/docs/automation_passport.yaml', sha256: 'e1202be73af8b086fe5d2513c3902a965cfac91170d4cb696ee54d817cea3854' }
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
