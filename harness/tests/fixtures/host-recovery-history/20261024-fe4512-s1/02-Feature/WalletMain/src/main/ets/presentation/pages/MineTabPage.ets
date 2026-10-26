import { AccountService, LoginState, UserProfile } from '@aspect/AccountManager';
import { SectionCard, showToast } from '@aspect/CommUI';
import { Context } from '@kit.AbilityKit';
import { FinanceEntry } from '../../data/model/FinanceEntry';
import { SettingEntry } from '../../data/model/SettingEntry';
import { MineRepository } from '../../data/repository/MineRepository';
import { AccountCard } from '../components/AccountCard';
import { AccountConfirmDialog } from '../components/AccountConfirmDialog';

@Component
export struct MineTabPage {
  @State financeList: FinanceEntry[] = [];
  @State settingList: SettingEntry[] = [];
  @State user: UserProfile = new UserProfile();
  private confirmDialogController: CustomDialogController | null = null;
  private readonly mineRepo: MineRepository = new MineRepository();
  private loginListener: ((state: LoginState) => void) | null = null;

  aboutToAppear(): void {
    void this.loadMineData();
    this.loginListener = (_state: LoginState): void => {
      void this.refreshUser();
    };
    AccountService.getInstance().onLoginStateChanged(this.loginListener);
  }

  aboutToDisappear(): void {
    if (this.loginListener !== null) {
      AccountService.getInstance().offLoginStateChanged(this.loginListener);
    }
  }

  private async loadMineData(): Promise<void> {
    this.financeList = await this.mineRepo.getFinanceEntries();
    this.settingList = await this.mineRepo.getSettingEntries();
    this.user = await AccountService.getInstance().getUserProfile();
  }

  private async refreshUser(): Promise<void> {
    this.user = await AccountService.getInstance().getUserProfile();
  }

  private str(res: Resource): string {
    return (this.getUIContext().getHostContext() as Context).resourceManager.getStringSync(res.id);
  }

  private toastNotSupported(): void {
    const ctx = this.getUIContext().getHostContext() as Context;
    showToast(ctx.resourceManager.getStringSync($r('app.string.not_supported').id));
  }

  private openConfirmDialog(title: Resource, message: Resource, onConfirm: () => void): void {
    if (this.confirmDialogController !== null) {
      this.confirmDialogController.close();
    }
    this.confirmDialogController = new CustomDialogController({
      builder: AccountConfirmDialog({
        title,
        message,
        onConfirm,
        onCancel: (): void => {
        }
      }),
      autoCancel: true,
      alignment: DialogAlignment.Center,
      customStyle: true
    });
    this.confirmDialogController.open();
  }

  private showLoginConfirm(): void {
    this.openConfirmDialog(
      $r('app.string.login_confirm_title'),
      $r('app.string.login_confirm_message'),
      (): void => {
        void this.handleLogin();
      }
    );
  }

  private showLogoutConfirm(): void {
    this.openConfirmDialog(
      $r('app.string.logout_confirm_title'),
      $r('app.string.logout_confirm_message'),
      (): void => {
        void this.handleLogout();
      }
    );
  }

  private async handleLogin(): Promise<void> {
    await AccountService.getInstance().login();
    this.user = await AccountService.getInstance().getUserProfile();
  }

  private async handleLogout(): Promise<void> {
    await AccountService.getInstance().logout();
    this.user = await AccountService.getInstance().getUserProfile();
  }

  private financeIconColor(item: FinanceEntry): Resource {
    if (item.id === 'f2') {
      return $r('app.color.brand_bank_orange');
    }
    return $r('app.color.brand_primary');
  }

  @Builder
  private financeRow(item: FinanceEntry) {
    Row() {
      SymbolGlyph(item.icon)
        .fontSize(22)
        .fontColor([this.financeIconColor(item)])
        .margin({ right: 12 })
      Text(item.name)
        .fontSize(16)
        .fontColor($r('app.color.text_primary'))
        .layoutWeight(1)
      if (item.trailing !== undefined) {
        Text(item.trailing)
          .fontSize(16)
          .fontColor($r('app.color.text_primary'))
          .margin({ right: 8 })
      }
      SymbolGlyph($r('sys.symbol.chevron_right'))
        .fontSize(16)
        .fontColor([$r('app.color.text_secondary')])
    }
    .width('100%')
    .height(48)
    .padding({ left: 16, right: 16 })
    .onClick(() => {
      this.toastNotSupported();
    })
  }

  @Builder
  private settingRow(item: SettingEntry) {
    Row() {
      SymbolGlyph(item.icon)
        .fontSize(22)
        .fontColor([$r('app.color.text_secondary')])
        .margin({ right: 12 })
      Text(item.name)
        .fontSize(16)
        .fontColor($r('app.color.text_primary'))
        .layoutWeight(1)
      SymbolGlyph($r('sys.symbol.chevron_right'))
        .fontSize(16)
        .fontColor([$r('app.color.text_secondary')])
    }
    .width('100%')
    .height(48)
    .padding({ left: 16, right: 16 })
    .onClick(() => {
      this.toastNotSupported();
    })
  }

  build() {
    Column() {
      Row() {
        Text($r('app.string.mine_title'))
          .fontSize(20)
          .fontWeight(FontWeight.Bold)
          .fontColor($r('app.color.text_primary'))
          .layoutWeight(1)

        SymbolGlyph($r('sys.symbol.envelope'))
          .fontSize(22)
          .fontColor([$r('app.color.text_primary')])
          .onClick(() => {
            this.toastNotSupported();
          })
      }
      .width('100%')
      .padding({
        left: 16,
        right: 16,
        top: 12,
        bottom: 8
      })

      Scroll() {
        Column({ space: 16 }) {
          AccountCard({
            user: this.user,
            onLoginTap: (): void => {
              this.showLoginConfirm();
            },
            onLogoutTap: (): void => {
              this.showLogoutConfirm();
            }
          })

          Column({ space: 8 }) {
            SectionCard() {
              Column() {
                ForEach(this.financeList, (item: FinanceEntry) => {
                  this.financeRow(item)
                }, (item: FinanceEntry) => item.id)
              }
            }
          }

          Column({ space: 8 }) {
            SectionCard() {
              Column() {
                ForEach(this.settingList, (item: SettingEntry) => {
                  this.settingRow(item)
                }, (item: SettingEntry) => item.id)
              }
            }
          }
        }
        .width('100%')
        .padding({
          left: 16,
          right: 16,
          bottom: 24
        })
      }
      .layoutWeight(1)
      .scrollBar(BarState.Off)
    }
    .width('100%')
    .height('100%')
    .backgroundColor($r('app.color.bg_page'))
  }
}
