import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { performance } from 'perf_hooks';
import { REPO_ROOT } from './test-dependency-graph';
import type { GroupFootprint } from './test-impact';
import type { TestInputReads } from './test-input-observer';

export function mergeGroupCoverage(directory: string, workerPid: number | undefined, reads?: TestInputReads): GroupFootprint {
  const started = performance.now();
  const executed = new Set<string>(), reasons = new Set(reads?.coverageUnknown ?? []), pids = new Set<number>();
  const reportedScripts = new Map<number, Set<string>>();
  const aliases = new Map<string, string>();
  for (const [destination, source] of reads?.aliases ?? []) if (!aliases.has(destination)) aliases.set(destination, source);
  const mappedPaths = new Map<string, string>();
  const generatedFiles = new Set(reads?.generatedFiles ?? []);
  let bytes = 0;
  const normalize = (raw: string, execution = false): string | undefined => {
    let file: string;
    try { file = raw.startsWith('file:') ? fileURLToPath(raw) : path.resolve(raw); } catch { return; }
    const cached = mappedPaths.get(file);
    if (cached !== undefined) file = cached;
    else {
      const original = file;
      for (let pass = 0; pass < 4; pass++) {
        let prefix = file, source: string | undefined;
        // Ancestors visit the longest matching destination first, including nested copies.
        for (;;) {
          source = aliases.get(prefix);
          if (source !== undefined && (file === prefix || file.startsWith(prefix + path.sep))) break;
          const parent = path.dirname(prefix);
          if (parent === prefix) { source = undefined; break; }
          prefix = parent;
        }
        if (source === undefined) break;
        file = path.join(source, path.relative(prefix, file));
      }
      mappedPaths.set(original, file);
    }
    const relative = path.relative(REPO_ROOT, file).replace(/\\/g, '/');
    if (relative.startsWith('../') || path.isAbsolute(relative)) {
      if (execution && /\.[cm]?tsx?$/.test(file) && !file.includes('node_modules') && !generatedFiles.has(file)) reasons.add(`unmapped external source: ${file}`);
      return;
    }
    if (relative.split('/').includes('node_modules') || /^harness\/(?:dist|reports)\//.test(relative)) return;
    return relative;
  };
  try {
    for (const name of fs.readdirSync(directory)) {
      const file = path.join(directory, name);
      if (!fs.statSync(file).isFile()) continue;
      bytes += fs.statSync(file).size;
      const match = /^coverage-(\d+)-/.exec(name);
      if (match) pids.add(Number(match[1]));
      try {
        const data = JSON.parse(fs.readFileSync(file, 'utf8')) as { result?: Array<{ url: string }> };
        const pid = match ? Number(match[1]) : undefined;
        if (pid !== undefined && !reportedScripts.has(pid)) reportedScripts.set(pid, new Set());
        for (const script of data.result ?? []) {
          if (pid !== undefined) reportedScripts.get(pid)!.add(script.url);
          if (!script.url.startsWith('file:')) continue;
          const source = normalize(script.url, true); if (source) executed.add(source);
        }
      } catch { reasons.add(`invalid V8 report: ${name}`); }
      fs.unlinkSync(file);
    }
    if (!workerPid || !pids.has(workerPid)) reasons.add('worker coverage missing');
    for (const pid of reads?.expectedPids ?? []) if (!pids.has(pid)) reasons.add(`descendant coverage missing: ${pid}`);
    const assigned = new Set<number>([...(reads?.expectedPids ?? []), ...(workerPid ? [workerPid] : [])]);
    for (const launch of reads?.nodeLaunches ?? []) {
      if (!launch.exited || launch.code === null || launch.code === undefined || launch.signal) { reasons.add('Node/guardian exit unobserved or killed'); continue; }
      if (launch.pid) continue;
      const matchesEntry = (scripts: Set<string>): boolean => launch.eval ? [...scripts].some(url => /\[eval\]|evalmachine\.<anonymous>/.test(url))
        : !!launch.entry && [...scripts].some(url => {
          if (!url.startsWith('file:')) return false;
          try { const mapped = normalize(url); return path.resolve(fileURLToPath(url)).toLowerCase() === path.resolve(launch.entry!).toLowerCase() || !!mapped && mapped === normalize(launch.entry!); } catch { return false; }
        });
      const candidate = [...reportedScripts].find(([pid, scripts]) => !assigned.has(pid) && matchesEntry(scripts));
      if (!candidate) reasons.add('guardian Node entry coverage missing');
      else assigned.add(candidate[0]);
    }
  } catch { reasons.add('V8 coverage collection failed'); }
  const normalizeReads = (values: string[]): string[] => [...new Set(values.map(value => normalize(path.resolve(REPO_ROOT, value))).filter((value): value is string => !!value))].sort();
  return { executed: [...executed].sort(), files: normalizeReads(reads?.files ?? []), directories: normalizeReads(reads?.directories ?? []), executionComplete: reasons.size === 0, readsComplete: reads?.complete === true, reasons: [...reasons, ...(reads?.reasons ?? [])], coverageBytes: bytes, coveragePeakBytes: bytes, mergeMs: performance.now() - started };
}
