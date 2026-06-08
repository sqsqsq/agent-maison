/**
 * device-testing device_test.build — 业务源码新鲜度 vs 已有 HAP，判定是否跳过 hvigor。
 */
import * as fs from 'fs';
import * as path from 'path';
import { loadFrameworkConfig } from '../../../harness/config';
import { findAppSignedHap } from './hvigor-runner';
import { resolveDeviceTestProduct, resolveDeviceTestBuildMode } from './testing-build-conventions';

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
  product?: string;
  buildMode?: 'debug' | 'release';
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
  const resolvedProduct = resolveDeviceTestProduct(opts.projectRoot, opts.product);
  const resolvedBuildMode = resolveDeviceTestBuildMode(opts.buildMode);
  const inputsMaxMtimeMs = computeDeviceTestInputsMaxMtimeMs(opts.projectRoot);
  const hapPath = findAppSignedHap(opts.projectRoot, resolvedProduct);

  let hapMtimeMs: number | null = null;
  let hapBuiltAt: string | null = null;
  if (hapPath && fs.existsSync(hapPath)) {
    try {
      hapMtimeMs = fs.statSync(hapPath).mtimeMs;
      hapBuiltAt = new Date(hapMtimeMs).toISOString();
    } catch {
      hapMtimeMs = null;
    }
  }

  if (envForceBuild()) {
    return {
      reuse: false,
      reason: 'HARNESS_DEVICE_TEST_FORCE_BUILD 已设置，强制执行 hvigor',
      hapPath,
      hapMtimeMs,
      hapBuiltAt,
      inputsMaxMtimeMs,
      resolvedProduct,
      resolvedBuildMode,
    };
  }

  if (!hapPath || hapMtimeMs === null) {
    return {
      reuse: false,
      reason: '未找到 signed 主 HAP',
      hapPath,
      hapMtimeMs,
      hapBuiltAt,
      inputsMaxMtimeMs,
      resolvedProduct,
      resolvedBuildMode,
    };
  }

  if (inputsMaxMtimeMs > hapMtimeMs) {
    return {
      reuse: false,
      reason: `业务源码更新（inputsMaxMtime > hapMtime）`,
      hapPath,
      hapMtimeMs,
      hapBuiltAt,
      inputsMaxMtimeMs,
      resolvedProduct,
      resolvedBuildMode,
    };
  }

  return {
    reuse: true,
    reason: 'HAP 不早于业务源码且 product/buildMode 一致，复用已有包',
    hapPath,
    hapMtimeMs,
    hapBuiltAt,
    inputsMaxMtimeMs,
    resolvedProduct,
    resolvedBuildMode,
  };
}
