// ============================================================================
// visual-diff-hylyre-screenshot.ts — Hylyre CLI screenshot 适配（M4 device_test.run）
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import { spawnHylyre } from './hylyre-spawn';
import type { VisualDiffScreenshotFn, VisualDiffNavExecutorFn, VisualDiffLayoutDumpFn } from './visual-diff-capture';
import { sanitizeVisualDiffScreenSlug } from './visual-diff-capture';

export interface HylyreVisualDiffScreenshotOptions {
  pythonPath: string;
  hypiumWorkDir: string;
  deviceSn?: string;
  logPath?: string;
}

/** `python -m hylyre screenshot --out <path> [--device-sn …]` */
export function buildHylyreVisualDiffScreenshotFn(
  opts: HylyreVisualDiffScreenshotOptions,
): VisualDiffScreenshotFn {
  return ({ destAbs, deviceSn }) => {
    const sn = (deviceSn ?? opts.deviceSn ?? '').trim();
    const hylyreArgv = ['screenshot', '--out', destAbs];
    if (sn) hylyreArgv.push('--device-sn', sn);
    const r = spawnHylyre({
      pythonPath: opts.pythonPath,
      hypiumWorkDir: opts.hypiumWorkDir,
      hylyreArgv,
      logPath: opts.logPath,
      maxBuffer: 8 * 1024 * 1024,
      echoToStdout: false,
    });
    const ok = (r.status ?? 1) === 0 && fs.existsSync(destAbs);
    const errOut = `${r.stderr ?? ''}${r.stdout ?? ''}`.trim();
    return {
      ok,
      error: ok ? undefined : errOut.slice(0, 500) || `hylyre screenshot exit=${r.status ?? 'null'}`,
    };
  };
}

/**
 * t2（plan c6d8f2b4）：真机布局树 dump 执行器——`hylyre dump-ui --out <destAbs>`。
 * 与 screenshot 同一 hylyre 工作目录/session；输出 hypium-ui-dump-v1（含逐控件 bounds），
 * 供 T8 几何不变量消费。
 */
export function buildHylyreLayoutDumpFn(
  opts: HylyreVisualDiffScreenshotOptions,
): VisualDiffLayoutDumpFn {
  return ({ destAbs, deviceSn }) => {
    const sn = (deviceSn ?? opts.deviceSn ?? '').trim();
    const hylyreArgv = ['dump-ui', '--out', destAbs];
    if (sn) hylyreArgv.push('--device-sn', sn);
    const r = spawnHylyre({
      pythonPath: opts.pythonPath,
      hypiumWorkDir: opts.hypiumWorkDir,
      hylyreArgv,
      logPath: opts.logPath,
      maxBuffer: 16 * 1024 * 1024,
      echoToStdout: false,
    });
    const ok = (r.status ?? 1) === 0 && fs.existsSync(destAbs);
    const errOut = `${r.stderr ?? ''}${r.stdout ?? ''}`.trim();
    return {
      ok,
      error: ok ? undefined : errOut.slice(0, 500) || `hylyre dump-ui exit=${r.status ?? 'null'}`,
    };
  };
}

export interface HylyreNavExecutorOptions {
  pythonPath: string;
  hypiumWorkDir: string;
  deviceSn?: string;
  bundleName?: string;
  logPath?: string;
  /** 与 device_test.run 一致：aa start 预启动成功后省略 --bundle，避免 Hylyre 二次冷启缺 page_name（宿主热修回收，round6 收尾批 P0-3） */
  omitBundle?: boolean;
  hypiumPageName?: string;
}

/**
 * 从 device_test.run 落盘的 device-test-run.meta.json 读取 nav 参数，使 visual_diff 导航与
 * 主测试执行的 app 启动方式对齐（omit_bundle/page_name）。缺 meta/解析失败 → 保守缺省
 * （不省略 bundle），行为等同回收前。
 * 宿主热修回收（round6 收尾批 P0-3）：上轮 3 屏采集失败根因＝nav 传 --bundle 且缺 --page-name
 * 触发 Hylyre 二次冷启；宿主 agent 现场修好（本轮 5/5 采集成功），原样语义上游。
 */
export function readDeviceTestRunHylyreNavOpts(logPath: string): {
  omitBundle: boolean;
  hypiumPageName?: string;
} {
  const metaPath = path.join(path.dirname(logPath), 'device-test-run.meta.json');
  if (!fs.existsSync(metaPath)) return { omitBundle: false };
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as {
      omit_bundle_for_hylyre?: boolean;
      hypium_page_name?: string;
      aa_start_ok?: boolean | null;
    };
    const pageName = (meta.hypium_page_name ?? '').trim();
    const omitBundle =
      meta.omit_bundle_for_hylyre === true || (Boolean(pageName) && meta.aa_start_ok === true);
    return { omitBundle, hypiumPageName: pageName || undefined };
  } catch {
    return { omitBundle: false };
  }
}

/**
 * round5 P1-A：真机导航执行器——把某屏到达步骤写临时 steps-file，`python -m hylyre run --steps-file` 驱动
 * touch/wait_for/back 到位（app 已由 device_test.run 拉起，步骤自带回退/等待锚点做屏间复位）。空步骤=顶层直达屏，直接 ok。
 * 注：on-device 正确性由宿主重跑端到端验收（Q4）；本函数仅装配 argv + 判 exit（与 screenshotFn 同构）。
 */
export function buildHylyreNavExecutorFn(opts: HylyreNavExecutorOptions): VisualDiffNavExecutorFn {
  return ({ screenId, steps, deviceSn, bundleName }) => {
    if (!Array.isArray(steps) || steps.length === 0) return { ok: true };
    const slug = sanitizeVisualDiffScreenSlug(screenId) ?? 'screen';
    const stepsFile = path.join(opts.hypiumWorkDir, `nav-steps-${slug}.json`);
    try {
      fs.mkdirSync(path.dirname(stepsFile), { recursive: true });
      fs.writeFileSync(stepsFile, JSON.stringify(steps), 'utf-8');
    } catch (e) {
      return { ok: false, error: `写 nav steps-file 失败：${(e as Error).message}` };
    }
    const sn = (deviceSn ?? opts.deviceSn ?? '').trim();
    const bundle = (bundleName ?? opts.bundleName ?? '').trim();
    const pageName = (opts.hypiumPageName ?? '').trim();
    const omitBundle = opts.omitBundle === true;
    const hylyreArgv = ['run', '--steps-file', stepsFile];
    if (!omitBundle && bundle) hylyreArgv.push('--bundle', bundle);
    if (pageName) hylyreArgv.push('--page-name', pageName);
    if (sn) hylyreArgv.push('--device-sn', sn);
    const r = spawnHylyre({
      pythonPath: opts.pythonPath,
      hypiumWorkDir: opts.hypiumWorkDir,
      hylyreArgv,
      logPath: opts.logPath,
      maxBuffer: 8 * 1024 * 1024,
      echoToStdout: false,
    });
    const ok = (r.status ?? 1) === 0;
    const errOut = `${r.stderr ?? ''}${r.stdout ?? ''}`.trim();
    return { ok, error: ok ? undefined : errOut.slice(0, 500) || `hylyre run steps exit=${r.status ?? 'null'}` };
  };
}
