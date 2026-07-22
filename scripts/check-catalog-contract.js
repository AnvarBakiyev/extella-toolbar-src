#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const htmlPath = path.join(root, 'toolbar', 'public', 'plugins_manager.html');
const bridgePath = path.join(root, 'toolbar', 'src', 'panels', 'marketplace.js');
const pluginRoot = path.join(root, 'toolbar', 'plugins');
const html = fs.readFileSync(htmlPath, 'utf8');
const bridge = fs.readFileSync(bridgePath, 'utf8');
const failures = [];

function fail(message) { failures.push(message); }
function block(start, end) {
  const from = html.indexOf(start);
  const to = html.indexOf(end, from + start.length);
  if (from < 0 || to < 0) {
    fail(`catalog source block is missing: ${start}`);
    return '';
  }
  return html.slice(from, to);
}
function idsFrom(blockText) {
  return Array.from(blockText.matchAll(/\bid\s*:\s*'([^']+)'/g), (match) => match[1]);
}

const manifests = fs.readdirSync(pluginRoot)
  .filter((name) => name.endsWith('.json'))
  .sort()
  .map((name) => ({ name, value: JSON.parse(fs.readFileSync(path.join(pluginRoot, name), 'utf8')) }));
const byId = new Map();
const expertNames = new Set();
const managedIds = new Set();
const managedPorts = new Set();
const expectedManaged = [
  'extella_adoption_wizard',
  'extella_contract_agent',
  'extella_travel_agency'
];
for (const { name, value } of manifests) {
  if (!value.id || value.id !== name.slice(0, -5)) fail(`${name}: id must match filename`);
  if (byId.has(value.id)) fail(`${name}: duplicate plugin id ${value.id}`);
  byId.set(value.id, value);
  if (!['llm_driven', 'form_driven', 'managed_runtime'].includes(value.mode)) fail(`${name}: unsupported mode ${value.mode}`);
  if (!['verified', 'unverified', 'candidate'].includes(value.trust_tier)) fail(`${name}: trust_tier is required`);
  if (value.mode !== 'managed_runtime' && (!Array.isArray(value.conceptTexts) || !value.conceptTexts.length)) fail(`${name}: conceptTexts are required`);
  if (value.mode === 'managed_runtime') {
    if (value.supportedPluginId !== value.id) fail(`${name}: supportedPluginId must match id`);
    if (value.classification !== 'supported_on_demand') fail(`${name}: managed runtime must be supported_on_demand`);
    if (value.trust_tier !== 'candidate') fail(`${name}: managed runtime must remain candidate until the external matrix passes`);
    if (!value.releaseState || value.releaseState.advertised !== false || value.releaseState.verification !== 'pending') fail(`${name}: candidate release state must be explicit`);
    if (!value.ui || value.ui.type !== 'local_server' || !Number.isInteger(value.ui.port)) fail(`${name}: managed runtime must declare a local_server port`);
    else if (managedPorts.has(value.ui.port)) fail(`${name}: duplicate managed runtime port ${value.ui.port}`);
    else managedPorts.add(value.ui.port);
    if ((value.expert_defs || []).length || (value.conceptTexts || []).length) fail(`${name}: toolbar must not provision managed runtime account resources`);
    managedIds.add(value.id);
  } else if (value.trust_tier === 'candidate') {
    fail(`${name}: candidate trust tier is reserved for release-managed runtimes`);
  }
  const defs = value.expert_defs || [];
  if (value.mode === 'form_driven' && !defs.length) fail(`${name}: form-driven card has no authored expert`);
  for (const def of defs) {
    if (!def.name || !/^[A-Za-z_][A-Za-z0-9_]{1,127}$/.test(def.name)) fail(`${name}: invalid expert name`);
    if (expertNames.has(def.name)) fail(`${name}: duplicate authored expert ${def.name}`);
    expertNames.add(def.name);
    const code = Array.isArray(def.code) ? def.code.join('\n') : String(def.code || '');
    if (!code.includes(`def ${def.name}(`)) fail(`${name}: expert ${def.name} has no matching entrypoint`);
  }
}

const curated = block('var CURATED_PROGRAMS = {', '\n};\n\nfunction programCard');
const curatedIds = Array.from(curated.matchAll(/^\s*'([^']+)'\s*:/gm), (match) => match[1]);
if (!curatedIds.length) fail('curated program catalogue is empty');
for (const id of curatedIds) {
  const manifest = byId.get(id);
  if (!manifest) fail(`curated program has no bundled manifest: ${id}`);
  else if (manifest.trust_tier !== 'verified' && manifest.mode !== 'managed_runtime') fail(`curated program is not verified: ${id}`);
}
if (JSON.stringify(Array.from(managedIds).sort()) !== JSON.stringify(expectedManaged.slice().sort())) fail(`managed runtime allowlist changed: ${Array.from(managedIds).sort().join(',')}`);

const cli = block('var CLI_CATALOG=[', '\n];\nvar CLI_ACC');
const cliIds = idsFrom(cli);
const expectedCli = ['ghostscript', 'pandoc', 'ocr', 'libreoffice', 'qpdf', 'imagemagick', 'ffmpeg'];
if (JSON.stringify(cliIds) !== JSON.stringify(expectedCli)) fail(`CLI catalogue changed without contract update: ${cliIds.join(',')}`);
for (const macOnly of ['ocr', 'libreoffice', 'qpdf']) {
  const card = cli.match(new RegExp(`\\{id:'${macOnly}'[^\\n]+`));
  if (!card || !card[0].includes("platforms:['darwin']")) fail(`${macOnly}: Windows must not advertise an unsupported installer`);
}

const skills = block('var SKILLS_CATALOG=[', '\n];\nvar SK_ACC');
const skillIds = idsFrom(skills);
if (skillIds.length !== 12 || new Set(skillIds).size !== skillIds.length) fail(`skills contract expected 12 unique cards, got ${skillIds.length}`);

const models = block('var LOCAL_MODELS = [', '\n];\nfunction localModelCard');
const modelIds = idsFrom(models);
if (modelIds.length !== 6 || new Set(modelIds).size !== modelIds.length) fail(`local-model contract expected 6 unique cards, got ${modelIds.length}`);

const installCli = block('function installCLI(tool,btn){', '\n}\n\n// ── Storefront modes');
if (!installCli.includes("name:'catalog_tool_manage'")) fail('CLI cards do not use the standalone catalog installer');
if (installCli.includes("/x/cap_install") || installCli.includes('_mkbFetch(')) fail('CLI cards still depend on the Adoption Wizard localhost');
if (!html.includes("name:'cap_localmodel_install'")) fail('local models have no bundled installer route');
if (!html.includes("name: expert, params: params") || !html.includes("catalog_capability_uninstall")) fail('catalog removal route is missing');
if (!html.includes('Стороннее · не проверено')) fail('unverified catalogue cards are not labelled');
if (!html.includes('Кандидат Extella · проверяется')) fail('managed candidate cards are not honestly labelled');
if (!bridge.includes("action === 'install_featured'") || !bridge.includes("ETB.plugins.provision(plugin, 'install')")) fail('curated plugin provisioning bridge is missing');
const pluginsSource = fs.readFileSync(path.join(root, 'toolbar', 'src', 'core', 'plugins.js'), 'utf8');
if (!pluginsSource.includes("'/api/plugins/'") || !pluginsSource.includes("'X-Extella-Control'") || !pluginsSource.includes("manifest.mode === 'managed_runtime'")) fail('managed runtime install bridge is missing');
if (!bridge.includes('ETB.plugins.unprovision(managedPlugin)') || !html.includes("e.data.type === 'etb_uninstall_result'")) fail('managed runtime uninstall confirmation bridge is missing');

if (failures.length) {
  process.stderr.write(`toolbar catalog contract failed:\n${failures.join('\n')}\n`);
  process.exit(1);
}
process.stdout.write(
  `toolbar catalog contract: passed (${curatedIds.length} curated programs, ${managedIds.size} managed runtimes, ${cliIds.length} tools, ${modelIds.length} local models, ${skillIds.length} skills; ${manifests.length} bundled manifests)\n`
);
