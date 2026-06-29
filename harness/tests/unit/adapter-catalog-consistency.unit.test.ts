// adapter-catalog-consistency.unit.test.ts — adapter catalog lib + 锚点门禁单测

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  AdapterCatalogError,
  ADAPTER_CANDIDATES_ANCHOR_END,
  ADAPTER_CANDIDATES_ANCHOR_START,
  buildAdapterCatalogOrThrow,
  checkAdapterCatalogConsistency,
  listAvailableAdapters,
} from '../../scripts/utils/adapter-catalog';
import { probeInitTaskPlan } from '../../scripts/utils/init-task-planner';
import { parseCommandsTargetDir } from '../../scripts/utils/instance-skill-bridge';
import { detectRepoLayout } from '../../repo-layout';
import { externalStandaloneLayout } from '../utils/layout-test-helper';
import type { UnitCaseResult } from '../run-unit';

const { projectRoot: REPO_ROOT, frameworkRoot: REPO_FRAMEWORK_ROOT } = detectRepoLayout(__dirname);

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function copyDirSync(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name);
    const d = path.join(dest, ent.name);
    if (ent.isDirectory()) copyDirSync(s, d);
    else fs.copyFileSync(s, d);
  }
}

function writeMinimalAdapter(root: string, name: string, adapterName = name): void {
  const dir = path.join(root, 'agents', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'adapter.yaml'),
    `adapter_name: ${adapterName}\nagent_entry_file:\n  target_path: AGENTS.md\n`,
    'utf-8',
  );
}

function writeMinimalRegistry(root: string, options: Array<{ value: string; label: string; portable: string }>): void {
  const regDir = path.join(root, 'skills', 'reference');
  fs.mkdirSync(regDir, { recursive: true });
  const lines = [
    'schema_version: "2.0"',
    'entries:',
    '  - id: init.materialized_adapters',
    '    skill: "framework-init"',
    '    class: artifact_checkbox',
    '    portable_menu: "候选见 S1 adapter_catalog；须至少 1 项"',
    '    options:',
  ];
  for (const o of options) {
    lines.push(`      - value: ${o.value}`);
    lines.push(`        label: "${o.label}"`);
    lines.push(`        portable: "${o.portable}"`);
  }
  fs.writeFileSync(path.join(regDir, 'confirmation-registry.yaml'), lines.join('\n') + '\n', 'utf-8');
}

function writeAnchoredMenuFile(root: string, relParts: string[], inner: string): void {
  const abs = path.join(root, ...relParts);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const content = [
    '# test',
    ADAPTER_CANDIDATES_ANCHOR_START,
    inner,
    ADAPTER_CANDIDATES_ANCHOR_END,
    '',
  ].join('\n');
  fs.writeFileSync(abs, content, 'utf-8');
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'listAvailableAdapters: 动态等于磁盘 agents/ 成员（不写死 6）',
    run: () => {
      const { names, issues } = listAvailableAdapters(REPO_FRAMEWORK_ROOT);
      assert(issues.length === 0, `disk issues: ${issues.map(i => i.message).join('; ')}`);
      const agentsDir = path.join(REPO_FRAMEWORK_ROOT, 'agents');
      const dirs = fs.readdirSync(agentsDir, { withFileTypes: true })
        .filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'shared')
        .map(e => e.name)
        .filter(d => fs.existsSync(path.join(agentsDir, d, 'adapter.yaml')))
        .sort();
      assert(names.length === dirs.length, `names=${names.length} dirs=${dirs.length}`);
      assert(names.every(n => dirs.includes(n)), 'names must match disk dirs with adapter.yaml');
      assert(names.length >= 6, 'expected at least 6 adapters in repo');
    },
  },
  {
    name: 'listAvailableAdapters: name≠dir 产生 issue',
    run: () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-name-mismatch-'));
      writeMinimalAdapter(tmp, 'foo', 'bar');
      const { issues } = listAvailableAdapters(tmp);
      assert(issues.some(i => i.message.includes('与目录名不一致')), issues.map(i => i.message).join('; '));
    },
  },
  {
    name: 'buildAdapterCatalogOrThrow: 正例 join label/portable',
    run: () => {
      const catalog = buildAdapterCatalogOrThrow(REPO_FRAMEWORK_ROOT);
      const { names } = listAvailableAdapters(REPO_FRAMEWORK_ROOT);
      assert(catalog.length === names.length, 'catalog length mismatch');
      for (const entry of catalog) {
        assert(typeof entry.label === 'string' && entry.label.length > 0, `missing label for ${entry.value}`);
        assert(entry.portable === entry.value, `portable should match value for ${entry.value}`);
      }
    },
  },
  {
    name: 'buildAdapterCatalogOrThrow: registry 缺项 throw',
    run: () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-missing-reg-'));
      writeMinimalAdapter(tmp, 'onlyone');
      writeMinimalRegistry(tmp, []);
      let threw = false;
      try {
        buildAdapterCatalogOrThrow(tmp);
      } catch (e) {
        threw = e instanceof AdapterCatalogError;
        assert((e as AdapterCatalogError).issues.some(m => m.includes('缺少磁盘 adapter')), (e as Error).message);
      }
      assert(threw, 'expected throw');
    },
  },
  {
    name: 'probeInitTaskPlan(project): adapter_catalog == OrThrow',
    run: () => {
      const expected = buildAdapterCatalogOrThrow(REPO_FRAMEWORK_ROOT);
      const plan = probeInitTaskPlan({ projectRoot: REPO_ROOT, scope: 'project' });
      assert(Array.isArray(plan.adapter_catalog), 'adapter_catalog missing');
      assert(JSON.stringify(plan.adapter_catalog) === JSON.stringify(expected), 'catalog mismatch');
    },
  },
  {
    name: 'probeInitTaskPlan(personal): 不填 adapter_catalog',
    run: () => {
      const plan = probeInitTaskPlan({ projectRoot: REPO_ROOT, scope: 'personal' });
      assert(plan.adapter_catalog === undefined, 'personal should not set adapter_catalog');
    },
  },
  {
    name: 'checkAdapterCatalogConsistency: 源码根 PASS',
    run: () => {
      const results = checkAdapterCatalogConsistency(REPO_FRAMEWORK_ROOT);
      const fails = results.filter(r => r.status === 'FAIL');
      assert(fails.length === 0, fails.map(f => `${f.id}: ${f.details}`).join('; '));
    },
  },
  {
    name: 'checkAdapterCatalogConsistency: 锚点段 ≥2 硬编码名 FAIL',
    run: () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-hardcode-'));
      copyDirSync(path.join(REPO_FRAMEWORK_ROOT, 'agents'), path.join(tmp, 'agents'));
      copyDirSync(path.join(REPO_FRAMEWORK_ROOT, 'skills'), path.join(tmp, 'skills'));
      writeAnchoredMenuFile(
        tmp,
        ['skills', 'project', 'framework-init', 'SKILL.md'],
        'bad: claude and cursor hardcoded',
      );
      const results = checkAdapterCatalogConsistency(tmp);
      assert(
        results.some(r => r.id === 'menu_hardcoded_adapters' && r.status === 'FAIL'),
        results.map(r => `${r.id}:${r.status}`).join(', '),
      );
    },
  },
  {
    name: 'checkAdapterCatalogConsistency: registry options / README 参考表不误报',
    run: () => {
      const results = checkAdapterCatalogConsistency(REPO_FRAMEWORK_ROOT);
      const falsePos = results.filter(
        r => r.status === 'FAIL' && (
          r.details.includes('产物速查')
          || r.details.includes('第一版 adapter')
          || r.details.includes('options 块')
        ),
      );
      assert(falsePos.length === 0, falsePos.map(f => f.details).join('; '));
      const readme = fs.readFileSync(path.join(REPO_FRAMEWORK_ROOT, 'agents', 'README.md'), 'utf-8');
      assert(readme.includes('claude') && readme.includes('cursor'), 'README reference table should list adapters');
    },
  },
  {
    name: 'G6 cursor command 整套：与 claude slash 集对等 + 薄入口(非 claude 正文) + goal-mode 带 RESOLVED_ADAPTER：cursor',
    run: () => {
      const adapterYaml = fs.readFileSync(
        path.join(REPO_FRAMEWORK_ROOT, 'agents', 'cursor', 'adapter.yaml'),
        'utf-8',
      );
      assert(
        parseCommandsTargetDir(adapterYaml) === '.cursor/commands',
        'cursor adapter 应声明 commands.target_dir=.cursor/commands',
      );
      const cursorDir = path.join(REPO_FRAMEWORK_ROOT, 'agents', 'cursor', 'templates', 'commands');
      const claudeDir = path.join(REPO_FRAMEWORK_ROOT, 'agents', 'claude', 'templates', 'commands');
      const listMd = (d: string) => fs.readdirSync(d).filter(f => f.endsWith('.md')).sort();
      const claudeCmds = listMd(claudeDir);
      const cursorCmds = listMd(cursorDir);
      // 能力对等：cursor 的 slash command 集须与 claude 一致（否则 Cursor 用户缺 /spec /plan 等原生命令）
      assert(
        JSON.stringify(cursorCmds) === JSON.stringify(claudeCmds),
        `cursor command 集应与 claude 对等：cursor=${cursorCmds.join(',')} claude=${claudeCmds.join(',')}`,
      );
      for (const f of cursorCmds) {
        const body = fs.readFileSync(path.join(cursorDir, f), 'utf-8');
        assert(!/RESOLVED_ADAPTER）\*{0,2}[：:]\s*claude/.test(body), `${f} 不得声明 claude 身份`);
        // 薄入口：不得逐字复用 claude 模板正文（避免双源分叉/带回 claude 身份）
        assert(fs.readFileSync(path.join(claudeDir, f), 'utf-8') !== body, `${f} 不得逐字复用 claude 模板正文`);
      }
      // 只有 goal-mode 须显式声明 cursor 运行身份（唯一携带 RESOLVED_ADAPTER 的 slash）
      const gm = fs.readFileSync(path.join(cursorDir, 'goal-mode.md'), 'utf-8');
      assert(/RESOLVED_ADAPTER）\*{0,2}[：:]\s*cursor/.test(gm), 'goal-mode 须声明 RESOLVED_ADAPTER：cursor');
    },
  },
  {
    name: 'checkAdapterCatalogConsistency: external frameworkRoot 双根',
    run: () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-ext-root-'));
      const layout = externalStandaloneLayout(tmp, REPO_FRAMEWORK_ROOT);
      const results = checkAdapterCatalogConsistency(layout.frameworkRoot);
      const fails = results.filter(r => r.status === 'FAIL');
      assert(fails.length === 0, fails.map(f => f.details).join('; '));
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
  const r = runAll();
  for (const x of r) {
    console.log(x.ok ? `  [PASS] ${x.name}` : `  [FAIL] ${x.name}: ${x.error}`);
  }
  process.exit(r.some(x => !x.ok) ? 1 : 0);
}
