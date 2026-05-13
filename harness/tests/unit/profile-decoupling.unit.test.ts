// ============================================================================
// profile 解耦回归：git-diff 排除表、profile coding host 可加载性
// ============================================================================

import * as path from 'path';
import assert from 'assert';
import { filterBusinessSourceChanges } from '../../scripts/utils/git-diff';
import {
  tryLoadDiffExcludeTestPathRegexes,
  tryLoadProfileCodingHost,
  tryLoadUtHostImpl,
} from '../../profile-host-loader';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

/** framework/harness/tests/unit → framework/profiles */
const PROFILES_ROOT = path.resolve(__dirname, '..', '..', '..', 'profiles');
const hmosProfileDir = path.join(PROFILES_ROOT, 'hmos-app');
const genericProfileDir = path.join(PROFILES_ROOT, 'generic');

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'filterBusinessSourceChanges: 无 exclude 时不过滤测试路径',
    run: () => {
      const f = '02-Feature/Mod/src/ohosTest/ets/test/Foo.test.ets';
      const out = filterBusinessSourceChanges([f], ['02-Feature/']);
      assert.deepStrictEqual(out, [f]);
    },
  },
  {
    name: 'filterBusinessSourceChanges: hmos profile 排除regex 生效',
    run: () => {
      const f = '02-Feature/Mod/src/ohosTest/ets/test/Foo.test.ets';
      const rx = tryLoadDiffExcludeTestPathRegexes(hmosProfileDir);
      assert.ok(rx && rx.length > 0, 'hmos-app 应导出 diffExcludeTestPathRegexes');
      const out = filterBusinessSourceChanges([f], ['02-Feature/'], { excludeTestPathRegexes: rx! });
      assert.deepStrictEqual(out, []);
    },
  },
  {
    name: 'tryLoadDiffExcludeTestPathRegexes: generic 无约定时返回 null',
    run: () => {
      const rx = tryLoadDiffExcludeTestPathRegexes(genericProfileDir);
      assert.strictEqual(rx, null);
    },
  },
  {
    name: 'tryLoadProfileCodingHost: hmos-app 导出 profileCodingHost',
    run: () => {
      const host = tryLoadProfileCodingHost(hmosProfileDir);
      assert.ok(host, '应加载 coding-host-rules');
      assert.ok(host!.sourceFileSuffixes.includes('.ets'));
      assert.strictEqual(typeof host!.runStructureChecks, 'function');
      assert.strictEqual(typeof host!.runTraceabilityChecks, 'function');
      assert.strictEqual(typeof host!.checkCodingCompile, 'function');
    },
  },
  {
    name: 'tryLoadProfileCodingHost: generic 无 coding host 时返回 null',
    run: () => {
      assert.strictEqual(tryLoadProfileCodingHost(genericProfileDir), null);
    },
  },
  {
    name: 'tryLoadUtHostImpl: hmos-app 导出 utHostImpl',
    run: () => {
      const ut = tryLoadUtHostImpl(hmosProfileDir);
      assert.ok(ut, '应加载 ut-host-impl');
      assert.strictEqual(typeof ut!.loadUtFiles, 'function');
      assert.strictEqual(typeof ut!.checkUtHvigorBuild, 'function');
      assert.strictEqual(typeof ut!.getUtSuggestionPaths, 'function');
      assert.strictEqual(typeof ut!.isSuiteEntryShim, 'function');
      const sp = ut!.getUtSuggestionPaths();
      assert.ok(sp.useCasesSchemaTemplateRel.length > 0);
      assert.ok(sp.utHostImplRefRel.includes('ut-host-impl'));
    },
  },
];

export function runAll(): UnitCaseResult[] {
  return cases.map(c => {
    try {
      c.run();
      return { name: c.name, ok: true };
    } catch (err) {
      return { name: c.name, ok: false, error: (err as Error).stack ?? (err as Error).message };
    }
  });
}
