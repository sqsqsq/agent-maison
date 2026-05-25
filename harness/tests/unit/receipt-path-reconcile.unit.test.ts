// ============================================================================
// receipt-path-reconcile.unit.test.ts — legacy receipt 路径 → doc/features/reports
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';

import {
  applyReceiptPathReconcileCandidate,
  detectReceiptPathPatches,
  resolveModernReportsRelForLegacyRef,
  scanReceiptPathReconcileCandidates,
} from '../../scripts/utils/receipt-path-reconcile';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
}

function mkProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'receipt-reconcile-'));
  const frameworkRoot = path.resolve(__dirname, '..', '..', '..');
  fs.mkdirSync(path.join(root, 'framework', 'workflows'), { recursive: true });
  fs.copyFileSync(
    path.join(frameworkRoot, 'workflows', 'spec-driven.workflow.yaml'),
    path.join(root, 'framework', 'workflows', 'spec-driven.workflow.yaml'),
  );
  writeFile(
    path.join(root, 'framework.config.json'),
    JSON.stringify(
      {
        schema_version: '1.1',
        project_name: 'receipt-reconcile-test',
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

function initGit(root: string): string {
  spawnSync('git', ['init'], { cwd: root, shell: false });
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root, shell: false });
  spawnSync('git', ['config', 'user.name', 'test'], { cwd: root, shell: false });
  writeFile(path.join(root, 'README.md'), '# test\n');
  spawnSync('git', ['add', '.'], { cwd: root, shell: false });
  spawnSync('git', ['commit', '-m', 'init'], { cwd: root, shell: false });
  const sha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, shell: false, encoding: 'utf-8' });
  return (sha.stdout ?? '').trim();
}

function writeModernArtifacts(root: string): { traceRel: string; verifierRel: string; traceAbs: string } {
  const traceRel = 'doc/features/demo/review/reports/trace.json';
  const verifierRel = 'doc/features/demo/review/reports/verifier.report.md';
  writeFile(
    path.join(root, traceRel),
    JSON.stringify({ feature: 'demo', phase: 'review', verdict: 'PASS' }, null, 2),
  );
  writeFile(path.join(root, verifierRel), 'verdict: PASS\n');
  writeFile(
    path.join(root, 'doc/features/demo/review/context-exploration.md'),
    'ready_to_produce: true\n',
  );
  return { traceRel, verifierRel, traceAbs: path.join(root, traceRel).replace(/\\/g, '/') };
}

function writeLegacyReceipt(root: string, sha: string): string {
  const receiptRel = 'doc/features/demo/review/phase-completion-receipt.md';
  const legacyTraceAbs = path
    .join(root, 'framework/harness/reports/demo/review/trace.json')
    .replace(/\\/g, '/');
  const q3 = 'README.md';
  const body = `
## 反假设条款回顾

- [x] 我没有引用不存在的规则。
- [x] 若我曾认为某规则限制了我，我已 quote 原文。
- [x] 我没有把假设当作跳过步骤的借口。
`;
  writeFile(
    path.join(root, receiptRel),
    `---
feature: demo
phase: review
agent_model: test-model
agent_runtime: unit-test
claimed_completion_at: 2026-05-25T00:00:00+08:00
claimed_completion_commit_sha: ${sha}
script_harness:
  command: test
  exit_code: 0
  report_dir: framework/harness/reports/demo/review
  blocker_count: 0
  ran_at: 2026-05-25T00:00:00+08:00
verifier_subagent:
  invoked_via: Task(subagent_type=verifier)
  prompt_template: framework/harness/prompts/verify-review.md
  report_path: framework/harness/reports/demo/review/verifier.report.md
  verdict: PASS
  ran_at: 2026-05-25T00:00:00+08:00
trace_json:
  path: framework/harness/reports/demo/review/trace.json
  exists: true
  schema_valid: true
context_exploration:
  summary_path: doc/features/demo/review/context-exploration.md
  exists: true
  ready_to_produce: true
  has_blocker_coverage_risk: false
self_check:
  q1_trace_json_abs_path: ${legacyTraceAbs}
  q2_verifier_verdict_quoted: PASS
  q3_last_diff_file: ${q3}
  q4_no_hallucinated_rule_used: true
  q4_evidence: unit test
---
${body}`,
  );
  return receiptRel;
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'resolveModernReportsRelForLegacyRef 映射到 doc/features/reports',
    run: () => {
      const root = mkProject();
      try {
        writeModernArtifacts(root);
        const modern = resolveModernReportsRelForLegacyRef(
          root,
          'demo',
          'review',
          'framework/harness/reports/demo/review/trace.json',
        );
        assert(
          modern === 'doc/features/demo/review/reports/trace.json',
          `unexpected modern path: ${modern}`,
        );
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'scanReceiptPathReconcileCandidates 发现 legacy 回执路径',
    run: () => {
      const root = mkProject();
      try {
        const sha = initGit(root);
        writeModernArtifacts(root);
        writeLegacyReceipt(root, sha);
        const candidates = scanReceiptPathReconcileCandidates(root);
        assert(candidates.length === 1, `expected 1 candidate, got ${candidates.length}`);
        assert(candidates[0].patches.length >= 3, 'expected trace/verifier/report_dir patches');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'apply + check-receipt 对 reconcile 后回执 PASS',
    run: () => {
      const root = mkProject();
      try {
        const sha = initGit(root);
        writeModernArtifacts(root);
        writeLegacyReceipt(root, sha);

        const candidates = scanReceiptPathReconcileCandidates(root);
        assert(candidates.length === 1, 'candidate missing before apply');
        applyReceiptPathReconcileCandidate(root, candidates[0]);

        const harnessRoot = path.resolve(__dirname, '..', '..');
        const check = spawnSync(
          'npx',
          [
            'ts-node',
            path.join(harnessRoot, 'scripts', 'check-receipt.ts'),
            '--feature',
            'demo',
            '--phase',
            'review',
            '--project-root',
            root,
            '--skip-state-sync',
          ],
          { cwd: harnessRoot, shell: true, encoding: 'utf-8' },
        );
        assert(check.status === 0, `check-receipt failed:\n${check.stdout}\n${check.stderr}`);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'detectReceiptPathPatches 在 legacy 与 modern 并存时仍 offer patch',
    run: () => {
      const root = mkProject();
      try {
        writeModernArtifacts(root);
        writeFile(
          path.join(root, 'framework/harness/reports/demo/review/trace.json'),
          '{"feature":"demo"}',
        );
        const patches = detectReceiptPathPatches(root, 'demo', 'review', {
          trace_json: { path: 'framework/harness/reports/demo/review/trace.json' },
        });
        assert(patches.length === 1, `expected patch when both exist, got ${patches.length}`);
        assert(
          patches[0].to === 'doc/features/demo/review/reports/trace.json',
          `unexpected target: ${patches[0].to}`,
        );
      } finally {
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
