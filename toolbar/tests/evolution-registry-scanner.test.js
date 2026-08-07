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

function runScannerHelper(name, value) {
  const script = [
    'import importlib.util, json',
    'spec = importlib.util.spec_from_file_location("scanner", r"' +
      scannerPath.replaceAll('\\', '\\\\').replaceAll('"', '\\"') + '")',
    'module = importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(module)',
    `value = json.loads(${JSON.stringify(JSON.stringify(value))})`,
    `print(json.dumps(getattr(module, ${JSON.stringify(name)})(value)))`,
  ].join('\n');
  const run = spawnSync('python3', ['-c', script], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout);
}

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
      system: false,
      automation: {
        automation_id: 'extella_1c_agent',
        owner: 'must not leave the device',
      },
      synthAgent: { id: 'agent_expected', token: 'secret-agent-token' },
      experts: [{
        name: 'wz_1c',
        code: 'must not leave the device',
      }],
      optionalExperts: ['one_c'],
      schedules: [{
        id: 'daily_sync',
        location: 'external_cron',
        kv_key: 'sched:future_daily_sync',
        required: true,
      }],
      components: {
        schedules: [{
          id: 'weekly_audit',
          kind: 'external_cron',
          scheduler_ref: 'sched:future_weekly_audit',
          required: true,
        }],
      },
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
  assert.equal(
    result.contract_version,
    'extella.evolution.registry_scan.v2',
  );
  assert.deepEqual(result.capabilities, [
    'device_refs_v1',
    'runtime_probe_v1',
    'strict_cards_v1',
  ]);
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
    system: false,
    automation: { automation_id: 'extella_1c_agent' },
    synthAgent: { id: 'agent_expected' },
    experts: [{ name: 'wz_1c' }],
    optionalExperts: ['one_c'],
    schedules: [{
      id: 'daily_sync',
      location: 'external_cron',
      kv_key: 'sched:future_daily_sync',
      required: true,
    }],
    components: {
      schedules: [{
        id: 'weekly_audit',
        kind: 'external_cron',
        scheduler_ref: 'sched:future_weekly_audit',
        required: true,
      }],
    },
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

test('device ref reader accepts only the pinned Baga file and returns no fallback', (t) => {
  const temporaryHome = fs.mkdtempSync(
    path.join(os.tmpdir(), 'evolution-device-ref-'),
  );
  t.after(() => fs.rmSync(temporaryHome, { recursive: true, force: true }));
  const bagaRoot = path.join(temporaryHome, 'extella_baga');
  fs.mkdirSync(bagaRoot, { recursive: true });
  fs.writeFileSync(
    path.join(bagaRoot, 'panel.json'),
    JSON.stringify({ data_device: 'device-baga-vps', token: 'must-not-leave' }),
  );
  const script = [
    'import importlib.util, json',
    'spec = importlib.util.spec_from_file_location("scanner", r"' +
      scannerPath.replaceAll('\\', '\\\\').replaceAll('"', '\\"') + '")',
    'module = importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(module)',
    'requested = json.dumps(["~/extella_baga/panel.json:data_device", "~/private.json:token"])',
    'print(json.dumps(module._evolution_registry_device_refs(requested)))',
  ].join('\n');
  const available = spawnSync('python3', ['-c', script], {
    encoding: 'utf8',
    env: { ...process.env, HOME: temporaryHome },
  });
  assert.equal(available.status, 0, available.stderr);
  assert.deepEqual(JSON.parse(available.stdout), {
    '~/extella_baga/panel.json:data_device': {
      available: true,
      value: 'device-baga-vps',
      error_code: null,
    },
  });
  assert.doesNotMatch(available.stdout, /must-not-leave|private\.json/);

  fs.rmSync(path.join(bagaRoot, 'panel.json'));
  const missing = spawnSync('python3', ['-c', script], {
    encoding: 'utf8',
    env: { ...process.env, HOME: temporaryHome },
  });
  assert.equal(missing.status, 0, missing.stderr);
  assert.deepEqual(JSON.parse(missing.stdout), {
    '~/extella_baga/panel.json:data_device': {
      available: false,
      value: null,
      error_code: 'DEVICE_REF_FILE_UNAVAILABLE',
    },
  });
});

test('runtime probe reads bounded localhost health and state without leaking extra fields', () => {
  const script = [
    'import importlib.util, json',
    'spec = importlib.util.spec_from_file_location("scanner", r"' +
      scannerPath.replaceAll('\\', '\\\\').replaceAll('"', '\\"') + '")',
    'module = importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(module)',
    'def fake_http(port, path):',
    '  value = {"ok": True, "service": "travel", "secret": "hidden"} if path == "/api/health" else {"enabled": True, "active_version": "1.0.0", "last_run": None, "last_result": None, "last_error": None, "schedules": [{"id": "campaigns_birthday", "active": False, "next_run": None, "location": "external_cron", "note": "hidden"}], "checked_at": "2026-07-27T00:00:00Z", "secret": "hidden"}',
    '  return {"available": True, "responded": True, "status_code": 200, "value": value, "error_code": None}',
    'module._evolution_registry_http_json = fake_http',
    'result = module._evolution_registry_probe_runtime({"id": "extella_travel_agency", "service": {"port": 8766, "healthPath": "/api/health", "statePath": "/api/state"}})',
    'print(json.dumps(result, ensure_ascii=False))',
  ].join('\n');
  const run = spawnSync('python3', ['-c', script], {
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr);
  const result = JSON.parse(run.stdout);
  assert.equal(result.configured, true);
  assert.equal(result.health.available, true);
  assert.equal(result.state.available, true);
  assert.equal(result.state.value.active_version, '1.0.0');
  assert.deepEqual(result.state.value.schedules, [{
    id: 'campaigns_birthday',
    active: false,
    next_run: null,
    location: 'external_cron',
  }]);
  assert.doesNotMatch(JSON.stringify(result), /secret|hidden/);
});

test('responding port with missing state endpoint remains an explicit unavailable state', () => {
  const script = [
    'import importlib.util, json',
    'spec = importlib.util.spec_from_file_location("scanner", r"' +
      scannerPath.replaceAll('\\', '\\\\').replaceAll('"', '\\"') + '")',
    'module = importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(module)',
    'def fake_http(port, path):',
    '  if path == "/api/health": return {"available": True, "responded": True, "status_code": 200, "value": {"ok": True}, "error_code": None}',
    '  return {"available": False, "responded": True, "status_code": 404, "value": None, "error_code": "HTTP_STATUS"}',
    'module._evolution_registry_http_json = fake_http',
    'result = module._evolution_registry_probe_runtime({"id": "extella_travel_agency", "service": {"port": 8766, "healthPath": "/api/health", "statePath": "/api/state"}})',
    'print(json.dumps(result))',
  ].join('\n');
  const run = spawnSync('python3', ['-c', script], {
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr);
  const result = JSON.parse(run.stdout);
  assert.equal(result.health.available, true);
  assert.equal(result.state.responded, true);
  assert.equal(result.state.available, false);
  assert.equal(result.state.status_code, 404);
  assert.equal(result.state.error_code, 'HTTP_STATUS');
});

test('state contract preserves a null active version as an unknown fact', () => {
  const result = runScannerHelper('_evolution_registry_safe_state', {
    enabled: true,
    active_version: null,
    last_run: null,
    last_result: null,
    last_error: null,
    schedules: [],
    checked_at: null,
  });

  assert.equal(result.enabled, true);
  assert.equal(result.active_version, null);
});

test('state contract accepts canonical last_run and rejects an unknown result', () => {
  const canonical = {
    enabled: true,
    active_version: '1.0.0',
    last_run: '2026-07-27T09:15:00.000Z',
    last_result: 'partial',
    last_error: null,
    schedules: [],
    checked_at: '2026-07-27T09:16:00.000Z',
  };
  const result = runScannerHelper(
    '_evolution_registry_safe_state',
    canonical,
  );
  const invalid = runScannerHelper(
    '_evolution_registry_safe_state',
    { ...canonical, last_result: 'healthy' },
  );
  const invalidTimestamp = runScannerHelper(
    '_evolution_registry_safe_state',
    { ...canonical, last_run: 'definitely-not-iso' },
  );

  assert.equal(result.last_run, canonical.last_run);
  assert.equal(result.last_result, 'partial');
  assert.equal(invalid, null);
  assert.equal(invalidTimestamp, null);
});

test('точка входа сканера — первая функция файла', () => {
  // Платформа исполняет ПЕРВУЮ функцию верхнего уровня, а не одноимённую эксперту.
  // Проба 07.08.2026 (эксперт с двумя функциями, вызов с marker=MK-7731) вернула
  // «_helper_first() got an unexpected keyword argument 'marker'». Пока помощники
  // стояли выше, живой сканер падал на первом же помощнике, а Console показывала
  // «состояние не подтверждено» при полностью исправном коде.
  const manifest = JSON.parse(fs.readFileSync(
    path.join(toolbarRoot, 'plugins', 'scenarios', 'profit-growth.json'), 'utf8'));
  const entry = manifest.expert_defs[0].name;
  const firstDef = /^def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/m.exec(scannerSource);
  assert.ok(firstDef, 'в исходнике сканера нет ни одной функции верхнего уровня');
  assert.equal(firstDef[1], entry,
    'первой в файле обязана стоять точка входа — иначе платформа вызовет помощника');
});
