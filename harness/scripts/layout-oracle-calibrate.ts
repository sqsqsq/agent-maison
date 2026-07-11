/**
 * layout-oracle-calibrate CLI — t5（plan f7a3d9c2）：布局 oracle 校准自动化入口。
 *
 * 用法：npm --prefix <harness> run layout-oracle-calibrate -- --feature <feature> [--device]
 *
 * - 默认 offline：分析既有采集产物（device-screenshots/ 的 shot-*.png 与 layout-*.json）
 *   → ①overlay 进树 ②.id() 覆盖率 ③bounds 卫生 ④close 干跑 ⑤C1 分布 ⑥appRoot（单 dump）
 *   ⑦bounds 语义素材 ⑧locator 歧义 + ledger FP/FN 表；
 * - --device：额外执行 ⑥多次 redump 与 ⑨双拍/双 dump 稳定性实测（t4a 采样器；每屏先按
 *   nav 配置导航到位）——**中期宿主触点**，⑨数据是 t4b 启用静稳降档的完成门槛。
 *
 * 显式触发、不挂任何阶段链；产出 calibration.json（SSOT）+ report.md（投影），供人做
 * gate 升档判断，本 CLI 不改档位。
 */
import * as fs from 'fs';
import * as path from 'path';
import minimist from 'minimist';
import { detectRepoLayout } from '../repo-layout';
import { loadFrameworkConfig, featureDir } from '../config';
import {
  runLayoutOracleCalibration,
  writeCalibrationArtifacts,
  type CalibrationDeviceFns,
} from '../../profiles/hmos-app/harness/layout-oracle-calibrate';
import {
  buildHylyreVisualDiffScreenshotFn,
  buildHylyreLayoutDumpFn,
  buildHylyreNavExecutorFn,
} from '../../profiles/hmos-app/harness/visual-diff-hylyre-screenshot';
import { resolveHylyreRuntimeWorkDir } from '../../profiles/hmos-app/harness/hylyre-spawn';
import { loadVisualDiffNavConfig, canonicalOverlayBase } from '../../profiles/hmos-app/harness/visual-diff-nav';
import { deviceScreenshotsDir } from '../../profiles/hmos-app/harness/visual-diff-capture';
import { sampleQuiescent } from '../../profiles/hmos-app/harness/quiescence-sampling';

async function main(): Promise<number> {
  const argv = minimist(process.argv.slice(2));
  const feature = typeof argv.feature === 'string' ? argv.feature.trim() : '';
  if (!feature) {
    console.error('[layout-oracle-calibrate] 须指定 --feature <feature>');
    return 2;
  }
  const layout = detectRepoLayout(__dirname);
  const projectRoot = layout.projectRoot;
  loadFrameworkConfig(projectRoot);

  let deviceFns: CalibrationDeviceFns | null = null;
  if (argv.device) {
    // 设备模式需要 hylyre venv python（与 testing 采集同源）——显式传参或 env，不猜。
    const pythonPath =
      (typeof argv.python === 'string' && argv.python.trim()) ||
      (process.env.HARNESS_HYLYRE_PYTHON ?? '').trim();
    if (!pythonPath) {
      console.error(
        '[layout-oracle-calibrate] --device 需要 --python <hylyre venv python>（或设 HARNESS_HYLYRE_PYTHON）——与 testing 采集同一解释器。',
      );
      return 2;
    }
    const wd = resolveHylyreRuntimeWorkDir(projectRoot, feature, 'testing');
    const hyOpts = {
      pythonPath,
      hypiumWorkDir: wd.hypiumWorkDir,
      deviceSn: process.env.HARNESS_HDC_TARGET,
    };
    const screenshotFn = buildHylyreVisualDiffScreenshotFn(hyOpts);
    const dumpFn = buildHylyreLayoutDumpFn(hyOpts);
    const navExec = buildHylyreNavExecutorFn(hyOpts);
    const navConfig = loadVisualDiffNavConfig(projectRoot, feature);
    const calibDir = path.join(deviceScreenshotsDir(projectRoot, feature), '_calibration');
    fs.mkdirSync(calibDir, { recursive: true });
    const navTo = (screenId: string): { ok: boolean; error?: string } => {
      const steps = navConfig?.[screenId] ?? navConfig?.[canonicalOverlayBase(screenId)];
      if (!steps || steps.length === 0) return { ok: true }; // 无 nav 条目/空步=可直达顶层，按现场状态采
      return navExec({ screenId, steps });
    };
    deviceFns = {
      sampleScreen: screenId => {
        const nav = navTo(screenId);
        if (!nav.ok) return { error: `导航失败：${nav.error ?? ''}` };
        return sampleQuiescent({
          probeShotAbs: path.join(calibDir, `dq-${screenId}-shot1.png`),
          probeDumpAbs: path.join(calibDir, `dq-${screenId}-dump1.json`),
          finalShotAbs: path.join(calibDir, `dq-${screenId}-shot2.png`),
          finalDumpAbs: path.join(calibDir, `dq-${screenId}-dump2.json`),
          fns: {
            screenshotFn: destAbs => screenshotFn({ screenId, destAbs }),
            layoutDumpFn: destAbs => dumpFn({ screenId, destAbs }),
          },
        });
      },
      redumpScreen: (screenId, seq) => {
        const dumpAbs = path.join(calibDir, `redump-${screenId}-${seq}.json`);
        const r = dumpFn({ screenId, destAbs: dumpAbs });
        return r.ok ? { ok: true, dumpAbs } : { ok: false, error: r.error };
      },
    };
  }

  const report = runLayoutOracleCalibration({ projectRoot, feature, deviceFns });
  const { jsonPath, mdPath } = writeCalibrationArtifacts(projectRoot, feature, report);
  console.log(`[layout-oracle-calibrate] mode=${report.mode}`);
  console.log(`  SSOT: ${path.relative(projectRoot, jsonPath)}`);
  console.log(`  投影: ${path.relative(projectRoot, mdPath)}`);
  if (report.screens_missing_dump.length > 0) {
    console.log(`  缺 dump 屏（先跑 testing 采集）：${report.screens_missing_dump.join(', ')}`);
  }
  if (report.mode === 'offline') {
    console.log('  提示：⑨双拍/双 dump 稳定性实测须 --device 真机执行（t4b 定参的完成门槛）。');
  }
  return 0;
}

if (require.main === module) {
  main()
    .then(code => process.exit(code))
    .catch(e => {
      console.error(`[layout-oracle-calibrate] 异常：${(e as Error).message}`);
      process.exit(1);
    });
}
