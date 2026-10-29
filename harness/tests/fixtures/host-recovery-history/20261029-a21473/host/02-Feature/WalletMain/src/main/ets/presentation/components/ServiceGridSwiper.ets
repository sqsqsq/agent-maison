import { Context } from '@kit.AbilityKit';
import { showToast } from '@aspect/CommUI';
import { ServiceEntry } from '../../data/model/ServiceEntry';

@Component
export struct ServiceGridSwiper {
  @Prop services: ServiceEntry[] = [];

  private iconColorFor(item: ServiceEntry): Resource {
    if (item.id === 's2') {
      return $r('app.color.brand_bank_pink');
    }
    if (item.id === 's3') {
      return $r('app.color.brand_fuel_green');
    }
    return $r('app.color.brand_primary');
  }

  private toastNotSupported(): void {
    const ctx = this.getUIContext().getHostContext() as Context;
    showToast(ctx.resourceManager.getStringSync($r('app.string.not_supported').id));
  }

  @Builder
  private huaweiCardIcon(): void {
    Column({ space: 1 }) {
      Text('Huawei')
        .fontSize(7)
        .fontColor(Color.White)
        .fontWeight(FontWeight.Medium)
        .maxLines(1)
      Text('Card')
        .fontSize(7)
        .fontColor(Color.White)
        .fontWeight(FontWeight.Medium)
        .maxLines(1)
    }
    .width(40)
    .height(28)
    .backgroundColor('#222222')
    .borderRadius(5)
    .justifyContent(FlexAlign.Center)
    .alignItems(HorizontalAlign.Center)
  }

  build() {
    Column() {
      Row() {
        ForEach(this.services, (item: ServiceEntry) => {
          Column({ space: 4 }) {
            if (item.id === 's1') {
              this.huaweiCardIcon()
            } else {
              SymbolGlyph(item.icon)
                .fontSize(28)
                .fontColor([this.iconColorFor(item)])
            }
            Text(item.name)
              .fontSize(11)
              .fontColor($r('app.color.text_secondary'))
              .textAlign(TextAlign.Center)
              .width('100%')
              .maxLines(2)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
          }
          .layoutWeight(1)
          .alignItems(HorizontalAlign.Center)
          .padding({ left: 4, right: 4, top: 8, bottom: 4 })
          .justifyContent(FlexAlign.Center)
          .clip(false)
          .onClick(() => {
            this.toastNotSupported();
          })
        }, (item: ServiceEntry) => item.id)
      }
      .width('100%')
      .height(92)
      .justifyContent(FlexAlign.SpaceEvenly)
      .alignItems(VerticalAlign.Center)
      .clip(false)

      Row() {
        Blank().width(8).height(4).backgroundColor($r('app.color.brand_primary')).borderRadius(2)
      }
      .width('100%')
      .height(12)
      .justifyContent(FlexAlign.Center)
    }
    .width('100%')
    .padding({ left: 12, right: 12, top: 6, bottom: 6 })
    .backgroundColor($r('app.color.bg_surface'))
    .borderRadius(12)
  }
}
