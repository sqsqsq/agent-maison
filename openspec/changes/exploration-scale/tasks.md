# Tasks: Exploration Scale

## 1. facts.md 契约

- [ ] facts 模板 + frontmatter schema（established_by / key_inputs_read / phase_delta 节）
- [ ] 六个 phase-rules 的 exploration 规则改"facts 存在 + 本阶段 delta 节"
- [ ] exploration_strategy 首建全额 / 后续降额
- [ ] check-receipt 凭证指向 facts.md#phase_delta（经 C2 policy 分派）

## 2. 兼容与 backfill

- [ ] 旧 per-phase context-exploration.md 读取兼容（WARN 提示 backfill）
- [ ] backfill-context-exploration.ts `--to-facts` 归并（幂等）
- [ ] 新旧布局双夹具

## 3. project_scale

- [ ] config template + schema：project_scale / config.phases_disabled
- [ ] profile-loader：config ∪ profile 并集；C0 resolvePhaseChain 消费
- [ ] framework-init：scale 建议（catalog ≤3）+ 用户确认写入 + 确认点登记
- [ ] spec Step 1.5 small 档降级分支 + catalog 卡片可选字段
- [ ] small 档红线夹具（diff_within_scope / Scope 声明照常强制）

## 4. Verify

- [ ] `cd harness && npm test` 全绿（缺省 standard + 旧布局零回归）
- [ ] `npm run openspec:validate` + `npm run release:verify`
