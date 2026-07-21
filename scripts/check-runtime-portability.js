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

const build = fs.readFileSync(path.join(root, 'toolbar', 'build.js'), 'utf8');
if (build.includes("'install-prompt.js'")) {
  failures.push('toolbar/build.js: unverified autonomous installer is in the release module list');
}

if (failures.length) {
  process.stderr.write(`toolbar runtime portability failed:\n${failures.join('\n')}\n`);
  process.exit(1);
}
process.stdout.write('toolbar runtime portability: passed\n');
