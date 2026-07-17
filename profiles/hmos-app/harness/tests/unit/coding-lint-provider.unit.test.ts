// ============================================================================
// coding-lint-provider.unit.test.ts — t5（plan e6a3c9f4）checkCodingLint provider
// ----------------------------------------------------------------------------
// 覆盖：static enum 高置信规则（FAIL/PASS/注释行放过）与 provider 导出接线。
// checkCodingLint 全链依赖 git diff（fixture 级验证走 check-exit 真实路径），
// 此处按仓库先例只测纯函数与导出形状。
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { checkNoStaticEnum, profileCodingHost } from '../../coding-host-rules';

interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'checkNoStaticEnum: class 内 static enum → BLOCKER FAIL 带修复建议与行号',
    run: () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lint-se-'));
      try {
        const rel = 'src/Bad.ets';
        fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
        fs.writeFileSync(
          path.join(tmp, rel),
          ['export class Bad {', '  static enum Kind { A, B }', '}', ''].join('\n'),
          'utf-8',
        );
        const rs = checkNoStaticEnum([rel], tmp);
        assert(rs.length === 1 && rs[0].status === 'FAIL' && rs[0].severity === 'BLOCKER', 'should FAIL');
        assert(rs[0].details.includes('Bad.ets:2'), '应含 文件:行号');
        assert(!!rs[0].suggestion && rs[0].suggestion.includes('enum'), '应带修复建议');
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'checkNoStaticEnum: 干净文件与三类误报形态（字符串/行注释/块注释）→ PASS（v2 sanitizer）',
    run: () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lint-se-ok-'));
      try {
        const rel = 'src/Ok.ets';
        fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
        fs.writeFileSync(
          path.join(tmp, rel),
          [
            'export enum Kind { A, B }',
            "const message = 'static enum is unsupported';",
            'const tpl = `note: static enum in template`;',
            'export class Ok {',
            '  foo(); // avoid static enum',
            '  /* static enum example in block comment */',
            '}',
            '',
          ].join('\n'),
          'utf-8',
        );
        const rs = checkNoStaticEnum([rel], tmp);
        assert(rs.length === 1 && rs[0].status === 'PASS', `should PASS: ${JSON.stringify(rs)}`);
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'provider 导出：checkCodingLint 已接线（check-exit/correction 派发点不再空转）',
    run: () => {
      assert(typeof profileCodingHost.checkCodingLint === 'function', 'checkCodingLint 应已导出');
    },
  },
];

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
