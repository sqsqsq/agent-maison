import { BankInfo } from '../../data/model/BankInfo';

/**
 * 银行行（logo + 名称 + 可选营销角标 + 右箭头），收起态 / 展开态 / 全部银行页三屏共用。
 * element id 由 idPrefix 与 bank.code 拼装：<idPrefix>_row_<code> / _logo_ / _name_ / _chevron_ / _badge_。
 * logo 资源缺失时该行仍可见可点击，仅图位为空（BD-5）。
 */
@Component
export struct BankListRow {
  @Prop bank: BankInfo;
  @Prop idPrefix: string = 'col';
  @Prop showDivider: boolean = false;
  /** 整行点击上抛；宿主页面负责提示/跳转等 UI 副作用 */
  onTap: (bank: BankInfo) => void = (bank: BankInfo): void => {};

  build() {
    Column() {
      Row() {
        Image(this.bank.logo)
          .width($r('app.float.bank_space_logo_size'))
          .height($r('app.float.bank_space_logo_size'))
          .objectFit(ImageFit.Contain)
          .margin({ right: 12 })
          .id(`${this.idPrefix}_logo_${this.bank.code}`)

        Column() {
          Text(this.bank.name)
            .fontSize($r('app.float.bank_font_row_title'))
            .fontColor($r('app.color.color_text_primary'))
            .textAlign(TextAlign.Start)
            .id(`${this.idPrefix}_name_${this.bank.code}`)

          if (this.bank.badgeRes !== undefined) {
            Text(this.bank.badgeRes)
              .fontSize($r('app.float.bank_font_badge'))
              .fontColor($r('app.color.color_badge_border'))
              .backgroundColor($r('app.color.color_badge_bg'))
              .borderWidth(1)
              .borderColor($r('app.color.color_badge_border'))
              .borderRadius(4)
              .padding({
                left: 4,
                right: 4,
                top: 1,
                bottom: 1
              })
              .margin({ top: 2 })
              .id(`${this.idPrefix}_badge_${this.bank.code}`)
          }
        }
        .alignItems(HorizontalAlign.Start)
        .layoutWeight(1)

        SymbolGlyph($r('sys.symbol.chevron_right'))
          .fontSize(16)
          .fontColor([$r('app.color.color_icon_chevron')])
          .id(`${this.idPrefix}_chevron_${this.bank.code}`)
      }
      .width('100%')
      .height($r('app.float.bank_space_row_height'))
      .alignItems(VerticalAlign.Center)
      .padding({
        left: $r('app.float.bank_space_row_inner_padding'),
        right: $r('app.float.bank_space_row_inner_padding')
      })
      .id(`${this.idPrefix}_row_${this.bank.code}`)
      .onClick(() => {
        this.onTap(this.bank);
      })

      if (this.showDivider) {
        Divider()
          .color($r('app.color.color_line_divider'))
          .strokeWidth(0.5)
          .margin({
            left: $r('app.float.bank_space_divider_inset'),
            right: $r('app.float.bank_space_row_inner_padding')
          })
      }
    }
    .width('100%')
  }
}
