#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const buildScript = path.join(root, 'toolbar', 'build.js');
const artifact = path.join(root, 'toolbar', 'build', 'toolbar.js');

function buildAndHash() {
  execFileSync(process.execPath, [buildScript], { cwd: path.dirname(buildScript), stdio: 'ignore' });
  return crypto.createHash('sha256').update(fs.readFileSync(artifact)).digest('hex');
}

const first = buildAndHash();
const second = buildAndHash();
if (first !== second) {
  process.stderr.write(`toolbar reproducibility failed: ${first} != ${second}\n`);
  process.exit(1);
}
process.stdout.write(`toolbar reproducibility: passed (${first})\n`);
