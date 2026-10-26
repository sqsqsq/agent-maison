import homePageUtTest from './home_page_ut.test';
import bankOpenCardUtTest from './bank_open_card_ut.test';
import bankListLegacyUtTest from './bank_list_legacy_ut.test';

export default function testsuite() {
  homePageUtTest();
  bankOpenCardUtTest();
  bankListLegacyUtTest();
}
