/**
 * hylyre-artifact-resolution — Q5 冻结基准（artifact path 相对 trace 文件所在目录）。
 *
 * 关键回归：**不依赖 cwd**。Hylyre 侧的实测教训是 producer 曾把 failure 目录挂在
 * `--report-out` 旁，导致 `--report-out` 与 `--trace-out` 不同目录时 trace 定位不到证据；
 * 消费侧若实现任何 cwd 回退或 fallback 搜索，就会把那类 producer 回归重新盖住。
 */
import * as assert from 'assert';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  evaluateFailureBoundary,
  resolveArtifact,
} from '../../scripts/utils/hylyre-artifact-resolution';
import type { ArtifactRefV1 } from '../../scripts/utils/hylyre-result-protocol';
import type { UnitCaseResult } from '../run-unit';

const cases: Array<{ name: string; run: () => void }> = [];
function test(name: string, run: () => void): void {
  cases.push({ name, run });
}

const sha = (b: Buffer | string): string =>
  crypto.createHash('sha256').update(typeof b === 'string' ? Buffer.from(b, 'utf-8') : b).digest('hex');

interface Bed { root: string; tracePath: string; png: string }

/** trace 与 failures/ 同目录；另建一个**无关**目录用来当 cwd，证明解析不依赖它。 */
function bed(): Bed {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'artifact-')));
  const traceDir = path.join(root, 'reports', '20260831T120000Z', 'hylyre');
  fs.mkdirSync(path.join(traceDir, 'failures'), { recursive: true });
  fs.mkdirSync(path.join(root, 'elsewhere'), { recursive: true });
  const tracePath = path.join(traceDir, 'trace.json');
  fs.writeFileSync(tracePath, '{}', 'utf-8');
  const png = 'failures/TC-A-step-0.png';
  fs.writeFileSync(path.join(traceDir, png), 'PNGDATA', 'utf-8');
  return { root, tracePath, png };
}

const ref = (p: string, digest: string): ArtifactRefV1 => ({ kind: 'screenshot', path: p, sha256: digest });

test('Q5 基准：相对 trace 文件所在目录解析并校验 sha256，且与 cwd 无关', () => {
  const b = bed();
  const artifact = ref(b.png, sha('PNGDATA'));
  const original = process.cwd();
  try {
    // 故意把 cwd 切到无关目录：解析结果必须完全不受影响。
    process.chdir(path.join(b.root, 'elsewhere'));
    const r = resolveArtifact(b.tracePath, artifact);
    assert.ok(r.ok, `应解析成功：${JSON.stringify(r)}`);
    assert.strictEqual(r.ok && path.dirname(path.dirname(r.absolutePath)), path.dirname(b.tracePath));
  } finally {
    process.chdir(original);
  }
});

test('Q5 子目录正例 + sha256 不符必须拒', () => {
  const b = bed();
  assert.ok(resolveArtifact(b.tracePath, ref(b.png, sha('PNGDATA'))).ok);
  const bad = resolveArtifact(b.tracePath, ref(b.png, sha('OTHER')));
  assert.strictEqual(bad.ok, false);
  assert.strictEqual(!bad.ok && bad.code, 'sha256_mismatch');
});

test('Q5 逃逸：七种形态全部拒绝，且不做任何 fallback 搜索', () => {
  const b = bed();
  const escapes: Array<[string, string]> = [
    ['父级穿越', '../trace.json'],
    ['嵌套逃逸', 'failures/../../trace.json'],
    ['POSIX 绝对', '/etc/passwd'],
    ['盘符绝对', 'C:/Windows/win.ini'],
    ['UNC', '\\\\server\\share\\x.png'],
    ['反斜杠根', '\\rooted.png'],
    ['反斜杠逃逸', 'failures\\..\\..\\trace.json'],
  ];
  for (const [label, p] of escapes) {
    const r = resolveArtifact(b.tracePath, ref(p, sha('PNGDATA')));
    assert.strictEqual(r.ok, false, `${label} 必须拒绝：${p}`);
    assert.strictEqual(!r.ok && r.code, 'escapes_trace_tree', `${label} 应判逃逸`);
  }
  // 不存在的合法相对路径 → missing，而不是去别处找。
  const miss = resolveArtifact(b.tracePath, ref('failures/nope.png', sha('x')));
  assert.strictEqual(!miss.ok && miss.code, 'missing');
});

test('冻结包 golden：所有 valid trace fixture 的 artifact path 都是 trace 相对且无逃逸', () => {
  const dir = path.resolve(__dirname, '..', 'fixtures', 'hylyre-contracts-0.4-p0', 'contracts', 'golden', 'trace', 'valid');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  assert.ok(files.length > 0);
  let seen = 0;
  for (const f of files) {
    const trace = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')) as {
      cases?: Array<{ steps?: Array<{ artifacts?: ArtifactRefV1[] }> }>;
    };
    for (const c of trace.cases ?? []) {
      for (const s of c.steps ?? []) {
        for (const a of s.artifacts ?? []) {
          seen += 1;
          assert.ok(!/^[/\\]/.test(a.path) && !/^[A-Za-z]:/.test(a.path), `${f}: 绝对路径 ${a.path}`);
          assert.ok(!a.path.replace(/\\/g, '/').split('/').includes('..'), `${f}: 含 .. 的 ${a.path}`);
        }
      }
    }
  }
  assert.ok(seen > 0, 'valid trace fixture 里应至少有一个 artifact');
});

test('§8.1 failure-boundary：必填、capture-unavailable 与不适用三分', () => {
  const screenshot: ArtifactRefV1 = { kind: 'screenshot', path: 'failures/a.png', sha256: sha('x') };
  const logOnly: ArtifactRefV1 = { kind: 'log', path: 'failures/a.log', sha256: sha('x') };

  assert.strictEqual(evaluateFailureBoundary({
    deviceSession: true, status: 'failed', failureDomain: 'selector',
    artifacts: [screenshot], caseEvidence: 'complete',
  }).kind, 'satisfied');

  assert.strictEqual(evaluateFailureBoundary({
    deviceSession: true, status: 'failed', failureDomain: 'assertion',
    artifacts: [logOnly], caseEvidence: 'complete',
  }).kind, 'violated', 'log 不算 screen artifact');

  // capture 不可用：必须同时把 case evidence 降级，否则就是"既不取证又宣称完整"
  assert.strictEqual(evaluateFailureBoundary({
    deviceSession: true, status: 'failed', failureDomain: 'selector', artifacts: [],
    extensions: { 'hylyre.capture': { screen: 'unavailable', reason_code: 'infrastructure.transport_failure' } },
    caseEvidence: 'incomplete',
  }).kind, 'capture_unavailable');

  assert.strictEqual(evaluateFailureBoundary({
    deviceSession: true, status: 'failed', failureDomain: 'selector', artifacts: [],
    extensions: { 'hylyre.capture': { screen: 'unavailable' } },
    caseEvidence: 'complete',
  }).kind, 'violated', 'capture unavailable 却宣称 evidence 完整，必须拒');

  // 不适用面：不得因此新增强制截图
  for (const na of [
    { deviceSession: false, status: 'failed', failureDomain: 'selector' },
    { deviceSession: true, status: 'blocked' },
    { deviceSession: true, status: 'skipped' },
    { deviceSession: true, status: 'passed' },
    { deviceSession: true, status: 'failed', failureDomain: 'contract' },
    { deviceSession: true, status: 'failed', failureDomain: 'capability' },
  ]) {
    assert.strictEqual(
      evaluateFailureBoundary({ ...na, artifacts: [], caseEvidence: 'complete' } as never).kind,
      'not_applicable',
      `${JSON.stringify(na)} 不应适用必填条件`,
    );
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
