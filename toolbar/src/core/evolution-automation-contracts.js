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
      state_reader: { expert: 'kzg_state', params: { args_json: '[]' }, method: '', schema: 'kzg_state.v1', execution_device: 'DEVICE_FROM_REF', data_device: 'DEVICE_FROM_REF', device_ref: '~/extella_baga/panel.json:data_device', evidence: 'exact_target' },
      source: { commit: '195fb2d9fc574c7e95d718bcfc9cac1aaf385557', path: 'docs/automation_passport.yaml', sha256: '9acd7107a413a50a34f48a8803e6cdbecaf6c5d180f2afffeb0d3284522931dc' }
    },
    extella_predictive_sales: {
      automation_id: 'extella_predictive_sales', registry_card_id: 'extella_predictive_sales',
      name: { ru: 'Predictive Sales', en: 'Predictive Sales' }, version: '0.9.0', hosting_profile: 'local',
      state_reader: { expert: 'ps_call', params: { method: 'read_state', args_json: '[]', kwargs_json: '{}' }, method: 'read_state', schema: 'ps_read_state.v1', execution_device: 'DEVICE_FROM_HOST', data_device: 'DEVICE_FROM_HOST', evidence: 'exact_target' },
      source: { commit: '1680f2a66b7821a9941fefc5725d78e71c4c5611', path: 'docs/automation_passport.yaml', sha256: 'a13f093f9688e3e7c894e3e6a9ccc54c48261145b219a80facc8c46a1f6e5696' }
    },
    extella_recruiter: {
      automation_id: 'extella_recruiter', registry_card_id: 'extella_recruiter',
      name: { ru: 'Агент-рекрутёр', en: 'Recruiting Agent' }, version: '0.1.0', hosting_profile: 'local',
      state_reader: { expert: 'rec_call', params: { method: 'settings_status', args_json: '[]' }, method: 'settings_status', schema: 'rec_settings_status.v1', execution_device: 'DEVICE_FROM_HOST', data_device: 'DEVICE_FROM_HOST', evidence: 'exact_target' },
      source: { commit: '8a6ddc01bc8b3052cdd32666c851e11d6e277280', path: 'docs/automation_passport.yaml', sha256: 'aad1a3a3ce4c73d937b7791f345dc9b4a6f7cfcded2b21569dad9c7921e944d3' }
    },
    targetologist_team: {
      automation_id: 'targetologist_team', registry_card_id: 'targetologist_team',
      name: { ru: 'Таргетолог AI', en: 'Targetolog AI' }, version: '0.1.0', hosting_profile: 'local',
      state_reader: { expert: 'tgt_call', params: { method: 'status_snapshot', args_json: '[]', kwargs_json: '{}' }, method: 'status_snapshot', schema: 'tgt_status_snapshot.v1', execution_device: 'DEVICE_FROM_HOST', data_device: 'DEVICE_FROM_HOST', evidence: 'exact_target' },
      source: { commit: '0cdea4b25f16304ba85dc6ae167d50f60140ae3a', path: 'docs/automation_passport.yaml', sha256: '7869cc690b613cb7adc56d5708fa6265d2a2c6a9b1a8fa2faca1c3220130334f' }
    },
    extella_contract_agent: {
      automation_id: 'extella_contract_agent', registry_card_id: 'extella_contract_agent',
      name: { ru: 'Агент по договорам', en: 'Contract Agent' }, version: '0.1.0', hosting_profile: 'local',
      state_reader: { expert: 'law_call', params: { route: '/x/status', body_json: '{}' }, method: '/x/status', schema: 'law_status.v1', execution_device: 'DEVICE_FROM_HOST', data_device: 'DEVICE_FROM_HOST', evidence: 'exact_target' },
      source: { commit: '4532877e3d8ee0072c4f8bdee0ec5ea7a6dc4dc1', path: 'docs/automation_passport.yaml', sha256: '28902d8978da81d7bbaf7a3a6992521b6fca01b29d9866a5f10220d9086b3e1f' }
    },
    extella_travel_agency: {
      automation_id: 'extella_travel_agency', registry_card_id: 'extella_travel_agency',
      name: { ru: 'Турагентство: лиды и подогрев базы', en: 'Travel agency: leads and base nurture' },
      version: '1.0.0', hosting_profile: 'local',
      state_reader: { expert: 'trv_call', params: { route: '/x/status', body_json: '{}' }, method: '/x/status', schema: 'trv_status.v1', execution_device: 'DEVICE_FROM_HOST', data_device: 'DEVICE_FROM_HOST', evidence: 'exact_target' },
      service: { port: 8766, health: '/api/health', state: '/api/state' },
      source: { commit: '1a54c62379f63c18835273a12be3c66d286d93d4', path: 'extella-travel-agency-pack/docs/automation_passport.yaml', sha256: '41678dde20a3ba9f8c9a49f5aa6c88e1e3329154d3d8ac61e590a9ebae3e8868' }
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
