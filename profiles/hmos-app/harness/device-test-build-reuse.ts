/**
 * device-testing device_test.build — 业务源码新鲜度 vs 已有 HAP，判定是否跳过 hvigor。
 */
import * as fs from 'fs';
import * as path from 'path';
import { loadFrameworkConfig } from '../../../harness/config';
import { discoverAppHapArtifacts, detectStaleSignedSuspect, type HapDiscoveryCandidate } from './hvigor-runner';
import { resolveDeviceTestBuildMode } from './testing-build-conventions';
import { computeHapSha256Full } from './build-fingerprint';

const SOURCE_FILE_RE = /\.(ets|ts|json5)$/i;
const SKIP_DIR_NAMES = new Set([
  'build',
  'oh_modules',
  'node_modules',
  '.preview',
  '.git',
  '.hvigor',
  'dist',
]);

export interface DeviceTestBuildReuseInput {
  projectRoot: string;
  /**
   * **已冻结**的选定 product（review P2：由 provider 单次解析传入，本函数**不得**再
   * 做任何 product 解析——否则会绕开 provider 的 single-resolve 契约，形成隐式二次解析）。
   */
  product: string;
  buildMode?: 'debug' | 'release';
  /** 当前调用的报告目录；不跨 Feature 查找成功记录。 */
  reportDir?: string;
}

export interface DeviceTestBuildReuseDecision {
  reuse: boolean;
  reason: string;
  hapPath: string | null;
  hapMtimeMs: number | null;
  hapBuiltAt: string | null;
  inputsMaxMtimeMs: number;
  resolvedProduct: string;
  resolvedBuildMode: 'debug' | 'release';
  /** 陈旧配对不可复用；字段保留以兼容原诊断消费者。 */
  staleSuspect?: boolean;
  staleSuspectUnsignedPath?: string | null;
  staleSuspectNote?: string;
  /**
   * 产物发现过程（plan d7e4b2a9 review P2）：复用路径此前只调薄包装 findAppSignedHap，
   * scannedDirs/candidates 被丢弃，导致复用命中时歧义 WARN 静默。现改用
   * discoverAppHapArtifacts 并透传，使 check-testing.ts 的候选歧义提示在复用/
   * 非复用两条路径下行为一致。
   */
  scannedDirs?: string[];
  candidates?: HapDiscoveryCandidate[];
  artifactValidation?: ReturnType<typeof detectStaleSignedSuspect>;
  hapSha256Full?: string;
  priorResult?: Record<string, unknown>;
}

function envForceBuild(): boolean {
  const v = process.env.HARNESS_DEVICE_TEST_FORCE_BUILD?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

function outerLayerRoots(projectRoot: string): string[] {
  const roots: string[] = [];
  try {
    const arch = loadFrameworkConfig(projectRoot).architecture;
    for (const layer of arch?.outer_layers ?? []) {
      const id = typeof layer?.id === 'string' ? layer.id.trim() : '';
      if (id) roots.push(path.join(projectRoot, id));
    }
  } catch {
    /* ignore */
  }
  roots.push(path.join(projectRoot, 'AppScope'));
  const bp = path.join(projectRoot, 'build-profile.json5');
  if (fs.existsSync(bp)) roots.push(bp);
  const hp = path.join(projectRoot, 'hvigorfile.ts');
  if (fs.existsSync(hp)) roots.push(hp);
  return roots;
}

function shouldSkipDir(name: string): boolean {
  return SKIP_DIR_NAMES.has(name);
}

/** 扫描参与打包的宿主源码，取最大 mtime（不含 doc/framework/测试计划）。 */
export function computeDeviceTestInputsMaxMtimeMs(projectRoot: string): number {
  let max = 0;
  const roots = outerLayerRoots(projectRoot);

  const visitFile = (abs: string): void => {
    try {
      const st = fs.statSync(abs);
      if (st.isFile() && SOURCE_FILE_RE.test(abs)) {
        if (st.mtimeMs > max) max = st.mtimeMs;
      }
    } catch {
      /* ignore */
    }
  };

  const walk = (dir: string, depth: number): void => {
    if (depth > 24) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (!shouldSkipDir(ent.name)) walk(abs, depth + 1);
      } else if (ent.isFile()) {
        visitFile(abs);
      }
    }
  };

  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const st = fs.statSync(root);
    if (st.isFile()) {
      visitFile(root);
    } else if (st.isDirectory()) {
      walk(root, 0);
    }
  }
  return max;
}

export function evaluateDeviceTestBuildReuse(opts: DeviceTestBuildReuseInput): DeviceTestBuildReuseDecision {
  const resolvedProduct = opts.product;
  const resolvedBuildMode = resolveDeviceTestBuildMode(opts.buildMode);
  const inputsMaxMtimeMs = computeDeviceTestInputsMaxMtimeMs(opts.projectRoot);
  const discovery = discoverAppHapArtifacts(opts.projectRoot, resolvedProduct);
  const candidate = discovery.signedPath;
  const validation = candidate ? detectStaleSignedSuspect(candidate) : undefined;
  const hapMtimeMs = validation?.signedMtimeMs ?? null;
  const base: DeviceTestBuildReuseDecision = {
    reuse: false, reason: '', hapPath: validation?.status === 'valid' ? candidate : null,
    hapMtimeMs, hapBuiltAt: hapMtimeMs === null ? null : new Date(hapMtimeMs).toISOString(),
    inputsMaxMtimeMs, resolvedProduct, resolvedBuildMode,
    scannedDirs: discovery.scannedDirs, candidates: discovery.candidates,
    artifactValidation: validation,
    staleSuspect: validation?.staleSuspect,
    staleSuspectUnsignedPath: validation?.unsignedPath,
    staleSuspectNote: validation?.note,
  };
  const reject = (reason: string): DeviceTestBuildReuseDecision => ({ ...base, reason });
  if (envForceBuild()) return reject('HARNESS_DEVICE_TEST_FORCE_BUILD 已设置，强制执行 hvigor');
  if (!candidate) return reject('所选 product 未找到 signed 主 HAP');
  if (validation?.status !== 'valid') return reject(validation?.note ?? '配对产物未通过验证');
  if (hapMtimeMs === null || inputsMaxMtimeMs > hapMtimeMs) return reject('业务源码更新（inputsMaxMtime > hapMtime），需执行构建');

  let prior: Record<string, unknown>;
  try {
    if (!opts.reportDir) return reject('当前报告目录无成功构建记录，需执行构建');
    prior = JSON.parse(fs.readFileSync(path.join(opts.reportDir, 'device-test-build.result.json'), 'utf-8'));
  } catch {
    return reject('当前成功构建记录缺失或不可读，需执行构建');
  }
  if (!prior || prior.buildSucceeded !== true || prior.resolvedProduct !== resolvedProduct ||
      prior.resolvedBuildMode !== resolvedBuildMode || typeof prior.hapPath !== 'string' ||
      path.resolve(prior.hapPath) !== path.resolve(candidate)) {
    return reject('原成功构建记录与当前包路径/product/buildMode 不匹配，需执行构建');
  }
  const sha = computeHapSha256Full(candidate);
  if (!sha || prior.hapSha256Full !== sha) return reject('当前包内容摘要与原成功构建记录不匹配，需执行构建');
  return { ...base, reuse: true, hapSha256Full: sha, priorResult: prior,
    reason: '已核对当前报告的成功记录、包路径/内容摘要、product/buildMode、源码新鲜度及配对产物，复用已有包' };
}
