import { runUnitCasesAsync, discoveryResult } from '../utils/unit-cases';

// 同一输入上的设计、施工准备与部件闭环检查。

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { checkCanonicalComponentBlueprint } from '../../scripts/check-component-blueprint';
import { BlueprintRecord, asRecord, asRecords } from '../../scripts/utils/component-blueprint-model';
import { validateChangeUnitDesign } from '../../scripts/utils/change-unit-design-gate';
import { evaluateComponentClosure } from '../../scripts/utils/component-closure-validator';
import { enumerateCanonicalChangeUnits } from '../../scripts/utils/change-unit-path';
import { runChangeUnitProgression } from '../../scripts/utils/change-unit-progress-loop';
// P3 套件的现场装配（施工投影 + 可信证据链 + 哈希重绑）唯一实现，MG 直接复用，不另造夹具。
import { prepareCompleteProject } from './component-closure.unit.test';
import type { UnitCaseResult } from '../run-unit';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const FIXTURE_PROJECT = path.resolve(__dirname, '..', 'fixtures', 'component-blueprint', 'valid');
const COMPONENT = 'ledger-app-blueprint';
const FIXED_TIME = '2026-08-20T00:00:00.000Z';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function asyncTest(name: string, run: () => Promise<void>): Promise<UnitCaseResult> {
  const caption = `mechanical-loop: ${name}`;
  const [result] = await runUnitCasesAsync([{ name: caption, run }]);
  return result ?? discoveryResult(caption);
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
    fs.writeFileSync(path.join(projectRoot, 'framework.config.json'), JSON.stringify({ active_workflow: 'spec-driven' }));
    fs.cpSync(path.join(REPO_ROOT, 'workflows'), path.join(projectRoot, 'framework', 'workflows'), { recursive: true });
    if (options.prepared !== false) prepareCompleteProject(projectRoot, options.mutateBlueprint);
    options.mutateProject?.(projectRoot);
    await body(projectRoot);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
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

/** Fixture coordinator calls the same current-fact step once per actual canonical CU. */
async function runCanonicalFixtureSteps(projectRoot: string, options: Parameters<typeof runChangeUnitProgression>[2]) {
  let decision = await runChangeUnitProgression(projectRoot, COMPONENT, options);
  for (const _unit of enumerateCanonicalChangeUnits(projectRoot, COMPONENT).slice(1)) {
    if (decision.action !== 'select_one') return decision;
    decision = await runChangeUnitProgression(projectRoot, COMPONENT, options);
  }
  return decision;
}

export async function runAll(): Promise<UnitCaseResult[]> {
  const results: UnitCaseResult[] = [];

  // ── MG-B：五类跨层断点。每例都断三层实际出口，不只断最下游。 ───────────────────
  interface BreakpointCase {
    name: string;
    options: ChainProjectOptions;
    /** 断点注入前是否需要先把整条链推到全绿（用于"上游全绿、组装才炸"的反例） */
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
  ];

  for (const breakpoint of breakpoints) {
    results.push(await asyncTest(breakpoint.name, async () => {
      await withChainProject(async projectRoot => {
        breakpoint.expect(probeAllLayers(projectRoot));
      }, breakpoint.options);
    }));
  }

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

  results.push(await asyncTest('design questioning never ran blocks every downstream layer', async () => {
    // MG-B2①（与 design bypass 同属"设计未准入/被绕过"这一类断点的另一半）：
    // 质询根本没跑过的蓝图，不得被 P2 消费，更不得进入部件闭环。
    await withChainProject(async projectRoot => {
      const p1 = checkCanonicalComponentBlueprint(projectRoot, COMPONENT).issues.map(issue => issue.id);
      assert(
        p1.includes('blueprint_questioning_provider_missing'),
        `P1 未识破"未经质询"的蓝图：${p1.join(',')}`,
      );
      const decision = await runCanonicalFixtureSteps(projectRoot, {
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

  return results;
}
