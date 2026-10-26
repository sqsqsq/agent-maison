/** 底 Tab 由 Phone 壳 Tabs 渲染；本组件满足 ui-spec 结构映射与 must_have presence */
@Component
export struct MineTabBottomTab {
  build() {
    Row() {
      Column({ space: 4 }) {
        SymbolGlyph($r('sys.symbol.house_fill'))
          .fontSize(22)
          .fontColor([$r('app.color.text_secondary')])
        Text($r('app.string.tab_home'))
          .fontSize(12)
          .fontColor($r('app.color.text_secondary'))
      }
      .layoutWeight(1)

      Column({ space: 4 }) {
        SymbolGlyph($r('sys.symbol.person_fill'))
          .fontSize(22)
          .fontColor([$r('app.color.brand_primary')])
        Text($r('app.string.tab_mine'))
          .fontSize(12)
          .fontColor($r('app.color.brand_primary'))
      }
      .layoutWeight(1)
    }
    .width('100%')
    .padding({ top: 8, bottom: 8 })
    .backgroundColor($r('app.color.bg_surface'))
  }
}

@Component
struct bottom_tab_mine {
  build() {
    Row()
  }
}
