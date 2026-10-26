import { Context } from '@kit.AbilityKit';
import { showToast } from '@aspect/CommUI';
import { PromoInfo } from '../../data/model/PromoInfo';

@Component
export struct PromoSwiper {
  @Prop promos: PromoInfo[] = [];
  @Prop imageFirst: boolean = false;

  private toastNotSupported(): void {
    const ctx = this.getUIContext().getHostContext() as Context;
    showToast(ctx.resourceManager.getStringSync($r('app.string.not_supported').id));
  }

  build() {
    Column({ space: 8 }) {
      Text($r('app.string.more_services'))
        .fontSize(16)
        .fontWeight(FontWeight.Medium)
        .fontColor($r('app.color.text_primary'))
        .width('100%')

      Swiper() {
        ForEach(this.promos, (item: PromoInfo) => {
          if (this.imageFirst) {
            Column({ space: 0 }) {
              Image($r('app.media.promo_marketing_illustration'))
                .width('100%')
                .height(72)
                .objectFit(ImageFit.Cover)
                .borderRadius({ topLeft: 12, topRight: 12 })
              Column({ space: 4 }) {
                Text(item.title)
                  .fontSize(16)
                  .fontWeight(FontWeight.Medium)
                  .fontColor($r('app.color.text_primary'))
                  .maxLines(2)
                  .width('100%')
                Text(item.description)
                  .fontSize(12)
                  .fontColor($r('app.color.text_secondary'))
                  .maxLines(2)
                  .textOverflow({ overflow: TextOverflow.Ellipsis })
                  .width('100%')
              }
              .alignItems(HorizontalAlign.Start)
              .width('100%')
              .padding({ left: 16, right: 16, top: 10, bottom: 12 })
            }
            .width('100%')
            .height(130)
            .backgroundColor($r('app.color.bg_surface'))
            .borderRadius(12)
            .onClick(() => {
              this.toastNotSupported();
            })
          } else {
          Column({ space: 6 }) {
            Column({ space: 4 }) {
              Text(item.title)
                .fontSize(16)
                .fontWeight(FontWeight.Medium)
                .fontColor($r('app.color.text_primary'))
                .maxLines(2)
                .width('100%')
              Text(item.description)
                .fontSize(12)
                .fontColor($r('app.color.text_secondary'))
                .maxLines(2)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
                .width('100%')
            }
            .alignItems(HorizontalAlign.Start)
            .width('100%')
            .padding({ left: 16, right: 16, top: 12 })

            Image($r('app.media.promo_marketing_illustration'))
              .width('100%')
              .height(56)
              .objectFit(ImageFit.Cover)
              .borderRadius({ bottomLeft: 12, bottomRight: 12 })
          }
          .width('100%')
          .height(130)
          .backgroundColor($r('app.color.bg_surface'))
          .borderRadius(12)
          .onClick(() => {
            this.toastNotSupported();
          })
          }
        }, (item: PromoInfo) => item.id)
      }
      .width('100%')
      .height(130)
      .index(0)
      .autoPlay(false)
      .indicator(true)
    }
    .width('100%')
  }
}
