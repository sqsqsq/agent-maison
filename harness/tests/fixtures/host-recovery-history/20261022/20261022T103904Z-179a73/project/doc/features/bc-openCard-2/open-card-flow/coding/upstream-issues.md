# Coding retry ownership / evidence issue

本次 invocation：run 20261022T103904Z-179a73，coding。

已按明确的 Facts admission / actual source reconstruction 指令，读取当前源码并重建 coding 基线；旧 established_by=spec 不具本次首实际阶段建立资格。此修复同时被 upstream_verdict_gate 判为 spec/plan 证据 stale。仅 coding 调用无法重签上游，未写 spec/plan 或任何 runner-owned 控制产物。

CR-001 的合法 fixture 同步已在本轮入场前存在：SpyBankRepository.ets 只有枚举 import 与 supportedCardTypes 两行；原 BankInfo 必填契约和旧测试断言完整保留。当前 coding 明确要求 implementation:CR-001 required，但 diff_within_scope 仍将相同修改判为“缺本周期 UT 产出事实”。这属于 coding/UT 责任解释冲突，应由 runner/框架维护方处理；不能通过撤销必需字段、弱化模型、改断言或伪造 UT 产出解决。未读取或修改 gate 实现。

真实 coding_compile PASS，git diff --check PASS。尚未执行旧 UT 原生用例：现有公开路径要求正式任务不拆独立 request，本调用仅授权 coding，未擅自启动 ut 阶段或补造其证据。fixture 不影响设备 UI/交互，未重复装机诊断。既有视觉债务保留，未声称视觉验真。

最终本阶段结论以 coding/reports/summary.json 为准；如 FAIL/open，交还 driver 按 NEXT_STEP 处理，不能声称 coding 完成。
