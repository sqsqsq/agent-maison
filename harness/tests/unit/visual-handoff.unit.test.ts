// ============================================================================
// visual-handoff.unit.test.ts — check-spec Visual Handoff 白盒回归
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { clearFrameworkConfigCache, loadFrameworkConfig } from '../../config';
import { loadResolvedProfile } from '../../profile-loader';
import { checkVisualHandoff } from '../../scripts/check-spec';
import type { CheckContext, PhaseRuleSpec } from '../../scripts/utils/types';
import { resolveAuthoritativePath } from '../../scripts/utils/visual-source-resolver';
import { inferRepoLayout } from '../../repo-layout';
import { DEFAULT_LAYOUT } from '../utils/layout-test-helper';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function stubPhaseRule(): PhaseRuleSpec {
  return {
    phase: 'spec',
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
    phase: 'spec',
    feature: 'demo',
    projectRoot: root,
    frameworkRoot: DEFAULT_LAYOUT.frameworkRoot,
    frameworkRel: DEFAULT_LAYOUT.frameworkRel,
    harnessRoot: path.join(DEFAULT_LAYOUT.frameworkRoot, 'harness'),
    layoutKind: DEFAULT_LAYOUT.kind,
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
        specVisualSources: {},
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
        specVisualSources: { allow_absolute_paths: true },
      }), prd);
      const hit = r.find(x => x.id === 'visual_handoff' && x.status === 'PASS');
      if (!hit) throw new Error(`expected PASS allowed abs, got ${JSON.stringify(r)}`);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  // plan e7a2c4f1 宿主回灌 09-23：ui-spec screens[].ref_id 与 authoritative_refs[].id 错位（宿主两种形态：
  // 加 _ref 后缀 / 换了名字）→ spec 期 MAJOR WARN 披露两侧 id，不阻断；对齐后不再出现。
  run('ui_spec_ref_id_misaligned_with_authoritative_refs_warns_not_blocks', () => {
    const root = mkTmp();
    try {
      fs.mkdirSync(path.join(root, 'ref'), { recursive: true });
      for (const f of ['cts.png', 'bcs.png', 'sms.png']) fs.writeFileSync(path.join(root, 'ref', f), 'x');
      const prd = prdWithHandoff('screenshot_pack', [
        '    - id: card_type_sheet', '      path: ref/cts.png',
        '    - id: card_selection', '      path: ref/bcs.png',
        '    - id: sms_sheet', '      path: ref/sms.png',
      ].join('\n'));
      const uiSpecDir = path.join(root, 'doc', 'features', 'demo', 'spec');
      fs.mkdirSync(uiSpecDir, { recursive: true });
      const writeUiSpec = (refIds: string[]) => fs.writeFileSync(path.join(uiSpecDir, 'ui-spec.yaml'), [
        'schema_version: "1.0"', 'assets: []', 'screens:',
        ...refIds.map((ref, i) => `  - id: s${i}\n    ref_id: ${ref}\n    root: { id: r${i}, type: navigation_frame, order: 0 }`),
      ].join('\n'));

      writeUiSpec(['card_type_sheet_ref', 'bank_card_selection_ref', 'sms_sheet']);
      const r = checkVisualHandoff(baseCtx(root, { visualHandoffEnforcement: 'strict' }), prd);
      if (!r.some(x => x.id === 'visual_handoff' && x.status === 'PASS')) throw new Error(`base 须仍 PASS：${JSON.stringify(r)}`);
      const warn = r.find(x => x.id === 'visual_handoff_refs');
      if (!warn || warn.status !== 'WARN' || warn.severity !== 'MAJOR') throw new Error(`expected MAJOR WARN：${JSON.stringify(r)}`);
      for (const id of ['card_type_sheet_ref', 'bank_card_selection_ref', 'card_type_sheet', 'card_selection', '[ref_undeclared]', '2/3']) {
        if (!warn.details.includes(id)) throw new Error(`details 缺 ${id}：${warn.details}`);
      }
      if (/ref_id=sms_sheet /.test(warn.details)) throw new Error(`已对齐的 sms_sheet 不得被点名：${warn.details}`);
      if (!warn.affected_files?.some(f => f.endsWith('spec/ui-spec.yaml'))) throw new Error(JSON.stringify(warn.affected_files));

      writeUiSpec(['card_type_sheet', 'card_selection', 'sms_sheet']);
      const aligned = checkVisualHandoff(baseCtx(root, { visualHandoffEnforcement: 'strict' }), prd);
      if (aligned.some(x => x.id === 'visual_handoff_refs')) throw new Error(`对齐后不得再报：${JSON.stringify(aligned)}`);

      // codex review P2 反例：非位图引用（URL / 仅 URL 的 bundle / 目录 path）不进位图索引，
      // id 两侧一致时不得误报"未声明"；同形态下真错位仍须报（证明对账确实跑了）。
      fs.mkdirSync(path.join(root, 'ref', 'pack'), { recursive: true });
      const nonRaster: Array<[string, string]> = [
        ['design_tool_link', '    - id: card_type_sheet\n      url: https://design.example.com/a\n    - id: card_selection\n      url: https://design.example.com/b'],
        ['figma_export_bundle', '    - id: card_type_sheet\n      url: https://figma.example.com/a\n    - id: card_selection\n      url: https://figma.example.com/b'],
        ['repo_assets', '    - id: card_type_sheet\n      path: ref/pack\n    - id: card_selection\n      path: ref'],
      ];
      for (const [kind, refsYaml] of nonRaster) {
        const nonRasterPrd = prdWithHandoff(kind, refsYaml);
        writeUiSpec(['card_type_sheet', 'card_selection']);
        const ok = checkVisualHandoff(baseCtx(root, { visualHandoffEnforcement: 'strict' }), nonRasterPrd);
        if (!ok.some(x => x.id === 'visual_handoff' && x.status === 'PASS')) throw new Error(`${kind} 前置 base PASS：${JSON.stringify(ok)}`);
        if (ok.some(x => x.id === 'visual_handoff_refs')) throw new Error(`${kind} id 对齐不得告警：${JSON.stringify(ok)}`);
        writeUiSpec(['card_type_sheet', 'card_selection_ref']);
        const bad = checkVisualHandoff(baseCtx(root, { visualHandoffEnforcement: 'strict' }), nonRasterPrd).find(x => x.id === 'visual_handoff_refs');
        if (!bad || !bad.details.includes('card_selection_ref') || !bad.details.includes('1/2')) throw new Error(`${kind} 真错位须报：${JSON.stringify(bad)}`);
      }
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
