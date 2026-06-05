// template-renderer.unit.test.ts

import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  assertNoUnreplacedPlaceholders,
  buildAgentsTemplateVars,
  buildArchitectureSummary,
  renderAgentsTemplate,
} from '../../scripts/utils/template-renderer';

const HARNESS_ROOT = path.join(__dirname, '../..');
const FRAMEWORK_ROOT = path.join(HARNESS_ROOT, '..');

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tpl-render-'));
}

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'buildArchitectureSummary uses DSL reference not inline export file',
    run: () => {
      const s = buildArchitectureSummary({
        outer_layers: [{ id: '01-Product' }, { id: '05-SystemBase' }],
        module_inner_layers: ['shared', 'data', 'domain', 'presentation'],
        cross_module_exports_file: 'Index.ets',
      });
      assert(s.includes('cross_module_exports_file'), s);
      assert(!s.includes('Index.ets'), s);
    },
  },
  {
    name: 'renderAgentsTemplate replaces EXTENSION_SKILL_SECTION',
    run: () => {
      const tpl = 'before\n{{EXTENSION_SKILL_SECTION}}\nafter {{PROJECT_NAME}}';
      const out = renderAgentsTemplate(tpl, {
        EXTENSION_SKILL_SECTION: '',
        PROJECT_NAME: 'Demo',
      });
      assert(!out.includes('{{'), out);
      assert(out.includes('Demo'), out);
    },
  },
  {
    name: 'assertNoUnreplacedPlaceholders throws on leftover token',
    run: () => {
      let threw = false;
      try {
        assertNoUnreplacedPlaceholders('{{FOO}}');
      } catch {
        threw = true;
      }
      assert(threw, 'expected throw');
    },
  },
  {
    name: 'buildAgentsTemplateVars without architectureSummary matches DSL style',
    run: () => {
      const root = mkTmp();
      try {
        const vars = buildAgentsTemplateVars(
          {
            project_name: 'T',
            project_profile: { name: 'hmos-app', sub_variant: 'app' },
            architecture: {
              outer_layers: [{ id: 'L1' }],
              module_inner_layers: ['a', 'b'],
              cross_module_exports_file: 'X.ets',
            },
            paths: { extension_dir: 'doc/extensions' },
          },
          {
            entryFile: 'CLAUDE.md',
            projectRoot: root,
            frameworkRoot: FRAMEWORK_ROOT,
          },
        );
        assert(vars.EXTENSION_SKILL_SECTION !== undefined);
        assert(vars.ARCHITECTURE_SUMMARY.includes('cross_module_exports_file'));
        assert(!vars.ARCHITECTURE_SUMMARY.includes('X.ets'));
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
];

export function runAll(): UnitCaseResult[] {
  return cases.map(c => {
    try {
      c.run();
      return { name: c.name, ok: true };
    } catch (e) {
      return { name: c.name, ok: false, error: (e as Error).message };
    }
  });
}
