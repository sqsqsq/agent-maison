## 1. 内容与实现

- [x] 1.1 只读真实样本，形成 dev-only 样稿与七问来源对照，同步写作要求（plan t1）。
- [x] 1.2 蓝图+CU 共同收集、renderer、来源绑定、CLI 生成、publication 诊断（plan t2）。
- [x] 1.3 接通接受、readiness、持锁调和、B1；汇总最终文档结果和实际写入路径（plan t3）。
- [x] 1.4 同步 Skill、消费者文档、规格、样例和真实调用链回归（plan t4）。

## 2. 验证与采用

- [x] 2.1 目标测试与 typecheck，最终一次 cd harness && npm test；OpenSpec、plan 与 diff 检查。
- [x] 2.2 主代理复用生产稳定后的普通全测，补现有 release-only 套件，再沿既有 pack/verify/smoke 分步链验证候选包；不宣称执行 candidate:build 或正式 promote，独立 review 收口。
- [x] 2.3 主代理协调发布件宿主采用及正式设计流程七问验收，保持 t5 未完成直到真实证据齐备。
