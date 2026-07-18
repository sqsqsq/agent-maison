// Maison UI Kit — MaisonDetailSection（semantic_node: detail_section）
// 详情页分区：分区标题（+可选 trailing 操作）+ 内容 slot（通常内嵌 MaisonListCard）。

@Component
export struct MaisonDetailSection {
  anchorId: string = '';
  title: ResourceStr = '';
  @BuilderParam trailingSlot?: () => void;
  @BuilderParam contentSlot: () => void;

  build() {
    Column() {
      Row() {
        Text(this.title)
          .id(`${this.anchorId}-title`)
          .fontSize($r('sys.float.ohos_id_text_size_sub_title2'))
          .fontWeight(FontWeight.Medium)
          .fontColor($r('sys.color.ohos_id_color_text_primary'))
        Blank()
        if (this.trailingSlot) {
          this.trailingSlot()
        }
      }
      .width('100%')
      .padding({ left: 16, right: 16, top: 16, bottom: 8 })

      Column() {
        this.contentSlot()
      }
      .id(`${this.anchorId}-content`)
      .width('100%')
    }
    .id(this.anchorId)
    .width('100%')
  }
}
