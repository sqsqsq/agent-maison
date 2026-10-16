import { NavPathContext } from '@aspect/CommFunc';
import {
  buildAddBankCardPage,
  buildAddCardEntryPage,
  buildAllBanksPage,
  buildCardPackPage,
  HomeTabPage,
  MineTabPage
} from '@aspect/WalletMain';

@Entry
@Component
struct Index {
  @State navPathStack: NavPathStack = new NavPathStack();
  @State currentTabIndex: number = 0;

  aboutToAppear(): void {
    NavPathContext.attach(this.navPathStack);
  }

  @Builder
  navDestinationMap(name: string, _param: Object) {
    if (name === 'CardPackPage') {
      buildCardPackPage();
    } else if (name === 'AddCardEntryPage') {
      buildAddCardEntryPage();
    } else if (name === 'AddBankCardPage') {
      buildAddBankCardPage();
    } else if (name === 'AllBanksPage') {
      buildAllBanksPage();
    }
  }

  @Builder
  floatingTabBar() {
    Row() {
      Column({ space: 4 }) {
        SymbolGlyph($r('sys.symbol.house_fill'))
          .fontSize(22)
          .fontColor([this.currentTabIndex === 0 ? $r('app.color.tab_selected') : $r('app.color.tab_unselected')])
        Text($r('app.string.tab_home'))
          .fontSize(12)
          .fontColor(this.currentTabIndex === 0 ? $r('app.color.tab_selected') : $r('app.color.tab_unselected'))
      }
      .layoutWeight(1)
      .onClick(() => {
        this.currentTabIndex = 0;
      })

      Column({ space: 4 }) {
        SymbolGlyph($r('sys.symbol.person_fill'))
          .fontSize(22)
          .fontColor([this.currentTabIndex === 1 ? $r('app.color.tab_selected') : $r('app.color.tab_unselected')])
        Text($r('app.string.tab_mine'))
          .fontSize(12)
          .fontColor(this.currentTabIndex === 1 ? $r('app.color.tab_selected') : $r('app.color.tab_unselected'))
      }
      .layoutWeight(1)
      .onClick(() => {
        this.currentTabIndex = 1;
      })
    }
    .width('92%')
    .padding({ top: 8, bottom: 8 })
    .margin({ left: '4%', right: '4%', bottom: 12 })
    .backgroundColor(Color.White)
    .borderRadius(28)
    .shadow({ radius: 16, color: '#1A000000', offsetY: 4 })
  }

  build() {
    Navigation(this.navPathStack) {
      Stack({ alignContent: Alignment.Bottom }) {
        Column() {
          if (this.currentTabIndex === 0) {
            HomeTabPage({ navPathStack: $navPathStack })
          } else {
            MineTabPage()
          }
        }
        .width('100%')
        .height('100%')
        .padding({ bottom: 72 })

        this.floatingTabBar()
      }
      .width('100%')
      .height('100%')
      .backgroundColor($r('app.color.phone_page_bg'))
    }
    .hideTitleBar(true)
    .mode(NavigationMode.Stack)
    .navDestination(this.navDestinationMap)
  }
}
