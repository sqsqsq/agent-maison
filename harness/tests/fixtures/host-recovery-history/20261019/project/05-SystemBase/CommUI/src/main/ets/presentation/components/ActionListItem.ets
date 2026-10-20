@Component
export struct ActionListItem {
  @Prop icon: Resource = $r('sys.symbol.chevron_right');
  @Prop title: string = '';
  onTap: () => void = () => {
  };

  build() {
    Row() {
      SymbolGlyph(this.icon)
        .fontSize($r('app.float.comm_icon_size'))
        .fontColor([$r('app.color.comm_primary_blue')])
        .margin({ right: 12 })

      Text(this.title)
        .fontSize(16)
        .fontColor($r('app.color.comm_text_primary'))
        .layoutWeight(1)

      SymbolGlyph($r('sys.symbol.chevron_right'))
        .fontSize(18)
        .fontColor([$r('app.color.comm_text_secondary')])
    }
    .width('100%')
    .height($r('app.float.comm_list_item_height'))
    .padding({ left: 16, right: 16 })
    .onClick(() => {
      this.onTap();
    })
  }
}
