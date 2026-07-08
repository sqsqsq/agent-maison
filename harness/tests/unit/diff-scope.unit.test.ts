// ============================================================================
// diff-scope.unit.test.ts — lite exit 接线契约单测（C1 feature-track，plan d4a7c1e8）
// ============================================================================
// 覆盖：
//   - classifyChangedFiles 分类三态（neutral / in_scope_hit / violation）
//   - resolveModulePathPrefixes 三级回退（contracts → catalog entry_file →
//     layer/name 目录存在性）与 unmapped fail-closed 证据
//   - [unit] 验收条目标记约定（unitAcceptanceEntries）
//   - resolveChainFromEvents 的 lite 事件链专项 case（cursor 四轮 review 建议）

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  classifyChangedFiles,
  isUnderLayerDir,
  resolveModulePathPrefixes,
} from '../../scripts/utils/diff-scope';
import { unitAcceptanceEntries } from '../../scripts/check-exit';
import { parseChangeDoc } from '../../scripts/check-change';
import { resolveChainFromEvents } from '../../scripts/utils/goal-progress';
import type { GoalRunEvent } from '../../scripts/utils/goal-runner-phase';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function eq(actual: unknown, expected: unknown, label: string): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${label}: expected ${b}, got ${a}`);
}

function tempRoot(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeCatalog(root: string, modulesYaml: string): void {
  fs.mkdirSync(path.join(root, 'doc'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'doc', 'module-catalog.yaml'),
    `schema_version: "1.0"\nmodules:\n${modulesYaml}`,
    'utf-8',
  );
}

const LAYERS = ['01-Product/', '02-Feature/', '03-Service/'];

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'classifyChangedFiles：层外 neutral / 命中 in_scope / 层内未命中 violation',
    run: () => {
      const cls = classifyChangedFiles(
        [
          'doc/features/foo/change.md', // 层外 → neutral
          'harness/scripts/check-exit.ts', // 层外 → neutral
          '02-Feature/ModA/src/main/ets/A.ets', // in_scope
          '02-Feature/ModB/src/main/ets/B.ets', // 层内未命中 → violation
        ],
        ['02-Feature/ModA/'],
        LAYERS,
      );
      eq(cls.neutralCount, 2, 'neutral');
      eq(cls.inScopeHits, ['02-Feature/ModA/src/main/ets/A.ets'], 'hits');
      eq(cls.violations, ['02-Feature/ModB/src/main/ets/B.ets'], 'violations');
    },
  },
  {
    name: 'classifyChangedFiles：反斜杠路径归一化后再分类',
    run: () => {
      const cls = classifyChangedFiles(
        ['02-Feature\\ModA\\src\\main\\ets\\A.ets'],
        ['02-Feature/ModA/'],
        LAYERS,
      );
      eq(cls.inScopeHits, ['02-Feature/ModA/src/main/ets/A.ets'], 'hits');
      eq(cls.violations, [], 'violations');
      if (!isUnderLayerDir('02-Feature\\X\\y.ets', LAYERS)) throw new Error('反斜杠层判定失败');
    },
  },
  {
    name: 'resolveModulePathPrefixes：contracts package_path 优先于 catalog',
    run: () => {
      const root = tempRoot('diff-scope-contracts-');
      try {
        writeCatalog(root, '  - { name: ModA, layer: 02-Feature, entry_file: "02-Feature/WrongDir/index.ets" }\n');
        const r = resolveModulePathPrefixes(root, ['ModA'], [
          { name: 'ModA', package_path: '02-Feature/ModA' },
        ]);
        eq(r.allowedPrefixes, ['02-Feature/ModA/'], 'prefix 应来自 contracts 而非 catalog');
        eq(r.unmapped, [], 'unmapped');
        eq(r.prefixByModule.get('ModA'), '02-Feature/ModA/', 'prefixByModule');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'resolveModulePathPrefixes：catalog entry_file dirname 兜底',
    run: () => {
      const root = tempRoot('diff-scope-catalog-');
      try {
        writeCatalog(root, '  - { name: ModA, layer: 02-Feature, entry_file: "02-Feature/ModA/index.ets" }\n');
        const r = resolveModulePathPrefixes(root, ['ModA']);
        eq(r.allowedPrefixes, ['02-Feature/ModA/'], 'prefix');
        eq(r.unmapped, [], 'unmapped');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'resolveModulePathPrefixes：缺 entry_file 时 layer/name 目录存在才回退，否则 unmapped',
    run: () => {
      const root = tempRoot('diff-scope-layerdir-');
      try {
        writeCatalog(
          root,
          '  - { name: ModOnDisk, layer: 02-Feature }\n  - { name: ModGhost, layer: 02-Feature }\n',
        );
        fs.mkdirSync(path.join(root, '02-Feature', 'ModOnDisk'), { recursive: true });
        const r = resolveModulePathPrefixes(root, ['ModOnDisk', 'ModGhost']);
        eq(r.allowedPrefixes, ['02-Feature/ModOnDisk/'], 'prefix：磁盘存在的才映射');
        eq(r.unmapped, ['ModGhost'], 'unmapped：目录不存在不猜');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'resolveModulePathPrefixes：catalog 整体缺失 → 全部 unmapped（fail-closed 证据）',
    run: () => {
      const root = tempRoot('diff-scope-nocatalog-');
      try {
        const r = resolveModulePathPrefixes(root, ['ModA']);
        eq(r.allowedPrefixes, [], 'prefix');
        eq(r.unmapped, ['ModA'], 'unmapped');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'unitAcceptanceEntries：[unit] 标记大小写不敏感、位置任意；无标记为空',
    run: () => {
      const doc = parseChangeDoc(
        [
          '## 意图', 'x', '## Scope', '```yaml', 'in_scope_modules: [ModA]', '```',
          '## 验收清单',
          '- [x] [unit] parseFoo 空输入返回 null',
          '- [ ] 页面可见（device 层）',
          '- [x] 边界溢出保护 [UNIT] 生效',
          '## 任务',
          '- [x] 实现 parseFoo',
        ].join('\n'),
      );
      const units = unitAcceptanceEntries(doc);
      eq(units.length, 2, 'unit 条目数');
      eq(units[0].text.includes('parseFoo'), true, '首条');
      const none = parseChangeDoc('## 验收清单\n- [x] 纯 device 验收\n');
      eq(unitAcceptanceEntries(none).length, 0, '无标记');
    },
  },
  {
    name: 'resolveChainFromEvents：lite 事件链在 workflow 全 phase 集下完整保留',
    run: () => {
      const events = [
        { type: 'run_start', chain: ['change', 'coding', 'exit'] },
      ] as unknown as GoalRunEvent[];
      const allowed = ['spec', 'plan', 'coding', 'review', 'ut', 'testing', 'change', 'exit'];
      eq(
        resolveChainFromEvents(events, ['coding'], allowed),
        ['change', 'coding', 'exit'],
        'lite 链应完整保留',
      );
      // 反证：legacy 缺省集会把 lite-only phase 滤掉——这就是调用层必须传
      // workflow 派生 allowedPhases 的原因（三轮 review 接线点）
      eq(
        resolveChainFromEvents(events, ['coding']),
        ['coding'],
        'legacy 缺省集滤掉 change/exit（文档化既有约束）',
      );
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
      results.push({ name: c.name, ok: false, error: (err as Error).message });
    }
  }
  return results;
}
