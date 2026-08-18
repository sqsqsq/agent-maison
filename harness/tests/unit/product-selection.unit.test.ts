// ============================================================================
// product-selection.unit.test.ts — 用户确认 product 机制（plan a7c3f9e2 t3）
// ============================================================================
// 覆盖：
//   (a) config 无值 + 用户选 X → record-product-selection 写盘 → config 与 local 均为 X
//       → 重新加载 → resolver 得 explicit_config（**生产链验收**：record CLI → resolver）
//   (b) config 为 rom + 用户选 product → 覆写后一致 → resolver 得 product
//   (c) config 有值 + local 无记录 → resolver 不采信（按未验证处理）
//   (d) config 有值 + local 记录值不等（用户手改 config）→ 回落未验证
//   (e) 写 productSelection 后 local 其他字段（devEcoStudio / probe / vision / device）逐字不丢
//   (f) 单候选工程不出现 unresolved（registry 项不触发）
//   + local schema 严格校验（未知键/非法值拒绝）
// ============================================================================

import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { clearFrameworkConfigCache } from '../../config';
import { recordProductSelection } from '../../scripts/record-product-selection';
import { loadLocalConfig } from '../../scripts/utils/framework-local-config';
import { resolveProductSelection } from '../../../profiles/hmos-app/harness/product-selection';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'product-selection-'));
}

function withTmp<T>(fn: (root: string) => T): T {
  const root = mkTmp();
  try {
    clearFrameworkConfigCache();
    return fn(root);
  } finally {
    clearFrameworkConfigCache();
    try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

function writeBuildProfile(root: string, products: string[]): void {
  fs.writeFileSync(
    path.join(root, 'build-profile.json5'),
    JSON.stringify({ app: { products: products.map(name => ({ name })) } }, null, 2),
    'utf-8',
  );
}

function writeConfig(root: string, cfg: Record<string, unknown>): void {
  fs.mkdirSync(path.join(root, 'doc', 'features'), { recursive: true });
  fs.writeFileSync(path.join(root, 'framework.config.json'), JSON.stringify(cfg, null, 2), 'utf-8');
}

function baseConfig(preferredProduct?: string): Record<string, unknown> {
  return {
    schema_version: '1.1',
    project_name: 'Wallet',
    project_profile: { name: 'hmos-app', sub_variant: 'app' },
    materialized_adapters: ['claude', 'generic'],
    architecture: {
      outer_layers: [{ id: '01-Product', can_depend_on: [], intra_layer_deps: 'dag' }],
      module_inner_layers: ['shared', 'data'],
      inner_dependency_direction: 'upward',
      cross_module_exports_file: 'index.ets',
    },
    paths: { features_dir: 'doc/features' },
    toolchain: preferredProduct ? { preferredProduct } : undefined,
  };
}

function writeLocal(root: string, local: Record<string, unknown>): void {
  fs.writeFileSync(path.join(root, 'framework.local.json'), JSON.stringify(local, null, 2), 'utf-8');
}

function readDevEcoRichLocal(): Record<string, unknown> {
  return {
    schema_version: '1.0',
    agent_adapter: 'claude',
    toolchain: {
      devEcoStudio: { installPath: 'C:/DevEco' },
      probe: { cli_starts: { ok: true, hvigor_version: '5.2.3', observed_at: '2026-07-01T00:00:00Z' } },
    },
    vision: {
      image_input_override: 'tool_read',
      canary: { adapter: 'claude', verdict: 'tool_read', probed_at: '2026-07-09T00:00:00.000Z' },
    },
    device: { unlock: { mode: 'credential', credential_ref: 'maison/device/3UJ0/v2' }, target_serial: '3UJ0225321000395' },
  };
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    // (a) 生产链验收：无值 → 确认 X → 双写 → resolver 得 explicit_config
    name: 't3(a) config 无值 + 用户选 X → 双文件写盘 → resolver 得 explicit_config',
    run: () => withTmp(root => {
      writeBuildProfile(root, ['product', 'mirror']);
      writeConfig(root, baseConfig());
      const r = recordProductSelection(root, 'product');
      assert.strictEqual(r.configMatchesLocal, true, '一致性自证须通过');
      const cfgRaw = JSON.parse(fs.readFileSync(path.join(root, 'framework.config.json'), 'utf-8'));
      assert.strictEqual(cfgRaw.toolchain.preferredProduct, 'product');
      const local = loadLocalConfig(root);
      assert.strictEqual(local?.toolchain?.productSelection?.confirmed?.value, 'product');
      assert(local?.toolchain?.productSelection?.confirmed?.confirmed_at, '须记录 confirmed_at');
      clearFrameworkConfigCache();
      const sel = resolveProductSelection({ projectRoot: root, purpose: 'coding' });
      assert.strictEqual(sel.source, 'explicit_config');
      assert.strictEqual(sel.product, 'product');
    }),
  },
  {
    // (b) 覆写错误值：config=rom + 用户选 product → 覆写后一致 → resolver 得 product
    name: 't3(b) config=rom + 用户选 product → 覆写后一致 → resolver 得 product',
    run: () => withTmp(root => {
      writeBuildProfile(root, ['product', 'mirror']);
      writeConfig(root, baseConfig('rom'));
      const r = recordProductSelection(root, 'product');
      assert.strictEqual(r.configMatchesLocal, true);
      clearFrameworkConfigCache();
      const sel = resolveProductSelection({ projectRoot: root, purpose: 'coding' });
      assert.strictEqual(sel.source, 'explicit_config');
      assert.strictEqual(sel.product, 'product');
    }),
  },
  {
    // (c) config 有值 + local 无记录 → 未验证（不作为可信来源）
    name: 't3(c) config 有值 + local 无记录 → resolver 不采信（未验证）',
    run: () => withTmp(root => {
      writeBuildProfile(root, ['product', 'mirror']);
      writeConfig(root, baseConfig('rom'));
      const sel = resolveProductSelection({ projectRoot: root, purpose: 'coding' });
      assert.notStrictEqual(sel.source, 'explicit_config');
      assert.strictEqual(sel.source, 'unresolved', '多候选 + 未验证 → unresolved');
      assert.strictEqual(sel.product, null);
    }),
  },
  {
    // (d) config 有值 + local 记录值不等（用户手改了 config）→ 回落未验证
    name: 't3(d) config 有值 + local 确认值不等 → 未验证',
    run: () => withTmp(root => {
      writeBuildProfile(root, ['product', 'mirror']);
      writeConfig(root, baseConfig('mirror'));
      writeLocal(root, {
        schema_version: '1.0',
        toolchain: { productSelection: { confirmed: { value: 'product', confirmed_at: '2026-08-17T00:00:00Z' } } },
      });
      const sel = resolveProductSelection({ projectRoot: root, purpose: 'coding' });
      assert.strictEqual(sel.source, 'unresolved', 'config=mirror ≠ local=product → 未验证');
    }),
  },
  {
    // (e) 无损：写 productSelection 后 local 其他字段逐字不丢
    name: 't3(e) 写 productSelection 后 local 其他字段（devEcoStudio/probe/vision/device）逐字不丢',
    run: () => withTmp(root => {
      writeBuildProfile(root, ['product']);
      writeConfig(root, baseConfig());
      writeLocal(root, readDevEcoRichLocal());
      const before = JSON.parse(fs.readFileSync(path.join(root, 'framework.local.json'), 'utf-8'));
      recordProductSelection(root, 'product');
      const afterText = fs.readFileSync(path.join(root, 'framework.local.json'), 'utf-8');
      const after = JSON.parse(afterText);
      for (const k of ['schema_version', 'agent_adapter', 'vision', 'device']) {
        assert.deepStrictEqual(after[k], before[k], `${k} 不得丢失`);
      }
      assert.deepStrictEqual(after.toolchain.devEcoStudio, before.toolchain.devEcoStudio);
      assert.deepStrictEqual(after.toolchain.probe, before.toolchain.probe);
      assert.strictEqual(after.toolchain.productSelection.confirmed.value, 'product');
    }),
  },
  {
    // (f) 单候选工程：resolver 直接得 sole_candidate（registry 条目不触发）
    name: 't3(f) 单候选工程 → sole_candidate（零新增交互）',
    run: () => withTmp(root => {
      writeBuildProfile(root, ['default']);
      writeConfig(root, baseConfig());
      const sel = resolveProductSelection({ projectRoot: root, purpose: 'coding' });
      assert.strictEqual(sel.source, 'sole_candidate');
      assert.strictEqual(sel.product, 'default');
    }),
  },
  {
    name: 't3(local-schema) productSelection 未知键 / 非法值被拒',
    run: () => withTmp(root => {
      writeBuildProfile(root, ['product']);
      writeConfig(root, baseConfig());
      writeLocal(root, {
        schema_version: '1.0',
        toolchain: { productSelection: { confirmed: { value: 'x', hacked: true } } },
      });
      assert.throws(() => loadLocalConfig(root), /productSelection/);
      writeLocal(root, {
        schema_version: '1.0',
        toolchain: { productSelection: { confirmed: { value: '' } } },
      });
      assert.throws(() => loadLocalConfig(root), /value 必须是非空字符串/);
      writeLocal(root, {
        schema_version: '1.0',
        toolchain: { productSelection: { confirmed: { value: 'x', confirmed_at: 123 } } },
      });
      assert.throws(() => loadLocalConfig(root), /confirmed_at/);
    }),
  },
  {
    name: 't3(cli) record-product-selection：非候选值被拒、缺 config 被拒、无副作用',
    run: () => withTmp(root => {
      writeBuildProfile(root, ['product']);
      writeConfig(root, baseConfig());
      assert.throws(() => recordProductSelection(root, 'rom'), /不在候选枚举内/);
      const cfgBefore = fs.readFileSync(path.join(root, 'framework.config.json'), 'utf-8');
      assert.strictEqual(cfgBefore, JSON.stringify(baseConfig(), null, 2), '拒绝路径不得写盘');
      const noCfg = mkTmp();
      try {
        writeBuildProfile(noCfg, ['product']);
        assert.throws(() => recordProductSelection(noCfg, 'product'), /framework\.config\.json 不存在/);
      } finally {
        fs.rmSync(noCfg, { recursive: true, force: true });
      }
    }),
  },
  {
    // review P1：缺失/为空/不可解析的 build-profile 不得被 record CLI 接受（虚构 default 不可确认）
    name: 't3(cli) build-profile 缺失/为空/不可解析 → record 拒绝（不确认虚构 default）',
    run: () => withTmp(root => {
      writeConfig(root, baseConfig());
      assert.throws(() => recordProductSelection(root, 'default'), /无法确认 product.*build-profile/);
      writeBuildProfile(root, []);
      assert.throws(() => recordProductSelection(root, 'default'), /未声明任何 product/);
      fs.writeFileSync(path.join(root, 'build-profile.json5'), '{ app: { products: [ { "name": "x" }', 'utf-8');
      assert.throws(() => recordProductSelection(root, 'default'), /无法解析/);
      const cfgBefore = fs.readFileSync(path.join(root, 'framework.config.json'), 'utf-8');
      assert.strictEqual(cfgBefore, JSON.stringify(baseConfig(), null, 2), '拒绝路径零写盘');
    }),
  },
  {
    // review P1（fault injection）：config 写失败 → local 凭证回滚，双文件回到原状
    name: 't3(fault-1) config 写失败 → local 回滚（fail-closed）',
    run: () => withTmp(root => {
      writeBuildProfile(root, ['product']);
      writeConfig(root, baseConfig());
      writeLocal(root, readDevEcoRichLocal());
      const localBefore = fs.readFileSync(path.join(root, 'framework.local.json'), 'utf-8');
      assert.throws(
        () =>
          recordProductSelection(root, 'product', {
            atomicWriteFile: () => {
              throw new Error('injected config write failure');
            },
          }),
        /写入失败.*local 凭证已回滚/,
      );
      assert.strictEqual(
        fs.readFileSync(path.join(root, 'framework.config.json'), 'utf-8'),
        JSON.stringify(baseConfig(), null, 2),
        'config 未被触碰',
      );
      // local 恢复经 writeLocalConfig（validate+序列化），值级逐字等价即可
      const localAfterText = fs.readFileSync(path.join(root, 'framework.local.json'), 'utf-8');
      assert.deepStrictEqual(
        JSON.parse(localAfterText),
        JSON.parse(localBefore),
        'local 必须恢复原内容（值级逐字）',
      );
      assert.strictEqual(localAfterText.endsWith('\n'), true, 'writeLocalConfig 规范化换行');
    }),
  },
  {
    // review P1（fault injection）：local 写失败 → 抛错，config 未写（零半写状态）
    name: 't3(fault-2) local 写失败 → 抛错且 config 零写盘',
    run: () => withTmp(root => {
      writeBuildProfile(root, ['product']);
      writeConfig(root, baseConfig());
      const cfgBefore = fs.readFileSync(path.join(root, 'framework.config.json'), 'utf-8');
      assert.throws(
        () =>
          recordProductSelection(root, 'product', {
            updateLocalConfig: () => {
              throw new Error('injected local write failure');
            },
          }),
        /injected local write failure/,
      );
      assert.strictEqual(
        fs.readFileSync(path.join(root, 'framework.config.json'), 'utf-8'),
        cfgBefore,
        'local 失败时 config 不得被写',
      );
    }),
  },
  {
    // review P1（fault injection）：双写后一致性复核失败 → 恢复两份快照并抛错（不得 0 退出）
    name: 't3(fault-3) 一致性复核失败 → 双快照恢复 + 抛错',
    run: () => withTmp(root => {
      writeBuildProfile(root, ['product']);
      writeConfig(root, baseConfig());
      writeLocal(root, readDevEcoRichLocal());
      const cfgBefore = fs.readFileSync(path.join(root, 'framework.config.json'), 'utf-8');
      const localBefore = fs.readFileSync(path.join(root, 'framework.local.json'), 'utf-8');
      assert.throws(
        () =>
          recordProductSelection(root, 'product', {
            readAfterWrite: () => ({ cfgPreferredProduct: 'evil', localConfirmedValue: 'evil' }),
          }),
        /双写一致性复核失败/,
      );
      assert.strictEqual(
        fs.readFileSync(path.join(root, 'framework.config.json'), 'utf-8'),
        cfgBefore,
        'config 必须恢复原快照',
      );
      assert.deepStrictEqual(
        JSON.parse(fs.readFileSync(path.join(root, 'framework.local.json'), 'utf-8')),
        JSON.parse(localBefore),
        'local 必须恢复原快照（值级逐字）',
      );
    }),
  },
];

export function runAll(): UnitCaseResult[] {
  return cases.map(c => {
    try {
      c.run();
      return { name: c.name, ok: true };
    } catch (e) {
      return { name: c.name, ok: false, error: (e as Error).stack ?? (e as Error).message };
    }
  });
}