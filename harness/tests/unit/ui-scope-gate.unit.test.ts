// ============================================================================
// ui-scope-gate.unit.test.ts — ui_diff_within_declared_files（c4e8b1d3 G1）
// ----------------------------------------------------------------------------
// plan v17 Todo 2 的门禁侧用例（⑤ 正常 plan PASS 建快照为 runner 级，见
// goal-runner-testing-integrity 套件）：
//   ① HomeTab 未声明却修改 → FAIL（门禁结构上无档位——任何 strictness 均 BLOCKER）
//   ② CardPackPage 已声明修改 → PASS
//   ③ 只改 live contracts（不重跑 plan）→ 仍 FAIL（白名单只认冻结快照）
//   ④ expansion：更新 contracts.files + 重取 plan PASS snapshot → PASS
//   ⑥ agent 改码并自行 commit → 仍检出越界（coding_base_sha 基线覆盖 committed）
// 附基础设施负例：缺快照/缺 coding_base/非 goal run/无 ui-spec/删除文件 base 侧分类/
// untracked 新 UI 文件。
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import {
  recordCodingBase,
  resolveFrozenDeliverables,
  takePassSnapshot,
} from '../../scripts/utils/pass-snapshot';
import {
  hasUiContentMarkers,
  isUiSensitivePath,
  runUiDiffWithinDeclaredFiles,
} from '../../scripts/utils/ui-scope-gate';
import { clearFrameworkConfigCache } from '../../config';
import type { UnitCaseResult } from '../run-unit';

const FEATURE = 'bc-openCard';
const RUN_ID = 'run-uiscope-1';
const DECLARED = '02-Feature/FinancialCard/src/main/ets/pages/CardPackPage.ets';
const UNDECLARED = '01-Product/WalletMain/src/main/ets/pages/HomeTabPage.ets';
/** 路径不含 pages/components/presentation——UI 性只能靠内容标志判定 */
const UNDECLARED_BY_CONTENT = '01-Product/WalletMain/src/main/ets/helpers/CardWidget.ets';

function run(results: UnitCaseResult[], name: string, fn: () => void): void {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, error: (err as Error).stack ?? (err as Error).message });
  }
}
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}
function git(root: string, args: string[]): string {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf-8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return (r.stdout ?? '').trim();
}
function w(root: string, rel: string, content: string): void {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf-8');
}

function contractsYaml(files: string[]): string {
  return ['feature: bc-openCard', 'files:', ...files.map(f => `  - ${f}`), ''].join('\n');
}

interface Host { root: string }

/** 最小宿主：git 仓库 + feature 产物（plan.md/contracts.yaml/ui-spec）+ UI 源文件，全部入 base commit */
function setupHost(opts: { uiSpec?: boolean; declaredFiles?: string[] } = {}): Host {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-scope-'));
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 't@t']);
  git(root, ['config', 'user.name', 't']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  w(root, 'framework.config.json', JSON.stringify({
    schema_version: '1.1',
    project_name: 'UiScopeTest',
    project_profile: { name: 'hmos-app', sub_variant: 'app' },
    architecture: {
      outer_layers: [
        { id: '01-Product', can_depend_on: ['02-Feature'], intra_layer_deps: 'dag' },
        { id: '02-Feature', can_depend_on: [], intra_layer_deps: 'dag' },
      ],
      module_inner_layers: ['shared'],
      inner_dependency_direction: 'upward',
      cross_module_exports_file: 'index.ets',
    },
    paths: { features_dir: 'doc/features', docs_committed: false },
    materialized_adapters: ['cursor'],
  }, null, 2));
  w(root, DECLARED, 'struct CardPackPage { build() { Text("cards") } }');
  w(root, UNDECLARED, '@Entry\n@Component\nstruct HomeTabPage { build() { Text("home") } }');
  w(root, UNDECLARED_BY_CONTENT, '@Component\nstruct CardWidget { build() { Text("w") } }');
  if (opts.uiSpec !== false) {
    w(root, `doc/features/${FEATURE}/spec/ui-spec.yaml`, 'schema_version: "1.0"\nscreens: []\n');
  }
  w(root, `doc/features/${FEATURE}/plan/plan.md`, '# plan\n');
  w(root, `doc/features/${FEATURE}/contracts.yaml`, contractsYaml(opts.declaredFiles ?? [DECLARED]));
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'base']);
  clearFrameworkConfigCache();
  return { root };
}

/** trust 目录隔离到宿主内（绝不写用户主目录），执行完还原 env */
function withTrust<T>(root: string, fn: () => T): T {
  const prev = process.env.MAISON_GOAL_CHECKPOINT_DIR;
  process.env.MAISON_GOAL_CHECKPOINT_DIR = path.join(root, 'trust-cp');
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.MAISON_GOAL_CHECKPOINT_DIR;
    else process.env.MAISON_GOAL_CHECKPOINT_DIR = prev;
  }
}

/** plan PASS 快照 + coding 基线锚（= runner pre-coding 锚定完成后的形态） */
function anchor(root: string, opts: { snapshot?: boolean; base?: boolean; epoch?: number } = {}): void {
  if (opts.snapshot !== false) {
    const frozen = resolveFrozenDeliverables({ projectRoot: root, feature: FEATURE, phase: 'plan' });
    takePassSnapshot({
      projectRoot: root, feature: FEATURE, runId: RUN_ID, phase: 'plan',
      epoch: opts.epoch ?? 1, files: frozen,
    });
  }
  if (opts.base !== false) {
    const head = git(root, ['rev-parse', 'HEAD']);
    const rec = recordCodingBase({ projectRoot: root, feature: FEATURE, runId: RUN_ID, baseSha: head });
    assert(rec.kind === 'recorded' || rec.kind === 'reused', `coding base 记录失败：${rec.kind}`);
  }
}

function gate(root: string, runId: string | null = RUN_ID): ReturnType<typeof runUiDiffWithinDeclaredFiles> {
  return runUiDiffWithinDeclaredFiles({ projectRoot: root, feature: FEATURE, runId });
}

export function runAll(): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];

  run(results, '判据：pages/components/presentation 路径 + ArkUI 内容标志', () => {
    assert(isUiSensitivePath('01-Product/W/src/main/ets/pages/HomeTabPage.ets'), 'pages 路径须命中');
    assert(isUiSensitivePath('x/components/Btn.ets'), 'components 路径须命中');
    assert(!isUiSensitivePath('x/model/Data.ets'), '非 UI 目录不按路径命中');
    assert(!isUiSensitivePath('x/pages/readme.md'), '非 .ets 不命中');
    assert(hasUiContentMarkers('@Component struct A {}'), '@Component 须命中');
    assert(hasUiContentMarkers('struct A { build() {} }'), 'build() 须命中');
    assert(hasUiContentMarkers('x.bindSheet(...)'), 'bindSheet 须命中');
    assert(!hasUiContentMarkers('export const a = 1;'), '普通代码不命中');
  });

  run(results, '① HomeTab 未声明却修改 → FAIL ui_scope_violation（结构上无档位豁免）', () => {
    const { root } = setupHost();
    withTrust(root, () => {
      anchor(root);
      w(root, UNDECLARED, '@Entry\n@Component\nstruct HomeTabPage { build() { Text("BANK CARDS INJECTED") } }');
      const r = gate(root);
      assert(r.status === 'FAIL', `未声明 UI 修改须 FAIL，got ${r.status}: ${r.details}`);
      assert(r.failureKind === 'ui_scope_violation', `failureKind=${r.failureKind}`);
      assert((r.affectedFiles ?? []).includes(UNDECLARED), `affected 须含 ${UNDECLARED}`);
    });
  });

  run(results, '② CardPackPage 已声明修改 → PASS', () => {
    const { root } = setupHost();
    withTrust(root, () => {
      anchor(root);
      w(root, DECLARED, 'struct CardPackPage { build() { Text("cards v2") } }');
      const r = gate(root);
      assert(r.status === 'PASS', `已声明 UI 修改须 PASS，got ${r.status}: ${r.details}`);
    });
  });

  run(results, '③ 只改 live contracts（不重跑 plan）→ 仍 FAIL（白名单只认冻结快照）', () => {
    const { root } = setupHost();
    withTrust(root, () => {
      anchor(root);
      // agent 把 HomeTab 塞进 live contracts——绕过冻结的经典形态
      w(root, `doc/features/${FEATURE}/contracts.yaml`, contractsYaml([DECLARED, UNDECLARED]));
      w(root, UNDECLARED, '@Entry\n@Component\nstruct HomeTabPage { build() { Text("sneak") } }');
      const r = gate(root);
      assert(r.status === 'FAIL', `live contracts 声明不得生效，got ${r.status}: ${r.details}`);
      assert((r.affectedFiles ?? []).includes(UNDECLARED), 'HomeTab 仍须越界');
    });
  });

  run(results, '④ expansion：更新 contracts.files + 重取 plan PASS snapshot → PASS', () => {
    const { root } = setupHost();
    withTrust(root, () => {
      anchor(root);
      // 合法 expansion：contracts 更新后 plan 重新 PASS（epoch 2 新快照）
      w(root, `doc/features/${FEATURE}/contracts.yaml`, contractsYaml([DECLARED, UNDECLARED]));
      anchor(root, { snapshot: true, base: false, epoch: 2 });
      w(root, UNDECLARED, '@Entry\n@Component\nstruct HomeTabPage { build() { Text("approved change") } }');
      const r = gate(root);
      assert(r.status === 'PASS', `expansion 后须 PASS，got ${r.status}: ${r.details}`);
    });
  });

  run(results, '⑥ agent 改码并自行 commit → 仍检出越界（基线=coding_base_sha 覆盖 committed）', () => {
    const { root } = setupHost();
    withTrust(root, () => {
      anchor(root);
      w(root, UNDECLARED, '@Entry\n@Component\nstruct HomeTabPage { build() { Text("committed sneak") } }');
      git(root, ['add', '-A']);
      git(root, ['commit', '-qm', 'agent self-commit']);
      const r = gate(root);
      assert(r.status === 'FAIL', `agent 自行 commit 不得洗掉越界，got ${r.status}: ${r.details}`);
      assert((r.affectedFiles ?? []).includes(UNDECLARED), 'committed 越界文件须在 affected');
    });
  });

  run(results, '删除未声明 UI 文件 → base 侧内容分类仍检出（改后内容已不在盘上）', () => {
    const { root } = setupHost();
    withTrust(root, () => {
      anchor(root);
      // UNDECLARED_BY_CONTENT 路径不含 pages/——只能从 base 侧读内容才能判 UI
      fs.rmSync(path.join(root, UNDECLARED_BY_CONTENT));
      const r = gate(root);
      assert(r.status === 'FAIL', `删除未声明 UI 文件须 FAIL，got ${r.status}: ${r.details}`);
      assert((r.affectedFiles ?? []).includes(UNDECLARED_BY_CONTENT), 'base 侧分类须命中被删文件');
    });
  });

  run(results, 'untracked 新 UI 文件 → 检出（四态覆盖含 untracked）', () => {
    const { root } = setupHost();
    withTrust(root, () => {
      anchor(root);
      w(root, '01-Product/WalletMain/src/main/ets/pages/NewSneakPage.ets',
        '@Entry\n@Component\nstruct NewSneakPage { build() {} }');
      const r = gate(root);
      assert(r.status === 'FAIL', `untracked 新 UI 文件须 FAIL，got ${r.status}: ${r.details}`);
      assert((r.affectedFiles ?? []).some(f => f.endsWith('NewSneakPage.ets')), 'affected 须含新文件');
    });
  });

  run(results, '缺同 run plan snapshot → FAIL ui_scope_frozen_contract_missing（fail-closed，禁退 live）', () => {
    const { root } = setupHost();
    withTrust(root, () => {
      anchor(root, { snapshot: false });
      w(root, DECLARED, 'struct CardPackPage { build() { Text("v2") } }');
      const r = gate(root);
      assert(r.status === 'FAIL', `缺快照须 FAIL，got ${r.status}`);
      assert(r.failureKind === 'ui_scope_frozen_contract_missing', `failureKind=${r.failureKind}`);
    });
  });

  run(results, '缺 coding_base_sha → FAIL ui_scope_base_missing（不回退 trace.start_commit）', () => {
    const { root } = setupHost();
    withTrust(root, () => {
      anchor(root, { base: false });
      w(root, DECLARED, 'struct CardPackPage { build() { Text("v2") } }');
      const r = gate(root);
      assert(r.status === 'FAIL', `缺基线须 FAIL，got ${r.status}`);
      assert(r.failureKind === 'ui_scope_base_missing', `failureKind=${r.failureKind}`);
    });
  });

  run(results, '非 goal run（无 runId）→ SKIP 诚实声明（唯一合法 SKIP 路径）', () => {
    const { root } = setupHost();
    withTrust(root, () => {
      anchor(root);
      const r1 = gate(root, null);
      assert(r1.status === 'SKIP', `非 goal run 须 SKIP，got ${r1.status}`);
      assert(r1.details.includes('goal'), 'SKIP 详情须说明 goal-only 依据');
    });
  });

  run(results, 'round19 P1：删除 live ui-spec 不能绕过——改未声明 UI 仍 FAIL（适用面只看 diff）', () => {
    const { root } = setupHost();
    withTrust(root, () => {
      anchor(root);
      // 绕过尝试：agent 删掉 ui-spec 让"UI 面判定"落空，再改未声明 UI
      fs.rmSync(path.join(root, `doc/features/${FEATURE}/spec/ui-spec.yaml`));
      w(root, UNDECLARED, '@Entry\n@Component\nstruct HomeTabPage { build() { Text("bypass?") } }');
      const r = gate(root);
      assert(r.status === 'FAIL', `删 ui-spec 后仍须 FAIL，got ${r.status}: ${r.details}`);
      assert(r.failureKind === 'ui_scope_violation', `failureKind=${r.failureKind}`);
    });
    // 无 ui-spec 的 feature（从建库起就没有）：改未声明 UI 同样拦——UI 保护面不依赖 ui-spec 在场
    const { root: root2 } = setupHost({ uiSpec: false });
    withTrust(root2, () => {
      anchor(root2);
      w(root2, UNDECLARED, '@Component struct X { build() {} }');
      const r2 = gate(root2);
      assert(r2.status === 'FAIL', `无 ui-spec feature 改 UI 也须 FAIL，got ${r2.status}: ${r2.details}`);
    });
  });

  run(results, '无 UI 文件变更 → PASS（白名单不咨询；缺快照不误伤非 UI 改动）', () => {
    const { root } = setupHost();
    withTrust(root, () => {
      anchor(root, { snapshot: false }); // 故意不建快照——无 UI 改动时不得因此 FAIL
      w(root, '02-Feature/FinancialCard/src/main/ets/model/CardData.ets', 'export const cards = [];');
      const r = gate(root);
      assert(r.status === 'PASS', `非 UI 改动须 PASS，got ${r.status}: ${r.details}`);
      assert(r.details.includes('未咨询'), `PASS 详情须声明白名单未咨询：${r.details}`);
    });
  });

  run(results, 'coding base write-once：resume 复用原 SHA，不重取 HEAD', () => {
    const { root } = setupHost();
    withTrust(root, () => {
      anchor(root);
      const first = git(root, ['rev-parse', 'HEAD']);
      w(root, DECLARED, 'struct CardPackPage { build() { Text("v2") } }');
      git(root, ['add', '-A']);
      git(root, ['commit', '-qm', 'later']);
      const rec = recordCodingBase({
        projectRoot: root, feature: FEATURE, runId: RUN_ID, baseSha: git(root, ['rev-parse', 'HEAD']),
      });
      assert(rec.kind === 'reused', `第二次记录须 reused，got ${rec.kind}`);
      assert(rec.kind === 'reused' && rec.body.base_sha === first, 'resume 须复用最初 SHA');
    });
  });

  return results;
}
