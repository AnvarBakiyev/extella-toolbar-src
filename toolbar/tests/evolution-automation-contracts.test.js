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
  });
  assert.doesNotMatch(source, /runExpert|kvSet|fetch\s*\(/);
});
