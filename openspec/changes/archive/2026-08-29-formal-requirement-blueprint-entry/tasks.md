# Tasks — formal-requirement-blueprint-entry

> 本 change 只承载 `complex-capability-meta-model` 的入口语义 delta。P1/P2/P3 协议修订在
> 各自未归档 change 内原位进行，不在本 change 重复登记；发布件改动（`/component-design`、
> AGENTS 模板、M6 契约、宿主适配指南）由 M7 plan t4 承载。

## 1. 上位约束同批修订（dev-only）

- [x] 1.1 总纲 §0 增补"蓝图是每项正式需求在当前部件内的设计权威"定位句，复杂需求保留为完整形态
- [x] 1.2 总纲 §0.1 G1 改为"统一正式需求入口 + 两种上游输入形态"
- [x] 1.3 总纲 §1 补统一入口叙述，去除"复杂才进蓝图"的限定语气
- [x] 1.4 总纲 §2.2 撤销"小需求可直接是一个 Change Unit"，写入正式需求定义、条件式设计义务、
      非正式维护动作边界与 Story Design 术语对应
- [x] 1.5 总纲 §3 目标模型图删除 `SMALL --> CU0` 绕过蓝图路径，改为经薄蓝图；补图注
- [x] 1.6 总纲 §3.2 增补正式定义与术语边界表；"本次复杂建设"限定改"本次演进"
- [x] 1.7 总纲 §8.1 明确正式需求的 spec 一律在蓝图与 CU 之后
- [x] 1.8 总纲 §10.1/§10.3 补单 CU 正式需求链的宿主证据条目（不替代多单元证据）
- [x] 1.9 总纲 §11.2 增补三条 Story 类宿主接缝
- [x] 1.10 总纲 §13 第 1 条改为"元模型与统一正式需求入口语义"
- [x] 1.11 总纲 §14 完成定义补单 CU 链与三条接缝条目
- [x] 1.12 总纲 §15 明确不做改写（非正式维护动作 / 无档位无升级状态机）
- [x] 1.13 总纲 §16 第 1、2 问改写覆盖"每项正式需求"与单 CU 退化闭环
- [x] 1.14 全文语义搜索确认零残留"正式小需求允许绕过蓝图"规则

## 2. meta-model capability delta

- [x] 2.1 `Dual entry semantics` 改写为统一正式需求入口 + 两种上游输入形态，并禁止档位/升级状态机
- [x] 2.2 `Meta-model object identities and reference directions` 的轻量路径条目改写为非正式
      维护动作与存量平铺 Feature 兼容表述；补单 CU closure 退化不产生第二套协议
- [x] 2.3 新增 `Formal requirement determination is a stated contract, not a machine score`
      （D3 文案 + 三条判定纪律 + `/spec` 与 `/change-lite` 双兜底）
- [x] 2.4 新增 `Conditional design obligations replace entry gates`（多 CU 边界与关系分析、
      共享决策蓝图裁决一次、组合证据、安全中间态通用义务）
- [x] 2.5 新增 `View applicability and evolution impact stay orthogonal`（二值 + 正交字段 +
      至少一个 applicable/changed + 禁止三态合并 + 必须同步接线消费面）
- [x] 2.6 新增 `Story-class host seams stay three separate directional contracts`
- [x] 2.7 新增 `Design lens coverage is declared honestly per component type`（App-only 诚实声明）

## 3. 验收

- [x] 3.1 `npm run openspec:validate`（strict 全量）通过
- [x] 3.2 `node scripts/check-plan-version.mjs`（default 档）通过
