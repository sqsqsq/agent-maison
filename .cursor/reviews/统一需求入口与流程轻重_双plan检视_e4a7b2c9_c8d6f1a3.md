# 两份plan独立检视记录

日期：2026-11-11。范围仅为计划起草、返修及a47路标登记；不实施、不提交、不打包、不操作宿主或设备。

## 检视对象

- [A：统一需求入口与四档判定](../plans/统一需求入口与四档判定_内容核对及轻量执行_e4a7b2c9.plan.md)
- [B：需求设计按规模减负](../plans/需求设计按规模减负_短蓝图与CU映射收编_c8d6f1a3.plan.md)
- [a47目标](../goals/效率与准确率平衡总体目标_默认基线自主交付与可调精细度及可靠恢复_a47c9d62.goal.md)仅新增R8/R9路标；保留此前工作区改动。

## 真实调用

CLI：`C:/Users/shengqsq/AppData/Roaming/npm/claude.cmd`，版本`2.1.322`。

两轮均使用：

```text
claude.cmd -p --model opus --effort high --permission-mode plan
  --tools Read,Grep,Glob --allowedTools Read,Grep,Glob
  --strict-mcp-config --mcp-config <empty-mcp.json>
  --output-format json --no-session-persistence
```

提示通过标准输入发送，stdout/stderr分别保存。仅开放读取与搜索，不允许检视者修改文件、运行测试或调用子代理。两轮返回均为exit 0、is_error=false、permission_denials=[]，subagent_stats.spawned=0。实际模型均由`modelUsage`核实为`claude-opus-5-5`，不是仅凭请求别名自报。

| 轮次 | 原生session | 结论 | 原件 |
|---|---|---|---|
| 1 | `b4041fcc-2473-41ab-973e-a68309e3cff6` | NEEDS_REVISION：4项必修、2项非阻断建议 | [调用](../../temp/maison-entry-plan-review-20261111/review-1-invocation.json)、[提示](../../temp/maison-entry-plan-review-20261111/review-1-prompt.md)、[原始返回](../../temp/maison-entry-plan-review-20261111/review-1-result.json)、[意见正文](../../temp/maison-entry-plan-review-20261111/review-1-findings.md) |
| 2 | `aafa6fb4-82b4-4ac8-80de-819539d07ac8` | PASS：R1–R4/N1–N2全部关闭，无新增阻断、无非阻断建议 | [调用](../../temp/maison-entry-plan-review-20261111/review-2-invocation.json)、[提示](../../temp/maison-entry-plan-review-20261111/review-2-prompt.md)、[原始返回](../../temp/maison-entry-plan-review-20261111/review-2-result.json)、[意见正文](../../temp/maison-entry-plan-review-20261111/review-2-findings.md) |

## 返修闭环

| 意见 | 实际计划修正 | 最终结果 |
|---|---|---|
| R1 钩子无法机械识别语义新请求/继续 | 会话规则加载由hook核；请求归属由原正常推理解释、原request消费核源；不把旧本请求豁免扩大为会话豁免，不声称逐请求硬保证 | 关闭 |
| R2 自动请求缺原生会话/起始基线来源 | 明确原生payload/环境→session定位→既有CLI参数→reader→原request writer；起始HEAD优先直接捕获，唯一连续reflog才可重建；dirty/缺证不假PASS；短蓝图首次原checker即准备上下文 | 关闭 |
| R3 新CU的实现/测试映射无人生产 | 原中型设计作者同次给同形临时候选；CU接受后原writer发布唯一contracts.change_unit；限定可机械生成的真实来源，验收覆盖实际生产链 | 关闭 |
| R4 Cursor作者HEADLESS丢失 | 复用hasGoalExecutionSignal并集，增加实际作者hook环境短例，不复制判据 | 关闭 |
| N1 特别简单UT只有未核AC标签 | 原自动request保存必要用户原文和出处，作为可引用项目内预期来源 | 关闭 |
| N2 产品路径未定义 | 复用catalog/config/明确目标，按实际路径排除Maison产物；不整目录排除doc，不新增路径注册表 | 关闭 |

复核仅核既有意见和直接回归，没有重开架构或追加无证据机制。原意见与返回全部保留，不把被修复前的版本描述为通过。

## 最终版本与文档验证

- A SHA256：`83D1EC8584489F963436F349D38472F9CA48502132AADCFFF291C49A473B58B0`
- B SHA256：`0B3801C330057D21F82B87A571D863BB51029F320B34879DFF04BF1AB4DDE8C2`
- `node scripts/check-plan-version.mjs`：PASS，窗口3.1.0，父目标声明通过。
- `git diff --check`：PASS；两份plan为LF、无CR。
- 相对本轮登记前的a47工作区副本，仅增加两行路标。
- 本轮为计划/文档改动，不运行生产测试、宿主编译或设备验证；此前调查用例不是本轮实施验收。

所有实施todo仍为pending。两份计划停在待实施；用户另行通知及P4两项宿主待办、3f8a6c21收口条件均须成立后才开工。计划检视通过不代表短蓝图、前门钩子或性能目标已经实现。
