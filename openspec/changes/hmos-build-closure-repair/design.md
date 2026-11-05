## Context

实施蓝本为 `.cursor/plans/HMOS构建闭环补修_产物复用真实与执行同源及恢复收口_58d7a3c2.plan.md`。事故对象为发布件消费者，宿主 framework/ 不是 submodule。复用现有发现、build result、SHA256、spawn plan、buildChildEnv 和持续执行处置；不新建 daemon 状态、manifest 或排障循环。

## Decisions

1. 安装候选只在选定 product 下解析，target 可为 default 或自定义输出目录。对选定 signed 只按同目录 basename 找 unsigned；陈旧与依据不足分开报告。mtime 不证明签名因果，也不要求晚于本次构建启动时间。
2. 主应用只读取当前报告目录的原成功摘要，再覆盖结果。成功事实须有已验证产物、维度、路径和完整摘要；缺旧字段、IDE 覆盖或其它不匹配均执行正常构建。构建后重发现，没有旧路径兜底。UT collector 则绑定本调用 test 维度和摘要，安装前重核，不引入跨 Feature 缓存。
3. --version 使用真实 spawn plan 与有效环境。保留现行 Node/wrapper 和 Java 选择规则；分别披露 JAVA_HOME 与子进程 PATH 首个 Java，剥离信任锚。主应用通过内部 daemon=false 接线保留 parallel/incremental，既有 forceNoDaemon 事务恢复语义继续保留。
4. 可调查失败不自动标 externalBlocked/device_toolchain；现有 readCurrentDispositionInput / resolveCurrentDisposition 决定修、等或补验。真实外部权限与设备门不变，合法写域由已有授权决定。

## Risks and Validation

mtime 是陈旧检查而非源码完整性证明；同调用可复用与当前包摘要核对不会扩成构建输入图。新增确定性生产链隔离测试覆盖正式/即席/UT、product/target、旧摘要/变体/覆盖、UP-TO-DATE、Windows 空格 wrapper/Node、Java 与 daemon 策略和共同处置。真实服务签名与设备联合验收不在本变更授权内。
