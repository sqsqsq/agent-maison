import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  detectRepoLayout,
  frameworkAbs,
  frameworkLogicalRelPath,
  frameworkPhysicalRelPath,
  inferRepoLayout,
  resolveFrameworkPrefixedPath,
} from '../../repo-layout';
import { featurePhaseReportsDir } from '../../config';
import { DEFAULT_LAYOUT, externalStandaloneLayout } from '../utils/layout-test-helper';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function mkTmp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeHarnessRunner(root: string): void {
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'harness-runner.ts'), '// stub\n', 'utf8');
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'inferRepoLayout standalone',
    run: () => {
      const root = mkTmp('layout-standalone-');
      fs.mkdirSync(path.join(root, 'skills', 'x'), { recursive: true });
      const layout = inferRepoLayout(root);
      assert(layout.kind === 'standalone', 'kind');
      assert(layout.frameworkRoot === path.resolve(root), 'frameworkRoot');
      assert(layout.frameworkRel === '', 'frameworkRel');
    },
  },
  {
    name: 'inferRepoLayout consumer',
    run: () => {
      const host = mkTmp('layout-consumer-');
      fs.mkdirSync(path.join(host, 'framework', 'workflows'), { recursive: true });
      const layout = inferRepoLayout(host);
      assert(layout.kind === 'consumer', 'kind');
      assert(layout.frameworkRoot === path.join(host, 'framework'), 'frameworkRoot');
      assert(layout.frameworkRel === 'framework', 'frameworkRel');
    },
  },
  {
    name: 'detectRepoLayout consumer grandparent heuristic',
    run: () => {
      const host = mkTmp('layout-detect-consumer-');
      const harness = path.join(host, 'framework', 'harness');
      writeHarnessRunner(harness);
      fs.mkdirSync(path.join(host, 'framework', 'skills', 'a'), { recursive: true });
      const layout = detectRepoLayout(harness);
      assert(layout.kind === 'consumer', 'kind');
      assert(layout.projectRoot === path.resolve(host), 'projectRoot');
    },
  },
  {
    name: 'frameworkPhysicalRelPath vs frameworkLogicalRelPath',
    run: () => {
      const standalone = inferRepoLayout(DEFAULT_LAYOUT.projectRoot);
      assert(
        frameworkPhysicalRelPath(standalone, 'docs', 'x.yaml') === 'docs/x.yaml',
        'physical standalone',
      );
      assert(
        frameworkLogicalRelPath('docs', 'x.yaml') === 'framework/docs/x.yaml',
        'logical',
      );
      const host = mkTmp('layout-rel-consumer-');
      fs.mkdirSync(path.join(host, 'framework', 'skills'), { recursive: true });
      const consumer = inferRepoLayout(host);
      assert(
        frameworkPhysicalRelPath(consumer, 'docs', 'x.yaml') === 'framework/docs/x.yaml',
        'physical consumer',
      );
    },
  },
  {
    name: 'resolveFrameworkPrefixedPath dual branch',
    run: () => {
      const host = mkTmp('layout-prefixed-');
      fs.mkdirSync(path.join(host, 'framework', 'skills'), { recursive: true });
      const abs = resolveFrameworkPrefixedPath(host, 'framework/skills/foo');
      assert(abs === path.join(host, 'framework', 'skills', 'foo'), 'consumer prefixed');
      const standaloneRoot = DEFAULT_LAYOUT.projectRoot;
      const abs2 = resolveFrameworkPrefixedPath(standaloneRoot, 'framework/skills/foo');
      assert(abs2 === path.join(standaloneRoot, 'skills', 'foo'), 'standalone strip');
    },
  },
  {
    name: 'resolveFrameworkPrefixedPath external standalone frameworkRoot',
    run: () => {
      const host = mkTmp('layout-ext-prefixed-');
      const layout = externalStandaloneLayout(host);
      const abs = resolveFrameworkPrefixedPath(host, 'framework/docs/README.md', layout);
      assert(
        abs === path.join(DEFAULT_LAYOUT.frameworkRoot, 'docs', 'README.md'),
        `expected repo docs path, got ${abs}`,
      );
    },
  },
  {
    name: 'featurePhaseReportsDir standalone uses harness/reports not framework/harness',
    run: () => {
      const root = DEFAULT_LAYOUT.projectRoot;
      const dir = featurePhaseReportsDir(root, '_global', 'docs', DEFAULT_LAYOUT.frameworkRoot);
      const rel = path.relative(root, dir).replace(/\\/g, '/');
      assert(rel.startsWith('harness/reports/'), `expected harness/reports, got ${rel}`);
      assert(!rel.startsWith('framework/harness/'), `wrong prefix: ${rel}`);
    },
  },
  {
    name: 'frameworkAbs',
    run: () => {
      const layout = DEFAULT_LAYOUT;
      assert(
        frameworkAbs(layout, 'specs', 'phase-rules') ===
          path.join(layout.frameworkRoot, 'specs', 'phase-rules'),
        'frameworkAbs',
      );
    },
  },
];

export async function runAll(): Promise<UnitCaseResult[]> {
  const out: UnitCaseResult[] = [];
  for (const c of cases) {
    try {
      c.run();
      out.push({ name: c.name, ok: true });
    } catch (err) {
      out.push({ name: c.name, ok: false, error: (err as Error).message });
    }
  }
  return out;
}
