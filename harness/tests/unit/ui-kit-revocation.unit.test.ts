// ============================================================================
// ui-kit-revocation.unit.test.ts — 强制 Maison UI kit 撤销的**精确删除门槛**
// （plan e6b3f8d2 t3 + t7）
// ----------------------------------------------------------------------------
// 为什么不是裸 `maison` 全匹配：`MaisonDeviceUnlock:<serial>` 凭据目标、`~/.maison/`
// 信任注册表、`agentmaison://` schema、`maison:placeholder` 素材能力都是**须保留的
// 合法命名空间**——裸匹配不可执行。本套改用两条精确门槛：
//   ①「被删文件/目录不存在」断言；
//   ② **token 级**清单零命中（`blocks.json` 只查原 kit 精确路径，不禁通用文件名）。
//
// 扫描范围刻意排除：`openspec/changes/archive/**`（归档不回写）、`.cursor/plans/**`
// （历史 plan 是决策档案）、`dist/**`（已构建发布件，下次 release:pack 重生成）、
// `node_modules`、`.git`。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import type { UnitCaseResult } from '../run-unit';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

function run(results: UnitCaseResult[], name: string, fn: () => void): void {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, error: (err as Error).stack ?? (err as Error).message });
  }
}
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

/** 被删的文件/目录（相对仓库根）——存在即红。 */
const DELETED_PATHS: readonly string[] = [
  'profiles/hmos-app/ui-kit',
  'profiles/hmos-app/ui-kit/blocks.json',
  'profiles/hmos-app/harness/ui-kit-scaffolder.ts',
  'profiles/hmos-app/harness/ui-kit-conformance-check.ts',
  'profiles/hmos-app/harness/ui-kit-anchors.ts',
  'profiles/hmos-app/harness/tests/unit/ui-kit.unit.test.ts',
  'openspec/changes/blind-visual-hardening/specs/blind-ui-kit',
  'openspec/changes/blind-visual-hardening/specs/blind-ui-kit/spec.md',
];

/**
 * token 级零命中清单。
 * 每项要么是被删机制的唯一标识符，要么是被删入口名——出现即说明有残留引用。
 */
const FORBIDDEN_TOKENS: readonly string[] = [
  // ② 目标目录机制
  'ui_kit_target_dir',
  'maison_ui_kit',
  // ① vendoring 入口
  'ui-kit:scaffold',
  'ui-kit:placeholders',   // 已改名 asset:placeholders
  'ui-kit-anchors',
  'ui-kit-conformance-check',
  'ui-kit-scaffolder',
  // ⑥ OpenSpec capability
  'blind-ui-kit',
  // ③ 缺陷分类与 check 族
  'scaffold_contract_drift',
  'ui_kit_conformance',
  'ui_kit_source_conformance',
  'ui_kit_runtime_conformance',
  'ui_kit_declaration_required',
  'ui_kit_not_materialized',
  'ui_kit_target_unresolved',
  'BLOCK_SEMANTIC_NODES',
  'buildInstanceAnchor',
  'normalizeRuntimeAnchor',
  'loadAnchorSuffixContract',
  'anchor_suffix_patterns',
  // 九个 Maison 组件名
  'MaisonNavBar',
  'MaisonListCard',
  'MaisonListRow',
  'MaisonBottomSheetScaffold',
  'MaisonPrimaryButton',
  'MaisonSelector',
  'MaisonResultState',
  'MaisonSmsCodeField',
  'MaisonDetailSection',
];

/**
 * 允许保留该 token 的文件（**唯一豁免**：读侧历史兼容夹具）。
 * goal-runner 的 actionable 白名单必须证明"历史 evidence 里残留的已撤销分类不再驱动回修"，
 * 该断言只能用那个字面量构造夹具。
 */
const TOKEN_ALLOWLIST: Readonly<Record<string, readonly string[]>> = {
  scaffold_contract_drift: ['harness/tests/unit/device-test-backtrack.unit.test.ts'],
};

/**
 * **变更公告豁免**：这些文档的职责就是「说清哪些机制被删了、存量怎么迁」——它们必须
 * 写出被删机制的原名，否则宿主根本无从对照迁移。豁免的是"提到名字"，不是"仍在使用"：
 * 这些文件里不存在任何可执行引用（无 import / 无 npm script / 无 check 注册）。
 */
const DOC_ALLOWLIST: readonly string[] = [
  'MIGRATION.md',
  'openspec/changes/blind-visual-hardening/proposal.md',
  'openspec/changes/blind-visual-hardening/design.md',
  'openspec/changes/blind-visual-hardening/tasks.md',
  'profiles/hmos-app/harness/tests/fixtures/device-attribution/README.md',
];

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist']);
const SKIP_REL_PREFIXES = [
  'openspec/changes/archive/',   // 归档 change 不回写
  '.cursor/plans/',              // 历史 plan 是决策档案
  'harness/reports/',            // 运行期产物（.gitignore 在案），非源码
  'harness/state/',              // 运行期状态
];
/** 本文件自己就是 token 清单，必然命中——排除。 */
const SELF_REL = 'harness/tests/unit/ui-kit-revocation.unit.test.ts';

const TEXT_EXT = new Set([
  '.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.yaml', '.yml', '.md', '.ets', '.txt',
]);

function walkTextFiles(absDir: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(absDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const abs = path.join(absDir, e.name);
    const rel = path.relative(REPO_ROOT, abs).split(path.sep).join('/');
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      if (SKIP_REL_PREFIXES.some(p => `${rel}/`.startsWith(p))) continue;
      walkTextFiles(abs, out);
      continue;
    }
    if (!e.isFile()) continue;
    if (SKIP_REL_PREFIXES.some(p => rel.startsWith(p))) continue;
    if (rel === SELF_REL) continue;
    if (!TEXT_EXT.has(path.extname(e.name))) continue;
    out.push(rel);
  }
}

let cachedFiles: string[] | null = null;
function activeTreeFiles(): string[] {
  if (!cachedFiles) {
    const out: string[] = [];
    walkTextFiles(REPO_ROOT, out);
    cachedFiles = out;
  }
  return cachedFiles;
}

export function runAll(): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];

  run(results, 't3 精确删除门槛①：被删文件/目录不存在', () => {
    const still = DELETED_PATHS.filter(rel => fs.existsSync(path.join(REPO_ROOT, rel)));
    assert(still.length === 0, `以下已撤销机制的文件/目录仍在：\n  ${still.join('\n  ')}`);
  });

  run(results, 't3 精确删除门槛②：token 级清单在 active tree 零命中', () => {
    const files = activeTreeFiles();
    const hits: string[] = [];
    for (const rel of files) {
      let text: string;
      try {
        text = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf-8');
      } catch {
        continue;
      }
      if (DOC_ALLOWLIST.includes(rel)) continue;
      for (const token of FORBIDDEN_TOKENS) {
        if (!text.includes(token)) continue;
        if ((TOKEN_ALLOWLIST[token] ?? []).includes(rel)) continue;
        hits.push(`${rel}: ${token}`);
      }
    }
    assert(hits.length === 0, `已撤销机制的 token 仍有引用：\n  ${hits.join('\n  ')}`);
  });

  run(results, 't3 精确删除门槛③：blocks.json 只查原 kit 精确路径（不禁通用文件名）', () => {
    // 通用 `blocks.json` 这个文件名本身合法——只有原 kit 路径与对它的引用才是残留。
    const kitBlocksRel = 'profiles/hmos-app/ui-kit/blocks.json';
    assert(!fs.existsSync(path.join(REPO_ROOT, kitBlocksRel)), `${kitBlocksRel} 仍在`);
    const hits = activeTreeFiles().filter(rel => {
      if (DOC_ALLOWLIST.includes(rel)) return false;
      let text: string;
      try {
        text = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf-8');
      } catch {
        return false;
      }
      return text.includes("'..', 'ui-kit', 'blocks.json'")
        || text.includes('ui-kit/blocks.json')
        || text.includes('ui-kit\\\\blocks.json');
    });
    assert(hits.length === 0, `仍有对原 kit blocks 清单路径的引用：\n  ${hits.join('\n  ')}`);
  });

  run(results, 't3 合法命名空间**不得**被误删（裸 maison 匹配不可执行的实证）', () => {
    const files = activeTreeFiles();
    const survives = (needle: string): boolean =>
      files.some(rel => {
        try {
          return fs.readFileSync(path.join(REPO_ROOT, rel), 'utf-8').includes(needle);
        } catch {
          return false;
        }
      });
    for (const keep of ['MaisonDeviceUnlock', 'agentmaison://', 'maison:placeholder']) {
      assert(survives(keep), `合法命名空间 ${keep} 被误删——本轮只删 kit，不删凭据/schema/素材能力`);
    }
  });

  run(results, 't3 变更公告豁免不得空转：MIGRATION 必须写清 kit 撤销与迁移动作', () => {
    const mig = fs.readFileSync(path.join(REPO_ROOT, 'MIGRATION.md'), 'utf-8');
    for (const needle of ['撤销强制 Maison UI kit', 'asset:placeholders', 'contract_component']) {
      assert(mig.includes(needle), `MIGRATION.md 缺迁移要点「${needle}」——豁免只给真正写了迁移的文档`);
    }
  });

  run(results, 't3① npm 入口：ui-kit 两条脚本已删/改名，素材占位能力保留', () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, 'harness', 'package.json'), 'utf-8'),
    ) as { scripts?: Record<string, string> };
    const scripts = pkg.scripts ?? {};
    assert(!('ui-kit:scaffold' in scripts), 'scaffold 入口须删除');
    assert(!('ui-kit:placeholders' in scripts), '旧占位入口名须删除');
    assert(
      (scripts['asset:placeholders'] ?? '').includes('asset-placeholder-cli.ts'),
      `素材占位能力须保留并改名为 asset:placeholders：${JSON.stringify(scripts['asset:placeholders'])}`,
    );
  });

  run(results, 't3② framework.config paths 不再有 kit 目标目录字段', () => {
    const cfg = fs.readFileSync(path.join(REPO_ROOT, 'harness', 'config.ts'), 'utf-8');
    assert(!/ui_kit_target_dir/.test(cfg), 'FrameworkPaths 仍声明 kit 目标目录');
  });

  return results;
}
