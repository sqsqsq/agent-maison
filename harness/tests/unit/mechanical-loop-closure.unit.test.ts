// mechanical-loop-closure.unit.test.ts —— MG 机械闭环终验（plan 2d6b4f83）
//
// 只证明"层与层之间"：P1 蓝图 → P2 单并发连续推进 → 真实 Goal Mode 完成事实 → P3 部件闭环。
// 单层完整性归 component-blueprint / change-unit-progression / component-closure 三套件，
// 本套件不重复。
//
// 铁律（plan §5）：本文件内不得出现 completion / observeCompletion / buildHandoff 三个桩；
// 唯一允许注入的是确定性时间与 Goal Mode 的 caller——而 caller 必须用生产 writer 落下
// 真实的 events / receipt / summary / evidence-manifest / completion 投影。

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as YAML from 'yaml';

import { featureFilePath } from '../../config';
import { checkCanonicalComponentBlueprint } from '../../scripts/check-component-blueprint';
import { writeCanonicalComponentClosure } from '../../scripts/check-component-closure';
import { componentBlueprintPath } from '../../scripts/utils/component-blueprint-path';
import { BlueprintRecord, asRecord, asRecords } from '../../scripts/utils/component-blueprint-model';
import { validateChangeUnitDesign } from '../../scripts/utils/change-unit-design-gate';
import { evaluateComponentClosure, validateComponentClosure } from '../../scripts/utils/component-closure-validator';
import { blueprintRefAddress } from '../../scripts/utils/change-unit-model';
import { verifyClosureEvidenceIdentity } from '../../scripts/utils/component-closure-evidence';
import {
  ClosureEvidenceProvider,
  automatedConstructionEvidenceProvider,
  humanAcceptanceRiskEvidenceProvider,
  uiDeviceVisualEvidenceProvider,
} from '../../scripts/utils/component-closure-provider-boundary';
import {
  BUILTIN_CHANGE_UNIT_PROVIDERS,
  validateChangeUnitProviderBoundary,
} from '../../scripts/utils/change-unit-provider-boundary';
import * as crypto from 'crypto';
import {
  asChangeUnitArtifact,
  deriveChangeUnitFeatureId,
  enumerateCanonicalChangeUnits,
  parseChangeUnitFeatureId,
} from '../../scripts/utils/change-unit-path';
import { observeChangeUnitCompletion, resolveChangeUnitExpectedExecution } from '../../scripts/utils/change-unit-completion';
import {
  ChangeUnitGoalHandoff,
  runChangeUnitProgression,
} from '../../scripts/utils/change-unit-progress-loop';
import { generateFeatureCompletion } from '../../scripts/utils/verify-feature-completion';
import { computeRunRequirementSha } from '../../scripts/utils/fidelity-shared';
import {
  loadPhaseEvidenceManifest,
  resolvePhaseEvidenceManifest,
  writePhaseEvidenceManifest,
  writeReceiptManifestPointer,
} from '../../scripts/utils/phase-evidence-manifest';
import { seedCleanCompletionChain } from '../utils/completion-chain-seed';
// P3 套件的现场装配（施工投影 + 可信证据链 + 哈希重绑）唯一实现，MG 直接复用，不另造夹具。
import { prepareCompleteProject } from './component-closure.unit.test';
// 接缝证明与绕过尺子来自 fixture 本体——MG 直接执行它们，证明不是 return true 占位。
import {
  proveSeamAbsenceFailure,
  proveSeamConsumerNoBypass,
  proveSeamContractCompatibility,
  proveSeamProviderReplacement,
} from '../fixtures/component-blueprint/valid/test/ledger/closure.test';
import {
  bypassCheckAcceptsCleanConsumer,
  bypassCheckRejectsBypassingConsumer,
} from '../fixtures/component-blueprint/valid/test/ledger/seam-bypass.case';
import type { UnitCaseResult } from '../run-unit';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const FIXTURE_PROJECT = path.resolve(__dirname, '..', 'fixtures', 'component-blueprint', 'valid');
const COMPONENT = 'ledger';
const STABLE_FLOW_ID = 'ledger-refresh-flow';
const RUN_ID = 'RUN1';
const FIXED_TIME = '2026-08-20T00:00:00.000Z';
const FIXED_NOW = () => new Date(FIXED_TIME);
const seamProofs = {
  contract_compatibility: proveSeamContractCompatibility,
  provider_replacement: proveSeamProviderReplacement,
  absence_failure: proveSeamAbsenceFailure,
  consumer_no_bypass: proveSeamConsumerNoBypass,
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function asyncTest(name: string, body: () => Promise<void>): Promise<UnitCaseResult> {
  try {
    await body();
    return { name: `mechanical-loop: ${name}`, ok: true };
  } catch (error) {
    return { name: `mechanical-loop: ${name}`, ok: false, error: (error as Error).message };
  }
}

/**
 * 临时链路项目 = canonical fixture 副本 + 仓库真实 workflows 投影。
 * 投影是必需的：fixture 项目自身没有 framework 树，`resolveChangeUnitExpectedExecution`
 * 会抛 "No framework tree"，真实 completion 路径根本跑不起来（plan §3.1）。
 */
interface ChainProjectOptions {
  /** 是否套用 P3 现场装配（施工投影+证据链+清 blocker）；默认套用 */
  prepared?: boolean;
  /** 装配前对 canonical 蓝图注入（哈希重绑由 prepareCompleteProject 负责） */
  mutateBlueprint?: (blueprint: BlueprintRecord) => void;
  /** 装配后对项目注入（CU/契约/证据层面的断点） */
  mutateProject?: (projectRoot: string) => void;
}

async function withChainProject(
  body: (projectRoot: string) => Promise<void>,
  options: ChainProjectOptions = {},
): Promise<void> {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-mg-'));
  try {
    fs.cpSync(FIXTURE_PROJECT, projectRoot, { recursive: true });
    fs.cpSync(path.join(REPO_ROOT, 'workflows'), path.join(projectRoot, 'framework', 'workflows'), { recursive: true });
    if (options.prepared !== false) prepareCompleteProject(projectRoot, options.mutateBlueprint);
    options.mutateProject?.(projectRoot);
    await body(projectRoot);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
}

/** 模拟一次成功 Goal run 的**完成事实**：全部经生产 writer，不手抄任何投影。 */
function completeChangeUnitRun(projectRoot: string, handoff: ChangeUnitGoalHandoff): void {
  seedCleanCompletionChain({
    projectRoot,
    feature: handoff.featureId,
    chain: handoff.expectedChain,
    runId: RUN_ID,
    now: FIXED_NOW,
  });
  generateFeatureCompletion({
    projectRoot,
    feature: handoff.featureId,
    chain: [...handoff.expectedChain],
    workflowTrack: handoff.expectedTrack,
    runId: RUN_ID,
    runDirAbs: featureFilePath(projectRoot, handoff.featureId, path.join('goal-runs', RUN_ID)),
    phaseRunIds: {},
    now: FIXED_NOW,
  });
}

interface LayerProbe {
  p1: string[];
  p2: string[];
  p2Messages: string;
  p3: string[];
  p3Messages: string;
  p3Verdict: string;
}

/** 同一注入点上，把 P1 / P2 / P3 三层的真实出口一次性取出来——断点必须逐层可定位。 */
function probeAllLayers(projectRoot: string): LayerProbe {
  const p1 = checkCanonicalComponentBlueprint(projectRoot, COMPONENT).issues
    .filter(issue => issue.severity === 'BLOCKER').map(issue => issue.id);

  const p2: string[] = [];
  const p2Messages: string[] = [];
  try {
    for (const loaded of enumerateCanonicalChangeUnits(projectRoot, COMPONENT)) {
      const gate = validateChangeUnitDesign(projectRoot, loaded.changeUnit);
      if (gate.verdict !== 'constructable') {
        for (const issue of gate.issues) { p2.push(issue.id); p2Messages.push(issue.message); }
      }
    }
  } catch (error) {
    p2.push('change_unit_enumeration_failed');
    p2Messages.push((error as Error).message);
  }

  let p3: string[] = [];
  let p3Messages: string[] = [];
  let p3Verdict = 'THROWN';
  try {
    const evaluated = evaluateComponentClosure(projectRoot, COMPONENT, { evaluatedAt: FIXED_TIME });
    p3 = evaluated.issues.map(issue => issue.id);
    p3Messages = evaluated.issues.map(issue => issue.message);
    p3Verdict = evaluated.closure.verdict;
  } catch (error) {
    // 输入彻底不可解析时 evaluate 也可能直接抛——同样记成显式出口。
    p3 = ['component_closure_evaluation_failed'];
    p3Messages = [(error as Error).message];
  }
  return { p1, p2, p2Messages: p2Messages.join(' | '), p3, p3Messages: p3Messages.join(' | '), p3Verdict };
}

/** 把四个 canonical CU 推到全部 VALID（真实完成事实），供上游全绿、下游才炸的断点使用。 */
async function advanceWholeChain(projectRoot: string): Promise<void> {
  const decision = await runChangeUnitProgression(projectRoot, COMPONENT, {
    caller: async handoff => {
      completeChangeUnitRun(projectRoot, handoff);
      return { status: 'completed' };
    },
  });
  assert(
    decision.action === 'ready_for_component_closure',
    `前置链未推完：${decision.action}（${decision.reasons.join('；')}）`,
  );
}

/** 项目文件快照（相对路径 → 内容哈希），用于证明 provider 退出没留孤儿、没改历史。 */
function snapshotProject(projectRoot: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(abs); continue; }
      const rel = path.relative(projectRoot, abs).split(path.sep).join('/');
      out.set(rel, crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex'));
    }
  };
  walk(projectRoot);
  return out;
}

export async function runAll(): Promise<UnitCaseResult[]> {
  const results: UnitCaseResult[] = [];

  results.push(await asyncTest(
    'P1 blueprint to P2 single-concurrency progression to real Goal completion to P3 closure runs end to end',
    async () => {
      await withChainProject(async projectRoot => {
        const blueprint = checkCanonicalComponentBlueprint(projectRoot, COMPONENT);
        assert(
          !blueprint.issues.some(issue => issue.severity === 'BLOCKER'),
          `P1 canonical 蓝图未通过：${blueprint.issues.map(issue => issue.id).join(', ')}`,
        );

        const invoked: string[] = [];
        const decision = await runChangeUnitProgression(projectRoot, COMPONENT, {
          caller: async handoff => {
            invoked.push(parseChangeUnitFeatureId(handoff.featureId).changeUnitId);
            completeChangeUnitRun(projectRoot, handoff);
            return { status: 'completed' };
          },
        });

        assert(invoked.length === new Set(invoked).size, `同一 CU 被重复启动：${invoked.join(',')}`);
        assert(
          invoked.join(',') === 'ledger-refresh,ledger-consumer,ledger-summary,ledger-recovery',
          `单并发推进序错误（应为依赖序 + 同优先级稳定 tie-break）：${invoked.join(',')}`,
        );
        assert(
          decision.action === 'ready_for_component_closure',
          `末态未交接部件闭环：${decision.action}（${decision.reasons.join('；')}）`,
        );

        // 这一步是本套件的存在理由：completion 走生产默认路径（真实 workflow 链 +
        // 真实 verifyFeatureCompletion），不是任何桩喂进来的字符串。
        for (const loaded of enumerateCanonicalChangeUnits(projectRoot, COMPONENT)) {
          const unit = asChangeUnitArtifact(loaded.changeUnit);
          const observation = observeChangeUnitCompletion(projectRoot, unit);
          assert(
            observation.state === 'VALID',
            `${unit.change_unit_id} 真实 completion 非 VALID：${observation.state}（${observation.reasons.join('；')}）`,
          );
          assert(
            observation.expectedChain?.includes('review') === true,
            `${unit.change_unit_id} 未走真实 workflow 全链：${observation.expectedChain?.join(',')}`,
          );
        }

        const closure = writeCanonicalComponentClosure(projectRoot, COMPONENT, { evaluatedAt: FIXED_TIME });
        assert(
          !closure.issues.some(issue => issue.severity === 'BLOCKER'),
          `P3 闭环未通过：${closure.issues.map(issue => `${issue.id}@${issue.path}`).slice(0, 8).join(', ')}`,
        );
        assert(
          closure.closure.verdict === 'PASS' || closure.closure.verdict === 'PASS_WITH_DEGRADATION',
          `P3 verdict=${closure.closure.verdict}`,
        );
        // 稳定 flow id 必须一路贯穿，而不是"随便有一条 runtime flow 闭合了"。
        const flowAddress = `view:runtime/flow:${STABLE_FLOW_ID}`;
        const flowRow = closure.closure.coverage_rows
          .find(row => row.obligation_id === `obligation:runtime-flow:${STABLE_FLOW_ID}`);
        assert(flowRow?.observation === 'covered', `稳定流 ${STABLE_FLOW_ID} 未在闭环上闭合：${flowRow?.observation ?? '该 obligation 不存在'}`);
        const owningUnits = enumerateCanonicalChangeUnits(projectRoot, COMPONENT).filter(loaded =>
          asRecords(loaded.changeUnit.design_refs).some(ref =>
            asRecord(ref.target)?.kind === 'flow' && asRecord(ref.target)?.id === STABLE_FLOW_ID));
        assert(owningUnits.length > 0, `没有任何 CU 的 design_refs 引用稳定流 ${STABLE_FLOW_ID}`);
        for (const loaded of owningUnits) {
          const unit = asChangeUnitArtifact(loaded.changeUnit);
          const feature = deriveChangeUnitFeatureId(unit.component_id, unit.change_unit_id);
          const contracts = YAML.parse(fs.readFileSync(featureFilePath(projectRoot, feature, 'contracts.yaml'), 'utf8')) as BlueprintRecord;
          const states = asRecords(contracts.state_management);
          assert(
            states.some(state => state.design_ref ? blueprintRefAddress(state.design_ref as never) === flowAddress : false),
            `${unit.change_unit_id} 的 Feature state_management 未投影到同一稳定流地址：${states.map(state => state.design_ref ? blueprintRefAddress(state.design_ref as never) : '(无 design_ref)').join(',')}`,
          );
        }
      });
    },
  ));

  results.push(await asyncTest(
    'legal human blocker gates the real chain and only a human observation resumes it',
    async () => {
      // 未装配的 canonical 夹具：ledger-summary 自带合法 human blocker（release-approval）。
      await withChainProject(async projectRoot => {
        const gatedLeg: string[] = [];
        const gated = await runChangeUnitProgression(projectRoot, COMPONENT, {
          caller: async handoff => {
            gatedLeg.push(parseChangeUnitFeatureId(handoff.featureId).changeUnitId);
            completeChangeUnitRun(projectRoot, handoff);
            return { status: 'completed' };
          },
        });
        assert(
          gatedLeg.join(',') === 'ledger-refresh,ledger-consumer,ledger-recovery',
          `被 blocker 挡住的单元仍被启动，或依赖序错误：${gatedLeg.join(',')}`,
        );
        assert(gated.action === 'blocked', `合法 human blocker 未挡住推进：${gated.action}`);
        assert(
          gated.reasons.some(reason => reason.includes('release-approval')),
          `阻塞原因未定位到结构化 blocker：${gated.reasons.join('；')}`,
        );

        // 人工观察经既有 blockerProbe 缝进入（这是生产里 human blocker 的唯一解除通道，
        // 不是把 completion/ready 判定桩掉）。
        const resumedLeg: string[] = [];
        const resumed = await runChangeUnitProgression(projectRoot, COMPONENT, {
          ready: {
            blockerProbe: {
              evaluate: blocker => ({
                cleared: blocker.blocker_id === 'release-approval',
                evidence: 'release-owner 批准 revision 已推进',
              }),
            },
          },
          caller: async handoff => {
            resumedLeg.push(parseChangeUnitFeatureId(handoff.featureId).changeUnitId);
            completeChangeUnitRun(projectRoot, handoff);
            return { status: 'completed' };
          },
        });
        assert(resumedLeg.join(',') === 'ledger-summary', `解除阻塞后的续跑不正确：${resumedLeg.join(',')}`);
        assert(
          resumed.action === 'ready_for_component_closure',
          `解除阻塞后未交接部件闭环：${resumed.action}（${resumed.reasons.join('；')}）`,
        );
      }, { prepared: false });
    },
  ));

  // ── MG-B：五类跨层断点。每例都断三层实际出口，不只断最下游。 ───────────────────
  interface BreakpointCase {
    name: string;
    options: ChainProjectOptions;
    /** 断点注入前是否需要先把整条链推到全绿（用于"上游全绿、组装才炸"的反例） */
    advanceFirst?: boolean;
    expect: (probe: LayerProbe) => void;
  }

  const breakpoints: BreakpointCase[] = [
    {
      name: 'missing critical external input blocks every downstream layer',
      options: {
        mutateBlueprint: blueprint => {
          const admission = asRecord(asRecord(blueprint.review_summary)?.admission);
          const slice = asRecord(admission?.current_slice);
          asRecords(asRecord(blueprint.decisions_and_gaps)?.gaps)[0].needed_by = slice?.slice_id;
        },
      },
      expect: probe => {
        assert(
          probe.p1.includes('blueprint_current_unknown_not_blocking'),
          `P1 未把"当前切片依赖的 unknown"判成 blocker：${probe.p1.join(',')}`,
        );
        assert(
          probe.p2.includes('change_unit_blueprint_unresolvable')
            && probe.p2Messages.includes('blueprint_current_unknown_not_blocking'),
          `P2 未携具体上游诊断阻断施工：${probe.p2.join(',')} | ${probe.p2Messages.slice(0, 200)}`,
        );
        // 与 P2 同构：P3 这半边也必须可归因到同一个上游 id，而不是只说"反正没 PASS"。
        assert(
          probe.p3Verdict === 'FAIL' && probe.p3Messages.includes('blueprint_current_unknown_not_blocking'),
          `P3 在关键输入缺失下仍放行或未携具体上游诊断：${probe.p3Verdict} | ${probe.p3Messages.slice(0, 200)}`,
        );
      },
    },
    {
      name: 'required view faked not_applicable blocks every downstream layer',
      options: {
        mutateBlueprint: blueprint => {
          asRecords(blueprint.design_views)
            .find(view => view.view_id === 'logical')!.applicability = 'not_applicable';
        },
      },
      expect: probe => {
        assert(
          probe.p1.includes('blueprint_required_view_not_applicable'),
          `P1 未识破必需视图伪不适用：${probe.p1.join(',')}`,
        );
        assert(
          probe.p2Messages.includes('blueprint_required_view_not_applicable'),
          `P2 未携具体视图诊断阻断施工：${probe.p2Messages.slice(0, 200)}`,
        );
        // 与 P2 同构：P3 这半边也必须可归因到同一个上游 id，而不是只说"反正没 PASS"。
        assert(
          probe.p3Verdict === 'FAIL' && probe.p3Messages.includes('blueprint_required_view_not_applicable'),
          `P3 在必需视图缺失下仍放行或未携具体上游诊断：${probe.p3Verdict} | ${probe.p3Messages.slice(0, 200)}`,
        );
      },
    },
    {
      name: 'missing runtime initial load blocks every downstream layer on the same flow id',
      options: {
        mutateBlueprint: blueprint => {
          const runtime = asRecords(blueprint.design_views).find(view => view.view_id === 'runtime')!;
          delete asRecord(asRecords(runtime.runtime_data_flows)[0].initial_load)!.strategy;
        },
      },
      expect: probe => {
        assert(
          probe.p1.includes('runtime_flow_initial_load_missing'),
          `P1 未抓到缺首次加载：${probe.p1.join(',')}`,
        );
        assert(
          probe.p2Messages.includes('runtime_flow_initial_load_missing'),
          `P2 未携运行时断边诊断阻断施工：${probe.p2Messages.slice(0, 200)}`,
        );
        // 与 P2 同构：P3 这半边也必须可归因到同一个上游 id，而不是只说"反正没 PASS"。
        assert(
          probe.p3Verdict === 'FAIL' && probe.p3Messages.includes('runtime_flow_initial_load_missing'),
          `P3 在运行时关键边缺失下仍放行或未携具体上游诊断：${probe.p3Verdict} | ${probe.p3Messages.slice(0, 200)}`,
        );
      },
    },
    {
      name: 'design bypass passes P1 and P2 but component closure still catches it',
      options: {
        mutateProject: projectRoot => {
          const cuFile = path.join(projectRoot, 'blueprint', 'component', COMPONENT, 'change-units', 'ledger-refresh.yaml');
          const cu = YAML.parse(fs.readFileSync(cuFile, 'utf8')) as BlueprintRecord;
          const blueprint = YAML.parse(fs.readFileSync(componentBlueprintPath(projectRoot, COMPONENT), 'utf8')) as BlueprintRecord;
          const bypass = JSON.parse(JSON.stringify(asRecords(cu.design_refs)[0])) as BlueprintRecord;
          bypass.target = { kind: 'blueprint', id: String(blueprint.blueprint_id) };
          cu.design_refs = [...asRecords(cu.design_refs), bypass];
          fs.writeFileSync(cuFile, YAML.stringify(cu), 'utf8');
          prepareCompleteProject(projectRoot);
        },
      },
      advanceFirst: true,
      expect: probe => {
        assert(probe.p1.length === 0, `绕过用例的 P1 不该有 blocker：${probe.p1.join(',')}`);
        assert(probe.p2.length === 0, `绕过用例的 P2 施工门不该拦：${probe.p2.join(',')}`);
        assert(
          probe.p3.includes('component_closure_design_bypass'),
          `设计绕过未被部件闭环抓到：${probe.p3.slice(0, 8).join(',')}`,
        );
        assert(probe.p3Verdict === 'FAIL', `设计绕过下 P3 verdict=${probe.p3Verdict}`);
      },
    },
    {
      name: 'every CU completes yet missing cross-CU assembly evidence still fails closure',
      options: {
        mutateProject: projectRoot => {
          const feature = deriveChangeUnitFeatureId(COMPONENT, 'ledger-consumer');
          const file = featureFilePath(projectRoot, feature, 'contracts.yaml');
          const contracts = YAML.parse(fs.readFileSync(file, 'utf8')) as BlueprintRecord;
          const section = asRecord(contracts.change_unit)!;
          for (const mapping of [
            ...asRecords(section.predicate_mappings),
            ...asRecords(section.provide_mappings),
            ...asRecords(section.design_ref_mappings),
          ]) {
            mapping.implementation_refs = ['src/ledger/ClosureFixture.ts#alternateComponentClosure'];
            if (Object.prototype.hasOwnProperty.call(mapping, 'test_refs')) {
              mapping.test_refs = ['test/ledger/closure.test.ts#alternateComponentClosure'];
            }
            if (Object.prototype.hasOwnProperty.call(mapping, 'verification_refs')) {
              mapping.verification_refs = ['test/ledger/closure.test.ts#alternateComponentClosure'];
            }
          }
          fs.writeFileSync(file, YAML.stringify(contracts), 'utf8');
        },
      },
      advanceFirst: true,
      expect: probe => {
        // 这一条的全部价值在"上游全绿"：单元各自跑通 ≠ 组装成立。
        assert(probe.p1.length === 0, `组合证据用例的 P1 不该有 blocker：${probe.p1.join(',')}`);
        assert(probe.p2.length === 0, `组合证据用例的 P2 施工门不该拦：${probe.p2.join(',')}`);
        assert(
          probe.p3.includes('component_closure_dependency_assembly_unverified'),
          `组合证据缺失未被抓到：${probe.p3.slice(0, 8).join(',')}`,
        );
        assert(probe.p3Verdict === 'FAIL', `组合证据缺失下 P3 verdict=${probe.p3Verdict}`);
      },
    },
  ];

  for (const breakpoint of breakpoints) {
    results.push(await asyncTest(breakpoint.name, async () => {
      await withChainProject(async projectRoot => {
        if (breakpoint.advanceFirst) await advanceWholeChain(projectRoot);
        breakpoint.expect(probeAllLayers(projectRoot));
      }, breakpoint.options);
    }));
  }

  // ── MG-C：§11.2 接缝五项，三层统一口径。 ──────────────────────────────────────
  results.push(await asyncTest('seam 1/5 required provider absence blocks precisely at every layer', async () => {
    // 坏蓝图侧：P1 点名 + 下游整条链被挡住（不是"照常跑，末尾才发现"）。
    await withChainProject(async projectRoot => {
      const p1 = checkCanonicalComponentBlueprint(projectRoot, COMPONENT).issues.map(issue => issue.id);
      assert(
        p1.includes('blueprint_required_provider_missing'),
        `P1 未点名缺席的 required provider：${p1.join(',')}`,
      );
      const decision = await runChangeUnitProgression(projectRoot, COMPONENT, {
        caller: async () => { throw new Error('required provider 缺席时不得启动任何 CU'); },
      });
      assert(decision.action === 'blocked', `provider 接缝损坏后仍推进：${decision.action}`);
      assert(
        decision.reasons.some(reason => reason.includes('blueprint_required_provider_missing')),
        `阻塞原因未携具体 provider 诊断：${decision.reasons.join('；').slice(0, 200)}`,
      );
    }, {
      mutateBlueprint: blueprint => {
        blueprint.providers = asRecords(blueprint.providers)
          .filter(provider => provider.provider_id !== 'current-facts-discovery');
      },
    });

    // P2 静态接线侧：权威接缝无可用 provider → fail-closed 且点名 seam。
    const boundary = validateChangeUnitProviderBoundary([]);
    assert(!boundary.ok, 'P2 在权威 provider 全缺时仍放行');
    for (const seam of ['relation_ready_analysis', 'candidate_selection']) {
      assert(
        boundary.blockers.includes(`change_unit_provider_missing:${seam}`),
        `P2 未精确阻塞 ${seam}：${boundary.blockers.join(',')}`,
      );
    }

    // P3 侧（干净链）：required 证据层 provider 缺席 → 可定位 gap，且不得被写成"降级"。
    await withChainProject(async projectRoot => {
      await advanceWholeChain(projectRoot);
      const evaluated = evaluateComponentClosure(projectRoot, COMPONENT, {
        evaluatedAt: FIXED_TIME,
        evidenceProviders: [uiDeviceVisualEvidenceProvider, humanAcceptanceRiskEvidenceProvider],
      });
      assert(evaluated.closure.verdict === 'FAIL', `required provider 缺席仍放行：${evaluated.closure.verdict}`);
      assert(evaluated.closure.gaps.length > 0, 'required provider 缺席未形成可定位 gap');
      assert(
        evaluated.closure.degradations.every(item => !item.degradation_id.includes('automated-construction-evidence')),
        'required provider 缺席被误报成降级而不是阻塞',
      );
    });
  }));

  results.push(await asyncTest('seam 2/5 optional provider absence degrades the main chain visibly', async () => {
    await withChainProject(async projectRoot => {
      await advanceWholeChain(projectRoot);
      const evaluated = evaluateComponentClosure(projectRoot, COMPONENT, { evaluatedAt: FIXED_TIME });
      assert(
        evaluated.closure.verdict === 'PASS_WITH_DEGRADATION',
        `optional provider 缺席未在主链上留下降级：${evaluated.closure.verdict}`,
      );
      const degradation = evaluated.closure.degradations
        .find(item => item.degradation_id === 'degradation:human-acceptance-risk:missing');
      assert(degradation, `降级未点名缺席 provider：${evaluated.closure.degradations.map(item => item.degradation_id).join(',')}`);
      assert(
        Boolean(degradation!.owner) && Boolean(degradation!.retrigger_condition),
        '降级缺 owner/解除条件——等于静默按存在处理',
      );
      const observed = evaluated.closure.provider_observations
        .find(item => item.provider_id === 'human-acceptance-risk');
      assert(observed?.status === 'missing', `缺席 provider 未在观察面标 missing：${observed?.status}`);
    });
  }));

  results.push(await asyncTest('seam 3/5 an independent provider implementation is consumed through the same protocol', async () => {
    await withChainProject(async projectRoot => {
      await advanceWholeChain(projectRoot);
      const builtin = evaluateComponentClosure(projectRoot, COMPONENT, { evaluatedAt: FIXED_TIME });
      // 独立实现：不包装、不调用内置 provider，自行按协议逐条核验并申领。
      const independent: ClosureEvidenceProvider = (root, inputs, requested) => {
        const claimed: string[] = [];
        const seen = new Set<string>();
        for (const identity of [...requested].reverse()) {
          if (seen.has(identity)) continue;
          seen.add(identity);
          const observation = verifyClosureEvidenceIdentity(root, identity, inputs, 'automated-construction-evidence');
          if (observation.status === 'current') claimed.push(identity);
        }
        return {
          provider_id: 'automated-construction-evidence',
          available: claimed.length > 0,
          claimed_evidence_identities: claimed,
        };
      };
      const replaced = evaluateComponentClosure(projectRoot, COMPONENT, {
        evaluatedAt: FIXED_TIME,
        evidenceProviders: [independent, uiDeviceVisualEvidenceProvider, humanAcceptanceRiskEvidenceProvider],
      });
      assert(
        JSON.stringify(replaced.closure) === JSON.stringify(builtin.closure),
        '换成独立实现后同协议产物不等值——消费面被具体实现绑架',
      );
      assert(replaced.closure.verdict === builtin.closure.verdict, 'provider 替换改变了最终裁决');
    });
  }));

  results.push(await asyncTest('seam 4/5 authority conflict fails deterministically at every layer', async () => {
    // 坏蓝图侧：同一 seam 重复注册 → P1 fail-closed，下游整链停摆。
    await withChainProject(async projectRoot => {
      const p1 = checkCanonicalComponentBlueprint(projectRoot, COMPONENT).issues.map(issue => issue.id);
      assert(
        p1.includes('blueprint_provider_duplicate_authority'),
        `P1 未对重复权威 provider fail-closed：${p1.join(',')}`,
      );
      const decision = await runChangeUnitProgression(projectRoot, COMPONENT, {
        caller: async () => { throw new Error('权威冲突时不得启动任何 CU'); },
      });
      assert(decision.action === 'blocked', `权威冲突后仍推进：${decision.action}`);
      assert(
        decision.reasons.some(reason => reason.includes('blueprint_provider_duplicate_authority')),
        `阻塞原因未携权威冲突诊断：${decision.reasons.join('；').slice(0, 200)}`,
      );
    }, {
      mutateBlueprint: blueprint => {
        const providers = asRecords(blueprint.providers);
        blueprint.providers = [...providers, JSON.parse(JSON.stringify(providers[0])) as BlueprintRecord];
      },
    });

    // P2 静态接线侧：同一权威接缝两个可用 provider。
    const boundary = validateChangeUnitProviderBoundary([
      ...BUILTIN_CHANGE_UNIT_PROVIDERS,
      { seam: 'relation_ready_analysis', providerId: 'second-analyzer', authoritative: true, available: true },
    ]);
    assert(!boundary.ok, 'P2 在权威冲突下仍放行');
    assert(
      boundary.blockers.some(blocker => blocker.startsWith('change_unit_provider_authority_conflict:relation_ready_analysis')),
      `P2 权威冲突未精确点名：${boundary.blockers.join(',')}`,
    );

    // P3 侧（干净链）：同一 provider_id 重复供给 → conflict，不得靠顺序覆盖选出一个。
    await withChainProject(async projectRoot => {
      await advanceWholeChain(projectRoot);
      const evaluated = evaluateComponentClosure(projectRoot, COMPONENT, {
        evaluatedAt: FIXED_TIME,
        evidenceProviders: [
          automatedConstructionEvidenceProvider,
          automatedConstructionEvidenceProvider,
          uiDeviceVisualEvidenceProvider,
          humanAcceptanceRiskEvidenceProvider,
        ],
      });
      const observed = evaluated.closure.provider_observations
        .find(item => item.provider_id === 'automated-construction-evidence');
      assert(observed?.status === 'conflict', `P3 重复权威未判 conflict：${observed?.status}`);
      assert(evaluated.closure.verdict === 'FAIL', `P3 权威冲突下仍放行：${evaluated.closure.verdict}`);
    });
  }));

  results.push(await asyncTest('seam 5/5 provider exit leaves no orphan cache, no second SSOT, no deleted history', async () => {
    await withChainProject(async projectRoot => {
      await advanceWholeChain(projectRoot);
      // 先让正式产物真的落盘（canonical closure YAML + 评审投影），退出才有"历史"可谈。
      const materialized = writeCanonicalComponentClosure(projectRoot, COMPONENT, { evaluatedAt: FIXED_TIME });
      assert(materialized.closure.verdict !== 'FAIL', `退出前基线不成立：${materialized.closure.verdict}`);
      const canonicalPath = path.relative(projectRoot, materialized.canonicalPath).split(path.sep).join('/');
      const beforeObserved = materialized.closure.provider_observations
        .find(item => item.provider_id === 'automated-construction-evidence');
      assert(beforeObserved?.status === 'current', `退出前 provider 不是 current：${beforeObserved?.status}`);
      const before = snapshotProject(projectRoot);
      assert(before.has(canonicalPath), '正式 closure 产物未落盘，本用例失去意义');

      // provider 退出 = 不再供给该实现；派生结果重算，正式产物一个不许动。
      const evaluated = evaluateComponentClosure(projectRoot, COMPONENT, {
        evaluatedAt: FIXED_TIME,
        evidenceProviders: [uiDeviceVisualEvidenceProvider, humanAcceptanceRiskEvidenceProvider],
      });
      const after = snapshotProject(projectRoot);

      // ① 无孤儿缓存：退出后的重新派生不得在项目里留下任何新文件。
      const added = [...after.keys()].filter(file => !before.has(file));
      assert(added.length === 0, `provider 退出后留下孤儿产物：${added.slice(0, 5).join(', ')}`);

      // ② 历史证据与正式产物不删不改：逐字节原样保留（含已落盘的 canonical closure）。
      const changed = [...before.entries()].filter(([file, hash]) => after.get(file) !== hash);
      assert(changed.length === 0, `provider 退出改写了历史：${changed.slice(0, 5).map(item => item[0]).join(', ')}`);
      assert(after.get(canonicalPath) === before.get(canonicalPath), '退出把已落盘的正式 closure 改掉了');
      for (const loaded of enumerateCanonicalChangeUnits(projectRoot, COMPONENT)) {
        const unit = asChangeUnitArtifact(loaded.changeUnit);
        assert(
          observeChangeUnitCompletion(projectRoot, unit).state === 'VALID',
          `${unit.change_unit_id} 的历史完成事实被 provider 退出破坏`,
        );
      }

      // ③ 派生投影失效并重算：同一份输入下，退出后的观察面必须从 current 翻成 missing，
      //    但 provider 仍在协议里被点名，而不是悄悄消失（无第二真源）。
      const afterObserved = evaluated.closure.provider_observations
        .find(item => item.provider_id === 'automated-construction-evidence');
      assert(afterObserved?.status === 'missing', `退出的 provider 未在观察面留痕：${afterObserved?.status}`);
      assert(
        evaluated.closure.provider_observations.length === materialized.closure.provider_observations.length,
        `provider 观察面数量漂移（协议被实现改写）：${evaluated.closure.provider_observations.length}`,
      );
      // ④ 派生投影必须失效并重新派生：input_fingerprint 按设计含 provider_observations，
      //    所以退出后已落盘的 closure 必须被判 stale，而不是继续当现行结论用。
      assert(
        evaluated.closure.input_fingerprint !== materialized.closure.input_fingerprint,
        'provider 退出后派生指纹未变——已落盘的旧结论会被继续当成现行',
      );
      const revalidated = validateComponentClosure(materialized.closure, projectRoot, COMPONENT, {
        evaluatedAt: FIXED_TIME,
        evidenceProviders: [uiDeviceVisualEvidenceProvider, humanAcceptanceRiskEvidenceProvider],
      });
      assert(
        revalidated.issues.some(issue => issue.id === 'component_closure_input_fingerprint_stale'),
        `退出后旧 closure 未被判 stale：${revalidated.issues.map(issue => issue.id).slice(0, 6).join(',')}`,
      );
    });
  }));

  // ── MG-D：宿主演进接缝（§11.3）四项证明落成真行为 + 绕过反例。 ────────────────
  const SEAM_PROOF_REFS = {
    contract_compatibility: 'test/ledger/closure.test.ts#proveSeamContractCompatibility',
    provider_replacement: 'test/ledger/closure.test.ts#proveSeamProviderReplacement',
    absence_failure: 'test/ledger/closure.test.ts#proveSeamAbsenceFailure',
    consumer_no_bypass: 'test/ledger/closure.test.ts#proveSeamConsumerNoBypass',
  };

  function establishSeam(proofs: Record<string, string>): (blueprint: BlueprintRecord) => void {
    return blueprint => {
      const decision = asRecords(asRecord(blueprint.decisions_and_gaps)?.decisions)
        .find(item => item.decision_id === 'seam-shape')!;
      decision.human_decision = 'establish_seam';
      decision.failure_semantics = 'block';
      decision.closure_proofs = { ...proofs };
      decision.tests = Object.values(proofs);
    };
  }

  results.push(await asyncTest('host evolution seam closes on four proofs that really exercise the seam', async () => {
    // 先证明四项证明不是占位：逐个真跑，且是对 src/ledger 接缝求值。
    const executed = Object.entries(seamProofs).map(([name, proof]) => [name, proof()] as const);
    for (const [name, value] of executed) {
      assert(value === true, `接缝证明 ${name} 未通过真实执行`);
    }
    assert(executed.length === 4, `接缝证明数量不对：${executed.length}`);
    // 同一把尺子对故意绕过接缝的 Consumer 必须判负，否则"不绕过"是空断言。
    assert(bypassCheckAcceptsCleanConsumer() === true, '绕过尺子把干净 Consumer 判负');
    assert(bypassCheckRejectsBypassingConsumer() === false, '绕过尺子对绕过 Consumer 判正——检查无效');

    await withChainProject(async projectRoot => {
      await advanceWholeChain(projectRoot);
      const evaluated = evaluateComponentClosure(projectRoot, COMPONENT, { evaluatedAt: FIXED_TIME });
      assert(
        !evaluated.issues.some(issue => issue.id.startsWith('component_closure_seam_')),
        `接缝闭环未通过：${evaluated.issues.filter(item => item.id.startsWith('component_closure_seam_')).map(item => item.id).join(',')}`,
      );
      const proofRows = evaluated.closure.coverage_rows
        .filter(row => row.kind.startsWith('evolution_seam_') && row.kind !== 'evolution_seam_decision');
      assert(proofRows.length === 4, `四项接缝证明未各自成行：${proofRows.length}`);
      assert(
        proofRows.every(row => row.observation === 'covered' && row.evidence_identities.length > 0),
        '接缝证明行未各自闭合到真实证据',
      );
      assert(evaluated.closure.verdict !== 'FAIL', `已建缝的部件闭环失败：${evaluated.closure.verdict}`);
    }, { mutateBlueprint: establishSeam(SEAM_PROOF_REFS) });
  }));

  results.push(await asyncTest('host evolution seam proof that no executed evidence covers fails the closure', async () => {
    await withChainProject(async projectRoot => {
      await advanceWholeChain(projectRoot);
      const evaluated = evaluateComponentClosure(projectRoot, COMPONENT, { evaluatedAt: FIXED_TIME });
      // 该 ref 指向真实存在的符号，所以解析得出——但没有任何 PASS check 执行过它，
      // 证据门必须让这一行 uncovered 并落成可定位 gap，而不是放行。
      const row = evaluated.closure.coverage_rows
        .find(item => item.kind === 'evolution_seam_consumer_no_bypass');
      assert(row?.observation === 'uncovered', `无执行证据的接缝证明仍被判覆盖：${row?.observation}`);
      const gap = evaluated.closure.gaps.find(item => item.obligation_refs.includes(row!.obligation_id));
      assert(gap, `未形成可定位 gap：${evaluated.closure.gaps.map(item => item.gap_id).slice(0, 6).join(',')}`);
      assert(gap!.classification === 'incomplete', `gap 分类错误：${gap!.classification}`);
      assert(evaluated.closure.verdict === 'FAIL', `接缝证明无证据覆盖仍放行：${evaluated.closure.verdict}`);
      // 其余三项仍闭合——证明失败被精确定位到那一项，不是整块塌掉。
      const others = evaluated.closure.coverage_rows.filter(item =>
        item.kind.startsWith('evolution_seam_') && item.kind !== 'evolution_seam_consumer_no_bypass');
      assert(others.every(item => item.observation === 'covered'), '接缝失败未被精确定位到单项证明');
    }, {
      mutateBlueprint: establishSeam({
        ...SEAM_PROOF_REFS,
        consumer_no_bypass: 'test/ledger/seam-bypass.case.ts#bypassCheckRejectsBypassingConsumer',
      }),
    });
  }));

  results.push(await asyncTest('design questioning never ran blocks every downstream layer', async () => {
    // MG-B2①（与 design bypass 同属"设计未准入/被绕过"这一类断点的另一半）：
    // 质询根本没跑过的蓝图，不得被 P2 消费，更不得进入部件闭环。
    await withChainProject(async projectRoot => {
      const p1 = checkCanonicalComponentBlueprint(projectRoot, COMPONENT).issues.map(issue => issue.id);
      assert(
        p1.includes('blueprint_questioning_provider_missing'),
        `P1 未识破"未经质询"的蓝图：${p1.join(',')}`,
      );
      const decision = await runChangeUnitProgression(projectRoot, COMPONENT, {
        caller: async () => { throw new Error('蓝图未过质询时不得启动任何 CU'); },
      });
      assert(decision.action === 'blocked', `未经质询的蓝图仍被推进：${decision.action}`);
      assert(
        decision.reasons.some(reason => reason.includes('blueprint_questioning_provider_missing')),
        `阻塞原因未携质询诊断：${decision.reasons.join('；').slice(0, 200)}`,
      );
      const probe = probeAllLayers(projectRoot);
      assert(
        probe.p3.some(id => id.startsWith('component_closure_evaluation_failed'))
          || probe.p3Verdict === 'FAIL',
        `P3 在蓝图未过质询时仍放行：${probe.p3Verdict}`,
      );
    }, {
      mutateBlueprint: blueprint => {
        delete asRecord(blueprint.review_summary)!.questioning;
      },
    });
  }));

  results.push(await asyncTest('a manifest-tracked proof source that changes after its report unbinds the evidence', async () => {
    // 证据绑定"被执行的那一版源码"的前提是：该源码在 phase manifest 的 inputs 里。
    // 在场时，报告生成后改证明函数（保留同名 symbol）必须让血缘转 stale、该报告失效。
    //
    // 【生产限制，已实测】不在场时抓不到——生产的 phase-closure-finalizer 只把 requirement SSOT
    // 与 capability evidence 放进 extraInputs，从不把 script-report 的 affected_files 纳入；而
    // hasCurrentAuthoritativeExecution 只查报告里的 PASS+symbol+path，不要求该文件在 manifest 中。
    // 所以本例守的是"绑定在场时链路成立"，不等于生产默认受保护。详见 plan §16。
    await withChainProject(async projectRoot => {
      await advanceWholeChain(projectRoot);
      const clean = evaluateComponentClosure(projectRoot, COMPONENT, { evaluatedAt: FIXED_TIME });
      assert(clean.closure.verdict !== 'FAIL', `基线就不成立，本用例失去意义：${clean.closure.verdict}`);

      const proofFile = path.join(projectRoot, 'test', 'ledger', 'closure.test.ts');
      const before = fs.readFileSync(proofFile, 'utf8');
      fs.writeFileSync(proofFile, `${before}\n// 报告生成之后被改动：symbol 全部保留，仅字节变化。\n`, 'utf8');
      assert(
        fs.readFileSync(proofFile, 'utf8').includes('proveSeamConsumerNoBypass'),
        '反例把符号也改没了——那样测的就不是"同名 symbol 背书"了',
      );

      const tampered = evaluateComponentClosure(projectRoot, COMPONENT, { evaluatedAt: FIXED_TIME });
      assert(
        tampered.closure.verdict === 'FAIL',
        `改动被执行源码后旧报告仍为其背书：${tampered.closure.verdict}`,
      );
      assert(
        tampered.closure.coverage_rows.some(row =>
          row.required && row.observation !== 'covered'
          && row.evidence_identities.some(identity => identity.length > 0)),
        '源码改动未让任何依赖该证据的 obligation 失去覆盖',
      );
    });
  }));

  results.push(await asyncTest('a PASS report over an authority file the fresh manifest never tracked cannot cover closure', async () => {
    // 单变量：报告仍 PASS、manifest 仍完整且 fresh（同一 requirementSha、指针同步更新），
    // **只**把 authority 文件这一条 input 摘掉——这正是修复前生产 phase-closure-finalizer
    // 的形态。证据门必须拒收，否则"改源码→stale→失效"整条链对证明源码就是空门。
    await withChainProject(async projectRoot => {
      await advanceWholeChain(projectRoot);
      const clean = evaluateComponentClosure(projectRoot, COMPONENT, { evaluatedAt: FIXED_TIME });
      assert(clean.closure.verdict !== 'FAIL', `基线就不成立，本用例失去意义：${clean.closure.verdict}`);

      for (const loaded of enumerateCanonicalChangeUnits(projectRoot, COMPONENT)) {
        const unit = asChangeUnitArtifact(loaded.changeUnit);
        const feature = deriveChangeUnitFeatureId(unit.component_id, unit.change_unit_id);
        const requirementSha = computeRunRequirementSha(projectRoot, feature, RUN_ID);
        for (const phase of ['ut', 'testing'] as const) {
          const current = loadPhaseEvidenceManifest(projectRoot, feature, phase);
          assert(current, `${feature}/${phase} 缺 manifest，前置不成立`);
          const kept = current!.manifest.inputs
            .map(entry => entry.path)
            .filter(entry => !entry.includes('closure.test'));
          assert(
            kept.length === current!.manifest.inputs.length - 1,
            `${feature}/${phase} 未恰好摘掉一条 authority input——单变量不成立`,
          );
          const written = writePhaseEvidenceManifest(projectRoot, resolvePhaseEvidenceManifest({
            projectRoot, feature, phase, now: FIXED_NOW, requirementSha, extraInputs: kept,
          }));
          writeReceiptManifestPointer(
            projectRoot, feature, phase,
            path.relative(projectRoot, written.absPath).split(path.sep).join('/'),
            written.sha256,
          );
          const rewritten = loadPhaseEvidenceManifest(projectRoot, feature, phase);
          assert(rewritten?.integrityOk === true, `${feature}/${phase} 重写后 manifest 自身不完整——变量被污染`);
        }
        // 重写 manifest 会让既有完成投影失效（它绑定 manifest 哈希）。必须按生产 writer
        // 重新生成，否则用例会先死在 completion 层，根本走不到证据门——变量污染。
        const expected = resolveChangeUnitExpectedExecution(projectRoot, feature);
        generateFeatureCompletion({
          projectRoot,
          feature,
          chain: [...expected.expectedChain],
          workflowTrack: expected.expectedTrack,
          runId: RUN_ID,
          runDirAbs: featureFilePath(projectRoot, feature, path.join('goal-runs', RUN_ID)),
          phaseRunIds: {},
          now: FIXED_NOW,
        });
        assert(
          observeChangeUnitCompletion(projectRoot, unit).state === 'VALID',
          `${unit.change_unit_id} 重建后 completion 非 VALID——变量仍被污染`,
        );
      }

      const untracked = evaluateComponentClosure(projectRoot, COMPONENT, { evaluatedAt: FIXED_TIME });
      assert(
        untracked.closure.verdict === 'FAIL',
        `manifest 未登记 authority 文件时仍放行：${untracked.closure.verdict}`,
      );
      assert(
        untracked.closure.coverage_rows.some(row =>
          row.required && row.observation !== 'covered' && row.evidence_identities.length > 0),
        '未登记 authority 时没有任何 obligation 失去覆盖',
      );
    });
  }));

  return results;
}
