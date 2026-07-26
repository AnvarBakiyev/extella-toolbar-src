'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const toolbarRoot = path.resolve(__dirname, '..');
const scannerPath = path.join(
  toolbarRoot,
  'plugins',
  'scenarios',
  'evolution-registry-scanner.py',
);
const scannerSource = fs.readFileSync(scannerPath, 'utf8');

test('read-only device scanner admits only exact top-level cards and counts 102 backups', (t) => {
  const temporaryHome = fs.mkdtempSync(
    path.join(os.tmpdir(), 'evolution-registry-scanner-'),
  );
  t.after(() => fs.rmSync(temporaryHome, { recursive: true, force: true }));
  const registryRoot = path.join(
    temporaryHome,
    'extella-plugins',
    '_registry',
  );
  fs.mkdirSync(registryRoot, { recursive: true });
  fs.writeFileSync(
    path.join(registryRoot, 'extella_1c_agent.json'),
    JSON.stringify({
      id: 'extella_1c_agent',
      version: '0.3.0-dev.6',
      synthAgent: { id: 'agent_expected', token: 'secret-agent-token' },
      experts: [{
        name: 'wz_1c',
        code: 'must not leave the device',
      }],
      optionalExperts: ['one_c'],
      install: {
        secrets: ['must not leave the device'],
      },
    }),
  );
  fs.writeFileSync(
    path.join(registryRoot, 'wrong_id.json'),
    JSON.stringify({ id: 'another_id' }),
  );
  fs.writeFileSync(
    path.join(registryRoot, 'Uppercase_ID.json'),
    JSON.stringify({ id: 'Uppercase_ID' }),
  );
  for (let index = 0; index < 102; index += 1) {
    fs.writeFileSync(
      path.join(
        registryRoot,
        `extella_1c_agent.json.bak_${String(index).padStart(3, '0')}`,
      ),
      '{}',
    );
  }
  fs.mkdirSync(path.join(registryRoot, 'nested'));
  fs.writeFileSync(
    path.join(registryRoot, 'nested', 'extella_travel_agency.json'),
    JSON.stringify({ id: 'extella_travel_agency' }),
  );

  const script = [
    'import importlib.util, json',
    'spec = importlib.util.spec_from_file_location("scanner", r"' +
      scannerPath.replaceAll('\\', '\\\\').replaceAll('"', '\\"') + '")',
    'module = importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(module)',
    'print(module._etb_evolution_registry_scan_v1())',
  ].join('\n');
  const run = spawnSync('python3', ['-c', script], {
    encoding: 'utf8',
    env: { ...process.env, HOME: temporaryHome },
  });
  assert.equal(run.status, 0, run.stderr);
  const result = JSON.parse(run.stdout);
  assert.equal(result.matched_count, 1);
  assert.equal(result.ignored_backup_count, 102);
  assert.equal(result.rejected_count, 2);
  assert.deepEqual(
    result.entries.map((entry) => entry.filename),
    ['extella_1c_agent.json'],
  );
  assert.deepEqual(result.entries[0].manifest, {
    id: 'extella_1c_agent',
    version: '0.3.0-dev.6',
    synthAgent: { id: 'agent_expected' },
    experts: [{ name: 'wz_1c' }],
    optionalExperts: ['one_c'],
  });
  assert.doesNotMatch(JSON.stringify(result), /secret|must not leave/);
});

test('scanner source has no filesystem or registry write operation', () => {
  assert.match(scannerSource, /strict\.fullmatch\(name\)/);
  assert.match(scannerSource, /os\.path\.islink\(path\)/);
  assert.doesNotMatch(
    scannerSource,
    /\bos\.(?:remove|unlink|rmdir|rename|replace)\b|\bshutil\.rmtree\b/,
  );
  assert.doesNotMatch(
    scannerSource,
    /open\([^)]*,\s*["'](?:w|a|x)|\.write\(|json\.dump\(/,
  );
});
