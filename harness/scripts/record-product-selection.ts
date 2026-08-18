// ============================================================================
// record-product-selection.ts — 用户确认 product 的专用机器写入路径（plan a7c3f9e2 t3）
// ============================================================================
//
// 这是 registry `init.product_selection` 确认后的 **唯一机器落盘入口**：
//   - 非 AI configWritePayload 通道（**不走** t2b 白名单——用户经 registry 显式选择授权）；
//   - 同一次操作**同时**写：
//       framework.config.json > toolchain.preferredProduct = <value>   （项目级、可提交）
//       framework.local.json   > toolchain.productSelection.confirmed =
//           { value, confirmed_at }                                    （本机确认凭证）
//   - fail-closed（review P1 补强）：两文件写入失败**或双写后一致性复核失败**一律
//     恢复快照并抛错（CLI 非零退出），任何失败路径都不得以"已落盘"+0 退出；
//   - 候选验证只认 build-profile.json5 **真实声明**（缺失/为空/不可解析 → 拒绝，
//     虚构 `default` 不得作为可确认候选）；
//   - 覆写 config 原值是**合法**的——这是用户在 registry 里的显式选择，不是静默改写。
//
// 用法：
//   cd framework/harness
//   npx ts-node scripts/record-product-selection.ts --project-root <repo-root> --product <候选值>
//
// 环境：无人值守（goal HALT 引导）与交互式（framework-init S2）共用本入口。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';

import { clearFrameworkConfigCache } from '../config';
import { readExistingConfigFromDisk } from './utils/config-builder';
import {
  loadLocalConfig,
  updateLocalConfig,
  writeLocalConfig,
  type FrameworkLocalConfig,
} from './utils/framework-local-config';
import { probeDeclaredProducts } from './utils/hvigor-runner';

function failCli(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

/** 原子写（tmp + fsync + rename），与 writeLocalConfig 同款；失败不留下半截 JSON。 */
export function atomicWriteFile(target: string, body: string): void {
  const tmp = `${target}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeFileSync(fd, body, 'utf-8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.renameSync(tmp, target);
  } catch (err) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* best-effort */ }
    throw err;
  }
}

export interface RecordProductSelectionResult {
  product: string;
  configPath: string;
  localPath: string;
  configMatchesLocal: boolean;
}

/**
 * 注入缝（单测故障注入用；缺省 = 真实实现）。
 * `readAfterWrite` 返回双写后的**独立复核**结果（**已解析的值**语义：
 * cfgPreferredProduct = framework.config.json > toolchain.preferredProduct 的值；
 * localConfirmedValue = framework.local.json > toolchain.productSelection.confirmed.value 的值）。
 * 两者须与目标 value 逐字相等；不一致即恢复两份快照并抛错（fail-closed）。
 */
export interface RecordProductSelectionDeps {
  atomicWriteFile?: (target: string, body: string) => void;
  updateLocalConfig?: (root: string, updater: (cur: FrameworkLocalConfig) => FrameworkLocalConfig) => void;
  writeLocalConfig?: (root: string, config: FrameworkLocalConfig) => void;
  readAfterWrite?: (
    root: string,
  ) => { cfgPreferredProduct: unknown; localConfirmedValue: unknown };
}

function defaultReadAfterWrite(root: string): { cfgPreferredProduct: unknown; localConfirmedValue: unknown } {
  return {
    cfgPreferredProduct: (readExistingConfigFromDisk(root)?.toolchain as
      | { preferredProduct?: unknown }
      | undefined)?.preferredProduct,
    localConfirmedValue: loadLocalConfig(root)?.toolchain?.productSelection?.confirmed?.value,
  };
}

function restoreLocalSnapshot(root: string, priorLocalText: string | null): void {
  if (priorLocalText !== null) {
    writeLocalConfig(root, JSON.parse(priorLocalText) as FrameworkLocalConfig);
  } else {
    fs.rmSync(path.join(root, 'framework.local.json'), { force: true });
  }
}

/**
 * 核心写入（导出供单测生产链验收）。失败一律抛错并保证 fail-closed：
 *   - 候选验证失败（非真实声明 / build-profile 缺失、为空、不可解析）→ 抛错，零写盘；
 *   - local 写失败 → config 尚未写，无回滚需求（抛错即可）；
 *   - config 写失败 → 恢复 local 原内容（或删除原本不存在的 local）；
 *   - **双写后一致性复核失败**（config.preferredProduct 或 local.confirmed.value
 *     与目标值不一致）→ 恢复 config 与 local 两份快照并抛错——**绝不以成功退出**。
 */
export function recordProductSelection(
  projectRoot: string,
  product: string,
  deps: RecordProductSelectionDeps = {},
): RecordProductSelectionResult {
  const value = product.trim();
  if (!value) {
    throw new Error('[record-product-selection] --product 不能为空');
  }

  // 候选验证：只认 build-profile.json5 **真实声明**的候选，拒绝自由文本编造值。
  // 缺失/为空/不可解析同样拒绝（没有真实候选可确认，须先修构建配置，不能确认虚构 default）。
  const probe = probeDeclaredProducts(projectRoot);
  if (probe.status !== 'ok') {
    const reason =
      probe.status === 'missing'
        ? 'build-profile.json5 不存在'
        : probe.status === 'unparseable'
          ? 'build-profile.json5 无法解析'
          : 'build-profile.json5 未声明任何 product';
    throw new Error(
      `[record-product-selection] 无法确认 product：${reason}。请先修复构建配置（app.products 声明真实候选）后再确认。`,
    );
  }
  if (!probe.names.includes(value)) {
    throw new Error(
      `[record-product-selection] product="${value}" 不在候选枚举内（candidates: ${probe.names.join(', ')}）。` +
        '请从 build-profile.json5 真实声明的候选中选择。',
    );
  }

  // ① config：读取磁盘原始对象，保持既有工具链键不变，仅定点覆盖 preferredProduct。
  const cfgPath = path.join(projectRoot, 'framework.config.json');
  const existing = readExistingConfigFromDisk(projectRoot);
  if (!existing) {
    throw new Error(
      '[record-product-selection] framework.config.json 不存在。请先运行 framework-init 生成配置后再确认 product。',
    );
  }
  const nextConfigRaw = JSON.parse(JSON.stringify(existing)) as Record<string, unknown>;
  const toolchainRaw = nextConfigRaw.toolchain;
  const nextToolchain: Record<string, unknown> =
    toolchainRaw && typeof toolchainRaw === 'object' && !Array.isArray(toolchainRaw)
      ? (JSON.parse(JSON.stringify(toolchainRaw)) as Record<string, unknown>)
      : {};
  nextToolchain.preferredProduct = value;
  nextConfigRaw.toolchain = nextToolchain;

  // ② local：确认凭证；经 updateLocalConfig 无损写回（devEcoStudio / probe / vision /
  //    device 等既有内容逐字不丢——local 写回的唯一入口）。
  const confirmed_at = new Date().toISOString();
  const localUpdater = (cur: FrameworkLocalConfig): FrameworkLocalConfig => ({
    ...cur,
    toolchain: {
      ...cur.toolchain,
      productSelection: {
        ...cur.toolchain?.productSelection,
        confirmed: { value, confirmed_at },
      },
    },
  });

  const doAtomicWriteFile = deps.atomicWriteFile ?? atomicWriteFile;
  const doUpdateLocalConfig = deps.updateLocalConfig ?? updateLocalConfig;
  const doWriteLocalConfig = deps.writeLocalConfig ?? writeLocalConfig;
  const doReadAfterWrite = deps.readAfterWrite ?? defaultReadAfterWrite;

  // ③ 两阶段写入 + 失败回滚（fail-closed）
  const priorLocalText = (() => {
    const p = path.join(projectRoot, 'framework.local.json');
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : null;
  })();
  const priorConfigText = fs.readFileSync(cfgPath, 'utf-8');

  // 先写 local（凭证先行：config 走到任何状态都不会比凭证更新）
  doUpdateLocalConfig(projectRoot, localUpdater);
  try {
    doAtomicWriteFile(cfgPath, `${JSON.stringify(nextConfigRaw, null, 2)}\n`);
  } catch (err) {
    // config 写失败 → 回滚 local（恢复原内容；若原本不存在则删除）
    try {
      restoreLocalSnapshot(projectRoot, priorLocalText);
    } catch (rollbackErr) {
      throw new Error(
        `[record-product-selection] config 写入失败且 local 回滚也失败（fail-closed 未满足）：` +
          `config: ${(err as Error).message}; rollback: ${(rollbackErr as Error).message}`,
      );
    }
    throw new Error(
      `[record-product-selection] framework.config.json 写入失败（local 凭证已回滚）：${(err as Error).message}`,
    );
  }
  clearFrameworkConfigCache();

  // ④ 一致性复核：config 与 local 的值必须逐字等于目标值；失败则恢复两份快照并抛错
  //    （review P1：不一致时不得以"已落盘"+0 退出）。
  const recheck = doReadAfterWrite(projectRoot);
  const configMatchesLocal = recheck.cfgPreferredProduct === value && recheck.localConfirmedValue === value;
  if (!configMatchesLocal) {
    try {
      // 恢复 config（原文）与 local（原内容/原本不存在则删除）
      if (priorLocalText !== null) {
        doWriteLocalConfig(projectRoot, JSON.parse(priorLocalText) as FrameworkLocalConfig);
      } else {
        fs.rmSync(path.join(projectRoot, 'framework.local.json'), { force: true });
      }
      doAtomicWriteFile(cfgPath, priorConfigText);
    } catch (rollbackErr) {
      throw new Error(
        `[record-product-selection] 双写一致性复核失败且回滚也失败（fail-closed 未满足）：` +
          `${(rollbackErr as Error).message}`,
      );
    }
    clearFrameworkConfigCache();
    throw new Error(
      `[record-product-selection] 双写一致性复核失败：config.preferredProduct=${String(
        recheck.cfgPreferredProduct ?? '(缺失)',
      )}, local.confirmed.value=${String(recheck.localConfirmedValue ?? '(缺失)')}，` +
        `期望均为 "${value}"。已恢复两份快照，请重试。`,
    );
  }

  return {
    product: value,
    configPath: cfgPath,
    localPath: path.join(projectRoot, 'framework.local.json'),
    configMatchesLocal,
  };
}

function parseArgs(argv: string[]): { projectRoot?: string; product?: string } {
  const out: { projectRoot?: string; product?: string } = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--project-root' && argv[i + 1]) {
      out.projectRoot = path.resolve(argv[++i]);
    } else if (argv[i] === '--product' && argv[i + 1]) {
      out.product = argv[++i];
    }
  }
  return out;
}

if (require.main === module) {
  const opts = parseArgs(process.argv);
  if (!opts.projectRoot) failCli('[record-product-selection] 须传 --project-root <repo-root>');
  if (!opts.product) failCli('[record-product-selection] 须传 --product <候选值>');
  try {
    // recordProductSelection 内部已做一致性复核：任何不一致都会恢复快照并抛错（非零退出）。
    const r = recordProductSelection(opts.projectRoot, opts.product);
    process.stdout.write(
      [
        'product 确认已落盘（config 与 local 一致性复核通过）：',
        `  product = ${r.product}`,
        `  config = ${r.configPath}`,
        `  local  = ${r.localPath}`,
      ].join('\n') + '\n',
    );
  } catch (e) {
    failCli((e as Error).message);
  }
}