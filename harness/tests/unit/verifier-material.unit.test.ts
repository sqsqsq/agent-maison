// verifier-material.unit.test.ts — plan 07a41ec6 T7：审前材料视图（subject 寻址材料）与差异登记

import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { clearFrameworkConfigCache } from '../../config';
import {
  buildVerifierMaterialView,
  diffVerifierMaterial,
  readVerifierMaterialOrNull,
  verifierMaterialFilename,
  writeVerifierMaterial,
} from '../../scripts/utils/verifier-material';
import type { ContextFileEntry } from '../../scripts/utils/types';
import type { UnitCaseResult } from '../run-unit';

const FEATURE = 'vm-fixture';

function mkProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-verifier-material-'));
  clearFrameworkConfigCache();
  return root;
}

function put(root: string, rel: string, content: string): string {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
  return abs;
}

const CHECKS = [
  { id: 'a', status: 'PASS', severity: 'MAJOR' },
  { id: 'b', status: 'WARN', severity: 'MINOR' },
];

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: '材料视图：同材料两次构建同指纹；上下文文件内容/脚本 check 状态/规则/模板变了才换；reports 运行期产物不入材料',
    run: () => {
      const root = mkProject();
      try {
        put(root, 'src/a.ets', 'a v1');
        put(root, `doc/features/${FEATURE}/review/reports/20260903-000001/hylyre/trace.json`, '{"cases":[]}');
        const ctx: ContextFileEntry[] = [
          { label: 'src/a.ets', kind: 'path', content: '4 字节' },
          // verifier 必读的运行期证据由 runner 以路径条目显式送入 → 入材料（codex review）
          { label: `doc/features/${FEATURE}/review/reports/20260903-000001/hylyre/trace.json`, kind: 'path', content: '' },
          { label: '(truncated)', content: '...' },
        ];
        const base = {
          projectRoot: root, feature: FEATURE, phase: 'review', gateFingerprint: '3.0.0:abcdef012345',
          phaseRuleText: 'rule: 1', templateText: '# template', checks: CHECKS, contextFiles: ctx,
        };
        const v1 = buildVerifierMaterialView(base);
        const v2 = buildVerifierMaterialView(base);
        assert.strictEqual(v1.material_sha256, v2.material_sha256, '同材料必须同指纹');
        assert.ok(v1.files.some(f => f.path === 'src/a.ets'), '上下文源码按路径入材料');
        assert.ok(v1.files.some(f => f.path.endsWith('hylyre/trace.json')), '显式送入的最新 run trace 须入材料');
        assert.ok(!v1.files.some(f => f.path.endsWith('summary.json')), 'manifest 侧的 reports 运行期产物（summary 等）不入材料');
        assert.deepStrictEqual(v1.script_checks, ['a=PASS/MAJOR', 'b=WARN/MINOR']);

        put(root, 'src/a.ets', 'a v2');
        assert.notStrictEqual(buildVerifierMaterialView(base).material_sha256, v1.material_sha256, '源码内容变 → 换指纹');
        put(root, 'src/a.ets', 'a v1');
        assert.notStrictEqual(
          buildVerifierMaterialView({ ...base, checks: [{ id: 'a', status: 'FAIL', severity: 'MAJOR' }, CHECKS[1]] }).material_sha256,
          v1.material_sha256, 'check 状态变 → 换指纹',
        );
        assert.notStrictEqual(buildVerifierMaterialView({ ...base, phaseRuleText: 'rule: 2' }).material_sha256, v1.material_sha256, '规则变 → 换指纹');
        assert.notStrictEqual(buildVerifierMaterialView({ ...base, templateText: '# template v2' }).material_sha256, v1.material_sha256, '模板变 → 换指纹');
        assert.strictEqual(buildVerifierMaterialView({ ...base, contextFiles: [...ctx, { label: '(multimodal-degraded)', content: 'x' }] }).material_sha256, v1.material_sha256, '伪标签条目不入材料');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: '差异登记：文件改/增/删与规则/模板/check 投影逐项列出；上一份缺失时如实标 unavailable',
    run: () => {
      const root = mkProject();
      try {
        put(root, 'src/a.ets', 'a');
        put(root, 'src/b.ets', 'b');
        const mk = (files: ContextFileEntry[], extra?: { phaseRuleText?: string; checks?: typeof CHECKS }) =>
          buildVerifierMaterialView({
            projectRoot: root, feature: FEATURE, phase: 'review', gateFingerprint: null,
            phaseRuleText: extra?.phaseRuleText ?? 'r', templateText: 't', checks: extra?.checks ?? CHECKS, contextFiles: files,
          });
        const prev = mk([{ label: 'src/a.ets', kind: 'path', content: '' }, { label: 'src/b.ets', kind: 'path', content: '' }]);
        put(root, 'src/a.ets', 'a2');
        put(root, 'src/c.ets', 'c');
        const curr = mk(
          [{ label: 'src/a.ets', kind: 'path', content: '' }, { label: 'src/c.ets', kind: 'path', content: '' }],
          { phaseRuleText: 'r2', checks: [{ id: 'a', status: 'FAIL', severity: 'MAJOR' }] },
        );
        const diff = diffVerifierMaterial(prev, curr);
        assert.deepStrictEqual(diff, ['phase_rules', 'script_report_checks', 'src/a.ets', '+src/c.ets', '-src/b.ets'], JSON.stringify(diff));
        assert.deepStrictEqual(diffVerifierMaterial(null, curr), ['(prior material manifest unavailable)']);
        assert.deepStrictEqual(diffVerifierMaterial(prev, prev), []);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: '落盘：按 subject 分区读写往返；非法 subject 拒绝造文件名',
    run: () => {
      const root = mkProject();
      try {
        const subject = 'c'.repeat(64);
        const view = buildVerifierMaterialView({
          projectRoot: root, feature: FEATURE, phase: 'plan', gateFingerprint: null,
          phaseRuleText: 'r', templateText: 't', checks: [], contextFiles: [],
        });
        writeVerifierMaterial(root, subject, view);
        assert.deepStrictEqual(readVerifierMaterialOrNull(root, subject), view);
        assert.strictEqual(readVerifierMaterialOrNull(root, 'd'.repeat(64)), null);
        assert.throws(() => verifierMaterialFilename('short'));
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
];

export function runAll(): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];
  for (const c of cases) {
    try {
      c.run();
      results.push({ name: c.name, ok: true });
    } catch (err) {
      results.push({ name: c.name, ok: false, error: (err as Error).stack ?? (err as Error).message });
    }
  }
  return results;
}
