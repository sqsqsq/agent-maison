# 交互式视觉能力自测卷（personal-setup 后置 · UI 相关阶段）

**适用**：非 headless 的交互式会话（IDE 里 agent 即会话）。UI 相关需求（截图/像素级/视觉保真/界面描述等）进入 spec/coding/code-review/device-testing/change-lite 前，须确认当前模型**真的能看图**——IDE 模型是下拉框随手切换的，声明式探测会被纯文本模型套壳骗过（案A mx 2.7）。goal 模式已有自动金丝雀；交互式走本自测卷。

**强度诚实**：本流程是 `soft_rule_only` advisory（交互式无编排器强制 spawn）——比"依赖模型诚实自评"强（确定性判卷 + 随机卷 + 写盘缓存），但**不与 goal 模式等效**。

## 何时跑

判卷 CLI 自身做新鲜度/适用性判定，**无脑跑即可**——它会输出 `SKIP`（已有新鲜缓存或本机无须探测）或 `CHALLENGE`（须作答）。你只需在 UI 相关需求进入上述阶段、且 personal-setup 已 `ok` 后跑一次。非 UI 需求可不跑。

## 并发编排（**逐步照做，勿改序——前台跑会死锁**）

判卷 CLI 出题后**同进程等待答卷文件**；若你前台（阻塞）跑它，你在等命令返回、它在等你写答卷 → 互等死锁。**必须后台（非阻塞）启动**：

1. **后台启动** grader（不阻塞当前会话）：
   ```bash
   cd framework/harness && npx ts-node scripts/grade-vision-canary.ts --project-root <repo-root>
   ```
   用你的宿主提供的后台/非阻塞 shell 方式启动（cursor：background shell；claude：`run_in_background`）。
2. **读首行输出**：若是 `SKIP {…}` → 结束（已有结论，无须作答）。若是 `CHALLENGE {"challenge_id","image_path","answer_path","expires_at"}` → 记下 `image_path` 与 `answer_path`。
3. **看图作答**：用 Read 工具打开 `image_path`，按下列**逐行**格式作答（能看见就如实填，看不见就诚实声明——不要猜色/编 token）：
   ```
   TOP_LEFT_COLOR=<color>
   TOP_RIGHT_COLOR=<color>
   BOTTOM_LEFT_COLOR=<color>
   BOTTOM_RIGHT_COLOR=<color>
   TEXT_TOKEN=<图中印的短字母数字 token>
   ```
   完全看不见图 → 答卷内容写成一行 `CANNOT_SEE_IMAGE`。
4. **写答卷**：把上面内容**一次性完整**写入 `answer_path`（就是这一个文件；答案不会落别处）。判卷器只在读到**完整答卷**（全部 4 个几何键 + `TEXT_TOKEN` 键都在，或单独一行 `CANNOT_SEE_IMAGE`）时才收卷；空/半截文件被当"尚未写完"继续等到超时。若你的写工具非原子且可能被中途读到，稳妥起见先写临时文件再 rename 到 `answer_path`。
5. **等 grader 退出**，读末行：`VERDICT {"verdict","reason","wrote":true}` = 已判卷并无感写入 `framework.local.json` 的 `vision.canary`；`TIMEOUT` = 你没在 `expires_at` 前写答卷，**未写盘**（不是"判你盲"，重跑即可）。

## CLI 不可用/失败时的回退（软自答兜底）

若 grader 因环境问题跑不起来（ts-node 缺失/CLI 报 `ERROR` 等），回退到软自答：用 Read 打开一张需求参考图，用自己的话**具体描述**内容（颜色/文字/布局，不是复述文件名）；给不出具体描述就如实按「无视觉能力」走 [ui-spec 盲档工作法](../feature/spec/reference/ui-spec.md)。**回退结论不写 `vision.canary` 缓存**（只有确定性判卷结果才配缓存）——下次仍会尝试自测卷。

## 盲档结论后

判卷 `none`/`ocr_capable`（无视觉/仅 OCR）时的用户告知与一次性确认，见 [ui-spec 盲档工作法](../feature/spec/reference/ui-spec.md) 的交互式入口（registry `vision.blind_tier`）。
