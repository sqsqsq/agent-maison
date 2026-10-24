| id | status | severity | 证据（一行：文件:行 / 引文 / 数值） |
|---|---|---|---|
| five_layer_compliance | PASS | BLOCKER | `plan/plan.md:55-69`：Phone→WalletMain/AccountManager、WalletMain→AccountManager/SystemBase，模块层级与允许依赖方向一致。 |
| module_internal_layer_compliance | PASS | BLOCKER | `plan/plan.md:75-121`：模型、Repository、领域服务、页面和组件分别落在 data/model、data/repository、domain/service、presentation/pages、presentation/components。 |
| module_minimality | PASS | MAJOR | `plan/plan.md:63-67`：未新增模块，仅修改 CU touches 投影出的 WalletMain、AccountManager、Phone。 |
| feature_split_accuracy | PASS | MAJOR | `plan/plan.md:42-49`：业务流程归 WalletMain、账号手机号归 AccountManager、根目的页装配归 Phone。 |
| data_type_legality | PASS | BLOCKER | `plan/plan.md:127-170`：字段仅使用 string/number/boolean/Resource、已定义枚举和合法可空联合，无 any/object。 |
| no_tbd_in_p0_p1 | PASS | BLOCKER | `plan/plan.md:123` 唯一“后续”是已冻结链中的 UT 阶段落点，不是未决设计；P0/P1 无 TBD/TODO/待定。 |
| architecture_doc_consistency | PASS | MAJOR | `plan/plan.md:30-40`：`architecture_impact: none`，按本检查规则不触发 architecture.md 更新比对。 |
| navigation_flow_consistency | PASS | MAJOR | `plan/plan.md:281-304`：双入口→卡型 Sheet→选卡页→OTP Sheet→结果页，成功回首页、失败回 AddBankCardPage，与 `acceptance.yaml:86-103` 一致。 |
| acceptance_to_interface | PASS | MAJOR | `plan/plan.md:239-258` 与 `174-223`：AC-1..AC-5 均有对应模型、接口或组件；AC-6 路由接线见 `297-304`。 |
| reference_crosscheck | FAIL | MAJOR | `acceptance.yaml:91-96` 将真实 NavPathStack 明确归 device，`acceptance.yaml:54`、`:139-145` 要求可隔离倒计时状态机 UT；但 `contracts.yaml:125-132` 的导航接口直接接收 NavPathStack，`use-cases.yaml:54,59` 又把它列作预期端口调用，而倒计时仅落在 `plan/plan.md:231` 的 UI `@State + setInterval`，缺少可隔离业务状态接口。 |

```yaml
verification_result:
  phase: "plan"
  feature: "cu-YmMtb3BlbkNhcmQtMgBiYW5rLWNhcmQtb3BlbmluZy1mbG93"
  timestamp: "2026-10-23T05:12:35.309Z"
  checks:
    - id: reference_crosscheck
      status: FAIL
      severity: MAJOR
      details: |
        验收与施工契约的测试层级不一致。acceptance.yaml:91-96 明确真实 NavPathStack 属于 device_focus，UT 至多覆盖纯清栈计算；但 contracts.yaml:125-132 的 OpeningNavigationService.finish 直接要求 NavPathStack，且 use-cases.yaml:54,59 把该调用列入用例预期端口。与此同时，acceptance.yaml:54、139-145 要求隔离验证倒计时状态机和重发门禁，plan/plan.md:231 却只把这些状态放在 OtpVerificationSheet 的 @State + setInterval 中，plan/plan.md:251 的 OtpService 仅提供发送方法。后续 UT 若不实例化 UI，缺少可驱动的真实倒计时/导航决策状态；若实例化真实 NavPathStack，又违反已声明的设备层边界。
      suggestion: |
        由原设计责任方调和施工契约：把倒计时与重发门禁抽成可注入时钟、可隔离驱动的业务状态对象；把导航服务改为返回纯导航决策/清栈计划，由结果页在 presentation 层对真实 NavPathStack 执行。同步 contracts.yaml、use-cases.yaml 及 CU mappings，真实栈和返回手势继续只交 device testing。
  summary:
    total: 10
    pass: 9
    fail: 1
    warn: 0
    blockers: 0
    verdict: PASS
```

<!-- maison-verifier-result:v1 -->
verifier_subject_id: e4024fb9b8fc40341d54cfc3fce1b8a28c1a34ec5d77c38c89150f67c099a364
verdict: PASS
blocker_count: 0
<!-- /maison-verifier-result:v1 -->
