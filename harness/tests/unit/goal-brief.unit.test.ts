// ============================================================================
// goal-brief.unit.test.ts — 目标简报同源注入（plan 33784ed1 §3，验收 A1/A2/A3/A5）
// ============================================================================
// A1/A5 走生产入口：真 harness-runner 子进程（ut 夹具，能签发 verifier subject）产出的
// ai-prompt.md、材料视图与控制台，加上同一工程上的 buildPhasePrompt 与 runVisualProviderReview。

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { assembleGoalBrief, renderGoalBrief, resolvedInputsCarryRequirement } from '../../scripts/utils/goal-brief';
import { collectCurrentRequirementText } from '../../scripts/utils/fidelity-shared';
import { buildGoalManifestFromInput, mergeSuccessorRequirement, type GoalManifest } from '../../scripts/utils/goal-manifest';
import { createGoalRun } from '../../scripts/utils/goal-run-creation';
import { featureEffectiveScope, readFeatureFrozenScope } from '../../scripts/utils/feature-execution-scope';
import { buildPhasePrompt } from '../../scripts/goal-phase-runtime';
import { diffVerifierMaterial, readVerifierMaterialOrNull } from '../../scripts/utils/verifier-material';
import { runVisualProviderReview } from '../../../profiles/hmos-app/harness/visual-provider-review';
import { clearFrameworkConfigCache } from '../../config';
import { setupRealUtHarnessProject } from './coverage-evidence.unit.test';
import type { ResolvedPhaseInputs } from '../../scripts/utils/capability-resolution';
import type { UnitCaseResult } from '../run-unit';

const FRAMEWORK_ROOT = path.resolve(__dirname, '..', '..', '..');

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function put(root: string, rel: string, content: string): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
}

const REF_ELEMENTS_EXCLUDED = [
  'schema_version: "1.0"',
  'elements:',
  '  - element_id: result_nfc_card',
  '    disposition: excluded',
  '    requirement_quote: "本次不做 NFC 卡"',
  '  - element_id: result_done',
  '    disposition: implement',
  '',
].join('\n');

const SPEC_WITH_SCOPE = [
  '# spec',
  '',
  '## Scope 声明',
  '',
  '```yaml',
  'in_scope_modules: [demo]',
  'out_of_scope_modules: [payment]',
  'rationale: 只改 demo',
  '```',
  '',
].join('\n');

/** "明确不做"一栏的文本（不含简报总标题）——各注入点必须逐字包含它。 */
function exclusionsSection(root: string, feature: string): string {
  const text = renderGoalBrief(assembleGoalBrief(root, feature), { sections: ['exclusions'] });
  const at = text.indexOf('### 明确不做');
  assert(at >= 0, `构造性前提：工程须有明确不做一栏，实得：${text}`);
  return text.slice(at);
}

function withTmp(fn: (root: string) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-brief-'));
  clearFrameworkConfigCache();
  try { fn(root); } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
}

const cases: Array<{ name: string; run: () => void | Promise<void> }> = [
  {
    name: 'A2 需求原文不可得：简报如实写明，明确不做/判定办法照常；无 run 不出权限栏',
    run: () => withTmp(root => {
      put(root, 'doc/features/demo/spec/ref-elements.yaml', REF_ELEMENTS_EXCLUDED);
      put(root, 'doc/features/demo/spec/spec.md', SPEC_WITH_SCOPE);
      const brief = assembleGoalBrief(root, 'demo', { runId: '' });
      assert(brief.requirement === null, `无 run、无 SSOT 时需求须不可得，实得 ${JSON.stringify(brief.requirement)}`);
      const text = renderGoalBrief(brief);
      assert(text.includes('需求原文不可得'), `须如实写明需求不可得：${text}`);
      assert(text.includes('参考图元素 result_nfc_card：「本次不做 NFC 卡」'), `排除项须带引文：${text}`);
      assert(!text.includes('result_done'), 'implement 元素不是排除项');
      assert(text.includes('spec 出范围模块：payment'), `spec 出范围模块须进明确不做：${text}`);
      assert(text.includes('即使尚未登记'), '明确不做须提示需求原文里的排除同样有效');
      assert(text.includes('### 判定办法') && text.includes('权威判定'), '判定办法恒有');
      assert(!text.includes('### 已授予的权限'), '无 run 时省略权限栏');
      assert(!text.includes('### 已裁决的冲突'), '批一无拒修记录，省略该栏');
      // 两栏都没有 → 控制台两栏渲染为空串（不打印）
      assert(renderGoalBrief({ requirement: null, resolved_conflicts: [] }, { sections: ['exclusions', 'resolved_conflicts'] }) === '',
        '明确不做与已裁决的冲突都为空时控制台两栏不打印');
    }),
  },
  {
    name: 'goal run：需求取本 run 冻结文本（含本轮修复增量）、不重读源文件；权限栏来自 effectiveHeadlessUnattended；既有需求收集不变',
    run: () => withTmp(root => {
      put(root, 'framework.config.json', JSON.stringify({ schema_version: '1.1', project_name: 'brief', paths: { features_dir: 'doc/features' } }));
      put(root, 'req/source.md', 'SOURCE_FILE_BODY_ONLY_IN_FILE\n');
      const requirement = mergeSuccessorRequirement('首页展示余额', '修复：余额位数');
      const manifest = buildGoalManifestFromInput({
        feature: 'demo', run_id: 'brief-run', requirement, requirement_source_files: ['req/source.md'],
        unattended: { write_mode: 'workspace-write', approval_mode: 'on-request' },
      }, { projectRoot: root });
      createGoalRun({ projectRoot: root, manifest, chain: ['spec'] });
      const brief = assembleGoalBrief(root, 'demo', { runId: 'brief-run' });
      assert(brief.requirement === requirement.trim(), `须取冻结的 manifest.requirement，实得 ${JSON.stringify(brief.requirement)}`);
      assert(brief.requirement.includes('本轮修复增量'), '后继增量随冻结文本进入简报');
      assert(!renderGoalBrief(brief).includes('SOURCE_FILE_BODY_ONLY_IN_FILE'), '简报不重读需求源文件');
      assert(brief.permissions?.write_mode === 'full-access' && brief.permissions.approval_mode === 'never',
        `权限栏取 effectiveHeadlessUnattended，实得 ${JSON.stringify(brief.permissions)}`);
      // 共用身份解析后，既有函数行为不变：run 分支仍拼 requirement_source_files 原文
      const prev = process.env.MAISON_GOAL_RUN_ID;
      process.env.MAISON_GOAL_RUN_ID = 'brief-run';
      try {
        const collected = collectCurrentRequirementText(root, 'demo');
        assert(collected.includes('首页展示余额') && collected.includes('SOURCE_FILE_BODY_ONLY_IN_FILE'), `既有收集须仍拼源文件：${collected}`);
        assert(assembleGoalBrief(root, 'demo').requirement === requirement.trim(), '缺省取 MAISON_GOAL_RUN_ID');
        process.env.MAISON_GOAL_RUN_ID = 'not-authoritative';
        assert(collectCurrentRequirementText(root, 'demo') === '', '非权威 run 仍返回空串，不回落无 run 分支');
        assert(assembleGoalBrief(root, 'demo').requirement === null, '非权威 run 的简报如实不可得');
      } finally {
        if (prev === undefined) delete process.env.MAISON_GOAL_RUN_ID; else process.env.MAISON_GOAL_RUN_ID = prev;
      }
    }),
  },
  {
    name: 'A3 装配去重：verifier 已解析输入里已有需求正文时，简报不重复需求正文',
    run: () => {
      const brief = { requirement: 'REQUIREMENT_BODY_7f3', resolved_conflicts: [] };
      const binding = (provider: string) => ({ input_id: 'requirement', source: { kind: 'derive', provider_id: provider }, dependencies: [], source_refs: [], content_fingerprint: 'x' });
      const inputs = (value: unknown, provider = 'derive.requirement') => ({
        context: {}, phase: 'spec', artifacts: {},
        values: { requirement: { state: 'resolved', value, binding: binding(provider) } },
      }) as unknown as ResolvedPhaseInputs;
      assert(resolvedInputsCarryRequirement(inputs('REQUIREMENT_BODY_7f3')), '已解析输入带需求正文 → true');
      assert(!resolvedInputsCarryRequirement(inputs(undefined)), 'goal 分支 derive.requirement 无正文 → false');
      assert(!resolvedInputsCarryRequirement(inputs('x', 'derive.codebase')), '其它 provider 不算需求');
      assert(!resolvedInputsCarryRequirement(undefined), '无已解析输入 → false');
      const dedup = renderGoalBrief(brief, { requirementInContext: true });
      assert(!dedup.includes('REQUIREMENT_BODY_7f3'), `已在上下文时不得重复需求正文：${dedup}`);
      assert(dedup.includes('### 需求原文'), '栏目保留并指明正文所在');
      assert(renderGoalBrief(brief).includes('REQUIREMENT_BODY_7f3'), '未在上下文时照常给需求正文');
    },
  },
  {
    name: 'A1+A5 生产入口：简报变化换 subject（材料差异只有 goal_brief）；执行者/provider/verifier/控制台的明确不做逐字同源',
    run: async () => {
      const p = setupRealUtHarnessProject();
      try {
        const readSummary = () => JSON.parse(fs.readFileSync(p.summaryPath, 'utf8')) as { verifier_subject_id?: string };
        const first = p.run('2026-01-01T00:00:00.000Z');
        const s1 = readSummary().verifier_subject_id;
        assert(typeof s1 === 'string', `构造性前提：首轮须签发 subject\n${first.stdout}\n${first.stderr}`);
        const m1 = readVerifierMaterialOrNull(p.reportsDir, s1);
        assert(m1 && /^[0-9a-f]{64}$/.test((m1 as unknown as { goal_brief_sha256?: string }).goal_brief_sha256 ?? ''), `材料视图须带简报分量：${JSON.stringify(m1)}`);
        assert(!first.stdout.includes('### 明确不做'), '无排除项时控制台不打印两栏');

        // 唯一变量：登记一条 excluded（ut 的材料文件面不含 ref-elements.yaml）。
        p.write(`doc/features/${p.feature}/spec/ref-elements.yaml`, REF_ELEMENTS_EXCLUDED);
        const second = p.run('2026-01-01T00:00:00.000Z');
        const s2 = readSummary().verifier_subject_id;
        assert(typeof s2 === 'string' && s2 !== s1, `简报变化必须换 subject：${s1} → ${s2}\n${second.stdout}\n${second.stderr}`);
        const diff = diffVerifierMaterial(m1, readVerifierMaterialOrNull(p.reportsDir, s2));
        assert(JSON.stringify(diff) === JSON.stringify(['goal_brief']), `材料差异只应是简报：${JSON.stringify(diff)}`);

        const expected = exclusionsSection(p.root, p.feature);
        const aiPrompt = fs.readFileSync(path.join(p.reportsDir, 'ai-prompt.md'), 'utf8');
        assert(aiPrompt.includes(expected), `verifier 提示词须逐字含明确不做：\n${expected}\n---\n${aiPrompt.slice(-2000)}`);
        assert(second.stdout.includes(expected), `控制台须逐字打印明确不做：\n${second.stdout.slice(-2000)}`);
        assert(!second.stdout.includes('### 需求原文') && !second.stdout.includes('### 判定办法'), '控制台只打印两栏');

        const manifest = { feature: p.feature, run_id: 'no-run', requirement: 'REQ_LINE' } as unknown as GoalManifest;
        const executor = buildPhasePrompt(manifest, p.root, 'coding', p.frameworkRoot, []);
        assert(executor.includes(expected), `执行者提示词须逐字含明确不做：\n${executor.slice(0, 3000)}`);
        assert(executor.indexOf('REQ_LINE') < executor.indexOf(expected), '简报块在需求行之后');
        assert(executor.split('REQ_LINE').length === 2, '执行者提示词不重复需求正文');

        const shotDir = path.join(p.root, 'doc', 'features', p.feature, 'device-testing', 'device-screenshots');
        fs.mkdirSync(shotDir, { recursive: true });
        fs.writeFileSync(path.join(shotDir, 'shot.png'), 'shot');
        fs.writeFileSync(path.join(shotDir, 'ref.png'), 'ref');
        fs.writeFileSync(path.join(shotDir, 'visual-diff.json'), JSON.stringify({
          schema_version: '1.1',
          screens: [{
            screen_id: 's1', verdict: 'pending', must_fix: [], defects: [],
            screenshot_path: `doc/features/${p.feature}/device-testing/device-screenshots/shot.png`,
            ref_path: `doc/features/${p.feature}/device-testing/device-screenshots/ref.png`,
          }],
        }));
        let providerPrompt = '';
        await runVisualProviderReview({ projectRoot: p.root, feature: p.feature, fidelityTarget: 'semantic_layout' } as never, {
          frameworkRoot: FRAMEWORK_ROOT,
          provider: { adapter: 'claude', model: 'm' },
          runId: 'R', attemptId: 'A',
          invoke: (async (req: { prompt: string }) => {
            providerPrompt = req.prompt;
            return {
              invoke_id: 'i', provider: { adapter: 'claude', model: 'm' }, purpose: 'review', outcome: 'unavailable',
              reason: 'stub', body: null, duration_ms: 1, image_hashes: [], workspace_dirtied: false, input_provenance: 'unverified',
            };
          }) as never,
        });
        assert(providerPrompt.includes(expected), `provider 提示词须逐字含明确不做：\n${providerPrompt.slice(0, 3000)}`);
        assert(providerPrompt.includes('result_nfc_card(excluded)'), 'refElements 的 id 清单保留');
      } finally {
        p.cleanup();
      }
    },
  },
  {
    name: 'A5 补全 + A1 已裁决的冲突：只有拒修记录变化时 subject 改变（材料差异只有 goal_brief）；执行者/provider/verifier/控制台逐字同源',
    run: async () => {
      const p = setupRealUtHarnessProject();
      const prevRun = process.env.MAISON_GOAL_RUN_ID;
      try {
        const runId = 'brief-decline-run';
        const requirement = '验证 value 读数；本次不做 NFC 卡';
        // run 的有效范围 = 夹具已冻结的 feature 范围（与无 run 时 harness 解析到的同一份输入）
        const scope = featureEffectiveScope(readFeatureFrozenScope(p.root, p.feature)!);
        createGoalRun({
          projectRoot: p.root,
          manifest: buildGoalManifestFromInput({
            feature: p.feature, run_id: runId, requirement,
            unattended: { write_mode: 'workspace-write', approval_mode: 'on-request' },
            execution_scope: scope, phase_chain: [...scope.phase_chain], chain_override: [...scope.phase_chain],
            start_phase: scope.phase_chain[0], end_phase: scope.phase_chain.at(-1),
          } as never, { projectRoot: p.root }),
          chain: [...scope.phase_chain] as never,
        });
        // run 载体的 facts 身份位绑 run_id（feature 载体才绑冻结范围指纹）
        const factsPath = path.join(p.root, 'doc', 'features', p.feature, 'context', 'facts.md');
        fs.writeFileSync(factsPath, fs.readFileSync(factsPath, 'utf8').replace(/^frozen_scope_fingerprint: .*$/m, `run_id: ${runId}`));
        // harness 子进程继承 env：本 run 是当前执行身份
        process.env.MAISON_GOAL_RUN_ID = runId;
        const readSummary = () => JSON.parse(fs.readFileSync(p.summaryPath, 'utf8')) as { verifier_subject_id?: string };
        const first = p.run('2026-01-01T00:00:00.000Z');
        const s1 = readSummary().verifier_subject_id;
        assert(typeof s1 === 'string', `构造性前提：首轮须签发 subject\n${first.stdout}\n${first.stderr}`);
        assert(!first.stdout.includes('### 已裁决的冲突'), '无拒修时控制台不出该栏');

        // 唯一变量：一次回修轮 + 该轮内的一行拒修记录（事件形状与 runtime 写入的 phase_backtrack_requested 相同）
        const X = 'a'.repeat(64);
        const btTs = new Date(Date.now() - 60_000).toISOString();
        fs.appendFileSync(path.join(p.root, 'doc', 'features', p.feature, 'goal-runs', runId, 'events.jsonl'), JSON.stringify({
          ts: btTs, type: 'phase_backtrack_requested', phase: 'testing', from_phase: 'testing', to_phase: 'coding',
          invalidated_phases: ['coding', 'review', 'ut', 'testing'], reason: 'repair_candidates',
          candidates: [{ id: 'sig-nfc', category: 'coding', files: [], summary: '补上 NFC 卡入口', item_fingerprint: X, source_phase: 'testing' }],
        }) + '\n');
        put(p.root, `doc/features/${p.feature}/coding/headless-assumptions.jsonl`, JSON.stringify({
          decision_id: 'd1', run_id: runId, phase: 'coding', gate_id: `repair_candidate:${X}`, class: 'goal_conflict',
          decision: 'declined: 需求写明「本次不做 NFC 卡」', must_review: true, source: 'agent', ts: new Date(Date.now() - 30_000).toISOString(),
        }) + '\n');
        const second = p.run('2026-01-01T00:00:00.000Z');
        const s2 = readSummary().verifier_subject_id;
        assert(typeof s2 === 'string' && s2 !== s1, `只有拒修记录变化也必须换 subject：${s1} → ${s2}\n${second.stdout}\n${second.stderr}`);
        const diff = diffVerifierMaterial(readVerifierMaterialOrNull(p.reportsDir, s1), readVerifierMaterialOrNull(p.reportsDir, s2));
        assert(JSON.stringify(diff) === JSON.stringify(['goal_brief']), `材料差异只应是简报：${JSON.stringify(diff)}`);

        const text = renderGoalBrief(assembleGoalBrief(p.root, p.feature, { runId }), { sections: ['resolved_conflicts'] });
        const expected = text.slice(text.indexOf('### 已裁决的冲突'));
        assert(expected.startsWith('### 已裁决的冲突') && expected.includes('「本次不做 NFC 卡」') && expected.includes(`run ${runId}`),
          `构造性前提：简报须列出拒修：${text}`);
        const aiPrompt = fs.readFileSync(path.join(p.reportsDir, 'ai-prompt.md'), 'utf8');
        assert(aiPrompt.includes(expected), `verifier 提示词须逐字含已裁决的冲突：\n${expected}\n---\n${aiPrompt.slice(-2000)}`);
        assert(second.stdout.includes(expected), `控制台须逐字打印已裁决的冲突：\n${second.stdout.slice(-2000)}`);
        const manifest = { feature: p.feature, run_id: runId, requirement } as unknown as GoalManifest;
        const executor = buildPhasePrompt(manifest, p.root, 'review', p.frameworkRoot, []);
        assert(executor.includes(expected), `执行者提示词须逐字含已裁决的冲突：\n${executor.slice(0, 3000)}`);

        const shotDir = path.join(p.root, 'doc', 'features', p.feature, 'device-testing', 'device-screenshots');
        fs.mkdirSync(shotDir, { recursive: true });
        fs.writeFileSync(path.join(shotDir, 'shot.png'), 'shot');
        fs.writeFileSync(path.join(shotDir, 'ref.png'), 'ref');
        fs.writeFileSync(path.join(shotDir, 'visual-diff.json'), JSON.stringify({
          schema_version: '1.1',
          screens: [{
            screen_id: 's1', verdict: 'pending', must_fix: [], defects: [],
            screenshot_path: `doc/features/${p.feature}/device-testing/device-screenshots/shot.png`,
            ref_path: `doc/features/${p.feature}/device-testing/device-screenshots/ref.png`,
          }],
        }));
        let providerPrompt = '';
        await runVisualProviderReview({ projectRoot: p.root, feature: p.feature, fidelityTarget: 'semantic_layout' } as never, {
          frameworkRoot: FRAMEWORK_ROOT,
          provider: { adapter: 'claude', model: 'm' },
          runId, attemptId: 'A',
          invoke: (async (req: { prompt: string }) => {
            providerPrompt = req.prompt;
            return {
              invoke_id: 'i', provider: { adapter: 'claude', model: 'm' }, purpose: 'review', outcome: 'unavailable',
              reason: 'stub', body: null, duration_ms: 1, image_hashes: [], workspace_dirtied: false, input_provenance: 'unverified',
            };
          }) as never,
        });
        assert(providerPrompt.includes(expected), `provider 提示词须逐字含已裁决的冲突：\n${providerPrompt.slice(0, 3000)}`);
      } finally {
        if (prevRun === undefined) delete process.env.MAISON_GOAL_RUN_ID; else process.env.MAISON_GOAL_RUN_ID = prevRun;
        p.cleanup();
      }
    },
  },
];

export async function runAll(): Promise<UnitCaseResult[]> {
  const results: UnitCaseResult[] = [];
  for (const c of cases) {
    try {
      await c.run();
      results.push({ name: c.name, ok: true });
    } catch (err) {
      results.push({ name: c.name, ok: false, error: (err as Error).stack ?? (err as Error).message });
    }
  }
  return results;
}
