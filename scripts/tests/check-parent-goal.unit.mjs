// check-parent-goal.unit.mjs — 父目标声明门禁的 dev-only 专项回归
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkParentGoalDeclarations, checkPlanVersions } from '../check-plan-version.mjs';
import { loadAllPlans, parsePlanFile } from '../plan-version-lib.mjs';

const GOAL_ID = 'fixture-goal-75411223';
const TARGET_IDS = ['g1-fixture', 'g2-fixture'];
const createdRoots = [];

afterEach(() => {
  while (createdRoots.length) {
    const root = createdRoots.pop();
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch {
      // 临时 fixture 清理失败不应遮蔽断言结果。
    }
  }
});

function goalFile(id = GOAL_ID) {
  return `---
id: ${id}
name: fixture goal
---

### 0.1 Targets

| ID | Description |
|---|---|
| \`g1-fixture\` | first target |
| \`g2-fixture\` | second target |

## 1. Other text

This prose mentions \`g9-prose-only\`, which is not a target id.
`;
}

function planFile({
  version = '3.1.0',
  deferredTo,
  fields = [],
  todos = [{ id: 't1', status: 'completed' }],
  body = '',
  eol = '\n',
} = {}) {
  const lines = ['---', 'name: fixture'];
  if (version !== null) lines.push(`version: ${version}`);
  if (deferredTo) lines.push(`deferred_to: ${deferredTo}`);
  lines.push(...fields, 'todos:');
  for (const todo of todos) {
    lines.push(`  - id: ${todo.id}`, `    content: ${todo.id} content`, `    status: ${todo.status}`);
  }
  lines.push('isProject: false', '---', '', body);
  return `${lines.join(eol)}${eol}`;
}

function validFields({ advances = TARGET_IDS, realHost = 'fixture host validation' } = {}) {
  return [
    `parent_goal: ${GOAL_ID}`,
    'advances:',
    ...advances.map((id) => `  - ${id}`),
    'relation: core',
    'layer: governance',
    'goal_requires: []',
    'goal_provides:',
    '  - stable-3.1.0-release-baseline',
    'real_host_validation: >',
    `  ${realHost}`,
    'parallel_authority_added: false',
  ];
}

function mkRepo(plans, { current = '3.1.0', goals = [{ name: 'fixture.goal.md', content: goalFile() }], legacyAllowlist } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'parent-goal-test-'));
  createdRoots.push(root);
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'fixture', version: current }, null, 2),
    'utf8',
  );
  const plansDir = path.join(root, '.cursor', 'plans');
  fs.mkdirSync(plansDir, { recursive: true });
  for (const [name, content] of Object.entries(plans)) {
    fs.writeFileSync(path.join(plansDir, name), content, 'utf8');
  }
  if (goals) {
    const goalsDir = path.join(root, '.cursor', 'goals');
    fs.mkdirSync(goalsDir, { recursive: true });
    for (const goal of goals) {
      fs.writeFileSync(path.join(goalsDir, goal.name), goal.content, 'utf8');
    }
  }
  if (legacyAllowlist) {
    const scriptsDir = path.join(root, 'scripts');
    fs.mkdirSync(scriptsDir, { recursive: true });
    fs.writeFileSync(
      path.join(scriptsDir, 'plan-version-legacy-allowlist.json'),
      JSON.stringify({ files: legacyAllowlist }, null, 2),
      'utf8',
    );
  }
  return root;
}

function parentHits(result) {
  const fields = [
    'parent_goal',
    'advances',
    'relation',
    'layer',
    'goal_requires',
    'goal_provides',
    'real_host_validation',
    'parallel_authority_added',
  ];
  return result.hits.filter((hit) => fields.some((field) => hit.reason.startsWith(`${field}:`)));
}

test('合法完整声明通过 default 与 release', () => {
  const root = mkRepo({ 'valid.plan.md': planFile({ fields: validFields() }) });
  for (const mode of ['default', 'release']) {
    const result = checkPlanVersions({ mode, repoRoot: root });
    assert.equal(result.ok, true, `${mode}: ${JSON.stringify(result.hits)}`);
  }
});

test('parent_goal 必须唯一匹配 goal：零匹配与多匹配均 FAIL', () => {
  const noMatch = mkRepo({ 'zero.plan.md': planFile({ fields: validFields() }) }, { goals: [] });
  const zeroResult = checkPlanVersions({ repoRoot: noMatch });
  assert.ok(zeroResult.hits.some((hit) => hit.reason.includes('匹配 0 份')));

  const multiple = mkRepo(
    { 'multiple.plan.md': planFile({ fields: validFields() }) },
    {
      goals: [
        { name: 'a.goal.md', content: goalFile() },
        { name: 'b.goal.md', content: goalFile() },
      ],
    },
  );
  const multipleResult = checkPlanVersions({ repoRoot: multiple });
  assert.ok(multipleResult.hits.some((hit) => hit.reason.includes('匹配多个 goal 文件')));
});

test('advances 非法目标 id FAIL，并指出 §0.1 合法集合来源', () => {
  const root = mkRepo({
    'invalid-advances.plan.md': planFile({ fields: validFields({ advances: ['g9-not-exist'] }) }),
  });
  const result = checkPlanVersions({ repoRoot: root });
  const hit = result.hits.find((item) => item.reason.startsWith('advances: 非法目标 id'));
  assert.ok(hit);
  assert.match(hit.reason, /g9-not-exist/);
  assert.match(hit.reason, /§0\.1/);
});

test('relation 与 layer 枚举非法 FAIL', () => {
  const fields = validFields();
  fields[fields.indexOf('relation: core')] = 'relation: not-a-relation';
  fields[fields.indexOf('layer: governance')] = 'layer: not-a-layer';
  const root = mkRepo({ 'invalid-enum.plan.md': planFile({ fields }) });
  const result = checkPlanVersions({ repoRoot: root });
  assert.ok(result.hits.some((hit) => hit.reason.startsWith('relation: 非法值')));
  assert.ok(result.hits.some((hit) => hit.reason.startsWith('layer: 非法值')));
});

test('parent_goal 声明缺字段时逐字段 FAIL，含 goal_requires/provides 缺省', () => {
  const root = mkRepo({
    'partial.plan.md': planFile({
      fields: [`parent_goal: ${GOAL_ID}`, 'advances:', '  - g1-fixture'],
    }),
  });
  const result = checkPlanVersions({ repoRoot: root });
  for (const field of ['relation', 'layer', 'goal_requires', 'goal_provides', 'real_host_validation', 'parallel_authority_added']) {
    assert.ok(result.hits.some((hit) => hit.reason.startsWith(`${field}:`)), `missing diagnostic for ${field}`);
  }
});

test('parallel_authority_added=true 直接 FAIL', () => {
  const fields = validFields();
  fields[fields.indexOf('parallel_authority_added: false')] = 'parallel_authority_added: true';
  const root = mkRepo({ 'parallel-authority.plan.md': planFile({ fields }) });
  const result = checkPlanVersions({ repoRoot: root });
  assert.ok(result.hits.some((hit) => hit.reason.includes('parallel_authority_added: 必须为 false')));
});

test('未声明 parent_goal 的 plan 零新增父目标告警，正文提及不触发', () => {
  const root = mkRepo({
    'undeclared.plan.md': planFile({ body: '正文说明 parent_goal: prose-only 不构成机器声明。' }),
  });
  const result = checkPlanVersions({ repoRoot: root });
  assert.equal(parentHits(result).length, 0, JSON.stringify(result.hits));
  assert.equal(result.ok, true, JSON.stringify(result.hits));
});

test('顺延 plan 的非法声明在 default 与 release 均 FAIL，不被 future 提前返回吞掉', () => {
  const root = mkRepo({
    'future-invalid.plan.md': planFile({
      version: '3.2.0',
      deferredTo: '3.2.0',
      fields: validFields({ advances: ['g9-future-invalid'] }),
      todos: [{ id: 't1', status: 'pending' }],
    }),
  });
  for (const mode of ['default', 'release']) {
    const result = checkPlanVersions({ mode, repoRoot: root });
    assert.ok(
      result.hits.some((hit) => hit.reason.includes('g9-future-invalid')),
      `${mode}: ${JSON.stringify(result.hits)}`,
    );
  }
});

test('allowlist plan 的非法声明也不能被提前返回吞掉', () => {
  const root = mkRepo(
    { 'legacy.plan.md': planFile({ version: null, fields: validFields({ advances: ['g9-legacy-invalid'] }) }) },
    { legacyAllowlist: ['legacy.plan.md'] },
  );
  const result = checkPlanVersions({ repoRoot: root });
  assert.equal(result.hits.length, 1, JSON.stringify(result.hits));
  assert.ok(result.hits.some((hit) => hit.reason.includes('g9-legacy-invalid')));
});

test('行内 []、block-list、折叠/字面块和 CRLF frontmatter 均按受限形态解析', () => {
  const fields = validFields({ advances: ['g1-fixture'] });
  fields[fields.indexOf('real_host_validation: >')] = 'real_host_validation: |';
  fields.splice(fields.indexOf('  fixture host validation'), 1, '  first host fact', '  second host fact');
  const content = planFile({ fields, eol: '\r\n' });
  const parsed = parsePlanFile(content);
  assert.deepEqual(parsed.advances, ['g1-fixture']);
  assert.deepEqual(parsed.goal_requires, []);
  assert.deepEqual(parsed.goal_provides, ['stable-3.1.0-release-baseline']);
  assert.equal(parsed.real_host_validation, 'first host fact\nsecond host fact');

  const root = mkRepo({ 'shapes.plan.md': content });
  for (const mode of ['default', 'release']) {
    const result = checkPlanVersions({ mode, repoRoot: root });
    assert.equal(result.ok, true, `${mode}: ${JSON.stringify(result.hits)}`);
  }
});

test('全仓回归动态扫描全部声明 plan，未声明存量 plan 零新增告警', () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const plans = loadAllPlans(repoRoot);
  const declared = plans.filter(({ parsed }) => parsed.parentGoalDeclared);
  const undeclared = plans.filter(({ parsed }) => !parsed.parentGoalDeclared);
  assert.ok(declared.length > 0, '仓库应存在至少一份父目标声明 plan');

  const result = checkPlanVersions({ mode: 'default', repoRoot });
  for (const plan of declared) {
    assert.deepEqual(
      result.hits.filter((hit) => hit.file === plan.rel),
      [],
      `declared plan failed: ${plan.rel}`,
    );
  }
  for (const plan of undeclared) {
    assert.deepEqual(
      result.hits.filter((hit) => hit.file === plan.rel),
      [],
      `undeclared plan gained a hit: ${plan.rel}`,
    );
  }
  assert.equal(result.ok, true, JSON.stringify(result.hits));
});

test('checkParentGoalDeclarations 未声明时直接返回空诊断', () => {
  const hits = checkParentGoalDeclarations({
    repoRoot: os.tmpdir(),
    rel: '.cursor/plans/undeclared.plan.md',
    parsed: { parentGoalDeclared: false },
  });
  assert.deepEqual(hits, []);
});
