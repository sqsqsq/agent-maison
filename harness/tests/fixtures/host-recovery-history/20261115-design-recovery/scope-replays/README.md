# 六组真实初始设计质询范围回放

只读来源为 `SimulatedWalletForHmos/doc/features/bc-openCard-2/goal-runs/20261115T073957Z-e7af8c` 中已结束的调用。每一侧都取对应调用的真实 `blueprint-before.yaml`，前轮结论取真实独立 `questioning-output.json`，文件依赖取两侧历史 `preSnapshot`。没有拿当前宿主文件充当后像，也不启动宿主或设备。

- `inputs.json.gz` 保留公共蓝图作者内容、真实前轮 disposition/证据地址/验证形状、历史来源文件哈希及公开 read 返回的评审 frontmatter；质询长文以其 SHA256 代替。没有原生会话、内部推理、产品源码或参考图片。
- `sources-and-results.json` 登记原件 SHA256、R3 与最终选择的完整 scope 清单、真实未决项、历史依赖变化，以及完整原件与缩减投影结果相等的核验。R3 selector 的 SHA256 为 `8b1e5d023f11fc6d9bd8638d413903fb4420a31d36210cd5931847eb6e510c65`，已与保留的 `r3-packet/framework-3.1.0.zip` 内同文件逐字节核对。
- `expectations.json` 对每个必答范围登记选择或保留理由。引用闭包逐边保留稳定 ID、内部指针或确切证据文件的真实 leaf 值；测试核对这些 leaf、变更根、独立未决项、完整范围身份及保留项事实，并非只断言数量。

所有组均有 26 个必答范围；下表数量由完整 scope 清单得出。前四组原 R3 因全局权威内容变化全量返回；新算法核到具体 ID、落点和确切来源，无法唯一定位显式落点时仍全量回退。后两组既有局部边界逐项保持。

| 真实前像对 | R3 | 最终新算法 | 按事实保留 | 选择依据 |
|---|---:|---:|---:|---|
| i3 → i5 | 26 | 24 | 2 | 原 i3 的 7 项 blocker、runtime/development/scenarios 与 lens 真实变更；card-store、交接/清栈/首页刷新决定及新增事实沿稳定引用和来源传播。contract-sources 文件的历史哈希也实际改变。保留 module_boundaries、process_recovery。 |
| i6 → i8 | 26 | 26 | 0 | 变动 `qa-performance` 的 `/quality_attributes/3/landing` 前后都是未定位的自然语言。即使 `source_ref` 从 `contract:card-store` 改为可解析的 `design_views/1/runtime_data_flows/0/initial_load`，来源也不能替代显式 landing 的消费者落点，故全量回退；不沿用先前错误的 22 项局部结论。 |
| i13 → i15 | 26 | 22 | 4 | 原 i13 的 3 blocker 与 6 open_decision 全保留；card-store、两个 data_domain、交接/倒计时/刷新决定与场景修改。历史 contract-source 改变，CardRecord 引用路径缺少历史文件仍交相关原项。保留 module_boundaries、capability_seams、state_owners、process_recovery。 |
| i15 → i17 | 26 | 18 | 8 | 原 i15 的 2 blocker 与 3 open_decision、development 修改、card-store 契约修改及其消费者；data_producers_consumers、initialization 与术语依赖确有命中。其余 8 个 lens 的作者事实、已解决独立结论和证据仍有效。 |
| i8 → i10 | 15 | 15 | 11 | runtime/flow、development/deployment 实改，原 i8 的 3 blocker、变动 reader_guide 对应视图及原显式 ID 消费边。无全局权威变更、无外部依赖变化；10 个 lens 与术语原结论全部保留。 |
| i10 → i13 | 13 | 13 | 13 | runtime/flow 的真实修改及既有显式 ID 消费边，复核 development、scenarios 和 9 个 relation。无全局权威变更、无外部依赖变化；logical、deployment、10 个 lens 与术语全部保留。 |

i6 → i8 的 `fullFallback` 保全前后真实 landing 原值与来源引用，并用真实 QA 条目作隔离反例：只把该变动条目放回前像仍须全量；把两侧 landing 都改为唯一稳定 `view:runtime` 后可恢复局部，不能一律全量，也不能只修后一侧而掩盖前像缺口。其余五组范围未变。contract/gap 的 `needed_by=bc-openCard-2:current` 是当前/远期切片归属，不能按显式消费者落点误判。

临时实现曾把前轮普通 scope 的内部指针再次变成消费边，导致后两组各多出 6 个 lens；该扩大已撤回，最终两组相对 R3 的新增/移除 scope 均为空。普通范围修改不借未修改的权威条目或旧答案路径扩大复核；新权威内容变化仍按真实来源定位，不能为压数量忽略依赖。未知稳定身份和未知文件依赖也由真实夹具的定向反例验证必须全量回退。

仓根定向复跑（不依赖原宿主）：

```powershell
npm --prefix harness run test:unit -- --filter initial-design-repair --case "a920 real historical scope replay" --workers 1
```

需要重新核原件时，在仓根运行只读捕获；第二参数须指向保留的 R3 源码。捕获会核实调用已结束、写快照 clean、裁剪前后依赖计算一致，以及原件与最小投影在两套算法上的逐组选择一致。

```powershell
node harness/tests/fixtures/host-recovery-history/20261115-design-recovery/scope-replays/capture.cjs <历史根-run目录> <R3源码根目录>
```

捕获仅更新本夹具的输入和原件核数；`expectations.json` 是逐范围复核后的期望，算法改变后应先核实差额和理由，再更新期望。反例覆盖真实保留项被新独立异议重开、变动权威缺稳定 ID 时全量回退、未知来源依赖时全量回退。

这些是确定性历史回放，不是新的真实模型质询或耗时测量，不能单独签发 50%/70% 效率目标或原业务交付完成。
