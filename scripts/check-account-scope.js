#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const forbidden = [
  'agent_extella_default',
  'agent_extella_alibaba_default',
];
const inputs = [
  path.join(root, 'toolbar', 'src'),
  path.join(root, 'toolbar', 'public'),
  path.join(root, 'modules', 'library', 'src'),
  path.join(root, 'toolbar', 'toolbar.js'),
  path.join(root, 'HANDOFF', 'toolbar.js'),
];

function files(target) {
  const stat = fs.statSync(target);
  if (stat.isFile()) return [target];
  return fs.readdirSync(target, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(target, entry.name);
    return entry.isDirectory() ? files(child) : entry.isFile() ? [child] : [];
  });
}

const failures = [];
for (const input of inputs) {
  for (const file of files(input)) {
    const text = fs.readFileSync(file, 'utf8');
    for (const value of forbidden) {
      if (text.includes(value)) failures.push(`${path.relative(root, file)}: ${value}`);
    }
  }
}
if (failures.length) {
  process.stderr.write(`account-scope portability failed:\n${failures.join('\n')}\n`);
  process.exit(1);
}

const api = fs.readFileSync(path.join(root, 'toolbar', 'src', 'core', 'api.js'), 'utf8');
if (!api.includes("_post('/api/agent/list', {})") || !api.includes("var BOOTSTRAP_AGENT_SCOPE = 'agent_XXXXXXXX'")) {
  process.stderr.write('account-scope portability failed: dynamic current-account resolution contract is missing\n');
  process.exit(1);
}
process.stdout.write('account-scope portability: passed\n');
