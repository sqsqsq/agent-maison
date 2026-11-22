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

type BoundPathResolver = (raw: string) => string[];

function evidencePaths(evidence: string, resolvePath: BoundPathResolver): string[] {
  const paths: string[] = [];
  const addTokens = (text: string, inProse: boolean): void => {
    // The binding is file-level. The path token ends before the report's line-range notation.
    const tokens = text.match(/(?:[A-Za-z]:|[A-Za-z][A-Za-z0-9+.-]*:(?!\d))?[\p{L}\p{M}\p{N}._~%+@/\\-]+(?:\*\.[\w-]+)?/gu) ?? [];
    for (const token of tokens) {
      const file = token.replace(/\.+$/, '');
      if (!path.posix.extname(file.replace(/\\/g, '/'))) continue;
      const resolved = resolvePath(file);
      if (!inProse || resolved.length) {
        paths.push(...resolved);
      } else {
        // Chinese prose can abut a bare filename without spaces, e.g. 见BankConstants.ets。
        const bare = file.replace(/^\p{Script=Han}+|\p{Script=Han}+$/gu, '');
        if (bare !== file) paths.push(...resolvePath(bare));
      }
    }
  };
  const prose = evidence.replace(/`([^`\r\n]+)`|\[[^\]\r\n]*\]\(\s*(?:<([^>\r\n]+)>|([^\s)]+))[^)\r\n]*\)/g,
    (_, code: string | undefined, enclosed: string | undefined, link: string | undefined) => {
      if (code === undefined) {
        // Only the link target identifies the file; the label is display text.
        const target = (enclosed ?? link ?? '').split(/[?#]|[:：](?=\d)/, 1)[0];
        paths.push(...resolvePath(target));
      } else {
        const content = code.trim();
        // A literal path also covers spaces; scan the rest for additional files in the span.
        const [file] = content.split(/#|[:：](?=\d)/, 1);
        const literal = /^[A-Za-z]:/.test(content) ? [] : resolvePath(file.trimEnd());
        paths.push(...literal);
        addTokens(literal.length ? content.slice(file.length) : content, false);
      }
      return ' ';
    });
  addTokens(prose, true);
  return paths;
}

function normalizedRelativePath(raw: string): string | undefined {
  const slashed = raw.replace(/\\/g, '/');
  if (!slashed || path.posix.isAbsolute(slashed) || /[:\0]/.test(slashed) || slashed.endsWith('/')
    || slashed.split('/').includes('..')) return undefined;
  return path.posix.normalize(slashed);
}

function boundPathResolver(bound: readonly string[]): BoundPathResolver {
  const byName = new Map<string, string[]>();
  for (const file of bound) {
    if (normalizedRelativePath(file) !== file) continue;
    const name = path.posix.basename(file);
    const extension = path.posix.extname(name);
    for (const key of extension ? [name, `*${extension}`] : [name]) {
      const paths = byName.get(key) ?? [];
      paths.push(file);
      byName.set(key, paths);
    }
  }
  return raw => {
    const file = normalizedRelativePath(raw);
    if (!file) return [];
    const basename = path.posix.basename(file);
    const candidates = byName.get(basename) ?? [];
    if (basename.startsWith('*.')) {
      // A directory wildcard cites only files immediately under that directory.
      const directory = path.posix.dirname(file);
      return directory === '.' ? [] : candidates.filter(candidate => {
        const parent = path.posix.dirname(candidate);
        return parent === directory || parent.endsWith('/' + directory);
      });
    }
    if (file === basename) return candidates;
    if (candidates.includes(file)) return [file];

    // Reports can omit intermediate directories, e.g. Phone/pages/index.ets.
    const directories = file.split('/').slice(0, -1);
    return candidates.filter(candidate => {
      let next = 0;
      for (const segment of candidate.split('/').slice(0, -1)) {
        if (segment === directories[next]) next++;
      }
      return next === directories.length;
    });
  };
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

function issueReferences(issue: IssueVerificationEntry, resolvePath: BoundPathResolver): string[] {
  const evidence = issue.evidence ?? '';
  const issueFile = /^\s*`?([^`|]+?)`?\s*\|/.exec(evidence)?.[1];
  return [...evidencePaths(evidence, resolvePath),
    ...[...(issueFile ? [issueFile.trim()] : []), ...(issue.production_paths ?? [])].flatMap(resolvePath)];
}

function rowReferences(row: VerifierSummaryRow, issues: IssueVerificationEntry[], phase: string, resolvePath: BoundPathResolver): string[] {
  return [...evidencePaths(row.evidence, resolvePath), ...issues.filter(({ issue }) => rowAddressesIssue(row, issue, phase))
    .flatMap(issue => issueReferences(issue, resolvePath))];
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
    const oldPaths = material.files.filter(file => file.sha256 !== null && normalizedRelativePath(file.path) === file.path).map(file => file.path);
    const resolvePath = boundPathResolver(oldPaths);
    const testFiles = new Set(partitionConstructionFiles(projectRoot, profile.profileDir, { files: oldPaths, modules: [] }).tests);
    const issues = readUniqueIssues(reportText);
    return Object.fromEntries(rows.flatMap(row => {
      const tests = [...new Set(rowReferences(row, issues, phase, resolvePath).filter(file => testFiles.has(file)))];
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

  const resolvePath = boundPathResolver(previousMaterial.files.filter(file => file.sha256 !== null).map(file => file.path));
  const issues = readUniqueIssues(previousReportText);
  const refsById = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!applicableIds.has(row.id)) continue;
    const references = [
      ...rowReferences(row, issues, currentMaterial.phase, resolvePath),
      ...(currentMaterial.phase === 'ut' ? (input.utSourcePaths?.[row.id] ?? []).flatMap(resolvePath) : []),
    ];
    refsById.set(row.id, new Set(references));
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
    const paths = [...(oldIssue ? issueReferences(oldIssue, resolvePath) : []), ...(finding.files ?? []).flatMap(resolvePath)];
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
