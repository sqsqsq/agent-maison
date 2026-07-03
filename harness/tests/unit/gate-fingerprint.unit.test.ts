/**
 * gate-fingerprint 单测（回执 stale 治理，2026-07-03）：
 *   背景＝round6 Checkpoint-2 实锤：framework 升级后旧 spec 回执"启动前已闭环"整体豁免 P0-D 新门禁。
 *   验收铁律：旧产物（无指纹/指纹失配）必 stale；当前指纹必新鲜；rules 内容一变指纹必变；
 *   EOL 差异（发布物化 CRLF/LF）不得引起假失效。
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  computeGateFingerprint,
  assertGateFingerprintFresh,
} from '../../scripts/utils/gate-fingerprint';
import type { UnitCaseResult } from '../run-unit';

const cases: Array<{ name: string; run: () => void }> = [];
function test(name: string, run: () => void): void {
  cases.push({ name, run });
}

function mkFrameworkRoot(version = '2.4.0', specRules = 'structure_checks:\n  a:\n    severity: BLOCKER\n'): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-fp-'));
  fs.mkdirSync(path.join(root, 'specs', 'phase-rules'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version }), 'utf-8');
  fs.writeFileSync(path.join(root, 'specs', 'phase-rules', 'spec-rules.yaml'), specRules, 'utf-8');
  return root;
}

test('fingerprint_stable_and_format', () => {
  const root = mkFrameworkRoot();
  const fp1 = computeGateFingerprint(root, 'spec');
  const fp2 = computeGateFingerprint(root, 'spec');
  assert.ok(fp1 && fp1 === fp2, '同内容指纹须稳定');
  assert.ok(/^2\.4\.0:[0-9a-f]{12}$/.test(fp1!), `格式 <version>:<hash12>：${fp1}`);
});

test('fingerprint_changes_when_rules_change', () => {
  const root = mkFrameworkRoot();
  const before = computeGateFingerprint(root, 'spec');
  // 模拟 round6：spec-rules 新增门禁条目（P0-A/B/D 均伴随 rules 变更——指纹必须随之失效）
  fs.appendFileSync(
    path.join(root, 'specs', 'phase-rules', 'spec-rules.yaml'),
    '  capture_completeness_external:\n    severity: BLOCKER\n',
    'utf-8',
  );
  const after = computeGateFingerprint(root, 'spec');
  assert.ok(before && after && before !== after, '门禁集变化指纹必须变');
});

test('fingerprint_eol_normalized', () => {
  // 发布物化/检出可能改写行尾——语义未变不得引起全量假失效
  const rootLf = mkFrameworkRoot('2.4.0', 'a: 1\nb: 2\n');
  const rootCrlf = mkFrameworkRoot('2.4.0', 'a: 1\r\nb: 2\r\n');
  assert.strictEqual(
    computeGateFingerprint(rootLf, 'spec'),
    computeGateFingerprint(rootCrlf, 'spec'),
    'CRLF/LF 指纹须一致',
  );
});

test('fingerprint_unreadable_returns_null', () => {
  const root = mkFrameworkRoot();
  assert.strictEqual(computeGateFingerprint(root, 'no_such_phase'), null, '未知 phase → null');
  fs.rmSync(path.join(root, 'specs', 'phase-rules', 'spec-rules.yaml'));
  assert.strictEqual(computeGateFingerprint(root, 'spec'), null, 'rules 缺失 → null（不硬造）');
});

test('freshness_three_states', () => {
  const root = mkFrameworkRoot();
  const current = computeGateFingerprint(root, 'spec')!;
  // ① 当前指纹 → 新鲜
  assert.strictEqual(assertGateFingerprintFresh({ gate_fingerprint: current }, root, 'spec'), null);
  // ② 无指纹（framework 升级前的旧 summary——本机制的核心打击对象）→ stale
  const noFp = assertGateFingerprintFresh({}, root, 'spec');
  assert.ok(noFp && /旧 summary|不得豁免/.test(noFp), `旧产物必 stale：${noFp}`);
  // ③ 指纹失配（门禁集升级后）→ stale 且指引重跑
  fs.appendFileSync(path.join(root, 'specs', 'phase-rules', 'spec-rules.yaml'), '  new_gate: {}\n', 'utf-8');
  const mismatch = assertGateFingerprintFresh({ gate_fingerprint: current }, root, 'spec');
  assert.ok(mismatch && /门禁集已升级/.test(mismatch) && /重跑 spec harness/.test(mismatch),
    `失配须指引重跑：${mismatch}`);
});

test('freshness_uncomputable_is_stale_not_pass', () => {
  // 当前指纹算不出（框架部署不完整）≠ 可放行——从严
  const root = mkFrameworkRoot();
  fs.rmSync(path.join(root, 'specs', 'phase-rules', 'spec-rules.yaml'));
  const r = assertGateFingerprintFresh({ gate_fingerprint: 'x:abcdefabcdef' }, root, 'spec');
  assert.ok(r && /部署不完整/.test(r), `不可计算须 stale：${r}`);
});

export function runAll(): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];
  for (const c of cases) {
    try {
      c.run();
      results.push({ name: c.name, ok: true });
    } catch (e) {
      results.push({ name: c.name, ok: false, error: (e as Error).message });
    }
  }
  return results;
}
