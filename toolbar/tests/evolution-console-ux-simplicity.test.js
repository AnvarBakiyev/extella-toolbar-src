'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const toolbarRoot = path.resolve(__dirname, '..');
const consoleHtmlPath = path.join(
  toolbarRoot,
  'plugins',
  'scenarios',
  'evolution-console.html',
);
const consoleHtml = fs.readFileSync(consoleHtmlPath, 'utf8');

function regexEscape(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function openingTags(source = consoleHtml, tagName = '[a-z][\\w:-]*') {
  return [...source.matchAll(new RegExp(`<${tagName}\\b[^>]*>`, 'gi'))]
    .map((match) => ({
      source: match[0],
      index: match.index,
    }));
}

function attribute(tag, name) {
  const match = tag.match(new RegExp(
    `\\b${regexEscape(name)}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    'i',
  ));
  return match ? (match[1] ?? match[2] ?? match[3]) : null;
}

function hasAttribute(tag, name) {
  return new RegExp(
    `(?:\\s|^)${regexEscape(name)}(?:\\s*=|\\s|>)`,
    'i',
  ).test(tag);
}

function normalized(value) {
  return String(value).replace(/\s+/g, ' ').trim();
}

function viewTags() {
  return openingTags(consoleHtml, 'section')
    .filter((tag) => attribute(tag.source, 'data-evolution-view'));
}

function viewSource(viewName) {
  const views = viewTags();
  const position = views.findIndex(
    (tag) => attribute(tag.source, 'data-evolution-view') === viewName,
  );
  assert.notEqual(position, -1, `missing ${viewName} Evolution view`);
  const start = views[position].index;
  const end = views[position + 1]?.index ?? consoleHtml.length;
  return consoleHtml.slice(start, end);
}

function languageBlock(language, nextLanguage) {
  const i18nStart = consoleHtml.indexOf('var I18N');
  assert.notEqual(i18nStart, -1, 'I18N dictionary must be present');
  const source = consoleHtml.slice(i18nStart);
  const startMatch = new RegExp(`\\b${language}\\s*:\\s*\\{`).exec(source);
  assert.ok(startMatch, `missing ${language} I18N dictionary`);
  const start = startMatch.index + startMatch[0].length;
  if (!nextLanguage) {
    const end = source.indexOf('function t(', start);
    assert.notEqual(end, -1, `cannot find the end of ${language} dictionary`);
    return source.slice(start, end);
  }
  const endMatch = new RegExp(`\\b${nextLanguage}\\s*:\\s*\\{`)
    .exec(source.slice(start));
  assert.ok(endMatch, `cannot find the end of ${language} dictionary`);
  return source.slice(start, start + endMatch.index);
}

function copyValue(block, key) {
  const match = new RegExp(
    `\\b${regexEscape(key)}\\s*:\\s*(['"])(.*?)\\1`,
    's',
  ).exec(block);
  assert.ok(match, `missing I18N key ${key}`);
  return normalized(match[2]);
}

test('Evolution Console opens with one-line summary and automation cards only', () => {
  const views = viewTags();
  assert.ok(views.length >= 2, 'overview must remain separate from deeper views');

  const defaults = views.filter(
    (tag) => attribute(tag.source, 'data-default-view') === 'true',
  );
  assert.equal(defaults.length, 1, 'exactly one view must be the default');
  assert.equal(
    attribute(defaults[0].source, 'data-evolution-view'),
    'overview',
  );
  assert.equal(
    defaults[0].index,
    views[0].index,
    'overview must be the first view in the document',
  );

  const overview = viewSource('overview');
  const regions = openingTags(overview)
    .map((tag) => ({
      name: attribute(tag.source, 'data-overview-region'),
      index: tag.index,
    }))
    .filter((region) => region.name);
  assert.deepEqual(
    regions.map((region) => region.name),
    ['summary', 'registry'],
    'the first view must answer only: what is running and which automations exist',
  );
  assert.doesNotMatch(overview, /\bid\s*=\s*(['"])attentionSection\1/i);
  assert.doesNotMatch(overview, /\bdata-attention-list\b/i);
  assert.doesNotMatch(overview, /<table\b/i);
  assert.match(
    overview,
    /<div\b[^>]*class="automation-list"[^>]*id="fleetRows"[^>]*role="list"/i,
  );
});

test('the product exposes exactly Evolution Console and Evolution Lab as primary surfaces', () => {
  const surfaces = openingTags(consoleHtml).filter(
    (tag) => attribute(tag.source, 'data-primary-surface'),
  );
  assert.equal(surfaces.length, 2);
  assert.deepEqual(
    surfaces.map((tag) => attribute(tag.source, 'data-primary-surface')),
    ['console', 'lab'],
  );

  const consoleSurface = surfaces[0];
  assert.match(consoleSurface.source, /^<button\b/i);
  assert.equal(attribute(consoleSurface.source, 'data-view'), 'fleet');

  const labSurface = surfaces[1];
  assert.match(labSurface.source, /^<button\b/i);
  assert.equal(attribute(labSurface.source, 'data-view'), 'lab');
  assert.match(
    consoleHtml,
    /<section class="view" id="labView" data-evolution-view="lab">/,
  );
  const labButtonEnd = consoleHtml.indexOf('</button>', labSurface.index);
  assert.notEqual(labButtonEnd, -1);
  assert.match(
    consoleHtml.slice(labSurface.index, labButtonEnd + '</button>'.length),
    />\s*Evolution Lab\s*<\/button>/i,
  );
});

test('installed automations are selected by default and Catalog is a peer switch', () => {
  const overview = viewSource('overview');
  const installed = openingTags(overview, 'button').find(
    (tag) => attribute(tag.source, 'data-fleet-filter') === 'installed',
  );
  const catalog = openingTags(overview, 'button').find(
    (tag) => attribute(tag.source, 'data-fleet-filter') === 'catalog',
  );
  assert.ok(installed, 'My automations switch is required');
  assert.ok(catalog, 'Catalog switch is required');
  assert.match(installed.source, /\bclass="[^"]*\bon\b[^"]*"/i);
  assert.equal(attribute(installed.source, 'aria-pressed'), 'true');
  assert.equal(attribute(catalog.source, 'aria-pressed'), 'false');

  const selectedInstalled = openingTags(overview, 'option').find(
    (tag) => (
      attribute(tag.source, 'value') === 'installed'
      && hasAttribute(tag.source, 'selected')
    ),
  );
  assert.ok(selectedInstalled, 'installed must be the native default filter');
  assert.match(
    consoleHtml,
    /el\('filterSelect'\)\.value='installed'/,
    'account reset must restore the safe installed default',
  );
});

test('tablet navigation receives a full flex row', () => {
  assert.match(
    consoleHtml,
    /@media\s*\(\s*max-width\s*:\s*1000px\s*\)[\s\S]{0,350}\.tabs\s*\{[^}]*\bflex\s*:\s*1\s+0\s+100%/,
    'the navigation must not collapse beside the brand at tablet widths',
  );
});

test('the one-line summary counts installed automations, not discrepancy categories', () => {
  const overview = viewSource('overview');
  for (const id of ['countWorking', 'countNotRunning', 'countAttention']) {
    assert.match(overview, new RegExp(`\\bid="${id}"`));
  }

  const fleetStart = consoleHtml.indexOf('function renderFleet()');
  const fleetEnd = consoleHtml.indexOf('function statusMark(', fleetStart);
  assert.ok(fleetStart >= 0 && fleetEnd > fleetStart);
  const renderFleet = consoleHtml.slice(fleetStart, fleetEnd);
  assert.match(
    renderFleet,
    /installedRows\.filter\(function\(row\)\{return automationOperationalStatus\(row\)==='WORKING';\}\)\.length/,
  );
  assert.match(
    renderFleet,
    /installedRows\.filter\(function\(row\)\{return automationOperationalStatus\(row\)==='NOT_RUNNING';\}\)\.length/,
  );
  assert.match(
    renderFleet,
    /installedRows\.filter\(automationNeedsAttention\)\.length/,
  );
  assert.doesNotMatch(
    renderFleet,
    /attentionCategoryCount\(\)/,
    'the human count must not count engineering discrepancy categories',
  );
});

test('native automation cards hide machine enums in their closed summary', () => {
  const cardStart = consoleHtml.indexOf('function renderAutomationCard(row)');
  const cardEnd = consoleHtml.indexOf('function renderFleet()', cardStart);
  assert.ok(cardStart >= 0 && cardEnd > cardStart);
  const cardRenderer = consoleHtml.slice(cardStart, cardEnd);
  assert.match(
    cardRenderer,
    /return '<details class="automation-card"[^']*data-registry-row=/,
  );
  assert.doesNotMatch(
    cardRenderer.match(/<summary[\s\S]*?<\/summary>/)?.[0] || '',
    /\b(?:WORKING|STATE_UNAVAILABLE|NOT_RUNNING|dead_reference|installed_stale)\b/,
    'closed card copy must contain human language only',
  );
  assert.doesNotMatch(
    cardRenderer.match(/return '<details class="automation-card"[\s\S]*?';/)?.[0] || '',
    /<details class="automation-card"[^>]*\bopen\b/,
    'automation cards must be collapsed by default',
  );
  assert.match(cardRenderer, /data-automation-state-summary=/);
  assert.match(cardRenderer, /automationCardLine\(row\)/);
  assert.match(
    cardRenderer,
    /flags\.installed==='UNKNOWN'\?'installationUnknown':'installedNo'/,
    'an unknown installation fact must not be presented as not installed',
  );
  assert.match(
    consoleHtml,
    /if\(installed==='UNKNOWN'\)return \{status:'UNKNOWN',kind:'warn',mark:'⚠',label:t\('installationUnknown'\)\}/,
  );
});

test('opening a card reveals all four B4 facts and then collapsed technical evidence', () => {
  const cardStart = consoleHtml.indexOf('function renderAutomationCard(row)');
  const cardEnd = consoleHtml.indexOf('function renderFleet()', cardStart);
  const cardRenderer = consoleHtml.slice(cardStart, cardEnd);
  const summaryEnd = cardRenderer.indexOf('</summary>');
  assert.ok(summaryEnd > 0);
  assert.match(
    cardRenderer,
    /stateContent=flags\.installed===true\?renderAutomationState\(row\)/,
  );
  assert.ok(
    cardRenderer.indexOf("'+stateContent+'") > summaryEnd,
    'state facts must be reachable only after opening the card',
  );
  assert.ok(
    cardRenderer.indexOf('renderAutomationTechnical(row)') > summaryEnd,
    'technical evidence must be below the card summary',
  );

  const stateStart = consoleHtml.indexOf('function renderAutomationState(row)');
  const stateEnd = consoleHtml.indexOf(
    'function scheduleOperationalPresentation(',
    stateStart,
  );
  assert.ok(stateStart >= 0 && stateEnd > stateStart);
  const stateRenderer = consoleHtml.slice(stateStart, stateEnd);
  for (const field of [
    'active_version',
    'last_run',
    'last_result',
    'last_error',
  ]) {
    assert.match(stateRenderer, new RegExp(`data-state-field="${field}"`));
  }
  assert.match(stateRenderer, /stateCheckUnavailableText/);
  assert.doesNotMatch(
    stateRenderer,
    /enabled\s*\?\s*['"]WORKING/,
    'the UI must not infer working from a cached boolean',
  );

  const technicalStart = consoleHtml.indexOf(
    'function renderAutomationTechnical(row)',
  );
  const technicalEnd = consoleHtml.indexOf(
    'function renderAutomationCard(row)',
    technicalStart,
  );
  const technicalRenderer = consoleHtml.slice(technicalStart, technicalEnd);
  assert.match(
    technicalRenderer,
    /<details class="technical-details" data-technical-details="collapsed">/,
  );
  assert.doesNotMatch(
    technicalRenderer,
    /<details class="technical-details"[^>]*\bopen\b/,
  );
});

test('automation action evidence is text-only while fail-closed reasons remain', () => {
  const actionsStart = consoleHtml.indexOf(
    'function renderAutomationActionGates(row)',
  );
  const actionsEnd = consoleHtml.indexOf(
    'function renderAutomationComposition(row)',
    actionsStart,
  );
  assert.ok(actionsStart >= 0 && actionsEnd > actionsStart);
  const actionRenderer = consoleHtml.slice(actionsStart, actionsEnd);
  assert.match(actionRenderer, /actionGateMessage\(gate,status\)/);
  assert.match(actionRenderer, /data-action-gate=/);
  assert.doesNotMatch(actionRenderer, /<button\b|\bdisabled\b/);
  assert.doesNotMatch(consoleHtml, /data-automation-action=/);
});

test('schedule cards keep two machine-readable axes behind human copy', () => {
  const scheduleStart = consoleHtml.indexOf('function renderScheduleItem(item)');
  const scheduleEnd = consoleHtml.indexOf(
    'function componentArrays(',
    scheduleStart,
  );
  assert.ok(scheduleStart >= 0 && scheduleEnd > scheduleStart);
  const scheduleRenderer = consoleHtml.slice(scheduleStart, scheduleEnd);
  assert.match(scheduleRenderer, /data-schedule-operational=/);
  assert.match(scheduleRenderer, /data-schedule-reference=/);
  assert.match(
    scheduleRenderer,
    /<details class="technical-details"><summary>/,
    'raw schedule states belong behind progressive disclosure',
  );
  const referenceStart = consoleHtml.indexOf(
    'function scheduleReferencePresentation(item)',
  );
  const referenceEnd = consoleHtml.indexOf(
    'function renderScheduleItem(item)',
    referenceStart,
  );
  const referenceRenderer = consoleHtml.slice(referenceStart, referenceEnd);
  assert.match(
    referenceRenderer,
    /status==='MISSING'[\s\S]{0,120}label:t\('scheduleMissingHuman'\)/,
  );
  assert.doesNotMatch(referenceRenderer, /label:'dead_reference/);
});

test('automation cards remain cards on mobile', () => {
  const mobileBreakpoint = consoleHtml.match(
    /@media\s*\(\s*max-width\s*:\s*700px\s*\)\s*\{([\s\S]*?)\n\s*\}/,
  );
  assert.ok(mobileBreakpoint, 'the mobile breakpoint must be present');
  const mobileCss = normalized(mobileBreakpoint[1]);
  assert.match(
    mobileCss,
    /\.automation-card>summary\s*\{\s*grid-template-columns\s*:\s*1fr auto\s*\}/,
  );
  assert.match(
    mobileCss,
    /\.technical-grid\s*\{\s*grid-template-columns\s*:\s*1fr\s*\}/,
  );
});

test('Agent Cabinet is available only from collapsed automation composition', () => {
  const componentStart = consoleHtml.indexOf('function renderComponentGroup(');
  const componentEnd = consoleHtml.indexOf(
    'function actionGateMessage(',
    componentStart,
  );
  const componentRenderer = consoleHtml.slice(componentStart, componentEnd);
  assert.match(componentRenderer, /data-action="open-agent-cabinet"/);

  const compositionStart = consoleHtml.indexOf(
    'function renderAutomationComposition(row)',
  );
  const compositionEnd = consoleHtml.indexOf(
    'function renderAutomationRisks(',
    compositionStart,
  );
  const compositionRenderer = consoleHtml.slice(
    compositionStart,
    compositionEnd,
  );
  assert.match(
    compositionRenderer,
    /<details class="composition" data-internal-agents="collapsed">/,
  );
  assert.doesNotMatch(
    compositionRenderer,
    /<details class="composition"[^>]*\bopen\b/,
  );
  assert.equal(
    (consoleHtml.match(/data-action="open-agent-cabinet"/g) || []).length,
    1,
    'Agent Cabinet CTA must not leak into the card summary or top navigation',
  );
  assert.match(
    consoleHtml,
    /\[data-cab\][\s\S]{0,300}openCabinet\(/,
    'the Agent Cabinet CTA must remain wired to the canonical cabinet',
  );

  const loadStart = consoleHtml.indexOf('async function loadFleet()');
  const loadEnd = consoleHtml.indexOf(
    'function ensureLegacyFleet()',
    loadStart,
  );
  assert.ok(loadStart >= 0 && loadEnd > loadStart);
  assert.match(
    consoleHtml.slice(loadStart, loadEnd),
    /applyAutomationRegistryResult\(result\)[\s\S]{0,160}ensureLegacyFleet\(\)/,
    'the ordinary automation-card path must load the canonical Cabinet projection',
  );
});

test('successful Cabinet escalation closes accessibly and focuses its result', () => {
  const start = consoleHtml.indexOf(
    'async function acceptCabinetEscalation(',
  );
  const end = consoleHtml.indexOf('async function runEscAction(', start);
  assert.ok(start >= 0 && end > start, 'Cabinet escalation handler is required');
  const handler = consoleHtml.slice(start, end);
  assert.match(handler, /\bcloseCabinet\(\)/);
  assert.match(handler, /await\s+refreshAfterMutation\(\s*['"]escalation['"]/);
  assert.match(handler, /el\(\s*['"]escalationsView['"]\s*\)\.focus\(/);
  assert.doesNotMatch(
    handler,
    /cabinetOverlay['"]\)\.classList\.remove/,
    'the success path must not bypass focus restoration',
  );
});

test('the simplified overview has matching human copy in Russian and English', () => {
  const ru = languageBlock('ru', 'en');
  const en = languageBlock('en');
  const copyContract = {
    overviewTitle: ['Ваши автоматизации', 'Your automations'],
    inventory: ['Автоматизации', 'Automations'],
    myAutomations: ['Мои автоматизации', 'My automations'],
    catalog: ['Каталог', 'Catalog'],
    workingCount: ['работают', 'working'],
    notRunningCount: ['не запущены', 'not running'],
    attentionCount: ['требуют внимания', 'need attention'],
    openAutomation: ['Открыть', 'Open'],
    reviewAutomation: ['Разобраться', 'Review'],
    openCabinet: ['Открыть Agent Cabinet', 'Open Agent Cabinet'],
    automationWorking: ['Работает', 'Working'],
    automationStateUnavailable: [
      'Не удалось проверить состояние',
      'Couldn’t check status',
    ],
    automationNotRunning: ['Не запущена', 'Not running'],
    scheduleNone: ['Расписания нет', 'No schedule'],
    scheduleMissingHuman: [
      'Расписание не найдено.',
      'Schedule could not be found.',
    ],
    actionStateRequired: [
      'Действия временно недоступны: сначала нужно проверить состояние автоматизации.',
      'Actions are temporarily unavailable until the automation’s status can be checked.',
    ],
  };

  for (const [key, [ruValue, enValue]] of Object.entries(copyContract)) {
    assert.equal(copyValue(ru, key), ruValue, `unexpected RU copy for ${key}`);
    assert.equal(copyValue(en, key), enValue, `unexpected EN copy for ${key}`);
  }
});
