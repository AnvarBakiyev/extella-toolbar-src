'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const consoleHtml = fs.readFileSync(path.join(
  __dirname,
  '..',
  'plugins',
  'scenarios',
  'evolution-console.html',
), 'utf8');

function functionDeclaration(name) {
  const marker = `function ${name}(`;
  const start = consoleHtml.indexOf(marker);
  assert.notEqual(start, -1, `missing helper ${name}`);
  const bodyStart = consoleHtml.indexOf('{', start + marker.length);
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = bodyStart; index < consoleHtml.length; index += 1) {
    const char = consoleHtml[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '\'' || char === '"' || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return consoleHtml.slice(start, index + 1);
    }
  }
  assert.fail(`unterminated helper ${name}`);
}

function buildSnapshot(registry) {
  const context = {};
  vm.runInNewContext(
    `${functionDeclaration('buildMaintenanceSnapshot')}\nthis.build = buildMaintenanceSnapshot;`,
    context,
  );
  return JSON.parse(JSON.stringify(context.build(registry)));
}

test('support snapshot has the exact closed schema and only installed automations', () => {
  const snapshot = buildSnapshot({
    source_errors: [
      { source: 'runtime_state', code: 'AUTOMATION_STATE_UNAVAILABLE', message: 'secret detail' },
      { source: 'runtime_state', code: 'AUTOMATION_STATE_UNAVAILABLE' },
      { source: 'device', code: 'DEVICE_SCANNER_CONTRACT_STALE', device_id: 'forbidden-device' },
    ],
    rows: [
      {
        automation_id: 'extella_travel_agency',
        flags: { installed: true, installed_stale: false, dead_reference: 'UNKNOWN' },
        state: { operational_status: 'STATE_UNAVAILABLE', last_error: { message: 'do not export' } },
        risks: [
          { code: 'STATUS_UNKNOWN', message_ru: 'do not export' },
          { code: 'STATUS_UNKNOWN' },
          { code: 'EXPERT_MISSING', path: '/private/path' },
        ],
        discrepancies: ['LOCAL_REFERENCE_MISMATCH', { code: 'CATALOG_RECORD_CONFLICT' }],
        platform_agent_id: 'agent_forbidden',
        token: 'secret-token',
      },
      {
        automation_id: 'catalog_only_secret',
        flags: { installed: false, installed_stale: true, dead_reference: true },
        state: { operational_status: 'WORKING' },
        risks: [{ code: 'MUST_NOT_APPEAR' }],
      },
    ],
  });

  assert.deepEqual(snapshot, {
    schema: 'extella.evolution.support_snapshot.v1',
    source_errors: [
      { source: 'device', code: 'DEVICE_SCANNER_CONTRACT_STALE' },
      { source: 'runtime_state', code: 'AUTOMATION_STATE_UNAVAILABLE' },
    ],
    automations: [{
      automation_id: 'extella_travel_agency',
      operational_status: 'STATE_UNAVAILABLE',
      installed_stale: false,
      dead_reference: 'UNKNOWN',
      risks: ['EXPERT_MISSING', 'STATUS_UNKNOWN'],
      discrepancies: ['CATALOG_RECORD_CONFLICT', 'LOCAL_REFERENCE_MISMATCH'],
    }],
  });
});

test('support snapshot drops arbitrary values instead of copying them as diagnostics', () => {
  const snapshot = buildSnapshot({
    source_errors: [
      { source: 'device', code: 'not a code: token=abc' },
      { source: '../../secret', code: 'SOURCE_UNAVAILABLE' },
    ],
    rows: [{
      automation_id: 'valid_automation',
      flags: { installed: true },
      state: { operational_status: 'made-up-status', output: 'secret output' },
      risks: [{ code: 'bad-code-with-hyphens', token: 'secret-token' }, { code: 'STATUS_UNKNOWN' }],
      discrepancies: [{ message: 'raw diagnostic text' }],
    }],
  });
  const serialized = JSON.stringify(snapshot);

  assert.deepEqual(snapshot.source_errors, []);
  assert.equal(snapshot.automations[0].operational_status, 'UNKNOWN');
  assert.deepEqual(snapshot.automations[0].risks, ['STATUS_UNKNOWN']);
  assert.deepEqual(snapshot.automations[0].discrepancies, []);
  for (const forbidden of ['token', 'device_id', 'message', 'output', 'path', 'version']) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test('copy action exists only inside Extella maintenance and is enabled only for loaded facts', () => {
  assert.match(consoleHtml, /id="maintenanceSummary"[\s\S]{0,700}id="maintenanceCopyBtn"/);
  assert.match(consoleHtml, /copyMaintenanceSnapshot:'Копировать снимок для специалиста'/);
  assert.match(consoleHtml, /copyMaintenanceSnapshot:'Copy snapshot for support'/);
  assert.match(
    functionDeclaration('renderAttention'),
    /snapshotReady=!!p&&maintenanceRows\.length>0[\s\S]*maintenanceActions\.hidden=!snapshotReady[\s\S]*copyButton\.disabled=!snapshotReady/,
  );
  assert.match(consoleHtml, /el\('maintenanceCopyBtn'\)\.onclick=copyMaintenanceSnapshot/);
});

test('clipboard path copies only the closed snapshot and has an iframe-safe fallback', () => {
  const copy = functionDeclaration('copyMaintenanceSnapshot');
  const plainText = functionDeclaration('copyPlainText');
  assert.match(copy, /buildMaintenanceSnapshot\(state\.automationRegistry\)/);
  assert.match(copy, /JSON\.stringify\(snapshot,null,2\)/);
  assert.doesNotMatch(copy, /JSON\.stringify\(state\.automationRegistry/);
  assert.match(plainText, /navigator\.clipboard\.writeText/);
  assert.match(plainText, /document\.execCommand\('copy'\)/);
});
