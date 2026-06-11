import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  clearFrameworkConfigCache,
  featureArtifactPath,
  normalizeArtifactFileName,
  relFeatureArtifact,
  resolveFeatureArtifact,
} from '../../config';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function mkProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'feat-artifact-'));
  fs.mkdirSync(path.join(root, 'doc', 'features', 'demo'), { recursive: true });
  return root;
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'normalizeArtifactFileName 四态归一',
    run: () => {
      assert(normalizeArtifactFileName('ut/mock-plan.yaml') === 'mock-plan.yaml', 'ut prefix');
      assert(normalizeArtifactFileName('mock-plan.yaml') === 'mock-plan.yaml', 'basename');
      assert(normalizeArtifactFileName('testing/test-plan.md') === 'test-plan.md', 'testing prefix');
      assert(normalizeArtifactFileName('test-plan.md') === 'test-plan.md', 'test-plan basename');
    },
  },
  {
    name: 'featureArtifactPath 无双层 ut/ut',
    run: () => {
      const root = mkProject();
      try {
        const a = featureArtifactPath(root, 'demo', 'ut/mock-plan.yaml');
        const b = featureArtifactPath(root, 'demo', 'mock-plan.yaml');
        assert(a === b, `paths differ: ${a} vs ${b}`);
        assert(a.endsWith(path.join('demo', 'ut', 'mock-plan.yaml')), `unexpected: ${a}`);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'featureArtifactPath testing 无双层',
    run: () => {
      const root = mkProject();
      try {
        const a = featureArtifactPath(root, 'demo', 'testing/test-plan.md');
        const b = featureArtifactPath(root, 'demo', 'test-plan.md');
        assert(a === b, `paths differ: ${a} vs ${b}`);
        assert(a.includes(`${path.sep}testing${path.sep}test-plan.md`), `unexpected: ${a}`);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'dual-read 仅 legacy 存在（扁平 PRD.md）',
    run: () => {
      const root = mkProject();
      try {
        const legacy = path.join(root, 'doc', 'features', 'demo', 'PRD.md');
        fs.writeFileSync(legacy, '# legacy prd\n');
        const r = resolveFeatureArtifact(root, 'demo', 'spec.md');
        assert(r.exists && r.usedLegacy && !r.legacyDuplicate, JSON.stringify(r));
        assert(r.actualPath === legacy, 'actual should be legacy PRD.md');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'dual-read canonical 优先 + legacyDuplicate',
    run: () => {
      const root = mkProject();
      try {
        const canonDir = path.join(root, 'doc', 'features', 'demo', 'spec');
        fs.mkdirSync(canonDir, { recursive: true });
        fs.writeFileSync(path.join(canonDir, 'spec.md'), '# new\n');
        fs.writeFileSync(path.join(root, 'doc', 'features', 'demo', 'PRD.md'), '# old\n');
        const r = resolveFeatureArtifact(root, 'demo', 'spec.md');
        assert(r.exists && !r.usedLegacy && r.legacyDuplicate, JSON.stringify(r));
        assert(r.actualPath.endsWith(path.join('spec', 'spec.md')), 'canonical wins');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'featureArtifactPath 对齐自定义 receipt_dir_pattern',
    run: () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'feat-artifact-rcpt-'));
      try {
        fs.mkdirSync(path.join(root, 'doc', 'features', 'demo'), { recursive: true });
        fs.writeFileSync(
          path.join(root, 'framework.config.json'),
          JSON.stringify(
            {
              schema_version: '1.1',
              project_name: 'rcpt-test',
              project_profile: { name: 'generic' },
              agent_adapter: 'generic',
              architecture: {
                outer_layers: [{ id: 'app', can_depend_on: [], intra_layer_deps: 'forbid' }],
                module_inner_layers: ['content'],
                inner_dependency_direction: 'upward',
                cross_module_exports_file: 'index.ts',
              },
              paths: {
                features_dir: 'doc/features',
                module_catalog: 'doc/module-catalog.yaml',
                glossary: 'doc/glossary.yaml',
                glossary_seed: 'doc/glossary-seed.txt',
                architecture_md: 'doc/architecture.md',
                receipt_dir_pattern: 'doc/features/<feature>/phases/<phase>',
              },
            },
            null,
            2,
          ),
        );
        clearFrameworkConfigCache();
        const abs = featureArtifactPath(root, 'demo', 'spec.md');
        const expected = path.join(root, 'doc', 'features', 'demo', 'phases', 'spec', 'spec.md');
        assert(abs === expected, `expected ${expected}, got ${abs}`);
        assert(
          relFeatureArtifact(root, 'demo', 'spec.md') === 'doc/features/demo/phases/spec/spec.md',
          relFeatureArtifact(root, 'demo', 'spec.md'),
        );
      } finally {
        clearFrameworkConfigCache();
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'relFeatureArtifact 全局契约文件尊重 featuresDirAbs',
    run: () => {
      const root = mkProject();
      const altFeatures = path.join(root, 'alt', 'features');
      try {
        fs.mkdirSync(path.join(altFeatures, 'demo'), { recursive: true });
        fs.writeFileSync(path.join(altFeatures, 'demo', 'acceptance.yaml'), 'criteria: []\n');
        const rel = relFeatureArtifact(root, 'demo', 'acceptance.yaml', {
          featuresDirAbs: altFeatures,
        });
        assert(rel === 'alt/features/demo/acceptance.yaml', rel);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'dual-read 仅 legacy 存在（design/design.md）',
    run: () => {
      const root = mkProject();
      try {
        const legacyDir = path.join(root, 'doc', 'features', 'demo', 'design');
        fs.mkdirSync(legacyDir, { recursive: true });
        const legacy = path.join(legacyDir, 'design.md');
        fs.writeFileSync(legacy, '# legacy plan\n');
        const r = resolveFeatureArtifact(root, 'demo', 'plan.md');
        assert(r.exists && r.usedLegacy && !r.legacyDuplicate, JSON.stringify(r));
        assert(r.actualPath === legacy, 'actual should be legacy design.md');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'dual-read plan canonical 优先 + legacyDuplicate（design/design.md）',
    run: () => {
      const root = mkProject();
      try {
        const canonDir = path.join(root, 'doc', 'features', 'demo', 'plan');
        fs.mkdirSync(canonDir, { recursive: true });
        fs.writeFileSync(path.join(canonDir, 'plan.md'), '# new\n');
        const legacyDir = path.join(root, 'doc', 'features', 'demo', 'design');
        fs.mkdirSync(legacyDir, { recursive: true });
        fs.writeFileSync(path.join(legacyDir, 'design.md'), '# old\n');
        const r = resolveFeatureArtifact(root, 'demo', 'plan.md');
        assert(r.exists && !r.usedLegacy && r.legacyDuplicate, JSON.stringify(r));
        assert(r.actualPath.endsWith(path.join('plan', 'plan.md')), 'canonical wins');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'exists=false 时 actualPath===canonicalPath',
    run: () => {
      const root = mkProject();
      try {
        const r = resolveFeatureArtifact(root, 'demo', 'plan.md');
        assert(!r.exists, 'should not exist');
        assert(r.actualPath === r.canonicalPath, 'actual equals canonical when missing');
        assert(
          relFeatureArtifact(root, 'demo', 'plan.md') === 'doc/features/demo/plan/plan.md',
          relFeatureArtifact(root, 'demo', 'plan.md'),
        );
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
];

export function runAll(): UnitCaseResult[] {
  return cases.map((c) => {
    try {
      c.run();
      return { name: c.name, ok: true };
    } catch (err) {
      return { name: c.name, ok: false, error: (err as Error).stack ?? (err as Error).message };
    }
  });
}
