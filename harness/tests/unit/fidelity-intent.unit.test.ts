// fidelity-intent.unit.test.ts — t6 三态意图/解引用/只升不降（goal-fakepass-hardening）
//
// codex 三轮 P1-7 强制的两用例分离：仅 manifest 摘要=ambiguous；解引用 SSOT 文档后
// 合并检测=strong_pixel（「完全参考」×N 是事故原形）。

import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  collectRequirementIntentText,
  collectRequirementSsotPaths,
  dereferenceRequirementDocs,
  detectFidelityIntent,
  resolveRequestedFidelity,
} from '../../scripts/utils/fidelity-shared';
import type { UnitCaseResult } from '../run-unit';

// 事故 manifest 摘要与原始需求文本（节选自 bc-openCard 现场）
const MANIFEST_SUMMARY =
  '开发添加银行卡需求（bc-openCard）。需求描述 SSOT：doc/features/原始需求/1-银行卡/原始需求.md；' +
  '结构/颜色/布局尽量与截图一致；无高保真资源时从原始截图裁剪 logo/图标/插画。';
const REQ_DOC_BODY =
  '- 1）a）收起态：页面布局完全参考\'1-银行卡添卡首页.jpg\'。\n' +
  '- 3）选择卡类型半模态：页面布局完全参考\'3-点击任意银行拉起添卡选卡半模态.jpg\'。\n';

function mkProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'maison-fintent-'));
}

interface Case { name: string; run: () => void }

const cases: Case[] = [
  {
    name: '两用例分离①：仅 manifest 摘要（"尽量与截图一致"）→ ambiguous，不得判 strong',
    run: () => {
      assert.strictEqual(detectFidelityIntent(MANIFEST_SUMMARY), 'ambiguous');
      assert.strictEqual(detectFidelityIntent('实现一个纯后台数据同步任务'), 'none');
    },
  },
  {
    name: '两用例分离②：解引用原始需求.md 合并检测 → strong_pixel（「完全参考」命中既有表）',
    run: () => {
      const root = mkProject();
      const rel = 'doc/features/原始需求/1-银行卡/原始需求.md';
      const abs = path.join(root, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, REQ_DOC_BODY, 'utf-8');
      const deref = dereferenceRequirementDocs(root, MANIFEST_SUMMARY);
      assert.ok(deref.resolvedPaths.includes(rel), `解引用命中：${JSON.stringify(deref.resolvedPaths)}`);
      assert.strictEqual(detectFidelityIntent(deref.combined), 'strong_pixel');
    },
  },
  {
    name: '解引用边界：不存在/越界/超限文件不读；非 doc 前缀跳过',
    run: () => {
      const root = mkProject();
      const d1 = dereferenceRequirementDocs(root, '参考 doc/nope/absent.md 与 ../escape.md 与 src/x.md');
      assert.deepStrictEqual(d1.resolvedPaths, []);
      const big = path.join(root, 'doc', 'big.md');
      fs.mkdirSync(path.dirname(big), { recursive: true });
      fs.writeFileSync(big, 'x'.repeat(300 * 1024), 'utf-8');
      const d2 = dereferenceRequirementDocs(root, '见 doc/big.md');
      assert.deepStrictEqual(d2.resolvedPaths, [], '超 256KB 不读');
    },
  },
  {
    name: '--fidelity 只升不降：降档无 receipt 拒绝；持平/抬升放行；receipt 授权后降档生效',
    run: () => {
      let r = resolveRequestedFidelity('pixel_1to1', 'semantic_layout', false);
      assert.strictEqual(r.effective, 'pixel_1to1');
      assert.strictEqual(r.rejectedDowngrade, true);
      r = resolveRequestedFidelity('semantic_layout', 'pixel_1to1', false);
      assert.strictEqual(r.effective, 'pixel_1to1');
      assert.strictEqual(r.rejectedDowngrade, false);
      r = resolveRequestedFidelity('semantic_layout', 'semantic_layout', false);
      assert.strictEqual(r.effective, 'semantic_layout');
      r = resolveRequestedFidelity('pixel_1to1', 'semantic_layout', true);
      assert.strictEqual(r.effective, 'semantic_layout', 'receipt 授权后降档生效');
    },
  },
  {
    name: 'collectRequirementIntentText：扫全部 goal-run manifest 并解引用',
    run: () => {
      const root = mkProject();
      const rel = 'doc/features/原始需求/1-银行卡/原始需求.md';
      fs.mkdirSync(path.join(root, path.dirname(rel)), { recursive: true });
      fs.writeFileSync(path.join(root, rel), REQ_DOC_BODY, 'utf-8');
      const runDir = path.join(root, 'doc/features/f1/goal-runs/R1');
      fs.mkdirSync(runDir, { recursive: true });
      fs.writeFileSync(path.join(runDir, 'manifest.json'), JSON.stringify({ requirement: MANIFEST_SUMMARY }), 'utf-8');
      const text = collectRequirementIntentText(root, 'f1');
      assert.ok(text.includes('完全参考'), 'manifest 摘要经解引用带出 SSOT 强信号');
      assert.strictEqual(detectFidelityIntent(text), 'strong_pixel');
      assert.strictEqual(collectRequirementIntentText(root, 'no-runs'), '');
    },
  },
  {
    name: '内联 requirement 入血缘（codex 七轮 P0-2）：collectRequirementSsotPaths 含 manifest.json',
    run: () => {
      const root = mkProject();
      const runDir = path.join(root, 'doc/features/f1/goal-runs/R1');
      fs.mkdirSync(runDir, { recursive: true });
      // 纯内联需求（不引用任何文件）
      fs.writeFileSync(path.join(runDir, 'manifest.json'), JSON.stringify({ requirement: '实现银行卡开卡完整流程' }), 'utf-8');
      const paths = collectRequirementSsotPaths(root, 'f1');
      assert.ok(
        paths.some((p) => p.endsWith('goal-runs/R1/manifest.json')),
        `manifest.json 须入血缘（内联需求改写才能被检测）：${JSON.stringify(paths)}`,
      );
    },
  },
];

export function runAll(): UnitCaseResult[] {
  return cases.map((c) => {
    try {
      c.run();
      return { name: `fidelity-intent: ${c.name}`, ok: true };
    } catch (err) {
      return { name: `fidelity-intent: ${c.name}`, ok: false, error: (err as Error).stack ?? (err as Error).message };
    }
  });
}
