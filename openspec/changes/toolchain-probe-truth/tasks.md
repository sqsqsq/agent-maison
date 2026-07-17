# Tasks: toolchain-probe-truth

## 1. 共享地基

- [x] buildCompactDiagnosticHeader 抽至共享 diagnostic util（profiles/hmos-app/harness/diagnostic-header.ts 或同级；ut-hvigor-test-failure.ts 改 re-export/import，行为零变化）
- [x] 唯一指纹 helper computeHvigorInvocationFingerprint（module/target/task/product/buildMode + build-profile.json5 hash + hvigor/SDK 工程配置 hash + 依赖锁定态）

## 2. probe 三态对象

- [x] framework.local.schema.json：toolchain.probe 显式子对象（binary/cli_starts 层 + project_compile 对象 + known_quirks 人读段）
- [x] 写入权限四条：--ensure 只更 binary/cli_starts；wrapper 成功写 verified；wrapper 可信环境分类写 capability_failed；源码失败保持 unknown（last_attempt 人读）
- [x] TTL/失效：指纹变化或 expires_at 过期 → unknown；unknown 允许一次真实编译不 halt

## 3. 错误码证据分层

- [x] hvigor-runner build 链错误码分类：00303217→sdk_home_missing_or_invalid；00303168→sdk_component_missing；证据齐备才升 incompatible_suspected（三选一指引）
- [x] 诊断头部化（logExcerpt 头注入 [env-diagnosis]+[next]）：compile 失败 details 首行 ≤180 字结构化诊断（经共享 util），日志移后

## 3.5 v3 修订（post-impl 双审两轮）

- [x] ~~恢复授予粘滞化~~（v4 废弃，见 3.6——粘滞=环境未修也持续放行的无限窗口）
- [x] source_failure 清除旧 capability_failed（已达源码阶段=装配链全通，置 unknown）——测试断言同步反转
- [x] config digest 扩容：module 级 build-profile/oh-package + DevEco 装配路径 + SDK 描述指纹
- [x] runHvigorAssembleApp（coding/device-test-build 主链）补包 applyBuildProbe；classify 接入生产证据采集 collectHvigorEnvEvidence
- [x] --ensure 已就绪路径同样刷新 binary/cli_starts；integrity 摘要（防手滑/威慑级，伪造只能回 unknown）

## 3.6 v4 修订（post-impl 第三轮 codex）

- [x] 授予模型整体废弃（阻断1）：preflight 纯读恒拦截 capability_failed；解除仅三条可审计路径——config/DevEco/SDK 摘要漂移自动失效 / `--ensure` 人工 reprobe（cli 真跑 --version 可启动才降级重置 unknown，仅 CLI 层可触达，preflight 消费的 ensurePersonalSetup 无权）/ wrapper 真实编译改写；recovery_probe_pending 废弃（schema 保留兼容旧文件；INTEGRITY_SALT 换代 v2，旧记录失配按 unknown 安全迁移）
- [x] 环境级语义（高优3）：capability_failed 仅 ENV_LEVEL_CAPABILITY_FAILURE_CODES 白名单码可写入（非白名单只进 last_attempt）；指纹失效仅对 verified，capability_failed 跨 invocation 成立——preflight 无 invocation 维度成为设计而非缺陷
- [x] 测试重写：恒拦截（环境没修 resume 恒 halt，兑现"resume 后仍缺口→再次 halt"验收）/ 人工 reprobe 降级重置+审计痕+cliOk=false 不重置+verified 态 no-op / 白名单负例 / 跨 invocation 成立

## 4. 夹具

- [x] 00303217/00303168 样本日志→结构化诊断（无证据不得输出 incompatible 结论）
- [x] unknown 首编译不 halt；capability_failed+新鲜指纹→缺口码成立；源码编译失败不进缺口、状态保持 unknown
- [x] probe 快照写读/TTL 失效回归（写入权限=代码结构保证：--ensure 路径只调 recordBinaryAndCliStartsProbe）；agent 声明不可升级 compile 态（写入权限负例）
- [ ] 宿主复验项（用户执行）：framework 完整调用链重测 07-16 事故机，确证/否证 00303168 真因
