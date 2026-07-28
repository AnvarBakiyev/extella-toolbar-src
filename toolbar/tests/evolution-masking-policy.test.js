'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const toolbarRoot = path.resolve(__dirname, '..');
const policyPath = path.join(
  toolbarRoot,
  'src',
  'core',
  'evolution-masking-policy.js',
);
const policySource = fs.readFileSync(policyPath, 'utf8');

function loadPolicy() {
  const context = { ETB: {} };
  vm.runInNewContext(policySource, context, {
    filename: 'evolution-masking-policy.js',
  });
  return context.ETB.evolutionMaskingPolicy;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function agent(overrides = {}) {
  return {
    agent_id: 'agent_demo',
    status: 'ACTIVE',
    pre: 'ENFORCED',
    post: 'ENFORCED',
    reveal: 'LOCAL_FILE_ONLY',
    roles: 'LOCAL_SURROGATE',
    audit: 'AVAILABLE',
    policy_version: '1.0.0',
    risk_codes: [],
    ...overrides,
  };
}

function snapshot(overrides = {}) {
  return {
    schema: 'extella.evolution.masking_posture_snapshot.v1',
    owner_account_id: 'account_demo',
    fleet_snapshot_id: 'fleet_snapshot_001',
    captured_at: '2026-07-28T08:00:00+05:00',
    source: 'LOCAL_DEVICE',
    availability: 'AVAILABLE',
    error_code: null,
    agents: [agent()],
    ...overrides,
  };
}

function options(overrides = {}) {
  return {
    ownerAccountId: 'account_demo',
    fleetSnapshotId: 'fleet_snapshot_001',
    expectedAgentIds: ['agent_demo'],
    now: '2026-07-28T08:04:00+05:00',
    ...overrides,
  };
}

test('exports the exact schema, enums and fixed risk allowlist', () => {
  const policy = loadPolicy();

  assert.equal(
    policy.SCHEMA,
    'extella.evolution.masking_posture_snapshot.v1',
  );
  assert.equal(policy.SOURCE, 'LOCAL_DEVICE');
  assert.equal(policy.MAX_AGE_MS, 5 * 60 * 1000);
  assert.equal(policy.MAX_FUTURE_SKEW_MS, 60 * 1000);
  assert.deepEqual(plain(policy.AVAILABILITY), [
    'AVAILABLE',
    'SOURCE_UNAVAILABLE',
  ]);
  assert.deepEqual(plain(policy.STATUSES), [
    'ACTIVE',
    'OFF',
    'PARTIAL',
    'UNKNOWN',
  ]);
  assert.deepEqual(plain(policy.PRE_POST_STATUSES), [
    'DISABLED',
    'ENFORCED',
    'PROTOTYPE',
    'UNAVAILABLE',
    'UNKNOWN',
  ]);
  assert.deepEqual(plain(policy.REVEAL_STATUSES), [
    'DISABLED',
    'LOCAL_FILE_ONLY',
    'UNAVAILABLE',
    'UNGUARDED_RAW',
    'UNKNOWN',
  ]);
  assert.deepEqual(plain(policy.ROLES_STATUSES), [
    'LOCAL_SURROGATE',
    'PLATFORM_ROLES',
    'UNAVAILABLE',
    'UNKNOWN',
  ]);
  assert.deepEqual(plain(policy.AUDIT_STATUSES), [
    'AVAILABLE',
    'UNAVAILABLE',
    'UNKNOWN',
  ]);
  assert.deepEqual(plain(policy.RISK_CODES), [
    'PRE_NOT_ENFORCED',
    'POST_NOT_ENFORCED',
    'POST_PROTOTYPE_ONLY',
    'REVEAL_OWNER_GUARD_UNAVAILABLE',
    'FIELD_HINTS_NOT_ENFORCED',
    'POLICY_VERSION_MISSING',
    'AUDIT_AGENT_SCOPE_UNAVAILABLE',
    'VAULT_UNAVAILABLE',
    'ROLES_UNAVAILABLE',
    'CROSS_DEVICE_BOUNDARY_UNVERIFIED',
    'SOURCE_UNAVAILABLE',
  ]);
  assert(Object.isFrozen(policy));
  assert(Object.isFrozen(policy.RISK_CODES));
});

test('normalizes an exact fleet snapshot without mutating its input', () => {
  const policy = loadPolicy();
  const input = snapshot({
    agents: [
      agent({
        agent_id: 'agent_z',
        risk_codes: ['ROLES_UNAVAILABLE', 'PRE_NOT_ENFORCED'],
      }),
      agent({
        agent_id: 'agent_a',
        status: 'OFF',
        pre: 'DISABLED',
        post: 'DISABLED',
      }),
    ],
  });
  const before = JSON.stringify(input);
  const normalized = policy.normalizeSnapshot(input, options({
    expectedAgentIds: ['agent_z', 'agent_a'],
  }));

  assert.equal(JSON.stringify(input), before);
  assert.deepEqual(
    plain(normalized.agents.map((row) => row.agent_id)),
    ['agent_a', 'agent_z'],
  );
  assert.deepEqual(
    plain(normalized.agents[1].risk_codes),
    ['PRE_NOT_ENFORCED', 'ROLES_UNAVAILABLE'],
  );
  assert(Object.isFrozen(normalized));
  assert(Object.isFrozen(normalized.agents));
  assert(Object.isFrozen(normalized.agents[0]));
});

test('derives ACTIVE, OFF, PARTIAL and UNKNOWN only from PRE and POST', () => {
  const policy = loadPolicy();

  assert.equal(policy.deriveStatus('ENFORCED', 'ENFORCED'), 'ACTIVE');
  assert.equal(policy.deriveStatus('DISABLED', 'DISABLED'), 'OFF');
  assert.equal(policy.deriveStatus('ENFORCED', 'PROTOTYPE'), 'PARTIAL');
  assert.equal(policy.deriveStatus('DISABLED', 'ENFORCED'), 'PARTIAL');
  assert.equal(policy.deriveStatus('ENFORCED', 'UNAVAILABLE'), 'UNKNOWN');
  assert.equal(policy.deriveStatus('UNKNOWN', 'DISABLED'), 'UNKNOWN');
});

test('rejects a supplied status that beautifies the hook posture', () => {
  const policy = loadPolicy();
  const input = snapshot({
    agents: [agent({
      status: 'ACTIVE',
      post: 'PROTOTYPE',
      risk_codes: ['POST_NOT_ENFORCED', 'POST_PROTOTYPE_ONLY'],
    })],
  });

  assert.throws(
    () => policy.normalizeSnapshot(input, options()),
    (error) => {
      assert.equal(error.code, 'MASKING_POSTURE_STATUS_MISMATCH');
      return true;
    },
  );
});

test('rejects extra root and agent fields, including raw config and secrets', () => {
  const policy = loadPolicy();
  const rootSecret = snapshot({ vault_key: 'do-not-project' });
  const rawConfig = snapshot({
    agents: [agent({
      field_hints: { iin: 'ИИН' },
    })],
  });

  assert.throws(
    () => policy.normalizeSnapshot(rootSecret, options()),
    (error) => {
      assert.equal(error.code, 'MASKING_POSTURE_SNAPSHOT_INVALID');
      return true;
    },
  );
  assert.throws(
    () => policy.normalizeSnapshot(rawConfig, options()),
    (error) => {
      assert.equal(error.code, 'MASKING_POSTURE_AGENT_INVALID');
      return true;
    },
  );
});

test('binds the snapshot to the exact account and fleet snapshot', () => {
  const policy = loadPolicy();

  assert.throws(
    () => policy.normalizeSnapshot(
      snapshot({ owner_account_id: 'account_other' }),
      options(),
    ),
    (error) => {
      assert.equal(error.code, 'MASKING_POSTURE_OWNER_MISMATCH');
      return true;
    },
  );
  assert.throws(
    () => policy.normalizeSnapshot(
      snapshot({ fleet_snapshot_id: 'fleet_other' }),
      options(),
    ),
    (error) => {
      assert.equal(error.code, 'MASKING_POSTURE_FLEET_MISMATCH');
      return true;
    },
  );
});

test('requires the exact expected fleet set with no missing or duplicate agent', () => {
  const policy = loadPolicy();

  assert.throws(
    () => policy.normalizeSnapshot(
      snapshot(),
      options({ expectedAgentIds: ['agent_demo', 'agent_missing'] }),
    ),
    (error) => {
      assert.equal(error.code, 'MASKING_POSTURE_AGENT_SET_MISMATCH');
      return true;
    },
  );
  assert.throws(
    () => policy.normalizeSnapshot(
      snapshot({ agents: [agent(), agent()] }),
      options(),
    ),
    (error) => {
      assert.equal(error.code, 'MASKING_POSTURE_AGENT_SET_MISMATCH');
      return true;
    },
  );
  assert.throws(
    () => policy.normalizeSnapshot(
      snapshot(),
      options({ expectedAgentIds: ['agent_demo', 'agent_demo'] }),
    ),
    (error) => {
      assert.equal(error.code, 'MASKING_POSTURE_EXPECTED_AGENTS_INVALID');
      return true;
    },
  );
});

test('rejects unsupported and duplicate technical risk codes', () => {
  const policy = loadPolicy();

  assert.throws(
    () => policy.normalizeSnapshot(
      snapshot({
        agents: [agent({ risk_codes: ['MADE_UP_RISK'] })],
      }),
      options(),
    ),
    (error) => {
      assert.equal(error.code, 'MASKING_POSTURE_RISK_CODE_UNSUPPORTED');
      return true;
    },
  );
  assert.throws(
    () => policy.normalizeSnapshot(
      snapshot({
        agents: [agent({
          risk_codes: ['VAULT_UNAVAILABLE', 'VAULT_UNAVAILABLE'],
        })],
      }),
      options(),
    ),
    (error) => {
      assert.equal(error.code, 'MASKING_POSTURE_RISK_CODES_INVALID');
      return true;
    },
  );
});

test('unavailableSnapshot returns bounded UNKNOWN rows for the exact fleet', () => {
  const policy = loadPolicy();
  const unavailable = policy.unavailableSnapshot({
    ownerAccountId: 'account_demo',
    fleetSnapshotId: 'fleet_snapshot_001',
    expectedAgentIds: ['agent_z', 'agent_a'],
    errorCode: 'LOCAL_MASKING_ADAPTER_UNAVAILABLE',
    capturedAt: '2026-07-28T08:30:00Z',
  });

  assert.equal(unavailable.availability, 'SOURCE_UNAVAILABLE');
  assert.equal(
    unavailable.error_code,
    'LOCAL_MASKING_ADAPTER_UNAVAILABLE',
  );
  assert.deepEqual(
    plain(unavailable.agents.map((row) => row.agent_id)),
    ['agent_a', 'agent_z'],
  );
  unavailable.agents.forEach((row) => {
    assert.equal(row.status, 'UNKNOWN');
    assert.equal(row.pre, 'UNAVAILABLE');
    assert.equal(row.post, 'UNAVAILABLE');
    assert.equal(row.reveal, 'UNAVAILABLE');
    assert.equal(row.roles, 'UNAVAILABLE');
    assert.equal(row.audit, 'UNAVAILABLE');
    assert.equal(row.policy_version, null);
    assert.deepEqual(plain(row.risk_codes), ['SOURCE_UNAVAILABLE']);
  });
  assert.deepEqual(
    plain(policy.normalizeSnapshot(unavailable, options({
      expectedAgentIds: ['agent_a', 'agent_z'],
      now: '2026-07-28T08:30:30Z',
    }))),
    plain(unavailable),
  );
});

test('rejects stale and implausibly future local posture snapshots', () => {
  const policy = loadPolicy();

  assert.throws(
    () => policy.normalizeSnapshot(snapshot(), options({
      now: '2026-07-28T08:05:01+05:00',
    })),
    (error) => {
      assert.equal(error.code, 'MASKING_POSTURE_STALE');
      return true;
    },
  );
  assert.throws(
    () => policy.normalizeSnapshot(
      snapshot({ captured_at: '2026-07-28T08:05:01+05:00' }),
      options(),
    ),
    (error) => {
      assert.equal(error.code, 'MASKING_POSTURE_STALE');
      return true;
    },
  );
});

test('an unavailable source cannot carry stale ACTIVE posture claims', () => {
  const policy = loadPolicy();
  const stale = snapshot({
    availability: 'SOURCE_UNAVAILABLE',
    error_code: 'LOCAL_MASKING_SOURCE_UNAVAILABLE',
  });

  assert.throws(
    () => policy.normalizeSnapshot(stale, options()),
    (error) => {
      assert.equal(error.code, 'MASKING_POSTURE_UNAVAILABLE_CLAIM_INVALID');
      return true;
    },
  );
});

test('rejects wildcard identifiers and invalid source metadata', () => {
  const policy = loadPolicy();

  assert.throws(
    () => policy.normalizeSnapshot(
      snapshot(),
      options({ ownerAccountId: 'account_*' }),
    ),
    (error) => {
      assert.equal(error.code, 'MASKING_POSTURE_OWNER_INVALID');
      return true;
    },
  );
  assert.throws(
    () => policy.normalizeSnapshot(
      snapshot({ source: 'GLOBAL_KV' }),
      options(),
    ),
    (error) => {
      assert.equal(error.code, 'MASKING_POSTURE_SOURCE_INVALID');
      return true;
    },
  );
  assert.throws(
    () => policy.normalizeSnapshot(
      snapshot({ captured_at: '2026-07-28T08:00:00' }),
      options(),
    ),
    (error) => {
      assert.equal(error.code, 'MASKING_POSTURE_CAPTURED_AT_INVALID');
      return true;
    },
  );
});
