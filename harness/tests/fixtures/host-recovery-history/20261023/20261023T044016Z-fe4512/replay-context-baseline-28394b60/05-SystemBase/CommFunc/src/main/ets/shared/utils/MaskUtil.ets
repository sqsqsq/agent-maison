export class MaskUtil {
  /** 手机号脱敏：保留前 3 后 4 */
  static maskPhone(phone: string): string {
    if (phone.length <= 7) {
      return phone;
    }
    return `${phone.substring(0, 3)}****${phone.substring(phone.length - 4)}`;
  }

  /** 通用账号脱敏展示 */
  static maskAccount(account: string): string {
    if (account.length <= 4) {
      return account;
    }
    return `${account.substring(0, 2)}****${account.substring(account.length - 2)}`;
  }
}
