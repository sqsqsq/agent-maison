/**
 * check-testing：读取 testing reports 下 meta 的 root_pollution，产出非 BLOCKER WARN。
 */
import * as fs from 'fs';
import * as path from 'path';
import type { RootPollutionMeta } from '../../../profiles/hmos-app/harness/hylyre-root-pollution';

function readJsonMeta<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
  } catch {
    return null;
  }
}

/** 优先 hylyre-ready.meta.json（ensure），再 device-test-run.meta.json。 */
export function loadTestingRootPollutionMeta(
  reportsBase: string,
): { source: string; pollution: RootPollutionMeta } | null {
  const candidates: Array<{ source: string; file: string }> = [
    { source: 'hylyre-ready.meta.json', file: path.join(reportsBase, 'hylyre-ready.meta.json') },
    { source: 'device-test-run.meta.json', file: path.join(reportsBase, 'device-test-run.meta.json') },
  ];
  for (const c of candidates) {
    const j = readJsonMeta<{ root_pollution?: RootPollutionMeta }>(c.file);
    if (j?.root_pollution) {
      return { source: c.source, pollution: j.root_pollution };
    }
  }
  return null;
}

export function formatRootPollutionWarnDetails(
  hit: { source: string; pollution: RootPollutionMeta },
  reportsBase: string,
): string {
  const p = hit.pollution;
  const flags = [
    p.tmp_hypium ? 'tmp_hypium' : null,
    p.reports ? 'reports' : null,
    p.reports_changed ? 'reports_changed' : null,
  ]
    .filter(Boolean)
    .join(', ');
  return (
    `宿主工程根 Hylyre/Hypium 误落盘（${flags || 'unknown'}，phase=${p.phase}，见 ${path.join(reportsBase, hit.source)}）。` +
    `请确认 framework 已用 hypiumWorkDir 跑 hylyre，勿在工程根直跑 python -m hylyre。`
  );
}
