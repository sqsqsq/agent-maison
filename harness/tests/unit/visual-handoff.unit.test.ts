// ============================================================================
// visual-handoff.unit.test.ts — check-prd Visual Handoff 白盒回归
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { clearFrameworkConfigCache, loadFrameworkConfig } from '../../config';
import { loadResolvedProfile } from '../../profile-loader';
import { checkVisualHandoff } from '../../scripts/check-prd';
import type { CheckContext, PhaseRuleSpec } from '../../scripts/utils/types';
import { resolveAuthoritativePath } from '../../scripts/utils/visual-source-resolver';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function stubPhaseRule(): PhaseRuleSpec {
  return {
    phase: 'prd',
    structure_checks: {
      visual_handoff: { description: 'Visual Handoff（脚本）' },
    },
  } as unknown as PhaseRuleSpec;
}

function baseCtx(root: string, o: Partial<CheckContext> = {}): CheckContext {
  clearFrameworkConfigCache();
  const fw = loadFrameworkConfig(root);
  const resolvedProfile = loadResolvedProfile(root, fw);
  return {
    phase: 'prd',
    feature: 'demo',
    projectRoot: root,
    phaseRule: stubPhaseRule(),
    featureSpec: { feature: 'demo' },
    resolvedProfile,
    ...o,
  };
}

function prdNoUiYaml(): string {
  return [
    '# Demo PRD',
    '',
    '## 0. 术语映射表',
    '| 原始术语 | 权威模块 | 所属层 | 置信度 | 易混项 | 用户确认 |',
    '|----------|----------|--------|--------|--------|---------|',
    '| 占位 | DemoMod | 01-Product | high | — | [x] |',
    '',
    '## 2. Scope 声明',
    '```yaml',
    'in_scope_modules:',
    '  - DemoMod',
    'out_of_scope_modules: []',
    'rationale: fixture',
    '```',
    '',
    '（无 Visual Handoff 独立 yaml 块）',
    '',
    '## 5. 页面/界面描述',
    '短。',
    '',
  ].join('\n');
}

/** 精简通过 parseVisualHandoffYamlRoot（须含 ui_change 根字段） */
function prdWithHandoff(kind: string, refsYaml: string, uiChange = 'new_or_changed'): string {
  return [
    '# H',
    '## 5. 页面/界面描述',
    'x。',
    '',
    '```yaml',
    `ui_change: ${uiChange}`,
    'visual_handoff:',
    `  kind: ${kind}`,
    `  authoritative_refs:`,
    refsYaml,
    '```',
    '',
  ].join('\n');
}

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'vh-unit-'));
}

export function runAll(): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];
  const run = (name: string, fn: () => void) => {
    try {
      fn();
      results.push({ name, ok: true });
    } catch (e) {
      results.push({ name, ok: false, error: (e as Error).message });
    }
  };

  run('no_ui_yaml_and_no_prd_section_returns_empty_array', () => {
    const root = mkTmp();
    try {
      clearFrameworkConfigCache();
      fs.mkdirSync(path.join(root, 'doc', 'features', 'demo'), { recursive: true });
      fs.writeFileSync(path.join(root, 'framework.config.json'), JSON.stringify({
        schema_version: '1.0',
        project_name: 'demo',
        project_type: 'app',
        agent_adapter: 'generic',
        architecture: {
          outer_layers: [{ id: '01-Product', can_depend_on: [], intra_layer_deps: 'forbid' }],
          module_inner_layers: ['shared', 'data', 'domain', 'presentation'],
          inner_dependency_direction: 'upward',
          cross_module_exports_file: 'index.ets',
        },
        paths: { features_dir: 'doc/features' },
      }), 'utf-8');

      const r = checkVisualHandoff(baseCtx(root, { visualHandoffEnforcement: undefined }), prdNoUiYaml());
      if (r.length !== 0) throw new Error(`expected no results, got ${JSON.stringify(r)}`);
    } finally {
      clearFrameworkConfigCache();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  run('missing_ui_yaml_strict_fail', () => {
    const root = mkTmp();
    try {
      const r = checkVisualHandoff(baseCtx(root, { visualHandoffEnforcement: 'strict' }), prdNoUiYaml());
      const hit = r.find(x => x.id === 'visual_handoff_ui_change' && x.status === 'FAIL');
      if (!hit) throw new Error(`expected FAIL visual_handoff_ui_change, got ${JSON.stringify(r)}`);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  run('unreachable_repo_relative_implicit_strict_fail', () => {
    const root = mkTmp();
    try {
      const prd = prdWithHandoff('repo_assets', '    - id: a\n      path: nope/not-there.bin');
      const r = checkVisualHandoff(baseCtx(root, { visualHandoffEnforcement: undefined }), prd);
      const hit = r.find(x => x.status === 'FAIL' && x.details.includes('不存在'));
      if (!hit) throw new Error(`expected FAIL on unreachable path, got ${JSON.stringify(r)}`);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  run('unreachable_repo_relative_reachable_warns', () => {
    const root = mkTmp();
    try {
      const prd = prdWithHandoff('repo_assets', '    - id: a\n      path: nope/not-there.bin');
      const r = checkVisualHandoff(baseCtx(root, { visualHandoffEnforcement: 'reachable' }), prd);
      const hit = r.find(x => x.status === 'WARN' && x.details.includes('agent-reachable=false'));
      if (!hit) throw new Error(`expected WARN agent-reachable, got ${JSON.stringify(r)}`);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  run('external_root_${UX_ROOT}_reachable_pass', () => {
    const root = mkTmp();
    const ux = fs.mkdtempSync(path.join(os.tmpdir(), 'ux-root-'));
    try {
      const assetDir = path.join(ux, 'pack');
      fs.mkdirSync(assetDir, { recursive: true });
      fs.writeFileSync(path.join(assetDir, 'a.png'), 'x');
      process.env.TEST_UX_ROOT = ux;
      const prd = prdWithHandoff('screenshot_pack', '    - id: r\n      path: ${TEST_UX_ROOT}/pack/a.png');
      const r = checkVisualHandoff(baseCtx(root, {
        visualHandoffEnforcement: 'strict',
        prdVisualSources: {},
      }), prd);
      const hit = r.find(x => x.id === 'visual_handoff' && x.status === 'PASS');
      if (!hit) throw new Error(`expected PASS, got ${JSON.stringify(r)}`);
      if (!(hit.visual_resolution_rows?.some(row => row.agent_reachable && row.resolution_kind === 'env_substituted'))) {
        throw new Error(`missing env_substituted row: ${JSON.stringify(hit.visual_resolution_rows)}`);
      }
    } finally {
      delete process.env.TEST_UX_ROOT;
      fs.rmSync(ux, { recursive: true, force: true });
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  run('absolute_path_denied_by_default_fail', () => {
    const root = mkTmp();
    const absFile = path.join(root, '_abs_demo.txt');
    try {
      fs.writeFileSync(absFile, 'x');
      const absQuoted = absFile.replace(/\\/g, '/');
      const prd = prdWithHandoff('repo_assets', `    - id: z\n      path: '${absQuoted}'`);
      const r = checkVisualHandoff(baseCtx(root), prd);
      const hit = r.find(x => x.status === 'FAIL' && /绝对路径未获准/.test(x.details));
      if (!hit) throw new Error(`expected FAIL abs denied, got ${JSON.stringify(r)}`);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  run('absolute_path_allowed_pass', () => {
    const root = mkTmp();
    const absFile = path.join(root, '_abs_demo.txt');
    try {
      fs.writeFileSync(absFile, 'x');
      const absQuoted = absFile.replace(/\\/g, '/');
      const prd = prdWithHandoff('repo_assets', `    - id: z\n      path: '${absQuoted}'`);
      const r = checkVisualHandoff(baseCtx(root, {
        prdVisualSources: { allow_absolute_paths: true },
      }), prd);
      const hit = r.find(x => x.id === 'visual_handoff' && x.status === 'PASS');
      if (!hit) throw new Error(`expected PASS allowed abs, got ${JSON.stringify(r)}`);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  run('resolver_plain_relative_not_env_substitution', () => {
    const root = mkTmp();
    try {
      const sub = path.join(root, 'a', 'b');
      fs.mkdirSync(sub, { recursive: true });
      const f = path.join(sub, 'c.txt');
      fs.writeFileSync(f, 'ok');
      const res = resolveAuthoritativePath(path.join('a', 'b', 'c.txt'), {
        projectRoot: root,
        allowAbsolutePaths: false,
        allowNetworkPaths: false,
      });
      if (res.resolutionKind !== 'relative_repo' || !res.agentReachable) {
        throw new Error(JSON.stringify(res));
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  return results;
}
