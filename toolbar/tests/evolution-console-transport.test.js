'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const toolbarRoot = path.resolve(__dirname, '..');
const registry = fs.readFileSync(
  path.join(toolbarRoot, 'src', 'core', 'registry.js'),
  'utf8',
);
const api = fs.readFileSync(
  path.join(toolbarRoot, 'src', 'core', 'api.js'),
  'utf8',
);

function scannerPayloadParser() {
  const start = registry.indexOf('  function _evolutionScannerPayload(response)');
  const end = registry.indexOf('  function _isLegacyCapabilityStudioOwner(', start);
  assert.ok(start >= 0 && end > start, 'scanner envelope parser must exist');
  const context = { JSON, Error };
  vm.runInNewContext(
    `${registry.slice(start, end)}\nthis.parse = _evolutionScannerPayload;`,
    context,
  );
  return context.parse;
}

function scannerContract() {
  return {
    entries: [{ filename: 'extella_travel_agency.json', manifest: {
      id: 'extella_travel_agency',
    } }],
    matched_count: 1,
    ignored_backup_count: 102,
    rejected_count: 0,
  };
}

test('scanner unwraps direct, task, and tokenless bridge response envelopes', () => {
  const parse = scannerPayloadParser();
  const contract = scannerContract();

  assert.deepEqual(parse(contract), contract);
  assert.deepEqual(
    JSON.parse(JSON.stringify(parse({
      status: 'completed',
      result: JSON.stringify(contract),
    }))),
    contract,
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(parse({
      res: {
        status: 'completed',
        result: JSON.stringify(contract),
      },
    }))),
    contract,
  );
});

test('scanner rejects malformed JSON instead of converting it to an empty fleet', () => {
  const parse = scannerPayloadParser();
  assert.throws(
    () => parse({ status: 'completed', result: '{not-json' }),
    /device registry scanner returned invalid JSON/,
  );
});

test('expert client timeout is transport-only and never enters the API body', () => {
  const start = api.indexOf('  function runExpert(name, params, opts)');
  const end = api.indexOf('  function runExpertAsync(', start);
  assert.ok(start >= 0 && end > start);
  const source = api.slice(start, end);

  assert.match(source, /var clientTimeoutMs = Number\(opts\.clientTimeoutMs \|\| 0\)/);
  assert.match(source, /delete bodyOptions\.clientTimeoutMs/);
  assert.match(
    source,
    /clientTimeoutMs > 0 \? \{ timeoutMs: clientTimeoutMs \} : undefined/,
  );
});
