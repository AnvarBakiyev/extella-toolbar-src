'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const toolbarRoot = path.resolve(__dirname, '..');
const contractPath = path.join(
  toolbarRoot,
  'src',
  'core',
  'evolution-agent-control-contract.js',
);
const contractSource = fs.readFileSync(contractPath, 'utf8');

function loadContract() {
  const context = { ETB: {} };
  vm.runInNewContext(contractSource, context, {
    filename: 'evolution-agent-control-contract.js',
  });
  return context.ETB.evolutionAgentControlContract;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function cabinetAgentControl(overrides = {}) {
  return {
    surface: 'agent_control_center',
    engine: 'ETB.agentControl',
    shared_ledger_with: 'agent_cabinet',
    operations: [
      {
        code: 'createDraft',
        order: 1,
        ru: 'Черновик изменения',
        en: 'Change draft',
        requires: [],
      },
      {
        code: 'analyzeImpact',
        order: 2,
        ru: 'Что это затронет',
        en: 'What this affects',
        requires: ['createDraft'],
      },
      {
        code: 'runPlayground',
        order: 3,
        ru: 'Прогон на проверочных случаях',
        en: 'Run on check cases',
        requires: ['createDraft'],
      },
      {
        code: 'publishDraft',
        order: 4,
        ru: 'Опубликовать',
        en: 'Publish',
        requires: ['analyzeImpact', 'runPlayground'],
      },
      {
        code: 'runActive',
        order: 5,
        ru: 'Запустить действующую версию',
        en: 'Run the active version',
        requires: ['publishDraft'],
      },
      {
        code: 'rollback',
        order: 6,
        ru: 'Вернуть предыдущую версию',
        en: 'Roll back to the previous version',
        requires: ['publishDraft'],
      },
    ],
    publish_gates: [
      {
        code: 'IMPACT_ANALYZED',
        ru: 'показано, кого затронет изменение',
        en: 'the impact of the change is shown',
      },
      {
        code: 'PLAYGROUND_GREEN',
        ru: 'прогон на проверочных случаях прошёл',
        en: 'the run on check cases passed',
      },
      {
        code: 'ROLLBACK_AVAILABLE',
        ru: 'путь назад известен и доступен на экране',
        en: 'the way back is known and visible on screen',
      },
      {
        code: 'READ_BACK_CONFIRMED',
        ru: 'результат подтверждён перечитыванием, а не ответом кнопки',
        en: 'the result is confirmed by read-back, not by the button response',
      },
    ],
    limits: [
      {
        ru: 'Не создаёт нового агента — это Конструктор или Evolution Console.',
        en: 'Does not create a new agent — that is the Builder or Evolution Console.',
      },
      {
        ru: 'Не редактирует защиту данных — политика живёт в кабинете агента.',
        en: 'Does not edit data protection — the policy lives in the agent cabinet.',
      },
      {
        ru: 'Не ведёт свой журнал версий: журнал общий с кабинетом.',
        en: 'Keeps no separate version ledger: the ledger is shared with the cabinet.',
      },
      {
        ru: 'Нет журнала или ответа — показывает «неизвестно», а не ноль.',
        en: 'With no ledger or no response it shows «unknown», never zero.',
      },
    ],
    ...overrides,
  };
}

function throwsCode(run, expectedCode) {
  assert.throws(run, (error) => {
    assert.equal(error.code, expectedCode);
    return true;
  });
}

test('exports the canonical Agent Cabinet contract constants as frozen values', () => {
  const contract = loadContract();

  assert.equal(contract.SURFACE, 'agent_control_center');
  assert.equal(contract.ENGINE, 'ETB.agentControl');
  assert.equal(contract.SHARED_LEDGER_WITH, 'agent_cabinet');
  assert.deepEqual(plain(contract.OPERATION_CODES), [
    'createDraft',
    'analyzeImpact',
    'runPlayground',
    'publishDraft',
    'runActive',
    'rollback',
  ]);
  assert.deepEqual(plain(contract.PUBLISH_GATE_CODES), [
    'IMPACT_ANALYZED',
    'PLAYGROUND_GREEN',
    'ROLLBACK_AVAILABLE',
    'READ_BACK_CONFIRMED',
  ]);
  assert.equal(contract.LIMIT_COUNT, 4);
  assert(Object.isFrozen(contract));
  assert(Object.isFrozen(contract.OPERATION_CODES));
});

test('normalizes the exact generated contract without mutating input', () => {
  const contract = loadContract();
  const input = cabinetAgentControl();
  const before = JSON.stringify(input);
  const normalized = contract.normalize(input);

  assert.equal(JSON.stringify(input), before);
  assert.deepEqual(plain(normalized), plain(input));
  assert(Object.isFrozen(normalized));
  assert(Object.isFrozen(normalized.operations));
  assert(Object.isFrozen(normalized.operations[0]));
  assert(Object.isFrozen(normalized.operations[0].requires));
  assert(Object.isFrozen(normalized.publish_gates));
  assert(Object.isFrozen(normalized.limits));
});

test('rejects undeclared root and nested fields', () => {
  const contract = loadContract();
  const extraRoot = cabinetAgentControl({ second_ledger: true });
  const extraOperation = cabinetAgentControl();
  const extraGate = cabinetAgentControl();
  const extraLimit = cabinetAgentControl();
  extraOperation.operations[0].draft_id = 'not-a-contract-field';
  extraGate.publish_gates[0].enabled = true;
  extraLimit.limits[0].severity = 'warning';

  throwsCode(
    () => contract.normalize(extraRoot),
    'AGENT_CONTROL_CONTRACT_INVALID',
  );
  throwsCode(
    () => contract.normalize(extraOperation),
    'AGENT_CONTROL_CONTRACT_OPERATION_INVALID',
  );
  throwsCode(
    () => contract.normalize(extraGate),
    'AGENT_CONTROL_CONTRACT_GATE_INVALID',
  );
  throwsCode(
    () => contract.normalize(extraLimit),
    'AGENT_CONTROL_CONTRACT_LIMIT_INVALID',
  );
});

test('requires the exact six-operation sequence and dependencies', () => {
  const contract = loadContract();
  const reordered = cabinetAgentControl();
  const missingOperation = cabinetAgentControl();
  const wrongDependency = cabinetAgentControl();

  [reordered.operations[0], reordered.operations[1]] = [
    reordered.operations[1],
    reordered.operations[0],
  ];
  missingOperation.operations.pop();
  wrongDependency.operations[3].requires = [
    'runPlayground',
    'analyzeImpact',
  ];

  throwsCode(
    () => contract.normalize(reordered),
    'AGENT_CONTROL_CONTRACT_OPERATION_SEQUENCE_INVALID',
  );
  throwsCode(
    () => contract.normalize(missingOperation),
    'AGENT_CONTROL_CONTRACT_OPERATIONS_INVALID',
  );
  throwsCode(
    () => contract.normalize(wrongDependency),
    'AGENT_CONTROL_CONTRACT_OPERATION_SEQUENCE_INVALID',
  );
});

test('requires the exact four publication gates and four surface boundaries', () => {
  const contract = loadContract();
  const wrongGate = cabinetAgentControl();
  const missingGate = cabinetAgentControl();
  const extraLimit = cabinetAgentControl();

  wrongGate.publish_gates[2].code = 'PUBLISH_WITHOUT_ROLLBACK';
  missingGate.publish_gates.pop();
  extraLimit.limits.push({
    ru: 'Лишняя граница',
    en: 'Extra boundary',
  });

  throwsCode(
    () => contract.normalize(wrongGate),
    'AGENT_CONTROL_CONTRACT_GATE_SEQUENCE_INVALID',
  );
  throwsCode(
    () => contract.normalize(missingGate),
    'AGENT_CONTROL_CONTRACT_GATES_INVALID',
  );
  throwsCode(
    () => contract.normalize(extraLimit),
    'AGENT_CONTROL_CONTRACT_LIMITS_INVALID',
  );
});

test('fails closed on non-localized or HTML-like contract labels', () => {
  const contract = loadContract();
  const html = cabinetAgentControl();
  const nonRussian = cabinetAgentControl();
  const nonEnglish = cabinetAgentControl();

  html.operations[0].ru = '<img src=x onerror=alert(1)>';
  nonRussian.publish_gates[0].ru = 'impact shown';
  nonEnglish.limits[0].en = 'только по-русски';

  throwsCode(
    () => contract.normalize(html),
    'AGENT_CONTROL_CONTRACT_LOCALIZED_TEXT_INVALID',
  );
  throwsCode(
    () => contract.normalize(nonRussian),
    'AGENT_CONTROL_CONTRACT_LOCALIZED_TEXT_INVALID',
  );
  throwsCode(
    () => contract.normalize(nonEnglish),
    'AGENT_CONTROL_CONTRACT_LOCALIZED_TEXT_INVALID',
  );
});

test('rejects a surface, engine, or ledger that would create another control plane', () => {
  const contract = loadContract();

  throwsCode(
    () => contract.normalize(cabinetAgentControl({
      surface: 'agent_cabinet',
    })),
    'AGENT_CONTROL_CONTRACT_SURFACE_INVALID',
  );
  throwsCode(
    () => contract.normalize(cabinetAgentControl({
      engine: 'ETB.otherControl',
    })),
    'AGENT_CONTROL_CONTRACT_ENGINE_INVALID',
  );
  throwsCode(
    () => contract.normalize(cabinetAgentControl({
      shared_ledger_with: 'evolution_console_copy',
    })),
    'AGENT_CONTROL_CONTRACT_LEDGER_INVALID',
  );
});
