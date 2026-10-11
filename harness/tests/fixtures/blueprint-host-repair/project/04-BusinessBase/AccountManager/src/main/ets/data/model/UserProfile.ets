export interface UserProfileParams {
  isLoggedIn?: boolean;
  displayAccount?: string;
  avatar?: Resource | null;
}

export class UserProfile {
  isLoggedIn: boolean = false;
  displayAccount: string = '';
  avatar: Resource | null = null;

  constructor(params?: UserProfileParams) {
    if (params) {
      if (params.isLoggedIn !== undefined) {
        this.isLoggedIn = params.isLoggedIn;
      }
      if (params.displayAccount !== undefined) {
        this.displayAccount = params.displayAccount;
      }
      if (params.avatar !== undefined) {
        this.avatar = params.avatar;
      }
    }
  }

  get accountText(): string {
    return this.isLoggedIn ? this.displayAccount : '未登录';
  }
}
