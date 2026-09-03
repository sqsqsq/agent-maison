## 1. P0 解除误判与遮蔽（已提交 b2791de5，宿主 R3b 验证通过）

- [x] 1.1 MockKit 解析器支持真实 hypium `mockFunc`/`when(mockedFn)`；治理分层 violations=FAIL / unresolved=WARN；夹具含宿主存量实录与 hypium 文档形态。
- [x] 1.2 基线只认 agent 动手前锚（HARNESS_DIFF_BASE_REF → goal coding_base_sha；不消费 trace.start_commit/裸 HEAD），无锚 fail-closed；真实 git 仓集成回归四条路径。
- [x] 1.3 `[CHAR-*]` 合法化解除 path-c 自死锁；SKILL 主文档同步例外。
- [x] 1.4 模拟 tsc 恒 WARN（真实编译在场时）；ut.compile=SKIP 护栏保持 FAIL；fixture 期望同步。
- [x] 1.5 hvigor 每模块独立日志；task-not-found 运行期分类 + build-profile targets 三态探测；feature 模块优先且 task-not-found 不短路。
- [x] 1.6 设备降级恒 needsConfirmation；runtime 降级路径消费 installDiagnosis.kind 映射 needsConfirmation；底层诊断中立化、UT 专属处置上移聚合层；非降级预检不确定指向元数据修复。

## 2. P1 统一 target 与棘轮（经 codex 第四轮三 P0 修正）

- [x] 2.1 `ut-target-resolver.ts`：显式目标（MAISON_UT_TARGETS，全量文件匹配）> scoped 基线判定；legacy 文件内新增 it 用例级升格；targetCaseView 合成视图供全部需求房规统一消费。
- [x] 2.2 mockkit 增量治理按 multiset 计数差（同 key 重复使用不被折叠）；基线已有 mock 面豁免。
- [x] 2.3 `ut-suite-baseline.ts`：授权基线（本轮执行不得反推）；无基线不豁免；target 失败永不豁免；基线只收紧；用例失败不短路全模块执行；豁免先于 exitCode；PASS 须全模块真实执行。
- [x] 2.4 状态面板 feature_verdict / suite_health 两结论分离。

## 3. P2 薄入口

- [x] 3.1 MAISON_UT_MODE 机器化（repair_existing_ut / cover_existing_code）；[REG-*] 仅该两模式放行。
- [x] 3.2 SKILL.md 三工作模式路由 + paths/path-repair-existing.md（六分类分诊/四类差异报告/授权基线口径）。

## 4. codex 五轮 review 修正

- [x] 4.1 repair/cover_existing 成为真实独立模式：需求工件门禁（use-cases/audit/mock-plan/DAG/acceptance 覆盖族/facts/upstream）按模式 SKIP；显式目标保持存量身份（不进房规问责视图），但强制进入编译/执行与棘轮"永不豁免"名单。
- [x] 4.2 repair/cover_existing fail-closed：无基线锚 / 无显式目标 / 目标未命中 → `ut_target_resolution` FAIL。
- [x] 4.3 suite 失败身份含 module（`module::suite::test`），跨模块同名不互相豁免；基线读入校验 feature 绑定与条目形状。
- [x] 4.4 基线信任口径修正：用户授权工件（与 approved_src_mutations 同级信任模型，不做密码学防伪——顶层裁定），删除"编排采样已存在"的虚承诺表述。
- [x] 4.5 plan frontmatter todos 物化（发版解析器只读 frontmatter——正文 checkbox 不进 release 门），R3c 以 pending 挡 3.0.0 发版。

## 5. codex 六轮 review 修正

- [x] 5.1 显式目标部分命中 fail-closed（matched 必须等于 requested）。
- [x] 5.2 target 身份补齐模块（module::test），与失败身份同口径；check-ut 传 targetCases{path,test}。
- [x] 5.3 基线收紧仅在全模块真实执行时进行（部分执行不得删条目）。
- [x] 5.4 非需求模式不生成/覆写 ac-coverage.json。
- [x] 5.5 状态面板披露 work_mode / 责任域计数 / 需求门禁 SKIP，静态结构 PASS 行标注模式限定。

## 6. codex 七轮 review 修正

- [x] 6.1 基线收紧要求"基线涉及的每个模块本轮都跑出 total>0 结果"（modulesWithValidResults），防未执行/零用例模块的历史记录被误删。
- [x] 6.2 feature_verdict=INCOMPLETE 与 partial_readiness 仅在设备阻塞为唯一 BLOCKER 时成立。
- [x] 6.3 cover_existing_code 需实际测试产出：**只认新建测试文件或存量文件内新增 it**；显式目标与文本变化（注释/空格/import）均不充当产出证据（八轮：删除 changedLegacyPaths 放行路径，不扩展文本 diff 模型）。

## 7. 验证

- [x] 7.1 unit 3111 + fixtures 44 + openspec 53 全绿；宿主 R3b 一轮回灌通过（存量三条不再 FAIL、编译 PASS、设备项归因正确）。
- [x] 7.2 宿主真机收尾（R3c：解锁+授权卸载+真实执行）与 repair/cover_existing 模式实战回灌。
  - 用户 2026-09-03 裁决：3.0.0 窗口不再执行宿主回归，按完成登记（该项是 goal 总纲 a3d7c9e2 归档拓扑的唯一前置）。
