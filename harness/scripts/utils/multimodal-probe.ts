// ============================================================================
// multimodal-probe.ts — adapter 多模态可用性探测（M3）
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import { inferRepoLayout } from '../../repo-layout';

export interface MultimodalProbeResult {
  supported: boolean;
  adapter: string;
  reason: string;
}

/** 读取 agents/<adapter>/adapter.yaml 的 multimodal 声明 */
export function probeAdapterMultimodal(
  projectRoot: string,
  frameworkRoot: string,
  adapterName: string | undefined,
): MultimodalProbeResult {
  const adapter = (adapterName ?? 'generic').trim() || 'generic';
  const adapterYaml = path.join(frameworkRoot, 'agents', adapter, 'adapter.yaml');
  if (!fs.existsSync(adapterYaml)) {
    return {
      supported: adapter === 'cursor' || adapter === 'claude',
      adapter,
      reason: `adapter.yaml 缺失；回退 heuristic（cursor/claude=true）`,
    };
  }
  try {
    const doc = YAML.parse(fs.readFileSync(adapterYaml, 'utf-8')) as Record<string, unknown>;
    if (typeof doc.multimodal === 'boolean') {
      return {
        supported: doc.multimodal,
        adapter,
        reason: `adapter.yaml multimodal=${doc.multimodal}`,
      };
    }
  } catch {
    /* fall through */
  }
  const supported = adapter === 'cursor' || adapter === 'claude';
  return {
    supported,
    adapter,
    reason: `adapter.yaml 未声明 multimodal；heuristic ${supported}`,
  };
}

export function resolveAdapterMultimodal(
  projectRoot: string,
  adapterName: string | undefined,
): boolean {
  const layout = inferRepoLayout(projectRoot);
  return probeAdapterMultimodal(projectRoot, layout.frameworkRoot, adapterName).supported;
}

/** 从 spec visual handoff 收集图片路径用于多模态注入 */
export function collectAuthoritativeImagePaths(
  projectRoot: string,
  specMarkdown: string,
  resolvePath: (p: string) => string | null,
): string[] {
  const paths: string[] = [];
  const re = /path:\s*([^\n]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(specMarkdown)) !== null) {
    const raw = m[1].trim().replace(/^['"]|['"]$/g, '');
    if (!/\.(png|jpe?g|webp|gif)$/i.test(raw)) continue;
    const abs = resolvePath(raw);
    if (abs && fs.existsSync(abs)) paths.push(abs);
  }
  return paths;
}
