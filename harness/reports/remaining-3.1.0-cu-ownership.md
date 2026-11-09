# 7080620a 后续返修：CU 显式认领与 P3 同源

基线：main `7080620a1254c84da6f76dadcfd33ebf14f9e146`。本批选择用户允许的第一种修法：在设计准备阶段要求整批活动 CU 明确认领 P3 必需的设计义务。保持 `design_refs` 为作者真源，不恢复机器补写依赖。

## 根因与改动

7080620a 分开了依赖闭包和交付选择，但没有同步设计准备与 P3 的义务集合。P3 仍要求每条 relation、contract、需交付的 decision 等有显式 owner；旧补全去掉后，合法解析的 CU 也可能在终点报 `component_closure_design_unconsumed`。前轮 R01 将删掉最后关系 owner 当成通过，漏掉了这个真实缺陷；前轮“21 条都是旧测试语义”的归类不能覆盖此反例。本批恢复该必要约束，历史 FAIL/补测记录不改写。

- 从既有 P3 实现提取 `component-blueprint-obligations.ts`，设计准备和组装共用蓝图/source 义务生成，不另建归属表。
- 整批接受、内容修订和 readiness 检查 required、非 fact 的 design 义务是否至少有一个活动 CU 显式认领。候选覆盖现有 CU，精确退役使用 P3 原判据；未改候选沿实际 canonical 哈希。关系端点不能代替关系本身。
- 缺口沿既有 `change_unit_design_closure_incomplete`、B2 和原设计修复事务交作者；修复发布前检查同一候选集合，避免先发布再在 readiness 停住。不强制每个 CU 认领整个依赖闭包。
- 作者指引明确关系、决定、契约、变更节点/flow 和当前需求承载的认领责任。Feature design mapping/coverage 仍要求每个显式 owner 有对应证明；未变依赖不增加施工义务。
- 零 CU 的需求修复仍先发布、再进入原拆分入口；认领在正式接收候选时检查，避免修复事务禁止创建 CU 却要求提前认领的循环。
- 新架构决定被显式认领后，候选检查必须读取同一事务的候选蓝图和 DSL。复用原身份校验及架构检查，正式施工仍读已发布内容，不提前写配置。原 M3/M4 正式用例保留否定送达、无进展暂停、真实条件变化后恢复的全部断言。

以上仍由同一 GoalPhaseRuntime 和已有设计修复/接续闭环推进，没有新增状态、协议、检查编号或停机原因。

## 必要反例

1. 多 CU 只列交付根：单 CU 可解析，但整批接受原子拒绝缺失关系/契约/决定；作者给一个合适 CU 认领后接受、readiness 和 P3 design coverage 通过。去掉该 owner 的 mapping 仍拒绝覆盖。
2. 关系认领可在同批显式转移；删掉最后 owner 的内容修订原子拒绝。将退役的前驱不能向后继借出认领。
3. 依赖及共享 contract 后来新增交付内容，未选 CU 仍不继承、不成为 owner；闭包外契约、变更依赖和当前需求承载同样能诊断。
4. 公开签名会话把缺失地址交给设计作者；实际补选后发布/readiness 通过，空改加质询通过仍不能发布。
5. 零 CU successor 完成需求修复后进入拆分，缺认领候选被拒，作者补齐后正式接收。
6. 新架构决定使用候选 DSL 可解析，正式施工仍拒未发布层；配置字节不变。原架构恢复用例通过。

## 验证与复核

执行 `npm run test:changed`，追加全部 component-closure、change-unit-*、initial-design-*、real-chain/real-chain-seams，以及直接受影响的 blueprint-skill-projection 和 design-authority-repair-* 正式组；未运行新的 `npm test` 或 `test:daily`。准确结果、原件 SHA-256、定向用例及实际复核调用见同名 validation JSON。

本轮默认 12 并发，**1011/1011 组实跑，其中 118 个正式组；原始结果 5213 通过、2 失败，退出 1，输入首尾稳定，109.75 分钟**。另有 50 组复用、309 个其它正式组未执行。覆盖观测未知 44 组，如实保留，不把未知当成调用覆盖。原始 FAIL 保留；补测不拼写成整轮全绿或官方全量绿。生产与发布指引在整轮之后没有变化。

保全 a21473 输入与 6fe679 故障形状的组合组 **4/0**，包含同一隔离工程到正式终点、原需求与历史不变、后继不缩小设备/UT 义务和六阶段真实方法回执。实际 Node 编译及断言属于机制验收，原生 .ets、真机和真实模型质量仍未验证。

| 原始红项 | 定性、后果与最小修法 | 定向验证 |
|---|---|---|
| real-chain-seams / RC-10 20261019 | 测试作者遗漏：原蓝图已有 full-card-number 决定，旧 CU 只在 invariant 的 evidence_refs 中引用，未显式认领。真实提示两轮送达该地址，替身却恢复旧 design_refs，故共同进展暂停。只在 20261019 作者分支断言收到地址、解析实际草稿并显式认领；独立 Q 仍核对精确选择。第一次补测继续暴露施工写手未给该决定 design mapping，发现确定失败后中止并保留日志；再由 plan 作者在认领已存在时读取真实掩码类和存储类，补对应实现与验收/计划 UT 落点。保全原件、生产覆盖检查及恢复断言不变，RC-12 分支不变。 | 最终完整同名用例 1/0 |
| initial-design-control / N1 | 测试 90 秒时限截断 dead-pid-next，随后清理 EPERM 掩盖原错误。原件已有 resume、新 harness_start 和 PASS 的 harness_end，恢复本身有效。只给该调用复用既有 TEST_RUN_TIMEOUT_MS；首次/忙碌探测、90 秒原生观察、5 分钟保留租约和“过期前实际恢复并进入替代门”、不重放、不重叠、强制清理为 0 等断言不变。 | 同名用例 1/0 |

typecheck、OpenSpec strict（65/0）、plan、diff/LF 校验通过。

Claude Code CLI 使用 `--model opus --effort high --permission-mode plan --tools Read,Grep,Glob --allowedTools Read,Grep,Glob`，禁 hooks、空 MCP，单会话只读复核。实际模型均为 `claude-opus-5-5`。r2 的唯一必修 M1（零 CU 修复循环）已修；r3 对 M1 和候选架构直接回归收口 PASS、无必修、无权限拒绝。

r4 仅复核上述两处测试修正，结论 PASS、无必修，实际模型仍为 `claude-opus-5-5`；未重开已通过的生产设计或非阻断建议。

r5 核对 RC-10 的真实施工映射以及 N1 诊断记录值修正，PASS、无必修。N1 的实际调用及断言已在 1/0 补测中通过，之后只把时间线 `cli_timeout_ms` 记录改成该调用实际使用的常量；不为纯记录修正重复测试。RC-10 首次补测的中止不作为通过证明，最终完整回执单独保留。

## 边界

没有操作宿主或手机，没有打包、推送、改版本。三份用户修改及 temp/ 不在本批修改/提交范围。P4 t5/t6 保持 pending；宿主存量 CU 的错误选择仍需原设计 owner 经正式内容修订纠正，框架不静默改写。新发布件上的真实宿主接续与质量仍由 t5 验收。本批不宣称通用非 knowledge 组装回派或原 knowledge 跨发布进展比较已完成；这些既有边界未扩面处理。
