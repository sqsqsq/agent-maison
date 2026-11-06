import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { execFileSync } from 'child_process';
import { buildTestDependencyGraph, dependencyClosure, TestDependencyGraph, REPO_ROOT } from './test-dependency-graph';
import type { UnitSuiteTask, UnitWorkerResult } from './unit-suite-processes';

export interface InputSnapshot { head: string; files: Record<string, string>; id: string; documentStructures?: Record<string, string> }
export interface GroupFootprint {
  executed: string[]; files: string[]; directories: string[];
  executionComplete: boolean; readsComplete: boolean; reasons: string[];
  coverageBytes: number; coveragePeakBytes: number; mergeMs: number;
}
export interface TestGroup extends UnitSuiteTask { suiteId: string; layer: 'function' | 'capability'; caseNames?: string[]; kind?: 'fixture'; releaseOnly?: boolean }
export interface GroupFact { result: UnitWorkerResult; snapshotId: string; modulePath: string; layer: 'function' | 'capability'; registry?: string; footprint?: GroupFootprint }
export interface TestRunState { version: 1; registry: string; snapshots: Record<string, InputSnapshot>; groups: Record<string, GroupFact>; graph: TestDependencyGraph; lastRun?: { scope: TestScope; snapshotId: string; ok: boolean }; completeRun?: { snapshotId: string; ok: boolean } }
export type TestScope = 'changed' | 'daily' | 'full';
export interface ImpactPlan { scope: TestScope; full: boolean; typecheck: boolean; changes: string[]; selected: Array<{ group: TestGroup; reasons: string[] }>; reused: string[]; exempt: Array<{ file: string; reason: string }>; formal: Array<{ id: string; status: 'not-executed' | 'previous-failure' }> }
export function includeAdditionalGroups(plan: ImpactPlan, groups: TestGroup[], additions: string[] | string): void {
  const selectors = typeof additions === 'string'
    ? groups.some(group => group.id === additions || group.suiteId === additions) ? [additions] : additions.split(',').filter(Boolean)
    : additions;
  for (const addition of selectors) {
    const matches = groups.filter(group => group.id === addition || group.suiteId === addition);
    if (!matches.length) throw new Error(`unknown additional group/suite: ${addition}`);
    for (const group of matches) if (!plan.selected.some(item => item.group.id === group.id)) plan.selected.push({ group, reasons: ['developer addition'] });
  }
  plan.reused = plan.reused.filter(id => !plan.selected.some(item => item.group.id === id));
  plan.formal = plan.formal.filter(item => !plan.selected.some(selected => selected.group.id === item.id));
}
export const TEST_REPORT_DIR = path.join(REPO_ROOT, 'harness/reports/test-run');
export const TEST_STATE_FILE = path.join(TEST_REPORT_DIR, 'results.json');
const hash = (value: string | Buffer): string => crypto.createHash('sha256').update(value).digest('hex');
export const NORMAL_DESIGN_CASE = 'daily design: empty request reaches canonical CU completion with real TypeScript and Node assertions';
export const CODING_REPAIR_CASE = 'daily recovery: real TypeScript failure reaches its author and the original coding request completes';
const publishedText = (file: string): boolean => /^(?:skills\/|docs\/|profiles\/[^/]+\/skills\/).*\.md$/.test(file) || /^(?:README|MIGRATION)\.md$/.test(file);
const developmentDocument = (file: string): boolean => /^(?:\.cursor\/(?:plans\/.*\.plan\.md|goals\/.*\.goal\.md)|openspec\/(?:specs|changes)\/.*\.md)$/.test(file);
function documentStructure(text: string): string {
  return hash(JSON.stringify({
    frontmatter: /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(text)?.[0] ?? '',
    code: text.match(/```[^\n]*\n[\s\S]*?(?:\n```|$)/g) ?? [],
    declarations: text.match(/profile-skill-asset:[\w/-]+/g) ?? [],
    inline: text.match(/`[^`\n]+`/g) ?? [],
    targets: [...text.matchAll(/\]\(([^)\s]+)/g)].map(match => match[1]),
  }));
}
function isTextConsumer(group: TestGroup, file: string, relation: string | undefined): boolean {
  if (group.layer === 'function' && relation) return true;
  if (group.suiteId === 'docs-authoring-lint' || group.suiteId === 'profile-skill-assets') return true;
  return /(?:^|\/)skills\//.test(file) && group.suiteId === 'skills-index-init-steps';
}
function isStructureConsumer(group: TestGroup): boolean {
  return ['skill-contract', 'profile-skill-assets', 'implementation-authority', 'phase-write-boundary'].includes(group.suiteId);
}
const generated = (file: string): boolean => /^harness\/(?:dist|reports\/test-run)\//.test(file);
// No standalone document currently has a proof of worker-only consumption:
// e.g. no-numbered-skill-scan reads published docs in real gate processes.
const TEST_ONLY_READ_INPUTS = new Set<string>();
function isTestOnlyReadInput(file: string): boolean { return TEST_ONLY_READ_INPUTS.has(file); }
// Evidence: reports/6a2f8c91/no-test-path-evidence.md; release-shipped-in-ignored-dirs.unit.test.ts ->
// scripts/release-pack-rules.mjs::walkExcludedRootSubtree observes names/counts, never this rule's contents.
// Provisioning excludes .cursor; structural changes and any observed direct reader override this narrow proof.
const CONTENT_ONLY_EXEMPT = new Map([
  ['.cursor/rules/plan-execution.mdc', 'development-rule contents have no runtime/test consumer; the release scan observes member names/counts only'],
]);

export function snapshotTestInputs(root = REPO_ROOT): InputSnapshot {
  const git = (args: string[]): string => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const files: Record<string, string> = {};
  const documentStructures: Record<string, string> = {};
  const names = [...new Set([...git(['ls-files', '-z', '--cached', '--others', '--exclude-standard']).split('\0').filter(Boolean),
    'package-lock.json', 'harness/package-lock.json'])].sort();
  for (const file of names) {
    if (generated(file)) continue;
    try { if (fs.lstatSync(path.join(root, file)).isFile()) {
      const contents = fs.readFileSync(path.join(root, file));
      files[file] = hash(contents);
      if (publishedText(file)) documentStructures[file] = documentStructure(contents.toString('utf8'));
    } }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  const head = git(['rev-parse', 'HEAD']).trim();
  return { head, files, id: hash(JSON.stringify({ head, files })), documentStructures };
}
export function changedInputs(before: InputSnapshot, after: InputSnapshot): string[] {
  return [...new Set([...Object.keys(before.files), ...Object.keys(after.files)])].filter(file => before.files[file] !== after.files[file]).sort();
}
export function readTestState(file = TEST_STATE_FILE): TestRunState | undefined {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8')) as TestRunState;
    if (value.version !== 1 || !value.snapshots || Array.isArray(value.snapshots) || !value.groups || Array.isArray(value.groups)
      || !value.graph || Array.isArray(value.graph) || typeof value.registry !== 'string') return;
    if (Object.values(value.graph).some(info => !info || !Array.isArray(info.imports) || info.imports.some(file => typeof file !== 'string'))) return;
    for (const [id, snapshot] of Object.entries(value.snapshots)) if (!snapshot?.files || typeof snapshot.head !== 'string') delete value.snapshots[id];
    for (const [id, fact] of Object.entries(value.groups)) if (!fact || !value.snapshots[fact.snapshotId]?.files || !Array.isArray(fact.result?.results) || typeof fact.result.ok !== 'boolean') delete value.groups[id];
    return value;
  } catch { return; }
}
export function registryFingerprint(groups: TestGroup[], root = REPO_ROOT): string {
  const publicFiles = ['harness/tests/run-test-plan.ts', 'harness/tests/unit-worker.ts', 'harness/tests/compiled-register.cjs', 'harness/tests/compiled-entry.cjs', 'harness/tests/build-test-runtime.cjs', 'harness/tests/test-runtime.cjs',
    'harness/tests/utils/unit-case-groups.ts', 'harness/tests/utils/unit-case-selection.ts', 'harness/tests/utils/unit-suite-processes.ts', 'harness/tests/utils/test-dependency-graph.ts', 'harness/tests/utils/test-input-observer.ts', 'harness/tests/utils/test-coverage.ts', 'harness/tests/utils/test-impact.ts'];
  return hash(JSON.stringify({ format: 2, publicFiles: publicFiles.map(file => [file, fs.existsSync(path.join(root, file)) ? hash(fs.readFileSync(path.join(root, file))) : null]) }));
}
function hit(footprint: GroupFootprint, file: string): string | undefined {
  if (footprint.executed.includes(file)) return 'execution';
  if (footprint.files.includes(file)) return 'file-read';
  if (footprint.directories.some(dir => file === dir || file.startsWith(dir + '/'))) return 'directory-enumeration';
}
export function buildImpactPlan(allGroups: TestGroup[], snapshot: InputSnapshot, state?: TestRunState, root = REPO_ROOT, scope: TestScope = 'changed'): ImpactPlan {
  const groups = scope === 'full' ? allGroups : allGroups.filter(group => !group.releaseOnly);
  const formal: ImpactPlan['formal'] = allGroups.filter(group => group.releaseOnly).map(group => ({ id: group.id, status: state?.groups[group.id]?.result.ok === false ? 'previous-failure' : 'not-executed' }));
  if (scope !== 'changed') return { scope, full: scope === 'full', typecheck: true, changes: [], selected: groups.map(group => ({ group, reasons: [`explicit ${scope} complete run`] })), reused: [], exempt: [], formal: scope === 'full' ? [] : formal };
  const publishedChanges = new Set<string>();
  const tsFiles = Object.keys(snapshot.files).filter(file => /\.[cm]?tsx?$/.test(file) && !/\/fixtures\/|\/reports\//.test(file));
  const currentGraph = buildTestDependencyGraph(tsFiles, root);
  const directlyConsumed = new Set(Object.values(state?.groups ?? {}).flatMap(fact => [...(fact.footprint?.files ?? []), ...(fact.footprint?.executed ?? [])]));
  const addedEdges = Object.entries(currentGraph).flatMap(([from, info]) => info.imports.filter(to => !state?.graph[from]?.imports.includes(to)).map(to => ({ from, to, closure: dependencyClosure(currentGraph, to) })));
  const allChanges = new Set<string>();
  const selected: ImpactPlan['selected'] = [], reused: string[] = [];
  const publicIdentity = registryFingerprint(groups, root);
  const globalInvalid = !state || state.registry !== publicIdentity;
  const history = new Map<string, boolean>();
  // No path is exempt by extension. Add only individually researched paths with a consumer proof.
  const exempt: ImpactPlan['exempt'] = [];
  for (const group of groups) {
    const reasons = new Set<string>();
    const fact = state?.groups[group.id], before = fact && state?.snapshots[fact.snapshotId];
    const entry = path.relative(root, group.modulePath).replace(/\\/g, '/');
    const localIdentityChanged = !!fact && (fact.modulePath !== entry || fact.layer !== group.layer);
    if (globalInvalid) reasons.add('daily: missing state or public registry/entry identity changed');
    if (fact && (fact.registry ?? state?.registry) !== publicIdentity) reasons.add('group public execution identity changed');
    if (!fact || !before) reasons.add('previous result missing');
    if (fact && !fact.result.ok) reasons.add('previous result not passed');
    if (localIdentityChanged) reasons.add('group module path or layer changed');
    const changes = before ? changedInputs(before, snapshot) : Object.keys(snapshot.files);
    changes.forEach(file => allChanges.add(file));
    if (!globalInvalid && before && before.head !== snapshot.head) {
      if (!history.has(before.head)) {
        try { execFileSync('git', ['merge-base', '--is-ancestor', before.head, snapshot.head], { cwd: root, stdio: 'ignore' }); history.set(before.head, true); }
        catch { history.set(before.head, false); }
      }
      if (!history.get(before.head)) reasons.add('daily: tested history cannot be related to current HEAD');
    }
    const currentClosure = dependencyClosure(currentGraph, entry);
    const oldClosure = dependencyClosure(state?.graph ?? {}, fact?.modulePath ?? entry);
    const footprint = localIdentityChanged ? undefined : fact?.footprint;
    const invalidTest = changes.some(file => /\.unit\.test\.ts$/.test(file) && (currentClosure.has(file) || oldClosure.has(file)));
    for (const file of changes) {
      if (globalInvalid) break;
      if (file === 'harness/tests/utils/unit-suite-registry.ts') continue;
      if (developmentDocument(file)) {
        if (!exempt.some(item => item.file === file)) exempt.push({file, reason: 'development plan/goal/spec: use its corresponding validation and diff/LF checks'});
        continue;
      }
      const exemption = before?.files[file] && snapshot.files[file] && !directlyConsumed.has(file) ? CONTENT_ONLY_EXEMPT.get(file) : undefined;
      if (exemption) {
        if (!exempt.some(item => item.file === file)) exempt.push({file, reason: exemption});
        continue;
      }
      const relation = footprint && hit(footprint, file);
      if (publishedText(file)) {
        publishedChanges.add(file);
        if (isTextConsumer(group, file, relation)) reasons.add(`published prose consumer: ${file}`);
        if (before?.documentStructures?.[file] !== snapshot.documentStructures?.[file] && isStructureConsumer(group)) reasons.add(`published structure/contract change: ${file}`);
        continue;
      }
      if (relation) reasons.add(`${relation}: ${file}`);
      const independentTest = /\.unit\.test\.ts$/.test(file);
      const fixtureOwner = groups.find(candidate => candidate.kind === 'fixture' && file.startsWith(path.relative(root, candidate.modulePath).replace(/\\/g, '/') + '/'));
      if (fixtureOwner) {
        if (fixtureOwner.id === group.id) reasons.add(`fixture input: ${file}`);
        continue;
      }
      if (independentTest) {
        if (currentClosure.has(file) || oldClosure.has(file)) reasons.add(`test dependency: ${file}`);
        continue;
      }
      const shared = /(?:^|\/)(?:package(?:-lock)?\.json|tsconfig[^/]*\.json)$/.test(file)
        || /^harness\/tests\/(?:utils\/|run-|unit-worker)/.test(file);
      const source = /\.[cm]?tsx?$/.test(file);
      const productionInput = !source && !isTestOnlyReadInput(file);
      if (shared) { reasons.add(`shared test/runtime configuration: ${file}`); continue; }
      if (source) {
        if (group.layer === 'function' && (currentClosure.has(file) || oldClosure.has(file))) reasons.add(`import dependency: ${file}`);
        if (!footprint?.executionComplete || !footprint.readsComplete || invalidTest) reasons.add(`unknown group coverage/read relation: ${file}`);
        if (group.layer === 'capability' && !state?.graph[file] && !Object.values(state?.groups ?? {}).some(row => row.footprint?.executed.includes(file))) reasons.add(`new unmapped source: ${file}`);
        // New static A -> B edges belong to every group which previously executed/read A.
        if (group.layer === 'capability' && footprint) for (const edge of addedEdges) if (footprint.executed.includes(edge.from) && edge.closure.has(file)) reasons.add(`new import edge: ${edge.from} -> ${edge.to} -> ${file}`);
      } else if (productionInput) {
        if (group.layer === 'capability' || !footprint?.readsComplete) reasons.add(`production runtime input: ${file}`);
      } else {
        if (!footprint?.readsComplete || invalidTest) reasons.add(`unknown test read relation: ${file}`);
      }
    }
    if (reasons.size) selected.push({ group, reasons: [...reasons] }); else reused.push(group.id);
  }
  if (publishedChanges.size) {
    const codingOnly = [...publishedChanges].every(file => file === 'skills/feature/coding/SKILL.md');
    const suiteId = codingOnly ? 'daily-recovery-journey' : 'daily-design-journey';
    const caseName = codingOnly ? CODING_REPAIR_CASE : NORMAL_DESIGN_CASE;
    const representative = groups.find(group => group.suiteId === suiteId && group.caseNames?.includes(caseName));
    if (!representative) throw new Error(`published text selection requires the exact ${codingOnly ? 'coding repair' : 'normal design'} representative`);
    let entry = selected.find(item => item.group.id === representative.id);
    if (!entry) { entry = { group: representative, reasons: [] }; selected.push(entry); }
    entry.reasons.push(...[...publishedChanges].map(file => `normal ${codingOnly ? 'coding repair' : 'design'} representative for published prose: ${file}`));
    const reusedIndex = reused.indexOf(representative.id);
    if (reusedIndex >= 0) reused.splice(reusedIndex, 1);
    selected.sort((left, right) => groups.indexOf(left.group) - groups.indexOf(right.group));
  }
  const historyInvalid = selected.some(item => item.reasons.includes('daily: tested history cannot be related to current HEAD'));
  return { scope, full: false, formal, typecheck: globalInvalid || historyInvalid || [...allChanges].some(file => /\.[cm]?tsx?$|(?:^|\/)(?:package(?:-lock)?\.json|tsconfig[^/]*\.json)$/.test(file)), changes: [...allChanges].sort(),
    selected: historyInvalid ? groups.map(group => ({ group, reasons: [...(selected.find(item => item.group.id === group.id)?.reasons ?? []), 'daily: tested history cannot be related to current HEAD'] })) : selected,
    reused: historyInvalid ? [] : reused, exempt };
}

export function updateTestState(groups: TestGroup[], before: InputSnapshot, after: InputSnapshot, results: UnitWorkerResult[], old?: TestRunState, full = false, root = REPO_ROOT, scope: TestScope = full ? 'full' : 'changed'): TestRunState {
  const registry = registryFingerprint(groups, root);
  const state: TestRunState = old ?? { version: 1, registry, snapshots: {}, groups: {}, graph: {} };
  for (const fact of Object.values(state.groups)) fact.registry ??= state.registry;
  if (state.registry !== registry) delete state.completeRun;
  state.registry = registry;
  const activeIds = new Set(groups.map(group => group.id));
  for (const id of Object.keys(state.groups)) if (!activeIds.has(id)) delete state.groups[id];
  state.snapshots[before.id] = before;
  const drift = new Set(changedInputs(before, after));
  const graph = buildTestDependencyGraph(Object.keys(before.files).filter(file => /\.[cm]?tsx?$/.test(file) && !/\/fixtures\/|\/reports\//.test(file)), root);
  const byId = new Map(groups.map(group => [group.id, group]));
  for (const result of results) {
    const group = byId.get(result.id); if (!group) continue;
    const prior = state.groups[result.id];
    const footprint = result.footprint;
    const entry = path.relative(root, group.modulePath).replace(/\\/g, '/');
    const imports = dependencyClosure(graph, entry);
    const affectedDrift = [...drift].some(file => imports.has(file) || !footprint || hit(footprint, file)
      || !footprint.executionComplete || !footprint.readsComplete || (!/\.unit\.test\.ts$/.test(file) && !Object.values(state.groups).some(row => row.footprint && hit(row.footprint, file))));
    const outsideSnapshot = footprint?.files.some(file => !before.files[file] && after.files[file] !== undefined);
    if (affectedDrift || outsideSnapshot) {
      state.groups[result.id] = { result: { ...result, ok: false, error: 'tested inputs drifted during execution' }, snapshotId: before.id, footprint, modulePath: entry, layer: group.layer, registry };
      continue;
    }
    if (!full && footprint && prior?.footprint) {
      footprint.executed = [...new Set([...prior.footprint.executed, ...footprint.executed])].sort();
      footprint.files = [...new Set([...prior.footprint.files, ...footprint.files])].sort();
      footprint.directories = [...new Set([...prior.footprint.directories, ...footprint.directories])].sort();
    }
    state.groups[result.id] = { result, snapshotId: before.id, footprint, modulePath: entry, layer: group.layer, registry };
  }
  // Preserve old edges until a complete collection can safely narrow them.
  if (!full) for (const [from, info] of Object.entries(graph)) {
    const added = info.imports.filter(to => !state.graph[from]?.imports.includes(to));
    if (!added.length) continue;
    for (const fact of Object.values(state.groups)) if (fact.footprint?.executed.includes(from)) {
      fact.footprint.executed = [...new Set([...fact.footprint.executed, ...added.flatMap(to => [...dependencyClosure(graph, to)])])].sort();
    }
  }
  if (full) state.graph = {};
  for (const [file, info] of Object.entries(graph)) state.graph[file] = { ...info, imports: full ? info.imports : [...new Set([...(state.graph[file]?.imports ?? []), ...info.imports])] };
  const executed = new Set(results.map(result => result.id));
  const complete = !drift.size && groups.length > 0 && groups.every(group => executed.has(group.id) && state.groups[group.id]?.result.ok && state.groups[group.id]?.snapshotId === before.id);
  if (full) state.completeRun = { snapshotId: before.id, ok: complete };
  state.lastRun = { scope, snapshotId: before.id, ok: !drift.size && results.every(result => state.groups[result.id]?.result.ok) };
  const used = new Set(Object.values(state.groups).map(fact => fact.snapshotId));
  if (state.completeRun) used.add(state.completeRun.snapshotId);
  state.snapshots = Object.fromEntries(Object.entries(state.snapshots).filter(([id]) => used.has(id)));
  return state;
}
