// ============================================================================
// guard-framework-write.unit.test.ts — G1a framework 写时守卫（plan e8f5a2c7）
// ============================================================================
// 三层覆盖：
//   A. claude 壳端到端（spawnSync 真实 hook 进程 + stdin payload，沿 hook-stale-state 模式）
//   B. 共享核心判定（动态 import .mjs——五负例 allowlist、白名单放行、布局判定）
//   C. 跨实现/三方一致性（第六轮 P1 钉死）：
//      C1 allowlist 语义：TS approvalInvalidReason ↔ .mjs approvalInvalidReasonMjs 矩阵等价
//      C2 policy 三方：runtime-artifact-policy.json ↔ canonical-gitignore 派生 ↔ core 匹配

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { pathToFileURL } from 'url';

import { detectRepoLayout, frameworkAbs } from '../../repo-layout';
import { approvalInvalidReason } from '../../scripts/utils/framework-integrity';
import { AUTOMATION_SIGNER_IDS } from '../../scripts/utils/fidelity-shared';
import {
  loadRuntimeArtifactPolicy,
  frameworkRuntimeIgnorePatterns,
} from '../../scripts/utils/canonical-gitignore';
import type { UnitCaseResult } from '../run-unit';

const LAYOUT = detectRepoLayout(__dirname);
const HOOK_ABS = frameworkAbs(LAYOUT, 'agents/claude/templates/hooks/guard-framework-write.mjs');
const CORE_ABS = frameworkAbs(LAYOUT, 'agents/shared/guard-framework-write-core.mjs');

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

// --------------------------------------------------------------------------
// consumer fixture：<tmp>/framework/{RELEASE-MANIFEST.json, agents/shared/core, specs/policy}
// --------------------------------------------------------------------------

function mkConsumerProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-fw-'));
  const fw = path.join(root, 'framework');
  fs.mkdirSync(path.join(fw, 'agents', 'shared'), { recursive: true });
  fs.mkdirSync(path.join(fw, 'specs'), { recursive: true });
  fs.mkdirSync(path.join(fw, 'harness', 'scripts'), { recursive: true });
  fs.writeFileSync(
    path.join(fw, 'RELEASE-MANIFEST.json'),
    JSON.stringify({ schema_version: '1.0', version: '3.0.0', files: [] }),
    'utf-8',
  );
  // 真实 SSOT 与真实 core 拷入 fixture（测的是发布件形态：core 从 fixture 的 framework/ 加载）
  fs.copyFileSync(
    frameworkAbs(LAYOUT, 'specs/runtime-artifact-policy.json'),
    path.join(fw, 'specs', 'runtime-artifact-policy.json'),
  );
  fs.copyFileSync(CORE_ABS, path.join(fw, 'agents', 'shared', 'guard-framework-write-core.mjs'));
  return root;
}

interface HookRun {
  exit: number | null;
  stderr: string;
}

function runHook(projectRoot: string, toolInput: Record<string, unknown>): HookRun {
  const payload = JSON.stringify({
    hook_event_name: 'PreToolUse',
    tool_name: 'Write',
    tool_input: toolInput,
    cwd: projectRoot,
  });
  const r = spawnSync(process.execPath, [HOOK_ABS], {
    input: payload,
    encoding: 'utf-8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectRoot },
    shell: false,
  });
  return { exit: r.status, stderr: r.stderr ?? '' };
}

// --------------------------------------------------------------------------
// 用例
// --------------------------------------------------------------------------

interface CoreModule {
  evaluateFrameworkWrite(input: { projectRoot: string; filePath: string }): { decision: 'allow' | 'deny'; reason?: string };
  approvalInvalidReasonMjs(rationale: unknown, approvedBy: unknown): string | null;
  loadRuntimeArtifactPolicy(frameworkRoot: string): {
    ignored_runtime_patterns: string[];
    generated_file_patterns: string[];
    reserved_metadata_files: string[];
  } | null;
  isPolicyAllowedPath(rel: string, policy: unknown): boolean;
  AUTOMATION_SIGNER_IDS_MJS: Set<string>;
}

// ts-node CJS transpile 会把静态可见的 import() 降级成 require()（吃不了 ESM .mjs）；
// new Function 构造真 dynamic import 逃逸转译（node CJS↔ESM 互操作标准手法）。
const dynamicImport = new Function('specifier', 'return import(specifier)') as (s: string) => Promise<unknown>;

async function loadCore(): Promise<CoreModule> {
  return (await dynamicImport(pathToFileURL(CORE_ABS).href)) as CoreModule;
}

const cases: Array<{ name: string; run: () => void | Promise<void> }> = [
  {
    name: 'A1 claude 壳：写 framework/harness/scripts/tmp.js → exit 2 + 教育文案（本事故第一条腿）',
    run: () => {
      const root = mkConsumerProject();
      try {
        const r = runHook(root, { file_path: path.join(root, 'framework', 'harness', 'scripts', 'tmp-ocr-audit.mjs') });
        assert(r.exit === 2, `应 exit 2 拦截，实际 ${r.exit}；stderr=${r.stderr}`);
        assert(r.stderr.includes('framework 写保护'), r.stderr);
        assert(r.stderr.includes('scratch/'), '教育文案应指向 scratch 约定');
        assert(r.stderr.includes('framework-init UPDATE'), '教育文案应指向升级途径');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'A2 claude 壳：写 framework/harness/reports/x.json（运行时白名单）→ exit 0 放行',
    run: () => {
      const root = mkConsumerProject();
      try {
        const r = runHook(root, { file_path: path.join(root, 'framework', 'harness', 'reports', 'x.json') });
        assert(r.exit === 0, `reports 应放行，实际 ${r.exit}；stderr=${r.stderr}`);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'A3 claude 壳：写非 framework 路径 → exit 0；相对路径同判',
    run: () => {
      const root = mkConsumerProject();
      try {
        assert(runHook(root, { file_path: path.join(root, 'src', 'main.ets') }).exit === 0, '工程内非 framework 应放行');
        assert(runHook(root, { file_path: 'doc/spec.md' }).exit === 0, '相对路径非 framework 应放行');
        assert(runHook(root, { file_path: 'framework/skills/x.md' }).exit === 2, '相对路径 framework/ 应拦截');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'A4 claude 壳：源仓布局（无 RELEASE-MANIFEST.json）→ exit 0 不拦',
    run: () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-fw-src-'));
      try {
        fs.mkdirSync(path.join(root, 'framework', 'harness'), { recursive: true });
        const r = runHook(root, { file_path: path.join(root, 'framework', 'harness', 'anything.ts') });
        assert(r.exit === 0, `源仓布局应放行，实际 ${r.exit}`);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'A5 claude 壳：金丝雀产物模式放行；assets/ 下非 canary 文件仍拦（收窄生效）',
    run: () => {
      const root = mkConsumerProject();
      try {
        assert(
          runHook(root, { file_path: 'framework/harness/assets/vision-canary-abc123.png' }).exit === 0,
          'canary png 应放行',
        );
        assert(
          runHook(root, { file_path: 'framework/harness/assets/vision-canary-abc123.answer-key.json' }).exit === 0,
          'canary answer-key 应放行',
        );
        assert(
          runHook(root, { file_path: 'framework/harness/assets/evil-script.mjs' }).exit === 2,
          'assets/ 下非 canary 模式应拦截',
        );
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'A6 claude 壳：完整性锚点（sidecar/manifest）写入一律 deny（第七轮 P1-1 谓词拆分）；非法 stdin → fail-open exit 0',
    run: () => {
      const root = mkConsumerProject();
      try {
        // sidecar 由 pack 产出，agent 手写=伪造完整性锚点——写时必须 deny（扫描侧另有谓词放行其存在）
        assert(
          runHook(root, { file_path: 'framework/RELEASE-MANIFEST.sha256' }).exit === 2,
          'sidecar 写入应 deny（保留元数据不是可写运行时产物）',
        );
        assert(
          runHook(root, { file_path: 'framework/RELEASE-MANIFEST.json' }).exit === 2,
          'manifest 写入应 deny（本事故"重算 manifest"路径）',
        );
        const bad = spawnSync(process.execPath, [HOOK_ABS], {
          input: 'not-json',
          encoding: 'utf-8',
          env: { ...process.env, CLAUDE_PROJECT_DIR: root },
          shell: false,
        });
        assert(bad.status === 0, `非法 payload 应 fail-open，实际 ${bad.status}`);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'A7 写时/扫描谓词拆分（第七轮 P1-1）：isWriteAllowedPath 拒 sidecar、isPolicyAllowedPath 认 sidecar 合法存在',
    run: async () => {
      const core = await loadCore();
      const policy = core.loadRuntimeArtifactPolicy(frameworkAbs(LAYOUT, '.'))!;
      assert(core.isPolicyAllowedPath('RELEASE-MANIFEST.sha256', policy), '扫描谓词：sidecar 合法存在');
      assert(!(core as unknown as { isWriteAllowedPath(rel: string, p: unknown): boolean }).isWriteAllowedPath('RELEASE-MANIFEST.sha256', policy), '写时谓词：sidecar 不可写');
      assert((core as unknown as { isWriteAllowedPath(rel: string, p: unknown): boolean }).isWriteAllowedPath('harness/reports/x.json', policy), '写时谓词：运行时目录可写');
      assert((core as unknown as { isWriteAllowedPath(rel: string, p: unknown): boolean }).isWriteAllowedPath('harness/assets/vision-canary-a.png', policy), '写时谓词：金丝雀产物可写');
    },
  },
  {
    name: 'B1 core allowlist：合法结构化真人审批 → 放行；五负例全 deny（第六轮 P1）',
    run: async () => {
      const core = await loadCore();
      const root = mkConsumerProject();
      try {
        const target = 'framework/harness/scripts/utils/some-file.ts';
        const rel = 'harness/scripts/utils/some-file.ts';
        const writeCfg = (allowlist: unknown[]): void => {
          fs.writeFileSync(
            path.join(root, 'framework.config.json'),
            JSON.stringify({ schema_version: '1.0', integrity: { drift_allowlist: allowlist } }),
            'utf-8',
          );
        };
        // 正例：结构化真人审批
        writeCfg([{ path: rel, rationale: '本地 fork 修 bug', approved_by: '张三' }]);
        assert(
          core.evaluateFrameworkWrite({ projectRoot: root, filePath: target }).decision === 'allow',
          '合法真人审批应放行',
        );
        // 负1：legacy 字符串条目
        writeCfg([rel]);
        assert(core.evaluateFrameworkWrite({ projectRoot: root, filePath: target }).decision === 'deny', 'legacy 字符串应 deny');
        // 负2：approved_by 自动化身份
        writeCfg([{ path: rel, rationale: 'x', approved_by: 'goal-mode-auto' }]);
        assert(core.evaluateFrameworkWrite({ projectRoot: root, filePath: target }).decision === 'deny', 'goal-mode-auto 应 deny');
        // 负3：approved_by=user_requirement 哨兵
        writeCfg([{ path: rel, rationale: 'x', approved_by: 'user_requirement' }]);
        assert(core.evaluateFrameworkWrite({ projectRoot: root, filePath: target }).decision === 'deny', 'user_requirement 应 deny');
        // 负4：缺 rationale
        writeCfg([{ path: rel, approved_by: '张三' }]);
        assert(core.evaluateFrameworkWrite({ projectRoot: root, filePath: target }).decision === 'deny', '缺 rationale 应 deny');
        // 负5：缺签名
        writeCfg([{ path: rel, rationale: 'x' }]);
        assert(core.evaluateFrameworkWrite({ projectRoot: root, filePath: target }).decision === 'deny', '缺 approved_by 应 deny');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'C1 跨实现一致性：TS approvalInvalidReason ↔ .mjs 复刻在同一夹具矩阵下判定逐一等价',
    run: async () => {
      const core = await loadCore();
      const matrix: Array<[unknown, unknown]> = [
        ['修 bug', '张三'],
        ['修 bug', 'goal-mode-auto'],
        ['修 bug', 'user_requirement'],
        ['修 bug', 'USER_REQUIREMENT'],
        ['修 bug', 'system'],
        ['修 bug', 'headless-auto'],
        ['', '张三'],
        [undefined, '张三'],
        ['修 bug', ''],
        ['修 bug', undefined],
        ['修 bug', '  '],
        [42, '张三'],
        ['修 bug', 'Auto'],
      ];
      for (const [rationale, approvedBy] of matrix) {
        const ts = approvalInvalidReason(rationale, approvedBy) === null;
        const mjs = core.approvalInvalidReasonMjs(rationale, approvedBy) === null;
        assert(
          ts === mjs,
          `判定分裂：rationale=${JSON.stringify(rationale)} approved_by=${JSON.stringify(approvedBy)} → TS=${ts} mjs=${mjs}`,
        );
      }
      // 自动化身份清单本身同步（防单边加条目）
      const mjsIds = [...core.AUTOMATION_SIGNER_IDS_MJS].sort();
      const tsIds = [...AUTOMATION_SIGNER_IDS].sort();
      assert(JSON.stringify(mjsIds) === JSON.stringify(tsIds), `AUTOMATION_SIGNER_IDS 漂移：TS=${tsIds} mjs=${mjsIds}`);
    },
  },
  {
    name: 'C2 policy 三方一致：SSOT ↔ canonical-gitignore 派生 ↔ core 匹配行为',
    run: async () => {
      const core = await loadCore();
      const policy = loadRuntimeArtifactPolicy();
      // (a) core 读到的 policy 与 TS 读到的逐字段一致（同一份 JSON）
      const corePolicy = core.loadRuntimeArtifactPolicy(frameworkAbs(LAYOUT, '.'));
      assert(corePolicy !== null, 'core 应能读 SSOT');
      assert(
        JSON.stringify(corePolicy) === JSON.stringify(policy),
        'core 与 TS 读出的 policy 不一致',
      );
      // (b) gitignore 派生：每个 SSOT 目录/文件条目都有对应 framework/ 前缀 pattern
      const derived = frameworkRuntimeIgnorePatterns();
      for (const p of policy.ignored_runtime_patterns) {
        const base = `framework/${p.replace(/\/$/, '')}`;
        const covered = derived.some((g) => g === `framework/${p}` || g.startsWith(base));
        assert(covered, `SSOT 条目 ${p} 未派生进 gitignore framework 段`);
      }
      // (c) core 匹配行为抽查：每个 ignored 目录条目下的深层文件应命中；generated 模式命中；
      //     非白名单路径不命中
      for (const p of policy.ignored_runtime_patterns.filter((x) => x.endsWith('/'))) {
        const probe = `${p}deep/nested/file.bin`.replace('**/', 'a/b/');
        assert(core.isPolicyAllowedPath(probe, policy), `目录条目 ${p} 应覆盖 ${probe}`);
      }
      assert(core.isPolicyAllowedPath('harness/assets/vision-canary-x.png', policy), 'canary 模式应命中');
      assert(core.isPolicyAllowedPath('RELEASE-MANIFEST.sha256', policy), 'sidecar 应命中');
      assert(!core.isPolicyAllowedPath('harness/scripts/tmp-evil.mjs', policy), 'scripts 下任意文件不得命中');
      assert(!core.isPolicyAllowedPath('skills/feature/spec/SKILL.md', policy), 'skills 不得命中');
    },
  },
];

export function runAll(): Promise<UnitCaseResult[]> {
  return run();
}

async function run(): Promise<UnitCaseResult[]> {
  const results: UnitCaseResult[] = [];
  for (const c of cases) {
    try {
      await c.run();
      results.push({ name: c.name, ok: true });
    } catch (e) {
      results.push({ name: c.name, ok: false, error: (e as Error).message });
    }
  }
  return results;
}
