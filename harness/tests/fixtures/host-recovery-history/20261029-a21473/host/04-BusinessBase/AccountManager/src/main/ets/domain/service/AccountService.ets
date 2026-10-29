import { AccountConstants } from '../../shared/constant/AccountConstants';
import { LoginState } from '../../data/model/LoginState';
import { UserProfile } from '../../data/model/UserProfile';

type LoginStateCallback = (state: LoginState) => void;

export class AccountService {
  private static instance: AccountService | null = null;
  private readonly listeners: LoginStateCallback[] = [];

  static getInstance(): AccountService {
    if (AccountService.instance === null) {
      AccountService.instance = new AccountService();
      AccountService.instance.initStorage();
    }
    return AccountService.instance;
  }

  private initStorage(): void {
    if (!AppStorage.Has(AccountConstants.STORAGE_IS_LOGGED_IN)) {
      AppStorage.setOrCreate(AccountConstants.STORAGE_IS_LOGGED_IN, false);
    }
    if (!AppStorage.Has(AccountConstants.STORAGE_DISPLAY_ACCOUNT)) {
      AppStorage.setOrCreate(AccountConstants.STORAGE_DISPLAY_ACCOUNT, '');
    }
    if (!AppStorage.Has(AccountConstants.STORAGE_LOGIN_STATE)) {
      AppStorage.setOrCreate(AccountConstants.STORAGE_LOGIN_STATE, LoginState.NOT_LOGGED_IN);
    }
  }

  private notify(state: LoginState): void {
    AppStorage.setOrCreate(AccountConstants.STORAGE_LOGIN_STATE, state);
    this.listeners.forEach((cb: LoginStateCallback) => {
      cb(state);
    });
  }

  async getUserProfile(): Promise<UserProfile> {
    const logged: boolean = AppStorage.get<boolean>(AccountConstants.STORAGE_IS_LOGGED_IN) ?? false;
    const display: string = AppStorage.get<string>(AccountConstants.STORAGE_DISPLAY_ACCOUNT) ?? '';
    return new UserProfile({ isLoggedIn: logged, displayAccount: display, avatar: null });
  }

  async login(): Promise<UserProfile> {
    this.notify(LoginState.LOGGING_IN);
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 400);
    });
    // 模拟阶段：写死登录成功（后续可替换为华为账号 Kit）
    const masked: string = '*****6790@**.com';
    AppStorage.setOrCreate(AccountConstants.STORAGE_IS_LOGGED_IN, true);
    AppStorage.setOrCreate(AccountConstants.STORAGE_DISPLAY_ACCOUNT, masked);
    this.notify(LoginState.LOGGED_IN);
    return new UserProfile({ isLoggedIn: true, displayAccount: masked, avatar: null });
  }

  async logout(): Promise<void> {
    AppStorage.setOrCreate(AccountConstants.STORAGE_IS_LOGGED_IN, false);
    AppStorage.setOrCreate(AccountConstants.STORAGE_DISPLAY_ACCOUNT, '');
    this.notify(LoginState.NOT_LOGGED_IN);
  }

  onLoginStateChanged(callback: LoginStateCallback): void {
    if (this.listeners.indexOf(callback) < 0) {
      this.listeners.push(callback);
    }
  }

  offLoginStateChanged(callback: LoginStateCallback): void {
    const idx: number = this.listeners.indexOf(callback);
    if (idx >= 0) {
      this.listeners.splice(idx, 1);
    }
  }

  /** 真机 visual-diff 冷启动：Want.parameters.mineLoggedIn=true 预置已登录展示态 */
  static applyLaunchPreset(raw: string | undefined): void {
    if (raw === 'logged_in' || raw === 'true') {
      AppStorage.setOrCreate(AccountConstants.STORAGE_IS_LOGGED_IN, true);
      AppStorage.setOrCreate(AccountConstants.STORAGE_DISPLAY_ACCOUNT, '*****6790@**.com');
      AppStorage.setOrCreate(AccountConstants.STORAGE_LOGIN_STATE, LoginState.LOGGED_IN);
    }
  }
}
