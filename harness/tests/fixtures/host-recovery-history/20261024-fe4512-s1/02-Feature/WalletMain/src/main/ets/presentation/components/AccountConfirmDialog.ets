@CustomDialog
export struct AccountConfirmDialog {
  controller?: CustomDialogController;
  title: Resource = $r('app.string.login_confirm_title');
  message: Resource = $r('app.string.login_confirm_message');
  onConfirm: () => void = () => {
  };
  onCancel: () => void = () => {
  };

  build() {
    Column({ space: 16 }) {
      Text(this.title)
        .fontSize(18)
        .fontWeight(FontWeight.Medium)
        .fontColor($r('app.color.text_primary'))
        .width('100%')
      Text(this.message)
        .fontSize(14)
        .fontColor($r('app.color.text_secondary'))
        .width('100%')
      Row({ space: 12 }) {
        Button($r('app.string.dialog_cancel'), { type: ButtonType.Capsule })
          .fontSize(14)
          .fontColor($r('app.color.text_primary'))
          .backgroundColor($r('app.color.button_tonal_bg'))
          .layoutWeight(1)
          .onClick(() => {
            this.controller?.close();
            this.onCancel();
          })
        Button($r('app.string.dialog_confirm'), { type: ButtonType.Capsule })
          .fontSize(14)
          .fontColor(Color.White)
          .backgroundColor($r('app.color.brand_primary'))
          .layoutWeight(1)
          .onClick(() => {
            this.controller?.close();
            this.onConfirm();
          })
      }
      .width('100%')
    }
    .width('86%')
    .padding(24)
    .backgroundColor($r('app.color.bg_surface'))
    .borderRadius(16)
  }
}
