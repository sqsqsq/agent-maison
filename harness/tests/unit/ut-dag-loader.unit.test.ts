import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { checkDagFilesParseable, loadDagFiles } from '../../scripts/check-ut';
import type { CheckContext } from '../../scripts/utils/types';
import type { UnitCaseResult } from './ut-artifact-validate.unit.test';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function makeCtx(root: string): CheckContext {
  return {
    projectRoot: root,
    frameworkRoot: root,
    feature: 'demo',
    phaseRule: {
      structure_checks: {
        dag_files_parseable: { description: 'DAG candidates parse' },
      },
    } as unknown as CheckContext['phaseRule'],
    featureSpec: {
      contracts: {
        modules: [{ package_path: 'module-a' }],
      },
    } as unknown as CheckContext['featureSpec'],
    resolvedProfile: { name: 'hmos-app', profileDir: '', personalPrerequisites: {} },
  } as CheckContext;
}

function withTmp(fn: (root: string) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ut-dag-load-'));
  try {
    fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function write(root: string, rel: string, content: string): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
}

function testPreservesCandidatesSourcesAndErrors(): void {
  withTmp(root => {
    write(root, 'module-a/test/dag/good.dag.yaml', 'flow_id: good\nnodes: []\n');
    write(root, 'doc/features/demo/ut/reports/flow-dag/bad.dag.yaml', 'flow_id: [\n');
    const observation = loadDagFiles(makeCtx(root));
    assert(observation.candidatePaths.length === 2, observation.candidatePaths.join(','));
    assert(observation.files.length === 1, `loaded=${observation.files.length}`);
    assert(observation.files[0].source === 'archived', observation.files[0].source);
    assert(observation.issues.length === 1, `issues=${observation.issues.length}`);
    assert(observation.issues[0].source === 'ephemeral', observation.issues[0].source);
    const result = checkDagFilesParseable(makeCtx(root), observation)[0];
    assert(result.status === 'FAIL', result.status);
    assert(result.details.includes('bad.dag.yaml'), result.details);
    assert(result.details.includes('flow-dag'), result.details);
    assert(result.suggestion?.includes('不需要移动文件或执行 git add') === true, result.suggestion ?? '');
  });
}

function testRejectsNonObjectRoot(): void {
  withTmp(root => {
    write(root, 'module-a/test/dag/empty.dag.yaml', 'null\n');
    const observation = loadDagFiles(makeCtx(root));
    assert(observation.files.length === 0, 'null root must not load');
    assert(observation.issues[0]?.error.includes('mapping/object') === true, observation.issues[0]?.error ?? '');
  });
}

function testReportsProbedDirsWhenNoCandidate(): void {
  withTmp(root => {
    const ctx = makeCtx(root);
    const observation = loadDagFiles(ctx);
    assert(observation.candidatePaths.length === 0, 'no candidates expected');
    const result = checkDagFilesParseable(ctx, observation)[0];
    assert(result.status === 'SKIP', result.status);
    assert(result.details.includes('module-a/test/dag'), result.details);
    assert(result.details.includes('doc/features/demo/ut/reports/flow-dag'), result.details);
  });
}

export function runAll(): UnitCaseResult[] {
  const cases = [
    { name: 'preserve DAG candidates sources and parse errors', fn: testPreservesCandidatesSourcesAndErrors },
    { name: 'reject non-object DAG root', fn: testRejectsNonObjectRoot },
    { name: 'report probed DAG directories when empty', fn: testReportsProbedDirsWhenNoCandidate },
  ];
  return cases.map(({ name, fn }) => {
    try {
      fn();
      return { name, ok: true };
    } catch (e) {
      return { name, ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
}
