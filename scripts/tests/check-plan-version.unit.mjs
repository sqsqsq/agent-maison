// check-plan-version.unit.mjs — dev-only 单测（plan a3e7d1c9 t3）
//
// 为什么放这里而不是 harness/tests：check-plan-version 是**仓根工具链**，
// harness/ 是发布内容，dev-only 门禁的测试不得随包外发。
//
// 跑法：npm run release:check-plans-test（= node --test scripts/tests/*.unit.mjs）
// 用 `release:` 前缀是为了走 sanitizePackageJson 的既有剥离规则（dc27f455 约定：dev-only
// 顶层 script 一律 release: 前缀，避免泄漏进消费者 package.json——scripts/ 本身不随包）。
// 注：Windows 上 `node --test <目录>` 会把目录当模块解析而报 MODULE_NOT_FOUND，故按文件/通配跑。
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { checkPlanVersions } from '../check-plan-version.mjs';

/** 本例创建的临时仓根，afterEach 统一清理——否则反复执行会在 TMP 下越积越多。 */
const createdRoots = [];

afterEach(() => {
  while (createdRoots.length) {
    const root = createdRoots.pop();
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch {
      /* 清理失败不影响断言结果，忽略 */
    }
  }
});

/** 造一个最小仓根：package.json + .cursor/plans/<name>；可选写 allowlist。 */
function mkRepo(plans, opts = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-version-test-'));
  createdRoots.push(root);
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'fixture', version: opts.current ?? '3.0.0' }, null, 2),
    'utf8',
  );
  const plansDir = path.join(root, '.cursor', 'plans');
  fs.mkdirSync(plansDir, { recursive: true });
  for (const [name, content] of Object.entries(plans)) {
    fs.writeFileSync(path.join(plansDir, name), content, 'utf8');
  }
  if (opts.legacyAllowlist) {
    fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'scripts', 'plan-version-legacy-allowlist.json'),
      JSON.stringify({ files: opts.legacyAllowlist }, null, 2),
      'utf8',
    );
  }
  return root;
}

/** 只挑「正文未勾框」这条规则产生的 hits（其余规则各有自己的用例）。 */
function checklistHits(result) {
  return result.hits.filter((h) => h.reason.includes('未勾'));
}

const plan = ({ version, deferredTo, todos, body }) => {
  const fm = ['---', `name: fixture`];
  if (version) fm.push(`version: ${version}`);
  if (deferredTo) fm.push(`deferred_to: ${deferredTo}`);
  if (todos) {
    fm.push('todos:');
    for (const t of todos) {
      fm.push(`  - id: ${t.id}`, `    content: ${t.id} content`, `    status: ${t.status}`);
    }
  }
  fm.push('isProject: false', '---', '');
  return `${fm.join('\n')}\n${body ?? ''}\n`;
};

test('① 在窗 plan 正文有未勾框 → 默认模式 FAIL', () => {
  const root = mkRepo({
    'a.plan.md': plan({
      version: '3.0.0',
      todos: [{ id: 't1', status: 'completed' }],
      body: '## Todos\n\n- [ ] 还没做的事\n',
    }),
  });
  const res = checkPlanVersions({ mode: 'default', repoRoot: root });
  const hits = checklistHits(res);
  assert.equal(hits.length, 1, '应恰好一条未勾框命中');
  assert.match(hits[0].reason, /frontmatter todos/);
});

test('② 只有已勾框 → PASS（历史 [x] 可保留，不作机器状态）', () => {
  const root = mkRepo({
    'a.plan.md': plan({
      version: '3.0.0',
      todos: [{ id: 't1', status: 'completed' }],
      body: '## 历史轨迹\n\n- [x] 早就做完了\n- [x] 也做完了\n',
    }),
  });
  const res = checkPlanVersions({ mode: 'default', repoRoot: root });
  assert.equal(checklistHits(res).length, 0);
  assert.equal(res.ok, true, JSON.stringify(res.hits));
});

test('③ 过去窗口 plan 不受该规则约束', () => {
  const root = mkRepo({
    'a.plan.md': plan({
      version: '2.1.0',
      todos: [{ id: 't1', status: 'completed' }],
      body: '- [ ] 历史窗口里没勾的项\n',
    }),
  });
  const res = checkPlanVersions({ mode: 'default', repoRoot: root });
  assert.equal(checklistHits(res).length, 0, '低于当前窗口的 plan 不该被本规则拦');
});

test('④ allowlist 项豁免语义不变（terminal + 无 version + 无 deferred_to）', () => {
  const root = mkRepo(
    {
      'legacy.plan.md': plan({
        todos: [{ id: 't1', status: 'completed' }],
        body: '- [ ] 存量历史里遗留的未勾项\n',
      }),
    },
    { legacyAllowlist: ['legacy.plan.md'] },
  );
  const res = checkPlanVersions({ mode: 'default', repoRoot: root });
  assert.equal(res.ok, true, JSON.stringify(res.hits));
});

test('⑤ future deferred 不豁免：version 3.1.0 + deferred_to 3.1.0 + 正文未勾项 → FAIL', () => {
  const root = mkRepo({
    'a.plan.md': plan({
      version: '3.1.0',
      deferredTo: '3.1.0',
      todos: [{ id: 't1', status: 'pending' }],
      body: '- [ ] 顺延窗口里的未勾项\n',
    }),
  });
  const res = checkPlanVersions({ mode: 'default', repoRoot: root });
  const hits = checklistHits(res);
  assert.equal(hits.length, 1, '合法 deferred_to 不得成为正文未勾项的豁免');
});

test('⑥ 已有 frontmatter todos，正文另有未勾框 → 仍 FAIL（双账本漂移面）', () => {
  const root = mkRepo({
    'a.plan.md': plan({
      version: '3.0.0',
      todos: [{ id: 't1', status: 'pending' }],
      body: '## Todos\n\n- [ ] 与 frontmatter 重复的一条\n',
    }),
  });
  const res = checkPlanVersions({ mode: 'default', repoRoot: root });
  assert.equal(checklistHits(res).length, 1, 'frontmatter 已登记不构成正文复选框的豁免');
});

test('围栏代码块内的示例复选框不算（plan 正文常含 markdown 示例）', () => {
  const root = mkRepo({
    'a.plan.md': plan({
      version: '3.0.0',
      todos: [{ id: 't1', status: 'completed' }],
      body: '## 说明\n\n```markdown\n- [ ] 这是文档里的示例\n```\n\n正文其余部分无未勾项。\n',
    }),
  });
  const res = checkPlanVersions({ mode: 'default', repoRoot: root });
  assert.equal(checklistHits(res).length, 0, '围栏内示例不得误报');
});

test('嵌套围栏：四反引号外层包三反引号，内层示例不得误报', () => {
  // 回归用例：只记 fence 字符不记长度时，内层 ``` 会把外层 ```` 提前闭合，
  // 于是「示例」之后的正文被当成围栏外内容——本例的 - [ ] 曾被错误命中。
  const root = mkRepo({
    'a.plan.md': plan({
      version: '3.0.0',
      todos: [{ id: 't1', status: 'completed' }],
      body: '## 说明\n\n````markdown\n```\n- [ ] 内层示例\n```\n````\n\n正文其余部分无未勾项。\n',
    }),
  });
  const res = checkPlanVersions({ mode: 'default', repoRoot: root });
  assert.equal(checklistHits(res).length, 0, '嵌套围栏内的示例不得误报');
});

test('围栏之后的真待办仍要命中（剥围栏不得吞掉后续正文）', () => {
  const root = mkRepo({
    'a.plan.md': plan({
      version: '3.0.0',
      todos: [{ id: 't1', status: 'completed' }],
      body: '```\n- [ ] 示例\n```\n\n- [ ] 围栏之后的真待办\n',
    }),
  });
  const res = checkPlanVersions({ mode: 'default', repoRoot: root });
  assert.equal(checklistHits(res).length, 1, '围栏闭合后的未勾项必须命中');
});
