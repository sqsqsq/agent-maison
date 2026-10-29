/**
 * 银行卡开卡（添加银行卡 / 全部银行）常量。
 * 只承载资源键无法承载的东西：路由名、数值上限、时间窗口，以及可见行数算术要用的几何数值
 * （$r('app.float.*') 不能直接参与同步算术，故与 float.json 同值镜像）。
 */
export class BankConstants {
  /** 添加银行卡页面路由名（与 Phone 根页 navDestinationMap / route_map.json 一致） */
  static readonly ROUTE_ADD_BANK_CARD: string = 'AddBankCardPage';

  /** 全部银行页面路由名 */
  static readonly ROUTE_ALL_BANKS: string = 'AllBanksPage';

  /** 收起态药丸内最多展示的剩余银行小图标数 */
  static readonly MAX_PILL_ICONS: number = 5;

  /** 跳转防重入窗口（ms，BD-3 / ENV-02） */
  static readonly NAV_DEBOUNCE_MS: number = 500;

  /** 提示节流窗口（ms，BD-3） */
  static readonly TOAST_THROTTLE_MS: number = 500;

  /** 银行行高（vp），与 float.json 的 bank_space_row_height 同值 */
  static readonly ROW_HEIGHT_VP: number = 56;

  /**
   * 药丸整块占位高（vp）= 上留白 24 + 药丸 32 + 下留白 12，与 float.json 的
   * bank_space_pill_block_height 同值；参考图 1-a 实测 206px ÷ 3.0 px/vp ≈ 68vp
   */
  static readonly PILL_BLOCK_HEIGHT_VP: number = 68;

  /**
   * 收起态白卡下沿到容器下沿的预留（vp）。参考图 1-a 实测 194px ÷ 3.0 px/vp ≈ 65vp：
   * 白卡不占满剩余屏高，这段留白必须参与可见行数的减法，否则会多渲染一行（AC-2 要求 7 行）
   */
  static readonly CARD_BOTTOM_RESERVE_VP: number = 65;

  /** 日志 tag */
  static readonly LOG_TAG: string = 'BankOpenCard';
}
