// Maison UI Kit — MaisonSmsCodeField（semantic_node: sms_code_field）
// 验证码输入行：数字输入框 + 倒计时/重发按钮（状态文本由调用方状态机驱动）。

@Component
export struct MaisonSmsCodeField {
  anchorId: string = '';
  placeholder: ResourceStr = '';
  /** 倒计时文本（如 "55s 后重试" / "重新发送"）——状态机在调用方，本 block 只渲染 */
  countdownText: ResourceStr = '';
  countdownEnabled: boolean = true;
  maxLength: number = 6;
  onCodeChange?: (code: string) => void;
  onSendCode?: () => void;

  build() {
    Row() {
      TextInput({ placeholder: this.placeholder })
        .id(`${this.anchorId}-input`)
        .type(InputType.Number)
        .maxLength(this.maxLength)
        .layoutWeight(1)
        .backgroundColor(Color.Transparent)
        .placeholderColor($r('sys.color.ohos_id_color_text_hint'))
        .onChange((v: string) => this.onCodeChange?.(v))
      Text(this.countdownText)
        .id(`${this.anchorId}-countdown`)
        .fontSize($r('sys.float.ohos_id_text_size_body2'))
        .fontColor(
          this.countdownEnabled
            ? $r('sys.color.ohos_id_color_emphasize')
            : $r('sys.color.ohos_id_color_text_tertiary'),
        )
        .onClick(() => {
          if (this.countdownEnabled) {
            this.onSendCode?.();
          }
        })
    }
    .id(this.anchorId)
    .width('100%')
    .height(48)
    .padding({ left: 16, right: 16 })
    .backgroundColor($r('sys.color.ohos_id_color_card_bg'))
    .borderRadius($r('sys.float.ohos_id_corner_radius_default_l'))
    .alignItems(VerticalAlign.Center)
  }
}
