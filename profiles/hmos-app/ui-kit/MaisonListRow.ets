// Maison UI Kit — MaisonListRow（semantic_node: list_row）
// 列表行：leading 图标位 + 主文本（+副标题）+ 尾部 chevron + 分隔线。
// 素材缺失行为：iconSrc 为空时渲染 text_avatar 占位（首字色块，由 fallbackGlyph/fallbackColor
// 传入——generateRolePlaceholder 的确定性调色板），**禁空白 Image**（事故：留了图标位渲染空白）。

@Component
export struct MaisonListRow {
  anchorId: string = '';
  label: ResourceStr = '';
  subtitle: ResourceStr = '';
  iconSrc: ResourceStr = '';
  /** 素材缺失 fallback：首字 + 确定性中性色（asset-integrity placeholderGlyph/paletteFor 产物） */
  fallbackGlyph: string = '';
  fallbackColor: string = '#5B6B7A';
  showChevron: boolean = true;
  showDivider: boolean = true;
  onRowClick?: () => void;

  build() {
    Column() {
      Row() {
        if (this.iconSrc !== '') {
          Image(this.iconSrc)
            .id(`${this.anchorId}-icon`)
            .width(32)
            .height(32)
            .borderRadius(8)
            .objectFit(ImageFit.Contain)
        } else {
          Text(this.fallbackGlyph)
            .id(`${this.anchorId}-icon`)
            .width(32)
            .height(32)
            .borderRadius(8)
            .backgroundColor(this.fallbackColor)
            .fontColor('#FFFFFF')
            .fontSize(18)
            .textAlign(TextAlign.Center)
        }
        Column() {
          Text(this.label)
            .id(`${this.anchorId}-label`)
            .fontSize($r('sys.float.ohos_id_text_size_body1'))
            .fontColor($r('sys.color.ohos_id_color_text_primary'))
          if (this.subtitle !== '') {
            Text(this.subtitle)
              .fontSize($r('sys.float.ohos_id_text_size_body3'))
              .fontColor($r('sys.color.ohos_id_color_text_secondary'))
              .margin({ top: 2 })
          }
        }
        .alignItems(HorizontalAlign.Start)
        .margin({ left: 12 })
        Blank()
        if (this.showChevron) {
          SymbolGlyph($r('sys.symbol.chevron_right'))
            .id(`${this.anchorId}-chevron`)
            .fontSize($r('sys.float.ohos_id_text_size_body2'))
            .fontColor([$r('sys.color.ohos_id_color_tertiary')])
        }
      }
      .width('100%')
      .height(56)
      .padding({ left: 16, right: 16 })
      .alignItems(VerticalAlign.Center)
      .onClick(() => this.onRowClick?.())

      if (this.showDivider) {
        Divider()
          .strokeWidth('1px')
          .color($r('sys.color.ohos_id_color_list_separator'))
          .margin({ left: 60, right: 16 })
      }
    }
    .id(this.anchorId)
    .width('100%')
  }
}
