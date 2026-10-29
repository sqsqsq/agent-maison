/**
 * spec 阶段 story 专属注入的场景探针。
 *
 * 只在走过 /story 的 feature 上注入 story_on_context_load.md；其余场景静默让路，
 * 使本扩展对「口述一个需求直接跑 spec」的用法完全隐形。
 *
 * 判据是 `AR/story-flow.json` 是否存在——它由 story_flow.py 在 S2 创建，
 * 早于 spec 阶段，且探测的是**用户走没走过 /story**而不是模型产出了什么：
 * 走过就算模型偷懒没产出 story.md，门禁照常拦；没走过就直接放行。
 *
 * 契约：stdin JSON ctx → stdout JSON { promptFragments: string[] }。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BODY = path.join(HERE, 'story_on_context_load.md');
const FLOW_FILE = ['AR', 'story-flow.json'];

function featuresDir(projectRoot) {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'framework.config.json'), 'utf-8'));
    if (typeof cfg?.paths?.features_dir === 'string' && cfg.paths.features_dir.trim()) {
      return cfg.paths.features_dir.trim();
    }
  } catch {
    /* 回落默认 */
  }
  return 'doc/features';
}

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf-8');
  } catch {
    return '';
  }
}

// 契约（hook-runner）：stdin JSON ctx → stdout JSON { promptFragments }。
// 由本函数返回值交给 hook-runner 序列化，**不得**自行 write stdout——
// 自写 + runner 再写会拼出 `{}{}` 非法 JSON。
export default function storyOnContextLoad(ctxInput) {
  let ctx;
  try {
    // 兼容 hook-runner 传对象与直接 node 传 stdin 两种调用
    ctx = ctxInput && typeof ctxInput === 'object'
      ? ctxInput
      : JSON.parse(readStdin().trim() || '{}');
  } catch {
    ctx = {};
  }

  // 判不了场景就让路——探针失败不该拖垮别人的 spec。
  if (ctx?.phase !== 'spec' || !ctx?.feature || !ctx?.projectRoot) {
    return {};
  }
  const featureRoot = path.join(ctx.projectRoot, featuresDir(ctx.projectRoot), ctx.feature);
  if (!fs.existsSync(path.join(featureRoot, ...FLOW_FILE))) {
    return {};                                  // 非 story 场景，静默让路
  }
  return { promptFragments: [fs.readFileSync(BODY, 'utf-8')] };
}
