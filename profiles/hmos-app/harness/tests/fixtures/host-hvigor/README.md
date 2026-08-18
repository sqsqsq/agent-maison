# host-hvigor fixtures — 宿主真实日志切片（t1 / t5 回归用）

## 来源（真实字节切片）

两份切片直接取自 08-17 宿主取证证据目录（保留 ANSI 原文字节，未改写任何行）：

- **`nonfatal-error-success.log`**（成功 + 非致命 ERROR）
  来源：`D:\97.log\问题反馈\08-17\framework-evidence\coding-reports\hvigor-build.log`
  （共 79870 行）。本切片 = 首段 206–218 行（含第 210 行与第 217 行两条
  `> hvigor ^[[91mERROR: [ConfigurationMng] [genDicConfigFile] merge error {ENOENT…}`
  非致命噪声）**拼接** 尾段 79859–79870 行（末行 `> hvigor ^[[32mBUILD SUCCESSFUL in
  1 min 23 s 619 ms ^[[39m`）；中段 79640 行省略并以注释行明示。拼接是**版面裁剪**，
  两侧文本逐字未动。
- **`arkts-fail.log`**（5 条 ArkTS 编译失败）
  来源：`D:\97.log\问题反馈\08-17\framework-evidence-round3-20260817-194102\30-cli-rom-framework-args\stderr.log`
  （共 42805 行）。本切片 = 42753–42805 行逐字：5 条 ArkTS Compiler Error
  （`COMPILE RESULT:FAIL {ERROR:5 WARN:3944}` 声明的正是这 5 条）+ 末行
  `> hvigor ^[[91mERROR: BUILD FAILED in 7 min 9 s 756 ms ^[[39m`。

> 若证据目录重新组织，替换本目录同名文件即可——判据与断言不依赖具体行文。