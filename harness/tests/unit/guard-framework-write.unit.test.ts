// ============================================================================
// guard-framework-write.unit.test.ts — G1a framework 写时守卫（plan e8f5a2c7）
// ============================================================================
// 三层覆盖：
//   A. claude 壳端到端（spawnSync 真实 hook 进程 + stdin payload，沿 hook-stale-state 模式）
//   B. 共享核心判定（动态 import .mjs——放行通道退场、白名单放行、布局判定）
//   C. 跨实现/双消费者一致性：
//      C1 放行语义彻底移除：core 不得换名保留 allowlist/审批 API
//      C2 policy：runtime-artifact-policy.json ↔ Git 中性 TS reader ↔ guard 写匹配

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { pathToFileURL } from 'url';

import { detectRepoLayout, frameworkAbs } from '../../repo-layout';
import { AUTOMATION_SIGNER_IDS } from '../../scripts/utils/fidelity-shared';
import { loadRuntimeArtifactPolicy } from '../../scripts/utils/runtime-artifact-policy';
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
  loadRuntimeArtifactPolicy(frameworkRoot: string): {
    ignored_runtime_patterns: string[];
    shipped_files_in_runtime_dirs: string[];
    generated_file_patterns: string[];
    reserved_metadata_files: string[];
  } | null;
  isWriteAllowedPath(rel: string, policy: unknown): boolean;
  matchesPolicyPattern(rel: string, pattern: string): boolean;
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
        assert(r.stderr.includes('updater 或集成操作镜像覆盖已验证发布件'), '第一步须指向真实发布件集成');
        assert(r.stderr.includes('/framework-init UPDATE'), '第二步须指向宿主物化与全局 phase 刷新');
        assert(!/framework-init[^\n]*(下载|解包|覆盖|重铺)/i.test(r.stderr), '不得声称 framework-init 会获取或覆盖发布件字节');
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
    name: 'A5 claude 壳（b7e4d2a9 Todo4 反向保护）：canary 固定资产白名单已删——assets/ 下全部拦截',
    run: () => {
      const root = mkConsumerProject();
      try {
        assert(
          runHook(root, { file_path: 'framework/harness/assets/vision-canary-abc123.png' }).exit === 2,
          'canary png 旧路径不得再放行（framework/ 恢复只读发布件）',
        );
        assert(
          runHook(root, { file_path: 'framework/harness/assets/vision-canary-abc123.answer-key.json' }).exit === 2,
          'canary answer-key 旧路径不得再放行',
        );
        assert(
          runHook(root, { file_path: 'framework/harness/assets/evil-script.mjs' }).exit === 2,
          'assets/ 下非 canary 模式照旧拦截',
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
    name: 'A8 codeagent env（plan c7a9e2f4 T2）：无 CLAUDE_PROJECT_DIR、仅 CODEAGENT3_PROJECT_DIR → 照常拦截',
    run: () => {
      const root = mkConsumerProject();
      const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-elsewhere-'));
      try {
        const env: NodeJS.ProcessEnv = { ...process.env, CODEAGENT3_PROJECT_DIR: root };
        delete env.CLAUDE_PROJECT_DIR;
        const payload = JSON.stringify({
          hook_event_name: 'PreToolUse',
          tool_name: 'Write',
          tool_input: { file_path: path.join(root, 'framework', 'harness', 'scripts', 'evil.mjs') },
          cwd: elsewhere, // payload.cwd 指向别处（漂移形态）——env 候选须先命中
        });
        const r = spawnSync(process.execPath, [HOOK_ABS], {
          input: payload, encoding: 'utf-8', env, shell: false, cwd: elsewhere,
        });
        assert(r.status === 2, `CODEAGENT3_PROJECT_DIR 应支撑拦截，实际 ${r.status}；stderr=${r.stderr}`);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
        fs.rmSync(elsewhere, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'A9 cd 漂移自锚（plan c7a9e2f4 T2）：无任何 env、payload.cwd/进程 cwd 均漂移 → import.meta.url 自锚兜住',
    run: () => {
      // 物化实例形态：hook 物理位于 <root>/.cac/hooks/，自锚 ../.. = root（含 framework 标记）
      const root = mkConsumerProject();
      try {
        const hooksDir = path.join(root, '.cac', 'hooks');
        fs.mkdirSync(hooksDir, { recursive: true });
        const hookAbs = path.join(hooksDir, 'guard-framework-write.mjs');
        fs.copyFileSync(HOOK_ABS, hookAbs);
        const sub = path.join(root, 'sub');
        fs.mkdirSync(sub, { recursive: true });
        const env: NodeJS.ProcessEnv = { ...process.env };
        delete env.CLAUDE_PROJECT_DIR;
        delete env.CODEAGENT3_PROJECT_DIR;
        const runDrifted = (filePath: string) => spawnSync(process.execPath, [hookAbs], {
          input: JSON.stringify({
            hook_event_name: 'PreToolUse',
            tool_name: 'Write',
            tool_input: { file_path: filePath },
            cwd: sub, // 宿主实证（2026-07-29）：cd 后 payload.cwd 跟随漂移
          }),
          encoding: 'utf-8', env, shell: false, cwd: sub,
        });
        const denied = runDrifted(path.join(root, 'framework', 'skills', 'x.md'));
        assert(denied.status === 2, `自锚应兜住漂移拦截 framework 写，实际 ${denied.status}；stderr=${denied.stderr}`);
        const allowed = runDrifted(path.join(root, 'src', 'main.ets'));
        assert(allowed.status === 0, `非 framework 路径应放行，实际 ${allowed.status}`);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'A7 写时谓词：sidecar/发布件拒写，运行时目录放行',
    run: async () => {
      const core = await loadCore();
      const policy = core.loadRuntimeArtifactPolicy(frameworkAbs(LAYOUT, '.'))!;
      assert(!core.isWriteAllowedPath('RELEASE-MANIFEST.sha256', policy), 'sidecar 不可写');
      assert(core.isWriteAllowedPath('harness/reports/x.json', policy), '运行时目录可写');
      // b7e4d2a9 Todo4：金丝雀固定资产白名单已删——写时谓词同拒（随机卷写 goal-runs，不再进 framework/）
      assert(!core.isWriteAllowedPath('harness/assets/vision-canary-a.png', policy), '金丝雀旧路径不可写');
    },
  },
  {
    name: 'A7b e5d8a2c4 T4#1：ignored 目录内的**发布件**写时 deny（此前被目录级放行顺带开了口子）',
    run: async () => {
      const core = await loadCore();
      const policy = core.loadRuntimeArtifactPolicy(frameworkAbs(LAYOUT, '.'))!;
      const canWrite = (rel: string): boolean => core.isWriteAllowedPath(rel, policy);
      // 发布件：随 pack 产出、由 RELEASE-MANIFEST 逐字节校验——agent 绝不该覆写
      assert(!canWrite('harness/trace/trace.schema.json'), '发布件 trace.schema.json 不可写');
      assert(!canWrite('harness/trace/gap-notes.template.md'), '发布件 gap-notes.template.md 不可写');
      assert(!canWrite('harness/reports/.gitkeep'), '占位发布件 .gitkeep 不可写');
      // 同目录的运行时产物照常可写（降权只针对发布件，不误伤运行时面）
      assert(canWrite('harness/trace/run-2026.jsonl'), '同目录运行时产物仍可写');
      assert(canWrite('harness/reports/x.json'), 'reports 运行时产物仍可写');
    },
  },
  {
    name: 'B1 放行通道已退场：任何 drift_allowlist 形态都不再解锁写守卫（plan a6c4e9f2 D5）',
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
        // 曾经的"正例"（结构化真人审批）现在同样 deny——写权限来自执行环境授予的安全主体，
        // 不来自被检查方自己可编辑的一个文件。
        const forms: unknown[][] = [
          [{ path: rel, rationale: '本地 fork 修 bug', approved_by: '张三' }],
          [rel],
          [{ path: rel, rationale: 'x', approved_by: 'goal-mode-auto' }],
          [{ path: rel, rationale: 'x', approved_by: 'user_requirement' }],
          [{ path: rel, approved_by: '张三' }],
          [{ path: rel, rationale: 'x' }],
        ];
        for (const allowlist of forms) {
          writeCfg(allowlist);
          const decision = core.evaluateFrameworkWrite({ projectRoot: root, filePath: target });
          assert(
            decision.decision === 'deny',
            `allowlist 形态不得解锁写守卫：${JSON.stringify(allowlist)}`,
          );
          assert(
            /已退役/.test(decision.reason ?? ''),
            'deny 文案须点名 allowlist 已退役，不得继续教人写审批',
          );
        }
        // runtime 白名单路径仍照常放行（唯一的合法放行来源）。
        assert(
          core.evaluateFrameworkWrite({ projectRoot: root, filePath: 'framework/harness/reports/x.json' }).decision === 'allow',
          'runtime 产物路径仍应放行',
        );
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'C1 放行语义彻底移除：core 不再导出 allowlist/审批 API（防换名复活）',
    run: async () => {
      const core = await loadCore();
      for (const removed of ['approvalInvalidReasonMjs', 'loadValidDriftAllowlist', 'AUTOMATION_SIGNER_IDS_MJS']) {
        assert(
          (core as unknown as Record<string, unknown>)[removed] === undefined,
          `${removed} 应随放行通道一并删除，不得换名保留`,
        );
      }
    },
  },
  {
    name: 'C2 policy 双消费者一致：SSOT ↔ Git 中性 TS reader ↔ guard 写匹配',
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
      // (b) 两个消费者不得另建第二份清单：TS reader 只做 JSON 直读（无本地兜底列表）
      const readerSrc = fs.readFileSync(
        frameworkAbs(LAYOUT, 'harness/scripts/utils/runtime-artifact-policy.ts'),
        'utf-8',
      );
      assert(
        readerSrc.includes("'runtime-artifact-policy.json'"),
        'TS reader 必须直读 SSOT JSON',
      );
      for (const forbidden of ['gitignore', 'ensureCanonical', 'ignoreEquiv']) {
        assert(!readerSrc.includes(forbidden), `Git 中性 helper 不得含 ${forbidden}`);
      }
      // (c) core 写匹配行为抽查：每个 ignored 目录条目下的深层文件应放行；
      //     控制面/sidecar/旧 canary 路径拒写。没有 presence-scan/foreign-file 谓词。
      for (const p of policy.ignored_runtime_patterns.filter((x) => x.endsWith('/'))) {
        const probe = `${p}deep/nested/file.bin`.replace('**/', 'a/b/');
        assert(core.isWriteAllowedPath(probe, policy), `目录条目 ${p} 应放行 ${probe}`);
      }
      assert(!core.isWriteAllowedPath('harness/assets/vision-canary-x.png', policy), 'canary PNG 旧路径不得放行');
      assert(!core.isWriteAllowedPath('harness/assets/vision-canary-x.answer-key.json', policy), 'canary answer-key 旧路径不得放行');
      assert(!core.isWriteAllowedPath('RELEASE-MANIFEST.sha256', policy), 'sidecar 不可写');
      assert(!core.isWriteAllowedPath('harness/scripts/tmp-evil.mjs', policy), 'scripts 下控制面不可写');
      assert(!core.isWriteAllowedPath('skills/feature/spec/SKILL.md', policy), 'skills 控制面不可写');
      assert((core as unknown as Record<string, unknown>).isPolicyAllowedPath === undefined,
        '退役 presence-scan API 不得保留');
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
