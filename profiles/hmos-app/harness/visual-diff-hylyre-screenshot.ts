// ============================================================================
// visual-diff-hylyre-screenshot.ts — Hylyre CLI screenshot 适配（M4 device_test.run）
// ============================================================================

import * as fs from 'fs';
import { spawnHylyre } from './hylyre-spawn';
import type { VisualDiffScreenshotFn } from './visual-diff-capture';

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
