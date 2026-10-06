## 1. 计划冻结

- [x] 1.1 起草 3.1.0 plan 与本 change，完成 plan 扫描、本 change 严格规格校验与 Claude 首轮检视；调度发开发许可后冻结 plan 正文。

## 2. 中断返修原窗接续

- [x] 2.1 在现有 agent_invoke_end 与失败终态并列写可选 completion_observed，按 invoke_id 读取自己 end、旧字段用同 invoke verdict fallback；沿 request 回放窗口完成，保留非零清理和当轮全部成立拒修，产品结果交后续验证。
- [x] 2.2 接通 completed、attempted、同进程 continuation、resume/invalidation/advance 与历史未封卷错误完成窗口，native/provider/legacy/signal 候选保留原证据/快照，恢复不重发产品回退。
- [x] 2.3 覆盖中断＋static PASS、完成 end＋非零清理＋gate 崩溃 validation-only、timeout/turn.failed回owner、同invoke旧字段fallback、窗口外legacy重验、窗口曾完成后的retry中断与新request/invalidation、当轮拒修和改动仍失败，确认基线one-shot/拒修不变。

## 3. 资源预算与旧停机兼容

- [x] 3.1 撤 runtime 四类回退、scope replan、adjudication 里的固定两次硬停机资格，删除无用常量/参数，保留观测次数与事务序号、跨 run 调用/活跃时长账本和其它有界恢复。
- [x] 3.2 在当前裁决/接续边界共享旧 backtrack_limit-only 重评，贯通普通重发、前台/detach resume、attended prepare 与 supervisor；旧事件字节不改，真实终局不豁免。
- [x] 3.3 验证第三次真实进展、各回退入口、旧终局多入口可达及 turn/wall/授权/owner/封卷/混合终局反例，保留现有可信周期边界用例。

## 4. 视觉裁决同源

- [x] 4.1 沿 effectiveScreens 与既有 gate materialization 统一授权/severity/保真裁决，provider 仍不输出 verdict，minor-only/soft降级writer产warn候选、pass须空defects，原意见/source/hash留存，消除平行否决。
- [x] 4.2 接通 gate/channel evidence、collector、debt/report，沿现有软档 major 债务与真实 blocker/hard major/T8 major 修复，缺证走 testing 恢复，runtime 不复制保真规则。
- [x] 4.3 从真实无 verdict provider payload 开始验证 minor 与短信 blocker 链路，同时覆盖 hard/soft、T8/自报/provider、mixed refs/重复屏、legacy 文本、授权与缺证反例。

## 5. 文档、验证与交付

- [x] 5.1 同步生产 Skill/规则/运维、progress/report 状态预算展示和 MIGRATION.md，删除固定两次硬额度与 requirement increment 刷机会指导，披露 unknown 最坏硬资源消耗及 soft provider major 行为变化，保持发布件拓扑。
- [x] 5.2 运行 typecheck 和受影响目标套件，报告真实执行范围/计数/退出码；完成 plan 扫描、本 change strict validate 和 git diff --check。
- [x] 5.3 代码冻结后由调度一次运行 harness/npm test 与受影响 release-only 链路；Claude 独立代码检视，窄返修复用有效全量结果并只补相关集。
- [x] 5.4 明确发版门禁去向：常规 npm run release:verify 留正式发布执行（该命令会 pack，本批用户明确禁止打包）；本批完成受影响 release-only 链路与默认全测，不把未执行的打包门禁称为通过。
- [x] 5.5 按真实结果同步 plan todos/OpenSpec tasks，交付 Claude 结论、验证与 H1 真宿主待验边界，不提交/推送/打包/操作宿主。
