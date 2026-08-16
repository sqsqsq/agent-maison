// ============================================================================
// pass-snapshot.unit.test.ts — trust 命名空间存留能力
// 【pass snapshot 机制已整体退役 · runner-owned-machine-facts】旧 36 例（classify/
// take/diff/cache/anchor/binding/integrity/环A 等）随机制删除；本套件只钉存留职责：
// coding 基线锚（write-once/结构校验/跨 run 绑定）与路径安全 helper。
// deleteRunTrustState/isValidRunIdBasename 的契约由 trust-lifecycle 套件承载。
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  assertNoLinkInChain,
  codingBasePath,
  readCodingBase,
  recordCodingBase,
} from '../../scripts/utils/pass-snapshot';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

const FEATURE = 'bc-fixture';
const RUN = '20260101T000000Z';

interface Env {
  root: string;
  restore: () => void;
}

function setupEnv(): Env {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pass-snap-'));
  const previousDir = process.env.MAISON_GOAL_CHECKPOINT_DIR;
  process.env.MAISON_GOAL_CHECKPOINT_DIR = path.join(root, 'trust');
  return {
    root,
    restore: () => {
      if (previousDir === undefined) delete process.env.MAISON_GOAL_CHECKPOINT_DIR;
      else process.env.MAISON_GOAL_CHECKPOINT_DIR = previousDir;
    },
  };
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'coding base: 记录内容不带 HMAC，读取以结构 status 区分 absent/ok',
    run: () => {
      const env = setupEnv();
      try {
        if (readCodingBase(env.root, FEATURE, RUN).status !== 'absent') throw new Error('初始应 absent');
        const recorded = recordCodingBase({ projectRoot: env.root, feature: FEATURE, runId: RUN, baseSha: 'a'.repeat(40) });
        if (recorded.kind !== 'recorded') throw new Error(recorded.kind);
        const read = readCodingBase(env.root, FEATURE, RUN);
        if (read.status !== 'ok' || !read.body) throw new Error(JSON.stringify(read));
        const doc = JSON.parse(fs.readFileSync(codingBasePath(env.root, FEATURE, RUN), 'utf-8')) as Record<string, unknown>;
        if ('mac' in doc) throw new Error('coding base 仍带 mac');
      } finally { env.restore(); }
    },
  },
  {
    name: 'coding base: write-once——同 run 二次记录复用原 SHA（resume 不洗 diff 基线）',
    run: () => {
      const env = setupEnv();
      try {
        recordCodingBase({ projectRoot: env.root, feature: FEATURE, runId: RUN, baseSha: 'a'.repeat(40) });
        const second = recordCodingBase({ projectRoot: env.root, feature: FEATURE, runId: RUN, baseSha: 'b'.repeat(40) });
        if (second.kind !== 'reused') throw new Error(second.kind);
        if (second.body.base_sha !== 'a'.repeat(40)) throw new Error('原 SHA 被覆盖');
      } finally { env.restore(); }
    },
  },
  {
    name: 'coding base: 损坏既有记录不覆盖洗白，读取判 invalid',
    run: () => {
      const env = setupEnv();
      try {
        const p = codingBasePath(env.root, FEATURE, RUN);
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, '{"kind":"coding_base","schema_version":"1.0","base_sha":"not-a-sha"}', 'utf-8');
        if (readCodingBase(env.root, FEATURE, RUN).status !== 'invalid') throw new Error('应判 invalid');
        const rec = recordCodingBase({ projectRoot: env.root, feature: FEATURE, runId: RUN, baseSha: 'a'.repeat(40) });
        if (rec.kind !== 'invalid_existing') throw new Error(`损坏记录被覆盖：${rec.kind}`);
      } finally { env.restore(); }
    },
  },
  {
    name: 'coding base: 跨 run/feature 复制的记录判 invalid（身份绑定）',
    run: () => {
      const env = setupEnv();
      try {
        recordCodingBase({ projectRoot: env.root, feature: FEATURE, runId: RUN, baseSha: 'a'.repeat(40) });
        const src = codingBasePath(env.root, FEATURE, RUN);
        const dst = codingBasePath(env.root, FEATURE, '20260202T000000Z');
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.copyFileSync(src, dst);
        if (readCodingBase(env.root, FEATURE, '20260202T000000Z').status !== 'invalid') {
          throw new Error('跨 run 重放应判 invalid');
        }
      } finally { env.restore(); }
    },
  },
  {
    name: 'path: assertNoLinkInChain 对域外目标 fail-closed',
    run: () => {
      const env = setupEnv();
      try {
        const root = path.join(env.root, 'trust');
        fs.mkdirSync(root, { recursive: true });
        let threw = false;
        try {
          assertNoLinkInChain(path.join(env.root, 'outside.txt'), root);
        } catch { threw = true; }
        if (!threw) throw new Error('域外目标未抛错');
      } finally { env.restore(); }
    },
  },
];

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

if (require.main === module) {
  const result = runAll();
  for (const item of result) console.log(item.ok ? `PASS ${item.name}` : `FAIL ${item.name}: ${item.error}`);
  process.exit(result.every(item => item.ok) ? 0 : 1);
}
