/**
 * device_test.run → provider `hylyre`
 *
 * 负责：
 *   1) ensureHylyreReady：探测 / 离线安装到 profile 配置 venv（vendor wheel + PyPI 拉传递依赖）
 *   2) runHylyreDeviceTest：venv python 调 `python -m hylyre run --plan ...`（不附加 --store-dir）
 *   3) 日志与 meta：reports/<feature>/testing/hylyre-doctor.log、hylyre-ready.meta.json、device-test-run.meta.json
 *   4) parseHylyreTrace：解析 hylyre trace.json cases[]
 */
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync, type SpawnSyncReturns } from 'child_process';
import { featurePhaseReportsDir, resolveHylyreToolConfig } from '../../../../harness/config';
import {
  evaluateVendorSyncNeed,
  fingerprintFromManifest,
  pickVendorWheelPath,
  readInstallFingerprint,
  sha256FileHex,
  writeInstallFingerprint,
} from '../hylyre-vendor-sync';
import {
  hdcTargetPrefix,
  mergeEnvWithHdcOnPath,
  resolveHdcExecutableSync,
  runHdcRaw,
} from '../hdc-runner';
import { buildHylyreAppPageSaveArgv } from '../device-test-page-save';
import { resolveMainAbilityForBundle } from '../resolve-main-ability';
import {
  beginHylyrePhasePollutionGuard,
  finishHylyrePhasePollutionGuard,
  type RootPollutionMeta,
} from '../hylyre-root-pollution';
import { resolveHylyreRuntimeWorkDir, spawnHylyre } from '../hylyre-spawn';
import {
  computeLastFailedStepIndex,
  parseStepsBatchFromRunOut,
  uiResetHintForOutcome,
} from '../../../../harness/scripts/utils/adhoc-ui-reset-meta';
import type { CapabilityProvider } from './types';

export { buildHylyreAppPageSaveArgv, resolveHylyrePageSaveSlug } from '../device-test-page-save';

export const provider: CapabilityProvider = {
  id: 'hylyre',
  capability: 'device_test.run',
  exports: ['ensureHylyreReady', 'runHylyreDeviceTest', 'parseHylyreTrace'],
};

// -------- 公共类型 --------

export interface HylyreReleaseManifest {
  schema: 1;
  hylyre_version: string;
  wheel: { filename: string; sha256: string; size_bytes: number };
  generated_at: string;
  generator: { python: string; pip: string; platform: string };
  note?: string;
}

/** hylyre trace.json `cases[]` 子项 */
export interface HylyreTraceCase {
  id: string;
  status: '通过' | '失败' | '阻塞' | '跳过';
  priority?: 'P0' | 'P1' | 'P2' | string;
  ac_ref?: string;
  notes?: string;
}

export interface HylyreTrace {
  schema_version: '0.1-p0' | '0.2-p4' | string;
  feature: string;
  phase: 'testing';
  outcome: 'success' | 'partial' | 'failed' | 'aborted';
  cases?: HylyreTraceCase[];
  artifacts?: Record<string, unknown>;
  retries?: number;
  tool_calls?: Array<Record<string, unknown>>;
}

export interface HylyreReadyOptions {
  projectRoot: string;
  harnessRoot: string;
  frameworkRoot?: string;
  feature: string;
  phase: 'testing';
}

export interface HylyreReadyResult {
  ok: boolean;
  pythonPath: string;
  hylyreVersion: string;
  manifestVersion: string;
  versionConsistent: boolean;
  source: 'env_override' | 'venv_existing' | 'venv_installed' | 'fail';
  doctorOk: boolean;
  errors: Array<{ message: string; kind?: string }>;
  logPath?: string;
}

export interface HylyreRunOptions {
  projectRoot: string;
  harnessRoot: string;
  frameworkRoot?: string;
  feature: string;
  phase: 'testing';
  pythonPath: string;
  derivedPlanPath: string;
  /** When set, use `hylyre run --steps-file` instead of --plan (adhoc fallback). */
  stepsFilePath?: string | null;
  reportOutPath: string;
  traceOutPath: string;
  bundleName: string;
  /** 覆盖 config / 自动扫描；空则走 `resolveHylyreToolConfig` 与 `discoverEntryMainElement` */
  hypiumPageName?: string | null;
  deviceSn?: string;
  skipAssertExpected?: boolean;
  /** When true, skip post-run hylyre app page save (adhoc fast path). */
  skipPageSave?: boolean;
  /** When true, hdc aa force-stop before aa start (adhoc Nav reset). */
  coldRestart?: boolean;
  appSnapshotCacheAbs: string;
  timeoutMs?: number;
}

export interface HylyreRunResult {
  executed: boolean;
  exitCode: number | null;
  ok: boolean;
  command: string;
  reportPath: string | null;
  tracePath: string | null;
  trace: HylyreTrace | null;
  logPath: string;
  errors: Array<{ message: string; kind?: string }>;
}

// -------- 平台 helper --------

function venvPython(venvDir: string): string {
  if (process.platform === 'win32') {
    return path.join(venvDir, 'Scripts', 'python.exe');
  }
  return path.join(venvDir, 'bin', 'python');
}

/** True when venv site-packages already has packages (prior interrupted bootstrap). */
function venvSitePackagesHasPackages(venvRoot: string): boolean {
  const winSp = path.join(venvRoot, 'Lib', 'site-packages');
  if (fs.existsSync(winSp)) {
    try {
      return fs.readdirSync(winSp).some(f => !f.startsWith('.'));
    } catch {
      return false;
    }
  }
  const libDir = path.join(venvRoot, 'lib');
  if (!fs.existsSync(libDir)) return false;
  for (const entry of fs.readdirSync(libDir)) {
    if (!entry.startsWith('python')) continue;
    const sp = path.join(libDir, entry, 'site-packages');
    if (!fs.existsSync(sp)) continue;
    try {
      if (fs.readdirSync(sp).some(f => !f.startsWith('.'))) return true;
    } catch {
      /* ignore */
    }
  }
  return false;
}

export type RunFailureKind =
  | 'python_traceback'
  | 'hypium_timeout'
  | 'step_unrecognized'
  | 'step_field_invalid'
  | 'device_disconnect'
  | 'aa_start_preflight_failed'
  | 'unknown';

export function classifyRunFailure(runOut: string, exitCode: number | null): RunFailureKind {
  if (/wait requires seconds/i.test(runOut)) return 'step_field_invalid';
  if (/assert_toast requires text/i.test(runOut)) return 'step_field_invalid';
  if (/Traceback \(most recent call last\)/.test(runOut)) return 'python_traceback';
  if (/timeout|timed out/i.test(runOut)) return 'hypium_timeout';
  if (/unknown step|unsupported step|无法识别.*步骤/i.test(runOut)) return 'step_unrecognized';
  if (/no devices|target not found|no targets/i.test(runOut)) return 'device_disconnect';
  return 'unknown';
}

function readJsonSafe<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as T;
  } catch {
    return null;
  }
}

function appendLogSync(logPath: string, chunk: string): void {
  fs.appendFileSync(logPath, chunk, 'utf-8');
}

function ensureDirForFile(file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

function probePythonCandidates(): Array<{ cmd: string; args: string[] }> {
  if (process.platform === 'win32') {
    return [
      { cmd: 'py', args: ['-3'] },
      { cmd: 'python', args: [] },
      { cmd: 'python3', args: [] },
    ];
  }
  return [
    { cmd: 'python3', args: [] },
    { cmd: 'python', args: [] },
  ];
}

function findSystemPythonForVenv(): { cmd: string; args: string[] } | null {
  for (const c of probePythonCandidates()) {
    const r = spawnSync(c.cmd, [...c.args, '-c', 'import sys; assert sys.version_info >= (3, 10)'], {
      encoding: 'utf-8',
    });
    if (r.status === 0) return c;
  }
  return null;
}

function canImportHylyre(pythonPath: string, logPath?: string): boolean {
  const r = spawnSync(pythonPath, ['-c', 'import hylyre'], { encoding: 'utf-8' });
  if (logPath && (r.stdout || r.stderr)) {
    appendLogSync(logPath, (r.stdout || '') + (r.stderr || ''));
  }
  return r.status === 0;
}

/** 已安装的 hylyre 包内是否包含 verify_report 所需契约（wheel 须打 package-data）。 */
function hylyrePackageContractsPresent(pythonPath: string, logPath: string): boolean {
  const snippet = [
    'import pathlib',
    'import hylyre',
    'root = pathlib.Path(hylyre.__file__).resolve().parent / "contracts"',
    'need = ("report-sections.yaml", "output-schema.json")',
    'missing = [n for n in need if not (root / n).is_file()]',
    'if missing:',
    '    print("missing:" + ",".join(missing))',
    '    raise SystemExit(1)',
  ].join('\n');
  const r = spawnSync(pythonPath, ['-c', snippet], {
    encoding: 'utf-8',
    maxBuffer: 64 * 1024,
  });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  if (out.trim()) {
    appendLogSync(logPath, `hylyre contracts probe (exit=${r.status}): ${out}`);
  }
  return r.status === 0;
}

function pipShowVersion(pythonPath: string): string {
  const r = spawnSync(pythonPath, ['-m', 'pip', 'show', 'hylyre'], {
    encoding: 'utf-8',
    maxBuffer: 2 * 1024 * 1024,
  });
  if (r.status !== 0 || !r.stdout) return '';
  const m = r.stdout.match(/^Version:\s*(\S+)/m);
  return m ? m[1].trim() : '';
}

function readVendorManifest(projectRoot: string, vendorRel: string): HylyreReleaseManifest | null {
  const abs = path.join(projectRoot, vendorRel, 'release.manifest.json');
  const j = readJsonSafe<HylyreReleaseManifest>(abs);
  if (!j || j.schema !== 1 || typeof j.hylyre_version !== 'string') return null;
  return j;
}

function findVendorWheel(
  projectRoot: string,
  vendorRel: string,
  manifest: HylyreReleaseManifest | null,
): string | null {
  const abs = path.join(projectRoot, vendorRel);
  return pickVendorWheelPath(abs, manifest);
}

/**
 * 将 venv 内 hylyre 对齐 vendor 发布件（pip upgrade → 必要时 force-reinstall）。
 * 在 canImportHylyre 已为 true 时调用；vendor 升级后 testing harness 自动触发，无需手删 venv。
 */
function syncVendorHylyreInVenv(args: {
  pythonPath: string;
  wheel: string;
  projectRoot: string;
  logPath: string;
  pypiExtraIndexUrl: string;
  manifest: HylyreReleaseManifest;
  venvRoot: string;
}): { ok: boolean; upgraded: boolean; hylyreVersion: string; errors: string[] } {
  const errors: string[] = [];
  appendLogSync(
    args.logPath,
    `vendor 发布件与 venv 不一致，自动 pip 对齐 manifest=${args.manifest.hylyre_version} wheel=${path.basename(args.wheel)}\n`,
  );

  const pipUpgrade = runHylyrePipInstall({
    pythonPath: args.pythonPath,
    wheel: args.wheel,
    projectRoot: args.projectRoot,
    logPath: args.logPath,
    pypiExtraIndexUrl: args.pypiExtraIndexUrl,
    mode: 'upgrade',
  });

  let hylyreVersion = pipShowVersion(args.pythonPath);
  const manifestVer = args.manifest.hylyre_version.trim();
  let upgraded = pipUpgrade.ok;

  if (pipUpgrade.ok && manifestVer && hylyreVersion.trim() !== manifestVer) {
    appendLogSync(
      args.logPath,
      `pip --upgrade 后版本仍不一致（pip=${hylyreVersion} manifest=${manifestVer}），尝试 force-reinstall\n`,
    );
    const pipForce = runHylyrePipInstall({
      pythonPath: args.pythonPath,
      wheel: args.wheel,
      projectRoot: args.projectRoot,
      logPath: args.logPath,
      pypiExtraIndexUrl: args.pypiExtraIndexUrl,
      mode: 'force-reinstall',
    });
    upgraded = pipForce.ok;
    if (!pipForce.ok) {
      errors.push(`pip 强制重装 hylyre 失败（exit=${pipForce.exitCode}）`);
    } else {
      hylyreVersion = pipShowVersion(args.pythonPath);
    }
  } else if (!pipUpgrade.ok) {
    errors.push(`pip upgrade hylyre 失败（exit=${pipUpgrade.exitCode}）`);
  }

  if (errors.length === 0 && manifestVer && hylyreVersion.trim() === manifestVer) {
    const wheelSha = sha256FileHex(args.wheel);
    writeInstallFingerprint(args.venvRoot, fingerprintFromManifest(args.manifest, wheelSha));
    console.log(`hylyre 已自动对齐 vendor ${manifestVer}`);
  }

  return { ok: errors.length === 0, upgraded, hylyreVersion, errors };
}

function runHylyrePipInstall(args: {
  pythonPath: string;
  wheel: string;
  projectRoot: string;
  logPath: string;
  pypiExtraIndexUrl: string;
  mode: 'upgrade' | 'force-reinstall';
}): { ok: boolean; exitCode: number | null; error?: Error } {
  const pipArgs = ['-m', 'pip', 'install'];
  if (args.mode === 'force-reinstall') {
    pipArgs.push('--force-reinstall');
  } else {
    pipArgs.push('--upgrade');
  }
  pipArgs.push(args.wheel, 'hylyre[device,mcp]');
  if (args.pypiExtraIndexUrl.trim()) {
    pipArgs.push('--extra-index-url', args.pypiExtraIndexUrl.trim());
  }
  const pipStarted = Date.now();
  appendLogSync(args.logPath, `pip install ${pipArgs.join(' ')}\n`);
  const pip = spawnSync(args.pythonPath, pipArgs, {
    cwd: args.projectRoot,
    stdio: ['ignore', 'inherit', 'inherit'],
    timeout: defaultPipTimeoutMs(),
    env: { ...process.env },
  });
  const pipElapsed = ((Date.now() - pipStarted) / 1000).toFixed(1);
  appendLogSync(args.logPath, `\npip install 结束 exit=${pip.status}（${pipElapsed}s）\n`);
  if (pip.error) {
    appendLogSync(args.logPath, `${pip.error.message}\n`);
  }
  return { ok: pip.status === 0, exitCode: pip.status, error: pip.error };
}

function defaultPipTimeoutMs(): number {
  const raw = process.env.HARNESS_HYLYRE_PIP_TIMEOUT_MS;
  if (raw && /^\d+$/.test(raw.trim())) return parseInt(raw.trim(), 10);
  return 600_000;
}

function defaultRunTimeoutMs(opts?: HylyreRunOptions): number {
  const raw = process.env.HARNESS_HYLYRE_RUN_TIMEOUT_MS;
  if (raw && /^\d+$/.test(raw.trim())) return parseInt(raw.trim(), 10);
  if (opts?.timeoutMs != null && Number.isFinite(opts.timeoutMs)) return opts.timeoutMs as number;
  return 1_800_000;
}

export { discoverEntryMainElement } from '../discover-entry-main-element';
import { discoverEntryMainElement } from '../discover-entry-main-element';

function resolveHypiumPageNameForRun(
  projectRoot: string,
  bundleName: string,
  override?: string | null,
  deviceSn?: string,
): { pageName: string | null; source: string; appMetaPath: string | null } {
  const resolved = resolveMainAbilityForBundle({
    projectRoot,
    bundleName,
    override,
    deviceSn,
    writeCache: true,
  });
  return {
    pageName: resolved.mainAbility,
    source: resolved.source,
    appMetaPath: resolved.appMetaPath,
  };
}

/**
 * Hypium `start_app(bundle)` 在部分设备/包体上无法从 bm dump 解析 main ability。
 * hylyre 0.1.0 的 `run --plan` 路径不向 Hypium 传递 `--page-name`，故在拉起 hylyre 前用
 * `hdc shell aa start -a <ability> -b <bundle>` 显式冷启；成功后省略 hylyre 的 `--bundle`，避免再走错误的 start_app。
 */
/** Kill app process before aa start — clears Nav stack for idempotent adhoc reruns. */
export function runAaForceStop(
  bundle: string,
  deviceSn: string | undefined,
  logPath: string,
): { ok: boolean; output: string; attempted: boolean } {
  const args = [...hdcTargetPrefix(), 'shell', 'aa', 'force-stop', '-b', bundle];
  appendLogSync(logPath, `$ hdc ${args.join(' ')}\n`);
  const hdcExe = resolveHdcExecutableSync();
  const r = runHdcRaw(hdcExe, args, { timeout: 60_000, maxBuffer: 2 * 1024 * 1024 });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  appendLogSync(logPath, out);
  return { ok: r.status === 0, output: out, attempted: true };
}

function runAaStartPreflight(
  bundle: string,
  pageName: string,
  deviceSn: string | undefined,
  logPath: string,
): { ok: boolean; output: string } {
  const args = [...hdcTargetPrefix(), 'shell', 'aa', 'start', '-a', pageName, '-b', bundle];
  appendLogSync(logPath, `$ hdc ${args.join(' ')}\n`);
  const hdcExe = resolveHdcExecutableSync();
  const r = runHdcRaw(hdcExe, args, { timeout: 120_000, maxBuffer: 2 * 1024 * 1024 });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  appendLogSync(logPath, out);
  return { ok: r.status === 0, output: out };
}

// -------- ensureHylyreReady --------

export function ensureHylyreReady(opts: HylyreReadyOptions): HylyreReadyResult {
  const cfg = resolveHylyreToolConfig(opts.projectRoot);
  const { reportsBase, hypiumWorkDir } = resolveHylyreRuntimeWorkDir(
    opts.projectRoot,
    opts.feature,
    opts.phase,
    opts.frameworkRoot,
  );
  fs.mkdirSync(reportsBase, { recursive: true });
  const logPath = path.join(reportsBase, 'hylyre-doctor.log');
  const metaPath = path.join(reportsBase, 'hylyre-ready.meta.json');
  const errors: HylyreReadyResult['errors'] = [];
  let rootPollution: RootPollutionMeta | null = null;

  fs.writeFileSync(
    logPath,
    `--- hylyre ensure ${new Date().toISOString()} feature=${opts.feature} ---\n`,
    'utf-8',
  );

  const manifest = readVendorManifest(opts.projectRoot, cfg.vendor_dir);
  const manifestVersion = manifest?.hylyre_version ?? '';

  const envPy = (process.env.HYLYRE_PYTHON ?? '').trim();
  const envHome = (process.env.HYLYRE_HOME ?? '').trim();
  let pythonPath = '';
  let venvRoot = '';
  let source: HylyreReadyResult['source'] = 'fail';
  let doctorOk = false;
  let installedNow = false;
  let bootstrapElapsedMs: number | undefined;
  let bootstrapWasResumed: boolean | undefined;

  if (envPy && fs.existsSync(envPy)) {
    pythonPath = envPy;
    source = 'env_override';
    appendLogSync(logPath, `使用 HYLYRE_PYTHON=${envPy}\n`);
  } else if (envHome) {
    venvRoot = path.resolve(opts.projectRoot, envHome);
    pythonPath = venvPython(venvRoot);
    source = 'venv_existing';
    appendLogSync(logPath, `使用 HYLYRE_HOME=${envHome}\n`);
  } else {
    venvRoot = path.resolve(opts.projectRoot, cfg.venv_dir);
    pythonPath = venvPython(venvRoot);
    if (fs.existsSync(pythonPath)) {
      source = 'venv_existing';
    }
    appendLogSync(logPath, `venv python 目标: ${pythonPath}\n`);
  }

  if (!pythonPath) {
    errors.push({ message: '无法确定 Python 可执行路径', kind: 'config' });
    fs.writeFileSync(metaPath, JSON.stringify({ ok: false, errors }, null, 2), 'utf-8');
    return {
      ok: false,
      pythonPath: '',
      hylyreVersion: '',
      manifestVersion,
      versionConsistent: false,
      source: 'fail',
      doctorOk: false,
      errors,
      logPath,
    };
  }

  let hylyreVersion = '';

  if (canImportHylyre(pythonPath, logPath)) {
    hylyreVersion = pipShowVersion(pythonPath);
    source = source === 'fail' ? 'venv_existing' : source;
  } else if (source === 'env_override') {
    errors.push({ message: `HYLYRE_PYTHON 指向的环境无法 import hylyre：${pythonPath}`, kind: 'import' });
    fs.writeFileSync(
      metaPath,
      JSON.stringify({ ok: false, pythonPath, errors, manifestVersion }, null, 2),
      'utf-8',
    );
    return {
      ok: false,
      pythonPath,
      hylyreVersion: '',
      manifestVersion,
      versionConsistent: false,
      source: 'env_override',
      doctorOk: false,
      errors,
      logPath,
    };
  } else {
    if (!cfg.auto_install) {
      errors.push({
        message: '当前 Python 环境未安装 hylyre，且 tools.hylyre.auto_install=false',
        kind: 'install',
      });
      fs.writeFileSync(metaPath, JSON.stringify({ ok: false, pythonPath, errors }, null, 2), 'utf-8');
      return {
        ok: false,
        pythonPath,
        hylyreVersion: '',
        manifestVersion,
        versionConsistent: false,
        source,
        doctorOk: false,
        errors,
        logPath,
      };
    }

    if (!venvRoot) {
      venvRoot = path.resolve(opts.projectRoot, cfg.venv_dir);
    }
    pythonPath = venvPython(venvRoot);

    const creator = findSystemPythonForVenv();
    if (!creator) {
      errors.push({
        message: '未找到可用于创建 venv 的 Python 3.10+（请安装 Python 或设置 HYLYRE_PYTHON）',
        kind: 'python',
      });
      fs.writeFileSync(metaPath, JSON.stringify({ ok: false, errors }, null, 2), 'utf-8');
      return {
        ok: false,
        pythonPath: '',
        hylyreVersion: '',
        manifestVersion,
        versionConsistent: false,
        source: 'fail',
        doctorOk: false,
        errors,
        logPath,
      };
    }

    if (!fs.existsSync(pythonPath)) {
      appendLogSync(logPath, `创建 venv: ${venvRoot}\n`);
      const mk = spawnSync(creator.cmd, [...creator.args, '-m', 'venv', venvRoot], {
        cwd: opts.projectRoot,
        stdio: ['ignore', 'inherit', 'inherit'],
        encoding: 'utf-8',
      });
      if (mk.status !== 0) {
        errors.push({ message: `python -m venv 失败，exit=${mk.status}`, kind: 'venv' });
        fs.writeFileSync(metaPath, JSON.stringify({ ok: false, errors }, null, 2), 'utf-8');
        return {
          ok: false,
          pythonPath: venvPython(venvRoot),
          hylyreVersion: '',
          manifestVersion,
          versionConsistent: false,
          source: 'fail',
          doctorOk: false,
          errors,
          logPath,
        };
      }
      pythonPath = venvPython(venvRoot);
    }

    const wheel = findVendorWheel(opts.projectRoot, cfg.vendor_dir, manifest);
    if (!wheel) {
      errors.push({
        message: `vendor wheel 缺失：在 ${cfg.vendor_dir} 下未找到 hylyre-*.whl`,
        kind: 'vendor',
      });
      fs.writeFileSync(metaPath, JSON.stringify({ ok: false, errors }, null, 2), 'utf-8');
      return {
        ok: false,
        pythonPath,
        hylyreVersion: '',
        manifestVersion,
        versionConsistent: false,
        source: 'venv_installed',
        doctorOk: false,
        errors,
        logPath,
      };
    }

    bootstrapWasResumed = venvSitePackagesHasPackages(venvRoot);
    const bootstrapT0 = Date.now();
    console.log(
      `[bootstrap] pip install start (may take 3-10 min on fresh machine; do not interrupt; log: ${logPath})`,
    );
    if (bootstrapWasResumed) {
      console.log('[bootstrap] 检测到 venv 内已有部分 site-packages（可能为上次中断后复用）');
    }

    const pipFirst = runHylyrePipInstall({
      pythonPath,
      wheel,
      projectRoot: opts.projectRoot,
      logPath,
      pypiExtraIndexUrl: cfg.pypi_extra_index_url,
      mode: 'upgrade',
    });

    bootstrapElapsedMs = Date.now() - bootstrapT0;
    console.log(`[bootstrap] pip install done in ${(bootstrapElapsedMs / 1000).toFixed(1)}s`);

    if (!pipFirst.ok) {
      errors.push({
        message:
          `pip install 失败（exit=${pipFirst.exitCode}）。若无法安装 hypium，请配置可达 PyPI 源或 ~/.pip/pip.conf。详见 profile addendum。`,
        kind: 'pip',
      });
      fs.writeFileSync(metaPath, JSON.stringify({ ok: false, errors }, null, 2), 'utf-8');
      return {
        ok: false,
        pythonPath,
        hylyreVersion: '',
        manifestVersion,
        versionConsistent: false,
        source: 'venv_installed',
        doctorOk: false,
        errors,
        logPath,
      };
    }

    console.log('hylyre 与传递依赖安装完成');
    source = 'venv_installed';
    installedNow = true;
    if (manifest) {
      writeInstallFingerprint(venvRoot, fingerprintFromManifest(manifest, sha256FileHex(wheel)));
    }
  }

  // 同版本号 wheel 可能曾缺少 package data：仅 import 成功不够，须具备 contracts 否则 verify_report 异常退出。
  if (canImportHylyre(pythonPath, logPath) && !hylyrePackageContractsPresent(pythonPath, logPath)) {
    appendLogSync(
      logPath,
      '已安装 hylyre 可 import 但缺少 hylyre/contracts/report-sections.yaml 或 output-schema.json（常为旧 wheel）；尝试从 vendor 强制重装。\n',
    );
    if (source === 'env_override') {
      errors.push({
        message:
          'HYLYRE_PYTHON 对应环境中的 hylyre 缺少打包契约文件。请在该环境安装含 contracts 的 Hylyre wheel，或取消 HYLYRE_PYTHON 改用工程默认 venv（vendor wheel + auto_install）。',
        kind: 'contracts',
      });
      fs.writeFileSync(
        metaPath,
        JSON.stringify({ ok: false, pythonPath, errors, manifestVersion }, null, 2),
        'utf-8',
      );
      return {
        ok: false,
        pythonPath,
        hylyreVersion: pipShowVersion(pythonPath),
        manifestVersion,
        versionConsistent: false,
        source: 'env_override',
        doctorOk: false,
        errors,
        logPath,
      };
    }
    if (!cfg.auto_install) {
      errors.push({
        message:
          'hylyre 安装不完整（缺 contracts）。请删除工程根目录 .hylyre/venv 后重试，或启用 tools.hylyre.auto_install，并确保 vendor 为含 package data 的新 wheel。',
        kind: 'contracts',
      });
      fs.writeFileSync(metaPath, JSON.stringify({ ok: false, pythonPath, errors, manifestVersion }, null, 2), 'utf-8');
      return {
        ok: false,
        pythonPath,
        hylyreVersion: pipShowVersion(pythonPath),
        manifestVersion,
        versionConsistent: false,
        source,
        doctorOk: false,
        errors,
        logPath,
      };
    }
    if (!venvRoot) {
      venvRoot = path.resolve(opts.projectRoot, cfg.venv_dir);
    }
    pythonPath = venvPython(venvRoot);
    if (!fs.existsSync(pythonPath)) {
      errors.push({
        message: '无法强制重装 hylyre：目标 venv 中不存在 python，可删除该 venv 目录后重试',
        kind: 'venv',
      });
      fs.writeFileSync(metaPath, JSON.stringify({ ok: false, pythonPath, errors, manifestVersion }, null, 2), 'utf-8');
      return {
        ok: false,
        pythonPath,
        hylyreVersion: '',
        manifestVersion,
        versionConsistent: false,
        source,
        doctorOk: false,
        errors,
        logPath,
      };
    }
    const repairWheel = findVendorWheel(opts.projectRoot, cfg.vendor_dir, manifest);
    if (!repairWheel) {
      errors.push({
        message: `无法补齐 contracts：在 ${cfg.vendor_dir} 下未找到 hylyre-*.whl`,
        kind: 'vendor',
      });
      fs.writeFileSync(metaPath, JSON.stringify({ ok: false, pythonPath, errors, manifestVersion }, null, 2), 'utf-8');
      return {
        ok: false,
        pythonPath,
        hylyreVersion: pipShowVersion(pythonPath),
        manifestVersion,
        versionConsistent: false,
        source,
        doctorOk: false,
        errors,
        logPath,
      };
    }
    const pipRepair = runHylyrePipInstall({
      pythonPath,
      wheel: repairWheel,
      projectRoot: opts.projectRoot,
      logPath,
      pypiExtraIndexUrl: cfg.pypi_extra_index_url,
      mode: 'force-reinstall',
    });
    if (!pipRepair.ok) {
      errors.push({
        message: `pip 强制重装 hylyre 失败（exit=${pipRepair.exitCode}），无法补齐 contracts`,
        kind: 'pip',
      });
      fs.writeFileSync(metaPath, JSON.stringify({ ok: false, pythonPath, errors, manifestVersion }, null, 2), 'utf-8');
      return {
        ok: false,
        pythonPath,
        hylyreVersion: pipShowVersion(pythonPath),
        manifestVersion,
        versionConsistent: false,
        source,
        doctorOk: false,
        errors,
        logPath,
      };
    }
    if (!canImportHylyre(pythonPath, logPath) || !hylyrePackageContractsPresent(pythonPath, logPath)) {
      errors.push({
        message:
          '强制重装后仍缺少 hylyre contracts。请从 Hylyre dist/release 覆盖拷贝 vendor 下 wheel 与 release.manifest.json（见 vendor/hylyre/README.md），必要时删除 .hylyre/venv 后再跑。',
        kind: 'contracts',
      });
      fs.writeFileSync(metaPath, JSON.stringify({ ok: false, pythonPath, errors, manifestVersion }, null, 2), 'utf-8');
      return {
        ok: false,
        pythonPath,
        hylyreVersion: pipShowVersion(pythonPath),
        manifestVersion,
        versionConsistent: false,
        source,
        doctorOk: false,
        errors,
        logPath,
      };
    }
    console.log('hylyre 已强制重装以补齐 contracts');
    source = 'venv_installed';
    installedNow = true;
    if (manifest) {
      writeInstallFingerprint(venvRoot, fingerprintFromManifest(manifest, sha256FileHex(repairWheel)));
    }
  }

  hylyreVersion = pipShowVersion(pythonPath);

  // vendor 对齐：venv 已可 import 且 contracts 完整时，按 manifest 版本 + wheel sha256 自动 pip 升级/重装。
  let upgradedNow = false;
  let vendorSyncReason: string | undefined;

  if (
    source !== 'env_override' &&
    cfg.auto_install &&
    manifest &&
    canImportHylyre(pythonPath, logPath) &&
    hylyrePackageContractsPresent(pythonPath, logPath)
  ) {
    if (!venvRoot) {
      venvRoot = path.resolve(opts.projectRoot, cfg.venv_dir);
    }
    const vendorWheel = findVendorWheel(opts.projectRoot, cfg.vendor_dir, manifest);
    if (!vendorWheel) {
      errors.push({
        message: `vendor wheel 缺失：在 ${cfg.vendor_dir} 下未找到 hylyre-*.whl`,
        kind: 'vendor',
      });
    } else {
      const wheelSha = sha256FileHex(vendorWheel);
      const cachedFp = readInstallFingerprint(venvRoot);
      const syncEval = evaluateVendorSyncNeed({
        manifest,
        pipVersion: hylyreVersion,
        wheelSha256: wheelSha,
        cachedFingerprint: cachedFp,
      });
      vendorSyncReason = syncEval.reason;

      if (syncEval.manifestWheelMismatch) {
        errors.push({
          message: `vendor wheel 文件 sha256 与 release.manifest.json 声明不一致（${path.basename(vendorWheel)}），请重新同步 vendor 发布件`,
          kind: 'vendor',
        });
      } else if (syncEval.needsSync) {
        const sync = syncVendorHylyreInVenv({
          pythonPath,
          wheel: vendorWheel,
          projectRoot: opts.projectRoot,
          logPath,
          pypiExtraIndexUrl: cfg.pypi_extra_index_url,
          manifest,
          venvRoot,
        });
        if (!sync.ok) {
          for (const msg of sync.errors) {
            errors.push({ message: msg, kind: 'pip' });
          }
          if (manifestVersion && sync.hylyreVersion.trim() !== manifestVersion.trim()) {
            errors.push({
              message: `hylyre 自动升级后版本仍不一致：pip=${sync.hylyreVersion} manifest=${manifestVersion}`,
              kind: 'version_drift',
            });
          }
        } else {
          hylyreVersion = sync.hylyreVersion;
          upgradedNow = sync.upgraded;
          if (sync.upgraded) {
            source = 'venv_installed';
          }
        }
      }
    }
  } else if (
    source === 'env_override' &&
    manifestVersion &&
    hylyreVersion &&
    manifestVersion.trim() !== hylyreVersion.trim()
  ) {
    errors.push({
      message: `HYLYRE_PYTHON 环境 hylyre 版本与 vendor manifest 不一致（pip=${hylyreVersion} manifest=${manifestVersion}）。请手动升级该环境，或取消 HYLYRE_PYTHON 以使用默认 venv 自动对齐。`,
      kind: 'version_drift',
    });
  }

  hylyreVersion = pipShowVersion(pythonPath);

  const versionConsistent =
    !manifestVersion || !hylyreVersion ? true : manifestVersion.trim() === hylyreVersion.trim();
  if (!versionConsistent && source !== 'env_override') {
    errors.push({
      message: `hylyre 版本漂移：pip=${hylyreVersion} manifest=${manifestVersion}`,
      kind: 'version_drift',
    });
  }

  if (cfg.doctor_first_run && (installedNow || upgradedNow)) {
    const pollutionBefore = beginHylyrePhasePollutionGuard(opts.projectRoot);
    const doc = spawnHylyre({
      pythonPath,
      hypiumWorkDir,
      hylyreArgv: ['doctor'],
      logPath,
      maxBuffer: 8 * 1024 * 1024,
    });
    doctorOk = doc.status === 0;
    rootPollution = finishHylyrePhasePollutionGuard(opts.projectRoot, pollutionBefore, {
      phase: 'ensure',
      logPath,
    });
    if (!doctorOk) {
      errors.push({ message: `hylyre doctor 失败（exit=${doc.status}）`, kind: 'doctor' });
      fs.writeFileSync(
        metaPath,
        JSON.stringify(
          {
            ok: false,
            pythonPath,
            hylyreVersion,
            manifestVersion,
            versionConsistent,
            doctorOk,
            hypium_workdir: hypiumWorkDir,
            ...(rootPollution ? { root_pollution: rootPollution } : {}),
            errors,
          },
          null,
          2,
        ),
        'utf-8',
      );
      return {
        ok: false,
        pythonPath,
        hylyreVersion,
        manifestVersion,
        versionConsistent,
        source,
        doctorOk: false,
        errors,
        logPath,
      };
    }
  } else {
    doctorOk = true;
  }

  const ok = errors.length === 0;
  const installFingerprint =
    venvRoot && fs.existsSync(venvRoot) ? readInstallFingerprint(venvRoot) : null;
  fs.writeFileSync(
    metaPath,
    JSON.stringify(
      {
        ok,
        pythonPath,
        hylyreVersion,
        manifestVersion,
        versionConsistent,
        source,
        doctorOk,
        vendorSyncReason,
        installFingerprint,
        bootstrap_elapsed_ms: bootstrapElapsedMs ?? null,
        bootstrap_was_resumed: bootstrapWasResumed ?? null,
        hypium_workdir: hypiumWorkDir,
        ...(rootPollution ? { root_pollution: rootPollution } : {}),
        errors,
      },
      null,
      2,
    ),
    'utf-8',
  );

  return {
    ok,
    pythonPath,
    hylyreVersion,
    manifestVersion,
    versionConsistent,
    source,
    doctorOk,
    errors,
    logPath,
  };
}

// -------- runHylyreDeviceTest --------

function defaultPageSaveTimeoutMs(): number {
  const raw = process.env.HARNESS_HYLYRE_PAGE_SAVE_TIMEOUT_MS;
  if (raw && /^\d+$/.test(raw.trim())) return parseInt(raw.trim(), 10);
  return 60_000;
}

/** hylyre run 结束后写入当前页快照，供下次派生读取 app-snapshot-cache/<bundle>/。失败不反转 ok。 */
function tryHylyreAppPageSaveAfterRun(args: {
  pythonPath: string;
  hypiumWorkDir: string;
  bundleName: string;
  deviceSn: string | undefined;
  appSnapshotCacheAbs: string;
  logPath: string;
  abilityName?: string | null;
  pageSlug?: string | null;
}): { attempted: boolean; exitCode: number | null; durationMs: number } {
  const pipArgs = buildHylyreAppPageSaveArgv({
    bundleName: args.bundleName,
    deviceSn: args.deviceSn,
    abilityName: args.abilityName,
    pageSlug: args.pageSlug,
  });
  const hylyreArgv = pipArgs[0] === '-m' && pipArgs[1] === 'hylyre' ? pipArgs.slice(2) : pipArgs;
  const t0 = Date.now();
  const r = spawnHylyre({
    pythonPath: args.pythonPath,
    hypiumWorkDir: args.hypiumWorkDir,
    hylyreArgv,
    appSnapshotCacheAbs: args.appSnapshotCacheAbs,
    logPath: args.logPath,
    maxBuffer: 2 * 1024 * 1024,
    timeout: defaultPageSaveTimeoutMs(),
    echoToStdout: false,
  });
  if (r.status !== 0) {
    appendLogSync(
      args.logPath,
      `hylyre app page save 结束 exit=${r.status}（WARN：非致命；缓存可能未更新）\n`,
    );
  } else {
    appendLogSync(args.logPath, `hylyre app page save 成功\n`);
  }
  return { attempted: true, exitCode: r.status, durationMs: Date.now() - t0 };
}

/** Build minimal trace/report after `hylyre run --steps-file` (no native report contract). */
export function synthesizeTraceFromStepsBatchRun(args: {
  runOut: string;
  feature: string;
  tracePath: string;
  reportPath: string;
}): { lastStepIndex: number | null; uiResetHint: string | null } {
  const batch = parseStepsBatchFromRunOut(args.runOut);
  const results = batch?.results ?? [];
  const anyErr = results.some(r => r.status !== 'ok');
  const lastStepIndex = computeLastFailedStepIndex(batch);
  const outcome = anyErr ? 'failed' : 'success';
  const uiResetHint = uiResetHintForOutcome(outcome, lastStepIndex);
  const trace = {
    schema_version: '0.1-p0',
    feature: args.feature,
    phase: 'testing',
    outcome,
    model_backend: 'none',
    cases: [
      {
        id: 'TC-001',
        status: anyErr ? '失败' : '通过',
        priority: 'P0',
        ac_ref: 'ad-hoc',
        notes: anyErr
          ? results
              .filter(r => r.status !== 'ok')
              .map(r => r.error ?? 'step error')
              .join('; ')
              .slice(0, 500)
          : '',
        name: 'adhoc steps batch',
      },
    ],
    artifacts: {
      adhoc: true,
      steps_file: true,
      last_step_index: lastStepIndex,
      ui_reset_hint: uiResetHint,
    },
  };
  fs.mkdirSync(path.dirname(args.tracePath), { recursive: true });
  fs.writeFileSync(args.tracePath, `${JSON.stringify(trace, null, 2)}\n`, 'utf-8');
  const reportMd = [
    '# 测试报告（adhoc · steps-file 合成）',
    '',
    `feature: ${args.feature}`,
    '',
    '## 测试执行结果',
    '',
    '| 用例编号 | 状态 | 备注 |',
    '|----------|------|------|',
    `| TC-001 | ${anyErr ? '失败' : '通过'} | steps-file batch |`,
    '',
  ].join('\n');
  fs.mkdirSync(path.dirname(args.reportPath), { recursive: true });
  fs.writeFileSync(args.reportPath, reportMd, 'utf-8');
  return { lastStepIndex, uiResetHint };
}

export function runHylyreDeviceTest(opts: HylyreRunOptions): HylyreRunResult {
  const errors: HylyreRunResult['errors'] = [];
  const { reportsBase, hypiumWorkDir } = resolveHylyreRuntimeWorkDir(
    opts.projectRoot,
    opts.feature,
    opts.phase,
    opts.frameworkRoot,
  );
  fs.mkdirSync(reportsBase, { recursive: true });
  const pollutionBefore = beginHylyrePhasePollutionGuard(opts.projectRoot);
  const logPath = path.join(reportsBase, 'device-test-run.log');
  const metaPath = path.join(reportsBase, 'device-test-run.meta.json');

  ensureDirForFile(opts.reportOutPath);
  ensureDirForFile(opts.traceOutPath);
  fs.writeFileSync(
    logPath,
    `--- hylyre run ${new Date().toISOString()} feature=${opts.feature} ---\n`,
    'utf-8',
  );
  appendLogSync(
    logPath,
    `hypium 工作目录（cwd）: ${hypiumWorkDir}（tmp_hypium 将落在其下，不写入工程根）\n`,
  );

  const abilityResolved = resolveHypiumPageNameForRun(
    opts.projectRoot,
    opts.bundleName,
    opts.hypiumPageName,
    opts.deviceSn,
  );
  const pageName = abilityResolved.pageName;
  let omitBundleForHylyre = false;
  let coldRestartAttempted = false;
  let coldRestartOk: boolean | null = null;

  if (pageName) {
    if (opts.coldRestart) {
      const stop = runAaForceStop(opts.bundleName, opts.deviceSn, logPath);
      coldRestartAttempted = stop.attempted;
      coldRestartOk = stop.ok;
      if (!stop.ok) {
        appendLogSync(logPath, '[WARN] aa force-stop 未成功，仍尝试 aa start\n');
      }
    }
    const pre = runAaStartPreflight(opts.bundleName, pageName, opts.deviceSn, logPath);
    if (!pre.ok) {
      errors.push({
        message: `hdc aa start 预启动失败（ability=${pageName} bundle=${opts.bundleName} source=${abilityResolved.source}）。Hypium 在部分环境无法从 bm dump 推断 main ability，依赖此步后再跑 hylyre plan。输出节选：\n${pre.output.slice(0, 2000)}`,
      });
      const preflightKind: RunFailureKind = 'aa_start_preflight_failed';
      const rootPollutionEarly = finishHylyrePhasePollutionGuard(opts.projectRoot, pollutionBefore, {
        phase: 'run',
        logPath,
      });
      const tracePathResolved = path.resolve(opts.traceOutPath);
      ensureDirForFile(tracePathResolved);
      fs.writeFileSync(
        tracePathResolved,
        `${JSON.stringify(
          {
            schema_version: '0.2-p4',
            feature: opts.feature,
            phase: 'testing',
            outcome: 'failed',
            error_kind: 'run_crashed',
            run_failure_kind: preflightKind,
            error_message: errors.map(e => e.message).join(' | ').slice(0, 2000),
            cases: [],
          },
          null,
          2,
        )}\n`,
        'utf-8',
      );
      fs.writeFileSync(
        metaPath,
        JSON.stringify(
          {
            exit_code: null,
            ok: false,
            command: '',
            report_path: path.resolve(opts.reportOutPath),
            trace_path: tracePathResolved,
            log_path: logPath,
            bundleName: opts.bundleName,
            hypium_page_name: pageName,
            main_ability_source: abilityResolved.source,
            app_meta_path: abilityResolved.appMetaPath,
            aa_start_preflight: true,
            aa_start_ok: false,
            omit_bundle_for_hylyre: false,
            cold_restart: opts.coldRestart === true,
            cold_restart_attempted: coldRestartAttempted,
            cold_restart_ok: coldRestartOk,
            deviceSn: opts.deviceSn ?? null,
            ran_at: new Date().toISOString(),
            run_failure_kind: preflightKind,
            trace_summary: null,
            hypium_workdir: hypiumWorkDir,
            ...(rootPollutionEarly ? { root_pollution: rootPollutionEarly } : {}),
            errors,
          },
          null,
          2,
        ),
        'utf-8',
      );
      return {
        executed: true,
        exitCode: null,
        ok: false,
        command: '',
        reportPath: null,
        tracePath: null,
        trace: null,
        logPath,
        errors,
      };
    }
    omitBundleForHylyre = true;
  }

  const stepsFile = (opts.stepsFilePath ?? '').trim();
  const useStepsFile = stepsFile.length > 0 && fs.existsSync(stepsFile);

  const hylyreArgv: string[] = ['run'];
  if (useStepsFile) {
    hylyreArgv.push('--steps-file', path.resolve(stepsFile));
    if (!omitBundleForHylyre) {
      hylyreArgv.push('--bundle', opts.bundleName);
    }
    if (pageName) {
      hylyreArgv.push('--page-name', pageName);
    }
  } else {
    hylyreArgv.push(
      '--plan',
      path.resolve(opts.derivedPlanPath),
      '--feature',
      opts.feature,
      '--report-out',
      path.resolve(opts.reportOutPath),
      '--trace-out',
      path.resolve(opts.traceOutPath),
    );
    if (!omitBundleForHylyre) {
      hylyreArgv.push('--bundle', opts.bundleName);
    }
    if (opts.skipAssertExpected !== false) {
      hylyreArgv.push('--skip-assert-expected');
    }
  }

  if (opts.deviceSn && opts.deviceSn.trim()) {
    hylyreArgv.push('--device-sn', opts.deviceSn.trim());
  }

  const command = `${opts.pythonPath} -m hylyre ${hylyreArgv.join(' ')}`;

  const runStartedAt = new Date().toISOString();
  const runT0 = Date.now();
  const run = spawnHylyre({
    pythonPath: opts.pythonPath,
    hypiumWorkDir,
    hylyreArgv,
    appSnapshotCacheAbs: opts.appSnapshotCacheAbs,
    logPath,
    maxBuffer: 64 * 1024 * 1024,
    timeout: defaultRunTimeoutMs(opts),
  }) as SpawnSyncReturns<string>;

  const runOut = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  if (run.error) {
    errors.push({ message: run.error.message });
  }

  const exitCode = run.status;
  const tracePathResolved = path.resolve(opts.traceOutPath);
  const reportPathResolved = path.resolve(opts.reportOutPath);

  let batchLastStepIndex: number | null = null;
  let batchUiResetHint: string | null = null;
  if (useStepsFile && exitCode === 0) {
    const syn = synthesizeTraceFromStepsBatchRun({
      runOut,
      feature: opts.feature,
      tracePath: tracePathResolved,
      reportPath: reportPathResolved,
    });
    batchLastStepIndex = syn.lastStepIndex;
    batchUiResetHint = syn.uiResetHint;
  } else if (useStepsFile && exitCode !== 0) {
    const batch = parseStepsBatchFromRunOut(runOut);
    batchLastStepIndex = computeLastFailedStepIndex(batch);
    batchUiResetHint = uiResetHintForOutcome('failed', batchLastStepIndex);
  }

  let trace = parseHylyreTrace(tracePathResolved);
  let runFailureKind: RunFailureKind | null = null;

  if (!trace && exitCode !== 0) {
    runFailureKind = classifyRunFailure(runOut, exitCode);
    ensureDirForFile(tracePathResolved);
    fs.writeFileSync(
      tracePathResolved,
      `${JSON.stringify(
        {
          schema_version: '0.2-p4',
          feature: opts.feature,
          phase: 'testing',
          outcome: 'failed',
          error_kind: 'run_crashed',
          run_failure_kind: runFailureKind,
          error_message: runOut.slice(-2000),
          cases: [],
        },
        null,
        2,
      )}\n`,
      'utf-8',
    );
    trace = parseHylyreTrace(tracePathResolved);
  }

  /** plan 跑完后用例失败会导致 exit≠0；若有合法 trace 仍视为「自动化 runner 未崩溃」。Python Traceback（缺打包资源等）不算可接受失败。 */
  const pythonInfraTraceback =
    exitCode !== 0 &&
    /Traceback \(most recent call last\)/.test(runOut) &&
    /(FileNotFoundError|ModuleNotFoundError|PermissionError|verify_report)/.test(runOut);

  let ok = exitCode === 0;
  if (!ok && trace && trace.feature && trace.outcome && !pythonInfraTraceback) {
    const caseCount = trace.cases?.length ?? 0;
    if (caseCount > 0) {
      ok = true;
    }
  }
  if (!ok) {
    if (pythonInfraTraceback) {
      errors.push({
        message:
          'hylyre 子进程因 Python 异常退出（常见为旧 wheel 未携带 hylyre/contracts）。请重新执行 testing 阶段 ensure（将尝试强制重装 vendor wheel）或删除 .hylyre/venv 后重试，并确认 vendor 为含 contracts 的发布件。',
      });
    } else {
      errors.push({
        message:
          exitCode === null && run.signal
            ? `进程被信号终止：${run.signal}`
            : `hylyre run 异常退出 exit=${exitCode} 且无有效 trace.json`,
      });
    }
  }

  const cases = trace?.cases ?? [];
  const failed_count = cases.filter(c => c.status === '失败').length;
  const blocked_count = cases.filter(c => c.status === '阻塞').length;
  const skipped_count = cases.filter(c => c.status === '跳过').length;

  const pageSave = opts.skipPageSave
    ? { attempted: false, exitCode: null, durationMs: 0 }
    : tryHylyreAppPageSaveAfterRun({
        pythonPath: opts.pythonPath,
        hypiumWorkDir,
        bundleName: opts.bundleName,
        deviceSn: opts.deviceSn,
        appSnapshotCacheAbs: opts.appSnapshotCacheAbs,
        logPath,
        abilityName: pageName,
      });

  const runEndedAt = new Date().toISOString();
  const runDurationMs = Date.now() - runT0;
  const rootPollution = finishHylyrePhasePollutionGuard(opts.projectRoot, pollutionBefore, {
    phase: 'run',
    logPath,
  });

  fs.writeFileSync(
    metaPath,
    JSON.stringify(
      {
        exit_code: exitCode,
        ok,
        command,
        report_path: reportPathResolved,
        trace_path: tracePathResolved,
        log_path: logPath,
        bundleName: opts.bundleName,
        hypium_page_name: pageName,
        main_ability_source: abilityResolved.source,
        app_meta_path: abilityResolved.appMetaPath,
        run_mode: useStepsFile ? 'steps_file' : 'plan',
        steps_file_path: useStepsFile ? path.resolve(stepsFile) : null,
        aa_start_preflight: Boolean(pageName),
        aa_start_ok: pageName ? true : null,
        omit_bundle_for_hylyre: omitBundleForHylyre,
        cold_restart: opts.coldRestart === true,
        cold_restart_attempted: coldRestartAttempted,
        cold_restart_ok: coldRestartOk,
        last_step_index: batchLastStepIndex,
        ui_reset_hint: batchUiResetHint,
        deviceSn: opts.deviceSn ?? null,
        hypium_workdir: hypiumWorkDir,
        run_started_at: runStartedAt,
        run_ended_at: runEndedAt,
        run_duration_ms: runDurationMs,
        ran_at: runEndedAt,
        hylyre_page_save: {
          attempted: pageSave.attempted,
          exit_code: pageSave.exitCode,
          duration_ms: pageSave.durationMs,
        },
        trace_summary: trace
          ? {
              outcome: trace.outcome,
              cases_count: cases.length,
              failed_count,
              blocked_count,
              skipped_count,
            }
          : null,
        run_failure_kind: runFailureKind,
        run_out_tail: runOut.slice(-1000),
        ...(rootPollution ? { root_pollution: rootPollution } : {}),
        errors,
      },
      null,
      2,
    ),
    'utf-8',
  );

  return {
    executed: true,
    exitCode,
    ok,
    command,
    reportPath: fs.existsSync(reportPathResolved) ? reportPathResolved : null,
    tracePath: fs.existsSync(tracePathResolved) ? tracePathResolved : null,
    trace,
    logPath,
    errors,
  };
}

// -------- parseHylyreTrace --------

export function parseHylyreTrace(tracePath: string): HylyreTrace | null {
  const raw = readJsonSafe<Record<string, unknown>>(tracePath);
  if (!raw) return null;
  if (typeof raw.feature !== 'string' || typeof raw.outcome !== 'string') return null;
  const cases = Array.isArray(raw.cases) ? (raw.cases as HylyreTraceCase[]) : undefined;
  return {
    schema_version: typeof raw.schema_version === 'string' ? raw.schema_version : '0.1-p0',
    feature: raw.feature,
    phase: 'testing',
    outcome: raw.outcome as HylyreTrace['outcome'],
    cases,
    artifacts: typeof raw.artifacts === 'object' && raw.artifacts !== null ? (raw.artifacts as Record<string, unknown>) : undefined,
    retries: typeof raw.retries === 'number' ? raw.retries : undefined,
    tool_calls: Array.isArray(raw.tool_calls) ? (raw.tool_calls as Array<Record<string, unknown>>) : undefined,
  };
}
