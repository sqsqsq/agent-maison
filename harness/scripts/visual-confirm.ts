/**
 * P0-10c（plan b6d3e9a2）：visual-confirm CLI——真人在终端直接完成 pixel_1to1 P0 屏的逐屏过目确认。
 *
 * 高保真路径（无 agent 中介，比对话式转录更可信）：逐屏用系统查看器弹图 + 打印参考原图路径 →
 * 真人 y=认可 / f=打回（逐行输 must_fix） / s=跳过 → 首次表态前问一次署名（isHumanVerified 校验）→
 * 安全写盘（无 BOM、绑定三字段原样）→ 打印 resume 命令。
 *
 * 铁律：①待确认屏筛选与 checkVisualDiff 的 await 收窄判定**同源**（isScreenAwaitConfirmEligible，
 * 防宽筛把 stale/带 must_fix/绑定不全的屏签掉）；②无 TTY / headless 一律拒跑、**绝不自动签**
 * （headless 唯一正确动作是 halt 等真人）；③写盘内容与手改等价，门禁检出口径不变。
 *
 * 用法：npm --prefix <harness> run visual-confirm -- --feature <feature> [--phase testing]
 */
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import * as readline from 'readline';
import minimist from 'minimist';
import { detectRepoLayout } from '../repo-layout';
import { loadFrameworkConfig, featureDir, featurePhaseReportsDir } from '../config';
import { isHumanVerified } from './utils/fidelity-shared';
import {
  isScreenAwaitConfirmEligible,
  type VisualDiffScreenEntry,
  type VisualDiffReport,
} from '../../profiles/hmos-app/harness/visual-diff-check';
import { resolveCurrentBuildFingerprint } from '../../profiles/hmos-app/harness/build-fingerprint';
import { buildAuthoritativeRefImageIndex, resolveRefSourceImage } from '../../profiles/hmos-app/harness/authoritative-ref-images';

/**
 * testing 的派生聚合 blocker id——visual_diff FAIL 时**永远同时存在**（只是 blocker_fail_count≥1
 * 的镜像，非独立失败）。await gate 判"唯一阻塞=真人确认"时须把它排除在"其它独立 FAIL"之外，
 * 否则合法 await 态也会因它被误判为混合失败。
 */
const DERIVED_AGGREGATE_BLOCKER_IDS = new Set(['testing_run_status']);

/**
 * 报告级 await gate（codex P1a + P2）：门禁结论已持久在 summary.json——CLI 须确认"**唯一**阻塞
 * 是真人确认"（visual_diff 结论=await_human_confirm，且除派生聚合项外无其它独立 BLOCKER）才列屏，
 * 杜绝在还有 OCR/placement/device 等确定性 FAIL 时把其中的 pass 屏部分签掉。
 * 缺 summary / 非 await / 混有独立 FAIL → false。
 */
export function isReportAwaitConfirmState(projectRoot: string, feature: string, phase: string): boolean {
  try {
    const summaryPath = path.join(featurePhaseReportsDir(projectRoot, feature, phase), 'summary.json');
    if (!fs.existsSync(summaryPath)) return false;
    const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8')) as {
      blockers?: Array<{ id?: string; classification?: string }>;
    };
    const blockers = summary.blockers ?? [];
    const visualAwait = blockers.find(
      b => b.id === 'visual_diff' && b.classification === 'await_human_confirm',
    );
    if (!visualAwait) return false;
    // 除 visual_diff[await] 与派生聚合项外，不得有任何其它 BLOCKER（否则是混合失败态，不该签）。
    return blockers.every(
      b => b === visualAwait || DERIVED_AGGREGATE_BLOCKER_IDS.has(b.id ?? ''),
    );
  } catch {
    return false;
  }
}

export interface PendingConfirmScreen {
  screen: VisualDiffScreenEntry;
  index: number;
}

/**
 * 待确认屏 = 资格谓词命中（同源）且尚未有效真人署名。confirmed_by 已是有效真人 → 跳过（已签）。
 */
export function collectPendingConfirmScreens(
  report: VisualDiffReport,
  projectRoot: string,
  currentBuildFingerprint: string | null | undefined,
): PendingConfirmScreen[] {
  const out: PendingConfirmScreen[] = [];
  report.screens.forEach((screen, index) => {
    if (!isScreenAwaitConfirmEligible(screen, projectRoot, currentBuildFingerprint)) return;
    if (isHumanVerified(screen.confirmed_by)) return; // 已签，跳过
    out.push({ screen, index });
  });
  return out;
}

/** 认可：写真人署名（调用侧已经 isHumanVerified 校验过 signer）。 */
export function applyConfirm(screen: VisualDiffScreenEntry, signer: string): void {
  screen.confirmed_by = signer;
}

/** 打回：verdict=fail + must_fix（非空行），清 confirmed_by；绑定字段不动。 */
export function applyReject(screen: VisualDiffScreenEntry, mustFix: string[]): void {
  screen.verdict = 'fail';
  screen.must_fix = mustFix.filter(m => m.trim().length > 0);
  delete screen.confirmed_by;
}

/** 署名合法性（与门禁同口径）：非空、非自动化身份、非 user_requirement 授权哨兵。 */
export function isAcceptableSigner(signer: string): boolean {
  return isHumanVerified(signer);
}

/** 安全写盘：两空格缩进 + 尾换行，UTF-8 无 BOM（Buffer 写，杜绝 BOM 前缀）。 */
export function safeWriteVisualDiffJson(jsonPath: string, report: VisualDiffReport): void {
  fs.writeFileSync(jsonPath, Buffer.from(`${JSON.stringify(report, null, 2)}\n`, 'utf-8'));
}

function openInSystemViewer(absPath: string): void {
  const plat = process.platform;
  try {
    if (plat === 'win32') spawn('cmd', ['/c', 'start', '""', absPath], { detached: true, stdio: 'ignore' }).unref();
    else if (plat === 'darwin') spawn('open', [absPath], { detached: true, stdio: 'ignore' }).unref();
    else spawn('xdg-open', [absPath], { detached: true, stdio: 'ignore' }).unref();
  } catch {
    /* 打开失败不阻断——下方打印绝对路径供人工打开 */
  }
}

function ask(rl: readline.Interface, q: string): Promise<string> {
  return new Promise(resolve => rl.question(q, ans => resolve(ans)));
}

async function main(): Promise<number> {
  const argv = minimist(process.argv.slice(2));
  const feature = typeof argv.feature === 'string' ? argv.feature.trim() : '';
  const phase = typeof argv.phase === 'string' && argv.phase.trim() ? argv.phase.trim() : 'testing';
  if (!feature) {
    console.error('[visual-confirm] BLOCKER: 须指定 --feature <feature>');
    return 2;
  }
  // 铁律②：无 TTY（headless/CI/管道）拒跑，绝不自动签。
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error(
      '[visual-confirm] 需要交互终端（TTY）——headless/goal 模式下 agent 唯一正确动作是 HALT 等真人；\n' +
      '请在真实终端运行本命令，或用对话式/手改 JSON 路径（见 goal-report 的 await_human_visual_confirm 引导）。',
    );
    return 2;
  }

  const layout = detectRepoLayout(__dirname);
  const projectRoot = layout.projectRoot;
  loadFrameworkConfig(projectRoot);
  const dir = path.join(featureDir(projectRoot, feature), 'device-testing', 'device-screenshots');
  const jsonPath = path.join(dir, 'visual-diff.json');
  if (!fs.existsSync(jsonPath)) {
    console.error(`[visual-confirm] 未找到 ${path.relative(projectRoot, jsonPath)}——先跑 testing harness 采集。`);
    return 2;
  }
  const report = JSON.parse(fs.readFileSync(jsonPath, 'utf-8')) as VisualDiffReport;
  const currentFp = resolveCurrentBuildFingerprint(projectRoot, feature, phase);
  if (!currentFp) {
    console.error(
      '[visual-confirm] 当前构建指纹不可算（install meta 缺失/hap 不可读）——此刻签名会被下轮重采清掉。\n' +
      '请确认 testing harness 已完整跑到 install 阶段后重试。',
    );
    return 2;
  }

  // codex P1a：报告级 await gate——门禁结论须为 await_human_confirm（全份干净、唯一阻塞=真人确认）
  // 才列屏；否则报告里还有确定性 FAIL（OCR/placement/未覆盖屏等），此刻签 pass 屏是签过未裁决状态。
  if (!isReportAwaitConfirmState(projectRoot, feature, phase)) {
    console.error(
      '[visual-confirm] 当前 visual_diff 门禁结论不是 await_human_visual_confirm——报告里仍有确定性\n' +
      'FAIL（文本/布局/覆盖等）或未跑到该状态。请先跑 testing harness 修到"仅剩真人确认"再用本命令。',
    );
    return 2;
  }

  // codex P1b：解析真实参考原图路径（真人确认须双侧证据）。
  const specMdPath = path.join(featureDir(projectRoot, feature), 'spec', 'spec.md');
  const specMd = fs.existsSync(specMdPath) ? fs.readFileSync(specMdPath, 'utf-8') : '';
  const refCtx = {
    projectRoot,
    feature,
    specVisualSources: loadFrameworkConfig(projectRoot).spec?.visual_sources,
  } as unknown as Parameters<typeof buildAuthoritativeRefImageIndex>[0];
  const refIndex = specMd ? buildAuthoritativeRefImageIndex(refCtx, specMd) : null;

  const pending = collectPendingConfirmScreens(report, projectRoot, currentFp);
  if (pending.length === 0) {
    console.log('[visual-confirm] 无待确认屏（全部已签或不满足确认资格）。');
    return 0;
  }

  console.log(`\n[visual-confirm] ${feature}：${pending.length} 屏待真人逐屏确认。y=认可 / f=打回 / s=跳过。\n`);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let signer = '';
  let changed = false;
  try {
    for (const { screen } of pending) {
      const shotRel = screen.screenshot_path ?? '';
      const shotAbs = path.isAbsolute(shotRel) ? shotRel : path.resolve(projectRoot, shotRel);
      const refId = (screen.ref_id ?? screen.screen_id).trim();
      const refAbs = refIndex ? resolveRefSourceImage(refIndex, refId).path : null;
      console.log(`\n──── ${screen.screen_id} ────`);
      console.log(`  实测截图：${shotAbs}`);
      if (fs.existsSync(shotAbs)) openInSystemViewer(shotAbs);
      else console.log('  ⚠ 截图文件不存在，请检查采集。');
      if (refAbs && fs.existsSync(refAbs)) {
        console.log(`  参考原图：${refAbs}`);
        openInSystemViewer(refAbs);
      } else {
        // codex P1b：参考图不可解析 → 缺半边证据，不得确认该屏（只允许打回/跳过）。
        console.log(`  ⚠ 参考原图无法解析（ref_id=${refId}）——缺对照证据，本屏不能认可（只可打回/跳过）。`);
      }
      const canConfirm = Boolean(refAbs && fs.existsSync(refAbs));

      const prompt = canConfirm ? '  认可(y) / 打回(f) / 跳过(s)？ ' : '  打回(f) / 跳过(s)？（无参考图，不能认可） ';
      const ans = (await ask(rl, prompt)).trim().toLowerCase();
      if (ans === 'y' && !canConfirm) {
        console.log('  ✗ 无参考原图不能认可，已按跳过处理。');
        continue;
      }
      if (ans === 'y') {
        if (!signer) {
          // 首次表态前问一次署名，校验合法
          for (;;) {
            signer = (await ask(rl, '  请输入你的署名（真人；不可为 user_requirement/自动化身份）： ')).trim();
            if (isAcceptableSigner(signer)) break;
            console.log('  ✗ 署名无效（空/自动化身份/user_requirement 均不接受），请重输。');
          }
        }
        applyConfirm(screen, signer);
        changed = true;
        console.log(`  ✓ 已认可，confirmed_by=${signer}`);
      } else if (ans === 'f') {
        console.log('  逐行输入 must_fix（差异描述），空行结束：');
        const mustFix: string[] = [];
        for (;;) {
          const line = (await ask(rl, '   - ')).trim();
          if (!line) break;
          mustFix.push(line);
        }
        applyReject(screen, mustFix);
        changed = true;
        console.log(`  ✓ 已打回，verdict=fail，must_fix ${mustFix.length} 条`);
      } else {
        console.log('  ⏭ 跳过（未改动）');
      }
    }
  } finally {
    rl.close();
  }

  if (changed) {
    safeWriteVisualDiffJson(jsonPath, report);
    console.log(`\n[visual-confirm] 已写入 ${path.relative(projectRoot, jsonPath)}（无 BOM，绑定字段未动）。`);
    const prefix = layout.frameworkRel ? path.posix.join(layout.frameworkRel, 'harness') : 'harness';
    console.log(`续跑本 run 收尾：在 goal-report 找到 run_id 后跑\n  npm --prefix ${prefix} run goal -- --feature ${feature} --resume <run_id> --force-resume`);
  } else {
    console.log('\n[visual-confirm] 无改动。');
  }
  return 0;
}

if (require.main === module) {
  main()
    .then(code => process.exit(code))
    .catch(e => {
      console.error(`[visual-confirm] 异常：${(e as Error).message}`);
      process.exit(1);
    });
}
