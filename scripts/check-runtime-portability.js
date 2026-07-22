#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const artifacts = [
  path.join(root, 'toolbar', 'build', 'toolbar.js'),
  path.join(root, 'toolbar', 'toolbar.js'),
  path.join(root, 'HANDOFF', 'toolbar.js'),
];
const retiredInstaller = path.join(root, 'install.sh');
const retiredInstallerMarker = 'EXTELLA_STANDALONE_INSTALLER_RETIRED=1';
const retiredPaths = [
  'device/activity-center/bridge',
  'device/activity-center/instrumentation',
  'device/activity-center/install.py',
  'device/activity-center/uninstall.py',
  'device/boot',
  'toolbar/src/core/install-prompt.js',
];
const forbidden = [
  '~/extella-plugins',
  '/tmp/etb_',
  '~/.extella/api_token',
  '~/.nvm',
  '/opt/homebrew',
  '/usr/local/bin',
  'kill -9',
  'os.kill(',
  'ETB.installPrompt =',
  'CRITICAL — ACT IMMEDIATELY',
  'raw.githubusercontent.com/AnvarBakiyev/extella-marketplace-pack/main',
  "label:'Работает'",
  "label:'С GitHub'",
];

const failures = [];
for (const file of artifacts) {
  if (!fs.existsSync(file)) {
    failures.push(`${path.relative(root, file)}: artifact is missing`);
    continue;
  }
  const source = fs.readFileSync(file, 'utf8');
  for (const value of forbidden) {
    if (source.includes(value)) failures.push(`${path.relative(root, file)}: ${value}`);
  }
}

if (!fs.existsSync(retiredInstaller)) {
  failures.push('install.sh: retirement stub is missing');
} else {
  const source = fs.readFileSync(retiredInstaller, 'utf8');
  if (!source.includes(retiredInstallerMarker)) {
    failures.push('install.sh: standalone installer is not fail-closed');
  }
  for (const value of [
    'api_token.txt',
    'device/activity-center/install.py',
    'device/boot',
    'npm install -g',
    'git clone',
    'read -p',
    'shell=True',
  ]) {
    if (source.includes(value)) failures.push(`install.sh: retired installer contains ${value}`);
  }
}

for (const value of retiredPaths) {
  if (fs.existsSync(path.join(root, value))) {
    failures.push(`${value}: duplicate device runtime or installer must not exist`);
  }
}

const build = fs.readFileSync(path.join(root, 'toolbar', 'build.js'), 'utf8');
if (build.includes("'install-prompt.js'")) {
  failures.push('toolbar/build.js: unverified autonomous installer is in the release module list');
}

if (failures.length) {
  process.stderr.write(`toolbar runtime portability failed:\n${failures.join('\n')}\n`);
  process.exit(1);
}
process.stdout.write('toolbar runtime portability: passed\n');
