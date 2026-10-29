/** 首页 mock 开关与布局常量 */
export class HomeConstants {
  /** P1：本设备卡片区是否展示（演示可改为 true） */
  static readonly SHOW_LOCAL_CARD_SECTION: boolean = false;

  /** 有卡态 mock：false=冷启动无卡（AC-1，未添加卡片时的真实默认）；true=仅本地演示用 */
  static readonly SHOW_HAS_CARD_MOCK: boolean = false;

  /** 服务宫格列数，与 contracts 一致 */
  static readonly SERVICE_GRID_COLUMNS: number = 3;
}
