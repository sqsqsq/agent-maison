# hmos-app · capability providers

`profile.yaml > capabilities.*.provider` 与实现对照（脚本仍经 `scripts/utils/*` shim **静态** import，本目录为第一方 SSOT）：

| capability | provider 标签 | 模块 |
|------------|---------------|------|
| coding.compile | hvigor | [coding-compile.ts](./coding-compile.ts) |
| ut.compile | hvigor_ohostest | [ut-compile.ts](./ut-compile.ts) |
| ut.run | hvigor_hypium | [ut-run.ts](./ut-run.ts) |
| device_test.run | hdc | [device-test.ts](./device-test.ts) |
| device_test.build | hvigor_app | [device-test-build.ts](./device-test-build.ts) |
| device_test.install | hdc_app | [device-test-install.ts](./device-test-install.ts) |
| prd.visual_handoff | script | [prd-visual-handoff.ts](./prd-visual-handoff.ts) |

统一接口占位见 [types.ts](./types.ts)；聚合导出入口：[index.ts](./index.ts)。
