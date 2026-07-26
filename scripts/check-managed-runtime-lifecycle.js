#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'toolbar/src/core/plugins.js'), 'utf8');
// Испытательный образец, а НЕ продуктовая карточка каталога. Раньше проверка
// читала toolbar/plugins/extella_adoption_wizard.json — карточку, которая в main
// не поставляется намеренно (Конструктор раздаётся через реестр пака), поэтому
// с 22.07.2026 гейт падал с ENOENT и ничего не проверял. Причина: выборочный
// мерж 9a1a663 взял скрипт без его образца.
const manifest = JSON.parse(fs.readFileSync(
  path.join(root, 'toolbar/tests/fixtures/managed-runtime-card.json'), 'utf8'
));

function response(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(payload)
  };
}

function harness(replies) {
  const events = [];
  const context = {
    console,
    Promise,
    encodeURIComponent,
    fetch: (url, options) => {
      events.push({ type: 'fetch', url, options: options || {} });
      if (!replies.length) throw new Error('unexpected fetch');
      return Promise.resolve(replies.shift());
    },
    ETB: {
      api: {},
      router: { evict: (id) => events.push({ type: 'evict', id }) },
      registry: {
        install: (id) => events.push({ type: 'install', id }),
        uninstall: (id) => events.push({ type: 'uninstall', id }),
        markRemoving: (id) => events.push({ type: 'markRemoving', id }),
        clearRemoving: (id) => events.push({ type: 'clearRemoving', id }),
        removeCustom: (id) => events.push({ type: 'removeCustom', id }),
        getById: (id) => id === manifest.id ? manifest : null
      }
    }
  };
  vm.runInNewContext(source, context, { filename: 'plugins.js' });
  return { context, events };
}

async function main() {
  {
    const { context, events } = harness([
      response(200, { controlToken: 'test-control-token' }),
      response(200, { status: 'installed', pluginId: manifest.id })
    ]);
    await context.ETB.plugins.provision(manifest, 'install');
    assert(events.some((event) => event.type === 'install' && event.id === manifest.id));
    const post = events.filter((event) => event.type === 'fetch')[1];
    assert.strictEqual(post.url, `http://127.0.0.1:8799/api/plugins/${manifest.id}/install`);
    assert.strictEqual(post.options.headers['X-Extella-Control'], 'test-control-token');
    assert.strictEqual(post.options.method, 'POST');
  }

  {
    const { context, events } = harness([
      response(200, { controlToken: 'test-control-token' }),
      response(409, { status: 'error', message: 'smoke failed' })
    ]);
    await assert.rejects(
      context.ETB.plugins.provision(manifest, 'install'),
      /smoke failed/
    );
    assert(!events.some((event) => event.type === 'install'));
  }

  {
    const { context, events } = harness([
      response(200, { controlToken: 'test-control-token' }),
      response(200, { status: 'uninstalled', pluginId: manifest.id })
    ]);
    await context.ETB.plugins.unprovision(manifest);
    assert(events.findIndex((event) => event.type === 'markRemoving') <
      events.findIndex((event) => event.type === 'removeCustom'));
    assert(events.some((event) => event.type === 'evict' && event.id === manifest.id));
  }

  {
    const { context, events } = harness([
      response(200, { controlToken: 'test-control-token' }),
      response(409, { status: 'error', message: 'ownership mismatch' })
    ]);
    await assert.rejects(context.ETB.plugins.unprovision(manifest), /ownership mismatch/);
    assert(events.some((event) => event.type === 'clearRemoving'));
    assert(!events.some((event) => event.type === 'removeCustom'));
  }

  {
    const { context, events } = harness([
      response(200, { status: 'ok', plugins: [{ id: manifest.id, installed: true }] })
    ]);
    await context.ETB.plugins.syncManaged();
    assert(events.some((event) => event.type === 'install' && event.id === manifest.id));
  }

  {
    const { context, events } = harness([
      response(200, { controlToken: 'test-control-token' }),
      response(200, { status: 'ok', service: { id: manifest.id, status: 'running', pid: 321 } })
    ]);
    const service = await context.ETB.plugins.controlManaged(manifest, 'start');
    assert.strictEqual(service.pid, 321);
    const post = events.filter((event) => event.type === 'fetch')[1];
    assert.strictEqual(post.url, `http://127.0.0.1:8799/api/services/${manifest.id}/start`);
    assert.strictEqual(post.options.headers['X-Extella-Control'], 'test-control-token');
  }

  process.stdout.write('toolbar managed runtime lifecycle: passed\n');
}

main().catch((error) => {
  process.stderr.write(`toolbar managed runtime lifecycle failed: ${error.stack || error}\n`);
  process.exit(1);
});
