// ── EXTELLA EVOLUTION · HOST READINESS ADAPTER ───────────────────────────
// Resolves one host-selected prepared publication without exposing its KV
// references, candidate body, test plan, credentials or native identifiers to
// the iframe. Native test and publish methods stay deliberately unassigned.

ETB.evolutionHostAdapter = (function () {
  'use strict';

  var SELECTION_KEY = 'xtl_evolution:trusted_publish_selection:v1';
  var SELECTION_KEYS = [
    'draft_id',
    'agent_id',
    'test_run_id',
    'gene_id',
    'candidate_payload_ref',
    'test_plan_ref',
    'before_ref',
    'native_id',
    'publish_state',
    'selected_at',
    'actor_id'
  ];
  var ID = /^[A-Za-z0-9][A-Za-z0-9._:@/+()-]{0,239}$/;
  var HASH = /^[a-f0-9]{64}$/;

  function fail(code, message) {
    var error = new Error(message || code);
    error.code = code;
    throw error;
  }

  function object(value, code, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        Object.prototype.toString.call(value) !== '[object Object]') {
      fail(code, label + ' must be an object');
    }
    return value;
  }

  function exactKeys(value, expected, code, label) {
    var actual = Object.keys(object(value, code, label)).sort();
    var wanted = expected.slice().sort();
    if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
      fail(code, label + ' has missing or unsupported fields');
    }
  }

  function exactId(value, code, label) {
    if (typeof value !== 'string' || !ID.test(value)) {
      fail(code, label + ' must be an exact bounded identifier');
    }
    return value;
  }

  function apiValue(response, allowMissing) {
    var status = String(response && response.status || '').toLowerCase();
    var detail = [
      response && response.message,
      response && response.error,
      response && response.detail
    ].filter(function (value) { return typeof value === 'string'; }).join(' ');
    if ((status === 'error' || status === 'failed' || status === 'not_found') &&
        /key not found|kv[^ ]* not found|ключ[^ ]* не найден/i.test(detail)) {
      if (allowMissing) return null;
      fail('TRUSTED_PUBLISH_SELECTION_SOURCE_UNAVAILABLE',
        'required trusted publication object is missing');
    }
    if (!response || status === 'error' || status === 'failed') {
      fail('TRUSTED_PUBLISH_SELECTION_SOURCE_UNAVAILABLE',
        'trusted publication KV read failed');
    }
    if (response.value != null) return response.value;
    if (response.kv_value != null) return response.kv_value;
    if (response.result && response.result.value != null) {
      return response.result.value;
    }
    if (allowMissing) return null;
    fail('TRUSTED_PUBLISH_SELECTION_SOURCE_UNAVAILABLE',
      'trusted publication KV value is empty');
  }

  function readJson(key, allowMissing) {
    return ETB.api.kvGet(key, { global: true }).then(function (response) {
      var value = apiValue(response, allowMissing === true);
      if (value === null) return null;
      if (typeof value !== 'string') return object(
        value,
        'TRUSTED_PUBLISH_SELECTION_INVALID',
        'trusted publication KV value'
      );
      try {
        return object(
          JSON.parse(value),
          'TRUSTED_PUBLISH_SELECTION_INVALID',
          'trusted publication KV value'
        );
      } catch (error) {
        if (error && error.code) throw error;
        fail('TRUSTED_PUBLISH_SELECTION_INVALID',
          'trusted publication KV value is not valid JSON');
      }
    });
  }

  function schema(value) {
    return String(value && (value.schema || value.schema_version ||
      value.schemaVersion) || '');
  }

  function contentRef(ref, prefix, agentId) {
    var expectedPrefix = prefix + (agentId ? String(agentId) + ':' : '');
    var value = String(ref || '');
    var suffix;
    if (value.indexOf(expectedPrefix) !== 0) {
      fail('TRUSTED_PUBLISH_SELECTION_REF_INVALID',
        'trusted publication content reference has an unsupported prefix');
    }
    suffix = value.slice(expectedPrefix.length);
    if (!/^[a-f0-9]{32}$/.test(suffix)) {
      fail('TRUSTED_PUBLISH_SELECTION_REF_INVALID',
        'trusted publication content reference is not content-addressed');
    }
    return suffix;
  }

  function verifyContent(value, ref, prefix, agentId) {
    var expected = contentRef(ref, prefix, agentId);
    return ETB.agentControl.sha256(value).then(function (actual) {
      if (!HASH.test(String(actual || '')) || actual.slice(0, 32) !== expected) {
        fail('TRUSTED_PUBLISH_SELECTION_CONTENT_MISMATCH',
          'trusted publication content does not match its reference');
      }
      return value;
    });
  }

  function verifyBody(value, label) {
    if (typeof value.body !== 'string' || !HASH.test(String(value.body_sha256 || ''))) {
      fail('TRUSTED_PUBLISH_SELECTION_INVALID', label + ' body is invalid');
    }
    return ETB.agentControl.sha256(value.body).then(function (actual) {
      if (actual !== value.body_sha256) {
        fail('TRUSTED_PUBLISH_SELECTION_CONTENT_MISMATCH',
          label + ' body hash does not match');
      }
      return value;
    });
  }

  function context(hostContext, status, errorCode, subject) {
    var actorId = '';
    try { actorId = String(ETB.auth.getUserId() || ''); } catch (_) {}
    exactId(actorId, 'TRUSTED_PUBLISH_SELECTION_ACCOUNT_MISMATCH',
      'authenticated account');
    return {
      schema: 'extella.evolution.trusted_publish_context.v1.1',
      owner_account_id: actorId,
      fleet_snapshot_id: exactId(
        hostContext.fleet_snapshot_id,
        'TRUSTED_PUBLISH_SELECTION_INVALID',
        'fleet snapshot'
      ),
      captured_at: new Date().toISOString(),
      status: status,
      error_code: errorCode,
      subject: subject || null,
      request: null,
      result: null,
      public_error: null
    };
  }

  function loadTrustedPublishContext(payload) {
    var hostContext;
    exactKeys(payload, ['host_context'],
      'TRUSTED_PUBLISH_SELECTION_INVALID', 'host adapter request');
    hostContext = payload.host_context;
    exactKeys(hostContext, ['fleet_snapshot_id', 'request_id'],
      'TRUSTED_PUBLISH_SELECTION_INVALID', 'host adapter context');
    exactId(hostContext.request_id, 'TRUSTED_PUBLISH_SELECTION_INVALID',
      'host request id');

    return readJson(SELECTION_KEY, true).then(function (selection) {
      var actorId;
      var candidateSuffix;
      var testPlanSuffix;
      var beforeSuffix;
      if (!selection) return context(hostContext, 'NO_DRAFT', null, null);
      exactKeys(selection, SELECTION_KEYS,
        'TRUSTED_PUBLISH_SELECTION_INVALID', 'trusted publication selection');
      exactId(selection.draft_id, 'TRUSTED_PUBLISH_SELECTION_INVALID', 'draft id');
      exactId(selection.agent_id, 'TRUSTED_PUBLISH_SELECTION_INVALID', 'agent id');
      exactId(selection.test_run_id, 'TRUSTED_PUBLISH_SELECTION_INVALID', 'test run id');
      exactId(selection.gene_id, 'TRUSTED_PUBLISH_SELECTION_INVALID', 'Shared Gene id');
      actorId = '';
      try { actorId = String(ETB.auth.getUserId() || ''); } catch (_) {}
      if (selection.actor_id !== actorId) {
        fail('TRUSTED_PUBLISH_SELECTION_ACCOUNT_MISMATCH',
          'trusted publication selection belongs to another account');
      }
      candidateSuffix = contentRef(
        selection.candidate_payload_ref,
        'xtl_evolution:candidate:'
      );
      testPlanSuffix = contentRef(
        selection.test_plan_ref,
        'xtl_evolution:test_plan:'
      );
      beforeSuffix = contentRef(
        selection.before_ref,
        'xtl_evolution:before:',
        selection.agent_id
      );
      if (!candidateSuffix || !testPlanSuffix || !beforeSuffix) {
        fail('TRUSTED_PUBLISH_SELECTION_REF_INVALID');
      }
      return Promise.all([
        readJson(selection.candidate_payload_ref, false).then(function (value) {
          return verifyContent(value, selection.candidate_payload_ref,
            'xtl_evolution:candidate:');
        }),
        readJson(selection.test_plan_ref, false).then(function (value) {
          return verifyContent(value, selection.test_plan_ref,
            'xtl_evolution:test_plan:');
        }),
        readJson(selection.before_ref, false).then(function (value) {
          return verifyContent(value, selection.before_ref,
            'xtl_evolution:before:', selection.agent_id);
        })
      ]).then(function (values) {
        var candidate = values[0];
        var testPlan = values[1];
        var before = values[2];
        if (schema(candidate) !== 'evolution-candidate-payload.v1' ||
            schema(testPlan) !== 'evolution-test-plan.v1' ||
            schema(before) !== 'evolution-before-snapshot.v1' ||
            candidate.gene_id !== selection.gene_id ||
            before.agent_id !== selection.agent_id ||
            before.native_id !== selection.native_id) {
          fail('TRUSTED_PUBLISH_SELECTION_INVALID',
            'trusted publication objects do not bind the selected operation');
        }
        return Promise.all([
          verifyBody(candidate, 'candidate'),
          verifyBody(before, 'before snapshot')
        ]).then(function () {
          var subject;
          if (candidate.from_body_sha256 !== before.body_sha256 ||
              testPlan.same_inputs !== true ||
              !Array.isArray(testPlan.cases) ||
              testPlan.cases.length < 1 || testPlan.cases.length > 50) {
            fail('TRUSTED_PUBLISH_SELECTION_INVALID',
              'candidate, baseline and test plan are not the same prepared change');
          }
          subject = {
            gene_id: exactId(
              candidate.gene_id,
              'TRUSTED_PUBLISH_SELECTION_INVALID',
              'candidate Shared Gene id'
            ),
            kind: exactId(
              candidate.kind,
              'TRUSTED_PUBLISH_SELECTION_INVALID',
              'candidate kind'
            ),
            from_version: exactId(
              candidate.from_version,
              'TRUSTED_PUBLISH_SELECTION_INVALID',
              'candidate from version'
            ),
            version: exactId(
              candidate.version,
              'TRUSTED_PUBLISH_SELECTION_INVALID',
              'candidate version'
            ),
            test_case_count: testPlan.cases.length
          };
          if (selection.publish_state === 'BLOCKED_NATIVE_ID_UNAVAILABLE' &&
              selection.native_id === null && before.addressable === false) {
            return context(
              hostContext,
              'UNAVAILABLE',
              'BLOCKED_NATIVE_ID_UNAVAILABLE',
              subject
            );
          }
          return context(
            hostContext,
            'UNAVAILABLE',
            'TRUSTED_PUBLISH_EXECUTION_UNAVAILABLE',
            subject
          );
        });
      });
    });
  }

  return {
    loadTrustedPublishContext: loadTrustedPublishContext
  };
}());

ETB.evolutionAdapter = ETB.evolutionAdapter || {};
if (typeof ETB.evolutionAdapter.loadTrustedPublishContext !== 'function') {
  ETB.evolutionAdapter.loadTrustedPublishContext =
    ETB.evolutionHostAdapter.loadTrustedPublishContext;
}
