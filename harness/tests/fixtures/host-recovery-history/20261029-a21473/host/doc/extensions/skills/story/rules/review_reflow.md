# 评审回流规则：按 review.md 修订 spec

评审意见回来之后怎么处置。**输入唯一就是 `AR/review.md`**——人可能在系统上批注、
也可能直接改本地文件，流程不关心来源。

**不重建 story、不重新归档**：story 定稿于评审时点，系统上那份就是评审依据。
重建 story 是人显式发起新一轮评审时的动作，终止权在人，不在流程。

## 1. 逐项处置

| 表态 | 处置 |
|---|---|
| 同意当前建议 | 不动 |
| 有其他意见，需要修改 | 按该议题 `impact` 指出的编号改 `spec/spec.md`（走 correction 闭环，见 §3） |
| 暂缓 | 记台账、标挂起，不改产物 |
| **计划外意见**（review.md 末尾那一节） | 判类型：**需求类**→改 spec；**叙述类**→记台账，本轮不动产物 |

计划外意见有正式落点：`review.md` 的「计划外意见（不属于以上任何议题）」一节
（`<!-- freeform-zone -->` 区内，`build` 逐字节保留，不会被重建冲掉）。
起草方没登记成议题的事——缺的分支、该复用的既有能力、遗漏的埋点——都写在那里；
人写在别处（如某个议题的表单里）时照样处置，但落台账时要注明它写在哪。

计划外意见既没有表态位、也没有 `impact`，是需求缺失还是叙述不清**只能由你判**。
判错的代价是需求被漏掉，所以**判断结果必须落进台账供人复核**——
这类判断不能只存在于你的推理里。

`impact` 指向的是 spec 的真实编号（`story-build.mjs check` 会校验），
所以「改哪一条」是确定的，不用猜。

## 2. 处置台账 `AR/review-disposition.json`

交代每条意见的去向。读者是人（想知道意见到哪儿去了）与下游 plan（参考未处理项）。

```json
{
  "reqNo": "<AR>", "at": "<YYYY-MM-DD>",
  "items": [
    { "from": "DEC-003", "verdict": "revise", "disposition": "spec.md F1/AC-1 已改" },
    { "from": "DEC-007", "verdict": "defer",  "disposition": "挂起：等法务确认" },
    { "from": "freeform#1", "kind": "narrative",
      "text": "<原话摘录>", "disposition": "本轮不处理（story 不重建）" }
  ]
}
```

`from` 用议题编号或 `freeform#<序>`；自由意见须带 `kind`（`requirement` / `narrative`）
与 `text` 原话摘录——**分类是你做的判断，原话是人写的事实，两者都要留**。

## 3. spec 改动走 framework 既有的 correction 闭环

`--correction-init --q-requirement y` → 根因判 spec 层 → 级联重验下游已闭环阶段
→ `--correction-check` 收口。**不另造状态机**。

## 4. 归档后的边界

`AR/review.md` 归人所有——`story-build.mjs build` 不再重建它的人工区，只备份。
人可以自由编辑本地文件，不必担心被下一次 build 冲掉。

## 5. 已知限制

spec 修订后，系统上的正文（归档时的 story）停在评审时点，不再反映最新 spec。

- 对下游无影响：plan/coding 看的是 spec；
- 对后来查阅需求的人是**潜在误导**——系统上的叙事停在评审那一刻。

台账里注明「本轮 spec 已修订 N 处，系统正文未同步」，是否手工更新由人决定。
