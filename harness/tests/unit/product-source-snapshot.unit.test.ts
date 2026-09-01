// ============================================================================
// product-source-snapshot.unit.test.ts — invocation 前后精确快照（v23 F2）
// ----------------------------------------------------------------------------
// v23 重写为纯 fs 递归哈希后的行为契约：
//   · 三集合范围：产品层 + feature SSOT（canonical/legacy 双路径）+ 根构建配置；
//   · 五类变化可检出：新增/删除/内容/路径(=删+增)/类型；
//   · 不跟随 symlink/junction（身份=链接本身）；
//   · 声明的产品层缺失/不可枚举 = 快照失败（unverifiable，消费点不得调 agent）；
//   · 与 git 无关（宿主忽略这些路径、或 docs_committed:false 时同样全覆盖——旧 git 实现
//     在真实宿主上半盲，是 v22 推倒的根因之一）。
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  PRODUCT_SOURCE_SNAPSHOT_NO_LAYERS,
  PRODUCT_SOURCE_SNAPSHOT_UNVERIFIABLE,
  __testing_setSnapshotReadFile,
  computeProductSourceSnapshotDetail,
  computeProductSourceSnapshotSha256,
  diffProductSourceSnapshots,
  isUsableSnapshot,
} from '../../scripts/utils/product-source-snapshot';
import { clearFrameworkConfigCache } from '../../config';
import type { UnitCaseResult } from '../run-unit';

const LAYERS = ['02-Feature'];
const FEATURE = 'bc-openCard';

function run(results: UnitCaseResult[], name: string, fn: () => void): void {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, error: (err as Error).stack ?? (err as Error).message });
  }
}
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function w(root: string, rel: string, content: string | Buffer): void {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

/** 最小宿主：产品层 + framework.config（resolveFeatureArtifact 需要 features_dir） */
function mkHost(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pss-'));
  w(root, 'framework.config.json', JSON.stringify({
    schema_version: '1.1',
    project_name: 'T',
    project_profile: { name: 'hmos-app', sub_variant: 'app' },
    architecture: {
      outer_layers: [{ id: '02-Feature', can_depend_on: [], intra_layer_deps: 'dag' }],
      module_inner_layers: ['shared'],
      inner_dependency_direction: 'upward',
      cross_module_exports_file: 'index.ets',
    },
    paths: { features_dir: 'doc/features', docs_committed: false },
  }, null, 2));
  w(root, '02-Feature/M/src/main/ets/A.ets', 'struct A {}');
  clearFrameworkConfigCache();
  return root;
}

export function runAll(): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];

  run(results, 'F2 基本身份：同内容幂等、64 hex、无 git 依赖（tmp 目录非 git 仓照样可用）', () => {
    const root = mkHost();
    const a = computeProductSourceSnapshotSha256(root, LAYERS, FEATURE);
    const b = computeProductSourceSnapshotSha256(root, LAYERS, FEATURE);
    assert(isUsableSnapshot(a), `须为 64 hex，实得 ${a}`);
    assert(a === b, '同内容须幂等');
  });

  run(results, 'F2 五类变化：内容/新增(二进制)/删除 逐一可检出且逐项归因', () => {
    const root = mkHost();
    const pre = computeProductSourceSnapshotDetail(root, LAYERS, FEATURE);

    w(root, '02-Feature/M/src/main/ets/A.ets', 'struct A { changed }');
    let d = diffProductSourceSnapshots(pre, computeProductSourceSnapshotDetail(root, LAYERS, FEATURE));
    assert(d.kind === 'mutated' && d.changed.some(c => c.how === 'modified' && c.path.endsWith('A.ets')),
      `内容变化须检出：${JSON.stringify(d)}`);

    // 二进制新增——旧 git 文本 diff 在 PNG 上失明，这里必须可见
    w(root, '02-Feature/M/src/main/ets/A.ets', 'struct A {}');
    w(root, '02-Feature/M/src/main/resources/base/media/logo.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    d = diffProductSourceSnapshots(pre, computeProductSourceSnapshotDetail(root, LAYERS, FEATURE));
    assert(d.kind === 'mutated' && d.changed.some(c => c.how === 'added' && c.path.endsWith('logo.png')),
      `二进制新增须检出：${JSON.stringify(d)}`);

    const pre2 = computeProductSourceSnapshotDetail(root, LAYERS, FEATURE);
    fs.rmSync(path.join(root, '02-Feature/M/src/main/resources/base/media/logo.png'));
    d = diffProductSourceSnapshots(pre2, computeProductSourceSnapshotDetail(root, LAYERS, FEATURE));
    assert(d.kind === 'mutated' && d.changed.some(c => c.how === 'removed' && c.path.endsWith('logo.png')),
      `删除须检出：${JSON.stringify(d)}`);
  });

  run(results, 'F2 SSOT 集合：acceptance.yaml 变化可检出（旧 git 实现的盲区——docs 不进 git）', () => {
    const root = mkHost();
    w(root, `doc/features/${FEATURE}/acceptance.yaml`, 'feature: x\ncriteria: []\n');
    const pre = computeProductSourceSnapshotDetail(root, LAYERS, FEATURE);
    w(root, `doc/features/${FEATURE}/acceptance.yaml`, 'feature: x\ncriteria:\n  - relaxed\n');
    const d = diffProductSourceSnapshots(pre, computeProductSourceSnapshotDetail(root, LAYERS, FEATURE));
    assert(d.kind === 'mutated' && d.changed.some(c => c.path.endsWith('acceptance.yaml')),
      `SSOT 变化须检出：${JSON.stringify(d)}`);
  });

  run(results, 'F2 SSOT 不存在是合法态（新 feature 没写 contracts.yaml 不算失败）；凭空出现=新增', () => {
    const root = mkHost();
    const pre = computeProductSourceSnapshotDetail(root, LAYERS, FEATURE);
    assert(isUsableSnapshot(pre.sha256), 'SSOT 全缺时快照仍可用');
    w(root, `doc/features/${FEATURE}/spec/ui-spec.yaml`, 'schema_version: "1.0"\nscreens: []\n');
    const d = diffProductSourceSnapshots(pre, computeProductSourceSnapshotDetail(root, LAYERS, FEATURE));
    assert(d.kind === 'mutated' && d.changed.some(c => c.how === 'added' && c.path.endsWith('ui-spec.yaml')),
      `SSOT 凭空出现须判新增：${JSON.stringify(d)}`);
  });

  run(results, 'F2 根构建配置入快照：build-profile.json5 变化可检出', () => {
    const root = mkHost();
    w(root, 'build-profile.json5', '{ app: {} }');
    const pre = computeProductSourceSnapshotDetail(root, LAYERS, FEATURE);
    w(root, 'build-profile.json5', '{ app: { changed: true } }');
    const d = diffProductSourceSnapshots(pre, computeProductSourceSnapshotDetail(root, LAYERS, FEATURE));
    assert(d.kind === 'mutated' && d.changed.some(c => c.path === 'build-profile.json5'),
      `构建配置变化须检出：${JSON.stringify(d)}`);
  });

  run(results, 'F2 fail-closed：声明的产品层目录不存在 → unverifiable（不得当"无变化"，不得调 agent）', () => {
    const root = mkHost();
    const d = computeProductSourceSnapshotDetail(root, ['03-NotExist'], FEATURE);
    assert(d.sha256 === PRODUCT_SOURCE_SNAPSHOT_UNVERIFIABLE, `实得 ${d.sha256}`);
    assert(!!d.failureReason && d.failureReason.includes('03-NotExist'), `须点名缺失目录：${d.failureReason}`);
    assert(!isUsableSnapshot(d.sha256), '哨兵不得用于身份绑定');
  });

  run(results, 'F2 fail-closed：无产品层声明 → no-layers；文件持续不可读 → unverifiable', () => {
    const root = mkHost();
    assert(
      computeProductSourceSnapshotSha256(root, [], FEATURE) === PRODUCT_SOURCE_SNAPSHOT_NO_LAYERS,
      '空层须 no-layers',
    );
    try {
      __testing_setSnapshotReadFile(() => { throw new Error('EACCES'); });
      const d = computeProductSourceSnapshotDetail(root, LAYERS, FEATURE);
      assert(d.sha256 === PRODUCT_SOURCE_SNAPSHOT_UNVERIFIABLE, `不可读须 unverifiable，实得 ${d.sha256}`);
    } finally {
      __testing_setSnapshotReadFile(null);
    }
  });

  run(results, 'F2 diff fail-closed：任一侧哨兵 → unverifiable（绝不判 clean）', () => {
    const root = mkHost();
    const good = computeProductSourceSnapshotDetail(root, LAYERS, FEATURE);
    const bad = computeProductSourceSnapshotDetail(root, ['03-NotExist'], FEATURE);
    assert(diffProductSourceSnapshots(bad, good).kind === 'unverifiable', 'pre 哨兵须 unverifiable');
    assert(diffProductSourceSnapshots(good, bad).kind === 'unverifiable', 'post 哨兵须 unverifiable');
  });

  run(results, 'F2 稳定排序：文件写入顺序不影响身份', () => {
    const a = mkHost();
    w(a, '02-Feature/M/src/main/ets/B.ets', 'b');
    w(a, '02-Feature/M/src/main/ets/C.ets', 'c');
    const b = mkHost();
    w(b, '02-Feature/M/src/main/ets/C.ets', 'c');
    w(b, '02-Feature/M/src/main/ets/B.ets', 'b');
    const ha = computeProductSourceSnapshotSha256(a, LAYERS, FEATURE);
    const hb = computeProductSourceSnapshotSha256(b, LAYERS, FEATURE);
    assert(ha === hb, '不同写入顺序须同身份');
  });

  run(results, 'F2 symlink 不跟随：链接身份=目标字符串，不进目标目录（防 junction 循环/逃逸）', () => {
    const root = mkHost();
    const linkAbs = path.join(root, '02-Feature/M/link.ets');
    try {
      fs.symlinkSync(path.join(root, '02-Feature/M/src/main/ets/A.ets'), linkAbs, 'file');
    } catch {
      // Windows 无 symlink 权限时无法构造夹具；lstat 分支行为由实现保证，此处如实跳过
      return;
    }
    const pre = computeProductSourceSnapshotDetail(root, LAYERS, FEATURE);
    const entry = pre.entries.find(e => e.path.endsWith('link.ets'));
    assert(!!entry && (entry.kind === 'symlink' || entry.kind === 'dir-symlink'),
      `symlink 须按链接身份记录：${JSON.stringify(entry)}`);
    // 改目标内容不改变链接身份（不跟随）
    w(root, '02-Feature/M/src/main/ets/A.ets', 'struct A { changed }');
    const post = computeProductSourceSnapshotDetail(root, LAYERS, FEATURE);
    const entry2 = post.entries.find(e => e.path.endsWith('link.ets'));
    assert(entry2!.sha256 === entry!.sha256, '目标内容变化不得改变链接条目身份');
  });

  return results;
}
