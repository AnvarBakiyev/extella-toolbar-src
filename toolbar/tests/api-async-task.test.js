'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const apiSource = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'core', 'api.js'),
  'utf8',
);

function response(body) {
  return {
    status: 200,
    json: async () => body,
  };
}

function loadApi(taskReplies) {
  let checks = 0;
  const context = {
    AbortController,
    Promise,
    clearTimeout,
    console,
    setTimeout,
    window: {},
    fetch: async (url) => {
      if (!url.endsWith('/api/tasks/check')) {
        throw new Error(`unexpected request: ${url}`);
      }
      const next = taskReplies[Math.min(checks, taskReplies.length - 1)];
      checks += 1;
      return response(next);
    },
    ETB: {
      auth: {
        getToken: () => 'test-token',
        onToken: () => null,
        onSessionChange: () => null,
        refreshSession: async () => null,
      },
    },
  };
  context.window.parent = context.window;
  vm.createContext(context);
  vm.runInContext(apiSource, context, { filename: 'api.js' });
  return { api: context.ETB.api, checks: () => checks };
}

function loadScopeApi(agents) {
  const requests = [];
  const context = {
    AbortController,
    Promise,
    clearTimeout,
    console,
    setTimeout,
    window: {},
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (!url.endsWith('/api/agent/list')) {
        throw new Error(`unexpected request: ${url}`);
      }
      return response({ agents });
    },
    ETB: {
      auth: {
        getToken: () => 'test-token',
        onToken: () => null,
        onSessionChange: () => null,
        refreshSession: async () => null,
      },
    },
  };
  context.window.parent = context.window;
  vm.createContext(context);
  vm.runInContext(apiSource, context, { filename: 'api.js' });
  return { api: context.ETB.api, requests };
}

test('pollTask waits through running until the deferred Expert has a result', async () => {
  const completed = { status: 'completed', result: '{"status":"success"}' };
  const { api, checks } = loadApi([
    { status: 'running' },
    completed,
  ]);

  const result = await api.pollTask('task-baga-page', {
    interval: 1,
    maxWait: 1000,
    stallTimeout: 0,
  });

  assert.equal(checks(), 2);
  assert.equal(result.status, 'completed');
  assert.equal(result.result, completed.result);
});

test('pollTask still accepts legacy done as a terminal status', async () => {
  const { api, checks } = loadApi([
    { status: 'done', result: 'ready' },
  ]);

  const result = await api.pollTask('task-legacy', {
    interval: 1,
    maxWait: 1000,
  });

  assert.equal(checks(), 1);
  assert.equal(result.result, 'ready');
});

test('resolveAccountScope returns an agent that is present in the current account', async () => {
  const { api, requests } = loadScopeApi([
    { id: 'agent_customer_minimax_12345678', provider: 'minimax' },
  ]);

  const scope = await api.resolveAccountScope();

  assert.equal(scope, 'agent_customer_minimax_12345678');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.headers['X-Agent-Id'], 'agent_XXXXXXXX');
});

test('resolveAccountScope fails closed when the current account has no concrete agent', async () => {
  const { api } = loadScopeApi([]);

  await assert.rejects(
    api.resolveAccountScope(),
    (error) => error && error.code === 'account_scope_unavailable',
  );
});
