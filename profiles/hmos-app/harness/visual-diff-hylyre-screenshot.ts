// ============================================================================
// visual-diff-hylyre-screenshot.ts — Hylyre CLI screenshot 适配（M4 device_test.run）
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import { spawnHylyre } from './hylyre-spawn';
import type { VisualDiffScreenshotFn, VisualDiffNavExecutorFn } from './visual-diff-capture';
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

export interface HylyreNavExecutorOptions {
  pythonPath: string;
  hypiumWorkDir: string;
  deviceSn?: string;
  bundleName?: string;
  logPath?: string;
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
    const hylyreArgv = ['run', '--steps-file', stepsFile];
    if (bundle) hylyreArgv.push('--bundle', bundle);
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
