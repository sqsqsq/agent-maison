/**
 * ArkUI static rules unit tests.
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  checkArkuiBindsheetDoubleClose,
  checkArkuiPushWithoutGuard,
} from '../../arkui-static-rules';
import type { CheckContext } from '../../../../../harness/scripts/utils/types';
import type { FileAnalysis } from '../../../../../harness/scripts/utils/ast-analyzer';
import type { UnitCaseResult } from '../../../../../harness/tests/run-unit';

const CASES: Array<{ name: string; run: () => void }> = [];

function test(name: string, run: () => void): void {
  CASES.push({ name, run });
}

function minimalCtx(root: string): CheckContext {
  return {
    projectRoot: root,
    feature: 'f',
    phase: 'coding',
    frameworkRoot: path.join(root, 'framework'),
    resolvedProfile: {
      name: 'hmos-app',
      profileDir: path.join(root, 'framework', 'profiles', 'hmos-app'),
    },
    phaseRule: {
      structure_checks: {
        arkui_bindsheet_double_close: { description: 'double close', severity: 'BLOCKER' },
        arkui_push_without_guard: { description: 'push guard', severity: 'MAJOR' },
      },
    },
    featureSpec: {},
  } as unknown as CheckContext;
}

test('bindsheet double close: xmark without showClose:false → FAIL', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arkui-'));
  const rel = 'entry/src/main/ets/pages/X.ets';
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(
    abs,
    `@Component
struct X {
  build() {
    Column().bindSheet(true, this.builder, { height: 400 })
  }
  @Builder builder() {
    SymbolGlyph($r('sys.symbol.xmark'))
  }
}`,
  );
  const ctx = minimalCtx(root);
  const analyses: FileAnalysis[] = [{ filePath: rel } as FileAnalysis];
  const res = checkArkuiBindsheetDoubleClose(ctx, analyses);
  assert.strictEqual(res[0]!.status, 'FAIL');
  fs.rmSync(root, { recursive: true, force: true });
});

test('bindsheet: showClose false → PASS', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arkui-'));
  const rel = 'entry/src/main/ets/pages/Y.ets';
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(
    abs,
    `bindSheet(true, this.builder, { height: 400, showClose: false })
SymbolGlyph($r('sys.symbol.xmark'))`,
  );
  const ctx = minimalCtx(root);
  const res = checkArkuiBindsheetDoubleClose(ctx, [{ filePath: rel } as FileAnalysis]);
  assert.strictEqual(res[0]!.status, 'PASS');
  fs.rmSync(root, { recursive: true, force: true });
});

test('push without guard in syncFromFlow → FAIL', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arkui-'));
  const rel = 'entry/src/main/ets/pages/Z.ets';
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(
    abs,
    `syncFromFlow() {
  this.pathStack.pushPath({ name: 'Detail' })
}`,
  );
  const ctx = minimalCtx(root);
  const res = checkArkuiPushWithoutGuard(ctx, [{ filePath: rel } as FileAnalysis]);
  assert.strictEqual(res[0]!.status, 'FAIL');
  fs.rmSync(root, { recursive: true, force: true });
});

export function runAll(): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];
  for (const c of CASES) {
    try {
      c.run();
      results.push({ name: c.name, ok: true });
    } catch (e) {
      results.push({ name: c.name, ok: false, error: (e as Error).message });
    }
  }
  return results;
}
