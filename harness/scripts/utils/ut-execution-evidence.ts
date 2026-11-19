import * as fs from 'fs';
import * as path from 'path';
import type { CheckResult } from './types';
import { validateProjectRelativePath } from './project-relative-path';
import { featurePhaseReportsDir } from '../../config';
import { evidenceEntryMatchesCurrentFile, loadPhaseEvidenceManifest, sha256File } from './phase-evidence-manifest';
import type { ScriptReport } from './types';
import type { IdentityNeutralDigestReaders } from './identity-neutral-digest';

/** Project exact native case observations into the existing file#check evidence contract. */
export function executedUtChecks(
  projectRoot: string,
  candidates: readonly { path: string; test: string }[],
  passed: readonly { suite: string; test: string }[],
  executionOriginals: readonly string[] = [],
): CheckResult[] {
  const originals = executionOriginals.flatMap(file => {
    try {
      const relative = validateProjectRelativePath(projectRoot, path.isAbsolute(file) ? path.relative(projectRoot, file) : file, 'native UT original');
      const sha256 = sha256File(path.resolve(projectRoot, relative));
      return sha256 ? [{ path: relative, role: 'artifact', exists: true, sha256 }] : [];
    } catch { return []; }
  });
  return [...new Set(passed.map(item => item.test))].flatMap(test => {
    const matches = [...new Map(candidates.filter(candidate => candidate.test === test).map(candidate => [candidate.path, candidate])).values()];
    if (matches.length !== 1) return [];
    try {
      const file = validateProjectRelativePath(projectRoot, matches[0].path, 'executed UT source');
      if (!fs.readFileSync(path.resolve(projectRoot, file), 'utf8').includes(test)) return [];
      return [{ id: test, category: 'traceability', severity: 'MINOR', status: 'PASS',
        description: 'Native UT case execution', details: `Native runner reported PASS: ${test}`,
        affected_files: [file], ...(originals.length && originals.length === executionOriginals.length
          ? { structured: { source_attempt_dependencies: originals } } : {}) } as CheckResult];
    } catch { return []; }
  });
}

/** Read one synchronous snapshot of the published case results and their original files. */
export function readCurrentUtCaseReport(input: { projectRoot: string; feature: string; frameworkRoot?: string; authorityReaders?: IdentityNeutralDigestReaders }) {
  const { projectRoot, feature, frameworkRoot, authorityReaders } = input;
  try {
    const loaded = loadPhaseEvidenceManifest(projectRoot, feature, 'ut');
    if (!loaded?.integrityOk) return null;
    const bound = [...loaded.manifest.inputs, ...loaded.manifest.outputs];
    const verified = new Map<string, boolean>();
    const current = (file: string): boolean => {
      const prior = verified.get(file);
      if (prior !== undefined) return prior;
      const matches = bound.some(entry => entry.path === file && entry.exists
        && evidenceEntryMatchesCurrentFile(projectRoot, entry, feature, authorityReaders));
      verified.set(file, matches);
      return matches;
    };
    const reportFile = path.join(featurePhaseReportsDir(projectRoot, feature, 'ut', frameworkRoot), 'script-report.json');
    const relative = path.relative(projectRoot, reportFile).replace(/\\/g, '/');
    if (!current(relative)) return null;
    const report = JSON.parse(fs.readFileSync(reportFile, 'utf8')) as ScriptReport;
    if (report.feature !== feature || report.phase !== 'ut' || !Number.isFinite(Date.parse(report.timestamp))
      || Date.parse(loaded.manifest.generated_at) < Date.parse(report.timestamp)
      || !Array.isArray(report.checks) || !report.checks.some(check => check.id === 'ut_hvigor_test' && check.status === 'PASS')) return null;
    const originals = (check: CheckResult): string[] => {
      const sources = (check.structured as { source_attempt_dependencies?: unknown } | undefined)?.source_attempt_dependencies;
      if (!Array.isArray(sources) || !sources.length) return [];
      const files = sources.flatMap(dep => {
        if (!dep || typeof dep.path !== 'string' || dep.role !== 'artifact' || dep.exists !== true || typeof dep.sha256 !== 'string') return [];
        return bound.some(entry => entry.path === dep.path && entry.sha256 === dep.sha256) && current(dep.path) ? [dep.path] : [];
      });
      return files.length === sources.length ? files : [];
    };
    const passed = report.checks.filter(check => check.status === 'PASS' && check.description === 'Native UT case execution');
    return { report, current, originals, passed };
  } catch { return null; }
}
