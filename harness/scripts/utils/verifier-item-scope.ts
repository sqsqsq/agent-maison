import * as path from 'path';
import { loadFrameworkConfig } from '../../config';
import { loadResolvedProfile } from '../../profile-loader';
import { tryLoadProfileHarnessModule } from '../../profile-host-loader';
import { extractTables } from './markdown-parser';
import {
  parseIssueVerificationBlock, readVerifierSummaryRows, verifierSemanticChecks,
  type IssueVerificationEntry, type VerifierSummaryRow,
} from './repair-candidates';
import { partitionConstructionFiles } from './repair-responsibility';
import { diffVerifierMaterial, type VerifierMaterialView } from './verifier-material';
import { parseResultBlock } from './verifier-subject';
import { isBlockingCheck } from './check-disposition';

export interface VerifierItemScope {
  mode: 'full' | 'partial' | 'reuse';
  requiredIds: string[];
  reviewIds: string[];
  reusedRows: VerifierSummaryRow[];
  reviewPaths?: string[];
}

export function verifierTemplateCheckIds(text: string): string[] {
  const tables = extractTables(text).filter(({ headers }) =>
    headers.length === 2 && headers[0].toLowerCase() === 'id' && headers[1].toLowerCase() === 'severity');
  return tables.length === 1 ? tables[0].rows
    .map(([id]) => id.replace(/[`*~]/g, '').trim()).filter(id => /^[A-Za-z][A-Za-z0-9_.-]*$/.test(id)) : [];
}

function evidenceLinePaths(evidence: string): string[] {
  const quoted = [...evidence.matchAll(/`([^`\r\n]+?):[1-9]\d*(?=[`,.\-，])/g)].map(match => match[1]);
  const bare = [...evidence.replace(/`[^`\r\n]*`/g, '').matchAll(/([^\s`'"<>()[\]，。；、：|]+\.[\w-]+):[1-9]\d*/g)]
    .map(match => match[1].replace(/^.*(?:→|↔)/, ''));
  return [...quoted, ...bare];
}

function resolveBoundPath(raw: string, bound: ReadonlySet<string>): string | undefined {
  const normalized = raw.replace(/\\/g, '/');
  if (path.posix.isAbsolute(normalized) || /^[A-Za-z]:/.test(normalized) || normalized.split('/').includes('..')) return undefined;
  const file = path.posix.normalize(normalized);
  if (bound.has(file)) return file;
  const candidates = [...bound].filter(candidate => candidate.endsWith('/' + file));
  return candidates.length === 1 ? candidates[0] : undefined;
}

export function citesIssue(evidence: string, issue: string): boolean {
  const escaped = issue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^A-Za-z0-9_.-])${escaped}(?![A-Za-z0-9_.-])`).test(evidence);
}

function readUniqueIssues(text: string): IssueVerificationEntry[] {
  const parsed = parseIssueVerificationBlock(text);
  if (!parsed.ok) return [];
  const counts = new Map<string, number>();
  for (const { issue } of parsed.entries) counts.set(issue, (counts.get(issue) ?? 0) + 1);
  return parsed.entries.filter(entry => !entry.invalid_reason && counts.get(entry.issue) === 1);
}

function rowAddressesIssue(row: VerifierSummaryRow, issue: string, phase: string): boolean {
  return row.id === issue || citesIssue(row.evidence, issue)
    || (phase === 'review' && row.id === 'issue_accuracy' && /^CR-[0-9]+$/.test(issue));
}

function issueReferences(issue: IssueVerificationEntry): string[] {
  const evidence = issue.evidence ?? '';
  const issueFile = /^\s*`?([^`|]+?)`?\s*\|/.exec(evidence)?.[1];
  return [...evidenceLinePaths(evidence), ...(issueFile ? [issueFile.trim()] : []), ...(issue.production_paths ?? [])];
}

function rowReferences(row: VerifierSummaryRow, issues: IssueVerificationEntry[], phase: string): string[] {
  return [...evidenceLinePaths(row.evidence), ...issues.filter(({ issue }) => rowAddressesIssue(row, issue, phase)).flatMap(issueReferences)];
}

export function readVerifierUtSourcePaths(input: {
  projectRoot: string;
  frameworkRoot?: string;
  feature: string;
  phase: string;
  material: VerifierMaterialView | null;
  reportText: string | null;
}): Record<string, string[]> {
  const { projectRoot, frameworkRoot, phase, material, reportText } = input;
  if (phase !== 'ut' || material?.phase !== phase || material.feature !== input.feature || !reportText) return {};
  const rows = readVerifierSummaryRows(reportText);
  if (!rows?.length) return {};
  try {
    const profile = loadResolvedProfile(projectRoot, loadFrameworkConfig(projectRoot), frameworkRoot);
    const host = tryLoadProfileHarnessModule<Pick<typeof import('../../../profiles/hmos-app/harness/ut-host-impl'), 'utAcceptanceSourcePaths'>>(
      profile.profileDir, 'ut-host-impl',
    );
    if (!host?.utAcceptanceSourcePaths) return {};
    const bound = new Set(material.files.filter(file => file.sha256 !== null).map(file => file.path));
    const oldPaths = [...bound];
    const testFiles = new Set(partitionConstructionFiles(projectRoot, profile.profileDir, { files: oldPaths, modules: [] }).tests);
    const issues = readUniqueIssues(reportText);
    return Object.fromEntries(rows.flatMap(row => {
      const tests = [...new Set(rowReferences(row, issues, phase).map(file => resolveBoundPath(file, bound))
        .filter((file): file is string => !!file && testFiles.has(file)))];
      return tests.length ? [[row.id, host.utAcceptanceSourcePaths(oldPaths, tests)]] : [];
    }));
  } catch {
    return {};
  }
}

export function selectVerifierItemScope(input: {
  previousMaterial: VerifierMaterialView | null;
  currentMaterial: VerifierMaterialView | null;
  previousReportText: string | null;
  applicableIds: readonly string[];
  requiredIds?: readonly string[];
  recheckIds?: readonly string[];
  recheckFindings?: readonly { id: string; files?: readonly string[] }[];
  /** Paths selected by the profile from the old binding and the applicable UT cases. */
  utSourcePaths?: Readonly<Record<string, readonly string[]>>;
}): VerifierItemScope {
  const { previousMaterial, currentMaterial, previousReportText } = input;
  const findingChecks: string[] = [];
  const findings = (input.recheckFindings ?? []).filter(finding => {
    if (input.applicableIds.includes(finding.id)) {
      findingChecks.push(finding.id);
      return false;
    }
    if (currentMaterial?.phase === 'review' && /^CR-[0-9]+$/.test(finding.id) && input.applicableIds.includes('issue_accuracy')) {
      findingChecks.push('issue_accuracy');
      if (input.applicableIds.includes('false_positive_rate')) findingChecks.push('false_positive_rate');
      return false;
    }
    return true;
  });
  const recheckIds = [...new Set([...(input.recheckIds ?? []), ...findingChecks])];
  const requiredIds = [...new Set([...(input.requiredIds ?? []), ...recheckIds])];
  const applicableIds = new Set([...input.applicableIds, ...requiredIds]);
  const full: VerifierItemScope = { mode: 'full', requiredIds, reviewIds: [...applicableIds], reusedRows: [] };
  if (!previousMaterial || !currentMaterial || !previousReportText
    || previousMaterial.feature !== currentMaterial.feature || previousMaterial.phase !== currentMaterial.phase) return full;

  // A non-file binding change has no path to assign, even when file edits are otherwise attributable.
  if (diffVerifierMaterial({ ...previousMaterial, files: [] }, { ...currentMaterial, files: [] }).length) return full;
  const oldFiles = new Map(previousMaterial.files.map(file => [file.path, file.sha256]));
  const currentFiles = new Set(currentMaterial.files.map(file => file.path));
  const changedPaths = [
    ...currentMaterial.files.filter(file => oldFiles.get(file.path) !== file.sha256).map(file => file.path),
    ...previousMaterial.files.filter(file => !currentFiles.has(file.path)).map(file => file.path),
  ];
  if (!changedPaths.length && !requiredIds.length && !findings.length) {
    return { mode: 'reuse', requiredIds, reviewIds: [], reusedRows: [] };
  }

  const oldResult = parseResultBlock(previousReportText);
  const rows = readVerifierSummaryRows(previousReportText);
  if (!rows) {
    if (changedPaths.length || findings.length || oldResult?.verdict === 'FAIL'
      || /^\s*\|\s*id\s*\|\s*status\b/im.test(previousReportText)) return full;
    return { mode: 'partial', requiredIds, reviewIds: requiredIds, reusedRows: [] };
  }

  const byId = new Map(rows.map(row => [row.id, row]));
  const reviewIds = new Set(recheckIds);
  for (const id of requiredIds) {
    if (!byId.get(id)?.evidence) reviewIds.add(id);
  }
  const blockers = new Set<string>();
  for (const row of rows) {
    const blocking = isBlockingCheck({ id: row.id, status: row.status, severity: row.severity }, []);
    const needsAnswer = row.status !== 'PASS' && !row.evidence;
    if ((blocking || needsAnswer) && !applicableIds.has(row.id)) return full;
    if (blocking) blockers.add(row.id);
    if (needsAnswer) reviewIds.add(row.id);
  }
  for (const finding of verifierSemanticChecks(previousReportText, previousMaterial.phase, previousMaterial.feature)) {
    if (typeof finding.id !== 'string') continue;
    const row = byId.get(finding.id);
    const severity = String(finding.severity).toUpperCase();
    if (row && (finding.status !== row.status || severity !== row.severity)) return full;
    if (!row && (finding.status === 'FAIL' || finding.status === 'WARN' || finding.status === 'SKIP')) {
      if (!applicableIds.has(finding.id)) return full;
      reviewIds.add(finding.id);
      if (isBlockingCheck({ id: finding.id, status: finding.status, severity }, [])) blockers.add(finding.id);
    }
  }
  if (oldResult && oldResult.blocker_count !== blockers.size) return full;

  const bound = new Set(previousMaterial.files.filter(file => file.sha256 !== null).map(file => file.path));
  const issues = readUniqueIssues(previousReportText);
  const refsById = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!applicableIds.has(row.id)) continue;
    const references = [
      ...rowReferences(row, issues, currentMaterial.phase),
      ...(currentMaterial.phase === 'ut' ? input.utSourcePaths?.[row.id] ?? [] : []),
    ];
    refsById.set(row.id, new Set(references.map(reference => resolveBoundPath(reference, bound))
      .filter((file): file is string => !!file)));
  }
  for (const file of changedPaths) {
    const affected = [...refsById].filter(([, refs]) => refs.has(file));
    if (!affected.length) return full;
    for (const [id] of affected) reviewIds.add(id);
  }
  for (const finding of findings) {
    const observed = rows.filter(row => applicableIds.has(row.id) && rowAddressesIssue(row, finding.id, currentMaterial.phase));
    if (observed.length) {
      for (const { id } of observed) reviewIds.add(id);
      continue;
    }
    const oldIssue = issues.find(entry => entry.issue === finding.id);
    const paths = [...(oldIssue ? issueReferences(oldIssue) : []), ...(finding.files ?? [])]
      .map(file => resolveBoundPath(file, bound)).filter((file): file is string => !!file);
    const affected = [...refsById].filter(([, refs]) => paths.some(file => refs.has(file)));
    if (!affected.length) return full;
    for (const [id] of affected) reviewIds.add(id);
  }
  if (currentMaterial.phase === 'review' && applicableIds.has('issue_accuracy') && applicableIds.has('false_positive_rate')
    && (reviewIds.has('issue_accuracy') || reviewIds.has('false_positive_rate'))) {
    reviewIds.add('issue_accuracy');
    reviewIds.add('false_positive_rate');
  }
  return {
    mode: reviewIds.size ? 'partial' : 'reuse',
    requiredIds,
    reviewIds: [...reviewIds],
    reusedRows: rows.filter(row => applicableIds.has(row.id) && !reviewIds.has(row.id) && row.evidence),
    reviewPaths: [...new Set([...changedPaths, ...[...reviewIds].flatMap(id => [...(refsById.get(id) ?? [])])])],
  };
}
