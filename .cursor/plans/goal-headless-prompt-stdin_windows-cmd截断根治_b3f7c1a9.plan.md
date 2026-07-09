---
name: goal-mode headless prompt 传参改 stdin — Windows .cmd 命令行截断根治
version: 2.4.0
# 版本说明：patch 级 bugfix，不 bump（用户控版本，2.4.0 窗口内）。
# 只改传参通道（argv → stdin），不改门禁语义 / phase-rules yaml，宿主行为除"prompt 能送达"外零变化。
overview: >
  【根因（本机实测确认 2026-07-08）】goal 模式 headless 调 claude 时，agent-invoke.ts 的
  claudeArgv 把整段多行 prompt 当**命令行 argv 正文**传（['claude','-p', <prompt>, ...]）。
  Windows 上 claude 无 .exe、只有 claude.cmd → shouldUseCrossSpawn=true → 经 cross-spawn/cmd.exe。
  cmd.exe 命令行遇换行即截断（实测：7 行 prompt 经 .cmd 后子进程只收到 2 字符，进程仍 exit 0）。
  claude 收到空 prompt → 按 spec SKILL 交互式反问用户 → 从不写 spec.md → 门禁 spec_file_exists
  FAIL → retry 同样 → no_progress_guard → HALTED。宿主 bc-openCard 两次 run 即此。
  【为何只有 claude/codex/cursor 中招】三家把 prompt 塞 argv；chrys 走 --task <文件路径>、
  opencode 走 stdin，命令行只流过短 token，故免疫。POSIX 上 argv 直达 execve 不经 shell，
  也不炸——"以前能跑通"多为非 Windows 或用 chrys。
  【方案】claude/codex/cursor 的 headless prompt 从 argv 改走 **stdin**（照抄 opencodeHeadlessPlan
  的 useStdin，spawnHeadlessChild/spawnHeadlessAsync 已支持 plan.useStdin+plan.stdin，生产消费端
  零改动）。本机实测三家均从 stdin 完整读多行 prompt：claude(`claude -p`)、codex(`codex exec`)
  回 RESULT=42；cursor(`cursor-agent -p --force`) 通道通但撞账号额度未跑到底（发版前有额度环境补测）。
  【改造点】agent-invoke.ts：①claudeArgv 去掉 prompt 入参与 argv 中的 prompt（仅留 -p/--allowedTools/
  --permission-mode）；②codexArgv 去掉尾部 argv.push(prompt)；③cursorHeadlessPlan 去掉
  argv.push(prompt)、加 useStdin:true+stdin:prompt；④defaultHeadlessInvokePlan claude/codex 分支
  attachResolvedBinary 后 spread useStdin/stdin。测试：goal-runner-phase（claude argv no shell /
  claude structured argv）、headless-binary-resolve（cursor 三处）随之改断言；新增回归守卫
  "三家 stdin 传多行 prompt、prompt 不出现在任何 argv 元素、无 argv 含换行"。
  【范围外（硬理由）】①不改 claudeArgv 的 `--permission-mode dontAsk`（claude 2.1.169 合法值疑
  不含 dontAsk）——属权限行为域，非传参通道，列为关联风险另议，避免混 scope。②planFromTemplate
  的 PROMPT_ARGV_SENTINEL/argv 注入路径保留（仅对未知 external adapter，可能是 .exe/POSIX，
  且用户自定义 template；本 patch 只治 KNOWN_STRUCTURED_ADAPTERS 中的 claude/codex/cursor）。
  ③goal-runner.ts / spawnHeadlessChild 不动（已消费 plan.useStdin）。④phase-rules yaml 不动
  （gate_fingerprint 豁免，宿主回执不 stale）。
  【验收】新回归单测通过 + typecheck + 全量 unit + 35 fixtures 全绿；宿主可用 br 分支重跑
  goal spec 端到端复验（claude 收到完整 prompt、写出 spec.md、门禁过 spec_file_exists）。
todos:
  - id: t1-agent-invoke-stdin
    content: >
      agent-invoke.ts 四处改造：claudeArgv/codexArgv 去 prompt、cursorHeadlessPlan 加
      useStdin+stdin、defaultHeadlessInvokePlan claude/codex 分支 spread useStdin/stdin。
      label 收敛为 `claude -p …` / `codex exec …`（deprecated defaultHeadlessInvoke 返回 label
      仍含品牌名，goal-runner-policy codex 断言不破）。
    status: completed
  - id: t2-tests-adjust
    content: >
      同步断言：goal-runner-phase「claude argv no shell」(argv.includes('hello')→stdin==='hello'、
      !useStdin→useStdin) 与「claude structured argv」(argv[pIdx+1]===multiline→stdin===multiline)；
      headless-binary-resolve「cursor positional」三 case（useStdin undefined→true、argv 末位
      prompt→argv 纯 flag+stdin）。chrys-opencode / goal-runner-policy 不受影响。
    status: completed
  - id: t3-regression-guard
    content: >
      新增回归守卫（goal-runner-phase）：defaultHeadlessInvokePlan 对 claude/codex/cursor +
      含换行多行 prompt → useStdin===true、stdin===完整 prompt、prompt 不在任何 argv 元素、
      无 argv 元素含 '\n'。锁死"prompt 不得再进命令行"。
    status: completed
  - id: t4-gates-green
    content: >
      cd harness && npm install（源仓首次）→ npx tsc --noEmit → npm run test（unit+fixtures）全绿。
    status: completed
---

# 实施记录

- **2026-07-08 实施完成**（br 分支 Br_release_2.0，工作树，未 commit）。
- 改动：`harness/scripts/utils/agent-invoke.ts`（claudeArgv/codexArgv 去 argv prompt、
  cursorHeadlessPlan 加 useStdin+stdin、defaultHeadlessInvokePlan claude/codex 分支 spread stdin）；
  测试 `goal-runner-phase.unit.test.ts`（2 处断言改 stdin + 新增回归守卫）、
  `headless-binary-resolve.unit.test.ts`（cursor 3 处断言改 stdin）。
- 验收（`cd harness`，源仓首次 `npm install` 后；profiles 单测需
  `NODE_PATH=<harness>/node_modules`）：`npm run typecheck` exit 0 ·
  `npm run test:unit` 1465 passed/0 failed（baseline 1464 +1 新守卫）·
  `npm run test:fixtures` 35 passed/0 failed。
- 待办：①cursor 端到端未验（本机账号额度用尽，仅确认 stdin 通道读取）——发版前有额度环境补测。
  ②~~关联隐患 `claudeArgv` 的 `--permission-mode dontAsk`~~ 已排查（2026-07-08）：
  `dontAsk` 是 claude 2.1.169 `--permission-mode` 合法值（choices: acceptEdits/auto/
  bypassPermissions/default/dontAsk/plan），**非隐患，无需改动**。
  ③宿主 bc-openCard 用 br 分支重跑 goal spec 端到端复验。
- **Review 复核（2026-07-08，cursor + codex 双独立复核）**：均无阻断；根因/实现/单测通过，
  唯一 blocker = 宿主端到端复验（单测锁"prompt 不进 argv"，锁不了"claude 收到 stdin 后真写 spec.md"）。
  本批顺带落实 review 可落地项：①adapter.yaml 文档对齐——claude/codex 的死字段 headless_invoke
  补 "Declarative only / prompt via STDIN" 注释（cursor 既有同类注释）；命令模板不改（保
  "despite adapter template" 单测对照语义）。②agent-invoke.ts PROMPT_ARGV_SENTINEL 补 Windows .cmd
  风险预警（自定义 external adapter 含 {{PROMPT}} 走 .cmd 仍可能中招）。知晓未改（scope 外）：
  chrysArgv 无 PROMPT_FILE 时 positional fallback 同类风险（goal-runner 常设 PROMPT_FILE，实际低）、
  claude stdout "请提供功能名称" 交互话术哨兵（诊断增强）。复跑：typecheck 0 · unit 1465/0 · fixtures 35/0。
