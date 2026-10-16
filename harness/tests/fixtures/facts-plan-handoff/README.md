# 38e5a7c2 真实输入

来源：SimulatedWalletForHmos，bc-openCard-2/implement-bank-card-opening，run `20261015T142539Z-bc2ff7`，发布件 `63a93b65`。

- `facts.md` 原字节：`72f3cb94e3b8dc0fa60b506cdbed5ebb29d52397e5bfb3cdccec29b3e8c5f744`。
- `contracts.yaml` 原字节：`d9646c5919f640b10efa7cc7a1e1c07adc0d96d1dcec6bbb36b8bc212e65a370`。
- `use-cases.yaml` 原字节：`f93ab0ee7280e8977cd96689455781eb99fcf5f0540797f17b94df6605113735`。

事实记录保留 spec 原始基线及 plan 增量，不在头部补 module.json5。`project/` 保留该契约的原 CU/蓝图/权威引用、配置和所需既有源文件，来源哈希见 `sources.json`（9 份配置仅将 CRLF 转为仓库要求的 LF，架构说明仅移除一处行尾空格；原始来源哈希保留，另记 `fixture_sha256` / `fixture_bytes`）；不预放 contracts/use-cases，由 plan 作者替身在调用中写出。

直接事实测试用临时可读文件支撑路径/新鲜度检查，不据此声称验证产品语义。交接测试使用真实 HMOS profile、输入解析、契约检查、summary writer、runtime 和范围修订，个人 adapter/工具链及执行传输使用已有替身；证明边界截止 coding 输入接手，不证明真实产品构建/设备验收。第一轮有意制造空写集，验证真缺陷先被拒；第二轮写入上述原产物后交接。反例只在临时副本变更，不写业务宿主。
