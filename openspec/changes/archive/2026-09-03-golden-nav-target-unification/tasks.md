# golden-nav-target-unification

## 1. 实现

- [x] 1.1 `loadGoldenContractFromEnv` 单次装载（positive_screens + forbidden 单次
      JSON.parse；`loadGoldenContractTargetsFromEnv` / `loadGoldenContractForbiddenFromEnv`
      收敛为委托；`captureVisualDiff` env 回退同样单次装载，不再 targets/forbidden 分两次
      读 env——review P1 修复）— (`profiles/hmos-app/harness/visual-diff-capture.ts`)
- [x] 1.2 `collectGoldenPositiveTargetIds`（canonical 正向 target ID：extraScreens 屏 id +
      extraOverlays capture id）— (`profiles/hmos-app/harness/visual-diff-targets.ts`)
- [x] 1.3 `runDeviceVisualDiffCapture` 入口抽取：nav 校验 / identity 解析 / capture 共用
      `P0 ∪ golden positive ∪ golden forbidden nav` 集合；golden 解析结果显式传入
      capture（不再各自读 env）；golden failures 在 nav 门禁 fail-closed 点名；
      普通模式 P0-only 行为不变 — (`harness/scripts/check-testing.ts`)
- [x] 1.4 入口级测试套件 `golden-nav-capture-wiring.unit.test.ts`（8 用例：P1 合法进 nav
      并采集 / forbidden 进 nav 集合+负向证据 / 无 golden P0-only / P1 键仍判多余 /
      golden 缺失·形态漂移 fail-closed / identity 集合一致含 forbidden 纳入需求集），
      注册入 `run-unit.ts` CORE_SUITES
- [x] 1.5 direct capture env 单次读取守门测试（`golden-capture-targets.unit.test.ts`：
      readFileSync 计数=1，覆盖 captureVisualDiff env 回退路径）— review P1 修复

## 2. 验证

- [x] 2.1 定向套件：golden-nav-capture-wiring 8/8、golden-capture-targets 7/7、
      visual-diff-nav 19/19、visual-debt 32/32、consumer-golden 21/21、
      golden-bc-opencard 10/10
- [x] 2.2 `cd harness && npm test`（typecheck + unit 全量 + fixtures 全量）
- [x] 2.3 `npm run openspec:validate -- --all --strict`；`node scripts/check-plan-version.mjs`；
      `git diff --check` 干净
- [x] 2.4 宿主复验（golden 十固定屏经真实入口采集、HomeTab 负向证据落盘、evaluator
      裁决）——需宿主安装新版本后执行，与 c4e8b1d3 Todo 5 同一次统一回归，本仓库内保持 pending
  - 2026-09-03 收口登记：宿主回归/回灌/跨夜 run 验证不在 3.0.0 窗口执行（用户裁决，同 4bcee33d）；本轮 npm test 3795/3795 + fixtures 46/46、openspec:validate 44/44 strict、release:verify ALL PASS（--skip-plan-release-gate --skip-typecheck）。