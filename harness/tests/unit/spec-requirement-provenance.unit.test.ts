// spec-requirement-provenance.unit.test.ts — plan c8e5b3f1 t1
//
// 阶段驱动 `/spec` 手动 L2 闭环：derive.requirement 候选链插入 fidelity-intent SSOT 段
// （valid + requirement_provenance==='explicit_cli' + execution_identity 匹配当前
// `phase:<feature>:spec`）。SSOT 夹具一律由真实 writer `initializeFidelityRouting`
//（fidelity-intent-init / goal-runner preflight 共用）产出，不手写 JSON 冒充当前行为；
// 仅"旧版 SSOT（无字段）"与"corrupt"两类反例需手工构造（它们本就不是当前 writer 产物）。

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import {
  resolveCapabilityReport,
  type CapabilityResolutionReport,
  type InputResolution,
} from '../../scripts/utils/capability-resolution';
import { initializeFidelityRouting, evaluateFidelityTierPreflight } from '../../scripts/utils/goal-preflight';
import { resolveRequirementInput } from '../../scripts/utils/goal-manifest';
import type { GoalManifest } from '../../scripts/utils/goal-manifest';
import { resolvePhaseCapabilityAdvisory } from '../../scripts/goal-runner';
import { detectRepoLayout } from '../../repo-layout';
import {
  loadFidelityIntentSsot,
  loadFidelityIntentSsotState,
  fidelityIntentSsotPath,
  resolveFidelityRoutingDecision,
  writeCapabilitySnapshot,
  type FidelityRoutingDecision,
} from '../../scripts/utils/fidelity-shared';
import { loadResolvedProfile } from '../../profile-loader';
import { clearFrameworkConfigCache, featureFilePath, loadFrameworkConfig } from '../../config';
import type { UnitCaseResult } from '../run-unit';

const FRAMEWORK_ROOT = path.resolve(__dirname, '..', '..', '..');
const HARNESS_ROOT = path.resolve(__dirname, '..', '..');

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

function mkProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-spec-prov-'));
  fs.mkdirSync(path.join(root, 'doc', 'features'), { recursive: true });
  return root;
}

function specRequirementInput(report: CapabilityResolutionReport): InputResolution {
  const capability = report.capabilities.find((c) => c.id === 'capability_spec_requirement');
  assert(capability, 'spec 契约须含 capability_spec_requirement');
  const input = capability!.inputs.find((i) => i.id === 'requirement');
  assert(input, 'capability_spec_requirement 须含 requirement input');
  return input!;
}

function resolveSpecReport(root: string, extra?: Partial<Parameters<typeof resolveCapabilityReport>[0]>): CapabilityResolutionReport {
  return resolveCapabilityReport({
    frameworkRoot: FRAMEWORK_ROOT,
    projectRoot: root,
    feature: 'demo',
    phase: 'spec',
    track: 'full',
    ...extra,
  });
}

/** lite change 阶段的 requirement 输入（change-lite contract: capability_change_context/requirement）。 */
function changeRequirementInput(report: CapabilityResolutionReport): InputResolution {
  const capability = report.capabilities.find((c) => c.id === 'capability_change_context');
  assert(capability, 'change-lite 契约须含 capability_change_context');
  const input = capability!.inputs.find((i) => i.id === 'requirement');
  assert(input, 'capability_change_context 须含 requirement input');
  return input!;
}

function resolveChangeReport(root: string): CapabilityResolutionReport {
  return resolveCapabilityReport({
    frameworkRoot: FRAMEWORK_ROOT,
    projectRoot: root,
    feature: 'demo',
    phase: 'change',
    track: 'lite',
  });
}

/** 用真实 writer 落一份 explicit_cli / intent_fallback / goal_manifest 的 SSOT。 */
function writeRealSsot(
  root: string,
  opts: { requirement?: string; provenance: 'explicit_cli' | 'intent_fallback' | 'goal_manifest'; identity?: string },
): void {
  initializeFidelityRouting({
    projectRoot: root,
    frameworkRoot: FRAMEWORK_ROOT,
    feature: 'demo',
    requirement: opts.requirement,
    featuresDirRel: 'doc/features',
    executionIdentity: opts.identity ?? 'phase:demo:spec',
    requirementProvenance: opts.provenance,
  });
}

/** 手工构造旧版 SSOT（当前 writer 不会再产出——旧版本 writer 产物，字段全部合法但无
 * requirement_provenance）。 */
function writeLegacySsot(root: string): string {
  const d: FidelityRoutingDecision = resolveFidelityRoutingDecision({
    requirementText: 'legacy requirement',
    capability: { hasVision: false, ocrAvailable: false },
    executionIdentity: 'phase:demo:spec',
    requirementSha: 'a'.repeat(64),
  });
  const p = fidelityIntentSsotPath(root, 'demo');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const doc = {
    schema_version: '2.0',
    inferred_fidelity: d.inferred,
    selected_fidelity: d.selected,
    effective_fidelity: d.effective,
    acceptance_strictness: d.strictness,
    asset_acquisition_mode: d.assetAcquisitionMode,
    clamped: d.clamped,
    ...(d.clampReason ? { clamp_reason: d.clampReason } : {}),
    decision: d.decision,
    execution_identity: 'phase:demo:spec',
    requirement_sha256: 'a'.repeat(64),
    // 无 requirement_provenance —— 旧版 writer 产物
  };
  fs.writeFileSync(p, JSON.stringify(doc, null, 2), 'utf-8');
  return p;
}

function writeChangeMd(root: string, feature = 'demo'): string {
  const p = path.join(root, 'doc', 'features', feature, 'change.md');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, '# change\n需求变更记录（legacy 兜底）\n', 'utf-8');
  return p;
}

function writeBroadDocs(root: string, feature = 'demo'): void {
  const featRoot = path.join(root, 'doc', 'features', feature);
  fs.mkdirSync(featRoot, { recursive: true });
  fs.writeFileSync(path.join(featRoot, 'README.md'), '# feature 说明（非权威需求）\n', 'utf-8');
  fs.writeFileSync(path.join(featRoot, 'empty.md'), '', 'utf-8');
  fs.writeFileSync(path.join(featRoot, 'investigation-notes.md'), '调查笔记：怀疑某模块有 bug。\n', 'utf-8');
  const specDir = path.join(featRoot, 'spec');
  fs.mkdirSync(specDir, { recursive: true });
  fs.writeFileSync(path.join(specDir, 'spec.md'), '## spec\n阶段自产物，非输入来源。\n', 'utf-8');
}

interface Case { name: string; run: () => void }

const cases: Case[] = [
  {
    name: 't1-① goal manifest 在场 → resolved 且 deps 仍为空（goal 路径逐元素零变化锁）',
    run: () => {
      const root = mkProject();
      try {
        const report = resolveSpecReport(root, { requirement: 'design an account page' });
        const input = specRequirementInput(report);
        assert(input.state === 'resolved', `state=${input.state}`);
        assert(input.attempts[0].dependencies.length === 0, 'goal 分支 deps 恒为空（不指纹 change.md）');
        assert((input.attempts[0].detail ?? '').startsWith('goal_requirement:'), `detail=${input.attempts[0].detail}`);
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
    },
  },
  {
    name: 't1-② 真实 writer 产 explicit_cli SSOT → resolved，attempt deps 含 fidelity-intent.json 真实 path+sha256',
    run: () => {
      const root = mkProject();
      try {
        writeRealSsot(root, { requirement: 'design an account page', provenance: 'explicit_cli' });
        const report = resolveSpecReport(root);
        const input = specRequirementInput(report);
        assert(input.state === 'resolved', `state=${input.state}`);
        assert((input.attempts[0].detail ?? '').startsWith('fidelity_intent_ssot:'), `detail=${input.attempts[0].detail}`);
        const ssotPath = fidelityIntentSsotPath(root, 'demo');
        const dep = input.attempts[0].dependencies.find((d) => d.role === 'derive');
        assert(dep, 'SSOT 段须绑 derive 依赖');
        assert(path.resolve(dep!.path) === path.resolve(ssotPath), `dep.path=${dep!.path} 应为 ${ssotPath}`);
        assert(dep!.exists, 'SSOT 文件存在');
        assert(dep!.sha256 && /^[0-9a-f]{64}$/.test(dep!.sha256), `dep.sha256=${dep!.sha256}`);
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
    },
  },
  {
    name: 't1-③ 反例锁：只跑 Step 1 不给需求（intent_fallback）→ 不解锁',
    run: () => {
      const root = mkProject();
      try {
        writeRealSsot(root, { requirement: undefined, provenance: 'intent_fallback' });
        const report = resolveSpecReport(root);
        const input = specRequirementInput(report);
        assert(input.state === 'absent', `intent_fallback 不得解锁，state=${input.state}`);
        const cap = report.capabilities.find((c) => c.id === 'capability_spec_requirement')!;
        assert(cap.state === 'blocked', `capability.state=${cap.state}`);
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
    },
  },
  {
    name: 't1-③ 反例锁：旧版 SSOT（无 requirement_provenance 字段）→ 不解锁且不判 corrupt（legacy 兼容）',
    run: () => {
      const root = mkProject();
      try {
        writeLegacySsot(root);
        const state = loadFidelityIntentSsotState(root, 'demo');
        assert(state.state === 'valid', `旧版 SSOT 不得判 corrupt，state=${state.state}`);
        assert(loadFidelityIntentSsot(root, 'demo') !== null, '旧版 SSOT 可正常加载（legacy）');
        const report = resolveSpecReport(root);
        const input = specRequirementInput(report);
        assert(input.state === 'absent', `缺字段旧 SSOT 不解锁，state=${input.state}`);
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
    },
  },
  {
    name: 't1-③ 反例锁：字段在场但枚举非法（如 \'cli\'）→ 判 corrupt',
    run: () => {
      const root = mkProject();
      try {
        writeLegacySsot(root);
        const p = fidelityIntentSsotPath(root, 'demo');
        const doc = JSON.parse(fs.readFileSync(p, 'utf-8'));
        doc.requirement_provenance = 'cli'; // 非法枚举
        fs.writeFileSync(p, JSON.stringify(doc, null, 2), 'utf-8');
        const state = loadFidelityIntentSsotState(root, 'demo');
        assert(state.state === 'corrupt', `非法枚举须判 corrupt，state=${state.state}`);
        assert(loadFidelityIntentSsot(root, 'demo') === null, 'corrupt 不得当权威输入');
        const report = resolveSpecReport(root);
        const input = specRequirementInput(report);
        assert(input.state === 'absent', `corrupt 按 absent 继续，state=${input.state}`);
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
    },
  },
  {
    name: 't1-③ 反例锁：execution_identity 是历史 goal run → 不解锁（不跨身份导入残留决策）',
    run: () => {
      const root = mkProject();
      try {
        writeRealSsot(root, {
          requirement: 'design an account page',
          provenance: 'explicit_cli',
          identity: '20260724T000000Z-goal1', // 历史 goal run 身份
        });
        const report = resolveSpecReport(root);
        const input = specRequirementInput(report);
        assert(input.state === 'absent', `跨身份不得解锁，state=${input.state}`);
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
    },
  },
  {
    name: 't1-③ 反例锁：SSOT corrupt → 按 absent 继续且不升 invalid（不抢 fidelity 门禁裁决权）',
    run: () => {
      const root = mkProject();
      try {
        const p = fidelityIntentSsotPath(root, 'demo');
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, JSON.stringify({ schema_version: '2.0', selected_fidelity: 'pixel_1to1' }), 'utf-8');
        assert(loadFidelityIntentSsotState(root, 'demo').state === 'corrupt', '不完整 SSOT 判 corrupt');
        const report = resolveSpecReport(root);
        const input = specRequirementInput(report);
        assert(input.state === 'absent', `corrupt 不得升 invalid，state=${input.state}`);
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
    },
  },
  {
    name: 't1-③ 反例锁：feature 根只有宽泛文档（README/空 .md/笔记/spec.md）→ 不解锁',
    run: () => {
      const root = mkProject();
      try {
        writeRealSsot(root, { requirement: undefined, provenance: 'intent_fallback' });
        writeBroadDocs(root);
        const report = resolveSpecReport(root);
        const input = specRequirementInput(report);
        assert(input.state === 'absent', `宽泛文本不得当需求来源，state=${input.state}`);
        const cap = report.capabilities.find((c) => c.id === 'capability_spec_requirement')!;
        assert(cap.state === 'blocked', '宽泛文本不得解锁 on_missing:fail');
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
    },
  },
  {
    name: 't1-④ change.md 现状不变——full 轨遗留 change.md 仍 resolved（回归锁）；且 fallback 依赖同绑 SSOT 路径（review P1）',
    run: () => {
      const root = mkProject();
      try {
        writeChangeMd(root);
        const report = resolveSpecReport(root);
        const input = specRequirementInput(report);
        assert(input.state === 'resolved', `change.md legacy 仍可解，state=${input.state}`);
        assert(input.attempts[0].detail === writeChangeMd(root), `detail=${input.attempts[0].detail}`);
        // review P1：change.md fallback 必须**无条件**绑 SSOT 路径（即使 SSOT 缺失，exists:false）
        // ——否则"先经 change.md 形成旧 closure，再签发 explicit_cli SSOT"时旧 closure 不会 stale。
        const deriveDeps = input.attempts[0].dependencies.filter((d) => d.role === 'derive');
        const ssotPath = fidelityIntentSsotPath(root, 'demo');
        assert(deriveDeps.some((d) => path.resolve(d.path) === path.resolve(ssotPath)), 'change.md fallback 须绑 SSOT 路径');
        const ssotDep = deriveDeps.find((d) => path.resolve(d.path) === path.resolve(ssotPath))!;
        assert(ssotDep.exists === false, 'SSOT 缺失时 fallback 以 exists:false 记录（后续出现即能令 closure stale）');
        assert(deriveDeps.some((d) => path.resolve(d.path) === writeChangeMd(root)), 'change.md 本身仍绑定');
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
    },
  },
  {
    name: 't1-④\' lite change 阶段零变化回归：SSOT 存在也不影响 change 的纯 change.md 分支（review P1 回归锁）',
    run: () => {
      const root = mkProject();
      try {
        // 先造一份 spec explicit_cli SSOT（若 SSOT 无条件参与 change 解析，会把 change deps 变 exists:false→true）
        writeRealSsot(root, { requirement: '账户页。', provenance: 'explicit_cli' });
        writeChangeMd(root);
        const input = changeRequirementInput(resolveChangeReport(root));
        assert(input.state === 'resolved', `change.md 仍 resolved，state=${input.state}`);
        const deriveDeps = input.attempts[0].dependencies.filter((d) => d.role === 'derive');
        const ssotPath = fidelityIntentSsotPath(root, 'demo');
        // change 阶段不得加载/绑定 SSOT——否则 spec SSOT 的创建会让语义未变的 change closure 判 stale
        assert(!deriveDeps.some((d) => path.resolve(d.path) === path.resolve(ssotPath)),
          'lite change 阶段不得绑 SSOT 路径（纯 change.md 分支零变化）');
        assert(deriveDeps.length === 1 && path.resolve(deriveDeps[0]!.path) === writeChangeMd(root),
          `change 阶段 deps 应仅 [change.md]，实际=${JSON.stringify(deriveDeps.map(d => path.basename(d.path)))}`);
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
    },
  },
  {
    name: 't1-⑤ 三段全无 → blocked，detail 列出三段来源与两条修复路径（不写"框架缺陷"）',
    run: () => {
      const root = mkProject();
      try {
        const report = resolveSpecReport(root);
        const input = specRequirementInput(report);
        assert(input.state === 'absent', `state=${input.state}`);
        const cap = report.capabilities.find((c) => c.id === 'capability_spec_requirement')!;
        assert(cap.state === 'blocked', `capability.state=${cap.state}`);
        const detail = input.attempts[0].detail ?? '';
        assert(detail.includes('goal manifest'), 'detail 应列 goal manifest 段');
        assert(detail.includes('fidelity-intent'), 'detail 应列 SSOT 段');
        assert(detail.includes('change.md'), 'detail 应列 legacy 段');
        assert(detail.includes('fidelity-intent-init --feature'), '手动修复路径①');
        assert(detail.includes('--requirement-file'), '手动修复路径②');
        assert(!/框架缺陷/.test(detail), '不得写"框架缺陷"');
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
    },
  },
  {
    name: 't1-⑥ resolveRequirementInput 互斥 fail-closed + 空文件拒绝（复用共享解析，不新写）',
    run: () => {
      const root = mkProject();
      try {
        let threw = false;
        try { resolveRequirementInput({ requirement: 'a', requirementFile: 'b', projectRoot: root }); } catch { threw = true; }
        assert(threw, '--requirement 与 --requirement-file 互斥须 fail-closed');
        assert(resolveRequirementInput({ requirement: 'a   ', projectRoot: root }) === 'a   ', 'inline 原样返回（不 trim 不查空——resolver 既有语义）');
        const file = path.join(root, 'req.txt');
        fs.writeFileSync(file, '  需求文件内容  \n', 'utf-8');
        assert(resolveRequirementInput({ requirementFile: file, projectRoot: root }) === '需求文件内容', 'file 分支读内容（trim 后）');
        const emptyFile = path.join(root, 'empty.txt');
        fs.writeFileSync(emptyFile, '   \n', 'utf-8');
        threw = false;
        try { resolveRequirementInput({ requirementFile: emptyFile, projectRoot: root }); } catch { threw = true; }
        assert(threw, '空文件须 fail-closed');
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
    },
  },
  {
    name: 't1-⑥ 组合例：--requirement "   " --requirement-file valid.txt → 由本 CLI 局部预检 fail-fast（共享 resolver 不改）',
    run: () => {
      const root = mkProject();
      // review P1：CLI 经 detectRepoLayout(__dirname) 把 projectRoot 解析到**真实仓根**，固定 feature
      // 会写入/覆盖仓内 doc/features/<f>。用唯一 feature 名避免覆盖用户数据，并在 finally 精确清理
      // 真实输出（SSOT + capability-snapshot 由 initializeFidelityRouting 一起写）。
      const feature = `__cli_prov_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
      // review P2：清理路径必须与 CLI 内部解析的 projectRoot 完全一致（CLI 用 detectRepoLayout(__dirname)
      // 解析）——FRAMEWORK_ROOT 只在 standalone 布局等于 projectRoot，consumer 下会清理到错误的
      // <projectRoot>/framework/doc/... 仍泄漏。detectRepoLayout(__dirname) 与 CLI 同源，双布局都正确。
      const cliProjectRoot = detectRepoLayout(__dirname).projectRoot;
      const realOutputDir = path.join(cliProjectRoot, 'doc', 'features', feature);
      try {
        const file = path.join(root, 'valid.txt');
        fs.writeFileSync(file, 'valid requirement\n', 'utf-8');
        const cli = path.join(HARNESS_ROOT, 'scripts', 'fidelity-intent-init.ts');
        const runCli = (extraArgs: string[]) => spawnSync(
          process.platform === 'win32' ? 'npx.cmd' : 'npx',
          ['ts-node', cli, '--feature', feature, ...extraArgs],
          { cwd: HARNESS_ROOT, encoding: 'utf-8', shell: process.platform === 'win32' },
        );
        // 显式空 --requirement 即便与有效 --requirement-file 同给，也必须 fail-fast（不许 file 分支盖过）
        const combo = runCli(['--requirement', '   ', '--requirement-file', file]);
        assert(combo.status !== 0, `组合例须 fail-fast，status=${combo.status}`);
        assert((combo.stderr ?? '').includes('BLOCKER'), 'fail-fast 消息含 BLOCKER');
        // 反证：只给有效 --requirement-file 应正常走（exit 0，SSOT 落 explicit_cli，不因预检误杀）
        const onlyFile = runCli(['--requirement-file', file]);
        assert(onlyFile.status === 0, `只给有效 --requirement-file 不得被预检误杀，status=${onlyFile.status}, stderr=${onlyFile.stderr}`);
        // 该有效 case 确实落根（证明本 CLI 会写真实仓根）——故 finally 必须清理
        const ssotPath = path.join(realOutputDir, 'spec', 'reports', 'fidelity-intent.json');
        assert(fs.existsSync(ssotPath), '有效 --requirement-file 应落 SSOT（供 finally 精确清理验证）');
        // 行为断言（P2-1）：CLI 有效 case 落盘 provenance 应为 explicit_cli（非源码正则）
        const cliSsot = JSON.parse(fs.readFileSync(ssotPath, 'utf-8')) as { requirement_provenance?: string };
        assert(cliSsot.requirement_provenance === 'explicit_cli',
          `CLI explicit 入口应落 explicit_cli，实际=${cliSsot.requirement_provenance}`);
        // 行为断言（P2-2）：CLI 无需求（仅兜底）→ 落 intent_fallback（证明"CLI 在无需求时选
        // intent_fallback"，而非仅 writer 会持久化给定值）。先清掉 explicit SSOT 再重跑。
        fs.rmSync(path.join(realOutputDir), { recursive: true, force: true });
        const noReq = runCli([]);
        assert(noReq.status === 0, `CLI 无需求应正常走（intent_fallback），status=${noReq.status}, stderr=${noReq.stderr}`);
        assert(fs.existsSync(ssotPath), 'CLI 无需求也应落 SSOT（intent_fallback）');
        const fallbackSsot = JSON.parse(fs.readFileSync(ssotPath, 'utf-8')) as { requirement_provenance?: string };
        assert(fallbackSsot.requirement_provenance === 'intent_fallback',
          `CLI 无需求应落 intent_fallback，实际=${fallbackSsot.requirement_provenance}`);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
        if (fs.existsSync(realOutputDir)) fs.rmSync(realOutputDir, { recursive: true, force: true });
      }
    },
  },
  {
    name: 't1-⑥\' 三调用点接线为**行为断言**（读回 SSOT 落盘 provenance，非源码正则）：goal-preflight 产 goal_manifest；initializer 产 explicit_cli / intent_fallback',
    run: () => {
      const root = mkProject();
      try {
        const readProvenance = (): string | undefined =>
          loadFidelityIntentSsot(root, 'demo')?.requirement_provenance;
        // ① goal-preflight 真实调用点 evaluateFidelityTierPreflight → 落 goal_manifest
        const goalManifest = {
          feature: 'demo', run_id: 'r-prov-goal', requirement: 'goal 需求：账户页。',
        } as unknown as GoalManifest;
        evaluateFidelityTierPreflight({
          projectRoot: root, frameworkRoot: FRAMEWORK_ROOT, manifest: goalManifest,
          featuresDirRel: 'doc/features', chainStartsAtSpec: false,
        });
        assert(readProvenance() === 'goal_manifest', `goal-preflight 应落 goal_manifest，实际=${readProvenance()}`);
        // ①' 第三个调用点 goal-runner（resolvePhaseCapabilityAdvisory 的 vision policy 收紧重建）→ 落 goal_manifest
        // 触发条件：capability snapshot 记 vision.verdict=true 而 live policy 判盲（收紧重建路径）。
        // 需要最小 framework.config.json + framework.local.json + spec.md（UI 相关）使 advisory 不致提前 return null。
        fs.writeFileSync(path.join(root, 'framework.config.json'), JSON.stringify({
          schema_version: '1.1', project_name: 'prov-test',
          project_profile: { name: 'generic' },
          paths: { features_dir: 'doc/features', docs_committed: false },
          materialized_adapters: ['generic'],
        }), 'utf-8');
        fs.writeFileSync(path.join(root, 'framework.local.json'),
          JSON.stringify({ schema_version: '1.0', agent_adapter: 'generic' }), 'utf-8');
        clearFrameworkConfigCache();
        const specPath = featureFilePath(root, 'demo', path.join('spec', 'spec.md'));
        fs.mkdirSync(path.dirname(specPath), { recursive: true });
        fs.writeFileSync(specPath, '# spec\n\n```yaml\nui_change: new_or_changed\n```\n', 'utf-8');
        // 造一份 vision.verdict=true 的 capability snapshot（live policy 无视觉 → 触发 runner 收紧重建）
        const dRule = resolveFidelityRoutingDecision({
          requirementText: '账户页。', capability: { hasVision: true, ocrAvailable: true },
          executionIdentity: 'r-prov-runner', requirementSha: 'b'.repeat(64),
        });
        writeCapabilitySnapshot(root, 'demo', {
          execution_identity: 'r-prov-runner',
          decision_id: dRule.decision.decision_id,
          vision: { verdict: true, source: 'test-vision' },
          ocr: { verdict: true, source: 'test-ocr' },
        });
        const runnerManifest = {
          feature: 'demo', run_id: 'r-prov-runner', requirement: '账户页。', adapter: 'generic',
        } as unknown as GoalManifest;
        resolvePhaseCapabilityAdvisory(
          runnerManifest, root, FRAMEWORK_ROOT,
          loadResolvedProfile(root, loadFrameworkConfig(root)), 'spec',
        );
        // review P2：单断言 provenance=goal_manifest 有假阳性——前面 evaluateFidelityTierPreflight
        // 已写过 goal_manifest（identity=r-prov-goal），即使本调用没触发收紧重建也会通过。
        // 同时断言 execution_identity==='r-prov-runner' 才能证明第三个调用点**确实重建**了 SSOT。
        const runnerSsot = loadFidelityIntentSsot(root, 'demo')!;
        assert(runnerSsot.requirement_provenance === 'goal_manifest',
          `goal-runner 收紧重建应落 goal_manifest，实际=${runnerSsot.requirement_provenance}`);
        assert(runnerSsot.execution_identity === 'r-prov-runner',
          `goal-runner 收紧重建应重签 SSOT（identity=r-prov-runner），实际=${runnerSsot.execution_identity}`);
        // ② initializer 显式非空需求 → explicit_cli
        writeRealSsot(root, { requirement: '账户页。', provenance: 'explicit_cli' });
        assert(readProvenance() === 'explicit_cli', `explicit_cli 应落盘，实际=${readProvenance()}`);
        // ③ initializer 无需求（仅兜底）→ intent_fallback
        writeRealSsot(root, { requirement: undefined, provenance: 'intent_fallback' });
        assert(readProvenance() === 'intent_fallback', `intent_fallback 应落盘，实际=${readProvenance()}`);
        // 必填字段本身由 TS 编译保证（漏传即编译不过）；此处只证"调用点传的值确实落进了 SSOT"。
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
    },
  },
  {
    name: 't1-⑦ 血缘机制：change.md 先形成 closure → 重签 explicit_cli SSOT → 绑定 SSOT 路径由 exists:false 翻转为 exists:true（旧 closure 判决 stale 的输入）',
    run: () => {
      const root = mkProject();
      try {
        const ssotPath = fidelityIntentSsotPath(root, 'demo');
        // 阶段一：只有 change.md（无 SSOT）→ change.md fallback resolved，SSOT 路径以 exists:false 绑定
        writeChangeMd(root);
        const before = specRequirementInput(resolveSpecReport(root)).attempts[0]
          .dependencies.find((d) => d.role === 'derive' && path.resolve(d.path) === path.resolve(ssotPath))!;
        assert(before.exists === false && before.sha256 === null, `SSOT 缺失时 exists:false（exists=${before.exists}, sha=${before.sha256}）`);
        // 阶段二：带显式需求重跑 Step 1（SSOT 重新签发，writer 唯一）→ 现在走 SSOT 段
        writeRealSsot(root, { requirement: '账户页含余额与转账入口。', provenance: 'explicit_cli' });
        const after = specRequirementInput(resolveSpecReport(root)).attempts[0]
          .dependencies.find((d) => d.role === 'derive' && path.resolve(d.path) === path.resolve(ssotPath))!;
        assert(after.exists === true && after.sha256 && before.sha256 !== after.sha256,
          `重签后 SSOT 由 exists:false→true 且 sha 变化（${before.sha256} → ${after.sha256}）`);
        // 既有 closure 血缘（capabilityResolutionEvidenceInputs → productionEvidence）以该路径的
        // exists:false + 无 sha 记录为输入证据；文件由缺失变为存在 → 记录失配 → 旧 closure 判 stale。
        // —— 该链的完整 closure 级 stale 翻转断言（真产 closure + receipt 链）归批 2（P2-2）。
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
    },
  },
];

export function runAll(): UnitCaseResult[] {
  return cases.map((c) => {
    try {
      c.run();
      return { name: `spec-requirement-provenance: ${c.name}`, ok: true };
    } catch (err) {
      return { name: `spec-requirement-provenance: ${c.name}`, ok: false, error: (err as Error).stack ?? (err as Error).message };
    }
  });
}