// codex-agent-toml.ts — 把 claude 的 verifier.md 渲染成 codex 角色文件（plan 7b2e9d4c D1）
//
// 唯一输入 agents/claude/templates/agents/verifier.md，唯一输出
// agents/codex/templates/agents/verifier.toml。**不是**通用的 md → adapter 格式框架：
// 一个函数、一个输入、一个输出；越出这个范围一律抛错，不猜、不静默降级。

/** verifier.md frontmatter 允许出现的工具集合；越出即需人工重审 sandbox_mode 映射 */
const READ_ONLY_TOOLS = new Set(['Read', 'Glob', 'Grep']);

/**
 * 渲染 codex 角色 toml。
 * - frontmatter：`name` 必须为 verifier；`description` 必须单行；`tools` ⊆ {Read, Glob, Grep}
 * - 正文：frontmatter 之后的全部内容**逐字保留**——只做两件事（plan 7b2e9d4c D1）：
 *   EOL 归一 LF、尾部恰好一个换行；不去首空行、不去尾随空格
 * - 字符串一律 TOML literal 多行 `'''`（无转义规则）；正文或 description 含 `'''` 时抛错
 */
export function renderCodexAgentToml(markdown: string): string {
  const text = markdown.replace(/\r\n/g, '\n');
  const fmMatch = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!fmMatch) throw new Error('verifier.md 缺少 frontmatter（--- 包裹）');
  const body = text.slice(fmMatch[0].length).replace(/\n*$/, '\n');

  const fields = new Map<string, string>();
  for (const line of fmMatch[1]!.split('\n')) {
    if (!line.trim()) continue;
    const kv = /^([A-Za-z_][\w-]*):[ \t]*(.*)$/.exec(line);
    if (!kv) throw new Error(`frontmatter 非 "key: value" 行（description 必须单行）：${line}`);
    fields.set(kv[1]!, kv[2]!.trim());
  }

  const name = fields.get('name');
  if (name !== 'verifier') {
    throw new Error(`本渲染器只承诺 verifier 角色，frontmatter name=${name ?? '<缺失>'}`);
  }
  const description = fields.get('description');
  if (!description) throw new Error('frontmatter 缺少 description');

  const tools = (fields.get('tools') ?? '').split(',').map(s => s.trim()).filter(Boolean);
  const extra = tools.filter(t => !READ_ONLY_TOOLS.has(t));
  if (!tools.length || extra.length) {
    throw new Error(
      `verifier 只读集合已变（tools: ${tools.join(', ') || '<空>'}），sandbox_mode 映射需人工重审`,
    );
  }

  for (const [label, value] of [['description', description], ['正文', body]] as const) {
    if (value.includes("'''")) {
      throw new Error(`${label}含 ''' —— TOML literal 多行字符串承载不了，需人工重审转义方案`);
    }
  }

  return [
    '# 生成文件：由 agents/claude/templates/agents/verifier.md 渲染（cd harness && npm run sync:codex-agents），勿手改。',
    '# 等值由 harness/tests/unit/codex-adapter-verifier-template.unit.test.ts 守护（plan 7b2e9d4c）。',
    'name = "verifier"',
    `description = '''${description}'''`,
    `# verifier.md 的 tools: ${tools.join(', ')} → 角色默认沙箱 read-only。`,
    '# 仅为默认值：Codex spawn_agent 会用父线程实时权限覆盖（goal 父进程为 danger-full-access），',
    '# 不写盘的约束由下方 developer_instructions 的硬性规则承担（plan 7b2e9d4c D3）。',
    'sandbox_mode = "read-only"',
    "developer_instructions = '''",
    `${body}'''`,
    '',
  ].join('\n');
}
