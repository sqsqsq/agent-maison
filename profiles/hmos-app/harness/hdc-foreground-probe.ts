/**
 * Poll device until target bundle appears in `aa dump -l` foreground listing.
 */
import { spawnSync } from 'child_process';
import { hdcTargetPrefix, resolveHdcExecutableSync } from './hdc-runner';

export interface ForegroundProbeResult {
  ok: boolean;
  tookMs: number;
  lastDumpExcerpt: string;
  attempts: number;
}

function sleepSync(ms: number): void {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    /* spin */
  }
}

function runAaDumpList(deviceSn?: string): { status: number | null; output: string } {
  const args = [...hdcTargetPrefix(), 'shell', 'aa', 'dump', '-l'];
  if (deviceSn?.trim()) {
    /* hdcTargetPrefix already handles HARNESS_HDC_TARGET via env */
  }
  const hdcExe = resolveHdcExecutableSync();
  const useShell = process.platform === 'win32' && hdcExe === 'hdc';
  const r = spawnSync(hdcExe, args, {
    encoding: 'utf-8',
    shell: useShell,
    timeout: 4000,
    maxBuffer: 2 * 1024 * 1024,
  });
  return { status: r.status, output: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/** Pure parse: whether `aa dump -l` output lists the bundle as foreground/active. */
export function isBundleForegroundInAaDump(dumpOut: string, bundleName: string): boolean {
  const escaped = bundleName.replace(/\./g, '\\.');
  return new RegExp(`bundle\\s*name\\s*[:\\[]?\\s*${escaped}`, 'i').test(dumpOut);
}

export function pollUntilForeground(
  bundleName: string,
  deviceSn?: string,
  opts?: { intervalMs?: number; timeoutMs?: number },
): ForegroundProbeResult {
  const intervalMs = opts?.intervalMs ?? 500;
  const timeoutMs = opts?.timeoutMs ?? 5000;
  const t0 = Date.now();
  let attempts = 0;
  let lastOut = '';
  while (Date.now() - t0 < timeoutMs) {
    attempts += 1;
    const r = runAaDumpList(deviceSn);
    lastOut = r.output;
    if (r.status === 0 && isBundleForegroundInAaDump(lastOut, bundleName)) {
      return { ok: true, tookMs: Date.now() - t0, lastDumpExcerpt: lastOut.slice(0, 2000), attempts };
    }
    sleepSync(intervalMs);
  }
  return { ok: false, tookMs: Date.now() - t0, lastDumpExcerpt: lastOut.slice(0, 2000), attempts };
}

export interface DeviceInfo {
  sn?: string | null;
  model?: string;
  api_version?: string;
  hdc_version?: string;
}

export function collectDeviceInfo(deviceSn?: string): DeviceInfo {
  const info: DeviceInfo = { sn: deviceSn?.trim() || process.env.HARNESS_HDC_TARGET?.trim() || null };
  const hdcExe = resolveHdcExecutableSync();
  const useShell = process.platform === 'win32' && hdcExe === 'hdc';

  const ver = spawnSync(hdcExe, ['-v'], { encoding: 'utf-8', shell: useShell, timeout: 5000 });
  const verOut = `${ver.stdout ?? ''}${ver.stderr ?? ''}`.trim();
  if (verOut) info.hdc_version = verOut.split('\n')[0].slice(0, 200);

  const model = spawnSync(hdcExe, [...hdcTargetPrefix(), 'shell', 'param', 'get', 'const.product.model'], {
    encoding: 'utf-8',
    shell: useShell,
    timeout: 5000,
  });
  const modelOut = `${model.stdout ?? ''}`.trim();
  if (modelOut && !/fail|error/i.test(modelOut)) info.model = modelOut.slice(0, 120);

  const api = spawnSync(hdcExe, [...hdcTargetPrefix(), 'shell', 'param', 'get', 'const.ohos.apiversion'], {
    encoding: 'utf-8',
    shell: useShell,
    timeout: 5000,
  });
  const apiOut = `${api.stdout ?? ''}`.trim();
  if (apiOut && !/fail|error/i.test(apiOut)) info.api_version = apiOut.slice(0, 40);

  return info;
}
