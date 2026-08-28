/**
 * plan c7e2a9d4 T3 — contracts 统一解析边界的**窄**架构护栏。
 *
 * 只管一条禁令：`contracts.navigation` 的原始字段只能在统一解析边界模块
 * （`harness/scripts/utils/contract-reference-closure.ts`）内被认识；边界之外的生产代码
 * （root `harness/scripts` + 每个 profile 的 `harness` 目录）一律不得裸读——包括 `as Record<…>` 之后
 * 取 `config_files` 这类 token。下游消费者只能经纯 selector
 * `selectContractReferencePaths(closure, 'navigation.config_files')` 消费统一解析产出。
 *
 * **明确非目标**：不推导字段类型、不解析解构/别名/helper 链、不覆盖 navigation 之外的
 * contracts 段。那会把护栏养成影子解析器（本 plan 要治的正是"一个事实两处解释"）；
 * 禁令只认「边界外源码里出现该读取形态」。
 */
import * as fs from 'fs';
import * as path from 'path';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

interface Case { name: string; run: () => void; }

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const HARNESS_SCRIPTS = path.join(REPO_ROOT, 'harness', 'scripts');
const PROFILES_DIR = path.join(REPO_ROOT, 'profiles');

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/**
 * 禁令形态：
 *  - `.navigation` 属性访问（`contracts.navigation` / `spec.contracts?.navigation` / 解构前的取值）；
 *  - `config_files` token（`as Record<string, unknown>` 之后的裸读典型形态）。
 * `navigation_frame` 等 ui-spec 词不命中（`\b` 之后是 `_`，属同一 word）。
 */
const BARE_READ_PATTERN = /\.\s*navigation\b|\bconfig_files\b/;

/**
 * **带引号**的 canonical reference kind（`'navigation.config_files'` / 反引号版）不算裸读：
 * 那是经边界 API 消费时的 kind 实参，以及面向人的诊断/指引措辞。裸读形态
 * （`contracts.navigation.config_files`、`nav?.config_files`）不带引号，仍被抓。
 */
const QUOTED_CANONICAL_KIND = /(['"`])navigation\.config_files\1/g;

/**
 * 具名豁免（每条 file:line + 理由）。加条目 = 承认边界被扩大，须在 review 说明。
 */
const BOUNDARY_EXEMPTIONS: ReadonlyArray<{ file: string; reason: string }> = [
  {
    // harness/scripts/utils/contract-reference-closure.ts:1 —— 统一解析边界模块本体
    file: 'harness/scripts/utils/contract-reference-closure.ts',
    reason: '统一解析边界本体：唯一被允许认识 contracts.navigation 字段名的地方（含 selector 的 kind 常量）。',
  },
  {
    // harness/scripts/utils/types.ts:243 —— ContractNavigationSpec 的类型声明
    file: 'harness/scripts/utils/types.ts',
    reason: '类型声明面（ContractNavigationSpec / ContractFileReferenceKind），是形状定义而非取值读取。',
  },
];

const EXEMPT_FILES: ReadonlySet<string> = new Set(BOUNDARY_EXEMPTIONS.map(item => item.file));

/** 注释行不算读取形态（提到 config_files 的说明性注释不应触发）。 */
function stripComments(raw: string): string {
  let inBlock = false;
  return raw
    .split('\n')
    .map(line => {
      const trimmed = line.trimStart();
      if (inBlock) {
        if (trimmed.includes('*/')) inBlock = false;
        return '';
      }
      if (trimmed.startsWith('/*')) {
        if (!trimmed.includes('*/')) inBlock = true;
        return '';
      }
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) return '';
      return line;
    })
    .join('\n');
}

interface ScanInput { name: string; text: string }

export function scanBareContractsNavigationReads(files: ScanInput[]): string[] {
  const offenders: string[] = [];
  for (const file of files) {
    if (EXEMPT_FILES.has(file.name)) continue;
    const body = stripComments(file.text);
    const lines = body.split('\n');
    lines.forEach((line, index) => {
      const scanned = line.replace(QUOTED_CANONICAL_KIND, '');
      if (BARE_READ_PATTERN.test(scanned)) offenders.push(`${file.name}:${index + 1}`);
    });
  }
  return offenders;
}

function collectTsFiles(root: string, predicate: (absolute: string) => boolean): string[] {
  if (!fs.existsSync(root)) return [];
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'vendor' || entry.name === 'dist') continue;
        walk(absolute);
        continue;
      }
      if (!entry.name.endsWith('.ts') || entry.name.endsWith('.d.ts')) continue;
      if (/\.test\.ts$/.test(entry.name)) continue;
      if (predicate(absolute)) out.push(absolute);
    }
  };
  walk(root);
  return out.sort();
}

/** 生产扫描面：root harness 脚本 + 每个 profile 的 harness 目录（排除测试/fixture）。 */
function productionSources(): ScanInput[] {
  const files = [
    ...collectTsFiles(HARNESS_SCRIPTS, () => true),
    ...(fs.existsSync(PROFILES_DIR)
      ? fs.readdirSync(PROFILES_DIR, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .flatMap(entry => collectTsFiles(
          path.join(PROFILES_DIR, entry.name, 'harness'),
          absolute => !absolute.split(path.sep).includes('fixtures'),
        ))
      : []),
  ];
  return files.map(absolute => ({
    name: path.relative(REPO_ROOT, absolute).replace(/\\/g, '/'),
    text: fs.readFileSync(absolute, 'utf8'),
  }));
}

const cases: Case[] = [
  {
    name: 'c7e2a9d4 T3 禁令：统一解析边界之外的生产代码不得裸读 contracts.navigation 原始字段',
    run: () => {
      const sources = productionSources();
      assert(sources.length > 50, `扫描面缩水（只发现 ${sources.length} 个源文件），护栏可能已空转`);
      const offenders = scanBareContractsNavigationReads(sources);
      assert(
        offenders.length === 0,
        'contracts.navigation 原始字段（含 config_files token）只能在统一解析边界内读取；\n' +
        '下游请改用 selectContractReferencePaths(closure, \'navigation.config_files\')。\n' +
        `违规位置：\n  ${offenders.join('\n  ')}`,
      );
    },
  },
  {
    name: 'c7e2a9d4 T3 自测：注入违规样本必须被抓（防空扫描器）',
    run: () => {
      const caught = scanBareContractsNavigationReads([
        {
          name: 'profiles/demo/harness/coding-host-rules.ts',
          text: 'const nav = contracts?.navigation as Record<string, unknown> | undefined;',
        },
        {
          name: 'profiles/demo/harness/other.ts',
          text: 'const files = (nav?.config_files ?? []) as string[];',
        },
        {
          name: 'harness/scripts/check-demo.ts',
          text: 'if (ctx.featureSpec.contracts.navigation) { return []; }',
        },
        {
          // 不带引号的链式裸读：不得因「引号版 kind 豁免」被洗白
          name: 'harness/scripts/check-demo2.ts',
          text: 'const cf = ctx.featureSpec.contracts.navigation.config_files ?? [];',
        },
        {
          name: 'harness/scripts/check-demo3.ts',
          text: "const cf = (nav as Record<string, unknown>)['config_files'];",
        },
      ]);
      assert(caught.length === 5, `扫描器漏抓：${JSON.stringify(caught)}`);
    },
  },
  {
    name: 'c7e2a9d4 T3 自测：合规消费与注释提及不得误伤，豁免表仍然生效',
    run: () => {
      const innocent = scanBareContractsNavigationReads([
        {
          name: 'profiles/demo/harness/coding-host-rules.ts',
          text: "const paths = selectContractReferencePaths(closure, 'navigation.config_files');",
        },
        {
          name: 'profiles/demo/harness/ui.ts',
          text: "if (element.type === 'navigation_frame') return true;",
        },
        {
          // 面向人的诊断措辞里指名 canonical 字段（反引号 markdown 形态）不算裸读
          name: 'profiles/demo/harness/diagnostics.ts',
          text: "const hint = '请在 `navigation.config_files` 声明注册配置文件。';",
        },
        {
          name: 'harness/scripts/check-demo.ts',
          text: '// 说明：config_files 由统一解析边界产出，本文件只消费 selector 结果。',
        },
        {
          name: 'harness/scripts/check-demo2.ts',
          text: '/*\n * contracts.navigation 的字段名只在边界模块出现。\n */\nexport const x = 1;',
        },
      ]);
      assert(innocent.length === 0, `合规形态被误伤：${JSON.stringify(innocent)}`);

      const exempted = scanBareContractsNavigationReads([
        {
          name: 'harness/scripts/utils/contract-reference-closure.ts',
          text: 'const navigation = contracts.navigation as unknown;',
        },
        {
          name: 'harness/scripts/utils/types.ts',
          text: '  config_files?: string[];',
        },
      ]);
      assert(exempted.length === 0, `豁免表失效：${JSON.stringify(exempted)}`);
    },
  },
  {
    name: 'c7e2a9d4 T3 豁免表自检：每条豁免文件必须真实存在且带理由',
    run: () => {
      for (const item of BOUNDARY_EXEMPTIONS) {
        assert(item.reason.trim().length > 0, `豁免缺理由：${item.file}`);
        assert(
          fs.existsSync(path.join(REPO_ROOT, item.file)),
          `豁免指向不存在的文件（应随代码删除一并清理）：${item.file}`,
        );
      }
    },
  },
];

export function runAll(): UnitCaseResult[] {
  return cases.map(testCase => {
    try {
      testCase.run();
      return { name: testCase.name, ok: true };
    } catch (error) {
      return { name: testCase.name, ok: false, error: (error as Error).stack ?? String(error) };
    }
  });
}
