// ============================================================================
// host-snapshot-3.1.0/generate.ts — plan b2d7f4e9 §6 / t4：上一版发布件的宿主快照
// ----------------------------------------------------------------------------
// 一个合成宿主、两个已完成 Feature，全部复用 real-chain 的生产链驱动（`real-chain.unit.test.ts`）：
//   · 平铺 `demo-card`：spec→testing 六阶段；
//   · CU 绑定 ledger-refresh（`cu-…`）：蓝图 + canonical CU，出生链 coding→review→ut。
// 两条链都跑到 feature completion 并经公开入口 `goal-status` 判 VALID 后，把宿主目录捕获到 `./project/`
//（排除项与可移植性见 README.md）。
//
// 用法（harness/ 下）：
//   npx ts-node --transpile-only tests/fixtures/host-snapshot-3.1.0/generate.ts            # 重生成 project/
//   npx ts-node --transpile-only tests/fixtures/host-snapshot-3.1.0/generate.ts --verify   # ★1：换根加载 + goal-status
// 重生成必须在 README 钉住的 framework 提交上运行：快照的意义是「上一版产物」。
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  provisionRealChainProject,
  provisionFrameworkUnder,
  synthesizeTestChainProfile,
  scaffoldRealChainHost,
  git,
  type RealChainProject,
} from '../../utils/real-chain-host';
import {
  readSummary, seedCuBoundHost, runDemoCardChain, runCuBoundChain, goalStatusFeatureLine,
} from '../../unit/real-chain.unit.test';
import { clearFrameworkConfigCache } from '../../../config';

export const SNAPSHOT_FLAT_FEATURE = 'demo-card';
export const SNAPSHOT_CU_FEATURE = 'cu-bGVkZ2VyLWFwcC1ibHVlcHJpbnQAbGVkZ2VyLXJlZnJlc2g';
const OUT = path.join(__dirname, 'project');
/** 宿主根下不进快照的顶层项：`framework/` 是被替换的发布件本身（且含指向源仓的 junction），
 *  `.git` 不能嵌进本仓，`fake-deveco/` 是父进程 preflight 的假工具链，`build/` 是 device_test.build 替身落的 .hap。 */
const EXCLUDED_TOP = new Set(['framework', '.git', 'fake-deveco', 'build']);

function copyTree(src: string, dst: string, top: boolean): void {
  fs.mkdirSync(dst, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    if (top && EXCLUDED_TOP.has(ent.name)) continue;
    const s = path.join(src, ent.name);
    const d = path.join(dst, ent.name);
    if (ent.isDirectory()) copyTree(s, d, false);
    else if (ent.isFile()) fs.copyFileSync(s, d);
    else throw new Error(`快照内出现非普通文件（junction/symlink）：${s}`);
  }
}

function assertClosed(p: RealChainProject, phases: string[], exitCode: number | null): void {
  for (const phase of phases) {
    const s = readSummary(p, phase);
    if (s?.verdict !== 'PASS' || s.closure_status !== 'closed') throw new Error(`${p.feature}/${phase} 未 PASS+closed（exit=${exitCode}，root=${p.root}）`);
  }
}

async function main(): Promise<void> {
  const project = provisionRealChainProject();
  const flatBirth = scaffoldRealChainHost(project);
  const { cu, birthChain: cuBirth } = seedCuBoundHost(project);
  git(project.root, ['add', '-A']);
  git(project.root, ['commit', '-qm', 'seed change unit']);
  clearFrameworkConfigCache();
  const flat = await runDemoCardChain(project, flatBirth);
  assertClosed(project, ['spec', 'plan', 'coding', 'review', 'ut', 'testing'], flat.exitCode);
  // 宿主在两个 Feature 之间提交一次（不改任何字节，只让第二个 run 从干净工作树起步）。
  git(project.root, ['add', '-A']);
  git(project.root, ['commit', '-qm', 'demo-card done']);
  clearFrameworkConfigCache();
  const unit = await runCuBoundChain(cu, cuBirth);
  assertClosed(cu, cuBirth, unit.exitCode);
  clearFrameworkConfigCache();
  for (const feature of [SNAPSHOT_FLAT_FEATURE, SNAPSHOT_CU_FEATURE]) {
    const line = goalStatusFeatureLine(project, feature);
    console.log(`${feature}: ${line}`);
    if (!line.startsWith('feature_status=FEATURE_COMPLETED (verify=VALID')) throw new Error(`生成根原址 ${feature} 未判 VALID（root=${project.root}）`);
  }

  fs.rmSync(OUT, { recursive: true, force: true });
  copyTree(project.root, OUT, true);
  // framework.local.json 的假 DevEco 安装路径改相对（本地配置，不进任何证据绑定；快照不含该目录）。
  // 其余绝对路径（范围依赖、诊断文本）原样保留：它们是「上一版原样产物」，由读侧重定位处理。
  const local = path.join(OUT, 'framework.local.json');
  fs.writeFileSync(local, fs.readFileSync(local, 'utf-8').split(project.root.split(path.sep).join('/')).join('.'));
  console.log(`generation_root=${project.root}`);
  console.log(`flat_run_id=${project.runId} cu_run_id=${cu.runId}`);
  console.log(`snapshot=${OUT}`);
  if (process.env.HOST_SNAPSHOT_KEEP === '1') console.log(`kept root ${project.root}`);
  else fs.rmSync(project.root, { recursive: true, force: true });
}

/**
 * 「上一版产物 + 本版代码」：把快照复制到仓外 tmp 根（仓内位置会让 git 类检查解析到本仓），
 * 再在其下 provision **当前**框架（同 real-chain，含合成的 test-chain profile）。
 */
export function loadHostSnapshot(): { root: string; frameworkRoot: string; harnessDir: string } {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'host-snapshot-')));
  copyTree(OUT, root, true);
  const { frameworkRoot, harnessDir } = provisionFrameworkUnder(root);
  synthesizeTestChainProfile(frameworkRoot);
  return { root, frameworkRoot, harnessDir };
}

/** ★1 基线：经公开入口 `goal-status` 读快照中两个 Feature 的完成状态（生产 `assessFeature`）。 */
function verifyBaseline(): void {
  const s = loadHostSnapshot();
  let ok = true;
  for (const feature of [SNAPSHOT_FLAT_FEATURE, SNAPSHOT_CU_FEATURE]) {
    const line = goalStatusFeatureLine(s, feature);
    console.log(`${feature}: ${line}`);
    ok = ok && line.startsWith('feature_status=FEATURE_COMPLETED (verify=VALID');
  }
  console.log(`BASELINE_STAR1=${ok ? 'PASS' : 'FAIL'} root=${s.root}`);
  if (process.env.HOST_SNAPSHOT_KEEP !== '1') fs.rmSync(s.root, { recursive: true, force: true });
  if (!ok) process.exit(1);
}

if (require.main === module) {
  if (process.argv.includes('--verify')) verifyBaseline();
  else main().catch(e => { console.error(e); process.exit(1); });
}
