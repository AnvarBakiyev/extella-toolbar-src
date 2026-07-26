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

test('Evolution Console opens with overview, attention, and automation list in that order', () => {
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
    ['summary', 'attention', 'registry'],
    'the first view must answer: how many, what needs attention, who is in the fleet',
  );
});

test('the overview registry exposes no more than five visible columns', () => {
  const overview = viewSource('overview');
  const registryTable = openingTags(overview, 'table').find(
    (tag) => attribute(tag.source, 'data-evolution-registry') === 'automations',
  );
  assert.ok(registryTable, 'overview must contain the fleet registry table');

  const tableEnd = overview.indexOf('</table>', registryTable.index);
  assert.notEqual(tableEnd, -1, 'fleet registry table must be closed');
  const tableSource = overview.slice(registryTable.index, tableEnd);
  const visibleHeaders = openingTags(tableSource, 'th').filter((tag) => (
    !hasAttribute(tag.source, 'hidden')
    && attribute(tag.source, 'aria-hidden') !== 'true'
    && attribute(tag.source, 'data-column-visibility') !== 'advanced'
  ));

  assert.ok(visibleHeaders.length >= 3, 'the registry must remain useful');
  assert.ok(
    visibleHeaders.length <= 5,
    `expected at most 5 visible columns, found ${visibleHeaders.length}`,
  );

  const columns = visibleHeaders.map(
    (header) => attribute(header.source, 'data-registry-column'),
  );
  assert.ok(
    columns.every(Boolean),
    'every visible registry column needs a stable semantic marker',
  );
  assert.equal(new Set(columns).size, columns.length);
  for (const essentialColumn of ['automation', 'availability', 'composition']) {
    assert.ok(
      columns.includes(essentialColumn),
      `registry must keep its ${essentialColumn} column`,
    );
  }
});

test('attention cards expose both a destination filter and an explicit action', () => {
  const overview = viewSource('overview');
  assert.match(overview, /\bdata-attention-list\s*=\s*(['"])actionable\1/i);

  const helperStart = consoleHtml.indexOf('function attentionButton(');
  const helperEnd = consoleHtml.indexOf(
    'function renderAttention()',
    helperStart,
  );
  assert.ok(
    helperStart >= 0 && helperEnd > helperStart,
    'an attention card helper must be present',
  );
  const cardTemplate = consoleHtml.slice(helperStart, helperEnd);
  assert.match(cardTemplate, /data-attention-card/);
  assert.match(cardTemplate, /data-attention-filter/);
  assert.match(cardTemplate, /data-attention-action/);

  assert.match(
    consoleHtml,
    /(?:dataset\.attentionFilter|getAttribute\(\s*['"]data-attention-filter['"]\s*\))/,
    'attention filter contract must be wired, not decorative',
  );
  assert.match(
    consoleHtml,
    /(?:dataset\.attentionAction|getAttribute\(\s*['"]data-attention-action['"]\s*\)|querySelectorAll\(\s*['"]\[data-attention-action)/,
    'attention action contract must be wired, not decorative',
  );
});

test('advanced Evolution navigation is separate and collapsed by default', () => {
  const advancedNav = openingTags(consoleHtml, 'details').find(
    (tag) => attribute(tag.source, 'data-nav-tier') === 'advanced',
  );
  assert.ok(advancedNav, 'advanced navigation must have its own tier');
  assert.equal(
    hasAttribute(advancedNav.source, 'open'),
    false,
    'native disclosure must be collapsed by default',
  );

  const advancedEnd = consoleHtml.indexOf('</details>', advancedNav.index);
  assert.notEqual(advancedEnd, -1, 'advanced navigation must be closed');
  const advancedSource = consoleHtml.slice(advancedNav.index, advancedEnd);
  assert.match(advancedSource, /<summary\b[^>]*data-t="advanced"/i);
  for (const view of ['risks', 'bulk', 'receipts']) {
    assert.match(
      advancedSource,
      new RegExp(`\\bdata-view\\s*=\\s*(['"])${view}\\1`),
      `${view} belongs to advanced navigation`,
    );
  }
  assert.doesNotMatch(advancedSource, /\bdata-view\s*=\s*(['"])fleet\1/);
});

test('tablet navigation receives a full flex row', () => {
  assert.match(
    consoleHtml,
    /@media\s*\(\s*max-width\s*:\s*1000px\s*\)[\s\S]{0,350}\.tabs\s*\{[^}]*\bflex\s*:\s*1\s+0\s+100%/,
    'the navigation must not collapse beside the brand at tablet widths',
  );
});

test('registry rows stay concise and delegate one-agent work to Agent Cabinet', () => {
  const rowTemplates = [
    ...consoleHtml.matchAll(
      /<tr\b(?=[^>]*\bdata-registry-row\b)[\s\S]*?<\/tr>/gi,
    ),
  ].map((match) => match[0]);
  assert.ok(rowTemplates.length > 0, 'a semantic registry row must be rendered');

  const row = rowTemplates[0];
  assert.ok(
    (row.match(/<td\b/gi) || []).length <= 5,
    'a registry row must contain no more than five visible cells',
  );
  assert.doesNotMatch(
    row,
    /check_agent_passport(?:\.py)?|checkerIssues|passportSha256|sha-?256|raw[-_ ]?evidence|<pre\b|<code\b|issue\.(?:path|code)/i,
    'canonical checker details and raw evidence belong in a deeper view',
  );
  const renderStart = consoleHtml.indexOf('function renderFleet()');
  const renderEnd = consoleHtml.indexOf(
    'function statusMark(',
    renderStart,
  );
  const componentStart = consoleHtml.indexOf('function renderComponentGroup(');
  const renderFleet = consoleHtml.slice(componentStart, renderEnd);
  assert.match(
    renderFleet,
    /data-action="open-agent-cabinet"/,
    'Agent Cabinet remains the one-agent CTA',
  );

  assert.match(
    renderFleet,
    /\[data-cab\][\s\S]{0,300}openCabinet\(/,
    'the Agent Cabinet CTA must be wired to the existing cabinet',
  );
});

test('the attention metric and attention cards share one aggregation', () => {
  const overview = viewSource('overview');
  assert.match(overview, /\bdata-summary-attention\b/);
  assert.match(overview, /\bid\s*=\s*(['"])countAttention\1/);

  const attentionStart = consoleHtml.indexOf('function renderAttention()');
  const attentionEnd = consoleHtml.indexOf(
    'function geneById(',
    attentionStart,
  );
  const attentionSource = consoleHtml.slice(attentionStart, attentionEnd);
  assert.match(
    attentionSource,
    /\battentionFacts\(\)/,
    'attention cards must use the shared canonical aggregation',
  );

  const fleetStart = consoleHtml.indexOf('function renderFleet()');
  const fleetEnd = consoleHtml.indexOf('function statusMark(', fleetStart);
  const fleetSource = consoleHtml.slice(fleetStart, fleetEnd);
  assert.match(
    fleetSource,
    /countAttention['"]\)\.textContent\s*=\s*attentionCategoryCount\(\)/,
    'the metric must count the exact categories rendered below it',
  );
});

test('the fleet registry becomes labelled cards on mobile', () => {
  const mobileBreakpoint = consoleHtml.match(
    /@media\s*\(\s*max-width\s*:\s*700px\s*\)\s*\{([\s\S]*?)\n\s*\}/,
  );
  assert.ok(mobileBreakpoint, 'the mobile breakpoint must be present');
  const mobileCss = normalized(mobileBreakpoint[1]);
  assert.match(
    mobileCss,
    /\.table-wrap\s+thead\s*\{\s*display\s*:\s*none\s*\}/,
    'the desktop header must not compete with mobile field labels',
  );
  assert.match(
    mobileCss,
    /tr\[data-registry-row\]\s*\{\s*display\s*:\s*grid\b/,
    'each mobile agent must become a self-contained card',
  );
  assert.match(
    mobileCss,
    /\.mobile-label\s*\{\s*display\s*:\s*block\b/,
    'mobile field labels must be visible',
  );

  const row = consoleHtml.match(
    /<tr\b(?=[^>]*\bdata-registry-row\b)[\s\S]*?<\/tr>/i,
  );
  assert.ok(row, 'a semantic registry row must be rendered');
  assert.equal(
    (row[0].match(/class="mobile-label"/g) || []).length,
    5,
    'all five mobile fields need an explicit label',
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
    attentionTitle: ['Что требует внимания', 'Needs attention'],
    inventory: ['Автоматизации', 'Automations'],
    attentionItems: ['типов расхождений', 'discrepancy types'],
    needsAttention: ['требуют внимания', 'need attention'],
    viewReason: ['Посмотреть причины', 'Review issues'],
    openCabinet: ['Открыть Agent Cabinet', 'Open Agent Cabinet'],
    advanced: ['Дополнительно', 'More'],
  };

  for (const [key, [ruValue, enValue]] of Object.entries(copyContract)) {
    assert.equal(copyValue(ru, key), ruValue, `unexpected RU copy for ${key}`);
    assert.equal(copyValue(en, key), enValue, `unexpected EN copy for ${key}`);
  }
});
