'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const toolbarRoot = path.resolve(__dirname, '..');
const coreSource = fs.readFileSync(
  path.join(toolbarRoot, 'src', 'core', 'evolution-console.js'),
  'utf8',
);
const providerSource = fs.readFileSync(
  path.join(
    toolbarRoot,
    'src',
    'core',
    'evolution-standards-provider.js',
  ),
  'utf8',
);
const routerSource = fs.readFileSync(
  path.join(toolbarRoot, 'src', 'core', 'router.js'),
  'utf8',
);
const buildSource = fs.readFileSync(
  path.join(toolbarRoot, 'build.js'),
  'utf8',
);

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeRuntime(kvGet, initialStorage = {}, authState = null) {
  const storage = new Map(Object.entries(initialStorage));
  const context = {
    ETB: {
      api: { kvGet },
      auth: authState ? {
        getUserId() {
          return authState.userId;
        },
      } : undefined,
    },
    Promise,
    TextEncoder,
    crypto: crypto.webcrypto,
    localStorage: {
      getItem(key) {
        return storage.has(key) ? storage.get(key) : null;
      },
      setItem(key, value) {
        storage.set(key, String(value));
      },
    },
  };
  vm.runInNewContext(coreSource, context, {
    filename: 'evolution-console.js',
  });
  vm.runInNewContext(providerSource, context, {
    filename: 'evolution-standards-provider.js',
  });
  return {
    core: context.ETB.evolutionConsole,
    provider: context.ETB.evolutionStandardsProvider,
    storage,
  };
}

function productionBundle(actorId, agents = []) {
  return {
    schema: 'extella.evolution.standards_bundle.v1',
    data_mode: 'PRODUCTION',
    owner_account_id: actorId,
    delivery_mode: 'ACCOUNT_SCOPED_HOST_PROVIDER',
    production_eligible: true,
    live_projection_allowed: true,
    runtime_policy: {
      live_projection: 'ALLOWED',
      production_merge: 'ALLOWED',
    },
    standards: { git_commit: 'pinned', artifacts: {} },
    passport_template: {},
    agents,
    unbound_passports: [],
    sources: { passports: [] },
    attestation: {
      schema: 'extella.evolution.standards_bundle.attestation.v1',
      type: 'HOST_PROVIDER_CONTENT_HASH',
      owner_account_id: actorId,
      standards_git_commit: 'pinned',
      content_sha256: 'a'.repeat(64),
    },
  };
}

function missingKv() {
  return { status: 'error', message: 'Key not found' };
}

function rejectsCode(work, code) {
  return assert.rejects(
    Promise.resolve().then(work),
    (error) => {
      assert.equal(error.code, code);
      return true;
    },
  );
}

test('managed-KV provider scans only 15 exact live IDs and preserves a real 15-row fleet', async () => {
  const actorId = 'account_live_owner';
  const liveIds = Array.from(
    { length: 15 },
    (_, index) => `agent_live_${String(index + 1).padStart(2, '0')}`,
  );
  const ownerAgentId = liveIds[7];
  const bundle = productionBundle(actorId, [{
    platform_agent_id: liveIds[0],
    passport_present: true,
    passport_ready: true,
    checker_report: {
      schema: 'extella.agent_passport.check_report.v1',
      ready: true,
      counts: { errors: 0, warnings: 0, issues: 0 },
      issues: [],
    },
    shared_genes: [],
  }]);
  const calls = [];
  let manifest;
  let chunks = [];
  const runtime = makeRuntime((key, opts) => {
    calls.push({ key, agentId: opts && opts.agentId });
    const chunkIndex = chunks.findIndex((row) => row.key === key);
    if (opts && opts.agentId === ownerAgentId && chunkIndex !== -1) {
      return Promise.resolve({
        status: 'success',
        value: chunks[chunkIndex].value,
      });
    }
    return Promise.resolve(
      opts && opts.agentId === ownerAgentId ?
        { status: 'success', value: JSON.stringify(manifest) } :
        missingKv(),
    );
  });
  const canonicalBundle = runtime.core.canonical(bundle);
  const bundleSha256 = await runtime.core.sha256(bundle);
  const chunkSize = 350;
  for (let offset = 0; offset < canonicalBundle.length; offset += chunkSize) {
    const index = chunks.length;
    chunks.push({
      key: `${runtime.provider.BUNDLE_KEY}:chunk:${
        bundleSha256.slice(0, 20)
      }:${index}`,
      value: canonicalBundle.slice(offset, offset + chunkSize),
    });
  }
  manifest = {
    schema: runtime.provider.MANIFEST_SCHEMA,
    owner_account_id: actorId,
    encoding: runtime.provider.CHUNK_ENCODING,
    bundle_sha256: bundleSha256,
    bundle_byte_length: new TextEncoder().encode(canonicalBundle).length,
    chunk_count: chunks.length,
  };
  assert.ok(chunks.length > 1, 'fixture must exercise multi-chunk hydration');

  const loaded = plain(await runtime.provider.loadForActor({
    actorId,
    epoch: 4,
    platformAgentIds: liveIds.slice().reverse(),
  }));
  assert.deepEqual(loaded, bundle);
  const rootCalls = calls.filter(
    (call) => call.key === runtime.provider.BUNDLE_KEY,
  );
  const chunkCalls = calls.filter(
    (call) => call.key !== runtime.provider.BUNDLE_KEY,
  );
  assert.equal(rootCalls.length, 15);
  assert.equal(chunkCalls.length, chunks.length);
  assert.deepEqual(
    rootCalls.map((call) => call.agentId).sort(),
    liveIds,
  );
  assert.ok(chunkCalls.every(
    (call) => call.agentId === ownerAgentId,
  ));
  assert.equal(
    runtime.storage.get(
      `etb_evolution_standards_owner_v1:${encodeURIComponent(actorId)}`,
    ),
    ownerAgentId,
  );

  const fleet = runtime.core.buildFleetProjection(
    liveIds.map((id) => ({
      platform_agent_id: id,
      name: id,
      provider: 'alibaba',
      model: 'qwen-3.7',
    })),
    loaded.agents,
    {},
  );
  assert.equal(fleet.rows.length, 15);
  assert.equal(fleet.counts.platform, 15);
  assert.equal(fleet.counts.passportMissing, 14);
  assert.equal(
    fleet.rows.some((row) => /demo|fixture/i.test(row.platformAgentId)),
    false,
  );
});

test('toolbar build fails closed when a required core provider is missing', () => {
  assert.match(
    buildSource,
    /for \(const name of CORE_ORDER\)[\s\S]*?if \(!fs\.existsSync\(p\)\) \{\s*throw new Error\(`Missing required core module: \$\{name\}`\);/,
  );
  assert.doesNotMatch(
    buildSource,
    /⚠ Missing core module/,
  );
});

test('managed-KV provider rejects conflicting account bundles', async () => {
  const actorId = 'account_live_owner';
  const first = productionBundle(actorId);
  const second = productionBundle(actorId);
  second.registry_revision = 'conflict';
  const runtime = makeRuntime((key, opts) => Promise.resolve({
    status: 'success',
    value: opts.agentId === 'agent_live_01' ? first : second,
  }));
  await rejectsCode(
    () => runtime.provider.loadForActor({
      actorId,
      epoch: 1,
      platformAgentIds: ['agent_live_01', 'agent_live_02'],
    }),
    'PRODUCTION_STANDARDS_MULTIPLE_BUNDLES',
  );
});

test('managed-KV provider rejects cross-account data and reports a missing registry', async () => {
  const crossAccount = makeRuntime(() => Promise.resolve({
    status: 'success',
    value: productionBundle('account_other'),
  }));
  await rejectsCode(
    () => crossAccount.provider.loadForActor({
      actorId: 'account_live_owner',
      epoch: 1,
      platformAgentIds: ['agent_live_01'],
    }),
    'PRODUCTION_STANDARDS_ACCOUNT_MISMATCH',
  );

  const missing = makeRuntime(() => Promise.resolve(missingKv()));
  await rejectsCode(
    () => missing.provider.loadForActor({
      actorId: 'account_live_owner',
      epoch: 1,
      platformAgentIds: ['agent_live_01'],
    }),
    'PRODUCTION_STANDARDS_UNAVAILABLE',
  );
});

test('managed-KV provider fences every read to the authenticated account', async () => {
  const actorId = 'account_live_owner';
  const authState = { userId: actorId };
  let readCount = 0;
  const runtime = makeRuntime(
    () => {
      readCount += 1;
      authState.userId = 'another_account';
      return Promise.resolve(missingKv());
    },
    {},
    authState,
  );
  await rejectsCode(
    () => runtime.provider.loadForActor({
      actorId,
      epoch: 4,
      platformAgentIds: ['agent_live_01'],
    }),
    'ACCOUNT_SESSION_CHANGED',
  );
  assert.equal(readCount, 1);
});

test('live router loads platform IDs before provider and never substitutes the DEMO bundle', () => {
  const fleetStart = routerSource.indexOf('  function _evolutionFleetLoad');
  const fleetEnd = routerSource.indexOf(
    '  function _evolutionRequireSession',
    fleetStart,
  );
  const loadStart = routerSource.indexOf(
    '  function _evolutionLoadStandardsForActor',
  );
  const loadEnd = routerSource.indexOf(
    '  function _evolutionLiveStandards',
    loadStart,
  );
  const fleetSource = routerSource.slice(fleetStart, fleetEnd);
  const loadSource = routerSource.slice(loadStart, loadEnd);
  assert.ok(fleetStart >= 0 && fleetEnd > fleetStart);
  assert.ok(loadStart >= 0 && loadEnd > loadStart);
  assert.ok(
    fleetSource.indexOf('_evolutionLoadPlatformFleet(context)') <
      fleetSource.indexOf('_evolutionLoadStandardsForActor('),
  );
  assert.match(
    fleetSource,
    /platformResult\.rows\.map\(function \(row\) \{\s*return row\.platform_agent_id;/,
  );
  assert.match(loadSource, /platformAgentIds:/);
  assert.doesNotMatch(loadSource, /fallback\s*=\s*_evolutionBundle/);
  assert.match(loadSource, /bundle:\s*null/);
});

test('router exposes attested unbound passports through the exact stableIdRequired shape', async () => {
  const start = routerSource.indexOf(
    '  function _evolutionUnboundPassports',
  );
  const end = routerSource.indexOf(
    '  function _evolutionLoadStandardsForActor',
    start,
  );
  assert.ok(start >= 0 && end > start);
  const context = {
    ETB: {},
    Promise,
    TextEncoder,
    crypto: crypto.webcrypto,
  };
  vm.runInNewContext(coreSource, context, {
    filename: 'evolution-console.js',
  });
  vm.runInNewContext(`
    function _evolutionError(code, message) {
      var error = new Error(message || code);
      error.code = code;
      return error;
    }
    function _evolutionClone(value) {
      return value == null ? value : JSON.parse(JSON.stringify(value));
    }
    ${routerSource.slice(start, end)}
    this.normalizeUnbound = _evolutionUnboundPassports;
    this.forUi = _evolutionStableIdRequiredForUi;
  `, context, { filename: 'evolution-unbound-passports-slice.js' });
  const sourcePath = 'passports/legacy.json';
  const sourceFileSha256 = 'b'.repeat(64);
  const issue = {
    code: 'AGENT_PLATFORM_ID_REQUIRED',
    severity: 'error',
    path: 'agent.platform_agent_id',
    message_ru: 'Выберите точного живого агента в Evolution Console',
    message_en: 'Select the exact live agent in Evolution Console',
  };
  const passport = {
    agent: {
      platform_agent_id: '',
      name: 'Legacy Passport',
    },
  };
  const passportSha256 = await context.ETB.evolutionConsole.sha256(passport);
  const sourceIdentitySha256 = await context.ETB.evolutionConsole.sha256({
    path: sourcePath,
    passport_sha256: sourceFileSha256,
  });
  const sourcePassportId = `passport_${sourceIdentitySha256.slice(0, 32)}`;
  const sourceRecord = {
    path: sourcePath,
    platform_agent_id: null,
    source_passport_id: sourcePassportId,
    sha256: sourceFileSha256,
  };
  const rows = await context.normalizeUnbound({
    sources: { passports: [sourceRecord] },
    unbound_passports: [{
      source_passport_id: sourcePassportId,
      source_path: sourcePath,
      passport_sha256: sourceFileSha256,
      passport_canonical_sha256: passportSha256,
      passport,
      checker_report: {
        schema: 'extella.agent_passport.check_report.v1',
        ready: false,
        counts: { errors: 1, warnings: 0, issues: 1 },
        issues: [issue],
      },
    }],
  });
  assert.deepEqual(plain(context.forUi(rows)), [{
    sourcePassport: sourcePassportId,
    sourcePath,
    name: 'Legacy Passport',
    passportSha256: sourceFileSha256,
    passportCanonicalSha256: passportSha256,
    checkerIssues: [issue],
  }]);

  const tampered = JSON.parse(JSON.stringify(passport));
  tampered.agent.name = 'Tampered';
  await rejectsCode(
    () => context.normalizeUnbound({
      sources: { passports: [sourceRecord] },
      unbound_passports: [{
        source_passport_id: sourcePassportId,
        source_path: sourcePath,
        passport_sha256: sourceFileSha256,
        passport_canonical_sha256: passportSha256,
        passport: tampered,
        checker_report: {
          schema: 'extella.agent_passport.check_report.v1',
          ready: false,
          counts: { errors: 1, warnings: 0, issues: 1 },
          issues: [issue],
        },
      }],
    }),
    'PRODUCTION_UNBOUND_PASSPORTS_INVALID',
  );

  await rejectsCode(
    () => context.normalizeUnbound({
      sources: {
        passports: [{
          ...sourceRecord,
          source_passport_id: `passport_${'f'.repeat(32)}`,
        }],
      },
      unbound_passports: [{
        source_passport_id: `passport_${'f'.repeat(32)}`,
        source_path: sourcePath,
        passport_sha256: sourceFileSha256,
        passport_canonical_sha256: passportSha256,
        passport,
        checker_report: {
          schema: 'extella.agent_passport.check_report.v1',
          ready: false,
          counts: { errors: 1, warnings: 0, issues: 1 },
          issues: [issue],
        },
      }],
    }),
    'PRODUCTION_UNBOUND_PASSPORTS_INVALID',
  );
});

test('unbound source passport is repaired only through an explicit live agent selection', async () => {
  const start = routerSource.indexOf('  function _evolutionPassportDraft');
  const end = routerSource.indexOf(
    '  function _evolutionCabinetGet',
    start,
  );
  assert.ok(start >= 0 && end > start);
  const sourcePassportId = `passport_${'a'.repeat(32)}`;
  const sourcePassport = {
    agent: {
      platform_agent_id: '',
      name: 'Human-owned source name',
      owner: 'Human Owner',
      business_goal: 'Preserve the declared source',
      model_profile: 'qwen-source',
    },
    capabilities: [{ name: 'declared capability' }],
  };
  const session = {
    standardsAvailable: true,
    platformById: {
      agent_live_02: { platform_agent_id: 'agent_live_02' },
    },
    fleet: {
      rows: [{
        platformAgentId: 'agent_live_02',
        platformPresent: true,
        passportPresent: false,
        standardStatus: 'PASSPORT_MISSING',
      }],
    },
    unboundPassportsById: {
      [sourcePassportId]: {
        sourcePassportId,
        sourcePath: 'passports/legacy.json',
        passportSha256: 'b'.repeat(64),
        passport: sourcePassport,
      },
    },
    standardsBundle: {
      passport_template: {
        sha256: 'c'.repeat(64),
        draft_state: 'NOT_VALIDATED',
        parsed: { agent: {} },
      },
    },
  };
  const context = {
    ETB: {
      api: {
        agentGetScoped() {
          return Promise.resolve({
            agent: {
              id: 'agent_live_02',
              name: 'Different live display name',
              provider: 'alibaba',
              model: 'qwen-live',
              instructions: 'live instructions',
            },
          });
        },
      },
    },
    Promise,
    session,
  };
  vm.runInNewContext(`
    function _evolutionRequireSession() { return session; }
    function _evolutionError(code, message) {
      var error = new Error(message || code);
      error.code = code;
      return error;
    }
    function _agentControlApiRead(actorContext, work) { return work(); }
    function _studioApiOk() {}
    function _evolutionExactAgentRow(row) {
      return {
        platform_agent_id: String(row.id || row.agent_id || ''),
        name: String(row.name || ''),
        provider: String(row.provider || ''),
        model: String(row.model || ''),
        instructions: String(row.instructions || '')
      };
    }
    function _evolutionBundle() { return {}; }
    function _evolutionClone(value) {
      return value == null ? value : JSON.parse(JSON.stringify(value));
    }
    ${routerSource.slice(start, end)}
    this.passportDraft = _evolutionPassportDraft;
  `, context, { filename: 'evolution-passport-draft-slice.js' });

  const result = plain(await context.passportDraft({
    snapshotId: 'fleet_exact',
    agentId: 'agent_live_02',
    sourcePassport: sourcePassportId,
  }, {}));
  assert.equal(result.sourcePassport, sourcePassportId);
  assert.equal(result.draft.agent.platform_agent_id, 'agent_live_02');
  assert.equal(result.draft.agent.name, 'Human-owned source name');
  assert.equal(result.draft.agent.owner, 'Human Owner');
  assert.equal(result.draft.agent.model_profile, 'qwen-source');
  assert.equal(sourcePassport.agent.platform_agent_id, '');

  await rejectsCode(
    () => context.passportDraft({
      snapshotId: 'fleet_exact',
      agentId: 'agent_live_02',
      sourcePassport: `passport_${'f'.repeat(32)}`,
    }, {}),
    'AGENT_PASSPORT_SOURCE_NOT_FOUND',
  );
});
