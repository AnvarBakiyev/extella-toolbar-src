'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const toolbarRoot = path.resolve(__dirname, '..');
const consoleHtml = fs.readFileSync(path.join(
  toolbarRoot,
  'plugins',
  'scenarios',
  'evolution-console.html',
), 'utf8');

function regexEscape(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function openingTags(source, tagName = '[a-z][\\w:-]*') {
  return [...source.matchAll(new RegExp(`<${tagName}\\b[^>]*>`, 'gi'))]
    .map((match) => match[0]);
}

function attribute(tag, name) {
  const match = tag.match(new RegExp(
    `\\b${regexEscape(name)}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    'i',
  ));
  return match ? (match[1] ?? match[2] ?? match[3]) : null;
}

function functionDeclaration(name) {
  const marker = `function ${name}(`;
  const start = consoleHtml.indexOf(marker);
  assert.notEqual(start, -1, `missing semantic helper ${name}`);
  const bodyStart = consoleHtml.indexOf('{', start + marker.length);
  assert.notEqual(bodyStart, -1, `missing body for ${name}`);

  let depth = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = bodyStart; index < consoleHtml.length; index += 1) {
    const char = consoleHtml[index];
    const next = consoleHtml[index + 1];
    if (lineComment) {
      if (char === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === '/' && next === '/') {
      lineComment = true;
      index += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      blockComment = true;
      index += 1;
      continue;
    }
    if (char === '\'' || char === '"' || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return consoleHtml.slice(start, index + 1);
    }
  }
  assert.fail(`unterminated semantic helper ${name}`);
}

function evaluateHelper(name) {
  const context = {};
  vm.runInNewContext(
    `${functionDeclaration(name)}\nthis.helper = ${name};`,
    context,
    { filename: `evolution-console-${name}.js` },
  );
  return context.helper;
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
  return String(match[2]).replace(/\s+/g, ' ').trim();
}

test('summary semantic helper partitions installed automations exactly once', () => {
  const category = evaluateHelper('automationSummaryCategory');
  const fixtures = [
    [true, 'WORKING', false, 'WORKING'],
    [true, 'NOT_RUNNING', false, 'STOPPED'],
    [true, 'STATE_UNAVAILABLE', false, 'UNKNOWN'],
    [true, 'UNKNOWN', false, 'UNKNOWN'],
    [true, 'WORKING', true, 'NEEDS_HELP'],
    [true, 'NOT_RUNNING', true, 'NEEDS_HELP'],
    [true, 'STATE_UNAVAILABLE', true, 'NEEDS_HELP'],
    [false, 'WORKING', false, null],
    ['UNKNOWN', 'WORKING', false, null],
  ];

  fixtures.forEach(([installed, status, hasProblem, expected]) => {
    assert.equal(
      category(installed, status, hasProblem),
      expected,
      `${String(installed)}/${status}/${String(hasProblem)}`,
    );
  });
});

test('unknown installation evidence is never rendered as a zero fleet', () => {
  const source = functionDeclaration('automationInstallationFactsUnknown');
  assert.match(source, /installed==='UNKNOWN'/);
  assert.match(consoleHtml, /installationUnknown\?'—':categories\.WORKING/);
  assert.match(consoleHtml, /installationUnknown\?'\(—\)'/);
  assert.match(consoleHtml, /installCheckUnavailableTitle/);
  assert.match(consoleHtml, /data-empty-action="retry"/);
  assert.match(consoleHtml, /data-empty-action="catalog"/);
});

test('device reconciliation keeps every discovered card visible without promoting unknown products', () => {
  const validate = evaluateHelper('validDeviceInventory');
  const inventory = {
    schema: 'extella.evolution.device_inventory.v2',
    available: true,
    classification_complete: false,
    counts: {
      discovered: 16,
      business_automations: 3,
      system_surfaces: 4,
      installed_apps: 0,
      probes: 0,
      unclassified: 9,
    },
    rows: Array.from({ length: 16 }, (_, index) => ({
      id: `inventory_card_${String(index).padStart(2, '0')}`,
      kind: index < 3
        ? 'BUSINESS_AUTOMATION'
        : (index < 7 ? 'SYSTEM_SURFACE' : 'UNCLASSIFIED'),
      evidence: index < 3
        ? 'REVIEWED_MIGRATION'
        : (index < 7 ? 'SYSTEM_MARKER' : 'CLASSIFICATION_MISSING'),
    })),
  };

  assert.equal(validate(inventory), true);
  assert.equal(validate({
    ...inventory,
    classification_complete: true,
  }), false);
  assert.match(consoleHtml, /id="deviceInventoryNotice"/);
  assert.match(consoleHtml, /id="deviceInventoryRows"/);
  assert.match(
    functionDeclaration('renderDeviceInventory'),
    /counts\.discovered[\s\S]*counts\.business_automations[\s\S]*counts\.system_surfaces[\s\S]*counts\.unclassified/,
  );
  assert.match(functionDeclaration('renderDeviceInventory'), /inventory\.rows/);
  const ru = languageBlock('ru', 'en');
  const en = languageBlock('en');
  ['cardsFound', 'confirmedAutomations', 'systemComponents',
    'classificationRequired', 'classificationBoundary',
    'inventoryKindAutomation', 'inventoryKindSystem',
    'inventoryKindUnknown'].forEach((key) => {
    assert.ok(copyValue(ru, key));
    assert.ok(copyValue(en, key));
  });
});

test('installed programs stay outside the automation fleet and need no passport', () => {
  assert.match(consoleHtml, /data-fleet-filter="programs"/);
  assert.match(consoleHtml, /id="countPrograms"/);
  assert.match(consoleHtml, /row\.kind==='INSTALLED_APP'/);
  assert.match(consoleHtml, /programBoundary:'Программы установлены пользователем/);
  assert.match(consoleHtml, /programBoundary:'Programs are installed by the user/);
  assert.match(consoleHtml, /inventoryKindInstalledApp:'Установленная программа'/);
  assert.match(consoleHtml, /inventoryKindProbe:'Служебная проба'/);
  assert.doesNotMatch(consoleHtml, /data-program-action|data-program-passport/);
});

test('primary problem selection is deterministic and does not mutate findings', () => {
  const select = evaluateHelper('selectPrimaryAutomationProblem');
  const findings = [
    { kind: 'RISK', id: 'risk' },
    { kind: 'ORPHANED', id: 'orphan' },
    { kind: 'VERSION_BEHIND', id: 'version' },
    { kind: 'LAST_ERROR', id: 'error' },
    { kind: 'DEAD_REFERENCE', id: 'reference' },
  ];
  const original = JSON.parse(JSON.stringify(findings));

  assert.equal(select(findings).kind, 'DEAD_REFERENCE');
  assert.equal(select(findings.slice(0, 4)).kind, 'LAST_ERROR');
  assert.equal(select(findings.slice(0, 3)).kind, 'VERSION_BEHIND');
  assert.equal(select(findings.slice(0, 2)).kind, 'ORPHANED');
  assert.equal(select(findings.slice(0, 1)).kind, 'RISK');
  assert.equal(select([]), null);
  assert.deepEqual(findings, original);
});

test('problem ownership fails safe to Extella maintenance', () => {
  const responsibility = evaluateHelper('automationProblemResponsibility');

  for (const code of [
    'USER_ACTION_REQUIRED',
    'OWNER_CONFIRMATION_REQUIRED',
    'AUTHENTICATION_REQUIRED',
    'LOGIN_REQUIRED',
    'REAUTH_REQUIRED',
    'CREDENTIALS_REQUIRED',
    'CREDENTIAL_EXPIRED',
    'PERMISSION_REQUIRED',
    'USER_SELECTION_REQUIRED',
    'SUBSCRIPTION_REQUIRED',
  ]) {
    assert.equal(responsibility(code, 'error'), 'USER', code);
  }

  for (const code of [
    'DEVICE_SCANNER_CONTRACT_STALE',
    'PLATFORM_AGENT_MISSING',
    'EXPERT_MISSING',
    'SCHEDULE_REFERENCE_MISSING',
    'SOURCE_UNAVAILABLE',
    'CATALOG_ORPHAN',
    '',
  ]) {
    assert.equal(responsibility(code, 'error'), 'EXTELLA', code);
  }
  assert.equal(responsibility('ANY_CODE', 'info'), 'INFO');
});

test('a real user decision outranks technical maintenance on the card', () => {
  const select = evaluateHelper('selectPrimaryAutomationProblem');
  const selected = select([
    { kind: 'DEAD_REFERENCE', responsibility: 'EXTELLA' },
    { kind: 'RISK', responsibility: 'INFO' },
    { kind: 'LAST_ERROR', responsibility: 'USER' },
  ]);
  assert.equal(selected.kind, 'LAST_ERROR');
  assert.equal(selected.responsibility, 'USER');
});

test('Evolution Lab accepts only an exact current change context', () => {
  const usable = evaluateHelper('evolutionLabContextUsable');
  const valid = {
    change_id: 'change_1',
    candidate_id: 'candidate_1',
    target_automation_ids: ['extella_travel_agency'],
    registry_snapshot_id: 'snapshot_1',
  };
  assert.equal(usable(valid, 'snapshot_1'), true);
  assert.equal(usable({ ...valid, change_id: '' }, 'snapshot_1'), false);
  assert.equal(usable({ ...valid, candidate_id: '' }, 'snapshot_1'), false);
  assert.equal(usable({ ...valid, target_automation_ids: [] }, 'snapshot_1'), false);
  assert.equal(
    usable({ ...valid, target_automation_ids: ['a', 'a'] }, 'snapshot_1'),
    false,
  );
  assert.equal(usable(valid, 'snapshot_2'), false);
  assert.equal(usable(null, 'snapshot_1'), false);
});

test('simple MVP exposes four summary categories and no PRE or POST metric', () => {
  const overviewStart = consoleHtml.indexOf('data-evolution-view="overview"');
  const overviewEnd = consoleHtml.indexOf(
    'data-evolution-view="lab"',
    overviewStart,
  );
  const overview = consoleHtml.slice(overviewStart, overviewEnd);
  const categories = openingTags(overview)
    .map((tag) => attribute(tag, 'data-summary-category'))
    .filter(Boolean);

  assert.deepEqual(categories, [
    'WORKING',
    'STOPPED',
    'UNKNOWN',
    'NEEDS_HELP',
  ]);
  assert.doesNotMatch(
    overview,
    /PRE\s*\+\s*POST|countProtectedAgents|countNotRunning|countAttention/,
  );
});

test('specialist navigation exposes history only and leaves operational work on the product overview', () => {
  const advancedStart = consoleHtml.indexOf('id="advancedNav"');
  const advancedEnd = consoleHtml.indexOf('</details>', advancedStart);
  assert.ok(advancedStart >= 0 && advancedEnd > advancedStart);
  const advanced = consoleHtml.slice(advancedStart, advancedEnd);
  const buttons = openingTags(advanced, 'button');
  assert.equal(buttons.length, 1);
  const tasks = buttons
    .map((tag) => attribute(tag, 'data-advanced-task'))
    .filter(Boolean);
  assert.deepEqual(tasks, ['history']);

  const ru = languageBlock('ru', 'en');
  const en = languageBlock('en');
  const copy = {
    advancedTaskHistory: [
      'Посмотреть историю изменений',
      'View change history',
    ],
  };
  Object.entries(copy).forEach(([key, [ruValue, enValue]]) => {
    assert.equal(copyValue(ru, key), ruValue);
    assert.equal(copyValue(en, key), enValue);
    assert.match(advanced, new RegExp(`data-t="${regexEscape(key)}"`));
  });
});

test('Evolution Lab is a contextual action rather than primary navigation', () => {
  const navigationStart = consoleHtml.indexOf('<nav class="tabs"');
  const navigationEnd = consoleHtml.indexOf('</nav>', navigationStart);
  const navigation = consoleHtml.slice(navigationStart, navigationEnd);

  assert.doesNotMatch(navigation, /data-primary-surface="lab"/);
  assert.doesNotMatch(navigation, /data-view="lab"/);
  assert.match(consoleHtml, /data-action="open-evolution-lab"/);
  assert.ok(
    (consoleHtml.match(/evolutionLabContextUsable\(/g) || []).length >= 2,
    'the context validator must be called, not merely declared',
  );
});

test('automation card emits one problem slot and one next-step slot', () => {
  const cardStart = consoleHtml.indexOf('function renderAutomationCard(row)');
  const cardEnd = consoleHtml.indexOf('function renderFleet()', cardStart);
  assert.ok(cardStart >= 0 && cardEnd > cardStart);
  const renderer = consoleHtml.slice(cardStart, cardEnd);

  assert.equal((renderer.match(/data-primary-problem=/g) || []).length, 1);
  assert.equal((renderer.match(/data-next-step=/g) || []).length, 1);
  assert.match(renderer, /selectPrimaryAutomationProblem\(/);
  assert.doesNotMatch(
    renderer.match(/<summary[\s\S]*?<\/summary>/)?.[0] || '',
    /risk-codes|component-items|action-gates/,
  );
});
