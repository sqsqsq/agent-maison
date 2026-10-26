# UT 阶段验证报告 — cu-YmMtb3BlbkNhcmQtMgBiYW5rLWNhcmQtb3BlbmluZy1mbG93

> 生成时间: 2026-10-24T19:29:13.249Z
> 保证等级: full
> 能力解析: 3 项

## 一、脚本 Harness 检查结果

| 指标 | 值 |
|------|-----|
| 总检查项 | 62 |
| PASS | 57 |
| FAIL | 0 |
| WARN | 1 |
| SKIP | 4 |
| BLOCKER 数 | 0 |
| **裁定** | **PASS** |

### 警告项

- ⚠️ **it_drives_flow**: 22 个 it() 用例驱动力不足：
  - 02-Feature/WalletMain/src/ohosTest/ets/test/bank_list_legacy_ut.test.ets: "[AC-14] 银行数据源返回 20 条完整记录且顺序与展开态参考图一致" — portRefs=0 stateRefs=0 expects=4
  - 02-Feature/WalletMain/src/ohosTest/ets/test/bank_list_legacy_ut.test.ets: "[AC-16] 拼音分组产出 11 块、字母升序且块内按全拼升序" — portRefs=0 stateRefs=0 expects=5
  - 02-Feature/WalletMain/src/ohosTest/ets/test/bank_list_legacy_ut.test.ets: "[AC-16][BD-7] 字母索引集合由分组结果派生，逐一相等且不含空分块字母" — portRefs=0 stateRefs=0 expects=4
  - 02-Feature/WalletMain/src/ohosTest/ets/test/bank_list_legacy_ut.test.ets: "[AC-G3][BD-1] 数据源返回空数组时列表/药丸/分组三处可见性派生量均为 0" — portRefs=1 stateRefs=0 expects=6
  - 02-Feature/WalletMain/src/ohosTest/ets/test/bank_list_legacy_ut.test.ets: "[AC-G3][BD-2] 取数异常可 await 可 catch，吞掉后降级为空态且无未捕获 rejection" — portRefs=1 stateRefs=0 expects=5
  - 02-Feature/WalletMain/src/ohosTest/ets/test/bank_list_legacy_ut.test.ets: "[BD-4] 导航栈未挂载时取栈抛出，被 try/catch 吞掉后不外抛且调用方状态不变" — portRefs=0 stateRefs=0 expects=3
  - 02-Feature/WalletMain/src/ohosTest/ets/test/bank_list_legacy_ut.test.ets: "[BD-5] logo 为空图位时行模型仍完整返回名称与点击载荷" — portRefs=0 stateRefs=0 expects=6
  - 02-Feature/WalletMain/src/ohosTest/ets/test/bank_list_legacy_ut.test.ets: "[AC-14][BD-6] 数据源不读持久化介质，两次独立调用返回等价结果" — portRefs=0 stateRefs=0 expects=4
  - 01-Product/Phone/src/ohosTest/ets/test/WalletDestinationRegistry.test.ets: "[AC-6] existing and bank-opening destinations remain registered together" — portRefs=0 stateRefs=0 expects=6
  - 02-Feature/WalletMain/src/ohosTest/ets/test/bank_open_card_ut.test.ets: "[AC-1][BD-1] opening session enforces each continue gate" — portRefs=0 stateRefs=0 expects=9
  - 02-Feature/WalletMain/src/ohosTest/ets/test/bank_open_card_ut.test.ets: "[AC-2] card candidates are filtered while only the rendered number is masked" — portRefs=0 stateRefs=0 expects=5
  - 02-Feature/WalletMain/src/ohosTest/ets/test/bank_open_card_ut.test.ets: "[AC-3][BD-2] OTP starts once, blocks resend, resets at zero and accepts six digits" — portRefs=3 stateRefs=0 expects=11
  - 02-Feature/WalletMain/src/ohosTest/ets/test/bank_open_card_ut.test.ets: "[BD-4] cancelling sheet state clears selection, OTP and timers without persistence" — portRefs=1 stateRefs=0 expects=6
  - 02-Feature/WalletMain/src/ohosTest/ets/test/bank_open_card_ut.test.ets: "[AC-4] completion context exposes the full number once and then clears it" — portRefs=0 stateRefs=0 expects=2
  - 02-Feature/WalletMain/src/ohosTest/ets/test/bank_open_card_ut.test.ets: "[AC-4] repository commits all stored fields and treats a repeated number as success" — portRefs=2 stateRefs=0 expects=10
  ... 还有 7 项

## 二、AI Harness 语义验证

> AI Harness prompt 已生成，请将以下文件发送给任意 AI 模型执行验证：
> `..\..\doc\features\bc-openCard-2\bank-card-opening-flow\ut\reports\ai-prompt.md`

## 三、最终裁定

**PASS** — 脚本 Harness 未发现 BLOCKER 失败。注意：脚本 PASS 不代表阶段闭环完成，仍必须继续执行 verifier 语义验证并填写 completion receipt。
