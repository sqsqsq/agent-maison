// chrys-opencode-adapter.unit.test.ts — chrys + opencode adapter headless & materialization

import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import YAML from 'yaml';

import { clearFrameworkConfigCache } from '../../config';
import { detectRepoLayout, harnessRootFromLayout } from '../../repo-layout';
import { __testing as checkInitTesting } from '../../scripts/check-init';
import { executeInitTask, type InitExecutionContext } from '../../scripts/utils/init-task-executor';
import {
  defaultHeadlessInvokePlan,
  resolveHeadlessInvokePlan,
  validateHeadlessBinaryForPlan,
} from '../../scripts/utils/agent-invoke';
import {
  loadGoalCapability,
  validateGoalCapabilityForRunner,
} from '../../scripts/utils/goal-adapter-capability';
import {
  ensurePersonalSetup,
} from '../../scripts/utils/personal-setup-gate';
import type { UnitCaseResult } from '../run-unit';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const FRAMEWORK_ROOT = REPO_ROOT;

const unattended = {
  write_mode: 'workspace-write' as const,
  approval_mode: 'never' as const,
};

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'chrys-opencode-'));
}

function minimalArchitecture(): Record<string, unknown> {
  return {
    outer_layers: [{ id: 'L1', can_depend_on: [], intra_layer_deps: 'forbid' }],
    module_inner_layers: ['shared'],
    inner_dependency_direction: 'upward',
    cross_module_exports_file: 'index.ets',
  };
}

function sampleVars(overrides: Partial<{
  PROMPT_FILE: string;
  PROMPT: string;
  PROJECT_ROOT: string;
}> = {}) {
  return {
    PROMPT_FILE: '/tmp/phases/spec/prompt.md',
    PROMPT: '# Goal phase\nline2',
    SKILL_PATH: '/tmp/skills/spec',
    PROJECT_ROOT: '/proj/root',
    FRAMEWORK_ROOT: FRAMEWORK_ROOT,
    FEATURE: 'demo',
    PHASE: 'spec',
    ...overrides,
  };
}

function mkInitCtx(root: string, materialized: string[]): InitExecutionContext {
  const layout = detectRepoLayout(path.join(__dirname, '../..'));
  return {
    projectRoot: root,
    harnessRoot: harnessRootFromLayout(layout),
    plan: {
      schema_version: '1.0',
      scope: 'project',
      mode: 'create',
      generated_at: '',
      tasks: [],
    },
    materializedAdapters: materialized,
  };
}

function materializeAdapter(root: string, adapter: string, materialized: string[]) {
  const ctx = mkInitCtx(root, materialized);
  return executeInitTask(
    {
      id: `materialize-adapter:${adapter}`,
      title: `物化 adapter: ${adapter}`,
      category: 'adapter-bundle',
      scope: 'project',
      deps: ['ensure-config'],
      status: 'needed',
      default_action: 'run',
      skippable: false,
      allowed_actions: ['run'],
      params: { adapter },
    },
    'run',
    ctx,
  );
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'resolveHeadlessInvokePlan: chrys uses --task PROMPT_FILE',
    run: () => {
      const gc = loadGoalCapability(FRAMEWORK_ROOT, 'chrys');
      const vars = sampleVars();
      const plan = resolveHeadlessInvokePlan(
        'chrys',
        gc.capability!,
        unattended,
        vars.PROMPT,
        vars,
      );
      const taskIdx = plan.argv.indexOf('--task');
      assert(taskIdx >= 0, plan.argv.join(' '));
      assert.strictEqual(plan.argv[taskIdx + 1], vars.PROMPT_FILE);
      assert(plan.argv.includes('-C'), plan.argv.join(' '));
      assert.strictEqual(plan.argv[plan.argv.indexOf('-C') + 1], vars.PROJECT_ROOT);
      assert(plan.argv.includes('--agent'), plan.argv.join(' '));
      assert(plan.argv.includes('--json'), plan.argv.join(' '));
      assert(!plan.useStdin, 'chrys uses file prompt');
    },
  },
  {
    name: 'resolveHeadlessInvokePlan: opencode stdin plan with resolvedBinary',
    run: () => {
      const gc = loadGoalCapability(FRAMEWORK_ROOT, 'opencode');
      const vars = sampleVars();
      const plan = resolveHeadlessInvokePlan(
        'opencode',
        gc.capability!,
        unattended,
        vars.PROMPT,
        vars,
      );
      assert(plan.argv.includes('run'), plan.argv.join(' '));
      assert(plan.argv.includes('--dangerously-skip-permissions'), plan.argv.join(' '));
      const dirIdx = plan.argv.indexOf('--dir');
      assert(dirIdx >= 0, plan.argv.join(' '));
      assert.strictEqual(plan.argv[dirIdx + 1], vars.PROJECT_ROOT);
      assert.strictEqual(plan.useStdin, true);
      assert.strictEqual(plan.stdin, vars.PROMPT);
      assert(plan.resolvedBinary !== undefined, 'resolvedBinary must be set');
      assert(!plan.argv.includes('agent-cli'), plan.argv.join(' '));
    },
  },
  {
    name: 'preflight: empty PROMPT_FILE chrys falls back to positional prompt',
    run: () => {
      const gc = loadGoalCapability(FRAMEWORK_ROOT, 'chrys');
      const probeVars = sampleVars({ PROMPT_FILE: '', PROMPT: 'preflight-probe', PROJECT_ROOT: '/proj' });
      const plan = resolveHeadlessInvokePlan(
        'chrys',
        gc.capability!,
        unattended,
        'preflight-probe',
        probeVars,
      );
      assert(!plan.argv.includes('--task'), plan.argv.join(' '));
      assert(plan.argv.includes('preflight-probe'), plan.argv.join(' '));
      assert('resolvedBinary' in plan, 'resolvedBinary key must be set');

      if (process.platform === 'win32') {
        const tmpLocal = fs.mkdtempSync(path.join(os.tmpdir(), 'chrys-bin-'));
        const chrysDir = path.join(tmpLocal, 'chrys', 'bin');
        fs.mkdirSync(chrysDir, { recursive: true });
        fs.writeFileSync(path.join(chrysDir, 'chrys.exe'), '');
        const origLocal = process.env.LOCALAPPDATA;
        const origPath = process.env.PATH;
        try {
          process.env.LOCALAPPDATA = tmpLocal;
          process.env.PATH = 'C:\\nonexistent';
          const mocked = resolveHeadlessInvokePlan(
            'chrys',
            gc.capability!,
            unattended,
            'preflight-probe',
            probeVars,
          );
          const v = validateHeadlessBinaryForPlan('chrys', mocked);
          assert(v.ok, (v as { message?: string }).message);
        } finally {
          if (origLocal === undefined) delete process.env.LOCALAPPDATA;
          else process.env.LOCALAPPDATA = origLocal;
          process.env.PATH = origPath;
          fs.rmSync(tmpLocal, { recursive: true, force: true });
        }
      }
    },
  },
  {
    name: 'preflight: opencode still stdin plan with resolvedBinary',
    run: () => {
      const gc = loadGoalCapability(FRAMEWORK_ROOT, 'opencode');
      const probeVars = sampleVars({ PROMPT_FILE: '', PROMPT: 'preflight-probe', PROJECT_ROOT: '/proj' });
      const plan = resolveHeadlessInvokePlan(
        'opencode',
        gc.capability!,
        unattended,
        'preflight-probe',
        probeVars,
      );
      assert.strictEqual(plan.useStdin, true);
      assert.strictEqual(plan.stdin, 'preflight-probe');
      assert('resolvedBinary' in plan, 'resolvedBinary key must be set');

      const tmpBin = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-bin-'));
      const origPath = process.env.PATH;
      try {
        if (process.platform === 'win32') {
          fs.writeFileSync(path.join(tmpBin, 'opencode.cmd'), '@echo off\n');
        } else {
          fs.writeFileSync(path.join(tmpBin, 'opencode'), '#!/bin/sh\n');
          fs.chmodSync(path.join(tmpBin, 'opencode'), 0o755);
        }
        process.env.PATH = tmpBin;
        const mocked = resolveHeadlessInvokePlan(
          'opencode',
          gc.capability!,
          unattended,
          'preflight-probe',
          probeVars,
        );
        const v = validateHeadlessBinaryForPlan('opencode', mocked);
        assert(v.ok, (v as { message?: string }).message);
      } finally {
        process.env.PATH = origPath;
        fs.rmSync(tmpBin, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'defaultHeadlessInvokePlan: chrys does not fall back to agent-cli stdin',
    run: () => {
      const plan = defaultHeadlessInvokePlan('chrys', unattended, 'probe');
      assert(!plan.argv.includes('agent-cli'), plan.argv.join(' '));
      assert(plan.argv.includes('run'), plan.argv.join(' '));
      assert(plan.argv.includes('probe'), plan.argv.join(' '));
    },
  },
  {
    name: 'defaultHeadlessInvokePlan: opencode does not fall back to agent-cli stdin',
    run: () => {
      const plan = defaultHeadlessInvokePlan('opencode', unattended, 'probe');
      assert(!plan.argv.includes('agent-cli'), plan.argv.join(' '));
      assert.strictEqual(plan.useStdin, true);
      assert.strictEqual(plan.stdin, 'probe');
    },
  },
  {
    name: 'loadGoalCapability: chrys and opencode valid external_runner',
    run: () => {
      for (const name of ['chrys', 'opencode'] as const) {
        const gc = loadGoalCapability(FRAMEWORK_ROOT, name);
        assert(gc.present, `${name} present`);
        assert(gc.valid, `${name}: ${gc.issues.join(';')}`);
        assert.strictEqual(gc.capability?.mode, 'external_runner');
        const v = validateGoalCapabilityForRunner(FRAMEWORK_ROOT, name, unattended);
        assert(v.ok, `${name}: ${v.issues.join(';')}`);
      }
    },
  },
  {
    name: 'materialize: generic+chrys share .agents bundle; opencode uses own .opencode/skill',
    run: () => {
      const root = mkTmp();
      fs.writeFileSync(
        path.join(root, 'framework.config.json'),
        JSON.stringify(
          {
            schema_version: '1.1',
            project_name: 'triple',
            materialized_adapters: ['generic', 'chrys', 'opencode'],
            architecture: minimalArchitecture(),
            paths: { features_dir: 'doc/features' },
          },
          null,
          2,
        ),
      );
      clearFrameworkConfigCache();

      const adapters = ['generic', 'chrys', 'opencode'];
      const agentsSkillRel = '.agents/skills/coding/SKILL.md';
      const opencodeSkillRel = '.opencode/skill/coding/SKILL.md';
      let agentsContent: string | null = null;

      for (const adapter of adapters) {
        const result = materializeAdapter(root, adapter, adapters);
        if (adapter === 'opencode') {
          // opencode writes its own .opencode/skill, NOT the shared .agents bundle.
          assert(fs.existsSync(path.join(root, opencodeSkillRel)), `opencode .opencode/skill missing: ${result.message}`);
          continue;
        }
        const skillPath = path.join(root, agentsSkillRel);
        assert(fs.existsSync(skillPath), `${adapter}: ${result.message}`);
        const content = fs.readFileSync(skillPath, 'utf-8');
        if (agentsContent !== null) {
          assert.strictEqual(content, agentsContent, `${adapter} changed .agents bridge content`);
        }
        agentsContent = content;
        if (adapter !== 'generic') {
          const effects = result.file_results?.map(r => r.effect) ?? [];
          assert(
            effects.includes('unchanged') || effects.includes('delegated') || effects.every(e => e === 'created'),
            `${adapter} unexpected effects: ${effects.join(',')}`,
          );
        }
      }

      // Same shared skills-bridge template → opencode's .opencode/skill bridge is byte-identical
      // to generic/chrys's .agents/skills bridge (different dir, same content, no conflict).
      const ocContent = fs.readFileSync(path.join(root, opencodeSkillRel), 'utf-8');
      assert.strictEqual(ocContent, agentsContent, 'opencode bridge content must equal shared .agents bridge');

      fs.rmSync(root, { recursive: true, force: true });
      clearFrameworkConfigCache();
    },
  },
  {
    name: 'materialize: shared AGENTS.md is byte-identical across adapters and order',
    run: () => {
      const root = mkTmp();
      const adapters = ['generic', 'cursor', 'codex', 'chrys', 'opencode'];
      fs.writeFileSync(
        path.join(root, 'framework.config.json'),
        JSON.stringify(
          {
            schema_version: '1.1',
            project_name: 'shared-entry',
            materialized_adapters: adapters,
            architecture: minimalArchitecture(),
            paths: { features_dir: 'doc/features' },
          },
          null,
          2,
        ),
      );
      clearFrameworkConfigCache();

      let expected: Buffer | null = null;
      for (const adapter of adapters) {
        materializeAdapter(root, adapter, adapters);
        const agentsPath = path.join(root, 'AGENTS.md');
        assert(fs.existsSync(agentsPath), `${adapter}: AGENTS.md missing`);
        const current = fs.readFileSync(agentsPath);
        if (expected === null) {
          expected = current;
        } else {
          assert(
            current.equals(expected),
            `${adapter}: shared AGENTS.md changed after materialization`,
          );
        }
      }

      const text = expected!.toString('utf-8');
      assert(!text.includes('激活的 agent adapter'), text);

      fs.rmSync(root, { recursive: true, force: true });
      clearFrameworkConfigCache();
    },
  },
  {
    name: 'materialize: generic .codex root + chrys fixed .agents are independent',
    run: () => {
      const root = mkTmp();
      fs.writeFileSync(
        path.join(root, 'framework.config.json'),
        JSON.stringify(
          {
            schema_version: '1.1',
            project_name: 'split-root',
            materialized_adapters: ['generic', 'chrys'],
            architecture: minimalArchitecture(),
            paths: {
              features_dir: 'doc/features',
              agent_bundle_root: '.codex',
            },
          },
          null,
          2,
        ),
      );
      clearFrameworkConfigCache();

      materializeAdapter(root, 'generic', ['generic', 'chrys']);
      materializeAdapter(root, 'chrys', ['generic', 'chrys']);

      const codexSkill = path.join(root, '.codex', 'skills', 'coding', 'SKILL.md');
      const agentsSkill = path.join(root, '.agents', 'skills', 'coding', 'SKILL.md');
      assert(fs.existsSync(codexSkill), 'generic .codex skill');
      assert(fs.existsSync(agentsSkill), 'chrys .agents skill');
      assert.notStrictEqual(path.dirname(codexSkill), path.dirname(agentsSkill), 'different bundle roots');

      fs.rmSync(root, { recursive: true, force: true });
      clearFrameworkConfigCache();
    },
  },
  {
    name: 'inline config normalize: generic+chrys coexist still bridge',
    run: () => {
      const root = mkTmp();
      fs.writeFileSync(
        path.join(root, 'framework.config.json'),
        JSON.stringify(
          {
            schema_version: '1.1',
            project_name: 'inline-norm',
            agent_adapter: 'generic',
            materialized_adapters: ['generic', 'chrys'],
            architecture: minimalArchitecture(),
            paths: {
              features_dir: 'doc/features',
              agent_bundle_root: '.agents',
              agent_bundle_skill_mode: 'inline',
            },
          },
          null,
          2,
        ),
      );
      const raw = checkInitTesting.loadRawFrameworkConfig(root);
      const bundle = checkInitTesting.resolveBundleForInitInspect('generic', raw, root);
      assert.strictEqual(bundle?.skillMode, 'bridge');
      const adapter = checkInitTesting.loadAdapter('generic');
      checkInitTesting.applyGenericAdapterBundle(adapter, bundle!);
      assert.strictEqual(
        adapter.templateFiles.some(f => f.kind === 'materialized'),
        false,
        'must not materialize inline skills',
      );

      fs.rmSync(root, { recursive: true, force: true });
    },
  },
  {
    name: 'personal-setup-gate: single chrys auto ensure agent_adapter',
    run: () => {
      const root = mkTmp();
      fs.writeFileSync(
        path.join(root, 'framework.config.json'),
        JSON.stringify(
          {
            schema_version: '1.1',
            project_name: 'chrys-only',
            materialized_adapters: ['chrys'],
            architecture: minimalArchitecture(),
            paths: { features_dir: 'doc/features' },
          },
          null,
          2,
        ),
      );
      fs.writeFileSync(path.join(root, 'AGENTS.md'), '# stub\n');
      clearFrameworkConfigCache();

      const payload = ensurePersonalSetup(root);
      assert.strictEqual(payload.ok, true);
      assert.strictEqual(payload.ensured, 'auto_single_adapter');
      assert.strictEqual(payload.activeAdapter, 'chrys');

      fs.rmSync(root, { recursive: true, force: true });
      clearFrameworkConfigCache();
    },
  },
  {
    name: 'personal-setup-gate: single opencode auto ensure agent_adapter',
    run: () => {
      const root = mkTmp();
      fs.writeFileSync(
        path.join(root, 'framework.config.json'),
        JSON.stringify(
          {
            schema_version: '1.1',
            project_name: 'opencode-only',
            materialized_adapters: ['opencode'],
            architecture: minimalArchitecture(),
            paths: { features_dir: 'doc/features' },
          },
          null,
          2,
        ),
      );
      fs.writeFileSync(path.join(root, 'AGENTS.md'), '# stub\n');
      clearFrameworkConfigCache();

      const payload = ensurePersonalSetup(root);
      assert.strictEqual(payload.ok, true);
      assert.strictEqual(payload.activeAdapter, 'opencode');

      fs.rmSync(root, { recursive: true, force: true });
      clearFrameworkConfigCache();
    },
  },
  {
    name: 'personal-setup-gate: generic+chrys+opencode needs_adapter_choice',
    run: () => {
      const root = mkTmp();
      fs.writeFileSync(
        path.join(root, 'framework.config.json'),
        JSON.stringify(
          {
            schema_version: '1.1',
            project_name: 'multi',
            materialized_adapters: ['generic', 'chrys', 'opencode'],
            architecture: minimalArchitecture(),
            paths: { features_dir: 'doc/features' },
          },
          null,
          2,
        ),
      );
      fs.writeFileSync(path.join(root, 'AGENTS.md'), '# stub\n');
      clearFrameworkConfigCache();

      const payload = ensurePersonalSetup(root);
      assert.strictEqual(payload.ok, false);
      assert.strictEqual(payload.code, 'needs_adapter_choice');
      assert.ok(payload.candidates.includes('chrys'));
      assert.ok(payload.candidates.includes('opencode'));

      fs.rmSync(root, { recursive: true, force: true });
      clearFrameworkConfigCache();
    },
  },
  {
    name: 'loadAdapter: chrys → .agents bundle, opencode → own .opencode bundle (AGENTS.md shared)',
    run: () => {
      const expectations: Record<string, { skillDir: string; rule: string }> = {
        chrys: { skillDir: '.agents/skills/', rule: '.agents/rules/interaction-renderer.md' },
        opencode: { skillDir: '.opencode/skill/', rule: '.opencode/rules/interaction-renderer.md' },
      };
      for (const name of ['chrys', 'opencode'] as const) {
        const adapter = checkInitTesting.loadAdapter(name);
        assert(adapter.yamlParseable, `${name} yaml`);
        assert(adapter.entryFile?.targetRel === 'AGENTS.md', `${name} entry`);
        const exp = expectations[name]!;
        const skillBridge = adapter.templateFiles.filter(f => f.targetRel.startsWith(exp.skillDir));
        assert(skillBridge.length > 0, `${name} skills bridge under ${exp.skillDir}`);
        assert(
          adapter.templateFiles.some(f => f.targetRel === exp.rule),
          `${name} interaction-renderer at ${exp.rule}`,
        );
      }
      // opencode must NOT materialize into the shared .agents bundle.
      const oc = checkInitTesting.loadAdapter('opencode');
      assert(
        !oc.templateFiles.some(f => f.targetRel.startsWith('.agents/')),
        'opencode must not write .agents/* (uses its own .opencode/)',
      );
    },
  },
  {
    name: 'codex: interaction-renderer contains S4 closed marker',
    run: () => {
      const rulePath = path.join(FRAMEWORK_ROOT, 'agents/codex/templates/rules/interaction-renderer.md');
      const text = fs.readFileSync(rulePath, 'utf-8');
      assert(text.includes('S4 已闭环'), 'codex interaction-renderer must declare S4 closed');
      assert(text.includes('confirmation-registry.yaml'), text);
    },
  },
  {
    name: 'codex: registry init.materialized_adapters includes codex option',
    run: () => {
      const registryPath = path.join(FRAMEWORK_ROOT, 'skills/reference/confirmation-registry.yaml');
      const registry = YAML.parse(fs.readFileSync(registryPath, 'utf-8')) as {
        entries?: Array<{ id?: string; options?: Array<{ value?: string }> }>;
      };
      const entry = registry.entries?.find(e => e.id === 'init.materialized_adapters');
      assert(entry, 'init.materialized_adapters entry missing');
      assert(
        entry!.options?.some(o => o.value === 'codex'),
        'codex option missing from registry',
      );
    },
  },
  {
    name: 'loadAdapter: codex declares .codex skill_bridge and AGENTS.md entry',
    run: () => {
      const adapter = checkInitTesting.loadAdapter('codex');
      assert(adapter.yamlParseable, 'codex yaml');
      assert.strictEqual(adapter.entryFile?.targetRel, 'AGENTS.md', 'codex entry');
      const skillBridge = adapter.templateFiles.filter(f =>
        f.targetRel.startsWith('.codex/skills/'),
      );
      assert(skillBridge.length > 0, 'codex skills bridge');
      assert(
        adapter.templateFiles.some(f => f.targetRel === '.codex/rules/interaction-renderer.md'),
        'codex interaction-renderer',
      );
    },
  },
];

export function runAll(): UnitCaseResult[] {
  return cases.map(c => {
    try {
      c.run();
      return { name: c.name, ok: true };
    } catch (e) {
      return { name: c.name, ok: false, error: (e as Error).stack ?? (e as Error).message };
    }
  });
}
