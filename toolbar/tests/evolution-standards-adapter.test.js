'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const { TextEncoder } = require('node:util');

const toolbarRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(toolbarRoot, '..');
const scenarioRoot = path.join(
  toolbarRoot,
  'plugins',
  'scenarios',
  'evolution-standards',
);
const adapterPath = path.join(
  toolbarRoot,
  'tools',
  'build_evolution_standards_bundle.py',
);
const provisionPath = path.join(
  toolbarRoot,
  'tools',
  'provision_evolution_standards.py',
);
const registryPath = path.join(scenarioRoot, 'fixture-registry.fixture');
const pinPath = path.join(scenarioRoot, 'standards-pin.fixture');
const bundlePath = path.join(scenarioRoot, 'evolution-standards-bundle.json');
const corePath = path.join(
  toolbarRoot,
  'src',
  'core',
  'evolution-console.js',
);
const standardsDir = path.resolve(
  process.env.EXTELLA_STANDARDS_DIR ||
    path.join(repoRoot, '..', 'extella-evolution-standards-v2'),
);
const standardsPin = JSON.parse(fs.readFileSync(pinPath, 'utf8'));

function standardsRequired(env) {
  const ci = String(env.CI || '').toLowerCase();
  return env.EXTELLA_REQUIRE_STANDARDS === '1' ||
    ci === 'true' ||
    ci === '1';
}

function inspectStandardsCheckout(directory, pin) {
  if (!fs.existsSync(directory)) {
    return {
      ready: false,
      reason: `standards checkout is absent at ${directory}`,
    };
  }
  const artifacts = Object.values(pin.artifacts || {});
  for (const artifact of artifacts) {
    const artifactPath = path.join(directory, String(artifact.path || ''));
    if (!artifact.path || !fs.existsSync(artifactPath)) {
      return {
        ready: false,
        reason: `pinned standards artifact is absent: ${artifact.path || '<missing path>'}`,
      };
    }
    if (sha256File(artifactPath) !== artifact.sha256) {
      return {
        ready: false,
        reason: `pinned standards artifact hash differs: ${artifact.path}`,
      };
    }
  }
  const head = spawnSync(
    'git',
    ['-C', directory, 'rev-parse', 'HEAD'],
    { encoding: 'utf8' },
  );
  if (head.status !== 0) {
    return {
      ready: false,
      reason: 'standards directory is not a readable git checkout',
    };
  }
  if (head.stdout.trim() !== pin.standards_git_commit) {
    return {
      ready: false,
      reason:
        `standards checkout commit ${head.stdout.trim()} does not match pin ` +
        pin.standards_git_commit,
    };
  }
  return { ready: true, reason: '' };
}

function standardsGateDecision(status, env, explicitDirectory) {
  if (status.ready) return { mode: 'RUN', reason: '' };
  const reason =
    `PINNED_STANDARDS_UNAVAILABLE: ${status.reason}. ` +
    `Expected commit ${standardsPin.standards_git_commit}.`;
  if (explicitDirectory || standardsRequired(env)) {
    return { mode: 'FAIL', reason };
  }
  return {
    mode: 'SKIP',
    reason:
      `${reason} Local integration tests are explicitly skipped; ` +
      'set EXTELLA_REQUIRE_STANDARDS=1 to make this a release gate.',
  };
}

function enforceStandardsGate(decision) {
  if (decision.mode === 'FAIL') throw new Error(decision.reason);
  return decision;
}

const standardsCheckoutStatus = inspectStandardsCheckout(
  standardsDir,
  standardsPin,
);
const standardsGate = enforceStandardsGate(
  standardsGateDecision(
    standardsCheckoutStatus,
    process.env,
    Boolean(process.env.EXTELLA_STANDARDS_DIR),
  ),
);
function standardsIntegrationTest(name, fn) {
  if (standardsGate.mode === 'RUN') return test(name, fn);
  return test(name, { skip: standardsGate.reason }, fn);
}
const python = process.env.PYTHON || 'python3';

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function canonical(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(',')}]`;
  }
  if (typeof value === 'object') {
    return `{${Object.keys(value).sort().map(
      (key) => `${JSON.stringify(key)}:${canonical(value[key])}`,
    ).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256Canonical(value) {
  return crypto.createHash('sha256').update(canonical(value)).digest('hex');
}

function runPython(args) {
  return spawnSync(python, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      PYTHONDONTWRITEBYTECODE: '1',
    },
  });
}

function runAdapter(output, pin = pinPath) {
  return runPython([
    adapterPath,
    '--standards-dir',
    standardsDir,
    '--registry',
    registryPath,
    '--pin',
    pin,
    '--output',
    output,
  ]);
}

function runProduction(
  output,
  registry,
  pin = pinPath,
  productionStandardsDir = standardsDir,
  kvPackageOutput = null,
) {
  const args = [
    adapterPath,
    '--standards-dir',
    productionStandardsDir,
    '--mode',
    'PRODUCTION',
    '--registry',
    registry,
    '--pin',
    pin,
    '--output',
    output,
  ];
  if (kvPackageOutput) {
    args.push('--kv-package-output', kvPackageOutput);
  }
  return runPython(args);
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function loadBundle() {
  return JSON.parse(fs.readFileSync(bundlePath, 'utf8'));
}

function loadCore() {
  const context = {
    ETB: {},
    console,
    crypto: crypto.webcrypto,
    TextEncoder,
  };
  vm.runInNewContext(
    fs.readFileSync(corePath, 'utf8'),
    context,
    { filename: corePath },
  );
  return context.ETB.evolutionConsole;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function canonicalDirectOutput() {
  const source = String.raw`
import importlib.util
import json
from pathlib import Path
import sys

sys.dont_write_bytecode = True
standards = Path(sys.argv[1]).resolve()
scenario = Path(sys.argv[2]).resolve()
registry = json.loads((scenario / "fixture-registry.fixture").read_text(encoding="utf-8"))

checker_path = standards / "tools" / "check_agent_passport.py"
checker_spec = importlib.util.spec_from_file_location("check_agent_passport", checker_path)
checker = importlib.util.module_from_spec(checker_spec)
sys.modules["check_agent_passport"] = checker
checker_spec.loader.exec_module(checker)

builder_path = standards / "tools" / "build_agent_cabinet.py"
builder_spec = importlib.util.spec_from_file_location("build_agent_cabinet", builder_path)
builder = importlib.util.module_from_spec(builder_spec)
sys.modules["build_agent_cabinet"] = builder
builder_spec.loader.exec_module(builder)

agents = {}
for relative in registry["passport_files"]:
    passport = json.loads((scenario / relative).read_text(encoding="utf-8"))
    platform_agent_id = passport.get("agent", {}).get("platform_agent_id", "")
    report = checker.check_report(passport)
    legacy = checker.check(passport)
    agents[platform_agent_id] = {
        "checker_report": report,
        "legacy_check": [legacy[0], legacy[1]],
        "cabinet": builder.build(passport) if report["ready"] else None,
    }

template = checker.load_passport(str(standards / "templates" / "agent_passport.yaml"))
print(json.dumps({"agents": agents, "template": template}, ensure_ascii=False, sort_keys=True))
`;
  const result = runPython(['-c', source, standardsDir, scenarioRoot]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function canonicalOutputForPassports(passportPaths) {
  const source = String.raw`
import importlib.util
import json
from pathlib import Path
import sys

sys.dont_write_bytecode = True
standards = Path(sys.argv[1]).resolve()

checker_path = standards / "tools" / "check_agent_passport.py"
checker_spec = importlib.util.spec_from_file_location("check_agent_passport", checker_path)
checker = importlib.util.module_from_spec(checker_spec)
sys.modules["check_agent_passport"] = checker
checker_spec.loader.exec_module(checker)

builder_path = standards / "tools" / "build_agent_cabinet.py"
builder_spec = importlib.util.spec_from_file_location("build_agent_cabinet", builder_path)
builder = importlib.util.module_from_spec(builder_spec)
sys.modules["build_agent_cabinet"] = builder
builder_spec.loader.exec_module(builder)

agents = {}
for raw in sys.argv[2:]:
    passport = json.loads(Path(raw).read_text(encoding="utf-8"))
    platform_agent_id = passport.get("agent", {}).get("platform_agent_id", "")
    report = checker.check_report(passport)
    agents[platform_agent_id] = {
        "checker_report": report,
        "cabinet": builder.build(passport) if report["ready"] else None,
    }

print(json.dumps({"agents": agents}, ensure_ascii=False, sort_keys=True))
`;
  const result = runPython([
    '-c',
    source,
    standardsDir,
    ...passportPaths,
  ]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function productionPassport(sourceName, platformAgentId, overrides = {}) {
  const passport = JSON.parse(fs.readFileSync(
    path.join(scenarioRoot, 'fixtures', 'passports', sourceName),
    'utf8',
  ));
  Object.assign(passport.agent, {
    name: `Production ${platformAgentId}`,
    platform_agent_id: platformAgentId,
    declared_instructions: 'Managed production instructions.',
    owner: 'Production Owner',
    business_goal: 'Exercise the strict production standards adapter',
    immutable_bundle_id: `bundle-${platformAgentId}-v1`,
    interfaces: ['Evolution Console'],
    hosting_profile: 'EXTELLA_MANAGED_PRODUCTION',
    data_classification: 'production operations metadata',
  }, overrides);
  for (const sharedGene of passport.shared_genes || []) {
    sharedGene.consumer_agent_id = platformAgentId;
    sharedGene.gene_id = String(sharedGene.gene_id || '')
      .replace('rule.demo.', 'rule.production.');
    sharedGene.name = 'Stable production approval guard';
  }
  for (const capability of passport.capabilities || []) {
    capability.help_surface = 'Evolution Console';
    capability.limits = ['Managed production read-only capability'];
  }
  passport.operations.success_metric =
    'strict production bundle is generated deterministically';
  passport.operations.evidence_retention = 'managed production retention';
  passport.operations.owner_on_call = 'Production Owner';
  return passport;
}

function makeProductionSource(t) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'extella-evolution-production-'),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const validPath = path.join(root, 'passports', 'valid.json');
  const invalidPath = path.join(root, 'passports', 'non-qwen.json');
  const platformPath = path.join(root, 'platform-agents.json');
  const registryPathForProduction = path.join(root, 'registry.json');
  writeJson(
    validPath,
    productionPassport(
      'valid-alpha.fixture',
      'agent_production_valid_alpha',
    ),
  );
  writeJson(
    invalidPath,
    productionPassport(
      'invalid-non-qwen.fixture',
      'agent_production_non_qwen',
    ),
  );
  writeJson(platformPath, {
    schema: 'extella.evolution.production_platform_agents.v1',
    data_mode: 'PRODUCTION',
    inventory_complete: true,
    agents: [
      {
        platform_agent_id: 'agent_production_valid_alpha',
        name: 'Production valid alpha',
        provider: 'alibaba',
        model: 'qwen-3.7',
        last_activity_at: '2026-07-26T10:00:00Z',
        instructions: 'PLATFORM_SECRET_INSTRUCTIONS_MUST_NOT_LEAK',
        tools: ['private-production-tool'],
        credentials: { token: 'platform-secret-token' },
        arbitrary_internal_field: 'platform-internal-value',
      },
      {
        platform_agent_id: 'agent_production_non_qwen',
        name: 'Production invalid non-Qwen',
        provider: 'openai',
        model: 'gpt-4o',
        instructions: 'Managed production instructions.',
        last_activity_at: '2026-07-26T11:00:00Z',
      },
    ],
  });
  const registry = {
    schema: 'extella.evolution.production_registry.v1',
    data_mode: 'PRODUCTION',
    owner_account_id: 'account_production_owner',
    delivery_mode: 'ACCOUNT_SCOPED_HOST_PROVIDER',
    production_eligible: true,
    live_projection_allowed: true,
    runtime_policy: {
      live_projection: 'ALLOWED',
      production_merge: 'ALLOWED',
    },
    passport_files_complete: true,
    passport_count: 2,
    platform_agents_file: 'platform-agents.json',
    passport_files: [
      'passports/valid.json',
      'passports/non-qwen.json',
    ],
  };
  writeJson(registryPathForProduction, registry);
  return {
    root,
    validPath,
    invalidPath,
    platformPath,
    registryPath: registryPathForProduction,
    registry,
  };
}

test('pinned standards checkout is a hard release gate and an explicit local skip', () => {
  const unavailable = {
    ready: false,
    reason: 'standards checkout is absent at /missing/standards',
  };
  const local = standardsGateDecision(unavailable, {}, false);
  assert.equal(local.mode, 'SKIP');
  assert.match(local.reason, /PINNED_STANDARDS_UNAVAILABLE/);
  assert.match(local.reason, /Local integration tests are explicitly skipped/);
  assert.doesNotThrow(() => enforceStandardsGate(local));

  for (const env of [
    { EXTELLA_REQUIRE_STANDARDS: '1' },
    { CI: 'true' },
    { CI: 'TRUE' },
    { CI: '1' },
  ]) {
    const release = standardsGateDecision(unavailable, env, false);
    assert.equal(release.mode, 'FAIL');
    assert.throws(
      () => enforceStandardsGate(release),
      /PINNED_STANDARDS_UNAVAILABLE/,
    );
  }

  const explicit = standardsGateDecision(unavailable, {}, true);
  assert.equal(explicit.mode, 'FAIL');
  assert.throws(
    () => enforceStandardsGate(explicit),
    /PINNED_STANDARDS_UNAVAILABLE/,
  );
  assert.equal(
    standardsGateDecision(unavailable, { CI: 'false' }, false).mode,
    'SKIP',
  );
  assert.equal(
    standardsGateDecision({ ready: true, reason: '' }, { CI: 'true' }, false)
      .mode,
    'RUN',
  );
});

standardsIntegrationTest('adapter deterministically reproduces the committed DEMO_FIXTURE bundle', (t) => {
  assert.ok(
    fs.statSync(
      path.join(standardsDir, 'tools', 'check_agent_passport.py'),
    ).isFile(),
  );
  const temporary = fs.mkdtempSync(
    path.join(os.tmpdir(), 'extella-evolution-standards-'),
  );
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const first = path.join(temporary, 'first.json');
  const second = path.join(temporary, 'second.json');
  const firstRun = runAdapter(first);
  const secondRun = runAdapter(second);
  assert.equal(firstRun.status, 0, firstRun.stderr || firstRun.stdout);
  assert.equal(secondRun.status, 0, secondRun.stderr || secondRun.stdout);
  assert.deepEqual(fs.readFileSync(first), fs.readFileSync(second));
  assert.deepEqual(fs.readFileSync(first), fs.readFileSync(bundlePath));

  const bundle = loadBundle();
  assert.equal(bundle.schema, 'extella.evolution.standards_bundle.v1');
  assert.equal(bundle.data_mode, 'DEMO_FIXTURE');
  assert.equal(bundle.production_eligible, false);
  assert.equal(bundle.live_projection_allowed, false);
  assert.equal(bundle.runtime_policy.live_projection, 'FORBIDDEN');
  assert.equal(bundle.runtime_policy.production_merge, 'FORBIDDEN');
  assert.equal(
    Object.prototype.hasOwnProperty.call(bundle, 'owner_account_id'),
    false,
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(bundle, 'delivery_mode'),
    false,
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(bundle, 'attestation'),
    false,
  );
});

standardsIntegrationTest('PRODUCTION mode cannot promote demo sources and requires account binding', (t) => {
  const temporary = fs.mkdtempSync(
    path.join(os.tmpdir(), 'extella-evolution-production-guard-'),
  );
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));

  const directDemoOutput = path.join(temporary, 'direct-demo.json');
  const directDemo = runProduction(directDemoOutput, registryPath);
  assert.equal(directDemo.status, 2);
  assert.match(directDemo.stderr, /production registry schema must be/);
  assert.equal(fs.existsSync(directDemoOutput), false);

  const promotedRegistry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  Object.assign(promotedRegistry, {
    schema: 'extella.evolution.production_registry.v1',
    data_mode: 'PRODUCTION',
    owner_account_id: 'account_production_owner',
    delivery_mode: 'ACCOUNT_SCOPED_HOST_PROVIDER',
    production_eligible: true,
    live_projection_allowed: true,
    runtime_policy: {
      live_projection: 'ALLOWED',
      production_merge: 'ALLOWED',
    },
    passport_files_complete: true,
    passport_count: promotedRegistry.passport_files.length,
  });
  const promotedRegistryPath = path.join(temporary, 'promoted-registry.json');
  const promotedOutput = path.join(temporary, 'promoted.json');
  writeJson(promotedRegistryPath, promotedRegistry);
  const promoted = runProduction(promotedOutput, promotedRegistryPath);
  assert.equal(promoted.status, 2);
  assert.match(
    promoted.stderr,
    /platform_agents_file must not contain fixture or demo path markers/,
  );
  assert.equal(fs.existsSync(promotedOutput), false);

  const source = makeProductionSource(t);
  const unboundRegistry = { ...source.registry };
  delete unboundRegistry.owner_account_id;
  const unboundRegistryPath = path.join(source.root, 'unbound-registry.json');
  const unboundOutput = path.join(source.root, 'unbound.json');
  writeJson(unboundRegistryPath, unboundRegistry);
  const unbound = runProduction(unboundOutput, unboundRegistryPath);
  assert.equal(unbound.status, 2);
  assert.match(unbound.stderr, /owner_account_id must be a non-empty string/);
  assert.equal(fs.existsSync(unboundOutput), false);

  const genericRegistry = {
    ...source.registry,
    delivery_mode: 'STATIC_RELEASE_BUNDLE',
  };
  const genericRegistryPath = path.join(source.root, 'generic-registry.json');
  const genericOutput = path.join(source.root, 'generic.json');
  writeJson(genericRegistryPath, genericRegistry);
  const generic = runProduction(genericOutput, genericRegistryPath);
  assert.equal(generic.status, 2);
  assert.match(
    generic.stderr,
    /delivery_mode must be ACCOUNT_SCOPED_HOST_PROVIDER.*embedding is forbidden/,
  );
  assert.equal(fs.existsSync(genericOutput), false);

  const markedRegistryPath = path.join(source.root, 'demo-registry.json');
  const markedOutput = path.join(source.root, 'marked.json');
  writeJson(markedRegistryPath, source.registry);
  const marked = runProduction(markedOutput, markedRegistryPath);
  assert.equal(marked.status, 2);
  assert.match(
    marked.stderr,
    /production registry path must not contain fixture or demo path markers/,
  );
  assert.equal(fs.existsSync(markedOutput), false);

  const staticOutput = path.join(
    scenarioRoot,
    'production-static-embedding.must-not-exist.json',
  );
  assert.equal(fs.existsSync(staticOutput), false);
  const staticEmbedding = runProduction(staticOutput, source.registryPath);
  assert.equal(staticEmbedding.status, 2);
  assert.match(
    staticEmbedding.stderr,
    /forbids static toolbar\/release embedding/,
  );
  assert.equal(fs.existsSync(staticOutput), false);

  const dirtyStandards = path.join(source.root, 'standards-checkout');
  const clone = spawnSync(
    'git',
    ['clone', '--quiet', '--no-hardlinks', standardsDir, dirtyStandards],
    { encoding: 'utf8' },
  );
  assert.equal(clone.status, 0, clone.stderr || clone.stdout);
  const untrackedStandardsInput = path.join(
    dirtyStandards,
    'untracked-production-input.json',
  );
  writeJson(untrackedStandardsInput, { must_be_rejected: true });
  const dirtyOutput = path.join(source.root, 'dirty-standards.json');
  const dirty = runProduction(
    dirtyOutput,
    source.registryPath,
    pinPath,
    dirtyStandards,
  );
  assert.equal(dirty.status, 2);
  assert.match(
    dirty.stderr,
    /production standards checkout must be fully clean, including untracked and ignored files/,
  );
  assert.equal(fs.existsSync(dirtyOutput), false);

  fs.unlinkSync(untrackedStandardsInput);
  const tamperedChecker = path.join(
    dirtyStandards,
    'tools',
    'check_agent_passport.py',
  );
  fs.appendFileSync(
    tamperedChecker,
    '\n# production supply-chain tamper\n',
  );
  const hideTrackedChange = spawnSync(
    'git',
    [
      '-C',
      dirtyStandards,
      'update-index',
      '--assume-unchanged',
      'tools/check_agent_passport.py',
    ],
    { encoding: 'utf8' },
  );
  assert.equal(
    hideTrackedChange.status,
    0,
    hideTrackedChange.stderr || hideTrackedChange.stdout,
  );
  const tamperedPin = JSON.parse(fs.readFileSync(pinPath, 'utf8'));
  tamperedPin.artifacts.checker.sha256 = sha256File(tamperedChecker);
  const tamperedPinPath = path.join(source.root, 'tampered-pin.json');
  const tamperedOutput = path.join(source.root, 'tampered-artifact.json');
  writeJson(tamperedPinPath, tamperedPin);
  const tamperedArtifact = runProduction(
    tamperedOutput,
    source.registryPath,
    tamperedPinPath,
    dirtyStandards,
  );
  assert.equal(tamperedArtifact.status, 2);
  assert.match(
    tamperedArtifact.stderr,
    /production standards artifact checker bytes differ from git commit/,
  );
  assert.equal(fs.existsSync(tamperedOutput), false);
});

standardsIntegrationTest('strict production registry builds exact canonical rows and Shared Genes', async (t) => {
  const source = makeProductionSource(t);
  const firstOutput = path.join(source.root, 'first.json');
  const secondOutput = path.join(source.root, 'second.json');
  const kvPackageOutput = path.join(source.root, 'managed-kv-package.json');
  const first = runProduction(
    firstOutput,
    source.registryPath,
    pinPath,
    standardsDir,
    kvPackageOutput,
  );
  const second = runProduction(secondOutput, source.registryPath);
  assert.equal(first.status, 0, first.stderr || first.stdout);
  assert.equal(second.status, 0, second.stderr || second.stdout);
  assert.deepEqual(
    fs.readFileSync(firstOutput),
    fs.readFileSync(secondOutput),
  );

  const bundle = JSON.parse(fs.readFileSync(firstOutput, 'utf8'));
  const kvPackage = JSON.parse(fs.readFileSync(kvPackageOutput, 'utf8'));
  const canonicalBundle = canonical(bundle);
  const packageBundle = kvPackage.chunks
    .map((entry) => entry.value)
    .join('');
  assert.equal(
    kvPackage.schema,
    'extella.evolution.standards_kv_package.v1',
  );
  assert.equal(
    kvPackage.root.key,
    'xtl_evolution:production_standards_bundle:v1',
  );
  assert.equal(
    kvPackage.root.value.schema,
    'extella.evolution.standards_kv_manifest.v1',
  );
  assert.equal(kvPackage.root.value.encoding, 'canonical-json-chunks.v1');
  assert.equal(kvPackage.root.value.chunk_count, kvPackage.chunks.length);
  assert.ok(
    kvPackage.chunks.every(
      (entry) => new TextEncoder().encode(entry.value).length <= 9000,
    ),
  );
  assert.equal(packageBundle, canonicalBundle);
  assert.equal(
    kvPackage.root.value.bundle_sha256,
    await loadCore().sha256(bundle),
  );
  assert.equal(
    kvPackage.root.value.bundle_byte_length,
    new TextEncoder().encode(canonicalBundle).length,
  );
  const direct = canonicalOutputForPassports([
    source.validPath,
    source.invalidPath,
  ]);
  const byId = Object.fromEntries(
    bundle.agents.map((agent) => [agent.platform_agent_id, agent]),
  );
  assert.equal(bundle.schema, 'extella.evolution.standards_bundle.v1');
  assert.equal(bundle.data_mode, 'PRODUCTION');
  assert.equal(bundle.owner_account_id, 'account_production_owner');
  assert.equal(
    bundle.delivery_mode,
    'ACCOUNT_SCOPED_HOST_PROVIDER',
  );
  assert.equal(bundle.production_eligible, true);
  assert.equal(bundle.live_projection_allowed, true);
  assert.deepEqual(bundle.runtime_policy, {
    live_projection: 'ALLOWED',
    production_merge: 'ALLOWED',
    purpose: 'STRICT_PINNED_PRODUCTION_REGISTRY',
  });
  assert.equal(bundle.sources.registry.schema,
    'extella.evolution.production_registry.v1');
  assert.equal(bundle.shared_gene_index.data_mode, 'PRODUCTION');
  assert.equal(bundle.shared_gene_index.complete, true);
  const unsignedBundle = plain(bundle);
  delete unsignedBundle.attestation;
  const attestedContentHash = await loadCore().sha256(unsignedBundle);
  assert.deepEqual(bundle.attestation, {
    schema: 'extella.evolution.standards_bundle.attestation.v1',
    type: 'HOST_PROVIDER_CONTENT_HASH',
    content_sha256: attestedContentHash,
    standards_git_commit: bundle.standards.git_commit,
    owner_account_id: 'account_production_owner',
  });
  assert.equal(
    Object.prototype.hasOwnProperty.call(bundle.attestation, 'signature'),
    false,
    'content hash attestation must not claim a cryptographic signature',
  );
  const tamperedUnsignedBundle = plain(unsignedBundle);
  tamperedUnsignedBundle.agents[0].passport_ready =
    !tamperedUnsignedBundle.agents[0].passport_ready;
  assert.notEqual(
    await loadCore().sha256(tamperedUnsignedBundle),
    bundle.attestation.content_sha256,
  );

  for (const [platformAgentId, canonical] of Object.entries(direct.agents)) {
    const generated = byId[platformAgentId];
    assert.ok(generated, `production row was dropped: ${platformAgentId}`);
    assert.deepEqual(generated.checker_report, canonical.checker_report);
    assert.deepEqual(generated.cabinet, canonical.cabinet);
  }
  const invalid = byId.agent_production_non_qwen;
  assert.equal(invalid.passport_present, true);
  assert.equal(invalid.passport_ready, false);
  assert.equal(invalid.cabinet, null);
  assert.deepEqual(
    invalid.checker_report.issues.map((issue) => issue.code),
    ['AGENT_MODEL_PROFILE_QWEN_REQUIRED'],
  );
  assert.deepEqual(
    Object.keys(invalid).sort(),
    Object.keys(
      loadBundle().agents.find(
        (agent) =>
          agent.platform_agent_id === 'agent_demo_fixture_non_qwen',
      ),
    ).sort(),
  );
  assert.equal(byId.agent_production_valid_alpha.passport_ready, true);
  assert.deepEqual(
    byId.agent_production_valid_alpha.platform_metadata,
    {
      platform_agent_id: 'agent_production_valid_alpha',
      name: 'Production valid alpha',
      provider: 'alibaba',
      model: 'qwen-3.7',
      last_activity_at: '2026-07-26T10:00:00Z',
    },
  );
  const serializedBundle = fs.readFileSync(firstOutput, 'utf8');
  for (const secretLikeValue of [
    'PLATFORM_SECRET_INSTRUCTIONS_MUST_NOT_LEAK',
    'private-production-tool',
    'platform-secret-token',
    'platform-internal-value',
  ]) {
    assert.equal(serializedBundle.includes(secretLikeValue), false);
  }
  assert.equal(
    bundle.shared_gene_index.genes[0].consumer_count,
    1,
  );
  assert.deepEqual(
    bundle.shared_gene_index.genes[0].consumer_agent_ids,
    ['agent_production_valid_alpha'],
  );

  const productionDataPaths = [
    bundle.sources.registry.path,
    bundle.sources.platform_agents.path,
    ...bundle.sources.passports.map((entry) => entry.path),
  ];
  for (const sourcePath of productionDataPaths) {
    assert.doesNotMatch(sourcePath, /fixture|demo/i);
  }
  const provisionSelftest = runPython([provisionPath, '--selftest']);
  assert.equal(
    provisionSelftest.status,
    0,
    provisionSelftest.stderr || provisionSelftest.stdout,
  );
  const kvBoundsSelftest = runPython([
    adapterPath,
    '--selftest-kv-bounds',
  ]);
  assert.equal(
    kvBoundsSelftest.status,
    0,
    kvBoundsSelftest.stderr || kvBoundsSelftest.stdout,
  );
  const provisionDryRun = runPython([
    provisionPath,
    '--package',
    kvPackageOutput,
    '--pin',
    pinPath,
  ]);
  assert.equal(
    provisionDryRun.status,
    0,
    provisionDryRun.stderr || provisionDryRun.stdout,
  );
  assert.deepEqual(JSON.parse(provisionDryRun.stdout), {
    bundle_byte_length: new TextEncoder().encode(canonicalBundle).length,
    bundle_sha256: kvPackage.root.value.bundle_sha256,
    chunk_count: kvPackage.chunks.length,
    external_writes: 0,
    owner_account_id: 'account_production_owner',
    root_key: 'xtl_evolution:production_standards_bundle:v1',
    status: 'VALIDATED_DRY_RUN',
  });
});

standardsIntegrationTest('production registry exposes legacy passports without stable IDs for explicit one-click repair', async (t) => {
  const source = makeProductionSource(t);
  const legacyPath = path.join(source.root, 'passports', 'legacy-unbound.json');
  const legacy = productionPassport(
    'valid-alpha.fixture',
    'agent_production_legacy_source',
  );
  delete legacy.agent.platform_agent_id;
  legacy.shared_genes = [];
  writeJson(legacyPath, legacy);

  const registry = {
    ...source.registry,
    passport_count: 3,
    passport_files: [
      ...source.registry.passport_files,
      'passports/legacy-unbound.json',
    ],
  };
  writeJson(source.registryPath, registry);
  const output = path.join(source.root, 'with-unbound-passport.json');
  const result = runProduction(output, source.registryPath);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const bundle = JSON.parse(fs.readFileSync(output, 'utf8'));
  assert.equal(bundle.agents.length, 2);
  assert.equal(bundle.unbound_passports.length, 1);
  const unbound = bundle.unbound_passports[0];
  assert.match(unbound.source_passport_id, /^passport_[a-f0-9]{32}$/);
  assert.equal(unbound.source_path, 'passports/legacy-unbound.json');
  assert.equal(unbound.passport_sha256, sha256File(legacyPath));
  assert.equal(
    unbound.passport_canonical_sha256,
    sha256Canonical(legacy),
  );
  assert.equal(
    unbound.source_passport_id,
    `passport_${sha256Canonical({
      path: 'passports/legacy-unbound.json',
      passport_sha256: sha256File(legacyPath),
    }).slice(0, 32)}`,
  );
  assert.deepEqual(unbound.passport, legacy);
  assert.equal(unbound.checker_report.ready, false);
  assert.deepEqual(
    unbound.checker_report,
    canonicalOutputForPassports([legacyPath]).agents[''].checker_report,
  );
  assert.ok(
    unbound.checker_report.issues.some(
      (issue) =>
        issue.code === 'AGENT_PLATFORM_ID_REQUIRED' &&
        /Evolution Console/.test(issue.message_ru) &&
        /Evolution Console/.test(issue.message_en),
    ),
  );
  assert.equal(
    bundle.agents.some((row) => !row.platform_agent_id),
    false,
    'an unbound passport must never be joined to a live agent by display name',
  );
  assert.deepEqual(
    bundle.sources.passports.find(
      (entry) => entry.source_passport_id === unbound.source_passport_id,
    ),
    {
      path: 'passports/legacy-unbound.json',
      platform_agent_id: null,
      source_passport_id: unbound.source_passport_id,
      sha256: sha256File(legacyPath),
    },
  );

  const unsignedBundle = plain(bundle);
  delete unsignedBundle.attestation;
  assert.equal(
    await loadCore().sha256(unsignedBundle),
    bundle.attestation.content_sha256,
    'the remediation source and original passport are covered by the account-bound attestation',
  );
});

standardsIntegrationTest('bundle pins exact canonical artifacts, widgets, and parsed passport template', () => {
  const bundle = loadBundle();
  const artifacts = bundle.standards.artifacts;
  const commit = spawnSync('git', ['-C', standardsDir, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
  });
  assert.equal(commit.status, 0, commit.stderr);
  assert.equal(bundle.standards.git_commit, commit.stdout.trim());

  for (const [role, artifact] of Object.entries(artifacts)) {
    const canonicalPath = path.join(standardsDir, artifact.path);
    assert.equal(
      artifact.sha256,
      sha256File(canonicalPath),
      `${role} SHA must pin exact canonical bytes`,
    );
  }
  assert.equal(
    artifacts.cabinet_widget.source,
    fs.readFileSync(
      path.join(standardsDir, artifacts.cabinet_widget.path),
      'utf8',
    ),
  );
  assert.equal(
    artifacts.help_widget.source,
    fs.readFileSync(
      path.join(standardsDir, artifacts.help_widget.path),
      'utf8',
    ),
  );
  assert.equal(bundle.passport_template.draft_state, 'NOT_VALIDATED');
  assert.equal(
    bundle.passport_template.sha256,
    artifacts.passport_template.sha256,
  );
  assert.equal(
    bundle.passport_template.artifact_path,
    artifacts.passport_template.path,
  );
});

standardsIntegrationTest('checker issues and Agent Cabinets equal direct canonical check_report/check/build', () => {
  const bundle = loadBundle();
  const direct = canonicalDirectOutput();
  const byId = Object.fromEntries(
    bundle.agents.map((agent) => [agent.platform_agent_id, agent]),
  );

  assert.deepEqual(bundle.passport_template.parsed, direct.template);
  for (const [platformAgentId, canonical] of Object.entries(direct.agents)) {
    const generated = byId[platformAgentId];
    assert.ok(generated, `missing generated row ${platformAgentId}`);
    assert.deepEqual(generated.checker_report, canonical.checker_report);
    assert.deepEqual(
      canonical.legacy_check[0],
      canonical.checker_report.issues
        .filter((issue) => issue.severity === 'error')
        .map((issue) => issue.message_ru),
    );
    assert.deepEqual(
      canonical.legacy_check[1],
      canonical.checker_report.issues
        .filter((issue) => issue.severity === 'warning')
        .map((issue) => issue.message_ru),
    );
    assert.deepEqual(generated.cabinet, canonical.cabinet);
    if (generated.passport_ready) {
      assert.equal(generated.cabinet.schema, 'extella.agent_cabinet.v1.1');
    } else {
      assert.equal(generated.cabinet, null);
    }
  }

  const invalid = byId.agent_demo_fixture_non_qwen;
  assert.equal(invalid.passport_ready, false);
  assert.equal(invalid.cabinet, null);
  assert.deepEqual(
    invalid.checker_report.issues.map((issue) => issue.code),
    ['AGENT_MODEL_PROFILE_QWEN_REQUIRED'],
  );

  const warning = byId.agent_demo_fixture_warning_only;
  assert.equal(warning.passport_ready, true);
  assert.ok(warning.cabinet);
  assert.deepEqual(
    warning.checker_report.issues.map((issue) => issue.code),
    ['AGENT_IMMUTABLE_BUNDLE_ID_RECOMMENDED'],
  );
});

test('generated canonical checker reports survive the fleet projection exactly', () => {
  const api = loadCore();
  const bundle = loadBundle();
  const platform = bundle.agents
    .filter((agent) => agent.platform_status === 'PRESENT')
    .map((agent) => agent.platform_metadata);
  const generatedById = Object.fromEntries(
    bundle.agents.map((agent) => [agent.platform_agent_id, agent]),
  );
  const projectedById = Object.fromEntries(
    plain(api.buildFleetProjection(platform, bundle).rows)
      .map((agent) => [agent.platformAgentId, agent]),
  );

  const invalidGenerated = generatedById.agent_demo_fixture_non_qwen;
  const invalidProjected = projectedById.agent_demo_fixture_non_qwen;
  assert.equal(invalidProjected.standardStatus, 'FAIL');
  assert.deepEqual(
    invalidProjected.checker.errors,
    invalidGenerated.checker_report.issues,
  );
  assert.deepEqual(invalidProjected.checker.warnings, []);
  assert.deepEqual(
    invalidProjected.checker.errors.map((issue) => ({
      path: issue.path,
      message_en: issue.message_en,
      message_ru: issue.message_ru,
    })),
    [{
      path: 'agent.model_profile',
      message_en:
        "agent.model_profile = 'gpt-4o': client agents must use Qwen",
      message_ru:
        'agent.model_profile = «gpt-4o»: клиентские агенты работают только на Qwen',
    }],
  );

  const warningGenerated = generatedById.agent_demo_fixture_warning_only;
  const warningProjected = projectedById.agent_demo_fixture_warning_only;
  assert.equal(warningProjected.standardStatus, 'PASS');
  assert.deepEqual(warningProjected.checker.errors, []);
  assert.deepEqual(
    warningProjected.checker.warnings,
    warningGenerated.checker_report.issues,
  );
  assert.deepEqual(
    warningProjected.checker.warnings.map((issue) => ({
      path: issue.path,
      message_en: issue.message_en,
      message_ru: issue.message_ru,
    })),
    [{
      path: 'agent.immutable_bundle_id',
      message_en:
        'agent.immutable_bundle_id is blank — without it, the exact deployed bundle cannot be proven',
      message_ru:
        'agent.immutable_bundle_id пуст — без него не доказать, какая именно сборка стоит у клиента',
    }],
  );

  const unknownIssue = {
    code: 'FUTURE_CANONICAL_SEVERITY',
    message_en: 'An unknown severity must fail closed',
    message_ru: 'Неизвестная критичность должна закрываться с ошибкой',
    path: 'agent.future_field',
    severity: 'future',
  };
  const unknownProjection = plain(api.buildFleetProjection(
    [{ id: 'agent_unknown_severity' }],
    [{
      platform_agent_id: 'agent_unknown_severity',
      passport_present: true,
      checker_report: {
        schema: 'extella.agent_passport.check_report.v1',
        ready: true,
        counts: { errors: 0, warnings: 0, issues: 1 },
        issues: [unknownIssue],
      },
    }],
  ));
  assert.equal(unknownProjection.rows[0].standardStatus, 'FAIL');
  assert.deepEqual(unknownProjection.rows[0].checker.errors, [unknownIssue]);
  assert.deepEqual(unknownProjection.rows[0].checker.warnings, []);
});

test('metadata join uses only stable platform_agent_id and Shared Gene N is exact', () => {
  const bundle = loadBundle();
  const byId = Object.fromEntries(
    bundle.agents.map((agent) => [agent.platform_agent_id, agent]),
  );
  const alpha = byId.agent_demo_fixture_valid_alpha;
  const beta = byId.agent_demo_fixture_valid_beta;
  assert.equal(
    alpha.cabinet.passport.identity.name,
    beta.cabinet.passport.identity.name,
    'fixture intentionally has duplicate names',
  );
  assert.equal(
    alpha.platform_metadata.fixture_metadata_marker,
    'ALPHA_BY_STABLE_ID',
  );
  assert.equal(
    beta.platform_metadata.fixture_metadata_marker,
    'BETA_BY_STABLE_ID',
  );

  const dead = byId.agent_demo_fixture_dead_reference;
  assert.equal(dead.platform_status, 'DEAD_REFERENCE');
  assert.equal(dead.platform_metadata, null);

  const index = bundle.shared_gene_index;
  assert.equal(index.schema, 'extella.shared_genes.map.v1');
  assert.equal(index.complete, true);
  assert.equal(index.genes.length, 1);
  assert.deepEqual(index.genes[0].consumer_agent_ids, [
    'agent_demo_fixture_valid_alpha',
    'agent_demo_fixture_valid_beta',
    'agent_demo_fixture_warning_only',
  ]);
  assert.equal(index.genes[0].consumer_count, 3);
  assert.deepEqual(
    index.by_agent.agent_demo_fixture_dead_reference,
    [],
  );
  assert.deepEqual(index.by_agent.agent_demo_fixture_non_qwen, []);
});

standardsIntegrationTest('adapter fails closed on an artifact SHA pin mismatch', (t) => {
  const temporary = fs.mkdtempSync(
    path.join(os.tmpdir(), 'extella-evolution-pin-mismatch-'),
  );
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const badPinPath = path.join(temporary, 'bad-pin.fixture');
  const output = path.join(temporary, 'must-not-exist.json');
  const badPin = JSON.parse(fs.readFileSync(pinPath, 'utf8'));
  badPin.artifacts.checker.sha256 = '0'.repeat(64);
  fs.writeFileSync(badPinPath, `${JSON.stringify(badPin, null, 2)}\n`);

  const result = runAdapter(output, badPinPath);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /artifact pin mismatch for checker/);
  assert.equal(fs.existsSync(output), false);
});

test('DEMO_FIXTURE IDs cannot enter the live router standards projection', () => {
  const bundle = loadBundle();
  const routerSource = fs.readFileSync(
    path.join(toolbarRoot, 'src', 'core', 'router.js'),
    'utf8',
  );
  const guardStart = routerSource.indexOf(
    '  function _evolutionProductionStandardsAvailable',
  );
  const guardEnd = routerSource.indexOf(
    '  function _evolutionLiveStandards',
    guardStart,
  );
  assert.ok(guardStart >= 0 && guardEnd > guardStart);
  const context = {};
  vm.runInNewContext(`
    ${routerSource.slice(guardStart, guardEnd)}
    this.available = _evolutionProductionStandardsAvailable;
  `, context);
  const driftedDemo = JSON.parse(JSON.stringify(bundle));
  driftedDemo.production_eligible = true;
  driftedDemo.live_projection_allowed = true;
  driftedDemo.runtime_policy.live_projection = 'ALLOWED';
  driftedDemo.runtime_policy.production_merge = 'ALLOWED';
  assert.equal(
    context.available(driftedDemo, 'account_a', true),
    false,
    'DEMO_FIXTURE stays excluded even when mutable flags drift',
  );
  const production = {
    ...driftedDemo,
    data_mode: 'PRODUCTION',
    delivery_mode: 'ACCOUNT_SCOPED_HOST_PROVIDER',
    owner_account_id: 'account_a',
    unbound_passports: [],
  };
  assert.equal(context.available(production, 'account_a', true), true);
  assert.equal(context.available(production, 'account_b', true), false);
  assert.equal(
    context.available(production, 'account_a', false),
    false,
    'a static production bundle is never a live account registry',
  );
  assert.match(routerSource, /bundle\.data_mode === 'PRODUCTION'/);
  assert.match(
    routerSource,
    /bundle\.delivery_mode === 'ACCOUNT_SCOPED_HOST_PROVIDER'/,
  );
  assert.match(
    routerSource,
    /String\(bundle\.owner_account_id \|\| ''\) === String\(actorId \|\| ''\)/,
  );
  assert.match(routerSource, /evolutionStandardsProvider/);
  assert.match(routerSource, /policy\.live_projection === 'ALLOWED'/);
  assert.match(routerSource, /policy\.production_merge === 'ALLOWED'/);
  assert.match(
    routerSource,
    /attestation\.type !== 'HOST_PROVIDER_CONTENT_HASH'/,
  );
  assert.match(
    routerSource,
    /hasOwnProperty\.call\(attestation, 'signature'\)/,
  );
  for (const agent of bundle.agents) {
    assert.equal(
      routerSource.includes(agent.platform_agent_id),
      false,
      `live router must not contain fixture id ${agent.platform_agent_id}`,
    );
  }
});
