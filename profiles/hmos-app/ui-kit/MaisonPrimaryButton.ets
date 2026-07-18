// Maison UI Kit — MaisonPrimaryButton（semantic_node: primary_button）
// 主操作按钮：enabled/disabled 状态色由 token 分支——事故形态：盲档把禁用态淡蓝写成常态。
// variant: enabled | disabled | loading。

@Component
export struct MaisonPrimaryButton {
  anchorId: string = '';
  label: ResourceStr = '';
  enabled: boolean = true;
  loading: boolean = false;
  onAction?: () => void;

  build() {
    Button() {
      Row() {
        if (this.loading) {
          LoadingProgress()
            .width(20)
            .height(20)
            .color($r('sys.color.ohos_id_color_text_primary_contrary'))
            .margin({ right: 8 })
        }
        Text(this.label)
          .id(`${this.anchorId}-label`)
          .fontSize($r('sys.float.ohos_id_text_size_button1'))
          .fontColor(
            this.enabled
              ? $r('sys.color.ohos_id_color_text_primary_contrary')
              : $r('sys.color.ohos_id_color_text_tertiary'),
          )
      }
      .alignItems(VerticalAlign.Center)
    }
    .id(this.anchorId)
    .type(ButtonType.Capsule)
    .width('100%')
    .height(40)
    .backgroundColor(
      this.enabled
        ? $r('sys.color.ohos_id_color_emphasize')
        : $r('sys.color.ohos_id_color_button_normal'),
    )
    .enabled(this.enabled && !this.loading)
    .onClick(() => this.onAction?.())
  }
}
