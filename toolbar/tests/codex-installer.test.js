'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');

const toolbarRoot = path.resolve(__dirname, '..');
const installerPath = path.join(
  toolbarRoot,
  'src',
  'core',
  'codex-installer.js',
);
const marketplacePath = path.join(
  toolbarRoot,
  'src',
  'panels',
  'marketplace.js',
);
const storefrontPath = path.join(
  toolbarRoot,
  'public',
  'plugins_manager.html',
);

const installerSource = fs.readFileSync(installerPath, 'utf8');
const marketplaceSource = fs.readFileSync(marketplacePath, 'utf8');
const storefrontSource = fs.readFileSync(storefrontPath, 'utf8');

function loadInstaller() {
  const context = { ETB: {} };
  vm.runInNewContext(installerSource, context, {
    filename: 'codex-installer.js',
  });
  return context.ETB.codexInstaller;
}

test('Codex installer Expert is pinned, syntactically valid, and non-model', () => {
  const installer = loadInstaller();
  const code = installer.expertCode();
  const metadata = installer.metadata();
  const actualHash = crypto.createHash('sha256').update(code).digest('hex');

  assert.equal(metadata.expertName, '_etb_codex_setup_v1');
  assert.equal(metadata.pluginVersion, '0.3.2');
  assert.equal(metadata.standardsRef, 'v0.1.0');
  assert.equal(metadata.expertSha256, actualHash);
  assert.match(code, /BUILDER_REF = "v0\.3\.2"/);
  assert.match(code, /STANDARDS_REF = "v0\.1\.0"/);
  assert.match(code, /"model_called": False/);
  assert.match(code, /"agent_called": False/);
  assert.match(code, /"paid": False/);
  assert.match(code, /shell=False/);
  assert.doesNotMatch(code, /shell=True/);
  assert.doesNotMatch(code, /\/api\/agent\/run/);
  assert.doesNotMatch(code, /codex", "exec"/);

  const syntax = spawnSync(
    'python3',
    ['-c', 'import sys; compile(sys.stdin.read(), "<expert>", "exec")'],
    { input: code, encoding: 'utf8' },
  );
  assert.equal(syntax.status, 0, syntax.stderr);
});

test('host bridge pins the installer and current target instead of accepting commands', () => {
  assert.match(marketplaceSource, /e\.data\.type === 'etb_codex_install'/);
  assert.match(
    marketplaceSource,
    /e\.source !== _cf\.contentWindow/,
  );
  assert.match(
    marketplaceSource,
    /ETB\.codexInstaller\.install/,
  );
  assert.doesNotMatch(
    marketplaceSource,
    /etb_codex_install[\s\S]{0,600}e\.data\.(name|command|target|token)/,
  );

  const installer = loadInstaller();
  const source = installerSource;
  assert.match(source, /window\.extellaDesktop\.getDeviceID/);
  assert.match(source, /target: deviceId/);
  assert.match(source, /ETB\.api\.getExpert\(EXPERT_NAME, \{ global: false \}\)/);
  assert.match(source, /_readExpertCode\(readback\) !== EXPERT_CODE/);
});

test('storefront exposes a sibling Codex button and explicit consent states', () => {
  const claudeAt = storefrontSource.indexOf('onclick="claudeConnectModal()"');
  const codexAt = storefrontSource.indexOf('onclick="codexConnectModal()"');
  const automationAt = storefrontSource.indexOf('id="autoBtn"');

  assert.ok(claudeAt >= 0);
  assert.ok(codexAt > claudeAt);
  assert.ok(automationAt > codexAt);
  assert.match(storefrontSource, /Подключить Codex/);
  assert.match(storefrontSource, /Стоимость: 0 кредитов Extella/);
  assert.match(storefrontSource, /Live-вызовы Codex не включаются/);
  assert.match(storefrontSource, /etb_codex_install_progress/);
  assert.match(storefrontSource, /etb_codex_install_result/);
  assert.match(
    storefrontSource,
    new RegExp(loadInstaller().metadata().expertSha256),
  );
});
