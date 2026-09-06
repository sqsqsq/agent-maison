---
name: 六阶段重构 B02 提纲 — 视觉能力与材料证据
overview: B01宿主反馈后细化，解除inline回执死锁与非goal/attended不可达，保留既有completion probe，不扩大视觉系统。
version: 3.0.0
todos:
  - id: b02-detail-after-b01
    content: B01的C-U宿主验收后，按实际反馈细化本批到文件/调用顺序、代价、提交边界和可执行验收，再实施。
    status: pending
  - id: b02-capability-lifecycle
    content: 删除每invocation inline考试及相应终签前置，复用现有canary/effective vision；探测异常不判无视觉，保留通用completion probe。
    status: pending
  - id: b02-material-quality
    content: 使参考图/审查结论绑定实际材料，清理依赖当前invoke或goal私有身份的消费点，保留真实覆盖/质量检查。
    status: pending
  - id: b02-nongoal-attended
    content: 对照C/X非goal真实路径及attended无stdout fixture，落实可达证据路径，不伪造CLI事件或goal身份。
    status: pending
  - id: b02-contract-local
    content: 同步本批必要文档/OpenSpec与目标测试，核对独立visual provider正文消费者不受影响，完成候选件本地验收。
    status: pending
  - id: b02-host-acceptance
    content: 用户触发候选件集成和bc-openCard-1的C-U spec受影响goal回归，确认纯收口不重考、不拒签，窗口闭环后才进B03。
    status: pending
---

# B02滚动提纲

总plan：[9c6e2a41](pipeline_master_9c6e2a41.plan.md)。依赖 [B01](pipeline_b01_verifier_repair_3a7f9c12.plan.md) 宿主通过。本文件不是当前施工图，首todo完成细化后才实施。

## 已确认范围

F03/F04/F05：spec内部harness索取调用结束后才签发的回执；非goal要求goal身份；attended callback无stdout却有inline消费。Codex的terminal JSONL不是逐图Read审计，none审计不等于无视觉。

定位：[runtime](../../harness/scripts/goal-phase-runtime.ts)、[vision-canary](../../harness/scripts/utils/vision-canary.ts)、[effective-vision-context](../../harness/scripts/utils/effective-vision-context.ts)、[critic-receipt-producer](../../harness/scripts/utils/critic-receipt-producer.ts)、[spec gate](../../profiles/hmos-app/harness/spec-ui-spec-check.ts)。

## 保留裁决

能力、参考图读取事实、实际质量分别用现有机制判断；金丝雀只证明能力，不证明需求写对。解除当前invocation/goal身份的结构性前置，不把未知能力或未验证质量写成PASS。图/产物确实变化时继续相关核对，不恢复人签或新增视觉manifest。

completion probe/grace/kill保持不变。inline删除后，阶段尾部正文不再是该质量前置；CLI硬错误诊断、usage、Codex失败终态仍保留。独立 [visual-provider-invoke](../../harness/scripts/utils/visual-provider-invoke.ts) 仍消费自身最终正文，不属于phase completion probe，禁止混删其解析/超时逻辑。

## 细化必须给出的内容

明确所有inline生产/签发/消费点如何删除或归并、现有字段兼容如何处理、非goal和attended各从哪里取得实际材料证据、C/X哪些是真实可用通道。不能只删一处等值比较留下兄弟门禁继续拒收；也不增加adapter能力或凭模型名称改声明。

测试覆盖四主格公共契约，K/A保留fixture；用户触发本批C-U真实spec窗口，必须观察B01留下的回修路径不回归、spec正常产出和纯收口均可完成。图变/模型通道变/真盲/调用失败有不同结果。补充格未真测如实注明。

## 非目标与收口

不改进程生命周期、不重构provider、不引入新审查服务；过时指令纯删除已归B01。细化时列出具体测试命令、接受的证据强度和迁移代价，按总plan目标测试/全量/candidate策略验收。宿主替换与运行由用户触发；host未完成不可提前验收本批。
