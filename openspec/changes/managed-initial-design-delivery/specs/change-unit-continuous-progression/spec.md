## MODIFIED Requirements

### Requirement: Thin progression reuses Goal Mode facts and recovery

薄推进循环 MUST 只做“读取事实→派生→选择一个→调用既有 Goal Mode→重新读取”。选中 CU 的派生 Feature identity MUST 与 Goal manifest/Feature artifacts 一致；canonical CU path/ref/hash 与蓝图 SHALL 通过原引用绑定供 phase 读取，MUST NOT 复制正文为新设计权威。原始正式请求的真实 requirement/source SHALL 保持原字段，不以 P2 交接合成短文替代；各 CU 的范围和影响 SHALL 从其真实权威产物派生。

单元完成 MUST 只认评估入口 `assessFeature().complete`（其中已含与当前 `change_unit_ref` 一致的施工契约核对）；失败、暂停、待人工、resume、retry 和 Feature 内 backtrack MUST 继续由既有 Goal Mode events/reducer/receipt/evidence 负责。循环中断后 MUST 可通过重读这些事实恢复，不得创建跨单元 checkpoint/ledger 或直接写 completion。共同 runtime SHALL 接通既有 caller，优先恢复 active run，保持单并发；初始设计 run 不得因尚无 CU 充当施工许可。

caller 返回 `completed` 后，薄循环 MUST 立即重读当前 CU completion；若结果不是 `VALID`，MUST 以既有 no-progress blocker 停止，且 MUST NOT 再次选择同一 CU。caller 返回值本身不得充当完成事实。child 正式完成的报告 SHALL 自动返回原请求重读 P2，不要求人或主 Agent 手动再启动 root。全部适用 CU 正式完成 SHALL 到本批原请求终点；随后仅按原部件闭环口径只读检查一次并披露，MUST NOT 自动修复、写出、收口或改判。`ready_for_component_closure` 和本请求完成均不得宣称部件闭环通过。

Enforcement: `harness/scripts/utils/change-unit-progress-loop.ts`, `harness/scripts/utils/change-unit-ready-set.ts`, `harness/scripts/goal-phase-runtime.ts`, `harness/scripts/goal-mode-entry.ts`, `harness/scripts/utils/verify-feature-completion.ts`.

#### Scenario: Three dependent units progress continuously

- **WHEN** fixture 有 A→B→C 三个合法 CU，Goal Mode 每次为选中 Feature 产生可验证 completion
- **THEN** 薄循环依次派生并调用 A、B、C，每次只启动一个，且三次完成均由既有验证入口确认

#### Scenario: Failed unit stops the outer loop

- **WHEN** Goal Mode 对当前 CU 返回失败、暂停或 awaiting-human 且无 VALID completion
- **THEN** P2 停止选择新 CU，返回同一 run 的恢复/阻塞信息，不把失败投影成 provides 已满足

#### Scenario: Completed return without completion fact makes no progress

- **WHEN** caller 返回 `completed`，但重读后当前 CU completion 仍为 ABSENT、INCOMPLETE 或 INVALID
- **THEN** P2 立即返回既有 no-progress blocker，只调用该 CU 一次，不循环重启同一 Feature

#### Scenario: A child report returns to the original delivery

- **WHEN** a direct child report formally completes its CU under an original complete component request
- **THEN** runtime SHALL automatically reread original P2 and select/resume the next legal CU until all applicable CUs formally complete
- **AND** the request endpoint SHALL use one read-only component check and disclose its unchanged result without automatic P3 repair or component-completion claims
