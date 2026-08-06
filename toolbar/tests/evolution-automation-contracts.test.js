'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sourcePath = path.resolve(
  __dirname,
  '..',
  'src',
  'core',
  'evolution-automation-contracts.js',
);
const source = fs.readFileSync(sourcePath, 'utf8');

function load() {
  const context = { ETB: {} };
  vm.runInNewContext(source, context, { filename: sourcePath });
  return context.ETB.evolutionAutomationContracts;
}

test('canonical surface projection separates the four surface classes', () => {
  const contracts = load();
  assert.equal(contracts.schema, 'extella.evolution.automation_contracts.v1');
  assert.equal(contracts.surfaceForCard('baga_thin').class, 'automation');
  assert.equal(
    contracts.surfaceForCard('baga_thin').automation_id,
    'extella_kz_grocery',
  );
  assert.equal(contracts.surfaceForCard('extella_connectors').class, 'system');
  assert.equal(
    contracts.surfaceForCard('gh_excalidraw_excalidraw').class,
    'installed_app',
  );
  assert.equal(contracts.surfaceForCard('thindemo').class, 'probe');
  assert.equal(contracts.surfaceForCard('unknown_card'), null);
});

test('six ready Automation Passports are release-pinned without inventing 1C', () => {
  const contracts = load();
  const passports = contracts.passports();
  const expectedPins = {
    extella_kz_grocery: [
      '195fb2d9fc574c7e95d718bcfc9cac1aaf385557',
      '9acd7107a413a50a34f48a8803e6cdbecaf6c5d180f2afffeb0d3284522931dc',
    ],
    extella_predictive_sales: [
      '1680f2a66b7821a9941fefc5725d78e71c4c5611',
      'a13f093f9688e3e7c894e3e6a9ccc54c48261145b219a80facc8c46a1f6e5696',
    ],
    extella_recruiter: [
      '8a6ddc01bc8b3052cdd32666c851e11d6e277280',
      'aad1a3a3ce4c73d937b7791f345dc9b4a6f7cfcded2b21569dad9c7921e944d3',
    ],
    targetologist_team: [
      '0cdea4b25f16304ba85dc6ae167d50f60140ae3a',
      '7869cc690b613cb7adc56d5708fa6265d2a2c6a9b1a8fa2faca1c3220130334f',
    ],
    extella_contract_agent: [
      '4532877e3d8ee0072c4f8bdee0ec5ea7a6dc4dc1',
      '28902d8978da81d7bbaf7a3a6992521b6fca01b29d9866a5f10220d9086b3e1f',
    ],
    extella_travel_agency: [
      '1a54c62379f63c18835273a12be3c66d286d93d4',
      '41678dde20a3ba9f8c9a49f5aa6c88e1e3329154d3d8ac61e590a9ebae3e8868',
    ],
  };
  assert.equal(passports.length, 6);
  assert.deepEqual(
    JSON.parse(JSON.stringify(
      passports.map((passport) => passport.automation_id).sort(),
    )),
    [
      'extella_contract_agent',
      'extella_kz_grocery',
      'extella_predictive_sales',
      'extella_recruiter',
      'extella_travel_agency',
      'targetologist_team',
    ],
  );
  assert.equal(contracts.passportForAutomation('extella_1c_agent'), null);
  passports.forEach((passport) => {
    assert.match(passport.source.commit, /^[a-f0-9]{40}$/);
    assert.match(passport.source.sha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(
      [passport.source.commit, passport.source.sha256],
      expectedPins[passport.automation_id],
    );
    assert.equal(typeof passport.name.ru, 'string');
    assert.equal(typeof passport.name.en, 'string');
  });
});

test('state reader contracts expose exact scalar params for all six products', () => {
  const contracts = load();
  const lawyer = contracts.passportForAutomation('extella_contract_agent');
  const predictive = contracts.passportForAutomation('extella_predictive_sales');
  const travel = contracts.passportForAutomation('extella_travel_agency');

  assert.equal(lawyer.state_reader.expert, 'law_call');
  assert.equal(lawyer.state_reader.method, '/x/status');
  assert.equal(predictive.state_reader.method, 'read_state');
  assert.equal(lawyer.state_reader.evidence, 'exact_target');
  assert.equal(lawyer.state_reader.execution_device, 'DEVICE_FROM_HOST');
  assert.equal(lawyer.state_reader.data_device, 'DEVICE_FROM_HOST');
  assert.deepEqual(
    JSON.parse(JSON.stringify(lawyer.state_reader.params)),
    { route: '/x/status', body_json: '{}' },
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(predictive.state_reader.params)),
    { method: 'read_state', args_json: '[]', kwargs_json: '{}' },
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(travel.state_reader.params)),
    { route: '/x/status', body_json: '{}' },
  );
  contracts.passports().forEach((passport) => {
    assert.ok(passport.state_reader);
    assert.ok(Object.keys(passport.state_reader.params).length > 0);
    Object.values(passport.state_reader.params).forEach((value) => {
      assert.ok(['string', 'number', 'boolean'].includes(typeof value));
    });
    assert.match(
      passport.state_reader.execution_device,
      /^DEVICE_FROM_(?:HOST|REF)$/,
    );
    assert.match(
      passport.state_reader.data_device,
      /^DEVICE_FROM_(?:HOST|REF)$/,
    );
  });
  const baga = contracts.passportForAutomation('extella_kz_grocery');
  assert.equal(baga.state_reader.execution_device, 'DEVICE_FROM_REF');
  assert.equal(baga.state_reader.data_device, 'DEVICE_FROM_REF');
  assert.equal(
    baga.state_reader.device_ref,
    '~/extella_baga/panel.json:data_device',
  );
  assert.doesNotMatch(source, /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i);
  assert.doesNotMatch(source, /runExpert|kvSet|fetch\s*\(/);
});
