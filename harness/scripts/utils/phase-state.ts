// ============================================================================
// 阶段状态机 + 闭环同步（.current-phase.json / summary.json）
// ============================================================================
// SSOT：harness-runner、check-receipt.ts、--sync-closure 共用，避免双份逻辑。

import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import {
  featurePhaseReportsDir,
  loadFrameworkConfig,
  receiptFilePath,
  statefilePath,
} from '../../config';
import {
  isPhaseGlobalInWorkflow,
  resolveWorkflowSpec,
  type WorkflowSpec,
} from '../../workflow-loader';

export type FeaturePhase =
  | 'prd'
  | 'design'
  | 'coding'
  | 'review'
  | 'ut'
  | 'testing';

export interface ReceiptValidation {
  status: 'passed' | 'failed' | 'missing' | 'error';
  receipt_path: string;
  exit_code?: number;
  message?: string;
}

export interface CurrentPhaseStatePartial {
  phase: string;
  feature: string;
  status: 'running' | 'harness_finished';
  started_at?: string;
  last_run_at?: string;
  verdict?: 'PASS' | 'FAIL' | string;
  blocker_count?: number;
  receipt?: ReceiptValidation | null;
}

interface CurrentPhaseState extends CurrentPhaseStatePartial {
  schema_version: string;
  updated_at: string;
  session_id?: string | null;
  session_id_recorded_at?: string | null;
  last_seen_session_id?: string | null;
  last_seen_at?: string | null;
}

export interface HarnessRunSummaryPatch {
  closure_status?: 'open' | 'closed';
  receipt_status?: string;
  next_action?: string;
}

function loadWorkflowSpec(projectRoot: string, frameworkRoot?: string): WorkflowSpec {
  const cfg = loadFrameworkConfig(projectRoot);
  return resolveWorkflowSpec(projectRoot, { config: cfg, frameworkRoot });
}

/** goal-runner harness spawn sets this; suppresses global .current-phase.json writes. */
export const MAISON_GOAL_RUNNER_ENV = 'MAISON_GOAL_RUNNER';

/** goal-runner headless agent trees inherit MAISON_GOAL_HEADLESS from agent-invoke. */
export const MAISON_GOAL_HEADLESS_ENV = 'MAISON_GOAL_HEADLESS';

export function isGoalOrchestrationEnv(): boolean {
  return (
    process.env[MAISON_GOAL_RUNNER_ENV] === '1' || process.env[MAISON_GOAL_HEADLESS_ENV] === '1'
  );
}

export function mergeAndWritePhaseState(
  projectRoot: string,
  workflowSpec: WorkflowSpec,
  partial: CurrentPhaseStatePartial,
): void {
  // goal 编排链下不写全局 state，避免污染 Stop hook 判定
  if (isGoalOrchestrationEnv()) return;
  if (isPhaseGlobalInWorkflow(workflowSpec, partial.phase)) {
    return;
  }

  try {
    const stateAbs = statefilePath(projectRoot);
    const dir = path.dirname(stateAbs);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    let prev: Partial<CurrentPhaseState> = {};
    if (fs.existsSync(stateAbs)) {
      try {
        prev = JSON.parse(fs.readFileSync(stateAbs, 'utf-8')) as Partial<CurrentPhaseState>;
      } catch {
        // corrupt → overwrite
      }
    }

    const sameTask = prev.phase === partial.phase && prev.feature === partial.feature;
    const carrySessionId = sameTask ? prev.session_id ?? null : null;
    const carrySessionRecordedAt = sameTask ? prev.session_id_recorded_at ?? null : null;
    const carryLastSeenSid = sameTask ? prev.last_seen_session_id ?? null : null;
    const carryLastSeenAt = sameTask ? prev.last_seen_at ?? null : null;

    const next: CurrentPhaseState = {
      schema_version: '1.1',
      phase: partial.phase,
      feature: partial.feature,
      status: partial.status,
      started_at:
        partial.status === 'running'
          ? partial.started_at ?? new Date().toISOString()
          : sameTask
            ? prev.started_at ?? partial.started_at
            : partial.started_at,
      last_run_at: partial.last_run_at ?? new Date().toISOString(),
      verdict: partial.verdict,
      blocker_count: partial.blocker_count,
      receipt: partial.receipt ?? null,
      session_id: carrySessionId,
      session_id_recorded_at: carrySessionRecordedAt,
      last_seen_session_id: carryLastSeenSid,
      last_seen_at: carryLastSeenAt,
      updated_at: new Date().toISOString(),
    };

    fs.writeFileSync(stateAbs, JSON.stringify(next, null, 2) + '\n', 'utf-8');
  } catch (err) {
    console.warn(`   ⚠ 写 .current-phase.json 失败: ${(err as Error).message}`);
  }
}

/** check-receipt PASS 或 --sync-closure 成功后回写 state。 */
export function syncPhaseStateOnReceiptPass(
  projectRoot: string,
  feature: string,
  phase: string,
  receiptValidation: ReceiptValidation,
  opts?: { blocker_count?: number; frameworkRoot?: string },
): void {
  const workflowSpec = loadWorkflowSpec(projectRoot, opts?.frameworkRoot);
  mergeAndWritePhaseState(projectRoot, workflowSpec, {
    phase,
    feature,
    status: 'harness_finished',
    last_run_at: new Date().toISOString(),
    verdict: 'PASS',
    blocker_count: opts?.blocker_count ?? 0,
    receipt: receiptValidation,
  });
}

export function tryValidateReceipt(
  harnessRoot: string,
  projectRoot: string,
  phase: string,
  feature: string,
): ReceiptValidation {
  const receiptAbs = receiptFilePath(projectRoot, feature, phase);
  const receiptRel = path.relative(projectRoot, receiptAbs).replace(/\\/g, '/');

  if (!fs.existsSync(receiptAbs)) {
    return {
      status: 'missing',
      receipt_path: receiptRel,
      message: '回执文件不存在；本阶段尚未闭环（全局入口 §5.1 第 4 条）。',
    };
  }

  const checker = path.join(harnessRoot, 'scripts', 'check-receipt.ts');
  if (!fs.existsSync(checker)) {
    return {
      status: 'error',
      receipt_path: receiptRel,
      message: `check-receipt.ts 不存在于 ${checker}（框架未升级到位）。`,
    };
  }

  const isWin = process.platform === 'win32';
  const result = spawnSync(
    isWin ? 'npx.cmd' : 'npx',
    [
      'ts-node',
      checker,
      '--feature',
      feature,
      '--phase',
      phase,
      '--project-root',
      projectRoot,
      '--skip-state-sync',
    ],
    {
      cwd: harnessRoot,
      encoding: 'utf-8',
      shell: isWin,
    },
  );

  if (result.status === 0) {
    return { status: 'passed', receipt_path: receiptRel, exit_code: 0 };
  }
  if (result.status === 1) {
    return {
      status: 'failed',
      receipt_path: receiptRel,
      exit_code: 1,
      message: (result.stderr ?? '').slice(0, 800),
    };
  }
  return {
    status: 'error',
    receipt_path: receiptRel,
    exit_code: result.status ?? -1,
    message: (result.stderr ?? result.error?.message ?? 'unknown').slice(0, 800),
  };
}

/** 若 summary.json 存在则合并 closure 字段（best-effort）。 */
export function patchSummaryClosureStatus(
  projectRoot: string,
  feature: string,
  phase: string,
  patch: HarnessRunSummaryPatch,
  frameworkRoot?: string,
): boolean {
  const summaryPath = path.join(
    featurePhaseReportsDir(projectRoot, feature, phase, frameworkRoot),
    'summary.json',
  );
  if (!fs.existsSync(summaryPath)) {
    return false;
  }
  try {
    const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8')) as Record<string, unknown>;
    if (patch.closure_status !== undefined) {
      summary.closure_status = patch.closure_status;
    }
    if (patch.receipt_status !== undefined) {
      summary.receipt_status = patch.receipt_status;
    }
    if (patch.next_action !== undefined) {
      summary.next_action = patch.next_action;
    }
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf-8');
    return true;
  } catch {
    return false;
  }
}

export function applyClosurePatchFromReceiptValidation(
  projectRoot: string,
  feature: string,
  phase: string,
  receiptValidation: ReceiptValidation | null,
  frameworkRoot?: string,
): void {
  const closed = receiptValidation?.status === 'passed';
  patchSummaryClosureStatus(projectRoot, feature, phase, {
    closure_status: closed ? 'closed' : 'open',
    receipt_status: receiptValidation?.status,
    next_action: closed ? 'phase_closed_wait_user' : undefined,
  }, frameworkRoot);
}

export function runSyncClosure(
  harnessRoot: string,
  projectRoot: string,
  feature: string,
  phase: string,
  frameworkRoot?: string,
): number {
  const receiptValidation = tryValidateReceipt(harnessRoot, projectRoot, phase, feature);
  const workflowSpec = loadWorkflowSpec(projectRoot, frameworkRoot);

  if (receiptValidation.status === 'passed') {
    syncPhaseStateOnReceiptPass(projectRoot, feature, phase, receiptValidation, { frameworkRoot });
    applyClosurePatchFromReceiptValidation(projectRoot, feature, phase, receiptValidation, frameworkRoot);
    console.log('');
    console.log('✅ sync-closure: 阶段已闭环（check-receipt PASS）');
    console.log(`   state: ${path.relative(projectRoot, statefilePath(projectRoot)).replace(/\\/g, '/')}`);
    console.log(`   receipt: ${receiptValidation.receipt_path}`);
    return 0;
  }

  mergeAndWritePhaseState(projectRoot, workflowSpec, {
    phase,
    feature,
    status: 'harness_finished',
    last_run_at: new Date().toISOString(),
    verdict: receiptValidation.status === 'missing' ? 'PASS' : 'FAIL',
    blocker_count: 0,
    receipt: receiptValidation,
  });
  applyClosurePatchFromReceiptValidation(projectRoot, feature, phase, receiptValidation, frameworkRoot);

  console.error('');
  console.error(`❌ sync-closure: 未闭环（receipt.status=${receiptValidation.status}）`);
  if (receiptValidation.message) {
    console.error(`   ↳ ${receiptValidation.message.split(/\r?\n/)[0]}`);
  }
  return receiptValidation.status === 'missing' ? 2 : 1;
}
