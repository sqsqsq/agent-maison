# 4e92a7c6 DSH 独立只读视觉验收（2026-11-06）

开工按 `83038a6b`（8f2c6b91）重核复用点，实施基线为 `06a531a7`。`ProviderRef / adapterModelBinding`、模型来源 patch、最终 dump-config 与原生请求身份观察继续共用；当前 HEAD 已有 builtin official/account 路由，不新增该解析链。共享改动限于按已有 `readonlyInvocation` 选择权限，以及最终 DSH 正文/逐图证据消费。开发 `headless-patch.yaml` 保持原样。

| 验证 | 事实 |
|---|---|
| 桌面载体 | 生产 resolver 找到桌面 `resources/runtime/cli/bin/dsh.cmd`，实际 headless `0.2.2-rc.1`，没有安装替代 CLI。 |
| 无模型装配 | 真实保存配置 + 较早 `deepseek-v4-pro` overlay + 最后视觉 patch，实际 selection 为 `deepseek-official/deepseek-flash`；即使父权限相反，会话仍 `read-only/never`。最终工具恰为 glob/grep/read/read_image，write/edit/apply_patch/bash/pwsh/PTC/subagent/workflow 不可达；关闭卸图、自动摘要及入口/技能加载。 |
| 第一轮绑定诊断 | 探针 pin 未写推理强度，原生实际为 high，共享观察器正确拦截；没有跳过绑定或放松比较。读取该次请求的非秘密配置后，用完整 high 绑定进行下一次正式调用。 |
| H1 真实看图 | 正式 invokeVisualProvider + 原 invokeAgentHeadless，默认已配置图像路由 `deepseek-official / deepseek-flash / high`。较早 overlay 指向另一模型，最终原生请求头仍准确匹配。两个 read_image 均 completed；随机四象限颜色正确，截图文字“添卡成功”“完成”正确。原生会话 read-only/never，项目文件清单和内容哈希不变。 |
| 正文消费修正 | 新版参数名为 `input.file_path`。生产者真实退出 0 并交回完整 final，首次消费者因旧字段名判 invalid。修正后用同一实际 stdout 经正式消费函数回放，得到 success；逐图成功条件成立，通用回执披露保持 unverified；身份、两张图哈希、既有观察载荷、随机像素颜色全部通过。没有重买看图调用，原 invalid 记录保留。 |
| H3 开发隔离 | 后续独立工程通过 Windows guardian 写入指定 result.txt，exit 0、真实 completed，sentinel 未改；原生记录 danger-full-access/never，工具仅实际调用 write。开发与视觉没有串权限。 |
| H4 边界 | 认证仅由 DSH 解析，未读取、复制或哈希凭据文件，也未改用户 profile/home patch。遵守用户本轮禁止读取凭据的限制，凭据前后哈希未验证。DSH 正常会话/附件/日志落盘如实保留。 |
| 图片上限 | 非秘密可见元数据未声明图片数量/字节/上下文明确上限，记未知；不测限、不自动卸图或替换为文字。 |

已通过目标：visual-provider 88/88，deepseek-harness-adapter 9/9（含真实进程预检、权限大小写清洗、错误配置模型请求数为零）；typecheck 通过。离线矩阵覆盖复合 model ID、声明兼容、坏/空/长/缺 final、非零仍 final、无 turn_end、逐图成功/缺图/错误后恢复/无关错误、Windows 路径、空图格式修复、完整 stdout 原件及工作区变脏。其它模型身份和权限保护复用既有目标及最终正式全量。

证据：[装配](remaining-3.1.0-dsh-assembly.json)、[原真实调用](remaining-3.1.0-dsh-desktop.json)、[原始 stdout](remaining-3.1.0-dsh-visual-events.jsonl)、[同原件消费回放](remaining-3.1.0-dsh-reprojection.json)、[开发 guardian](remaining-3.1.0-dsh-development.json)。本批最终 test:changed、Claude Code CLI 只读复核和 P4 正式全量由总交接报告登记。未操作真实宿主、手机、持久默认配置；未打包、推送或改版本。

首轮 test:changed 的输入快照稳定，874 实跑组、5082 passed / 1 failed、复用51组；唯一红项是普通 DSH 独立质询被误套视觉原生只读，属于本轮直接回归，已修复。视觉 plan 是原生只读意图的唯一来源，环境/预检/spawn 同源；普通质询保持原生工具及快照兜底。未修改原反例断言，其定向复验 1/1 通过。最终目标 visual-provider 88/88、DSH adapter 9/9 再验通过；旧原生续接、权限隔离和模型身份保护继续由按影响选测及 P4 全量收口。

最终按影响选测 R2：857 组实跑、4905 passed / 0 failed，复用 68 组；输入前后快照完全一致，typecheck 通过；424 个正式组留 P4 一次全量。见[dsh-tests](remaining-3.1.0-dsh-tests.json)。

下游 critic 回执以已登记解析器复核 verified；本批明确不扩注册表，故移除手动 verified 覆盖，沿既有 resolveInputProvenance 保持 unverified。逐图成功读取仍是 DSH 正文采信条件。这一区分避免本地验读主张被通用 gate 作为不可复核主张降级告警。

披露链收编后的最终 test:changed：802 组实跑、4173 passed / 0 failed，复用 123 组（1204 项），当前日常有效覆盖 5377 项；输入前后完全一致。无新增注册表项或通用验读门槛。

Claude Code CLI 已实际复核通过，无必须修复项；模型 claude-opus-5-5，使用 opus/high、plan 权限、仅 Read/Grep/Glob、禁 hooks 和 MCP，原件见[dsh-review-after-reset](remaining-3.1.0-dsh-review-after-reset.json)。此前 Opus/Sonnet 请求均被五小时额度拒绝、没有模型结论；约13:41恢复后实际完成本次检视。H4凭据哈希仍未验，t4不能冒称完成；漏填推理强度时原生默认high会被当前绑定检查拒绝，留8f2c默认设置接线后续处理，本批已使用完整high绑定，不改变比较契约。
