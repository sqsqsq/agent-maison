/**
 * Hylyre Phase 0 契约冻结包的**落位自证**（plan a6c4e9f2 T7a / M1 第一步）。
 *
 * 为什么需要它：本包在交接过程中被重切过三次（223→225→225→226，指纹
 * e0833814 → a047d52e → 623d6c5f → cc738c27），每次都携带 Maison 消费侧语义。M1 的 typed parser、
 * selector gate、routing 与全链回归都以这份为唯一真源，靠人记指纹不可靠——包被替换或
 * 就地改动必须由测试立刻红，而不是等到 M2 接真实 source 时才发现对错了靶子。
 *
 * 复算算法取自包内 `release.manifest.json` 的 `note` 自述，不在此另立口径。
 */
import * as assert from 'assert';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { UnitCaseResult } from '../run-unit';

const cases: Array<{ name: string; run: () => void }> = [];
function test(name: string, run: () => void): void {
  cases.push({ name, run });
}

/** 冻结身份：改这三个常量等于换契约，必须与 fixtures/README.md 同批更新。 */
const FROZEN_TREE_SHA256 = 'cc738c272324022d7ed559340e9c710f9b7f5f94aac62c5dd70042e827a21bae';
const FROZEN_FILE_COUNT = 226;
const FROZEN = {
  hylyre_version: '0.5.0',
  result_protocol: 'hylyre.step-outcome/1',
  trace_schema_version: '0.4-p0',
};

const PKG = path.resolve(__dirname, '..', 'fixtures', 'hylyre-contracts-0.4-p0');

interface FreezeManifest {
  kind: string;
  not_a_release: boolean;
  hylyre_version: string;
  result_protocol: string;
  trace_schema_version: string;
  source: { root: string; tree_sha256: string; files: Array<{ path: string; sha256: string }> };
}

function loadManifest(): FreezeManifest {
  return JSON.parse(fs.readFileSync(path.join(PKG, 'release.manifest.json'), 'utf-8')) as FreezeManifest;
}

function sha256(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function walk(dir: string, base: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(abs, base, out);
    else out.push(path.relative(base, abs).split(path.sep).join('/'));
  }
  return out;
}

test('冻结包身份：per-file 哈希、文件集合与 tree 指纹三者自证', () => {
  const manifest = loadManifest();
  const root = path.join(PKG, manifest.source.root);
  assert.ok(fs.existsSync(root), `契约包缺失：${root}`);

  const drifted: string[] = [];
  const missing: string[] = [];
  for (const file of manifest.source.files) {
    const abs = path.join(root, file.path);
    if (!fs.existsSync(abs)) { missing.push(file.path); continue; }
    if (sha256(fs.readFileSync(abs)) !== file.sha256) drifted.push(file.path);
  }
  assert.deepStrictEqual(missing, [], 'manifest 登记但盘上缺失');
  assert.deepStrictEqual(drifted, [], '文件内容与 manifest 记载不符');

  const declared = new Set(manifest.source.files.map(f => f.path));
  const extra = walk(root, root).filter(p => !declared.has(p));
  assert.deepStrictEqual(extra, [], '盘上存在 manifest 未登记的文件');

  // 算法取自 manifest.note：按 POSIX 相对路径字节序拼接 "<path>\n<sha256>\n" 后取 sha256。
  const concat = [...manifest.source.files]
    .map(f => f.path)
    .sort()
    .map(p => `${p}\n${sha256(fs.readFileSync(path.join(root, p)))}\n`)
    .join('');
  const recomputed = sha256(Buffer.from(concat, 'utf-8'));

  assert.strictEqual(recomputed, manifest.source.tree_sha256, 'tree 指纹与 manifest 记载不符');
  assert.strictEqual(
    recomputed,
    FROZEN_TREE_SHA256,
    '契约包已被替换或就地改动——M1 的 typed parser/gate/routing 全部以它为唯一真源，' +
    '换包必须走一次契约对账并同步更新本测试与 fixtures/README.md，不能静默漂移',
  );
  assert.strictEqual(manifest.source.files.length, FROZEN_FILE_COUNT);
});

test('冻结包声明的协议三元组，以及"这不是发布件"的自我标注', () => {
  const manifest = loadManifest();
  assert.strictEqual(manifest.hylyre_version, FROZEN.hylyre_version);
  assert.strictEqual(manifest.result_protocol, FROZEN.result_protocol);
  assert.strictEqual(manifest.trace_schema_version, FROZEN.trace_schema_version);
  assert.strictEqual(manifest.kind, 'contracts-freeze');
  assert.strictEqual(manifest.not_a_release, true, '本包不得被当作发布件安装');
});

test('M1 消费入口所需的契约资产齐备', () => {
  const root = path.join(PKG, loadManifest().source.root);
  for (const asset of [
    'output-schema.json',
    'step-outcome-v1.md',
    'builder-decision-table.md',
    'reference_reducer.py',
    'golden/case/valid/bc-opencard-1.json',
    'golden/trace/invalid-crossrow',
  ]) {
    assert.ok(fs.existsSync(path.join(root, asset)), `缺失契约资产：${asset}`);
  }
});

export function runAll(): Promise<UnitCaseResult[]> {
  const results: UnitCaseResult[] = [];
  for (const c of cases) {
    try {
      c.run();
      results.push({ name: c.name, ok: true });
    } catch (e) {
      results.push({ name: c.name, ok: false, error: e instanceof Error ? (e.stack ?? e.message) : String(e) });
    }
  }
  return Promise.resolve(results);
}
