# 蓝图设计输入与物化

P3 使用 `derive.blueprint-acceptance` 和 `derive.blueprint-contracts`，返回与 `acceptance@1`、`contracts@1` 相同的 typed 内容。正式需求仍须通过蓝图/CU 准入；独立设计任务不会自动扩展为 coding。

## 来源与责任

仅读取当前 canonical CU 的 `design_refs` 选中目标。目标可携带明确的 `acceptance`、`contracts`、`use_cases` 机器内容；这些内容沿现有类型和 checker 校验，承载目标的 provenance 必须为 authoritative。缺字段、含混文字、纯 decisions/verification_refs 都不能成为默认值或占位产物。

- 蓝图负责共同决策、部件边界、外部契约；新事实改变这些内容时回 component-design 或外部 owner。
- spec 负责补清行为、预期、边界和验收分层。验收 ID 必须为稳定 AC/BD ID，并在 canonical CU predicate 的 `verification_refs` 明确引用，例如 `acceptance:AC-1`。引用只建立映射；步骤、预期、关注点仍必须是真实内容。
- plan 负责当前切片精确文件、类型、接口、runtime 生命周期和用例。不得从 touches 扩张写集、猜测事务边界或 DTO 映射。

## 施工映射

`contracts.files` 仍为唯一施工写集。蓝图的 `contracts.change_unit` 提供已有的 predicate/provide/design ID-only 映射及明确 implementation/test refs；准备入口只补入从 canonical CU 解析出的 `change_unit_ref`。`design_ref_mappings[].design_ref` 在蓝图源内容中可使用 CU 已引用的 `{kind, id, view_id?}` 目标地址，投影时补全当前身份。

这避免在蓝图字节中嵌入指向自身的哈希。flow 目标中的 `contracts.state_management` 缺少 `design_ref` 时绑定该已选中 flow，其生命周期字段仍须完整，不能仅靠有 ref 通过检查。

需要用例时，`use_cases` 使用既有 UseCasesSpec；linked_flow/linked_branch 和 use-case schema 共用现有校验。合法空 boundaries/performance 不要求凑条目。接口、数据模型、runtime 与 file-like 引用不因省略叙述文档而免检。

## 唯一物化入口

在宿主的 framework/harness 目录执行：

```powershell
npx ts-node scripts/prepare-blueprint-design.ts --feature <canonical-CU-feature-id>
```

也可显式指定 `--project-root` 和 `--framework-root`。入口先解析并校验完整 bundle、来源和所有目标文件，再沿已有 artifact resolver 物化 acceptance/contracts 及必要 use-cases。已有内容冲突时停止，不能覆盖人工决策；已有等价结果不重复写入。不会生成 spec.md、plan.md、summary、receipt 或批准记录。

派生文件使用已有 `source` 字段标识 provider 与 canonical CU/蓝图字节身份；P1 重新读取时对照当前投影。revision/hash、外部权威或内容变化会使旧投影失效，不用旧 PASS 顶替。

## 阶段消费

spec/plan 的 contract 为 1.1。显式 P1 调用上下文和 P2 scope 使用 typed 内容，`required_outputs` 决定是否检查叙述格式。必须产出的机器契约、facts 和实际视觉义务继续检查。默认 workflow 仍为 1.1，旧 workflow 的无上下文调用保留原非 typed 执行路径，公开切换归 P7。

执行本次 spec/plan 时，本阶段的正式产物属于获准输出，由当前 P1 解析重新绑定；外部蓝图、设计来源和下游只读契约不因此失去约束。完整交付中验证出的新设计内容通过既有 `scope_revision_input` 提议交由 P2 重签，不能删除已冻结的 required 义务；设计专项不提交施工后继。

源码、完整真实内容夹具和机械测试不能替代真实业务宿主验收；P7 汇总宿主结果。
