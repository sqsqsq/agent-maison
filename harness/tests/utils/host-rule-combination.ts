import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import * as YAML from 'yaml';
import { clearFrameworkConfigCache } from '../../config';
import { synthesizeTestChainProfile, type RealChainProject } from './real-chain-host';
import { withProject } from '../unit/rule-convergence.unit.test';
import { runGoalRuntimeChain } from '../unit/goal-runner-testing-integrity.unit.test';
import { publishVerifier } from '../unit/real-chain.unit.test';
import { prepareFeatureScopeCandidate, featureScopeCandidateFingerprint } from '../../scripts/utils/feature-track';
import { freezeFeatureExecutionScope } from '../../scripts/utils/feature-execution-scope';
import { loadCanonicalBlueprint } from '../../scripts/utils/component-blueprint-path';
import { loadCanonicalChangeUnit, createChangeUnitRef } from '../../scripts/utils/change-unit-path';
import { blueprintIdentityPointers, currentBlueprintIdentity } from '../../scripts/utils/change-unit-blueprint-identity';
import { deriveBlueprintSkillInput } from '../../scripts/utils/blueprint-skill-projection';
import { partitionConstructionFiles } from '../../scripts/utils/phase-write-boundary';
import { recomputePhaseEvidenceStaleness } from '../../scripts/utils/phase-evidence-manifest';
import { loadAuthoritativeEvents } from '../../scripts/utils/goal-runner-phase';
import type { FactsInvocationContext } from '../../scripts/utils/context-facts';

const feature = 'cu-YmMtb3BlbkNhcmQtMgBvcGVuLWNhcmQtZmxvdw';
const rel = 'doc/features/bc-openCard-2/open-card-flow';
const history = path.resolve(__dirname, '../fixtures/host-recovery-history/20261019');
const handoff = 'TEST_UT_HANDOFF_OBSERVED';
const resourceFiles = ['element/color.json', 'element/string.json', 'profile/route_map.json']
  .map(file => `02-Feature/WalletMain/src/main/resources/base/${file}`);

/** Preserved inputs, current test-only external providers, real runner/checkers/publication/ownership. */
export async function rc10HostRuleCombination(): Promise<void> {
  await withProject(async ({ root, frameworkRoot }) => {
    const original = JSON.parse(fs.readFileSync(path.join(history, '20261019T024808Z-4131b6/manifest.json'), 'utf8'));
    const acceptance = YAML.parse(fs.readFileSync(path.join(root, rel, 'acceptance.yaml'), 'utf8'));
    const contracts = YAML.parse(fs.readFileSync(path.join(root, rel, 'contracts.yaml'), 'utf8'));
    const remove = (relative: string): void => {
      const target = path.resolve(root, relative);
      assert(target.startsWith(root + path.sep));
      fs.rmSync(target, { recursive: true, force: true });
    };
    for (const phase of ['spec', 'plan', 'coding', 'review', 'ut', 'testing']) {
      remove(`${rel}/${phase}/reports`); remove(`${rel}/${phase}/phase-completion-receipt.md`);
    }
    for (const file of ['goal-runs', 'execution-scope.json', 'phase-state.json']) remove(`${rel}/${file}`);
    const config = JSON.parse(fs.readFileSync(path.join(root, 'framework.config.json'), 'utf8'));
    config.project_profile = { name: 'test-chain' };
    fs.writeFileSync(path.join(root, 'framework.config.json'), JSON.stringify(config));
    for (const layer of config.architecture.outer_layers) fs.mkdirSync(path.join(root, layer.id), { recursive: true });
    synthesizeTestChainProfile(frameworkRoot);
    // Keep the host's real syntax extractor; only executable device/build providers are replaced in this test profile.
    fs.writeFileSync(path.join(frameworkRoot, 'profiles/test-chain/harness/component-extractor.js'),
      `module.exports = require(${JSON.stringify(path.join(frameworkRoot, 'profiles/hmos-app/harness/component-extractor.ts'))});\n`);
    fs.writeFileSync(path.join(root, 'AGENTS.md'), '# Test adapter entry\n');
    fs.writeFileSync(path.join(root, 'framework.local.json'), JSON.stringify({ schema_version: '1.0', agent_adapter: 'codex',
      vision: { canary: { adapter: 'codex', verdict: 'tool_read', probed_at: new Date().toISOString(), probed_via: 'interactive', probe_version: 2 } } }));
    clearFrameworkConfigCache();

    const blueprintPath = path.join(root, 'doc/features/bc-openCard-2/blueprint/component-blueprint.yaml');
    const repairedBlueprint = YAML.parse(fs.readFileSync(blueprintPath, 'utf8'));
    fs.copyFileSync(path.join(history, '4131b6-blueprint-rev4.yaml'), blueprintPath);
    const blueprint = loadCanonicalBlueprint(root, 'bc-openCard-2');
    const loaded = loadCanonicalChangeUnit(root, 'bc-openCard-2', 'open-card-flow');
    // The original rev4 CU is unavailable. This controlled legacy binding is labelled, not presented as recovered history.
    for (const ref of blueprintIdentityPointers(loaded.changeUnit)) if (ref) Object.assign(ref, currentBlueprintIdentity(blueprint));
    loaded.changeUnit.design_refs = (loaded.changeUnit.design_refs as any[]).filter(ref => !String(ref.target.id).startsWith('ui_'));
    fs.writeFileSync(loaded.canonicalPath, YAML.stringify(loaded.changeUnit));
    fs.writeFileSync(path.join(root, '.gitignore'), 'framework/\n');
    const git = (...args: string[]): void => { execFileSync('git', args, { cwd: root, stdio: 'pipe' }); };
    git('init'); git('add', '-A'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Preserved host inputs for controlled replay');
    const prepared = prepareFeatureScopeCandidate({ projectRoot: root, frameworkRoot, feature, completionTarget: 'feature',
      requestedResults: [original.requirement], requestedPhases: ['plan', 'coding', 'review', 'ut', 'testing'], requirement: original.requirement, overwrite: true });
    freezeFeatureExecutionScope({ projectRoot: root, feature, scope: prepared.scope, candidateFingerprint: featureScopeCandidateFingerprint(root, feature) });
    const project: RealChainProject = { root, frameworkRoot, harnessDir: path.join(frameworkRoot, 'harness'), feature, module: 'WalletMain', modulePath: '02-Feature/WalletMain' };
    let handedOff = false;
    const facts = (ctx: { runId: string; phase: string }): void => {
      const file = path.join(root, rel, 'context/facts.md');
      let text = fs.readFileSync(file, 'utf8');
      if (ctx.phase === 'spec') {
        const end = text.indexOf('\n---', 4);
        const header = YAML.parse(text.slice(4, end));
        header.run_id = ctx.runId; header.established_by = 'spec'; delete header.frozen_scope_fingerprint;
        header.source_code_paths = header.source_code_paths.filter((source: string) => fs.existsSync(path.resolve(root, source)));
        header.key_inputs_read = header.key_inputs_read.filter((source: string) => fs.existsSync(path.resolve(root, source)));
        text = '---\n' + YAML.stringify(header) + '---\n' + text.slice(end + 5);
      } else if (ctx.phase === 'review') {
        const current = YAML.parse(fs.readFileSync(path.join(root, rel, 'contracts.yaml'), 'utf8'));
        const files = partitionConstructionFiles(root, path.join(frameworkRoot, 'profiles/hmos-app'), current).implementation
          .filter(file => fs.existsSync(path.join(root, file)));
        for (const file of files) fs.readFileSync(path.join(root, file));
        const delta = ['## phase_delta: review', '', '| 路径 | 事实 | 对本阶段影响 |', '|---|---|---|',
          ...files.map(file => `| ${file} | 已读取本次施工产物 | 核对实现与契约 |`), ''].join('\n');
        const section = /##\s*phase_delta:\s*review\b[\s\S]*?(?=\n##\s|$)/;
        text = section.test(text) ? text.replace(section, delta) : text + '\n' + delta;
      } else if (!text.includes(`## phase_delta: ${ctx.phase}`)) text += `\n## phase_delta: ${ctx.phase}\n本阶段按保全材料核对产物。\n`;
      fs.writeFileSync(file, text);
    };
    const proof = (ctx: { runId: string; phase: string }): void => { project.runId = ctx.runId; publishVerifier(project, ctx.phase); };
    const result = await runGoalRuntimeChain(root, {
      frameworkRoot, featureId: feature, realHarness: true, adapter: 'codex', freshRequirement: original.requirement,
      freshStartPhase: prepared.scope.phase_chain[0] as 'spec', freshEndPhase: prepared.scope.phase_chain.at(-1),
      onSpec: ctx => {
        project.runId = ctx.runId;
        const projected = deriveBlueprintSkillInput(root, feature, frameworkRoot, 'acceptance');
        if (projected.state === 'resolved') {
          const base = projected.value as any;
          fs.writeFileSync(path.join(root, rel, 'acceptance.yaml'), YAML.stringify({ ...structuredClone(acceptance), ...base,
            criteria: base.criteria.map((criterion: any) => ({ ...acceptance.criteria.find((row: any) => row.id === criterion.id), ...criterion })) }));
        }
        facts(ctx); proof(ctx);
      },
      onOutOfChain: ctx => {
        const draft = /草稿文件[^：\n]*：(.+)$/m.exec(ctx.prompt)?.[1]?.trim(); assert(draft);
        if (ctx.phase === 'design-repair-author') fs.writeFileSync(draft, YAML.stringify(repairedBlueprint));
        else {
          const doc = YAML.parse(fs.readFileSync(draft, 'utf8'));
          doc.review_summary.questioning = { ...structuredClone(repairedBlueprint.review_summary.questioning), provider_id: 'design-repair-questioning' };
          fs.writeFileSync(draft, YAML.stringify(doc));
        }
      },
      onPlan: ctx => {
        project.runId = ctx.runId;
        const projected = deriveBlueprintSkillInput(root, feature, frameworkRoot, 'contracts'); assert.equal(projected.state, 'resolved', projected.detail);
        const value = { ...structuredClone(contracts), ...(projected.value as any), change_unit: structuredClone(contracts.change_unit) };
        const current = loadCanonicalChangeUnit(root, 'bc-openCard-2', 'open-card-flow');
        value.change_unit.change_unit_ref = createChangeUnitRef(current);
        value.change_unit.design_ref_mappings = value.change_unit.design_ref_mappings.map((mapping: any) => ({ ...mapping,
          design_ref: (current.changeUnit.design_refs as any[]).find(ref => ref.target.kind === mapping.design_ref.target.kind && ref.target.id === mapping.design_ref.target.id && ref.target.view_id === mapping.design_ref.target.view_id) ?? mapping.design_ref }));
        // First expose the actual legacy omission, then let the responsible author supplement real consumer symbols.
        if (ctx.attempt > 1) value.integration_points = value.integration_points.map((point: any) => ({ ...point,
          entry_symbol: point.consumer_module === 'Phone' ? 'buildBankCardSelectionPage' : point.provider_module === 'AccountManager' ? 'AccountService' : 'BankRepository' }));
        fs.writeFileSync(path.join(root, rel, 'contracts.yaml'), YAML.stringify(value));
        if (projected.artifacts?.['use-cases@1']) fs.writeFileSync(path.join(root, rel, 'use-cases.yaml'), YAML.stringify(projected.artifacts['use-cases@1']));
        facts(ctx); proof(ctx);
      },
      onCoding: ctx => {
        project.runId = ctx.runId;
        if (ctx.attempt === 1) for (const resource of resourceFiles) fs.appendFileSync(path.join(root, resource), '\n');
        facts(ctx); proof(ctx);
      },
      onReview: ctx => {
        project.runId = ctx.runId; facts(ctx);
        const current = YAML.parse(fs.readFileSync(path.join(root, rel, 'contracts.yaml'), 'utf8'));
        const files = partitionConstructionFiles(root, path.join(frameworkRoot, 'profiles/hmos-app'), current).implementation;
        const report = ['# 审查报告', '', '> **模块标识**: WalletMain', '> **审查日期**: 2026-10-19', '> **审查版本**: 1.0', '> **保证等级**: standard', '',
          '## 1. 审查范围', '', ...files.map(file => `- ${file}`), '', '## 2. 审查维度', '', '| 维度 | 结论 |', '|---|---|', '| 契约一致性 | 通过 |', '| 视觉保真 | 通过 |', '',
          '## 3. 问题清单', '', '| 编号 | 分类 | 严重程度 | 问题描述 | 涉及文件 | 修复建议 |', '|---|---|---|---|---|---|', '', '本轮无问题。', '',
          '## 4. 问题统计', '', '| 严重程度 | 数量 |', '|---|---|', '| BLOCKER | 0 |', '| MAJOR | 0 |', '| MINOR | 0 |', '| INFO | 0 |', '',
          '## 5. 修复建议', '', '无。', '', '## 6. 结论', '', '**审查结论**: 通过', ''].join('\n');
        fs.mkdirSync(path.join(root, rel, 'review'), { recursive: true }); fs.writeFileSync(path.join(root, rel, 'review/review-report.md'), report); proof(ctx);
      },
      onUt: ctx => {
        const current = YAML.parse(fs.readFileSync(path.join(root, rel, 'contracts.yaml'), 'utf8'));
        const missing = partitionConstructionFiles(root, path.join(frameworkRoot, 'profiles/hmos-app'), current).tests.filter(file => !fs.existsSync(path.join(root, file)));
        assert(ctx.goalAttemptId, 'UT actor 必须收到本次签发的 attempt 身份');
        const admitted = loadAuthoritativeEvents(path.join(root, rel, 'goal-runs', ctx.runId, 'events.jsonl'))
          .slice().reverse().find(event => event.type === 'agent_invoke_start' && event.phase === 'ut' && event.invoke_id === `${ctx.phase}-${ctx.goalAttemptId}`);
        const factsContext = admitted?.facts_context as FactsInvocationContext | undefined;
        assert(missing.length && missing.every(file => factsContext?.source_owners?.[file] === 'ut'),
          '本次真实 UT 入场上下文必须拥有全部待产出的测试文件；不能用提示词是否内联文件名代替责任判定');
        assert(recomputePhaseEvidenceStaleness(root, feature, ['spec', 'plan'], { frameworkRoot, runId: ctx.runId }).every(row => row.verdict === 'fresh'), '正常资源写入不能反向推翻上游');
        handedOff = true; throw new Error(handoff);
      },
    });
    assert(handedOff, JSON.stringify({ phases: result.invokedPhases, end: result.events.filter(event => event.type === 'run_end').at(-1) }));
    assert(result.events.some(event => event.type === 'design_authority_repair' && event.stage === 'published' && event.outcome === 'recovered'));
    assert(result.events.some(event => event.type === 'phase_verdict' && event.phase === 'plan' && event.verdict === 'FAIL' && String(event.blocker_signature).includes('integration_scope_consistency')));
    assert(/integration_scope_consistency|entry_symbol/.test(result.planPrompts[1] ?? ''), '定义失败必须实际送回 plan，不能由替身无条件猜修复');
    assert(result.events.some(event => event.type === 'phase_verdict' && event.phase === 'coding' && event.verdict === 'PASS'));
    assert(!result.events.some(event => event.type === 'phase_verdict' && event.phase === 'coding' && event.verdict === 'FAIL'), '正常资源写入和框架索引刷新不应触发 coding 失败重跑');
    const coding = result.invokedPhases.indexOf('coding'); assert(coding >= 0 && !result.invokedPhases.slice(coding + 1).includes('spec'));
    const written = result.events.filter(event => event.type === 'phase_write_observed' && event.phase === 'coding').flatMap(event => (event as any).owned ?? []);
    assert(resourceFiles.every(file => written.some((row: any) => row.path === file && row.pre_sha256 !== row.post_sha256)), '三项资源写入必须经过真实归属记录');
    assert(String(result.events.at(-1)?.error).includes(handoff), '只在 UT 交接边界结束，不伪称业务验收完成');
  });
}
