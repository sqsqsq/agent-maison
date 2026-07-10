// ============================================================================
// guard-framework-write.mjs — cursor preToolUse 壳（plan e8f5a2c7 G1b）
// ============================================================================
// **不物化**：本脚本随发布件留在 framework/agents/cursor/hooks/，由宿主
// .cursor/hooks.json（hooks_config 结构化 upsert 写入）以
// `node framework/agents/cursor/hooks/guard-framework-write.mjs` 直接调用。
//
// Cursor hooks 协议（官方文档 2026-07 核实）：stdin JSON payload；exit 0 → 读取
// stdout JSON（{permission:"allow"|"deny", user_message, agent_message}）；exit 2 →
// 直接阻断但**不消费 JSON**（教育文案会丢，仅留给"无法产出合法 JSON 却必须阻断"的
// 异常分支）；其余退出码 fail-open。
//
// payload 字段诚实边界：官方未明文 Write 的 tool_input 路径字段名——本壳按候选字段
// 宽容解析（file_path/path/target_file/filePath/uri），**以宿主实测为准**（plan 钉死
// 落地第一步在真实宿主实测 payload；matcher/字段不符时据实测调整，均为受管可变字段）。
// 解析不到路径 / 任何异常 → fail-open（G2 查时扫描恒为兜底）。

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { evaluateFrameworkWrite } from '../../shared/guard-framework-write-core.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 本文件位于 <projectRoot>/framework/agents/cursor/hooks/ → 上溯 4 级即 projectRoot。
// 仓库身份**只信脚本自身物理位置**（第七轮 codex P1-3：payload.cwd 可能是子目录/任意工作
// 目录，拿它当项目根会让 <cwd>/framework 查无 manifest 而 fail-open——cwd 只配当相对路径
// 的解析上下文，不配当仓库身份）；CURSOR_PROJECT_DIR 环境变量存在且指向本脚本所属仓库时
// 作确认信号，不一致时仍以物理位置为准。
const PROJECT_ROOT_FROM_LAYOUT = path.resolve(__dirname, '..', '..', '..', '..');

function emit(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf-8');
  } catch {
    return '';
  }
}

/** cursor 编辑类工具目标路径候选字段（宽容解析，以宿主实测为准）；file:// 经 fileURLToPath 正规转换。 */
function extractTargetPath(toolInput) {
  if (!toolInput || typeof toolInput !== 'object') return null;
  const cand = [toolInput.file_path, toolInput.path, toolInput.target_file, toolInput.filePath, toolInput.uri];
  for (const c of cand) {
    if (typeof c !== 'string' || !c.trim()) continue;
    const s = c.trim();
    if (s.startsWith('file://')) {
      try {
        return fileURLToPath(s); // Windows 盘符路径下裸删前缀不可靠（/D:/x）——用标准转换
      } catch {
        continue;
      }
    }
    return s;
  }
  return null;
}

function main() {
  let payload;
  try {
    payload = JSON.parse(readStdin());
  } catch {
    emit({ permission: 'allow' });
    return;
  }
  const projectRoot = PROJECT_ROOT_FROM_LAYOUT;
  const target = extractTargetPath(payload?.tool_input);
  if (!target) {
    emit({ permission: 'allow' });
    return;
  }
  // 相对路径以 payload.cwd 为解析上下文（agent 可能在子目录跑工具）；绝对路径原样。
  const cwd = typeof payload?.cwd === 'string' && payload.cwd.trim() ? payload.cwd.trim() : projectRoot;
  const fileAbs = path.isAbsolute(target) ? target : path.resolve(cwd, target);
  const verdict = evaluateFrameworkWrite({ projectRoot, filePath: fileAbs });
  if (verdict.decision === 'deny') {
    emit({
      permission: 'deny',
      user_message: `framework 写保护：已阻止写入 ${target}`,
      agent_message: verdict.reason,
    });
    return;
  }
  emit({ permission: 'allow' });
}

try {
  main();
  process.exit(0);
} catch {
  // 无法完成判定/输出——fail-open（G2 兜底）；此处若已确定 deny 却无法产 JSON 才轮到 exit 2，
  // 但 main 内 deny 路径自身不抛（emit 是最后一步），实际到不了那个分支。
  try {
    emit({ permission: 'allow' });
    process.exit(0);
  } catch {
    process.exit(0);
  }
}
