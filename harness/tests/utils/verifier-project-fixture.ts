// ============================================================================
// verifier-project-fixture.ts — verifier 相关回归的共享工程夹具
// ============================================================================
// plan a9d4e7c2 T6（承接 e5b8c3f7 T5），plan d2f7a9c4 裁剪：
//   · makeVerifierProject / seedPhase：可跑 check-receipt 的最小 full-track 工程；
//   · buildInvocationPrompt：调用侧短 request JSON，直接调
//     scripts/utils/verifier-request.ts 产出，避免"测的是幻想中的格式"。
//
// **已随 SubagentStop hook 一并删除**：runVerifierHook / spawnVerifierRound /
// writeAgentTranscript / runVerifierRoundsConcurrently / writeCurrentPhaseState 等——
// 它们全部只为驱动那个 hook 而存在。报告现在由调用方写出，夹具见 verifier-evidence-fixture.ts。
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';

import { featurePhaseReportsDir } from '../../config';
import { computeGateFingerprint } from '../../scripts/utils/gate-fingerprint';
import { computeProductWorktreeDigest } from '../../scripts/utils/worktree-digest';
import {
  buildVerifierRequest,
  computePromptSha256,
  renderVerifierRequest,
  verifierRequestFilename,
} from '../../scripts/utils/verifier-request';
import { SUMMARY_SCHEMA_VERSION_CURRENT } from '../../scripts/utils/quality-axes';
import { VERIFIER_MATERIAL_SCHEMA, verifierMaterialFilename } from '../../scripts/utils/verifier-material';

/** framework 源仓根（harness 的上一层）——gate 指纹与 hook 模板都锚在这里。 */
export const FRAMEWORK_SOURCE_ROOT = path.resolve(__dirname, '..', '..', '..');
export const HARNESS_ROOT = path.resolve(__dirname, '..', '..');
export function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

export function readJson(abs: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(abs, 'utf-8')) as Record<string, unknown>;
}

export function writeFile(abs: string, content: string): void {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
}

export function rmDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

export interface MakeProjectOptions {
  evidenceProfile?: 'balanced';
  /** 覆盖 reports_dir_pattern（路径口径回归用） */
  reportsDirPattern?: string;
  /** 磁盘配置里**不写** reports_dir_pattern（旧实例形态；TS 侧会注入默认值） */
  omitReportsDirPattern?: boolean;
}

/** 最小 full-track 工程：配置 + workflow 树 + git 基线。 */
export function makeVerifierProject(opts: MakeProjectOptions = {}): { root: string; sha: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'verifier-identity-'));
  fs.mkdirSync(path.join(root, 'framework', 'harness', 'state'), { recursive: true });
  fs.mkdirSync(path.join(root, 'framework', 'workflows'), { recursive: true });
  fs.copyFileSync(
    path.join(FRAMEWORK_SOURCE_ROOT, 'workflows', 'spec-driven.workflow.yaml'),
    path.join(root, 'framework', 'workflows', 'spec-driven.workflow.yaml'),
  );
  writeFile(
    path.join(root, 'framework.config.json'),
    JSON.stringify(
      {
        schema_version: '1.1',
        project_name: 'verifier-identity-test',
        project_profile: { name: 'generic' },
        agent_adapter: 'claude',
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
          docs_committed: false,
          state_file: 'framework/harness/state/.current-phase.json',
          receipt_dir_pattern: 'doc/features/<feature>/<phase>',
          ...(opts.omitReportsDirPattern
            ? {}
            : { reports_dir_pattern: opts.reportsDirPattern ?? 'doc/features/<feature>/<phase>/reports' }),
        },
        ...(opts.evidenceProfile ? { evidence_profile: opts.evidenceProfile } : {}),
      },
      null,
      2,
    ),
  );
  writeFile(path.join(root, 'README.md'), '# fixture\n');
  spawnSync('git', ['init', '-q'], { cwd: root, shell: false });
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root, shell: false });
  spawnSync('git', ['config', 'user.name', 'test'], { cwd: root, shell: false });
  spawnSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: root, shell: false });
  spawnSync('git', ['add', '-A'], { cwd: root, shell: false });
  spawnSync('git', ['commit', '-q', '-m', 'baseline'], { cwd: root, shell: false });
  const sha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf-8', shell: false });
  return { root, sha: (sha.stdout ?? '').trim() };
}

/**
 * 一律走**生产解析器**，不手拼。夹具自己拼一份路径就等于给测试装了第四份真源——
 * 那样自定义 `reports_dir_pattern` 的回归会两边一起错、一起绿（review P1-4）。
 */
export function reportsDirOf(root: string, feature: string, phase: string): string {
  return featurePhaseReportsDir(root, feature, phase, FRAMEWORK_SOURCE_ROOT);
}

export interface SeedPhaseOptions {
  /** 省略=按生产口径（request 字段）派生 subject；null=**不写** request/subject（能力未启用/旧件形态） */
  subjectId?: string | null;
  closureStatus?: 'open' | 'closed';
  verdict?: 'PASS' | 'FAIL' | 'INCOMPLETE';
  /** ai-prompt.md 正文——subject 直接哈希这份磁盘字节，改内容即换代 */
  promptBody?: string;
  /** 写入 summary 的代际（迁移矩阵回归用；缺省=当代） */
  schemaVersion?: string;
  /** 审前材料指纹（plan 07a41ec6 T7）；缺省 = promptBody 的哈希（改正文即换代，与旧夹具语义一致） */
  materialSha256?: string;
}

/**
 * 写入一个阶段的 harness 产物（summary/trace/context-exploration + ai-prompt + request）。
 * subject 与 request 都由生产函数产出，保证与 runner 同源。
 */
export function seedPhase(
  root: string,
  feature: string,
  phase: string,
  opts: SeedPhaseOptions = {},
): { reportsDir: string; subjectId: string; promptPath: string; requestPath: string } {
  const reportsDir = reportsDirOf(root, feature, phase);
  fs.mkdirSync(reportsDir, { recursive: true });
  const gateFingerprint = computeGateFingerprint(FRAMEWORK_SOURCE_ROOT, phase);
  const promptBody = opts.promptBody ?? `# verify-${phase}\n\n审查 ${feature}/${phase} 的阶段产物。\n`;
  const promptPath = path.join(reportsDir, 'ai-prompt.md');
  const promptRel = path.relative(root, promptPath).replace(/\\/g, '/');
  // 先落 prompt：subject 按**磁盘实际字节**寻址，没有 canonical 投影。
  writeFile(promptPath, promptBody);

  const request =
    opts.subjectId === null
      ? null
      : buildVerifierRequest({
          feature,
          phase,
          prompt_path: promptRel,
          prompt_sha256: computePromptSha256(promptBody),
          material_sha256: opts.materialSha256 ?? computePromptSha256(promptBody),
          gate_fingerprint: gateFingerprint,
          source_commit_sha: null,
          worktree_digest: null,
        });
  // 显式 subjectId 覆盖：构造「summary 现值 ≠ request 声明」这类负例。
  const subjectId = opts.subjectId === undefined ? (request?.subject_id ?? '') : (opts.subjectId ?? '');
  let requestPath = '';
  if (request) {
    requestPath = path.join(reportsDir, verifierRequestFilename(request.subject_id));
    writeFile(requestPath, renderVerifierRequest(request));
    writeFile(
      path.join(reportsDir, verifierMaterialFilename(request.subject_id)),
      JSON.stringify({
        schema: VERIFIER_MATERIAL_SCHEMA,
        feature,
        phase,
        gate_fingerprint: gateFingerprint,
        phase_rule_sha256: '',
        template_sha256: '',
        script_checks: [],
        files: [{ path: promptRel, sha256: request.material_sha256 }],
        material_sha256: request.material_sha256,
      }),
    );
  }

  const summary: Record<string, unknown> = {
    schema_version: opts.schemaVersion ?? SUMMARY_SCHEMA_VERSION_CURRENT,
    phase,
    feature,
    verdict: opts.verdict ?? 'PASS',
    blocker_count: 0,
    fail_count: 0,
    warn_count: 0,
    ...(gateFingerprint ? { gate_fingerprint: gateFingerprint } : {}),
    closure_status: opts.closureStatus ?? 'open',
    script_report: path.relative(root, path.join(reportsDir, 'script-report.json')).replace(/\\/g, '/'),
    merged_report: path.relative(root, path.join(reportsDir, 'merged-report.md')).replace(/\\/g, '/'),
    summary_json: path.relative(root, path.join(reportsDir, 'summary.json')).replace(/\\/g, '/'),
    run_statuses: [], readiness_signals: [], blocking_warnings: [], blocking_skips: [], blockers: [],
    next_action: 'run_verifier_then_receipt',
    assurance: 'not_applicable', capability_resolutions: [], capability_resolution_contract_fingerprint: null,
    source_commit_sha: spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim(),
    worktree_digest: computeProductWorktreeDigest(root, ['app']),
  };
  if (subjectId) {
    summary.verifier_subject_id = subjectId;
    summary.ai_prompt = promptRel;
    if (requestPath) summary.verifier_request = path.relative(root, requestPath).replace(/\\/g, '/');
  }
  writeFile(path.join(reportsDir, 'summary.json'), JSON.stringify(summary, null, 2));
  writeFile(
    path.join(reportsDir, 'trace.json'),
    JSON.stringify({ schema_version: '1.0.0', feature, phase }),
  );
  writeFile(path.join(root, 'doc', 'features', feature, phase, 'context-exploration.md'), '# context exploration\n');

  return { reportsDir, subjectId, promptPath, requestPath };
}

/**
 * 调用侧 Task prompt = 那份 request JSON **整段**（生产纪律）。
 * 大文件（真实 ai-prompt.md 可达上百 KB）不过传输面——verifier 自读 prompt_path。
 */
