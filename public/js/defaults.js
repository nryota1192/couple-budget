// 初期設定(2026-08 開始)
// 予算は「世帯の総額」ベース(合計200,000円)。折半で一人100,000円で、
// こころさんから預かる monthlyFund(100,000円)がその半分にあたる。
export const START_MONTH = '2026-08';

const cat = (id, name, type, sortOrder, amount) => ({
  id,
  name,
  type,
  sortOrder,
  active: true,
  budgets: [{ from: START_MONTH, amount }],
});

export function defaultSettings() {
  return {
    startMonth: START_MONTH,
    monthlyFund: 100000, // こころさんから預かる金額
    categories: [
      cat('rent', '家賃', 'fixed', 1, 84000),
      cat('electricity', '電気代', 'utility', 2, 10000),
      cat('gas', 'ガス代', 'utility', 3, 4000),
      cat('water', '水道代', 'utility', 4, 6000),
      cat('insurance', '保険', 'fixed', 5, 4000),
      cat('food', '食費', 'variable', 6, 56000),
      cat('education', '教育費', 'variable', 7, 10000),
      cat('appliance', '家電積立', 'savings', 8, 10000),
      cat('household', '日用品', 'variable', 9, 6000),
      cat('shared', '共通費', 'variable', 10, 10000),
    ],
  };
}

// 旧名称で保存済みの世帯を新名称に移行する(ユーザーが独自に付けた名前は変更しない)。
const RENAMES = {
  insurance: ['個人保険(パートナー分)', '保険'],
  food: ['食費(自炊中心)', '食費'],
  education: ['教育費(妊活含む)', '教育費'],
  household: ['日用品(消耗品)', '日用品'],
  shared: ['二人の共通費用', '共通費'],
};

// settings を直接書き換え、変更があれば true を返す
export function migrateSettings(settings) {
  let changed = false;
  for (const c of settings.categories) {
    const rename = RENAMES[c.id];
    if (rename && c.name === rename[0]) {
      c.name = rename[1];
      changed = true;
    }
  }
  return changed;
}

// 項目を見分けるためのアイコン。文字だけだと押し間違えるため
const ICONS = {
  rent: '🏠', electricity: '⚡', gas: '🔥', water: '💧', insurance: '🛡️',
  food: '🍚', education: '📚', appliance: '🔌', household: '🧴', shared: '👫',
};
const TYPE_ICONS = { fixed: '🏠', utility: '💡', variable: '🛒', savings: '💰' };

// 追加された項目でもアイコンが出るよう、種別で代替する
export const iconFor = (category) => ICONS[category.id] ?? TYPE_ICONS[category.type] ?? '•';

export const TYPE_LABELS = {
  fixed: '固定費',
  utility: '光熱費',
  variable: '変動費',
  savings: '積立',
};
