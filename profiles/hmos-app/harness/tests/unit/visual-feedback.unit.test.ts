// ============================================================================
// visual-feedback.unit.test.ts — blind-visual-hardening d6 / P1-E
// ============================================================================
// 锁定：①两类信号分立（声明文案缺失=hard；多余文本/色差/行距=advisory；
//   色差 8→9 类连续变化不产 hard——由阈值判定锁定）；②子串容错（OCR 拼行噪声不误报）；
// ③收敛分类（first_round/converged/converging/stalled/regressing）；④行距节奏带；
// ⑤身份字段只来自发布件 manifest/sidecar，五种宿主 Git 环境逐字段相同；
// ⑥deterministic_feedback 机器派生（盲档∧UI 需求；非盲/非 UI 不派生）。
// ============================================================================

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';

import {
  COLOR_DELTA_E_REPORT_THRESHOLD,
  classifyConvergence,
  diffLineRhythm,
  diffTextLines,
  isDeterministicFeedbackRequired,
  renderVisualFeedbackMd,
  resolveFeedbackIdentity,
  type VisualFeedbackDoc,
} from '../../visual-feedback';
import type { OcrLine } from '../../ocr-toolkit';
import type { CheckContext } from '../../../../../harness/scripts/utils/types';
import type { UnitCaseResult } from '../../../../../harness/tests/run-unit';

const cases: Array<{ name: string; run: () => void }> = [];
function test(name: string, run: () => void): void {
  cases.push({ name, run });
}

function line(text: string, y: number, h = 0.03): OcrLine {
  return { text, box: [0.1, y, 0.5, h], words: [] };
}

// ---------------- ① 两类信号分立 ----------------

test('文本差异：声明文案缺失=hard；未声明缺失/设备多出=advisory', () => {
  const declared = new Set(['下一步']);
  const findings = diffTextLines(
    's1',
    [line('下一步', 0.8), line('随便什么水印', 0.5)],
    [line('设备侧多出的字', 0.3)],
    declared,
  );
  const hard = findings.filter(f => f.kind === 'hard');
  const advisory = findings.filter(f => f.kind === 'advisory');
  assert.strictEqual(hard.length, 1, JSON.stringify(findings));
  assert.ok(hard[0].detail.includes('下一步'));
  assert.strictEqual(advisory.length, 2, '未声明缺失 + 设备多出');
});

test('子串容错：设备行「55 秒后重试」含参考行「秒后重试」→ 不误报缺失', () => {
  const findings = diffTextLines('s1', [line('秒后重试', 0.4)], [line('55 秒后重试', 0.4)], new Set());
  assert.strictEqual(findings.length, 0, JSON.stringify(findings));
});

test('连续指标不产 hard：行距/色差类 finding kind 恒 advisory（色差 8→9 不升轴的结构性保证）', () => {
  const rhythm = diffLineRhythm(
    's1',
    [line('a', 0.1), line('b', 0.15), line('c', 0.2)],
    [line('a', 0.1), line('b', 0.3), line('c', 0.5)],
  );
  assert.ok(rhythm, '2 倍行距应产 finding');
  assert.strictEqual(rhythm!.kind, 'advisory', '连续指标恒 advisory');
  assert.ok(COLOR_DELTA_E_REPORT_THRESHOLD > 9, '阈值冻结面：ΔE 9 级别的连续变化不足以上报');
});

test('行距节奏：合理带内不产 finding', () => {
  const r = diffLineRhythm(
    's1',
    [line('a', 0.1), line('b', 0.2), line('c', 0.3)],
    [line('a', 0.1), line('b', 0.21), line('c', 0.32)],
  );
  assert.strictEqual(r, null);
});

// ---------------- ③ 收敛 ----------------

test('收敛分类：first_round / converging / stalled / regressing / converged 五态', () => {
  assert.strictEqual(classifyConvergence(null, ['a', 'b']).state, 'first_round');
  assert.strictEqual(classifyConvergence(null, []).state, 'converged');
  assert.strictEqual(classifyConvergence(['a', 'b'], ['a']).state, 'converging');
  assert.strictEqual(classifyConvergence(['a'], ['a']).state, 'stalled');
  assert.strictEqual(classifyConvergence(['a'], ['a', 'c']).state, 'regressing');
  const conv = classifyConvergence(['a', 'b'], ['b']);
  assert.deepStrictEqual(conv.resolved_since_prev, ['a']);
});

// ---------------- ⑤ 身份 ----------------

type GitShape = 'tracked_dirty' | 'staged' | 'committed' | 'untracked' | 'non_git';

function git(cwd: string, args: string[]): void {
  const r = spawnSync('git', args, { cwd, encoding: 'utf-8', shell: false });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr || r.stdout}`);
}

function setupIdentityShape(shape: GitShape): { projectRoot: string; frameworkRoot: string } {
  const projectRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `vf-id-${shape}-`)));
  const frameworkRoot = path.join(projectRoot, 'framework');
  fs.mkdirSync(path.join(frameworkRoot, 'specs', 'phase-rules'), { recursive: true });
  fs.writeFileSync(path.join(frameworkRoot, 'package.json'), JSON.stringify({ version: '3.0.0' }), 'utf-8');
  fs.writeFileSync(path.join(frameworkRoot, 'specs', 'phase-rules', 'testing-rules.yaml'), 'phase: testing\n', 'utf-8');
  fs.writeFileSync(path.join(frameworkRoot, 'README.md'), shape === 'tracked_dirty' || shape === 'staged' ? 'old\n' : 'new\n', 'utf-8');
  fs.writeFileSync(
    path.join(frameworkRoot, 'RELEASE-MANIFEST.json'),
    JSON.stringify({
      schema_version: '1.0',
      version: '3.0.0',
      source_commit: '1234567890abcdef1234567890abcdef12345678',
      built_at: '2026-09-01T00:00:00Z',
      files: [],
    }),
    'utf-8',
  );
  fs.writeFileSync(path.join(frameworkRoot, 'RELEASE-MANIFEST.sha256'), `${'b'.repeat(64)}\n`, 'utf-8');

  if (shape !== 'non_git') {
    git(projectRoot, ['init', '-q']);
    git(projectRoot, ['config', 'user.email', 'unit@test.local']);
    git(projectRoot, ['config', 'user.name', 'unit-test']);
    if (shape === 'untracked') {
      fs.writeFileSync(path.join(projectRoot, 'host.txt'), 'host\n', 'utf-8');
      git(projectRoot, ['add', 'host.txt']);
      git(projectRoot, ['commit', '-q', '-m', 'host only']);
    } else {
      git(projectRoot, ['add', '-A']);
      git(projectRoot, ['commit', '-q', '-m', 'framework baseline']);
      if (shape === 'tracked_dirty' || shape === 'staged') {
        fs.writeFileSync(path.join(frameworkRoot, 'README.md'), 'new\n', 'utf-8');
        if (shape === 'staged') git(projectRoot, ['add', 'framework/README.md']);
      }
    }
  }
  return { projectRoot, frameworkRoot };
}

test('身份：同一发布件在 dirty/staged/committed/untracked/non-Git 五态逐字段相同', () => {
  const roots: string[] = [];
  try {
    const identities = (['tracked_dirty', 'staged', 'committed', 'untracked', 'non_git'] as GitShape[])
      .map((shape) => {
        const fixture = setupIdentityShape(shape);
        roots.push(fixture.projectRoot);
        return resolveFeedbackIdentity(fixture.projectRoot, fixture.frameworkRoot, 'testing');
      });
    for (const id of identities) assert.deepStrictEqual(id, identities[0]);
    const id = identities[0];
    assert.strictEqual(id.framework_version, '3.0.0');
    assert.strictEqual(id.framework_package_digest, 'b'.repeat(64), '须为 sidecar 声明值，不得二次哈希');
    assert.strictEqual(id.framework_commit_sha, '1234567890abcdef1234567890abcdef12345678', '须为 manifest source_commit');
    assert.ok(id.gate_fingerprint && /^3\.0\.0:[0-9a-f]{12}$/.test(id.gate_fingerprint), `gate=${id.gate_fingerprint}`);
  } finally {
    for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
  }
});

test('生产 visual-feedback 不读取宿主 Git 或哈希 sidecar 文本', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../visual-feedback.ts'), 'utf-8');
  assert.ok(!source.includes("from 'child_process'"));
  assert.ok(!source.includes("spawnSync('git'"));
  assert.ok(!source.includes("path.join(frameworkRoot, 'RELEASE-MANIFEST.sha256')"));
});

// ---------------- ⑥ deterministic_feedback 派生 ----------------

test('deterministic_feedback：非盲 → false；盲+无 spec → false（数据驱动，非配置开关）', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-'));
  try {
    const base = { projectRoot: tmp, feature: 'demo' } as unknown as CheckContext;
    assert.strictEqual(
      isDeterministicFeedbackRequired({ ...base, adapterImageInput: 'tool_read' } as CheckContext),
      false, '非盲',
    );
    assert.strictEqual(
      isDeterministicFeedbackRequired({ ...base, adapterImageInput: 'none' } as CheckContext),
      false, '盲但无 spec/ui_change',
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ---------------- md 投影 ----------------

test('md 投影：hard/advisory 分节 + 收敛行 + 反相似度红线句', () => {
  const doc: VisualFeedbackDoc = {
    schema_version: '1.0',
    feature: 'demo',
    identity: { framework_version: '3.0.0', framework_package_digest: 'x', gate_fingerprint: '3.0.0:abcdefabcdef', framework_commit_sha: null },
    screens: [{
      screen_id: 's1', reference_sha256: 'r', actual_sha256: 'a',
      findings: [
        { id: '1', screen_id: 's1', kind: 'hard', metric: 'text_missing', detail: '缺「下一步」', fingerprint: 'f1' },
        { id: '2', screen_id: 's1', kind: 'advisory', metric: 'region_color', detail: '主色偏差', fingerprint: 'f2' },
      ],
    }],
    convergence: { state: 'first_round', current_fingerprints: ['f1', 'f2'], resolved_since_prev: [], new_since_prev: [] },
  };
  const md = renderVisualFeedbackMd(doc);
  assert.ok(md.includes('硬不变量（1）'));
  assert.ok(md.includes('advisory（1）'));
  assert.ok(md.includes('禁止用单一全局相似度'));
  assert.ok(md.includes('first_round'));
});

export function runAll(): UnitCaseResult[] {
  const out: UnitCaseResult[] = [];
  for (const c of cases) {
    try {
      c.run();
      out.push({ name: c.name, ok: true });
    } catch (err) {
      out.push({ name: c.name, ok: false, error: (err as Error).stack ?? (err as Error).message });
    }
  }
  return out;
}
