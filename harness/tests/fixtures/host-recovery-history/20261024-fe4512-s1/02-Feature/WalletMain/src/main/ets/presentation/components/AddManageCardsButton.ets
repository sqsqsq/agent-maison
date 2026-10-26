@Component
export struct AddManageCardsButton {
  onTap: () => void = () => {
  };

  build() {
    Button($r('app.string.add_manage_cards'), { type: ButtonType.Capsule })
      .fontSize(14)
      .fontColor($r('app.color.brand_primary'))
      .backgroundColor($r('app.color.button_tonal_bg'))
      .width('36%')
      .height(36)
      .onClick(() => {
        this.onTap();
      })
  }
}
