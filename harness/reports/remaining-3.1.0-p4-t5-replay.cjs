// Read only host business originals; projection runs in a separate, credential-free context.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert/strict');
const { execFileSync } = require('child_process');
const Module = require('module');
const repo = path.resolve(__dirname, '../..');
process.env.TS_NODE_PROJECT = path.join(repo, 'harness/tsconfig.json');
require('ts-node/register/transpile-only');
const YAML = require('yaml');
const ts = require('typescript');
const host = 'D:/1.code/SimulatedWalletForHmos';
const feature = 'doc/features/bc-openCard-2';
const parentRun = `${feature}/goal-runs/20261108T101421Z-d5a320`;
const childRun = `${feature}/cu-card-storage/goal-runs/20261108T115921Z-2f8034`;
const originals = new Map();
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const read = rel => { const bytes = fs.readFileSync(path.join(host, rel)); originals.set(rel, sha(bytes)); return bytes.toString('utf8'); };
const events = rel => read(rel).trim().split('\n').map(JSON.parse);
const blueprint = YAML.parse(read(`${feature}/blueprint/component-blueprint.yaml`));
const cu = YAML.parse(read(`${feature}/cu-card-storage/change-unit.yaml`));
const parent = events(`${parentRun}/events.jsonl`);
const child = events(`${childRun}/events.jsonl`);
const childManifest = JSON.parse(read(`${childRun}/manifest.json`));
const authorCalls = child.filter(event => event.type === 'agent_invoke_start' && event.phase === 'work-unit-author');
const originalAuthorOutputs = authorCalls.map(call => read(`${childRun}/phases/work-unit-author/${call.invoke_id}/agent-output.log`));
assert(originalAuthorOutputs.every(raw => raw.includes('兄弟 CU') || raw.includes('兄弟单元')));
// The preserved decomposition script explicitly built these roots before calling deriveClosure.
const decomposition = read(`${parentRun}/phases/initial-design-decomposition/initial-design-decomposition-i10/agent-output.log`);
assert(decomposition.includes("'contract:card-open-persist'"));
assert(decomposition.includes('artifact.touches.map'));
const roots = [...cu.touches.map(touch => touch.design_ref), cu.design_refs.find(ref => ref.target.kind === 'contract' && ref.target.id === 'card-open-persist')];
assert(roots.every(Boolean));
const rootCandidate = { ...cu, design_refs: roots };
const isolated = path.join(__dirname, 'p4-t5-projection-context');
fs.mkdirSync(path.join(isolated, 'doc'), { recursive: true });
// deriveClosure only asks whether component selections are enabled by the index's existence.
fs.writeFileSync(path.join(isolated, 'doc/component-index.yaml'), '{}\n');
const moduleRel = 'harness/scripts/utils/change-unit-design-gate.ts';
const filename = path.join(repo, moduleRel);
const baseline = new Module(filename, module);
baseline.filename = filename;
baseline.paths = Module._nodeModulePaths(path.dirname(filename));
baseline._compile(ts.transpileModule(execFileSync('git', ['show', `2e72e6d2:${moduleRel}`], { cwd: repo, encoding: 'utf8' }), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const fixed = require('../scripts/utils/change-unit-design-gate');
const { selectBlueprintSkillContent } = require('../scripts/utils/blueprint-skill-projection');
const before = baseline.exports.completeChangeUnitDesignRefs(blueprint, rootCandidate, isolated);
const after = fixed.completeChangeUnitDesignRefs(blueprint, rootCandidate, isolated);
const oldContent = selectBlueprintSkillContent(blueprint, before);
const newContent = selectBlueprintSkillContent(blueprint, after);
const siblingFiles = ['CardOpenCoordinator', 'SmsCodeService', 'CardTypeSheet', 'CardOpenResultPage', 'CardOpenValidator', 'CardOpenResult', 'BankCardListPage'];
for (const name of siblingFiles) {
  assert(oldContent.contracts.files.some(file => file.endsWith(`/${name}.ets`)), `baseline must reproduce ${name}`);
  assert(!newContent.contracts.files.some(file => file.endsWith(`/${name}.ets`)), `dependency must not select ${name}`);
}
assert.deepEqual(fixed.completeChangeUnitDesignRefs(blueprint, cu, isolated), cu, 'already published explicit refs must not be silently removed');
const published = parent.find(event => event.type === 'design_authority_repair' && event.stage === 'published' && event.new_revision === 2);
assert(published && published.admission_after_questioning === 'pass');
assert.equal(cu.component_blueprint_ref.artifact_sha256, 'sha256:' + originals.get(`${feature}/blueprint/component-blueprint.yaml`));
const ut = JSON.parse(read(`${feature}/cu-card-storage/ut/reports/script-report.json`));
const utSummary = JSON.parse(read(`${feature}/cu-card-storage/ut/reports/summary.json`));
const utEnds = child.filter(event => event.type === 'harness_end' && event.phase === 'ut');
assert(ut.timestamp > utEnds.at(-1).ts && !utSummary.run_id);
const summary = {
  source_commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
  source_modified: true,
  projection_replay: { kind: 'original-decomposition-roots; isolated pure production projection, no run execution',
    explicitRoots: roots.map(ref => ref.target), beforeReferences: before.design_refs.length, afterReferences: after.design_refs.length,
    beforeFiles: oldContent.contracts.files, afterFiles: newContent.contracts.files,
    siblingFilesRemovedFromAutomaticSelection: siblingFiles, publishedCuUnchanged: true,
    remainingDesignWork: 'Original CU selections and the shared Phone node need design-owner reconciliation; missing acceptance is not fabricated.' },
  original_run: { parentRun, childRun, publishedRevision: published.new_revision, publishedAt: published.ts,
    admissionAfterQuestioning: published.admission_after_questioning, blueprintIdentityMatchesCu: true,
    frozenResults: childManifest.execution_scope.requested_results,
    authorCalls: authorCalls.map(call => ({ at: call.ts, invoke: call.invoke_id })),
    authorWrites: child.filter(event => event.type === 'phase_write_observed').map(event => ({ at: event.ts, invoke: event.invoke_id, paths: (event.owned ?? []).map(row => row.path) })),
    managedChecks: child.filter(event => event.type === 'harness_end').length,
    latestManagedUt: utEnds.at(-1).ts, laterUnboundUtReport: ut.timestamp,
    unboundUtChecks: ut.checks.filter(check => check.status === 'FAIL').map(check => check.id),
    parentResumeAssessment: 'Reuse original parent and design revision; correct CU ownership through existing design repair. Direct unchanged child resume is insufficient.' },
  originals: [...originals].map(([file, sha256]) => ({ file, sha256 })),
};
for (const [file, hash] of originals) assert.equal(sha(fs.readFileSync(path.join(host, file))), hash, `host original changed: ${file}`);
fs.writeFileSync(path.join(__dirname, 'remaining-3.1.0-p4-t5-evidence.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify({ projectionBefore: before.design_refs.length, projectionAfter: after.design_refs.length,
  siblingFiles: siblingFiles.length, managedChecks: summary.original_run.managedChecks, hostOriginalsUnchanged: originals.size }));
