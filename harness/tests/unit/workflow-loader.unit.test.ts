// ============================================================================
// workflow-loader.unit.test.ts — workflow YAML 解析与 DAG / scope 语义
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  loadWorkflowSpec,
  resolveWorkflowSpec,
  listWorkflowPhases,
  isPhaseGlobalInWorkflow,
  workflowPhaseIdSet,
} from '../../workflow-loader';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

/** framework/ 目录（本文件位于 framework/harness/tests/unit） */
const FRAMEWORK_ROOT = path.resolve(__dirname, '..', '..', '..');

interface Case {
  name: string;
  run: () => void;
}

const cases: Case[] = [
  {
    name: 'loadWorkflowSpec(spec-driven): schema / name / artifact 数量',
    run: () => {
      const spec = loadWorkflowSpec(FRAMEWORK_ROOT, 'spec-driven');
      assert(spec.schema_version === '1.1', 'schema_version');
      assert(spec.name === 'spec-driven', 'name');
      // 12 经典 phase + lite 轨 change/exit（C1 feature-track）
      assert(spec.artifacts.length === 14, `artifacts len=${spec.artifacts.length}`);
    },
  },
  {
    name: 'workflowPhaseIdSet(spec-driven) 含 prd/plan/coding',
    run: () => {
      const spec = loadWorkflowSpec(FRAMEWORK_ROOT, 'spec-driven');
      const ids = workflowPhaseIdSet(spec);
      assert(ids.has('spec') && ids.has('coding') && ids.has('init') && ids.has('extensions'), 'missing ids');
      assert(ids.size === 14, 'size');
      assert(ids.has('module-graph'), 'module-graph');
      assert(ids.has('change') && ids.has('exit'), 'lite phases（C1）');
    },
  },
  {
    name: 'isPhaseGlobalInWorkflow: init/docs 为 global；prd 为 feature',
    run: () => {
      const spec = loadWorkflowSpec(FRAMEWORK_ROOT, 'spec-driven');
      assert(isPhaseGlobalInWorkflow(spec, 'init'), 'init global');
      assert(isPhaseGlobalInWorkflow(spec, 'docs'), 'docs global');
      assert(isPhaseGlobalInWorkflow(spec, 'extensions'), 'extensions global');
      assert(!isPhaseGlobalInWorkflow(spec, 'spec'), 'prd not global');
    },
  },
  {
    name: 'listWorkflowPhases(spec-driven): testing 在最后；prd 在 catalog/glossary 之后',
    run: () => {
      const spec = loadWorkflowSpec(FRAMEWORK_ROOT, 'spec-driven');
      const order = listWorkflowPhases(spec);
      assert(order.length === 14, 'topo length');
      assert(order[order.length - 1] === 'testing', 'testing must be last');
      const iCat = order.indexOf('catalog');
      const iGloss = order.indexOf('glossary');
      const iPrd = order.indexOf('spec');
      assert(iCat >= 0 && iGloss >= 0 && iPrd >= 0, 'indices');
      assert(iPrd > iCat && iPrd > iGloss, 'prd after catalog+glossary');
    },
  },
  {
    name: 'resolveWorkflowSpec: 默认回落 spec-driven',
    run: () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-resolve-'));
      fs.mkdirSync(path.join(dir, 'framework', 'workflows'), { recursive: true });
      fs.copyFileSync(
        path.join(FRAMEWORK_ROOT, 'workflows', 'spec-driven.workflow.yaml'),
        path.join(dir, 'framework', 'workflows', 'spec-driven.workflow.yaml'),
      );
      const spec = resolveWorkflowSpec(dir, {});
      assert(spec.name === 'spec-driven', 'fallback name');
    },
  },
  {
    name: '非法 workflow（DAG 环）→ listWorkflowPhases 抛错',
    run: () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-cycle-'));
      const wfDir = path.join(dir, 'framework', 'workflows');
      fs.mkdirSync(wfDir, { recursive: true });
      const cyclic = [
        'schema_version: "1.0"',
        'name: cyclic',
        'artifacts:',
        '  - id: a',
        '    scope: global',
        '    requires: [c]',
        '  - id: b',
        '    scope: global',
        '    requires: [a]',
        '  - id: c',
        '    scope: global',
        '    requires: [b]',
      ].join('\n');
      fs.writeFileSync(path.join(wfDir, 'cyclic.workflow.yaml'), cyclic, 'utf-8');
      let threw = false;
      try {
        loadWorkflowSpec(path.join(dir, 'framework'), 'cyclic');
      } catch {
        threw = true;
      }
      assert(threw, 'expected loadWorkflowSpec to throw on cycle');
    },
  },
];

export function runAll(): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];
  for (const c of cases) {
    try {
      c.run();
      results.push({ name: c.name, ok: true });
    } catch (e) {
      results.push({ name: c.name, ok: false, error: (e as Error).message });
    }
  }
  return results;
}
