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

function collectJsonFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...collectJsonFiles(file));
    else if (entry.isFile() && entry.name.endsWith('.json')) files.push(file);
  }
  return files;
}

function readManifestAsset(manifestFile, relativePath, label) {
  const resolved = path.resolve(path.dirname(manifestFile), String(relativePath || ''));
  const rootPrefix = path.resolve(pluginRoot) + path.sep;
  const rootRealPrefix = fs.realpathSync(pluginRoot) + path.sep;
  if (!resolved.startsWith(rootPrefix)) {
    fail(`${path.relative(pluginRoot, manifestFile)}: ${label} escapes toolbar/plugins`);
    return '';
  }
  if (!fs.existsSync(resolved)) {
    fail(`${path.relative(pluginRoot, manifestFile)}: ${label} is missing`);
    return '';
  }
  const real = fs.realpathSync(resolved);
  if (!real.startsWith(rootRealPrefix)) {
    fail(`${path.relative(pluginRoot, manifestFile)}: ${label} symlink escapes toolbar/plugins`);
    return '';
  }
  return fs.readFileSync(real, 'utf8');
}

// Карточка — это объект С ПОЛЕМ mode. Раньше гейт считал карточкой ЛЮБОЙ .json под
// toolbar/plugins и требовал id/mode/trust_tier от файлов данных: так публикуемый
// бандл стандартов Console давал четыре красных строки подряд, ни одна из которых не
// была дефектом. Проверяем свойство, а не расположение файла.
const manifests = collectJsonFiles(pluginRoot)
  .sort()
  .map((file) => ({
    file,
    name: path.relative(pluginRoot, file),
    value: JSON.parse(fs.readFileSync(file, 'utf8'))
  }))
  .filter(({ value }) => value && typeof value === 'object' && typeof value.mode === 'string');
const byId = new Map();
const expertNames = new Set();
const managedIds = new Set();
const managedPorts = new Set();
// РЕШЕНИЕ АНВАРА 30.07 по продуктовому контракту ветки feat/client-stability:
//   • ПРИНЯТ пункт «метки доверия» — карточка обязана называть, кто за неё отвечает;
//     проверки ниже обязательны, потому что 89 из 111 карточек комплекта непроверенные,
//     а когда карточки кладут многие, «кто это проверял» — главный вопрос человека.
//   • ОТКЛОНЕНЫ пункты «установка/удаление через отдельный установщик каталога» и
//     «карточки managed_runtime»: обе задачи мы решили своим путём (гейт паспорта на
//     входе и честная деградация), а держать две механики одного и того же дороже,
//     чем не иметь второй. Проверки удалены, а не спрятаны: гейт не должен помнить
//     отклонённое — иначе он снова станет непроходимым.
// Сам код отклонённой части жив в origin/feat/client-stability — ветку не удалять.
for (const { file, name, value } of manifests) {
  const basename = path.basename(name, '.json');
  const expectedId = value.mode === 'scenario' ? `${basename}-scenario` : basename;
  if (!value.id || value.id !== expectedId) fail(`${name}: id must match filename and mode`);
  if (byId.has(value.id)) fail(`${name}: duplicate plugin id ${value.id}`);
  byId.set(value.id, value);
  if (!['llm_driven', 'form_driven', 'managed_runtime', 'scenario'].includes(value.mode)) fail(`${name}: unsupported mode ${value.mode}`);
  if (!['verified', 'unverified', 'candidate'].includes(value.trust_tier)) fail(`${name}: trust_tier is required`);
  if (!['managed_runtime', 'scenario'].includes(value.mode) && (!Array.isArray(value.conceptTexts) || !value.conceptTexts.length)) fail(`${name}: conceptTexts are required`);
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
  if (value.mode === 'scenario') {
    if (value.trust_tier !== 'verified') fail(`${name}: scenario must be verified`);
    if (!value.ui || value.ui.type !== 'html' || value.ui.tokenless !== true) fail(`${name}: scenario must use tokenless reviewed HTML`);
    if (value.owned_experts !== true) fail(`${name}: scenario must declare ownership of its namespaced Experts`);
    const html = value.ui && value.ui.htmlFile
      ? readManifestAsset(file, value.ui.htmlFile, 'ui.htmlFile')
      : String(value.ui && value.ui.html || '');
    if (!html || !html.includes('etb_ui_health')) fail(`${name}: scenario UI has no toolbar health marker`);
    if (!(value.capabilities || []).length) fail(`${name}: scenario has no declared capabilities`);
    if ((value.capabilities || []).some((capability) => capability.external_writes !== false)) {
      fail(`${name}: scenario capability must explicitly disable external writes`);
    }
  }
  const defs = value.expert_defs || [];
  if (['form_driven', 'scenario'].includes(value.mode) && !defs.length) fail(`${name}: executable card has no authored expert`);
  for (const def of defs) {
    if (!def.name || !/^[A-Za-z_][A-Za-z0-9_]{1,127}$/.test(def.name)) fail(`${name}: invalid expert name`);
    if (expertNames.has(def.name)) fail(`${name}: duplicate authored expert ${def.name}`);
    expertNames.add(def.name);
    if (value.mode === 'scenario') {
      const scenarioExpertPrefix = value.id === 'capability-studio-scenario'
        ? 'xtl_capability_studio_'
        : value.id === 'profit-growth-scenario'
          ? '_etb_evolution_'
          : '';
      if (!scenarioExpertPrefix || !def.name.startsWith(scenarioExpertPrefix)) {
        fail(`${name}: scenario Expert must use its reviewed product namespace`);
      }
    }
    const code = def.codeFile
      ? readManifestAsset(file, def.codeFile, 'expert_defs[].codeFile')
      : (Array.isArray(def.code) ? def.code.join('\n') : String(def.code || ''));
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

const cli = block('var CLI_CATALOG=[', '\n];\nvar CLI_ACC');
const cliIds = idsFrom(cli);
const expectedCli = ['ghostscript', 'pandoc', 'ocr', 'libreoffice', 'qpdf', 'imagemagick', 'ffmpeg'];
if (JSON.stringify(cliIds) !== JSON.stringify(expectedCli)) fail(`CLI catalogue changed without contract update: ${cliIds.join(',')}`);
// Инструменты ставятся резолверами через brew — в Windows его нет ни для одного из
// семи. Витрина обязана не обещать там установку; проверяем НЕ поле в данных (его
// формат — часть непринятого контракта), а сам факт защиты в коде карточки.
if (!html.includes('function _cliOnThisOS()') || !html.includes('Недоступно в Windows')) {
  fail('CLI cards promise an install on Windows, where the package manager does not exist');
}

const skills = block('var SKILLS_CATALOG=[', '\n];\nvar SK_ACC');
const skillIds = idsFrom(skills);
if (skillIds.length !== 12 || new Set(skillIds).size !== skillIds.length) fail(`skills contract expected 12 unique cards, got ${skillIds.length}`);

const models = block('var LOCAL_MODELS = [', '\n];\nfunction localModelCard');
const modelIds = idsFrom(models);
if (modelIds.length !== 6 || new Set(modelIds).size !== modelIds.length) fail(`local-model contract expected 6 unique cards, got ${modelIds.length}`);

const installCli = block('function installCLI(tool,btn){', '\n}\n\n// ── Storefront modes');
if (!html.includes("name:'cap_localmodel_install'")) fail('local models have no bundled installer route');
if (!html.includes('Стороннее · не проверено')) fail('unverified catalogue cards are not labelled');
if (!html.includes('Кандидат Extella · проверяется')) fail('managed candidate cards are not honestly labelled');
if (!bridge.includes("action === 'install_featured'") || !bridge.includes("ETB.plugins.provision(plugin, 'install')")) fail('curated plugin provisioning bridge is missing');
const pluginsSource = fs.readFileSync(path.join(root, 'toolbar', 'src', 'core', 'plugins.js'), 'utf8');
if (!pluginsSource.includes("'/api/plugins/'") || !pluginsSource.includes("'X-Extella-Control'") || !pluginsSource.includes("manifest.mode === 'managed_runtime'")) fail('managed runtime install bridge is missing');

if (failures.length) {
  process.stderr.write(`toolbar catalog contract failed:\n${failures.join('\n')}\n`);
  process.exit(1);
}
process.stdout.write(
  `toolbar catalog contract: passed (${curatedIds.length} curated programs, ${managedIds.size} managed runtimes, ${cliIds.length} tools, ${modelIds.length} local models, ${skillIds.length} skills; ${manifests.length} bundled manifests)\n`
);
