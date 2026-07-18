// Maison UI Kit — MaisonNavBar（semantic_node: nav_bar）
// blind-visual-hardening d3：盲档可实例化导航栏（返回圆钮 + 标题 + 可选 trailing）。
// 锚点契约：调用方传 anchorId（ui-kit-anchors 生成），本组件 .id() 注入根容器——
// 运行时以锚点定位（自定义组件名可能被 uitree 展开，不作定位依据）。
// 素材缺失行为：返回钮用 SymbolGlyph 系统符号，零位图依赖。

@Component
export struct MaisonNavBar {
  /** 实例语义锚点（必传；ui-kit-anchors buildInstanceAnchor 产物） */
  anchorId: string = '';
  title: ResourceStr = '';
  /** variant: with_back（默认）| title_only | with_trailing */
  showBack: boolean = true;
  onBack?: () => void;
  @BuilderParam trailingSlot?: () => void;

  build() {
    Row() {
      if (this.showBack) {
        Button() {
          SymbolGlyph($r('sys.symbol.chevron_left'))
            .fontSize($r('sys.float.ohos_id_text_size_headline7'))
            .fontColor([$r('sys.color.ohos_id_color_titlebar_text')])
        }
        .id(`${this.anchorId}-back`)
        .type(ButtonType.Circle)
        .backgroundColor($r('sys.color.ohos_id_color_button_normal'))
        .width(40)
        .height(40)
        .onClick(() => this.onBack?.())
      }
      Text(this.title)
        .id(`${this.anchorId}-title`)
        .fontSize($r('sys.float.ohos_id_text_size_headline8'))
        .fontWeight(FontWeight.Bold)
        .fontColor($r('sys.color.ohos_id_color_titlebar_text'))
        .margin({ left: this.showBack ? 12 : 0 })
      Blank()
      if (this.trailingSlot) {
        this.trailingSlot()
      }
    }
    .id(this.anchorId)
    .width('100%')
    .height(56)
    .padding({ left: 16, right: 16 })
    .alignItems(VerticalAlign.Center)
  }
}
