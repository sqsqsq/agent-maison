// ============================================================================
// init-eol.unit.test.ts — framework-init 文本模板 EOL 去噪回归
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { __testing } from '../../scripts/check-init';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

const FRAMEWORK_ROOT = path.resolve(__dirname, '..', '..', '..');

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function assertEq<T>(actual: T, expected: T, label: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${label}\n    expected: ${e}\n    actual:   ${a}`);
  }
}

function toCrLf(text: string): string {
  return __testing.normalizeEol(text).replace(/\n/g, '\r\n');
}

function withOppositeEol(text: string): string {
  const normalized = __testing.normalizeEol(text);
  return text.includes('\r\n') ? normalized : toCrLf(text);
}

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
}

function writeConfig(root: string): void {
  writeFile(
    path.join(root, 'framework.config.json'),
    JSON.stringify({
      schema_version: '1.0.0',
      project_name: 'init-eol-unit',
      project_type: 'app',
      agent_adapter: 'claude',
      architecture: {
        outer_layers: [{
          id: '01-Product',
          name: 'Product',
          order: 1,
          can_depend_on: [],
          intra_layer_deps: 'forbid',
        }],
        module_inner_layers: ['shared', 'data', 'domain', 'presentation'],
        inner_dependency_direction: 'upward',
        cross_module_exports_file: 'Index.ets',
      },
      paths: {
        features_dir: 'doc/features',
        module_catalog: 'doc/module-catalog.yaml',
        glossary: 'doc/glossary.yaml',
        glossary_seed: 'doc/glossary-seed.txt',
        architecture_md: 'doc/architecture.md',
      },
      toolchain: {
        devEcoStudio: {
          installPath: '',
          hvigorBin: '',
        },
      },
    }, null, 2),
  );
}

function withTmpProject<T>(fn: (root: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'init-eol-'));
  try {
    writeConfig(dir);
    return fn(dir);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

function makeInspectorEnv(root: string) {
  const adapter = __testing.loadAdapter('claude');
  const cfg = __testing.loadRawFrameworkConfig(root);
  return {
    projectRoot: root,
    cfg,
    adapter,
    renderEnv: __testing.buildRenderEnv(cfg, adapter),
  };
}

interface Case { name: string; run: () => void; }

const cases: Case[] = [
  {
    name: 'init eol: adapter templates 仅 CRLF/LF 不同 → EMPTY',
    run: () => withTmpProject(root => {
      const adapter = __testing.loadAdapter('claude');
      for (const f of adapter.templateFiles) {
        const template = fs.readFileSync(path.join(FRAMEWORK_ROOT, f.templateRel), 'utf-8');
        writeFile(path.join(root, f.targetRel), withOppositeEol(template));
      }

      const inspection = __testing.inspect03(makeInspectorEnv(root));
      assertEq(inspection.status, 'EMPTY', 'adapter templates 仅 EOL 差异不应进入 POPULATED');
      assertEq(inspection.planned_strategy, '保留现有文件（不重写）', 'EOL-only adapter templates 不应触发重拷贝');
      assert(inspection.diagnosis.includes('仅换行符不同'), '诊断应说明 EOL-only 已忽略');
    }),
  },
  {
    name: 'init eol: adapter templates 内容真实不同 → POPULATED',
    run: () => withTmpProject(root => {
      const adapter = __testing.loadAdapter('claude');
      for (const f of adapter.templateFiles) {
        const template = fs.readFileSync(path.join(FRAMEWORK_ROOT, f.templateRel), 'utf-8');
        const content = f.targetRel.endsWith('coding.md')
          ? `${withOppositeEol(template)}\r\nreal content drift\r\n`
          : withOppositeEol(template);
        writeFile(path.join(root, f.targetRel), content);
      }

      const inspection = __testing.inspect03(makeInspectorEnv(root));
      assertEq(inspection.status, 'POPULATED', '真实内容差异仍必须进入 POPULATED');
      assert(inspection.diff_summary?.includes('[D] .claude/commands/coding.md') === true, 'diff_summary 应列出真实漂移文件');
    }),
  },
  {
    name: 'init eol: rendered entry markdown 仅 CRLF/LF 不同 → EMPTY',
    run: () => withTmpProject(root => {
      const env = makeInspectorEnv(root);
      const template = fs.readFileSync(path.join(FRAMEWORK_ROOT, 'templates/AGENTS.md.template'), 'utf-8');
      const rendered = __testing.renderTemplate(template, env.renderEnv!);
      writeFile(path.join(root, 'CLAUDE.md'), withOppositeEol(rendered));

      const inspection = __testing.inspect02(env);
      assertEq(inspection.status, 'EMPTY', 'entry file 仅 EOL 差异不应要求用户确认');
      assertEq(inspection.planned_strategy, '保留现有文件（不重写）', 'EOL-only entry file 不应触发重写');
      assert(inspection.diagnosis.includes('仅换行符不同'), '诊断应说明 entry file EOL-only 已忽略');
    }),
  },
  {
    name: 'init eol: rendered architecture skeleton 仅 CRLF/LF 不同 → EMPTY',
    run: () => withTmpProject(root => {
      const env = makeInspectorEnv(root);
      const template = fs.readFileSync(
        path.join(FRAMEWORK_ROOT, 'skills/00-framework-init/templates/architecture.md.skeleton.md'),
        'utf-8',
      );
      const rendered = __testing.renderTemplate(template, env.renderEnv!);
      writeFile(path.join(root, 'doc/architecture.md'), withOppositeEol(rendered));

      const inspection = __testing.inspect04(env);
      assertEq(inspection.status, 'EMPTY', 'architecture skeleton 仅 EOL 差异不应进入 POPULATED');
      assertEq(inspection.planned_strategy, '保留现有文件（不重写）', 'EOL-only architecture 不应触发重写');
    }),
  },
  {
    name: 'init eol: glossary seed 仅 CRLF/LF 不同 → EMPTY',
    run: () => withTmpProject(root => {
      const template = fs.readFileSync(
        path.join(FRAMEWORK_ROOT, 'skills/00-framework-init/templates/glossary-seed.skeleton.txt'),
        'utf-8',
      );
      writeFile(path.join(root, 'doc/glossary-seed.txt'), withOppositeEol(template));

      const inspection = __testing.inspect07(makeInspectorEnv(root));
      assertEq(inspection.status, 'EMPTY', 'glossary seed 仅 EOL 差异不应进入 POPULATED');
    }),
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
