/**
 * P0-9a（plan e7a91b3c）：build 指纹——visual 判定持久化的新鲜度键之一。
 *
 * 语义：判定绑定「被评截图文件（文件 hash）＋截图采集时的应用构建（本指纹）」；build 没变
 * 判定就有效，改码重装（hap 内容变）→ 指纹变 → 全部已定判定自动失效重判。
 *
 * 防伪铁律（cursor/codex 同点，评审写死）：
 *  - 指纹一律**现算自实际安装的 hap 文件内容 sha256**（前 12 hex）；
 *  - install meta 的 hapPath 只用来**定位文件**，meta 内任何 hash 字段不作为"当前指纹"来源
 *    （可 hand-edit）；mtime/size 更不得作键；
 *  - 计算失败/文件缺失 → null——消费侧（capture 跳采/check 判 stale）遇 null 一律按
 *    "指纹不可用"保守处理：不得跳采、不启用指纹校验（行为退回现状）。
 */
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { featurePhaseReportsDir } from '../../../harness/config';

/** 实际 hap 文件内容 sha256 前 12 hex；文件缺失/读取失败 → null（消费侧保守处理）。 */
export function computeHapBuildFingerprint(hapPath: string | null | undefined): string | null {
  if (typeof hapPath !== 'string' || !hapPath.trim()) return null;
  try {
    if (!fs.existsSync(hapPath)) return null;
    return crypto.createHash('sha256').update(fs.readFileSync(hapPath)).digest('hex').slice(0, 12);
  } catch {
    return null;
  }
}

/**
 * check 端解析"当前构建指纹"：读 device-test-install.meta.json 拿 hapPath（仅定位），
 * 指纹现算文件内容。任何一环失败 → null。
 */
export function resolveCurrentBuildFingerprint(
  projectRoot: string,
  feature: string,
  phase = 'testing',
  frameworkRoot?: string,
): string | null {
  try {
    const metaAbs = path.join(
      featurePhaseReportsDir(projectRoot, feature, phase, frameworkRoot),
      'device-test-install.meta.json',
    );
    if (!fs.existsSync(metaAbs)) return null;
    const meta = JSON.parse(fs.readFileSync(metaAbs, 'utf-8')) as { hapPath?: unknown };
    const hp = typeof meta.hapPath === 'string' && meta.hapPath.trim() ? meta.hapPath.trim() : null;
    if (!hp) return null;
    const abs = path.isAbsolute(hp) ? hp : path.join(projectRoot, hp);
    return computeHapBuildFingerprint(abs);
  } catch {
    return null;
  }
}
