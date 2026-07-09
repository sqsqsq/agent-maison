---
name: 交互式视觉能力实测与 framework.local.json 无感收口
version: 2.4.1
deferred_to: 2.4.1
# 版本说明：2.4.0 窗口已收口（d4a8f3c6 全 terminal + release:check-plans PASS），本 plan
# 按 deferred_to 机制排入下一版本窗口——2.4.0 发版不受本 plan pending todos 阻塞
# （check-plan-version.mjs：version > current 且 deferred_to === version → 放行）。
overview: >
  【背景（2026-07-09，宿主 SimulatedWalletForHmos cursor 工程实测发现的边界）】E1 金丝雀
  只挂在 goal-runner preflight——交互式开发路径（用户在 cursor/claude IDE 里跑 /feature
  spec 等 skill）从不触发实测，视觉能力判定完全依赖 adapter 声明（cursor 还是弃用的
  multimodal:boolean 旧字段）。实证：该宿主 framework.local.json 无 vision 键，整个
  feature 树零盲档产物——框架"认为"cursor 有视觉纯靠声明。这次没出事是因为 cursor 背后
  模型真有视觉；但交互式 IDE 里模型是下拉框随手切换的，换成纯文本模型后案A（mx 2.7 套壳
  骗过声明式探测）的洞在交互式模式下原样重现。
  【目标】交互式路径获得与 goal 模式等效的视觉能力实测；探测/判卷/写盘全程无感（用户
  零手动编辑 framework.local.json）；检测到盲模型时利用交互式独有优势（可以说话）告知
  用户并一次性确认降级——顺带吸收 E2 实施记录遗留的"交互式下 enum 确认一次（默认接受
  钳制）"未做项。
  【已验证的现状基建（2026-07-09 源码核实，不需要新造）】①无感写盘：ensurePersonalSetup
  的 mergeLocalPatch + writeLocalConfig 已在交互式 --ensure 时无感写 agent_adapter；goal
  金丝雀已在无感 merge 写 vision.canary（goal-preflight.ts:343 spread existing 模式）——
  交互式金丝雀沿用即可。②挂载点：spec SKILL 已有 BLOCKER 级前置"跑 harness 前须
  check-personal-setup --json --ensure"，天然触发时机。③判卷器：classifyCanaryResponse
  已是纯函数（answerKey 可注入参数）。
  【设计分叉（实施前须拍板，plan 内给推荐）】
  ▶ 分叉1 探测方式：goal 模式是编排器 spawn 一次 headless invoke；交互式没有编排器，
  agent 就是会话本身。推荐：自测卷模式——SKILL 指令让交互式 agent 读金丝雀图并把原始
  答案写入临时答卷文件，再跑一个确定性判卷脚本（新 CLI，如 grade-vision-canary.ts）
  判卷+无感写盘。agent 不自评（判卷权在脚本），盲模型无法答对几何/颜色题（1/4^4 且需
  文字 token 同中）。
  ▶ 分叉2 作弊面：固定答案卷（CANARY_ANSWER_KEY 常量 + assets 目录里还落了
  answer-key 文件）在交互式下作弊面显著大于 goal 模式（agent 与判卷在同一会话，翻源码/
  答案文件的概率高——不是恶意威胁模型，而是"尽职 agent 会 grep"）。推荐：交互式判卷走
  随机题卷——grade CLI 现场生成随机颜色布局+随机 token 的金丝雀图，答案只在判卷进程
  内存，出题→作答→判卷一条命令内闭环（agent 收到的只有图路径）。goal 模式固定卷维持
  不动（E1 已声明不防恶意，且 headless 作弊面小）。
  ▶ 分叉3 缓存新鲜度：交互式 IDE 模型随手切换，per-adapter 缓存会静默过期（goal 模式
  headless CLI 模型相对固定，此风险交互式独有且拿不到模型名做缓存键——cursor 不暴露）。
  推荐：交互式探测结果写入 vision.canary 时附 probed_via: interactive 标记（schema 白名单
  同步）；UI 相关 feature 的 spec 阶段首次进入时若缓存 probed_via=interactive 且超过
  TTL（如 24h）则 SKILL 提示重测（一句话+一条命令，不阻断）；用户显式
  --refresh 命令随时可用。不追求完美失效检测——目标是把"静默错一个月"压到"最多错一天
  且有提示"。
  ▶ 分叉4 盲档告知 UX：headless 不能问人（E0 已治），交互式可以。推荐：判卷结果为
  none/ocr_capable 时，SKILL 指令 agent 明确告知用户"检测到当前模型无视觉能力，本
  feature 将按 semantic_layout/reference_only 档位执行（OCR 辅助：是/否）"，enum 确认
  一次（默认=接受降级继续），确认结果按既有 headless-assumptions/user-confirmation-ux
  惯例留痕——吸收 E2 遗留未做项，不新造确认基建。
todos:
  - id: i1-interactive-canary-grade-cli
    content: >
      I1 交互式自测金丝雀 + 确定性判卷 CLI。新增 grade-vision-canary.ts（或挂进既有
      check-personal-setup 子命令，实施时看哪边更顺）：①出题——随机题卷（分叉2 推荐：
      随机颜色布局+随机 token 现场生成图，答案仅进程内存/一次性临时文件，jimp 生成复用
      ensureVisionCanaryAsset 的绘图基建但注入随机 key）；②等待/读取 agent 答卷文件；
      ③classifyCanaryResponse(answerKey 注入随机卷) 判卷；④mergeLocalPatch 无感写
      vision.canary（含 probed_via: 'interactive'，framework-local-config.ts schema 白名单
      同步 + roundtrip 测试）。SKILL 侧：spec SKILL 的 personal-setup 前置步骤后追加
      "UI 相关需求首次进入且无新鲜 canary 缓存 → 走自测卷流程"指令段。单测：判卷分级
      （全对/仅token/全错/空答）、随机卷不复用答案、写盘 merge 不破坏既有字段、schema
      校验。
    status: pending
  - id: i2-cache-freshness-interactive
    content: >
      I2 交互式缓存新鲜度（分叉3）：vision.canary 增设 probed_via 字段（goal 探测写
      'goal'，交互式写 'interactive'；缺省视作 'goal' 向后兼容）；决策函数（复用/对齐
      decideVisionCanaryProbe 语义）对 interactive 来源缓存加 TTL 判断（默认 24h，
      framework.local.json 不加新配置项——TTL 是常量，避免 schema 膨胀；超龄→SKILL 提示
      重测不阻断）。adapter 变更即失效语义两来源通用（既有）。单测：TTL 边界、来源缺省
      兼容、goal 缓存不受 TTL 影响（headless 模型稳定假设维持）。
    status: pending
  - id: i3-blind-tier-interactive-ux
    content: >
      I3 盲档告知与一次性确认（分叉4，吸收 E2 遗留"交互式 enum 确认一次"未做项）：
      判卷 none/ocr_capable 时 SKILL 指令 agent 用一段固定话术告知用户当前模型视觉判定
      结果 + 本 feature 将生效的 effective fidelity 档位 + OCR 辅助可用性，enum 确认一次
      （默认=接受降级继续；用户拒绝→指引 image_input_override 或换模型）。确认结果留痕
      走既有 user-confirmation-ux 惯例（不新造确认基建）。SKILL/reference 文档同步：
      personal-setup-gate.md、ui-spec.md 盲档工作法一节补交互式入口说明。
    status: pending
  - id: i4-gates-and-regression
    content: >
      I4 门禁与回归：typecheck + 全量 unit + fixtures 三绿；新增用例覆盖 I1-I3 全部
      分支；手工冒烟一次交互式自测卷全流程（出题→作答→判卷→写盘→重跑读缓存 skip）；
      plan 实施记录如实回填（含分叉决策的最终拍板与偏离说明）。
    status: pending
---

# 实施记录

（实施后追加：日期、验收命令与结果、分叉决策拍板记录、SKILL/schema 变更点。）

## 立项背景补充（2026-07-09）

- 触发事件：用户在宿主 SimulatedWalletForHmos（cursor adapter）真机测试阶段做 UX 确认
  循环，问"这个过程到底是模型多模态在读图还是离线 OCR 在读图"。排查中确认该工程
  framework.local.json 无 vision 键、全程零盲档产物——交互式路径的视觉判定纯靠 adapter
  声明，E1 金丝雀从未触发（只挂 goal preflight）。
- 该案本身无事故（cursor 模型真有视觉，logo 重裁被用户确认正确），但暴露的边界与案A
  同构：交互式 + 换模型 = 声明式探测被骗的原始洞在交互式模式下原样存在。
- "无感写入"不是本 plan 要新造的能力：check-personal-setup --ensure 已无感写
  agent_adapter（该宿主 local.json 即其产物，用户从未手动编辑）；goal 金丝雀已无感写
  vision.canary。本 plan 只是让交互式金丝雀沿用同一模式，并把"检测到盲模型"这一刻从
  静默变成交互式独有的一次性告知+确认。
