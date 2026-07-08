// ============================================================================
// phase-state.unit.test.ts — 闭环态同步回归
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  MAISON_GOAL_HEADLESS_ENV,
  MAISON_GOAL_RUNNER_ENV,
  mergeAndWritePhaseState,
  patchSummaryClosureStatus,
  syncPhaseStateOnReceiptPass,
  tryValidateReceipt,
} from '../../scripts/utils/phase-state';
import { statefilePath } from '../../config';
import { resolveWorkflowSpec } from '../../workflow-loader';
import { DEFAULT_LAYOUT } from '../utils/layout-test-helper';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function mkProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phase-state-'));
  const frameworkRoot = path.resolve(__dirname, '..', '..', '..');
  fs.mkdirSync(path.join(root, 'framework', 'harness', 'state'), { recursive: true });
  fs.mkdirSync(path.join(root, 'framework', 'workflows'), { recursive: true });
  fs.copyFileSync(
    path.join(frameworkRoot, 'workflows', 'spec-driven.workflow.yaml'),
    path.join(root, 'framework', 'workflows', 'spec-driven.workflow.yaml'),
  );
  fs.mkdirSync(path.join(root, 'doc', 'features', 'demo', 'review'), { recursive: true });
  fs.mkdirSync(path.join(root, 'doc', 'features', 'demo', 'review', 'reports'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'framework.config.json'),
    JSON.stringify(
      {
        schema_version: '1.1',
        project_name: 'phase-state-test',
        project_profile: { name: 'generic' },
        agent_adapter: 'generic',
        architecture: {
          outer_layers: [{ id: 'app', can_depend_on: [], intra_layer_deps: 'forbid' }],
          module_inner_layers: ['content'],
          inner_dependency_direction: 'upward',
          cross_module_exports_file: 'index.ts',
        },
        paths: {
          features_dir: 'doc/features',
          module_catalog: 'doc/module-catalog.yaml',
          glossary: 'doc/glossary.yaml',
          glossary_seed: 'doc/glossary-seed.txt',
          architecture_md: 'doc/architecture.md',
          state_file: 'framework/harness/state/.current-phase.json',
          receipt_dir_pattern: 'doc/features/<feature>/<phase>',
          reports_dir_pattern: 'doc/features/<feature>/<phase>/reports',
        },
        active_workflow: 'spec-driven',
      },
      null,
      2,
    ),
  );
  return root;
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'syncPhaseStateOnReceiptPass 写入 receipt.status=passed',
    run: () => {
      const root = mkProject();
      try {
        const workflow = resolveWorkflowSpec(root);
        syncPhaseStateOnReceiptPass(
          root,
          'demo',
          'review',
          { status: 'passed', receipt_path: 'doc/features/demo/review/phase-completion-receipt.md', exit_code: 0 },
          { blocker_count: 0 },
        );
        const state = JSON.parse(fs.readFileSync(statefilePath(root), 'utf-8')) as {
          receipt?: { status?: string };
          verdict?: string;
        };
        assert(state.receipt?.status === 'passed', `expected passed, got ${state.receipt?.status}`);
        assert(state.verdict === 'PASS', `expected PASS verdict, got ${state.verdict}`);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'patchSummaryClosureStatus 合并 closure_status / next_action',
    run: () => {
      const root = mkProject();
      try {
        const summaryPath = path.join(root, 'doc', 'features', 'demo', 'review', 'reports', 'summary.json');
        fs.writeFileSync(
          summaryPath,
          JSON.stringify({ next_action: 'run_verifier_then_receipt', receipt_status: 'missing' }, null, 2),
        );
        const ok = patchSummaryClosureStatus(root, 'demo', 'review', {
          closure_status: 'closed',
          receipt_status: 'passed',
          next_action: 'phase_closed_wait_user',
        });
        assert(ok, 'patch should succeed');
        const patched = JSON.parse(fs.readFileSync(summaryPath, 'utf-8')) as Record<string, string>;
        assert(patched.closure_status === 'closed', 'closure_status missing');
        assert(patched.next_action === 'phase_closed_wait_user', 'next_action not updated');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'policy_snapshot 写入真实 track（feature.yaml lite / 缺省 full）——review 回归钉',
    run: () => {
      const root = mkProject();
      try {
        const workflow = resolveWorkflowSpec(root);
        const stateAbs = statefilePath(root);
        mergeAndWritePhaseState(root, workflow, { phase: 'coding', feature: 'demo', status: 'running' });
        let st = JSON.parse(fs.readFileSync(stateAbs, 'utf-8')) as {
          policy_snapshot?: { track?: string; policy_schema_version?: string };
        };
        assert(st.policy_snapshot?.track === 'full', `default track=${st.policy_snapshot?.track}`);
        assert(st.policy_snapshot?.policy_schema_version === '1.0', 'snapshot version');
        fs.writeFileSync(path.join(root, 'doc', 'features', 'demo', 'feature.yaml'), 'track: lite\n');
        mergeAndWritePhaseState(root, workflow, { phase: 'coding', feature: 'demo', status: 'running' });
        st = JSON.parse(fs.readFileSync(stateAbs, 'utf-8')) as typeof st;
        assert(st.policy_snapshot?.track === 'lite', `lite track=${st.policy_snapshot?.track}`);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'mergeAndWritePhaseState 保留同 task 的 session_id',
    run: () => {
      const root = mkProject();
      try {
        const workflow = resolveWorkflowSpec(root);
        const stateAbs = statefilePath(root);
        fs.writeFileSync(
          stateAbs,
          JSON.stringify(
            {
              schema_version: '1.1',
              phase: 'review',
              feature: 'demo',
              session_id: 'sid-keep-me',
              session_id_recorded_at: '2026-01-01T00:00:00Z',
            },
            null,
            2,
          ),
        );
        mergeAndWritePhaseState(root, workflow, {
          phase: 'review',
          feature: 'demo',
          status: 'harness_finished',
          verdict: 'PASS',
          blocker_count: 0,
          receipt: { status: 'missing', receipt_path: 'doc/features/demo/review/phase-completion-receipt.md' },
        });
        const state = JSON.parse(fs.readFileSync(stateAbs, 'utf-8')) as { session_id?: string };
        assert(state.session_id === 'sid-keep-me', 'session_id should be preserved');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'syncPhaseStateOnReceiptPass: external frameworkRoot 不 infer projectRoot',
    run: () => {
      const host = fs.mkdtempSync(path.join(os.tmpdir(), 'phase-state-ext-'));
      try {
        fs.mkdirSync(path.join(host, 'doc', 'features', 'demo', 'review'), { recursive: true });
        fs.writeFileSync(
          path.join(host, 'framework.config.json'),
          JSON.stringify(
            {
              schema_version: '1.1',
              project_name: 'phase-state-ext',
              project_profile: { name: 'generic' },
              agent_adapter: 'generic',
              architecture: {
                outer_layers: [{ id: 'app', can_depend_on: [], intra_layer_deps: 'forbid' }],
                module_inner_layers: ['content'],
                inner_dependency_direction: 'upward',
                cross_module_exports_file: 'index.ts',
              },
              paths: {
                features_dir: 'doc/features',
                module_catalog: 'doc/module-catalog.yaml',
                glossary: 'doc/glossary.yaml',
                glossary_seed: 'doc/glossary-seed.txt',
                architecture_md: 'doc/architecture.md',
                state_file: 'framework/harness/state/.current-phase.json',
                receipt_dir_pattern: 'doc/features/<feature>/<phase>',
                reports_dir_pattern: 'doc/features/<feature>/<phase>/reports',
              },
              active_workflow: 'spec-driven',
            },
            null,
            2,
          ),
        );
        syncPhaseStateOnReceiptPass(
          host,
          'demo',
          'review',
          {
            status: 'passed',
            receipt_path: 'doc/features/demo/review/phase-completion-receipt.md',
            exit_code: 0,
          },
          { blocker_count: 0, frameworkRoot: DEFAULT_LAYOUT.frameworkRoot },
        );
        const state = JSON.parse(fs.readFileSync(statefilePath(host), 'utf-8')) as {
          receipt?: { status?: string };
          verdict?: string;
        };
        assert(state.receipt?.status === 'passed', `expected passed, got ${state.receipt?.status}`);
        assert(state.verdict === 'PASS', `expected PASS verdict, got ${state.verdict}`);
      } finally {
        fs.rmSync(host, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'mergeAndWritePhaseState: MAISON_GOAL_RUNNER=1 跳过写入',
    run: () => {
      const root = mkProject();
      const prev = process.env[MAISON_GOAL_RUNNER_ENV];
      process.env[MAISON_GOAL_RUNNER_ENV] = '1';
      try {
        const workflow = resolveWorkflowSpec(root);
        const stateAbs = statefilePath(root);
        mergeAndWritePhaseState(root, workflow, {
          phase: 'review',
          feature: 'demo',
          status: 'harness_finished',
          verdict: 'PASS',
          blocker_count: 0,
          receipt: { status: 'missing', receipt_path: 'doc/features/demo/review/phase-completion-receipt.md' },
        });
        assert(!fs.existsSync(stateAbs), 'state file should not be created under MAISON_GOAL_RUNNER');
      } finally {
        if (prev === undefined) delete process.env[MAISON_GOAL_RUNNER_ENV];
        else process.env[MAISON_GOAL_RUNNER_ENV] = prev;
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'tryValidateReceipt：legacy prd 目录回执不被判 missing',
    run: () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phase-state-legacy-'));
      const harnessRoot = path.resolve(__dirname, '..', '..');
      try {
        fs.mkdirSync(path.join(root, 'doc', 'features', 'demo', 'prd'), { recursive: true });
        fs.writeFileSync(
          path.join(root, 'framework.config.json'),
          JSON.stringify(
            {
              schema_version: '1.1',
              project_name: 'legacy-receipt',
              project_profile: { name: 'generic' },
              agent_adapter: 'generic',
              architecture: {
                outer_layers: [{ id: 'app', can_depend_on: [], intra_layer_deps: 'forbid' }],
                module_inner_layers: ['content'],
                inner_dependency_direction: 'upward',
                cross_module_exports_file: 'index.ts',
              },
              paths: {
                features_dir: 'doc/features',
                module_catalog: 'doc/module-catalog.yaml',
                glossary: 'doc/glossary.yaml',
                glossary_seed: 'doc/glossary-seed.txt',
                architecture_md: 'doc/architecture.md',
                receipt_dir_pattern: 'doc/features/<feature>/<phase>',
              },
            },
            null,
            2,
          ),
        );
        fs.writeFileSync(
          path.join(root, 'doc', 'features', 'demo', 'prd', 'phase-completion-receipt.md'),
          '---\nfeature: demo\nphase: prd\n---\n',
        );
        const v = tryValidateReceipt(harnessRoot, root, 'spec', 'demo');
        assert(v.status !== 'missing', `expected not missing, got ${v.status}`);
        assert(v.receipt_path.replace(/\\/g, '/').includes('/prd/'), `legacy path: ${v.receipt_path}`);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'mergeAndWritePhaseState: MAISON_GOAL_HEADLESS=1 跳过写入',
    run: () => {
      const root = mkProject();
      const prev = process.env[MAISON_GOAL_HEADLESS_ENV];
      process.env[MAISON_GOAL_HEADLESS_ENV] = '1';
      try {
        const workflow = resolveWorkflowSpec(root);
        const stateAbs = statefilePath(root);
        mergeAndWritePhaseState(root, workflow, {
          phase: 'coding',
          feature: 'demo',
          status: 'running',
          started_at: new Date().toISOString(),
        });
        assert(!fs.existsSync(stateAbs), 'state file should not be created under MAISON_GOAL_HEADLESS');
      } finally {
        if (prev === undefined) delete process.env[MAISON_GOAL_HEADLESS_ENV];
        else process.env[MAISON_GOAL_HEADLESS_ENV] = prev;
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
];

export function runAll(): UnitCaseResult[] {
  return cases.map(c => {
    try {
      c.run();
      return { name: c.name, ok: true };
    } catch (err) {
      return { name: c.name, ok: false, error: (err as Error).stack ?? (err as Error).message };
    }
  });
}
