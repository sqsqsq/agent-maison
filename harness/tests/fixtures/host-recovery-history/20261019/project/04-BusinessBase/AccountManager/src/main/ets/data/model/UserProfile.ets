export interface UserProfileParams {
  isLoggedIn?: boolean;
  displayAccount?: string;
  avatar?: Resource | null;
  phoneNumber?: string;
}

export class UserProfile {
  isLoggedIn: boolean = false;
  displayAccount: string = '';
  phoneNumber: string = '';
  avatar: Resource | null = null;

  constructor(params?: UserProfileParams) {
    if (params) {
      if (params.isLoggedIn !== undefined) {
        this.isLoggedIn = params.isLoggedIn;
      }
      if (params.displayAccount !== undefined) {
        this.displayAccount = params.displayAccount;
      }
      if (params.phoneNumber !== undefined) {
        this.phoneNumber = params.phoneNumber;
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
