// ============================================================================
// init-next-steps.unit.test.ts — deriveInitNextSteps / render / readiness
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  deriveInitNextSteps,
  findFirstLaunchableFeatureArtifact,
  isBlockerInitLog,
  probeCatalogReadiness,
  renderNextStepsMarkdown,
  type InitNextStepsContext,
  type InitRunLogLike,
} from '../../scripts/utils/init-next-steps';
import { resolveMaterializedBuiltinSkillEntryRel } from '../../scripts/utils/instance-skill-bridge';
import {
  buildInitNextStepsMinContext,
  buildInitNextStepsPhase1Context,
  finalizeInitRunLog,
} from '../../scripts/utils/finalize-init-run-log';
import type { InitRunLog } from '../../scripts/init-orchestrate';
import { loadDefaultWorkflowSpec } from '../../scripts/utils/skills-index-init-steps';
import { computeAnchorContentHash } from '../../code-graph/anchor-hash';
import type { WorkflowSpec } from '../../workflow-loader';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

const FRAMEWORK_DIR = path.resolve(__dirname, '../../..');

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function mkProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'init-next-steps-'));
}

function writeMinimalConfig(root: string, opts?: { agentBundleRoot?: string }): void {
  fs.mkdirSync(path.join(root, 'doc'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'framework.config.json'),
    JSON.stringify(
      {
        schema_version: '1.0',
        project_profile: { name: 'generic-app' },
        paths: {
          module_catalog: 'doc/module-catalog.yaml',
          glossary: 'doc/glossary.yaml',
          features_dir: 'doc/features',
          architecture_md: 'doc/architecture.md',
          ...(opts?.agentBundleRoot ? { agent_bundle_root: opts.agentBundleRoot } : {}),
        },
        architecture: {
          outer_layers: [{ id: 'Feature', can_depend_on: [], intra_layer_deps: 'forbid' }],
          module_inner_layers: ['shared'],
          inner_dependency_direction: 'upward',
          cross_module_exports_file: 'index.ets',
        },
      },
      null,
      2,
    ),
    'utf-8',
  );
}

function writeCursorSkillStub(root: string, skillId: string): void {
  const dir = path.join(root, '.cursor', 'skills', skillId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), '# stub\n', 'utf-8');
}

function writeClaudeCommandStub(root: string, commandId: string): void {
  const dir = path.join(root, '.claude', 'commands');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${commandId}.md`), '# stub\n', 'utf-8');
}

function writeGenericSkillStub(root: string, skillId: string, bundleRoot = '.custom-agents'): void {
  const dir = path.join(root, ...bundleRoot.split('/'), 'skills', skillId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), '# stub\n', 'utf-8');
}

function writeFrameworkLocal(root: string, agentAdapter: string): void {
  fs.writeFileSync(
    path.join(root, 'framework.local.json'),
    JSON.stringify({ schema_version: '1.0', agent_adapter: agentAdapter }, null, 2),
    'utf-8',
  );
}

const CATALOG_MODULE_YAML = (name: string) =>
  `schema_version: "1.0"\nmodules:\n  - name: ${name}\n    layer: Feature\n    sub_layer: null\n    one_liner: x\n    responsibilities: []\n    NOT_responsible_for: []\n    typical_business_terms: []\n    easily_confused_with: []\n    key_exports: []\n    entry_file: index.ets\n`;

const GLOSSARY_YAML = (moduleName: string) =>
  `schema_version: "1.0"\nterms:\n  - term: T\n    canonical_module: ${moduleName}\n    owner_layer: Feature\n    aliases: []\n    easily_confused_with: []\n`;

function writeValidModuleGraph(root: string, moduleName = 'Wallet'): void {
  const anchorRel = `Feature/${moduleName}/index.ets`;
  const anchorAbs = path.join(root, ...anchorRel.split('/'));
  fs.mkdirSync(path.dirname(anchorAbs), { recursive: true });
  fs.writeFileSync(anchorAbs, 'function foo() { return 1; }', 'utf-8');
  const hash = computeAnchorContentHash(root, anchorRel, 'foo');
  assert(hash !== null, `computeAnchorContentHash failed for ${anchorRel}`);
  const graphPath = path.join(root, 'Feature', moduleName, 'code-graph.yaml');
  fs.mkdirSync(path.dirname(graphPath), { recursive: true });
  fs.writeFileSync(
    graphPath,
    [
      'schema_version: "1.0"',
      `module: ${moduleName}`,
      'nodes:',
      '  - id: n1',
      '    anchor:',
      `      file: ${anchorRel}`,
      '      symbol: foo',
      `      content_hash: ${hash}`,
    ].join('\n'),
    'utf-8',
  );
}

function writeCorruptModuleGraph(root: string, moduleName = 'Wallet'): void {
  const graphPath = path.join(root, 'Feature', moduleName, 'code-graph.yaml');
  fs.mkdirSync(path.dirname(graphPath), { recursive: true });
  fs.writeFileSync(
    graphPath,
    'schema_version: "1.0"\nmodule: Wallet\nnodes: not-an-array\n',
    'utf-8',
  );
}

function writeGraphMissingAnchorFile(root: string, moduleName = 'Wallet'): void {
  const graphPath = path.join(root, 'Feature', moduleName, 'code-graph.yaml');
  fs.mkdirSync(path.dirname(graphPath), { recursive: true });
  fs.writeFileSync(
    graphPath,
    [
      'schema_version: "1.0"',
      `module: ${moduleName}`,
      'nodes:',
      '  - id: n1',
      '    core: true',
      '    anchor:',
      `      file: Feature/${moduleName}/src/Missing.ets`,
      '      symbol: foo',
      '      content_hash: abc123deadbeef',
    ].join('\n'),
    'utf-8',
  );
}

function writeGraphCoreHashMismatch(root: string, moduleName = 'Wallet'): void {
  const srcRel = `Feature/${moduleName}/src/Foo.ets`;
  const srcAbs = path.join(root, ...srcRel.split('/'));
  fs.mkdirSync(path.dirname(srcAbs), { recursive: true });
  fs.writeFileSync(srcAbs, 'function foo() { return 1; }', 'utf-8');
  const graphPath = path.join(root, 'Feature', moduleName, 'code-graph.yaml');
  fs.writeFileSync(
    graphPath,
    [
      'schema_version: "1.0"',
      `module: ${moduleName}`,
      'nodes:',
      '  - id: n1',
      '    core: true',
      '    anchor:',
      `      file: ${srcRel}`,
      '      symbol: foo',
      '      content_hash: deadbeef00000000',
    ].join('\n'),
    'utf-8',
  );
}

const GRAPH_GATED_SPEC: WorkflowSpec = {
  schema_version: '1.0',
  name: 'graph-gated',
  artifacts: [
    { id: 'catalog', scope: 'global', requires: [] },
    { id: 'glossary', scope: 'global', requires: ['catalog'] },
    { id: 'module-graph', scope: 'global', requires: ['catalog'] },
    { id: 'plan', scope: 'feature', requires: ['catalog', 'glossary', 'module-graph'] },
  ],
};

function writeGraphGatedProject(root: string, moduleName = 'Wallet'): void {
  writeMinimalConfig(root);
  fs.writeFileSync(path.join(root, 'doc', 'module-catalog.yaml'), CATALOG_MODULE_YAML(moduleName), 'utf-8');
  fs.writeFileSync(path.join(root, 'doc', 'glossary.yaml'), GLOSSARY_YAML(moduleName), 'utf-8');
}

function writeGraphProbeFailureProject(root: string, moduleName = 'Wallet'): void {
  writeGraphGatedProject(root);
  const anchorRel = `Feature/${moduleName}/index.ets`;
  fs.mkdirSync(path.join(root, ...anchorRel.split('/')), { recursive: true });
  const graphPath = path.join(root, 'Feature', moduleName, 'code-graph.yaml');
  fs.mkdirSync(path.dirname(graphPath), { recursive: true });
  fs.writeFileSync(
    graphPath,
    [
      'schema_version: "1.0"',
      `module: ${moduleName}`,
      'nodes:',
      '  - id: n1',
      '    anchor:',
      `      file: ${anchorRel}`,
      '      symbol: foo',
      '      content_hash: deadbeef00000000',
    ].join('\n'),
    'utf-8',
  );
}

function assertModuleGraphRepairCopy(repair: { message: string }): void {
  assert(repair.message.includes('code-graph'), repair.message);
  assert(!repair.message.includes('/framework-init'), repair.message);
  assert(
    repair.message.includes('请修复 code-graph 产物或重新执行 code-graph'),
    repair.message,
  );
}

function baseLog(
  entries: InitRunLogLike['entries'],
  adapters: string[] = ['cursor'],
): InitRunLogLike {
  return { entries, materialized_adapters: adapters };
}

function phase1Ctx(
  projectRoot: string,
  plan?: InitNextStepsContext['plan'],
  scope: InitNextStepsContext['scope'] = 'project',
  adapters: string[] = ['cursor'],
): InitNextStepsContext {
  return {
    projectRoot,
    harnessRoot: path.join(FRAMEWORK_DIR, 'harness'),
    scope,
    frameworkRoot: FRAMEWORK_DIR,
    materialized_adapters: adapters,
    plan,
  };
}

function minimalFailedRunLog(root: string): InitRunLog {
  return {
    schema_version: '1.0',
    scope: 'project',
    started_at: '2026-01-01T00:00:00.000Z',
    finished_at: '2026-01-01T00:00:01.000Z',
    decision_mode: 'manual',
    entries: [{ task_id: 'ensure-config', action: 'run', status: 'failed', message: 'parse error' }],
    project_root: root,
  };
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'isBlockerInitLog: failed entry',
    run: () => {
      assert(
        isBlockerInitLog(
          baseLog([{ task_id: 'ensure-config', action: 'run', status: 'failed', message: 'x' }]),
        ),
        'failed',
      );
    },
  },
  {
    name: 'Phase0: cross-check 仅 failure_recovery，无 init_rerun',
    run: () => {
      const steps = deriveInitNextSteps(
        baseLog([
          {
            task_id: '<materialized-adapters>',
            action: 'validate',
            status: 'failed',
            message: 'mismatch',
          },
        ]),
      );
      assert(steps.length === 1, `steps=${steps.length}`);
      assert(steps[0]!.when === 'failure_recovery', steps[0]!.when);
      assert(steps[0]!.source === 'harness', steps[0]!.source);
      assert(!steps.some(s => s.when === 'init_rerun'), 'init_rerun');
      assert(steps[0]!.message.includes('/framework-init'), 'rerun');
    },
  },
  {
    name: 'Phase0 不读 ctx：无 frameworkRoot 仍产出 recovery',
    run: () => {
      const steps = deriveInitNextSteps(
        baseLog([{ task_id: 't', action: 'run', status: 'failed', message: 'boom' }]),
      );
      assert(steps.length === 1 && steps[0]!.kind === 'required', 'recovery');
    },
  },
  {
    name: 'Phase0: corrupt config + failed entry finalize 不读 workflow',
    run: () => {
      const root = mkProject();
      fs.writeFileSync(path.join(root, 'framework.config.json'), '{ not json', 'utf-8');
      const log = minimalFailedRunLog(root);
      const minCtx = buildInitNextStepsMinContext({
        projectRoot: root,
        harnessRoot: path.join(FRAMEWORK_DIR, 'harness'),
        scope: 'project',
        log,
      });
      buildInitNextStepsPhase1Context(minCtx, {
        projectRoot: root,
        harnessRoot: path.join(FRAMEWORK_DIR, 'harness'),
      });
      const steps = finalizeInitRunLog(log, { minCtx });
      assert(steps.length === 1 && steps[0]!.when === 'failure_recovery', JSON.stringify(steps));
    },
  },
  {
    name: 'catalog_empty 推荐 catalog-bootstrap',
    run: () => {
      const root = mkProject();
      writeMinimalConfig(root);
      writeCursorSkillStub(root, 'catalog-bootstrap');
      const steps = deriveInitNextSteps(baseLog([]), phase1Ctx(root));
      assert(steps.some(s => s.when === 'catalog_empty' && s.skill_id === 'catalog-bootstrap'), JSON.stringify(steps));
    },
  },
  {
    name: 'catalog corrupt 仅 required 修复项',
    run: () => {
      const root = mkProject();
      writeMinimalConfig(root);
      fs.writeFileSync(path.join(root, 'doc', 'module-catalog.yaml'), ':\n- bad\n', 'utf-8');
      const steps = deriveInitNextSteps(baseLog([]), phase1Ctx(root));
      assert(steps.every(s => s.kind === 'required'), JSON.stringify(steps));
      assert(steps.some(s => s.when === 'catalog_corrupt'), JSON.stringify(steps));
      assert(!steps.some(s => s.when === 'graph_gap'), 'no graph');
    },
  },
  {
    name: 'graph_gap 映射 module-graph → code-graph skill',
    run: () => {
      const root = mkProject();
      writeMinimalConfig(root);
      fs.writeFileSync(
        path.join(root, 'doc', 'module-catalog.yaml'),
        'schema_version: "1.0"\nmodules:\n  - name: Wallet\n    layer: Feature\n    sub_layer: null\n    one_liner: x\n    responsibilities: []\n    NOT_responsible_for: []\n    typical_business_terms: []\n    easily_confused_with: []\n    key_exports: []\n    entry_file: index.ets\n',
        'utf-8',
      );
      writeCursorSkillStub(root, 'code-graph');
      const steps = deriveInitNextSteps(baseLog([]), phase1Ctx(root));
      const graph = steps.find(s => s.when === 'graph_gap');
      assert(Boolean(graph), 'graph step');
      assert(graph!.skill_id === 'code-graph', graph!.skill_id ?? '');
      assert(graph!.workflow_artifact === 'module-graph', graph!.workflow_artifact ?? '');
      assert(graph!.message.includes('Wallet'), graph!.message);
    },
  },
  {
    name: 'feature_ready 默认 workflow 首 feature = spec',
    run: () => {
      const root = mkProject();
      writeMinimalConfig(root);
      fs.writeFileSync(
        path.join(root, 'doc', 'module-catalog.yaml'),
        'schema_version: "1.0"\nmodules:\n  - name: M\n    layer: Feature\n    sub_layer: null\n    one_liner: x\n    responsibilities: []\n    NOT_responsible_for: []\n    typical_business_terms: []\n    easily_confused_with: []\n    key_exports: []\n    entry_file: index.ets\n',
        'utf-8',
      );
      fs.writeFileSync(
        path.join(root, 'doc', 'glossary.yaml'),
        'schema_version: "1.0"\nterms:\n  - term: T\n    canonical_module: M\n    owner_layer: Feature\n    aliases: []\n    easily_confused_with: []\n',
        'utf-8',
      );
      writeCursorSkillStub(root, 'spec');
      const steps = deriveInitNextSteps(baseLog([]), phase1Ctx(root));
      const feat = steps.find(s => s.when === 'feature_ready');
      assert(Boolean(feat), JSON.stringify(steps));
      assert(feat!.skill_id === 'spec', feat!.skill_id ?? '');
      assert(feat!.invoke?.command_id === 'spec', feat!.invoke?.command_id ?? '');
    },
  },
  {
    name: '自定义 workflow 首 feature=plan 且 catalog/glossary ready → 推荐 plan skill',
    run: () => {
      const customSpec: WorkflowSpec = {
        schema_version: '1.0',
        name: 'custom',
        artifacts: [
          { id: 'catalog', scope: 'global', requires: [] },
          { id: 'glossary', scope: 'global', requires: ['catalog'] },
          { id: 'plan', scope: 'feature', requires: ['catalog', 'glossary'] },
          { id: 'spec', scope: 'feature', requires: ['plan'] },
        ],
      };
      const root = mkProject();
      writeMinimalConfig(root);
      fs.writeFileSync(
        path.join(root, 'doc', 'module-catalog.yaml'),
        'schema_version: "1.0"\nmodules:\n  - name: M\n    layer: Feature\n    sub_layer: null\n    one_liner: x\n    responsibilities: []\n    NOT_responsible_for: []\n    typical_business_terms: []\n    easily_confused_with: []\n    key_exports: []\n    entry_file: index.ets\n',
        'utf-8',
      );
      fs.writeFileSync(
        path.join(root, 'doc', 'glossary.yaml'),
        'schema_version: "1.0"\nterms:\n  - term: T\n    canonical_module: M\n    owner_layer: Feature\n    aliases: []\n    easily_confused_with: []\n',
        'utf-8',
      );
      writeCursorSkillStub(root, 'plan');
      const steps = deriveInitNextSteps(baseLog([]), {
        ...phase1Ctx(root),
        workflowSpec: customSpec,
      });
      const feat = steps.find(s => s.when === 'feature_ready');
      assert(Boolean(feat), JSON.stringify(steps));
      assert(feat!.skill_id === 'plan', feat!.skill_id ?? '');
      assert(feat!.workflow_artifact === 'plan', feat!.workflow_artifact ?? '');
      assert(feat!.invoke?.command_id === 'plan', feat!.invoke?.command_id ?? '');
    },
  },
  {
    name: '未知 global 依赖未就绪时不误推 feature_ready',
    run: () => {
      const customSpec: WorkflowSpec = {
        schema_version: '1.0',
        name: 'extra-gated',
        artifacts: [
          { id: 'catalog', scope: 'global', requires: [] },
          { id: 'glossary', scope: 'global', requires: ['catalog'] },
          { id: 'extra-gate', scope: 'global', requires: ['catalog'] },
          { id: 'plan', scope: 'feature', requires: ['catalog', 'glossary', 'extra-gate'] },
        ],
      };
      const root = mkProject();
      writeMinimalConfig(root);
      fs.writeFileSync(
        path.join(root, 'doc', 'module-catalog.yaml'),
        'schema_version: "1.0"\nmodules:\n  - name: M\n    layer: Feature\n    sub_layer: null\n    one_liner: x\n    responsibilities: []\n    NOT_responsible_for: []\n    typical_business_terms: []\n    easily_confused_with: []\n    key_exports: []\n    entry_file: index.ets\n',
        'utf-8',
      );
      fs.writeFileSync(
        path.join(root, 'doc', 'glossary.yaml'),
        'schema_version: "1.0"\nterms:\n  - term: T\n    canonical_module: M\n    owner_layer: Feature\n    aliases: []\n    easily_confused_with: []\n',
        'utf-8',
      );
      const first = findFirstLaunchableFeatureArtifact(
        customSpec,
        { state: 'ready' },
        { state: 'ready' },
        { state: 'ready' },
      );
      assert(first === undefined, `first=${first}`);
      const steps = deriveInitNextSteps(baseLog([]), {
        ...phase1Ctx(root),
        workflowSpec: customSpec,
      });
      assert(!steps.some(s => s.when === 'feature_ready'), JSON.stringify(steps));
    },
  },
  {
    name: 'graph_gap 存在时 module-graph 未就绪不误推 feature_ready',
    run: () => {
      const customSpec: WorkflowSpec = {
        schema_version: '1.0',
        name: 'graph-gated',
        artifacts: [
          { id: 'catalog', scope: 'global', requires: [] },
          { id: 'glossary', scope: 'global', requires: ['catalog'] },
          { id: 'module-graph', scope: 'global', requires: ['catalog'] },
          { id: 'plan', scope: 'feature', requires: ['catalog', 'glossary', 'module-graph'] },
        ],
      };
      const root = mkProject();
      writeMinimalConfig(root);
      fs.writeFileSync(
        path.join(root, 'doc', 'module-catalog.yaml'),
        'schema_version: "1.0"\nmodules:\n  - name: Wallet\n    layer: Feature\n    sub_layer: null\n    one_liner: x\n    responsibilities: []\n    NOT_responsible_for: []\n    typical_business_terms: []\n    easily_confused_with: []\n    key_exports: []\n    entry_file: index.ets\n',
        'utf-8',
      );
      fs.writeFileSync(
        path.join(root, 'doc', 'glossary.yaml'),
        'schema_version: "1.0"\nterms:\n  - term: T\n    canonical_module: Wallet\n    owner_layer: Feature\n    aliases: []\n    easily_confused_with: []\n',
        'utf-8',
      );
      writeCursorSkillStub(root, 'code-graph');
      writeCursorSkillStub(root, 'plan');
      const steps = deriveInitNextSteps(baseLog([]), {
        ...phase1Ctx(root),
        workflowSpec: customSpec,
      });
      assert(steps.some(s => s.when === 'graph_gap'), JSON.stringify(steps));
      assert(!steps.some(s => s.when === 'feature_ready'), JSON.stringify(steps));
    },
  },
  {
    name: 'generic 入口解析不依赖 personal active adapter',
    run: () => {
      const root = mkProject();
      writeMinimalConfig(root, { agentBundleRoot: '.custom-agents' });
      writeFrameworkLocal(root, 'cursor');
      writeGenericSkillStub(root, 'code-graph');
      writeGenericSkillStub(root, 'spec');
      writeGenericSkillStub(root, 'goal-mode');
      fs.writeFileSync(
        path.join(root, 'doc', 'module-catalog.yaml'),
        'schema_version: "1.0"\nmodules:\n  - name: Wallet\n    layer: Feature\n    sub_layer: null\n    one_liner: x\n    responsibilities: []\n    NOT_responsible_for: []\n    typical_business_terms: []\n    easily_confused_with: []\n    key_exports: []\n    entry_file: index.ets\n',
        'utf-8',
      );
      fs.writeFileSync(
        path.join(root, 'doc', 'glossary.yaml'),
        'schema_version: "1.0"\nterms:\n  - term: T\n    canonical_module: Wallet\n    owner_layer: Feature\n    aliases: []\n    easily_confused_with: []\n',
        'utf-8',
      );
      const adapters = ['generic', 'cursor'];
      const steps = deriveInitNextSteps(
        baseLog([], adapters),
        phase1Ctx(root, undefined, 'project', adapters),
      );
      assert(steps.some(s => s.when === 'graph_gap'), JSON.stringify(steps));
      assert(!steps.some(s => s.when === 'init_rerun'), JSON.stringify(steps));
      const entry = resolveMaterializedBuiltinSkillEntryRel(
        root,
        FRAMEWORK_DIR,
        'generic',
        'code-graph',
        'code-graph',
      );
      assert(entry?.exists === true, JSON.stringify(entry));
      const md = renderNextStepsMarkdown(steps, {
        materializedAdapters: adapters,
        projectRoot: root,
        frameworkRoot: FRAMEWORK_DIR,
      });
      assert(md.includes('.custom-agents/skills/code-graph/SKILL.md'), md);
      assert(md.includes('generic:'), md);
    },
  },
  {
    name: '缺 skill 入口时不推 optional，改 required init_rerun',
    run: () => {
      const root = mkProject();
      writeMinimalConfig(root);
      fs.writeFileSync(
        path.join(root, 'doc', 'module-catalog.yaml'),
        'schema_version: "1.0"\nmodules:\n  - name: Wallet\n    layer: Feature\n    sub_layer: null\n    one_liner: x\n    responsibilities: []\n    NOT_responsible_for: []\n    typical_business_terms: []\n    easily_confused_with: []\n    key_exports: []\n    entry_file: index.ets\n',
        'utf-8',
      );
      const steps = deriveInitNextSteps(baseLog([]), phase1Ctx(root));
      assert(!steps.some(s => s.when === 'graph_gap'), JSON.stringify(steps));
      assert(steps.some(s => s.when === 'init_rerun' && s.kind === 'required'), JSON.stringify(steps));
    },
  },
  {
    name: '部分 adapter 有入口：保留 optional，附录只列存在项',
    run: () => {
      const root = mkProject();
      writeMinimalConfig(root);
      fs.writeFileSync(
        path.join(root, 'doc', 'module-catalog.yaml'),
        'schema_version: "1.0"\nmodules:\n  - name: Wallet\n    layer: Feature\n    sub_layer: null\n    one_liner: x\n    responsibilities: []\n    NOT_responsible_for: []\n    typical_business_terms: []\n    easily_confused_with: []\n    key_exports: []\n    entry_file: index.ets\n',
        'utf-8',
      );
      writeClaudeCommandStub(root, 'code-graph');
      const adapters = ['cursor', 'claude'];
      const steps = deriveInitNextSteps(baseLog([], adapters), phase1Ctx(root, undefined, 'project', adapters));
      assert(steps.some(s => s.when === 'graph_gap'), JSON.stringify(steps));
      const md = renderNextStepsMarkdown(steps, {
        materializedAdapters: adapters,
        projectRoot: root,
        frameworkRoot: FRAMEWORK_DIR,
      });
      assert(md.includes('claude:'), md);
      assert(!md.includes('入口未物化'), md);
      assert(!md.includes('- cursor:'), md);
    },
  },
  {
    name: 'personal scope 成功不产出项目级 next_steps',
    run: () => {
      const root = mkProject();
      writeMinimalConfig(root);
      writeCursorSkillStub(root, 'catalog-bootstrap');
      const steps = deriveInitNextSteps(
        baseLog([]),
        phase1Ctx(root, undefined, 'personal'),
      );
      assert(steps.length === 0, JSON.stringify(steps));
    },
  },
  {
    name: 'renderNextStepsMarkdown: required 与 optional 分节',
    run: () => {
      const md = renderNextStepsMarkdown(
        [
          {
            step_id: 'r',
            source: 'harness',
            when: 'failure_recovery',
            kind: 'required',
            priority: 0,
            message: 'fix me',
          },
          {
            step_id: 'o',
            source: 'index',
            when: 'catalog_empty',
            kind: 'optional',
            priority: 10,
            message: 'bootstrap',
            skill_id: 'catalog-bootstrap',
            invoke: { neutral: 'A', command_id: 'catalog-bootstrap' },
          },
        ],
        {
          materializedAdapters: ['claude'],
          projectRoot: FRAMEWORK_DIR,
          frameworkRoot: FRAMEWORK_DIR,
        },
      );
      assert(md.includes('## 必须处理'), md);
      assert(md.includes('## 可选下一步'), md);
      assert(md.includes('本实例调用方式'), md);
      assert(!md.includes('next_steps_markdown'), md);
    },
  },
  {
    name: 'renderNextStepsMarkdown: 多行 required 不产生空破折号行',
    run: () => {
      const md = renderNextStepsMarkdown([
        {
          step_id: 'failure-recovery',
          source: 'harness',
          when: 'failure_recovery',
          kind: 'required',
          priority: 0,
          message:
            '以下 init 任务失败需先修复：\n- task-a: failed\n\n修复后重新执行 `/framework-init`',
        },
      ]);
      assert(md.includes('- 以下 init 任务失败需先修复：'), md);
      assert(md.includes('  - task-a: failed'), md);
      assert(md.includes('修复后重新执行 `/framework-init`'), md);
      assert(!/\n- \n/.test(md), md);
      assert(!/^- $/m.test(md), md);
    },
  },
  {
    name: 'renderNextStepsMarkdown: 多项 failure 子项同级',
    run: () => {
      const md = renderNextStepsMarkdown([
        {
          step_id: 'failure-recovery',
          source: 'harness',
          when: 'failure_recovery',
          kind: 'required',
          priority: 0,
          message:
            '以下 init 任务失败需先修复：\n- task-a: failed\n- task-b: failed\n\n修复后重新执行 `/framework-init`',
        },
      ]);
      assert(md.includes('  - task-a: failed'), md);
      assert(md.includes('  - task-b: failed'), md);
      assert(Boolean(md.match(/  - task-a: failed\r?\n  - task-b: failed/)), md);
      assert(!md.includes('  - task-a: failed\n    - task-b'), md);
      assert(md.includes('  修复后重新执行 `/framework-init`'), md);
    },
  },
  {
    name: 'deriveInitNextSteps: 多项 failure recovery 结构化 message',
    run: () => {
      const steps = deriveInitNextSteps(
        baseLog([
          { task_id: 'task-a', action: 'run', status: 'failed', message: 'boom-a' },
          { task_id: 'task-b', action: 'run', status: 'failed', message: 'boom-b' },
        ]),
      );
      assert(steps.length === 1 && steps[0]!.when === 'failure_recovery', JSON.stringify(steps));
      const msg = steps[0]!.message;
      assert(msg.includes('以下 init 任务失败需先修复：'), msg);
      assert(msg.includes('- task-a: boom-a'), msg);
      assert(msg.includes('- task-b: boom-b'), msg);
      const md = renderNextStepsMarkdown(steps);
      assert(md.includes('  - task-a: boom-a'), md);
      assert(md.includes('  - task-b: boom-b'), md);
    },
  },
  {
    name: 'drift keep 不触发 init_rerun',
    run: () => {
      const root = mkProject();
      writeMinimalConfig(root);
      writeCursorSkillStub(root, 'catalog-bootstrap');
      writeCursorSkillStub(root, 'goal-mode');
      const plan = {
        schema_version: '1.0' as const,
        scope: 'project' as const,
        mode: 'update' as const,
        generated_at: new Date().toISOString(),
        tasks: [
          {
            id: 'materialize-adapter:cursor',
            title: 'm',
            category: 'adapter',
            scope: 'project' as const,
            deps: [] as string[],
            status: 'needed' as const,
            default_action: 'run' as const,
            skippable: true,
            allowed_actions: ['run', 'skip'] as Array<'run' | 'skip'>,
          },
        ],
      };
      const steps = deriveInitNextSteps(
        baseLog([
          {
            task_id: 'materialize-adapter:cursor',
            action: 'skip',
            status: 'skipped',
            message: 'drift 默认保留',
            reason: 'drift_default_keep',
          },
        ]),
        phase1Ctx(root, plan),
      );
      assert(!steps.some(s => s.when === 'init_rerun'), JSON.stringify(steps));
    },
  },
  {
    name: 'probeCatalogReadiness: missing vs empty',
    run: () => {
      const root = mkProject();
      writeMinimalConfig(root);
      assert(probeCatalogReadiness(root).state === 'missing', 'missing');
      fs.writeFileSync(path.join(root, 'doc', 'module-catalog.yaml'), 'modules: []\n', 'utf-8');
      assert(probeCatalogReadiness(root).state === 'empty', 'empty');
    },
  },
  {
    name: '主建议存在时仍追加 always_optional goal-mode',
    run: () => {
      const root = mkProject();
      writeMinimalConfig(root);
      fs.writeFileSync(path.join(root, 'doc', 'module-catalog.yaml'), CATALOG_MODULE_YAML('Wallet'), 'utf-8');
      fs.writeFileSync(path.join(root, 'doc', 'glossary.yaml'), GLOSSARY_YAML('Wallet'), 'utf-8');
      writeValidModuleGraph(root, 'Wallet');
      writeCursorSkillStub(root, 'spec');
      writeCursorSkillStub(root, 'goal-mode');
      const steps = deriveInitNextSteps(baseLog([]), phase1Ctx(root));
      assert(steps.some(s => s.when === 'feature_ready' && s.skill_id === 'spec'), JSON.stringify(steps));
      assert(steps.some(s => s.when === 'always_optional' && s.skill_id === 'goal-mode'), JSON.stringify(steps));
    },
  },
  {
    name: 'catalog 空时主建议与 goal-mode 可并存',
    run: () => {
      const root = mkProject();
      writeMinimalConfig(root);
      writeCursorSkillStub(root, 'catalog-bootstrap');
      writeCursorSkillStub(root, 'goal-mode');
      const steps = deriveInitNextSteps(baseLog([]), phase1Ctx(root));
      assert(steps.some(s => s.when === 'catalog_empty'), JSON.stringify(steps));
      assert(steps.some(s => s.when === 'always_optional' && s.skill_id === 'goal-mode'), JSON.stringify(steps));
    },
  },
  {
    name: '损坏 code-graph.yaml 时 harness required 修复，无 graph_gap / feature / goal-mode',
    run: () => {
      const root = mkProject();
      writeGraphGatedProject(root);
      writeCorruptModuleGraph(root, 'Wallet');
      writeCursorSkillStub(root, 'code-graph');
      writeCursorSkillStub(root, 'plan');
      writeCursorSkillStub(root, 'goal-mode');
      const steps = deriveInitNextSteps(baseLog([]), {
        ...phase1Ctx(root),
        workflowSpec: GRAPH_GATED_SPEC,
      });
      const repair = steps.find(s => s.when === 'module-graph_corrupt');
      assert(Boolean(repair), JSON.stringify(steps));
      assert(repair!.source === 'harness' && repair!.kind === 'required', JSON.stringify(repair));
      assert((repair!.message.includes('nodes 须为数组') || repair!.message.includes('无效')), repair!.message);
      assertModuleGraphRepairCopy(repair!);
      assert(!steps.some(s => s.when === 'graph_gap'), JSON.stringify(steps));
      assert(!steps.some(s => s.when === 'feature_ready'), JSON.stringify(steps));
      assert(!steps.some(s => s.skill_id === 'goal-mode'), JSON.stringify(steps));
    },
  },
  {
    name: 'anchor 文件缺失时 module-graph blocked，不误推 feature_ready',
    run: () => {
      const root = mkProject();
      writeGraphGatedProject(root);
      writeGraphMissingAnchorFile(root, 'Wallet');
      writeCursorSkillStub(root, 'plan');
      const steps = deriveInitNextSteps(baseLog([]), {
        ...phase1Ctx(root),
        workflowSpec: GRAPH_GATED_SPEC,
      });
      assert(steps.some(s => s.when === 'module-graph_blocked'), JSON.stringify(steps));
      assertModuleGraphRepairCopy(steps.find(s => s.when === 'module-graph_blocked')!);
      assert(!steps.some(s => s.when === 'feature_ready'), JSON.stringify(steps));
      assert(!steps.some(s => s.when === 'graph_gap'), JSON.stringify(steps));
    },
  },
  {
    name: 'core 节点 hash 不一致时 module-graph blocked，不误推 feature_ready',
    run: () => {
      const root = mkProject();
      writeGraphGatedProject(root);
      writeGraphCoreHashMismatch(root, 'Wallet');
      writeCursorSkillStub(root, 'plan');
      const steps = deriveInitNextSteps(baseLog([]), {
        ...phase1Ctx(root),
        workflowSpec: GRAPH_GATED_SPEC,
      });
      assert(steps.some(s => s.when === 'module-graph_blocked'), JSON.stringify(steps));
      assertModuleGraphRepairCopy(steps.find(s => s.when === 'module-graph_blocked')!);
      assert((steps.find(s => s.when === 'module-graph_blocked')!.message.includes('锚定 hash')), JSON.stringify(steps));
      assert(!steps.some(s => s.when === 'feature_ready'), JSON.stringify(steps));
    },
  },
  {
    name: 'probe 异常时 harness required 修复，文案不含 framework-init，无 goal-mode',
    run: () => {
      const root = mkProject();
      writeGraphProbeFailureProject(root);
      writeCursorSkillStub(root, 'goal-mode');
      writeCursorSkillStub(root, 'plan');
      const steps = deriveInitNextSteps(baseLog([]), {
        ...phase1Ctx(root),
        workflowSpec: GRAPH_GATED_SPEC,
      });
      const repair = steps.find(s => s.when === 'module-graph_corrupt');
      assert(Boolean(repair), JSON.stringify(steps));
      assert(repair!.source === 'harness' && repair!.kind === 'required', JSON.stringify(repair));
      assertModuleGraphRepairCopy(repair!);
      assert((repair!.message.includes('探测失败') || repair!.message.includes('无效')), repair!.message);
      assert(!steps.some(s => s.skill_id === 'goal-mode'), JSON.stringify(steps));
      assert(!steps.some(s => s.when === 'graph_gap'), JSON.stringify(steps));
    },
  },
  {
    name: 'catalog corrupt 不追加 always_optional',
    run: () => {
      const root = mkProject();
      writeMinimalConfig(root);
      fs.writeFileSync(path.join(root, 'doc', 'module-catalog.yaml'), ':\n- bad\n', 'utf-8');
      writeCursorSkillStub(root, 'goal-mode');
      const steps = deriveInitNextSteps(baseLog([]), phase1Ctx(root));
      assert(steps.every(s => s.kind === 'required'), JSON.stringify(steps));
      assert(!steps.some(s => s.skill_id === 'goal-mode'), JSON.stringify(steps));
    },
  },
  {
    name: 'loadDefaultWorkflowSpec 可读',
    run: () => {
      const spec = loadDefaultWorkflowSpec(FRAMEWORK_DIR);
      assert(spec.artifacts.some(a => a.id === 'module-graph'), 'module-graph');
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
