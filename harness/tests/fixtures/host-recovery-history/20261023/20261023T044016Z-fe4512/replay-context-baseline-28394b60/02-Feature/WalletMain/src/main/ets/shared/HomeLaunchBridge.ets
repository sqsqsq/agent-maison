import { HomeCardDisplayMode } from '../data/model/HomeCardState';
import { HomeRepository } from '../data/repository/HomeRepository';

/** 真机 visual-diff 冷启动参数：Want.parameters.homeCardMode=no_card|with_card */
export function applyLaunchHomeCardMode(raw: string | undefined): void {
  if (raw === HomeCardDisplayMode.WITH_CARD || raw === 'with_card') {
    HomeRepository.setLaunchCardModeOverride(HomeCardDisplayMode.WITH_CARD);
    return;
  }
  if (raw === HomeCardDisplayMode.NO_CARD || raw === 'no_card') {
    HomeRepository.setLaunchCardModeOverride(HomeCardDisplayMode.NO_CARD);
    return;
  }
  HomeRepository.setLaunchCardModeOverride(null);
}
