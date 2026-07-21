# Tasks — visual-capability-truth

## 1. S1 立项与协议定案

- [x] 1.1 OpenSpec change 立项（proposal/design/五域 specs；plan e9c4a7f3 五轮 review 冻结为源）
- [x] 1.2 协议定案落 design.md（三轴/签发路径 A·B/终签四条件/反证三态/nav 2.0/UTF-8 边界/授权三源+manifest 冻结/回退事件集/journal 重放/S6·S7 契约）

## 2. S2 真机基建（P0-B UTF-8 + P0-C screen identity）

- [x] 2.1 hylyre spawn env 注入 PYTHONUTF8/PYTHONIOENCODING（device test + visual nav 两路径）
- [x] 2.2 vendored wheel steps 读取 encoding 审计（可修改性/重建/manifest；不可修改则兜底并记边界）
- [x] 2.3 中文 round-trip doctor（真实链路 steps→parser→predicate 回读；FAIL→BLOCKER 阻断 device testing，归 toolchain）
- [x] 2.4 乱码形态回归（`'����'` 可检出）
- [x] 2.5 nav loader schema 2.0 + 旧数组兼容读取 + 写回 2.0
- [x] 2.6 identity gate（all_of/any_of/none_of + 最低强度 + proposed 不参与判定）接进采集顺序（dump→gate→screenshot→canonical write；mismatch 归档 `_mismatch/`）
- [x] 2.7 迁移/候选生成命令（df=0 判据 + 跨屏判别度排序 + proposed 标记）+ MIGRATION.md
- [x] 2.8 错页回归（add_bank_collapsed 形态判 mismatch 且正式目录零写入）；capture 按缺失处理
- [ ] 2.9 真实 Windows 中文系统 E2E（宿主环境执行，结果回灌）

## 3. S3 能力真值（P0-A）

- [x] 3.1 canary receipt 增维（provider/model/native_image_input/image_tool_available/probe_context）+ model unknown → session 级复测
- [x] 3.2 `resolveEffectiveVisionContext` 三轴分算 + fail-closed meet + 轴边界规则（run_probed 不跨 run/同 hash 继承/invoke 绑定）
- [x] 3.3 invocation_bound 签发——runner 侧（路径 B inline canary 已落；路径 A 路由全等待有可证模型路由的 adapter 后启用——当前无 adapter 能证 model，无输入源）
- [x] 3.4 参考图验读 provenance 扩展（critic-receipt 机制 → spec 期 authoritative refs；未读清单非空不可签）
- [x] 3.5 vl_multimodal 终签四条件接线（ui_spec_fidelity_gate 拒收不合规签名）
- [x] 3.6 `vision_output_counterevidence`（contradicted/evidence_gap 分立 + 启发式 observe-only + 独立 attestation receipt）
- [x] 3.7 blind-safe 策略降级贯通（prompt 注入/各 gate/kit 派生全走解析器；supersede/clear append-only event；仅新 hash verified attestation 解除）
- [x] 3.8 消费面收口审计：全库无直读 framework.local.json vision / ui-spec.verified 判级的旁路
- [x] 3.9a vision 账本行级 hash 链 + binding 消费面验真（未链行=corrupt fail-closed；verified binding 必填/陈旧投影 unverified 含降级解除面；policy 总闸传当前 ui-spec hash）——codex 四轮 review P0/P1
- [x] 3.9b vision 账本单写者时序（codex 五轮 P0-1）：goal agent 自跑 harness 只算不写（对齐 S5 visual-rounds 纪律，MAISON_GOAL_GATE_HARNESS/非 goal 交互态才提交）+ agent invoke 前后快照括号（窗口内写入 → vision_ledger_tamper halt）+ 真实执行 check-spec 的行为级测试
- [x] 3.9c resume anchor 时序与真实性（codex 五/六/七轮 P0）：gate harness 后 post_harness anchor + checkpoint（HMAC=MAISON_HMAC_GOAL_CHECKPOINT，agent env 恒剥离；namespace 绑 project hash+feature+runId，runId 加随机后缀；auth_subset_sha256 绑 pre_authorized_mutations 规范化哈希——resume 失配=运行中扩权 invalid；原子替换；写失败 fail-closed）；五态分立 ok/ok_unauthenticated/mismatch/invalid/absent
- [x] 3.9e vision 信任完成态（codex 七轮 P0-1/P0-3/P1-1）：feature 级 authenticated head（vision-heads/<projectHash>/<feature>.json，单调 generation+双账本 hash+MAC；fresh run/resume 先验，跨 run 篡改 mismatch halt，runner 不为篡改 baseline 重签）；UI 相关 run 无 HMAC key 或仅弱 ack → CHAIN_SLICE_COMPLETED 封顶 AWAITING_HUMAN_REVIEW（capRunStatusForVisionTrust）；ack 两级（受信 receipt action=vision_ledger_ack 为强 ack；旗标为弱 ack——须 anchor 比对可行且过、终态封顶；无锚+弱 ack 不得继续）；迁移凭证跨 checkpoint 写入持久（七轮 P1-2）
- [x] 3.9f 密钥链纵深（codex 八轮 P0/P1）：信任锚 env（MAISON_HMAC_*/MAISON_TRUST_REGISTRY/MAISON_GOAL_CHECKPOINT_DIR）从**一切可执行宿主代码的子进程**剥离（hvigor/ohpm buildChildEnv、hylyre spawn；真实子进程读 env 测试锁定）；head 世代与 migrations 收 runner **内存可信态**（写点不读盘续签，覆盖前验盘 meta——锚被删/被改 halt，runner 不为篡改锚重签）；rekey/reseal 协议（--reseal-receipt，action=vision_trust_reseal 绑双账本 hash+旧 head 字节 hash——无 key→有 key 升级与密钥轮换不再死局，弱旗标不参与）
- [x] 3.9g 信任链深化（codex 九轮 2P0+2P1）：Python 准备链**全部** spawn（探测/import/venv/pip）统一 pythonSpawnEnv 剥离（非只最终 Hylyre 入口；宿主 sitecustomize 泄密面）；reseal object_hash 增绑当前授权子集哈希+frozen manifest hash+旧 checkpoint 字节 hash（堵"真人签 reseal 后模型扩权→checkpoint invalid→reseal 放行"授权升级旁路）；verifyVisionCheckpoint 校验 manifest_hash + head_generation（旧 checkpoint 与 head 脱节/manifest 非授权字段停机变化 → invalid）；覆盖前验盘增**字节 digest 精确比对**（runner 内存记最近写入 digest；合法旧文件重放身份+MAC 均过但 digest 不符→判篡改 halt）
- [x] 3.9h 信任链新鲜度+隔离纵深（codex 十轮 3P0+1P1）：HWM 持久链 + stripTrustAnchorEnv **大小写不敏感** + **HDC/设备工具 spawn 剥离** + manifest **身份哈希**漂移检测 + checkpoint manifest 绑定改身份哈希
- [x] 3.9i 信任链诚实化+一致性（codex 十一轮 2P0+3P1）：**HWM 能力诚实降级**（同权限域，尾部截断=协调回放步骤 → 只宣称"检测非协调回滚/意外损坏/非尾部改/链断"，不宣称密码学跨重启 anti-rollback；hardened 独立不可回卷锚=**pending 出路**：broker/远端 append-only/单调计数器）；**换钥 reseal 迁移 HWM**（reseal object_hash 绑旧 HWM 字节 hash + 事务化 quarantine 旧链，换钥不死锁）；manifest 漂移检测**移到副作用前**（canary/writeGoalManifest 之前）；**override 字段级授权**（裸 --override-start 只授权 start_phase，不放行 requirement/budget 等）+ **rebase 持久化**（fold 首个 run_start.fields→历次 rebase.to_fields，连续两次 resume 不复报 drift）；reseal 绑 **effective（rebase 后）manifest 身份哈希**
- [x] 3.9k rebase/事务/锁序修正（codex 十二轮 2P0+2P1+1P2）：**合法 rebase 不自我判死**（checkpoint 是可信旧基线 SSOT，drift 以 readVisionCheckpointMeta 取旧身份做字段级授权，verify 去掉 manifest/auth_subset 的 force-equal；events 仅审计投影）；**reseal HWM 事务化**（reseal journal prepared→quarantined→committed；rename 失败 fail-closed 抛、备份名碰撞安全、新链首写立即复验才 commit、崩溃恢复）；manifest 漂移检测**移到锁内且副作用前**（防并发 TOCTOU/事件污染）；**--fidelity 纳入字段级授权**（fidelityApplied 授权 fidelity/fidelity_receipt，升降档规则仍交 fidelity preflight）；文案/任务号修正（3.9i→3.9j）
- [x] 3.9l resume 授权面+崩溃窗口收口（codex 十三轮 2P0+2P1）：**fidelity transition 独立前置校验 fresh/resume 都执行**（枚举硬校验+降档 fidelity_downgrade receipt 验真+精确字段授权不搭车——resume 曾整段绕过 preflight 直落 authenticated checkpoint）；**reseal journal v2**（MAC + rename 前记录 planned_bak/旧三锚/receipt 绑定 + 启动内容判别式恢复：canonical==旧 sha→回滚原 receipt 复用、新链可信→补 commit、备份 sha 复验先于恢复、非终态禁覆盖重入）；**checkpoint schema 1.2**（逐字段身份必填；legacy 1.1 聚合 hash 相等才一次性迁移、不等须 --override-manifest 不静默 rebase；unauthenticated 基线=弱信任处置：resume 须 ack + pre_run_manifest 授权源降级）；**HWM absent 三分**（head 1.1 声明 hwm_declared：声明态缺失=删除拦截 fail-closed；legacy 显式 bootstrap；双 absent 才是首建）
- [x] 3.9m 三锚事务回滚+HWM 双向等值（codex 十四轮 1P0+1P1）：**reseal 恢复覆盖三个锚**（quarantine 时 sha 复验 copy 备份 head/checkpoint；commit 顺序 head→checkpoint→HWM 的中间崩溃窗口只回滚 HWM=三锚混合态、原 receipt 绑旧 head/checkpoint 字节永失配——回滚改为逐锚"比对→不符者从备份恢复（absent 语义=删新文件）→三锚全量复验等于旧 sha 才 rolled_back"，完成判定同时验 head 当前 key 可信；原 receipt 全崩溃窗口可复用）；**HWM 双向严格等值**（head 超前=incomplete_anchor_commit fail-closed halt——checkpoint 写完/HWM 追加前崩溃残留态不得被下次跨世代追加洗成正常历史）
- [x] 3.9n reseal completed 判据四门化（codex 十五轮 1P1）：完成判定与正常启动同一套门——verifyVisionFeatureHead（对当前账本快照）+verifyVisionCheckpoint（存在/MAC/files/head_generation 咬合）+assessHwmFreshness===proceed（HWM↔head 世代/digest 精确等值）四项全过才 committed；任一不满足**不 commit 不 blocked**（提前 committed=事务终态、永久放弃回滚资格，备份可恢复现场退化成人工处置）→落回三锚回滚，原 receipt 复用；场景C 补 checkpoint 走完整生产序列+负场景C2（缺 checkpoint→回滚）
- [ ] 3.9j hardened anti-rollback 独立锚（codex 十一轮 P0-1 出路二 pending）：权限隔离 broker / 远端 append-only store / 可信单调计数器——真正的密码学跨重启新鲜度（当前 HWM 仅同权限域完整性检测，尾部截断残余边界）
- [x] 3.9d legacy 无链账本升级迁移（codex 五/六轮 P0-3/P1-1）：**先验后迁**（resume 先过 checkpoint 校验，换皮 chainless 行=mismatch 非迁移触发）；迁移**事务化**（tmp 全量构建+fsync+验证+原子换名+崩溃恢复；构建失败原文件不动）；迁移凭证（旧→新 sha256）入受保护 checkpoint；downgrade/contradicted 保守继承，verified/supersede 不升级；mixed/不可解析拒自动修复

## 4. S4 阶段回退（P0-D）

- [x] 4.1 runner 级 source drift reconciliation（review 后 ut/testing 统一对账 + 结构化 changed_files）
- [x] 4.2 改码分类五分支 + 可信授权链（三源 receipt schema + run_started manifest hash 冻结 + 超界翻转 unauthorized + 逐 receipt 配额 + human 源 confirmation-receipt 信任链）
- [ ] 4.2b diff 内容级 change-kind 分类器（test_seam/integration_glue 判真）——落地前**自动回退禁用**（receipt 合规也 unauthorized 上抛人工裁决），codex 三轮 review P1-6
- [x] 4.3 回退状态机（phase_invalidated/backtrack 事件集 + 上限 1 次 events 计数 + 预算消耗 + resume 重建）
- [x] 4.4 invalidation 消费面改造（resume 起点/outcomes 过滤/goal report + 纯函数端到端断言；upstream gate/completion 等常驻 summary 消费面由回退重跑覆盖语义保障——窗口期无 harness 执行，注记于代码）
- [x] 4.5 环境层标注（failure_layer: environment + upstream gate 指引文案）

## 5. S5 ledger 单写者（P0-E）

- [x] 5.1 intermediate journal 写入（schema + hash 链）——goal 态 agent 侧 harness 切换
- [x] 5.2 evaluateVisualRound 逻辑历史（committed + 本 invoke journal 拼接）
- [x] 5.3 runner 收编顺序重放（重算 base_state_hash/decision/row_hash；不一致 halt）
- [x] 5.4 双侧回归（合法中间轮不误杀；伪造旧行/改行/非尾部删行/复制行/跨 attempt 仍熔断；尾部截断=已声明边界）
- [x] 5.5 no-progress fuse 回归（journal 两轮相同残差仍熔断）

## 6. S6 规约与用例（P1-F/G/H/I）

- [x] 6.1 contracts `integration_points` 机器块 + `integration_scope_consistency`（plan 期 FAIL + binding 实存验证）
- [x] 6.2 headless `plan.scope_expansion` 与 integration_points 矛盾 → halt 问人
- [x] 6.3 `host_entry_reachability`（coding 期静态走查）
- [x] 6.4 locator calibrate（七类分母 + 覆盖率落盘 WARN）
- [ ] 6.5 locator 宿主两 run 验证（需用户宿主配合，结果回灌）
- [ ] 6.6 locator enforce（pixel_1to1 P0 <80% BLOCKER）——**6.5 完成前保持 pending，不得提前勾选**
- [x] 6.7a `test_case_flow` machine block + Markdown 一致性门禁 + 级联三分归类（BLOCKED_BY 非 PASS：进分母/阻 completion/verdict 不变）
- [ ] 6.7b TC 执行器级联控制（前置失败跳过 dependent / fresh_app reset 执行 / reset 失败归 BLOCKED_BY_ENV）——依赖 hylyre 逐例驱动能力（当前 wheel 一次跑全 plan），codex 实施 review P1-1 诚实重开

## 7. S7 度量真实性（P2-J）

- [x] 7.1 结构保真拆轴（static_structure_conformance 保留 + runtime_mount_conformance 新增 + 视觉轴聚合）
- [x] 7.2a asset 轴 provenance 引用继承——可得四链硬比对（summary hash / source=attestation reconcile+inventory aggregate_sha256 / gate fingerprint 缺失即 fail-closed / asset 域 debt revision 落盘+重算比对；任一漂移或不可比 → STALE/UNVERIFIED）
- [ ] 7.2b build fingerprint 链接入——需 profile build 身份钩子（hylyre 实机采集构建指纹与源码链绑定），codex 实施 review 二轮 P1-6 诚实拆分 pending；**落地前继承恒 STALE（三轮 P1-5：部分 provenance 不得 PASS 继承，build 链缺证恒并入 issues）**
- [x] 7.3 资产实例绑定四段链（去业务化 + bc-openCard fixture）

## 8. 收尾

- [x] 8.1 MIGRATION.md 五条 breaking + skills 话术对齐
- [x] 8.2 全量验收：typecheck 0 · unit 全绿 · fixtures 全绿 · openspec validate 全绿 · plan version check
- [ ] 8.3 宿主完整 goal 重放（九条断言清单，需用户宿主环境）
