import { resolveArtifactContent } from './artifact-content';
/**
 * Testing trace gates — Hylyre run outcome evaluation, report↔trace reconciliation,
 * and UI entry coverage from use-cases.yaml ui_bindings.
 */

import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { featurePhaseReportsDir, HYLYRE_DERIVED_PLAN_FILENAME } from '../../config';
import { loadGoalManifestFromRun } from './goal-manifest';
import { loadLineageRunEvents } from './goal-run-creation';
import { resolveEffectiveRunEnd } from './goal-runner-phase';
import { inferLegacyProjectRoot, resolveDependencyPath, isInsideProjectRoot } from './project-relative-path';
import { stableStringify } from './phase-evidence-manifest';
import { collectFailureRoutesV1, failureRouteSlug, type FailureRouteV1 } from './hylyre-failure-routing-v1';
import type { HylyreTrace, HylyreTraceCase } from '../../../profiles/hmos-app/harness/providers/device-test-run';
import { parseHylyreTrace, resolveFrozenHylyreSelectorTarget } from '../../../profiles/hmos-app/harness/providers/device-test-run';
import { computeExecutionKey, EXECUTION_KEY_FILE, listExecutionKeyRuns } from '../../../profiles/hmos-app/harness/execution-key';
import {
  selectBestNonPlaceholderDerivedPlan,
  tryParseYamlFrontmatter,
  extractDerivedPlanCases,
  parsePlannedStepsFromCell,
} from './derived-hylyre-plan';
import { dispatchHylyreResult, requireV1ForGate } from './hylyre-result-protocol';
import { getSectionContent, extractTables, extractDeclaredVerdict, type MdTable } from './markdown-parser';
import type { UseCaseDef, UseCasesSpec } from './types';
import type { DeviceTestTimingDocument } from '../../../profiles/hmos-app/harness/device-test-timings';
import { normalizePlannedSteps, PLANNED_SELECTOR_DISAMBIGUATION_FIELDS } from './planned-step-normalizer';

export interface PendingTestingRetest {
  route: FailureRouteV1;
  tracePath: string;
  derivedPlanPath: string;
  behavior: string;
  acceptance: unknown[];
  candidateEvidence: string[];
  reviewCandidates: Array<{ caseId: string; tracePath: string; planPath: string; digest: string; answered?: boolean }>;
}

/** The original request's feature evidence keeps failed behavior alive across plan edits; no new ledger. */
export function readPendingTestingRetests(input: {
  projectRoot: string; feature: string; runId?: string; frameworkRoot?: string; currentHapSha256?: string | null;
  onCovered?: (files: readonly string[]) => void;
}): PendingTestingRetest[] {
  if (!input.runId) return [];
  let since: number;
  let runIds: Set<string>;
  let until = Infinity;
  try {
    const manifest = loadGoalManifestFromRun(input.projectRoot, input.runId, { feature: input.feature });
    const events = loadLineageRunEvents(input.projectRoot, input.feature, input.runId);
    since = Date.parse(manifest.created_at); runIds = new Set([input.runId]);
    let predecessor = manifest.successor_of;
    while (predecessor && !runIds.has(predecessor)) {
      const prior = loadGoalManifestFromRun(input.projectRoot, predecessor, { feature: input.feature });
      if (prior.requirement !== manifest.requirement) break; // A new authorized request establishes its own applicable behavior.
      since = Math.min(since, Date.parse(prior.created_at)); runIds.add(predecessor); predecessor = prior.successor_of;
    }
    const terminal = resolveEffectiveRunEnd(events);
    if (terminal?.ts) until = Date.parse(terminal.ts);
    if (!Number.isFinite(since)) return [];
  } catch { return []; }
  const reports = featurePhaseReportsDir(input.projectRoot, input.feature, 'testing', input.frameworkRoot);
  const sha = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
  const observed = listExecutionKeyRuns(reports).flatMap(view => {
    const record = view.record;
    if (Date.parse(record.run_started_at) < since || Date.parse(record.run_started_at) > until || !Number.isFinite(Date.parse(record.run_started_at))
      || record.goal_invocation && !runIds.has(record.goal_invocation.run_id)) return [];
    const tracePath = resolveDependencyPath(input.projectRoot, record.trace_path, inferLegacyProjectRoot(input.projectRoot, record));
    const derivedPlanPath = path.join(view.runDir, HYLYRE_DERIVED_PLAN_FILENAME);
    try {
      if (![tracePath, derivedPlanPath].every(file => isInsideProjectRoot(fs.realpathSync(input.projectRoot), fs.realpathSync(file)))) return [];
      const traceBytes = fs.readFileSync(tracePath), planBytes = fs.readFileSync(derivedPlanPath);
      if (sha(traceBytes) !== record.trace_sha256 || sha(planBytes) !== record.inputs?.derived_plan_sha256
        || computeExecutionKey(record.inputs) !== record.execution_key) return [];
      const parsed = requireV1ForGate(JSON.parse(traceBytes.toString('utf8')), { frameworkRoot: input.frameworkRoot });
      if (!parsed.ok || !parsed.trace || parsed.trace.feature !== input.feature || parsed.trace.phase !== 'testing') return [];
      const rows = extractDerivedPlanCases(planBytes.toString('utf8'));
      const plans = new Map(rows.flatMap(row => {
        const steps = parsePlannedStepsFromCell(row.steps_raw);
        return steps.ok ? [[row.tc_id, { ...row, steps: steps.steps }] as const] : [];
      }));
      const behavior = new Map([...plans].map(([id, row]) => [id, stableStringify({ precondition: row.precondition, steps: row.steps, expected: row.expected })]));
      const passed = new Map<string, Array<{ caseId: string; test: typeof parsed.trace.cases[number] }>>();
      if (input.currentHapSha256 && record.inputs.hap_sha256_full === input.currentHapSha256) {
        for (const test of parsed.trace.cases) {
          if (test.execution !== 'completed' || test.verification !== 'passed' || test.evidence !== 'complete'
            || !test.steps.some(step => step.role === 'assertion' && step.outcome.status === 'passed' && step.outcome.observation?.kind === 'assertion')
            || !test.steps.every(step => step.outcome.status === 'passed' || step.kind === 'expected_check' && step.outcome.status === 'skipped')) continue;
          const caseId = test.id.toUpperCase(), plan = plans.get(caseId);
          if (!plan) continue;
          const group = passed.get(plan.ac_ref) ?? [];
          group.push({ caseId, test });
          passed.set(plan.ac_ref, group);
        }
      }
      return [{ record, trace: parsed.trace, tracePath, derivedPlanPath, behavior, plans, passed, keyPath: path.join(view.runDir, EXECUTION_KEY_FILE) }];
    } catch { return []; }
  }).sort((a, b) => Date.parse(a.record.run_started_at) - Date.parse(b.record.run_started_at));
  if (observed.length === 0) return [];
  const pending = new Map<string, PendingTestingRetest>();
  const relative = (file: string): string => path.relative(input.projectRoot, file).replace(/\\/g, '/');
  const { readIndependentReviewOutputs, uniqueIssueVerification } = require('./repair-candidates') as typeof import('./repair-candidates');
  let review: ReturnType<typeof readIndependentReviewOutputs> | undefined;
  let effectiveScope: import('./execution-scope').ExecutionScope | null | undefined;
  const currentScope = () => {
    if (effectiveScope === undefined) {
      effectiveScope = null;
      try {
        const { resolveEffectiveScopeSource } = require('./goal-run-creation') as typeof import('./goal-run-creation');
        effectiveScope = resolveEffectiveScopeSource(input.projectRoot, input.feature, input.runId)?.scope ?? null;
      } catch { /* Keep previously observed failures when current scope cannot be read. */ }
    }
    return effectiveScope;
  };
  let currentAcceptance: ReturnType<typeof import('./feature-track').readScopeAcceptance> | null;
  const acceptanceForReview = (frameworkRoot: string) => {
    if (currentAcceptance !== undefined) return currentAcceptance;
    currentAcceptance = null;
    const scope = currentScope();
    try {
      const { readScopeAcceptance } = require('./feature-track') as typeof import('./feature-track');
      if (scope) currentAcceptance = readScopeAcceptance(input.projectRoot,
        { facts: scope.obligations }, { feature: input.feature, frameworkRoot }) ?? null;
    } catch { /* No approved current acceptance to interpret changed behavior. */ }
    return currentAcceptance;
  };
  const { extractAcceptanceIdRefs } = require('./check-acceptance') as typeof import('./check-acceptance');
  let independent: { issues: Map<string, import('./repair-candidates').IssueVerificationEntry[]>; matchesCurrent(file: string): boolean;
    originals: string[] } | null | undefined;
  const independentEvidence = (): typeof independent => {
    if (independent !== undefined) return independent;
    independent = null;
    try {
      const verifier = require('./verifier-evidence') as typeof import('./verifier-evidence');
      const loaded = verifier.loadVerifierEvidence(input.projectRoot, input.feature, 'testing', { frameworkRoot: input.frameworkRoot });
      if (!loaded.ok) return null;
      const material = require('./verifier-material') as typeof import('./verifier-material');
      const view = material.readVerifierMaterialOrNull(reports, loaded.evidence.subject_id);
      if (!view) return null;
      const freshness = new Map<string, boolean>();
      const matchesCurrent = (file: string): boolean => {
        if (!freshness.has(file)) {
          try { freshness.set(file, material.verifierMaterialFileMatchesCurrent({ projectRoot: input.projectRoot, feature: input.feature, material: view, file })); }
          catch { freshness.set(file, false); }
        }
        return freshness.get(file)!;
      };
      if (!view.files.every(file => matchesCurrent(file.path))) return null;
      const { parseIssueVerificationBlock } = require('./repair-candidates') as typeof import('./repair-candidates');
      const issues = new Map<string, import('./repair-candidates').IssueVerificationEntry[]>();
      for (const entry of parseIssueVerificationBlock(loaded.evidence.report_text).entries) issues.set(entry.issue, [...issues.get(entry.issue) ?? [], entry]);
      independent = { issues, matchesCurrent, originals: [loaded.evidence.md_path_rel] };
    } catch { /* A missing or unreadable independent result remains unknown for this read. */ }
    return independent;
  };
  const independentlyCovered = (finding: PendingTestingRetest,
    candidates: readonly { caseId: string; tracePath: string; planPath: string; next: typeof observed[number] }[],
    prior: typeof observed[number]): boolean => {
    if (!candidates.length) return false;
    const issue = 'testing_failure_routing_' + failureRouteSlug(finding.route.caseId, finding.route.stepIndex);
    const verification = independentEvidence();
    if (finding.reviewCandidates.length) review ??= readIndependentReviewOutputs(input.projectRoot, input.feature, input.runId!);
    return candidates.some(candidate => {
      const requiredRefs = [finding.tracePath, finding.derivedPlanPath, candidate.tracePath, candidate.planPath].map(relative);
      const qualified = (entry: import('./repair-candidates').IssueVerificationEntry | undefined, refs: string[]) => {
        if (!entry || entry.verdict !== 'refuted') return entry;
        const evidence = entry.evidence!.replace(/\\/g, '/');
        return [...refs, finding.route.caseId, candidate.caseId].every(ref => evidence.includes(ref)) ? entry : undefined;
      };
      const current = finding.reviewCandidates.find(item => item.caseId === candidate.caseId
        && item.tracePath === candidate.tracePath && item.planPath === candidate.planPath);
      const issued = current ? review!.filter(output => output.material[issue]?.includes(current.digest)) : [];
      const answers = issued.map(output => requiredRefs.every(output.matchesCurrent)
        ? qualified(uniqueIssueVerification(output.entries, issue), requiredRefs) : undefined);
      const latest = answers[0];
      if (current) current.answered = !!latest;
      const phaseAnswer = verification && requiredRefs.every(verification.matchesCurrent)
        ? qualified(uniqueIssueVerification(verification.issues.get(issue) ?? [], issue), [requiredRefs[0], requiredRefs[2]]) : undefined;
      const accepted = (latest?.verdict === 'refuted' || phaseAnswer?.verdict === 'refuted')
        && (!phaseAnswer || phaseAnswer.verdict === 'refuted') && answers.every(answer => !answer || answer.verdict === 'refuted');
      if (accepted) input.onCovered?.([...requiredRefs, prior.keyPath, candidate.next.keyPath,
        ...issued.flatMap((output, index) => answers[index] ? output.originals : []), ...(phaseAnswer ? verification!.originals : [])]);
      return accepted;
    });
  };
  // Formal UT remains available when an adapter has no independent verifier. Every locator
  // below is qualified by the current scope, source manifest, native case result and build.
  let unitEvidence: { ids: Set<string>; startedAt: number } | null | undefined;
  const currentUnitEvidence = (): typeof unitEvidence => {
    if (unitEvidence !== undefined) return unitEvidence;
    unitEvidence = null;
    try {
      const { loadFrozenExecutionScope } = require('./goal-run-creation') as typeof import('./goal-run-creation');
      const { readScopeAcceptance } = require('./feature-track') as typeof import('./feature-track');
      const frameworkRoot = input.frameworkRoot ?? (require('../../repo-layout') as typeof import('../../repo-layout')).resolveProbeFrameworkRoot(input.projectRoot, path.resolve(__dirname, '../..'));
      const scope = currentScope();
      if (!scope?.obligations.some(obligation => obligation.kind === 'unit-evidence' && obligation.applicability === 'required')) return null;
      const acceptance = acceptanceForReview(frameworkRoot);
      const birth = loadFrozenExecutionScope(input.projectRoot, input.feature, input.runId!);
      if (!birth || !acceptance) return null;
      const current = acceptance.value;
      const original = stableStringify(birth.obligations) === stableStringify(scope.obligations) ? current
        : readScopeAcceptance(input.projectRoot, { facts: birth.obligations }, { feature: input.feature, frameworkRoot })?.value;
      if (!original || !current || !acceptance) return null;
      const ids = new Set([...(original.criteria ?? []), ...(original.boundaries ?? [])].filter(item => item.ut_layer === 'unit'
        && [...(current.criteria ?? []), ...(current.boundaries ?? [])].some(now => now.id === item.id && now.ut_layer === 'unit')).map(item => item.id.toUpperCase()));
      if (!ids.size) return null;
      const evidence = require('./phase-evidence-manifest') as typeof import('./phase-evidence-manifest');
      const manifest = evidence.loadPhaseEvidenceManifest(input.projectRoot, input.feature, 'ut');
      if (!manifest?.integrityOk) return null;
      const bound = [...manifest.manifest.inputs, ...manifest.manifest.outputs];
      const freshness = new Map<string, boolean>();
      const matches = (file: string): boolean => {
        if (!freshness.has(file)) freshness.set(file, bound.some(entry => entry.path === file && entry.exists
          && evidence.evidenceEntryMatchesCurrentFile(input.projectRoot, entry, input.feature)));
        return freshness.get(file)!;
      };
      const construction = scope.obligations.flatMap(obligation => obligation.basis).find(binding => binding.source.kind === 'artifact'
        ? binding.source.artifact === 'contracts@1' : binding.source.provider_id === 'derive.blueprint-contracts');
      if (!construction || ![...acceptance.binding.source_refs, ...construction.source_refs].every(matches)) return null;
      const relative = (file: string): string => path.relative(input.projectRoot, file).replace(/\\/g, '/');
      const utReports = featurePhaseReportsDir(input.projectRoot, input.feature, 'ut', frameworkRoot);
      const reportFile = path.join(utReports, 'script-report.json');
      if (!matches(relative(reportFile))) return null;
      const report = JSON.parse(fs.readFileSync(reportFile, 'utf8')) as import('./types').ScriptReport;
      const { isRequiredCheckGap } = require('./check-disposition') as typeof import('./check-disposition');
      if (report.feature !== input.feature || report.phase !== 'ut' || report.summary?.verdict !== 'PASS'
        || !Array.isArray(report.checks) || report.checks.some(check => isRequiredCheckGap(check))
        || !report.checks.some(check => check.id === 'ut_hvigor_test' && check.status === 'PASS')) return null;
      const native = require('../../../profiles/hmos-app/harness/execution-key') as typeof import('../../../profiles/hmos-app/harness/execution-key');
      const host = require('../../../profiles/hmos-app/harness/ut-host-impl') as typeof import('../../../profiles/hmos-app/harness/ut-host-impl');
      const profile = (require('../../profile-loader') as typeof import('../../profile-loader')).loadResolvedProfile(input.projectRoot,
        (require('../../config') as typeof import('../../config')).loadFrameworkConfig(input.projectRoot), frameworkRoot);
      const latest = native.listExecutionKeyRuns(utReports, 'ut').find(view => Date.parse(view.record.run_started_at) >= since
        && Date.parse(view.record.run_started_at) <= until && (!view.record.goal_invocation || runIds.has(view.record.goal_invocation.run_id)));
      if (!latest) return null;
      const { record, runDir } = latest, modules = native.utExecutionModules(record);
      const executionInputs = host.currentUtExecutionInputs(input.projectRoot, modules);
      if (!modules.length || !executionInputs || record.inputs.profile !== profile.name || native.computeExecutionKey(record.inputs) !== record.execution_key
        || executionInputs.tool_config_sha256 !== record.inputs.tool_config_sha256 || stableStringify(executionInputs.flags) !== stableStringify(record.inputs.flags)
        || Date.parse(report.timestamp) < Date.parse(record.run_started_at)
        || Date.parse(manifest.manifest.generated_at) < Date.parse(report.timestamp)
        || !native.isExecutionRecordReusable(record, runDir, { executionKey: record.execution_key, artifacts: native.utFrozenRunArtifacts(modules) }).ok) return null;
      const contracts = (require('./capability-resolution') as typeof import('./capability-resolution')).readRunBoundContracts(input.projectRoot, frameworkRoot, input.feature, input.runId, undefined, scope);
      const hdc = require('../../../profiles/hmos-app/harness/hdc-runner') as typeof import('../../../profiles/hmos-app/harness/hdc-runner');
      const owners = modules.flatMap(name => (contracts.modules ?? []).filter(module => module.name === name));
      if (owners.length !== modules.length || host.currentUtExecutionBuildSha(input.projectRoot, owners) !== record.inputs.hap_sha256_full
        || !record.inputs.hap_sha256_full) return null;
      const { loadCoverageEvidence } = require('./coverage-evidence') as typeof import('./coverage-evidence');
      const coverage = loadCoverageEvidence(input.projectRoot, input.feature);
      if (coverage?.feature !== input.feature) return null;
      const { extractUtItBlocks } = require('./ut-it-blocks') as typeof import('./ut-it-blocks');
      const { hasExactUtScopeTag } = require('./ut-tag-match') as typeof import('./ut-tag-match');
      const passed = new Set(modules.flatMap(module => {
        const result = JSON.parse(fs.readFileSync(path.join(runDir, `frozen.ut-result.${module}.json`), 'utf8'));
        const log = hdc.parseHypiumStdout(fs.readFileSync(path.join(runDir, `frozen.hdc-test.${module}.log`), 'utf8'));
        return host.utModuleRoundSucceeded(result) && log && log.failed === 0 && log.total > 0 ? (log.passed_tests ?? []).map(test => `${module}\0${test.test}`) : [];
      }));
      const covered = new Set<string>();
      const qualifiedTests = new Map<string, string[]>();
      for (const mapping of coverage.mappings ?? []) {
        const file = mapping.evidence_ref, id = mapping.scope_id.toUpperCase();
        if (!ids.has(id) || mapping.evidence_source !== 'ut_tags' || !file || !matches(file)) continue;
        const module = contracts.modules?.find(item => file.startsWith(item.package_path.replace(/\/$/, '') + '/'));
        if (!module || !modules.includes(module.name)) continue;
        if (!qualifiedTests.has(file)) {
          const sources = host.utAcceptanceSourcePaths(bound.map(entry => entry.path), [file]);
          qualifiedTests.set(file, sources.some(source => source.includes('/src/main/')) && sources.every(matches)
            ? extractUtItBlocks(fs.readFileSync(path.resolve(input.projectRoot, file), 'utf8')).filter(test => passed.has(`${module.name}\0${test.name}`)
              && report.checks.some(check => check.id === test.name && check.status === 'PASS' && check.affected_files?.includes(file))).map(test => test.name) : []);
        }
        if (qualifiedTests.get(file)!.some(name => hasExactUtScopeTag(name, id))) covered.add(id);
      }
      unitEvidence = { ids: covered, startedAt: Date.parse(record.run_started_at) };
    } catch { /* Missing current formal execution is unknown, never a report-string PASS. */ }
    return unitEvidence;
  };
  for (const [index, prior] of observed.entries()) for (const route of collectFailureRoutesV1(prior.trace).routes) {
    const behavior = prior.behavior.get(route.caseId);
    if (!behavior) continue;
    const original = prior.trace.cases.find(test => test.id.toUpperCase() === route.caseId)!;
    const trigger = (step: typeof original.steps[number], includeSelector = true): string => {
      const observation = 'observation' in step.outcome ? step.outcome.observation : undefined;
      return stableStringify({ kind: step.kind, role: step.role, selector: includeSelector ? step.selector?.request : undefined,
        assertion: observation?.kind === 'assertion' ? observation.assertion_type : undefined,
        expected: observation?.kind === 'assertion' ? Object.fromEntries(Object.entries(observation.facts ?? {}).filter(([key]) => key.startsWith('expected'))) : undefined });
    };
    const triggerActuallyRan = (step: typeof original.steps[number]): boolean => {
      if (step.outcome.status !== 'passed') return false;
      if (step.role !== 'action' || !['touch', 'input', 'swipe', 'scroll', 'back'].includes(step.kind)) return true;
      return step.device_session === true && step.outcome.observation?.kind === 'action' && step.outcome.observation.performed === true;
    };
    const didNotSwitchTarget = (before: typeof original.steps[number], after: typeof original.steps[number]): boolean => {
      const target = before.selector?.resolution.selected?.id;
      return !target || after.selector?.resolution.selected?.id === target;
    };
    const testOwned = route.owner === 'testing' && !route.codingCandidate;
    let originalIndexTarget: { id: string; bounds: string; dumpPath: string } | null | undefined;
    let matchedDump: string | undefined;
    const repairedTest = (next: typeof observed[number], test: typeof original): boolean => {
      if (!testOwned) return false;
      const before = prior.plans.get(route.caseId), after = next.plans.get(test.id.toUpperCase());
      if (!before || !after || before.precondition !== after.precondition || before.expected !== after.expected || before.ac_ref !== after.ac_ref) return false;
      const assertions = (steps: Record<string, unknown>[]) => normalizePlannedSteps(steps).filter(step => step.role === 'assertion');
      const oldAssertions = assertions(before.steps), newAssertions = assertions(after.steps);
      if (!oldAssertions.length) return false;
      const selectorMatches = (step: typeof original.steps[number], assertion: typeof oldAssertions[number]): boolean => {
        if (!assertion.selector) return true;
        const request = step.selector?.request;
        const kind = request?.kind === 'composite' ? request.constraints?.primary : request?.kind;
        return !!request && kind === assertion.selector.kind && request.value === assertion.selector.value
          && (request.match ?? null) === assertion.selector.match;
      };
      const sameTarget = (left: typeof original.steps[number], right: typeof original.steps[number]): boolean => {
        const id = (step: typeof left): string | null | undefined => step.selector?.resolution.state === 'unique' ? step.selector.resolution.selected?.id : undefined;
        return !!id(left) && id(left) === id(right);
      };
      const predicate = (assertion: typeof oldAssertions[number]): string => stableStringify({ kind: assertion.kind,
        body: Object.fromEntries(Object.entries(assertion.body).filter(([key]) => !['by_id', 'by_text', 'by_type', 'by_key', 'match', ...PLANNED_SELECTOR_DISAMBIGUATION_FIELDS].includes(key))) });
      const actual = (assertion: typeof oldAssertions[number]) => test.steps.find(step => step.index === assertion.index && step.kind === assertion.kind
        && step.role === 'assertion' && step.outcome.status === 'passed' && selectorMatches(step, assertion));
      if (!newAssertions.every(actual)) return false;
      const actions = (steps: Record<string, unknown>[]) => normalizePlannedSteps(steps).filter(step => step.role === 'action');
      const oldActions = actions(before.steps), newActions = actions(after.steps);
      if (oldActions.length !== newActions.length || !oldActions.every((old, index) => {
        const now = newActions[index];
        const previous = original.steps.find(step => step.index === old.index);
        const current = test.steps.find(step => step.index === now.index && step.kind === now.kind && step.role === 'action');
        if (old.kind !== now.kind || !current || !triggerActuallyRan(current)) return false;
        if (stableStringify(old.body) === stableStringify(now.body)) return !previous || didNotSwitchTarget(previous, current);
        // A failed literal by_id still names its intended object when the new action uniquely observes that same ID.
        const resolvedOriginalId = previous?.index === route.stepIndex && previous.outcome.status === 'failed'
          && previous.outcome.failure.code === 'selector.not_found' && previous.selector?.resolution.state === 'not_found'
          && previous.selector.request.kind === 'by_id' && current.selector?.resolution.state === 'unique'
          && current.selector.resolution.selected?.id === previous.selector.request.value;
        return previous && old.selectors.length === 1 && now.selectors.length === 1
          && selectorMatches(previous, old) && selectorMatches(current, now)
          && (sameTarget(previous, current) || resolvedOriginalId) && predicate(old) === predicate(now);
      })) return false;
      let cursor = 0;
      let repairedIndexDump: string | undefined;
      const retained = oldAssertions.every(old => {
        while (cursor < newAssertions.length) {
          const now = newAssertions[cursor++];
          if (old.kind === now.kind && stableStringify(old.body) === stableStringify(now.body)) return true;
          const previous = original.steps.find(step => step.index === old.index && step.kind === old.kind && step.role === 'assertion' && selectorMatches(step, old));
          const current = actual(now)!;
          // A selector alias needs the original and new native observations to identify one
          // actual object; equal prose or an unresolved old selector cannot supply that fact.
          if (old.selectors.length !== 1 || now.selectors.length !== 1 || !previous) continue;
          if (sameTarget(previous, current) && predicate(old) === predicate(now)
            && trigger(previous, false) === trigger(current, false)) return true;
          const selector = old.selector;
          const originalRequest = previous.selector?.request;
          const currentRequest = current.selector?.request;
          const resolved = current.selector?.resolution;
          const observation = current.outcome.status === 'passed' ? current.outcome.observation : undefined;
          if (route.domain === 'selector' && previous.index === route.stepIndex && old.kind === 'wait_for' && now.kind === old.kind
            && previous.outcome.status === 'failed' && previous.outcome.failure.code === 'selector.not_found'
            && previous.selector?.resolution.state === 'not_found'
            && selector && (selector.kind === 'by_id' && selector.match === null || selector.kind === 'by_text' && selector.match === 'exact')
            && old.body[selector.kind] === selector.value && Object.keys(old.body).every(key => [selector.kind, 'index', 'match', 'timeout'].includes(key))
            && originalRequest?.kind === 'composite' && currentRequest?.kind === 'composite'
            && typeof old.body.index === 'number' && Number.isInteger(old.body.index) && old.body.index > 0 && now.body.index === 0
            && stableStringify(originalRequest.constraints) === stableStringify({ primary: selector.kind, index: old.body.index })
            && stableStringify(currentRequest.constraints) === stableStringify({ primary: selector.kind, index: now.body.index })
            && old.index === now.index && before.steps.length === after.steps.length
            && before.steps.every((step, index) => index === old.index || stableStringify(step) === stableStringify(after.steps[index]))
            && stableStringify({ ...old.body, index: undefined }) === stableStringify({ ...now.body, index: undefined })
            && resolved?.state === 'unique' && resolved.selected?.id && resolved.selected.bounds
            && observation?.kind === 'assertion' && observation.assertion_type === 'presence' && observation.matched === true) {
            if (originalIndexTarget === undefined) {
              const dumps = previous.artifacts.filter(artifact => artifact.kind === 'ui_dump');
              originalIndexTarget = dumps.length === 1 ? resolveFrozenHylyreSelectorTarget({
                projectRoot: input.projectRoot, hylyreVersion: prior.trace.environment.hylyre_version,
                tracePath: prior.tracePath, artifact: dumps[0],
                predicate: selector.kind === 'by_id' ? { by_id: selector.value } : { by_text: selector.value, match: 'exact' },
              }) : null;
            }
            if (originalIndexTarget?.id === resolved.selected.id && originalIndexTarget.bounds === resolved.selected.bounds) {
              repairedIndexDump = originalIndexTarget.dumpPath;
              return true;
            }
          }
        }
        return false;
      });
      // Changing an action is a test repair; retaining the expected prose while weakening
      // the executable assertion is not. Require each preserved assertion to really pass.
      const covered = retained
        && original.steps.filter(step => step.role === 'assertion' && 'observation' in step.outcome && step.outcome.observation?.kind === 'assertion')
          .every(step => newAssertions.some(assertion => { const now = actual(assertion)!;
            return trigger(now) === trigger(step) || sameTarget(step, now) && trigger(now, false) === trigger(step, false); }));
      if (covered) matchedDump = repairedIndexDump;
      return covered;
    };
    const before = prior.plans.get(route.caseId)!;
    const refs = extractAcceptanceIdRefs(before.ac_ref);
    const candidates = observed.slice(index + 1).flatMap(next => (next.passed.get(before.ac_ref) ?? [])
      .map(({ test, caseId }) => ({ next, test, caseId, tracePath: next.tracePath, planPath: next.derivedPlanPath })));
    const equivalent = candidates.find(({ next, test, caseId }) => next.behavior.get(caseId) === behavior
      && original.steps.filter(step => step.index <= route.stepIndex).every(step => test.steps.some(now =>
        now.index === step.index && triggerActuallyRan(now) && didNotSwitchTarget(step, now) && (step.index === route.stepIndex
          ? now.kind === step.kind && now.role === step.role && stableStringify(now.selector?.request) === stableStringify(step.selector?.request)
            && now.outcome.status === 'passed' && (now.role !== 'assertion' || now.outcome.observation?.kind === 'assertion')
          : trigger(now) === trigger(step))))
      || repairedTest(next, test));
    if (equivalent) input.onCovered?.([prior.tracePath, prior.derivedPlanPath, prior.keyPath,
      equivalent.tracePath, equivalent.planPath, equivalent.next.keyPath, ...(matchedDump ? [matchedDump] : [])]);
    const scoped = !equivalent && candidates.length && refs.length && input.frameworkRoot ? acceptanceForReview(input.frameworkRoot)?.value : null;
    const acceptance = [...(scoped?.criteria ?? []), ...(scoped?.boundaries ?? [])]
      .filter(item => refs.includes(item.id.toUpperCase()));
    const finding: PendingTestingRetest = { route, tracePath: prior.tracePath, derivedPlanPath: prior.derivedPlanPath, behavior, acceptance,
      candidateEvidence: [...new Set(candidates.flatMap(candidate => [candidate.tracePath, candidate.planPath]))],
      reviewCandidates: refs.length && acceptance.length === refs.length ? candidates.map(({ next, caseId, tracePath, planPath }) => ({
        caseId, tracePath, planPath, digest: sha(Buffer.from(stableStringify({ acceptance, caseId, originalCase: route.caseId,
          originalStep: route.stepIndex, originalTrace: [relative(prior.tracePath), prior.record.trace_sha256],
          originalPlan: [relative(prior.derivedPlanPath), prior.record.inputs.derived_plan_sha256],
          trace: [relative(tracePath), next.record.trace_sha256], plan: [relative(planPath), next.record.inputs.derived_plan_sha256],
          hap: input.currentHapSha256 }))),
      })) : [] };
    const deviceCovered = !!equivalent || independentlyCovered(finding, candidates, prior);
    const unit = !deviceCovered && testOwned && refs.length ? currentUnitEvidence() : null;
    const unitCovered = !!unit && unit.startedAt > Date.parse(prior.record.run_started_at) && refs.every(id => unit.ids.has(id.toUpperCase()));
    if (!deviceCovered && !unitCovered) pending.set(route.caseId + ':' + route.stepIndex + ':' + behavior, finding);
  }
  return [...pending.values()];
}

/** Normalize execution status labels for report↔trace comparison. */
function normalizeExecStatus(status: string): string {
  const s = status.trim();
  if (s === 'pass' || s === 'passed') return '通过';
  if (s === 'fail' || s === 'failed') return '失败';
  if (s === 'blocked') return '阻塞';
  if (s === 'skip' || s === 'skipped') return '跳过';
  return s;
}

function execStatusesMatch(reportStatus: string, traceStatus: string): boolean {
  return normalizeExecStatus(reportStatus) === normalizeExecStatus(traceStatus);
}

export type HylyreRunOutcomeVerdict = 'pass' | 'fail';

export interface HylyreRunOutcomeEvaluation {
  verdict: HylyreRunOutcomeVerdict;
  failedCount: number;
  blockedCount: number;
  skippedCount: number;
  passedCount: number;
  outcome: string | null;
  failedCaseIds: string[];
  blockedCaseIds: string[];
  reasonLines: string[];
}

const NON_SUCCESS_OUTCOMES = new Set(['partial', 'failed', 'aborted']);

function nativeCasePassed(caseValue: HylyreTraceCase): boolean {
  return caseValue.execution === 'completed' &&
    caseValue.verification === 'passed' &&
    caseValue.evidence === 'complete';
}

function nativeTraceCaseHasBlockedStep(caseValue: HylyreTraceCase): boolean {
  // v1 把成败收进 outcome；读 `step.status` 在真实 v1 上恒为 undefined，
  // 于是"有阻塞步骤"永远判不出来——这条只在已判 native 的分支上调用。
  return (caseValue.steps ?? []).some(step => step.outcome?.status === 'blocked');
}

/** Evaluate whether Hylyre trace represents a passing device test run (gate semantics). */
export function evaluateHylyreRunOutcome(trace: HylyreTrace | null): HylyreRunOutcomeEvaluation {
  const cases = trace?.cases ?? [];
  // inventory §二 F/§一 G8：旧实现在 schema 不是 0.3-p0 时**回落到中文 case status**
  // （失败/阻塞/跳过/通过）来判 run outcome——这正是 plan T5 第 20 条点名的 legacy fallback。
  //
  // plan a6c4e9f2 T4 返修：上一轮只把注释改成"legacy 不再产 native 判定"，代码里
  // `: cases.filter(c => c.status === '失败')` 那一路**原样留着**——非 v1 时依然靠中文
  // status 算通过数，全通过就 verdict='pass'。中文 status 在 v1 里是**派生投影**、
  // 可以与 steps 完全脱节，拿它当独立事实源正是必须消灭的那条回落路径。
  // 现在改成：非 v1 直接 fail，且不产出任何计数——不给"看起来全通过"留出口。
  const native = dispatchHylyreResult(trace).kind === 'v1';
  if (trace && !native) {
    return {
      verdict: 'fail',
      failedCount: 0,
      blockedCount: 0,
      skippedCount: 0,
      passedCount: 0,
      outcome: trace.outcome ?? null,
      failedCaseIds: [],
      blockedCaseIds: [],
      reasonLines: [
        `authoritative trace 的结果协议不是 ${'hylyre.step-outcome/1'}（schema_version=${String(trace.schema_version)}），` +
        '不得据此判定 run outcome：中文 case status 是派生投影，不是独立事实源。',
      ],
    };
  }
  const failed = cases.filter(c => c.execution !== 'completed' || c.verification === 'failed');
  const blocked = cases.filter(c => c.execution === 'infrastructure_failed' || nativeTraceCaseHasBlockedStep(c));
  const skipped = cases.filter(c => c.verification === 'inconclusive');
  const passed = cases.filter(nativeCasePassed);
  const outcome = trace?.outcome ?? null;

  const reasonLines: string[] = [];
  if (!trace) {
    reasonLines.push('无有效 Hylyre trace.json');
    return {
      verdict: 'fail',
      failedCount: 0,
      blockedCount: 0,
      skippedCount: 0,
      passedCount: 0,
      outcome: null,
      failedCaseIds: [],
      blockedCaseIds: [],
      reasonLines,
    };
  }

  if (outcome && NON_SUCCESS_OUTCOMES.has(outcome)) {
    reasonLines.push(`trace.outcome=${outcome}（非 success）`);
  }
  if (failed.length > 0) {
    reasonLines.push(`失败用例 ${failed.length} 条：${failed.map(c => c.id).join(', ')}`);
  }
  if (blocked.length > 0) {
    reasonLines.push(`阻塞用例 ${blocked.length} 条：${blocked.map(c => c.id).join(', ')}`);
  }
  if (native) {
    const notPassed = cases.filter(c => !nativeCasePassed(c));
    if (notPassed.length > 0 && failed.length === 0 && blocked.length === 0 && skipped.length === 0) {
      reasonLines.push(`native CaseResult 三轴未全通过：${notPassed.map(c => c.id).join(', ')}`);
    }
  }

  const fail =
    (outcome !== null && NON_SUCCESS_OUTCOMES.has(outcome)) ||
    failed.length > 0 ||
    blocked.length > 0 ||
    (native && (cases.length === 0 || passed.length !== cases.length));

  return {
    verdict: fail ? 'fail' : 'pass',
    failedCount: failed.length,
    blockedCount: blocked.length,
    skippedCount: skipped.length,
    passedCount: passed.length,
    outcome,
    failedCaseIds: failed.map(c => c.id),
    blockedCaseIds: blocked.map(c => c.id),
    reasonLines,
  };
}

/** Resolve authoritative hylyre/trace.json from selected derived plan (never top-level backfill). */
export function resolveAuthoritativeHylyreTracePath(reportsBase: string): string | null {
  const latestAttempt = listExecutionKeyRuns(reportsBase)[0];
  if (latestAttempt) {
    return fs.existsSync(latestAttempt.record.trace_path) ? latestAttempt.record.trace_path : null;
  }
  const pick = selectBestNonPlaceholderDerivedPlan(reportsBase);
  if (!pick.selected) return null;
  const hylyreDir = path.dirname(pick.selected.hylyrePath);
  const tracePath = path.join(hylyreDir, 'trace.json');
  return fs.existsSync(tracePath) ? tracePath : null;
}

function pickColumnIndex(table: MdTable, keywords: string[]): number {
  for (const kw of keywords) {
    const idx = table.headers.findIndex(h => h.includes(kw));
    if (idx >= 0) return idx;
  }
  return -1;
}

export interface ReportExecutionResultRow {
  id: string;
  status: string;
  durationMs: number | null;
  durationRaw: string;
}

function normalizeReportCell(value: string): string {
  return value
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseDurationCell(value: string): { valid: boolean; ms: number | null } {
  const clean = normalizeReportCell(value);
  if (!clean) return { valid: false, ms: null };
  if (/^(?:—|-|n\/a|na|不适用)$/i.test(clean)) return { valid: true, ms: null };
  // 报告 SSOT 使用精确整数毫秒；接受合法千分位只为兼容历史人工报告。
  const m = clean.match(/^((?:\d+|\d{1,3}(?:,\d{3})+))\s*(ms|毫秒)$/i);
  if (!m) return { valid: false, ms: null };
  const n = Number(m[1].replace(/,/g, ''));
  if (!Number.isFinite(n) || n < 0) return { valid: false, ms: null };
  return { valid: true, ms: n };
}

/** Parse top-level test-report.md execution result table into rows. */
export function parseReportExecutionRows(reportMd: string): ReportExecutionResultRow[] {
  const section =
    getSectionContent(reportMd, '测试执行结果') ?? getSectionContent(reportMd, '执行结果');
  if (!section) return [];

  const tables = extractTables(section);
  if (tables.length === 0) return [];

  const table = tables[0];
  const iId = pickColumnIndex(table, ['用例编号', '编号']);
  const iStatus = pickColumnIndex(table, ['执行状态', '结果', '状态']);
  const iDuration = pickColumnIndex(table, ['耗时', 'duration']);

  const out: ReportExecutionResultRow[] = [];
  for (const row of table.rows) {
    const tcRaw = (iId >= 0 ? row[iId] : row[0] || '').trim();
    const m = tcRaw.match(/TC-\d+/i);
    if (!m) continue;
    const tcId = m[0].toUpperCase();
    const status = (iStatus >= 0 ? row[iStatus] : '').trim();
    const durationRaw = (iDuration >= 0 ? row[iDuration] : '').trim();
    out.push({
      id: tcId,
      status,
      durationRaw,
      durationMs: iDuration >= 0 ? parseDurationCell(durationRaw).ms : null,
    });
  }
  return out;
}

/** Parse top-level test-report.md execution result table → TC id → status. */
export function parseReportExecutionResults(reportMd: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const row of parseReportExecutionRows(reportMd)) {
    if (row.status) out.set(row.id, row.status);
  }
  return out;
}

export interface ReportTimingReconciliationResult {
  ok: boolean;
  mismatches: string[];
}

export interface ReportTimingReconciliationInput {
  timing: DeviceTestTimingDocument;
  /** The final build meta timestamp; when supplied it must be copied verbatim into the report. */
  buildTimestamp?: string | null;
  /**
   * plan a6c4e9f2 T3：顶层声明 `execution_channel=hylyre` 的 TC 集合（大写）。
   * 提供时，timing 精确集合只与该子集闭合——visual/manual/provider TC 由各自证据链
   * 对账，不得被误报成"不在最终 timing 中"。缺省=legacy 计划（无通道列），沿旧口径。
   */
  hylyreTcIds?: string[];
}

function isReportNullMarker(value: string): boolean {
  return /^(?:—|-|n\/a|na|不适用)$/i.test(normalizeReportCell(value));
}

function tableRowValue(table: MdTable, label: string): string | null {
  const row = table.rows.find(cells => normalizeReportCell(cells[0] ?? '').includes(label));
  return row && row.length > 1 ? row[1]!.trim() : null;
}

function reportStageRow(table: MdTable, label: string): string[] | null {
  return table.rows.find(cells => normalizeReportCell(cells[0] ?? '').includes(label)) ?? null;
}

/**
 * 空值感知的耗时对账（plan 5e1c7a93 D3）：expected 为 null（未量到）时只接受空值占位（`—`），
 * 有数时才做 ±1ms 减法。流水线阶段行与 case 行共用这一条判据，不各写一份。
 */
function durationCellMatches(parsed: { valid: boolean; ms: number | null }, expectedMs: number | null): boolean {
  if (!parsed.valid) return false;
  if (expectedMs === null) return parsed.ms === null;
  return parsed.ms !== null && Math.abs(parsed.ms - expectedMs) <= 1;
}

function compareReportDuration(
  mismatches: string[],
  label: string,
  raw: string | undefined,
  expectedMs: number | null,
): void {
  if (raw === undefined) {
    mismatches.push(`报告流水线缺少阶段：${label}`);
    return;
  }
  const parsed = parseDurationCell(raw);
  if (!parsed.valid) {
    mismatches.push(`报告流水线阶段 ${label} 耗时非法：${raw || '(empty)'}`);
    return;
  }
  if (durationCellMatches(parsed, expectedMs)) return;
  if (expectedMs === null) {
    mismatches.push(`报告流水线阶段 ${label} 应为无数据占位，实际=${raw}`);
    return;
  }
  mismatches.push(`报告流水线阶段 ${label}=${raw}，最终 timing=${expectedMs}ms`);
}

function compareReportTimestamp(
  mismatches: string[],
  label: string,
  raw: string | null,
  expected: string | null | undefined,
): void {
  if (raw === null) {
    mismatches.push(`报告元数据缺少：${label}`);
    return;
  }
  const clean = normalizeReportCell(raw);
  if (expected === null || expected === undefined) {
    if (!isReportNullMarker(clean)) mismatches.push(`报告元数据 ${label} 无法与最终来源对账：${raw}`);
    return;
  }
  if (clean !== expected) mismatches.push(`报告元数据 ${label}=${clean}，最终来源=${expected}`);
}

/** Reconcile the report's final pipeline/case values with device-test-timing.json. */
export function reconcileReportWithDeviceTestTiming(
  reportMd: string,
  input: ReportTimingReconciliationInput,
): ReportTimingReconciliationResult {
  const mismatches: string[] = [];
  const timing = input.timing;
  const section = getSectionContent(reportMd, '真机流水线耗时');
  const tables = section ? extractTables(section) : [];
  const stageTable = tables.find(table =>
    pickColumnIndex(table, ['阶段']) >= 0 && pickColumnIndex(table, ['耗时']) >= 0,
  );
  if (!stageTable) {
    mismatches.push('报告缺少「真机流水线耗时」阶段表');
  } else {
    const stageSpecs: Array<{ label: string; expectedMs: number | null; reused?: boolean }> = [
      { label: '打包', expectedMs: timing.pipeline.build_ms, reused: timing.pipeline.build_reused },
      { label: '装机', expectedMs: timing.pipeline.install_ms, reused: timing.pipeline.install_reused },
      { label: 'Hylyre', expectedMs: timing.pipeline.hylyre_run_ms },
      { label: '快照写入', expectedMs: timing.pipeline.page_save_ms },
      { label: '合计', expectedMs: timing.pipeline.total_harness_ms },
    ];
    for (const spec of stageSpecs) {
      const row = reportStageRow(stageTable, spec.label);
      const iDuration = pickColumnIndex(stageTable, ['耗时']);
      const iNote = pickColumnIndex(stageTable, ['说明']);
      compareReportDuration(
        mismatches,
        spec.label,
        row && iDuration >= 0 ? row[iDuration] : undefined,
        spec.expectedMs,
      );
      if (spec.reused !== undefined) {
        const note = row && iNote >= 0 ? normalizeReportCell(row[iNote] ?? '') : '';
        const reused = note.match(/\breused\s*=\s*(true|false)\b/i);
        if (!reused) {
          mismatches.push(`报告流水线阶段 ${spec.label} 缺少 reused=true|false`);
        } else if (reused[1]!.toLowerCase() !== String(spec.reused)) {
          mismatches.push(`报告流水线阶段 ${spec.label} reused=${reused[1]}，最终 timing=${String(spec.reused)}`);
        }
      }
    }

    const metadataTable = tables.find(table =>
      table.headers.some(header => header.includes('元数据')),
    );
    if (!metadataTable) {
      mismatches.push('报告缺少流水线元数据表');
    } else {
      compareReportTimestamp(
        mismatches,
        'HAP 落盘时间 (hapBuiltAt)',
        tableRowValue(metadataTable, 'HAP 落盘时间'),
        timing.pipeline.hap_built_at,
      );
      if (input.buildTimestamp !== undefined) {
        compareReportTimestamp(
          mismatches,
          '本次 harness 跑 build 门禁时刻',
          tableRowValue(metadataTable, '本次 harness 跑 build 门禁时刻'),
          input.buildTimestamp,
        );
      }
    }
  }

  const reportRows = parseReportExecutionRows(reportMd);
  const normalized = new Map<string, ReportExecutionResultRow[]>();
  for (const row of reportRows) {
    const rows = normalized.get(row.id) ?? [];
    rows.push(row);
    normalized.set(row.id, rows);
  }
  for (const timingCase of timing.cases) {
    const rows = normalized.get(timingCase.id.toUpperCase()) ?? [];
    if (rows.length !== 1) {
      mismatches.push(`报告对 case ${timingCase.id} 应有唯一执行行，实际=${rows.length}`);
      continue;
    }
    const row = rows[0]!;
    // plan 5e1c7a93 D3（codex round2）：duration_ms 放宽为 number | null 后走与
    // compareReportDuration 同一条空值分支——timing 为 null 时报告格应是空值占位（`—`），
    // 有数时才做 ±1ms 减法。否则刚放行的 `—` 会立刻变成一条伪 mismatch。
    if (!durationCellMatches(parseDurationCell(row.durationRaw), timingCase.duration_ms)) {
      mismatches.push(
        `报告 case ${timingCase.id} 耗时=${row.durationRaw || '(empty)'}，最终 timing=` +
        `${timingCase.duration_ms === null ? '无数据（应为 — 占位）' : `${timingCase.duration_ms}ms`}`,
      );
    }
  }
  const timingIds = new Set(timing.cases.map(timingCase => timingCase.id.toUpperCase()));
  const hylyreScope = input.hylyreTcIds ? new Set(input.hylyreTcIds.map(id => id.toUpperCase())) : null;
  for (const row of reportRows) {
    if (timingIds.has(row.id)) continue;
    // 通道精确对账：顶层声明为 visual/manual/provider 的 TC 本就不进 Hylyre timing，
    // 由各自证据链裁决；它们仍留在报告总分母，但不在这里误报缺 timing。
    if (hylyreScope && !hylyreScope.has(row.id)) continue;
    // 顶层计划中未进入 Hylyre 的 explicit skip 可以出现在报告，但不能伪造
    // 一个来自 timing 的执行耗时；其它额外/执行行都说明报告拼接了旧轮数据。
    if (normalizeExecStatus(row.status) !== '跳过') {
      mismatches.push(`报告 case ${row.id} 不在最终 timing 中且状态不是跳过`);
      continue;
    }
    const parsed = parseDurationCell(row.durationRaw);
    if (!parsed.valid || parsed.ms !== null) {
      mismatches.push(`报告 explicit skip case ${row.id} 不应填入最终执行耗时：${row.durationRaw || '(empty)'}`);
    }
  }

  return { ok: mismatches.length === 0, mismatches };
}

/**
 * 从 test-report.md「结论」段提取裁决。
 * 声明式提取：锚定「测试结论:」声明行 + 最长优先，杜绝 '达标'⊂'不达标' 子串
 * 与「下一步建议」枚举裁决词造成的整段污染（旧实现整段 includes 会被"若不达标"骗到）。
 */
export function parseReportConclusionVerdict(reportMd: string): string | null {
  const section = getSectionContent(reportMd, '结论') ?? getSectionContent(reportMd, '测试结论');
  if (!section) return null;
  return extractDeclaredVerdict(section, ['有条件达标', '不达标', '达标']).verdict;
}

export interface ReportTraceReconciliationResult {
  ok: boolean;
  tracePath: string | null;
  mismatches: string[];
  warnings: string[];
}

/** Full reconciliation: top-level test-report vs authoritative hylyre trace. */
export interface ReportTraceReconciliationOptions {
  /**
   * plan a6c4e9f2 T3：顶层声明 `execution_channel=hylyre` 的 TC 集合（大写）。
   * 提供时，报告中登记但不在 trace 的 TC 只有落在该子集内才算 mismatch。
   */
  hylyreTcIds?: string[];
}

export function reconcileReportWithHylyreTrace(
  reportMd: string,
  tracePath: string | null,
  options?: ReportTraceReconciliationOptions,
): ReportTraceReconciliationResult {
  const mismatches: string[] = [];
  const warnings: string[] = [];

  if (!tracePath || !fs.existsSync(tracePath)) {
    return {
      ok: false,
      tracePath,
      mismatches: ['无法定位本轮 hylyre/trace.json（device_test_run 派生目录）'],
      warnings,
    };
  }

  if (!tracePath.replace(/\\/g, '/').includes('/hylyre/trace.json')) {
    warnings.push(`trace 路径非 hylyre/ 子目录：${tracePath}（仍以此为准）`);
  }

  const trace = parseHylyreTrace(tracePath);
  if (!trace) {
    return {
      ok: false,
      tracePath,
      mismatches: [`hylyre/trace.json 无法解析：${tracePath}`],
      warnings,
    };
  }

  const reportStatuses = parseReportExecutionResults(reportMd);
  const traceCases = trace.cases ?? [];
  const conclusion = parseReportConclusionVerdict(reportMd);

  for (const tc of traceCases) {
    const tcId = tc.id.toUpperCase();
    const reportStatus = reportStatuses.get(tcId);
    if (!reportStatus) {
      if (tc.status === '失败' || tc.status === '阻塞') {
        mismatches.push(`${tcId}：trace=${tc.status}，报告未登记该用例`);
      }
      continue;
    }
    if (!execStatusesMatch(reportStatus, tc.status)) {
      mismatches.push(`${tcId}：报告=${reportStatus}，trace=${tc.status}`);
    }
  }

  const hylyreScope = options?.hylyreTcIds ? new Set(options.hylyreTcIds.map(id => id.toUpperCase())) : null;
  for (const [tcId, reportStatus] of reportStatuses) {
    const traceCase = traceCases.find(c => c.id.toUpperCase() === tcId);
    if (!traceCase) {
      // 通道精确对账：顶层声明为 visual/manual/provider 的 TC 不进 Hylyre trace，
      // 由各自证据链裁决；它们仍在报告总分母，但不在这里误报 trace missing。
      if (hylyreScope && !hylyreScope.has(tcId)) continue;
      // explicit_skip / 未进 Hylyre 派生表的 TC 在报告中标「跳过」，不要求 trace.cases 登记
      if (normalizeExecStatus(reportStatus) === '跳过') continue;
      mismatches.push(`${tcId}：报告=${reportStatus}，trace 无该用例记录`);
    }
  }

  if (trace.outcome !== 'success' && conclusion === '达标') {
    mismatches.push(`报告结论=达标，但 trace.outcome=${trace.outcome}`);
  }

  const outcomeEval = evaluateHylyreRunOutcome(trace);
  if (outcomeEval.verdict === 'fail' && conclusion === '达标') {
    if (!mismatches.some(m => m.includes('trace.outcome'))) {
      mismatches.push(`报告结论=达标，但 trace 含失败/阻塞或 outcome≠success`);
    }
  }

  return {
    ok: mismatches.length === 0,
    tracePath,
    mismatches,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// UI entry coverage (use-cases.yaml ui_bindings → derived Hylyre plan)
// ---------------------------------------------------------------------------

export interface UiEntryBinding {
  call: string;
  entryUi: string;
  useCaseId: string;
  priority: 'P0' | 'P1' | 'P2' | 'P3' | 'unknown';
}

export interface DerivedHylyreCaseMeta {
  tcId: string;
  linkedFlow?: string;
  entryUi?: string;
  calls: string[];
}

/** Build call → entry UI bindings from use-cases.yaml. */
export function buildUiEntryBindings(
  spec: UseCasesSpec | null,
  acPriorityMap?: Map<string, string>,
): UiEntryBinding[] {
  if (!spec) return [];
  const parsed = resolveArtifactContent('use-cases@1', spec);
  if (parsed.issues.length) throw new Error(parsed.issues.map(issue => `${issue.path}: ${issue.message}`).join('; '));
  spec = parsed.value as UseCasesSpec;
  const out: UiEntryBinding[] = [];
  for (const uc of spec.use_cases) {
    for (const ub of uc.ui_bindings ?? []) {
      for (const action of ub.user_actions ?? []) {
        for (const call of action.calls ?? []) out.push({
          call,
          entryUi: ub.ui,
          useCaseId: uc.id,
          priority: inferEntryPriority(uc, ub.ui, acPriorityMap),
        });
      }
    }
  }
  return out;
}

function inferEntryPriority(
  uc: UseCaseDef,
  entryUi: string,
  acPriorityMap?: Map<string, string>,
): 'P0' | 'P1' | 'P2' | 'P3' | 'unknown' {
  let best: 'P0' | 'P1' | 'P2' | 'P3' | 'unknown' = 'unknown';
  for (const br of uc.branches ?? []) {
    for (const ac of br.linked_acceptance ?? []) {
      const mapped = acPriorityMap?.get(ac.toUpperCase());
      if (mapped === 'P0') return 'P0';
      if (mapped === 'P1' && best === 'unknown') best = 'P1';
      if (mapped === 'P2' && best === 'unknown') best = 'P2';
      if (mapped === 'P3' && best === 'unknown') best = 'P3';
      if (!acPriorityMap && /P0/i.test(ac)) return 'P0';
    }
  }
  if (/P0/i.test(entryUi)) return 'P0';
  return best;
}

/** entry_ui → priority，从 acceptance.yaml linked_acceptance 解析（SSOT）。 */
export function buildEntryUiPriorityMap(
  spec: UseCasesSpec | null,
  acPriorityMap: Map<string, string>,
): Map<string, 'P0' | 'P1' | 'P2' | 'P3'> {
  const out = new Map<string, 'P0' | 'P1' | 'P2' | 'P3'>();
  for (const b of buildUiEntryBindings(spec, acPriorityMap)) {
    if (b.priority !== 'unknown') out.set(b.entryUi, b.priority);
  }
  return out;
}

/** Group bindings by business call symbol. */
export function groupUiEntriesByCall(
  bindings: UiEntryBinding[],
): Map<string, UiEntryBinding[]> {
  const map = new Map<string, UiEntryBinding[]>();
  for (const b of bindings) {
    const list = map.get(b.call) ?? [];
    list.push(b);
    map.set(b.call, list);
  }
  return map;
}

/** Parse derived Hylyre plan rows for structured entry_ui / linked_flow / calls. */
export function parseDerivedHylyreCaseMetas(derivedMd: string): DerivedHylyreCaseMeta[] {
  const fm = tryParseYamlFrontmatter(derivedMd);
  const fmCases = Array.isArray(fm?.derived_cases)
    ? (fm!.derived_cases as Array<Record<string, unknown>>)
    : null;

  const section = getSectionContent(derivedMd, '测试用例清单') ?? getSectionContent(derivedMd, '测试用例');
  const tables = section ? extractTables(section) : [];
  const table = tables[0];

  const metas: DerivedHylyreCaseMeta[] = [];

  if (fmCases) {
    for (const c of fmCases) {
      const tcId = String(c.tc_id ?? c.id ?? '').toUpperCase();
      if (!/^TC-\d+$/.test(tcId)) continue;
      const callsRaw = c.calls;
      const calls = Array.isArray(callsRaw)
        ? callsRaw.map(String)
        : typeof callsRaw === 'string'
          ? [callsRaw]
          : [];
      metas.push({
        tcId,
        linkedFlow: typeof c.linked_flow === 'string' ? c.linked_flow : undefined,
        entryUi: typeof c.entry_ui === 'string' ? c.entry_ui : undefined,
        calls,
      });
    }
  }

  if (table) {
    const iId = pickColumnIndex(table, ['用例编号', '编号']);
    const iFlow = pickColumnIndex(table, ['linked_flow', '关联流程', '流程']);
    const iEntry = pickColumnIndex(table, ['entry_ui', '入口', 'UI入口']);
    const iCalls = pickColumnIndex(table, ['calls', '业务调用', '调用']);

    for (const row of table.rows) {
      const tcRaw = (iId >= 0 ? row[iId] : row[0] || '').trim();
      const m = tcRaw.match(/TC-\d+/i);
      if (!m) continue;
      const tcId = m[0].toUpperCase();
      const existing = metas.find(x => x.tcId === tcId);
      const linkedFlow = iFlow >= 0 ? row[iFlow]?.trim() : undefined;
      const entryUi = iEntry >= 0 ? row[iEntry]?.trim() : undefined;
      const callsCell = iCalls >= 0 ? row[iCalls]?.trim() : '';
      const calls = callsCell ? callsCell.split(/[,;，；]/).map(s => s.trim()).filter(Boolean) : [];
      if (existing) {
        if (linkedFlow) existing.linkedFlow = linkedFlow;
        if (entryUi) existing.entryUi = entryUi;
        if (calls.length) existing.calls = [...new Set([...existing.calls, ...calls])];
      } else {
        metas.push({ tcId, linkedFlow, entryUi, calls });
      }
    }
  }

  return metas;
}

export interface UiEntryCoverageResult {
  ok: boolean;
  blockers: string[];
  majors: string[];
  warnings: string[];
}

/** A bare call is UI-local only when its named source owns a private handler and directly invokes it. */
function localUiHandler(source: string, ui: string, call: string): boolean {
  if (![ui, call].every(token => /^[A-Za-z_$][\w$]*$/.test(token))) return false;
  const escape = (token: string) => token.replace(/\$/g, '\\$');
  const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g, ' ');
  const owners = [...code.matchAll(/\b(?:class|struct)\s+([A-Za-z_$][\w$]*)/g)];
  if (owners.length !== 1 || owners[0][1] !== ui) return false;
  return new RegExp(`\\bprivate\\s+(?:async\\s+)?${escape(call)}\\s*\\(`).test(code)
    && new RegExp(`\\bthis\\.${escape(call)}\\s*\\(`).test(code);
}

/** Check multi-entry business calls have derived Hylyre coverage per entry_ui. */
export function evaluateUiEntryCoverage(
  spec: UseCasesSpec | null,
  derivedMd: string,
  entryPriorities?: Map<string, 'P0' | 'P1' | 'P2' | 'P3'>,
  source?: { projectRoot: string; files: readonly string[] },
): UiEntryCoverageResult {
  const bindings = buildUiEntryBindings(spec);
  const byCall = groupUiEntriesByCall(bindings);
  const derivedMetas = parseDerivedHylyreCaseMetas(derivedMd);

  const blockers: string[] = [];
  const majors: string[] = [];
  const warnings: string[] = [];

  for (const [call, entries] of byCall) {
    const uniqueEntries = [...new Map(entries.map(e => [e.entryUi, e])).values()];
    if (uniqueEntries.length <= 1) continue;
    const localOwners = source && uniqueEntries.map(({ entryUi }) => {
      const files = source.files.filter(file => /\.(?:ets|tsx?)$/.test(file) && path.basename(file, path.extname(file)) === entryUi);
      if (files.length !== 1) return null;
      try {
        const resolved = fs.realpathSync(path.resolve(source.projectRoot, files[0]));
        return isInsideProjectRoot(fs.realpathSync(source.projectRoot), resolved)
          && localUiHandler(fs.readFileSync(resolved, 'utf-8'), entryUi, call) ? resolved : null;
      } catch { return null; }
    });
    if (localOwners?.every(Boolean) && new Set(localOwners).size === uniqueEntries.length) continue;

    const covered = new Set<string>();
    let structuredMatch = false;

    for (const entry of uniqueEntries) {
      const hit = derivedMetas.some(meta => {
        const callMatch = meta.calls.includes(call) || meta.linkedFlow === call;
        const entryMatch = meta.entryUi === entry.entryUi;
        if (callMatch && entryMatch) {
          structuredMatch = true;
          return true;
        }
        return false;
      });
      if (hit) covered.add(entry.entryUi);
    }

    const missing = uniqueEntries.filter(e => !covered.has(e.entryUi)).map(e => e.entryUi);
    if (missing.length === 0) continue;

    const isP0 = uniqueEntries.some(e => {
      const p = entryPriorities?.get(e.entryUi) ?? e.priority;
      return p === 'P0';
    });

    const msg = `${call}：缺入口派生覆盖 [${missing.join(', ')}]（共 ${uniqueEntries.length} 个入口）`;

    if (!structuredMatch && derivedMetas.some(m => m.entryUi)) {
      /* has some structured fields but not full coverage */
    } else if (!structuredMatch && derivedMetas.length > 0) {
      warnings.push(`${call}：派生计划未携带 entry_ui 结构化字段，无法精确判定多入口覆盖`);
      if (isP0) {
        blockers.push(`${msg}（P0 多入口须派生 entry_ui 字段）`);
      } else {
        majors.push(msg);
      }
      continue;
    }

    if (isP0) blockers.push(msg);
    else majors.push(msg);
  }

  return {
    ok: blockers.length === 0 && majors.length === 0,
    blockers,
    majors,
    warnings,
  };
}

/** Normalize trace cases for export in tests. */
export function traceCasesFromRaw(cases: HylyreTraceCase[]): HylyreTraceCase[] {
  return cases;
}
