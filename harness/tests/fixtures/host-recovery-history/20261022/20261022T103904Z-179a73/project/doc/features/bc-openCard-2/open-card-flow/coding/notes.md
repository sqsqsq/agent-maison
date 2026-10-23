# Coding 交接

fidelity_target: pixel_1to1
asset_acquisition: approximate
verified: unverified

四图仅以 OCR / observation sidecar 与 ui-spec 实施，未声称视觉验真。

## 视觉残差与后续核验
- major: open_card_guide.svg 是显式近似手机/二维码插画，占位仍未验真；应由 testing 机器视觉判定并在发布前修复复核。
- major: 保留既有银行入口布局，没有为类型半模态背景追加参考图搜索行；它不在原功能要求内，需视觉阶段记录差距，不能据此声称四图像素级一致。
- minor: 选卡按钮与 Radio 暂沿 ui-spec brand_primary（蓝色），观察 sidecar 提示参考为红色；未精确采色，交 testing 核验。
- minor: 圆角、字号、键盘避让、sheet 实机尺寸与字距待 testing 当前设备核验。

逐文件使用 profile checkCodingLint 代替本宿主未提供的 ReadLints，最终类型/资源正确性由真实编译承担。两入口具有各自的本地 sheetVisible，不订阅共享展示布尔位；避免单例重复弹 sheet。

PhoneAbility 的前台通知与 CardStackSection 两个可选属性为 Home 从 RDB 恢复的必要接线，仍在三模块范围内。未更改 UT 或 testing 产物，后续按冻结链执行。

## 独立 verifier 交接
verifier_subject_id: 326280e553e48bd1774d6938a57141d0079890f3bce4ce31ee4d414f2d4e18d1
结论 PASS / 0 BLOCKER。WARN 按 Skill 不返修：CardTypeSheet 同意动作由按钮承担，选卡由 selectedIndex 与 Coordinator 持对象，结果 payload 为可空初始化状态；均为内部表示差异，无公共回调违约。AC-7、侧滑/返回、键盘、真实清栈、四图及动态状态仍待 testing，当前无图能力不作视觉保真 PASS。静态台账 implemented_by 当前用了文件路径而 checker 期待 struct 名，定位 WARN 不等价于产品结构缺失，实际组件与 id 可在对应文件核对。
