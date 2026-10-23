export interface UserProfileParams {
  mockPhone?: string;
  isLoggedIn?: boolean;
  displayAccount?: string;
  avatar?: Resource | null;
}

export class UserProfile {
  mockPhone: string = '18500003841';
  isLoggedIn: boolean = false;
  displayAccount: string = '';
  avatar: Resource | null = null;

  constructor(params?: UserProfileParams) {
    if (params) {
      if (params.mockPhone !== undefined) {
        this.mockPhone = params.mockPhone;
      }
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
