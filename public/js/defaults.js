// 初期設定(2026-08 開始・合計100,000円)
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
      cat('rent', '家賃', 'fixed', 1, 42000),
      cat('electricity', '電気代', 'utility', 2, 5000),
      cat('gas', 'ガス代', 'utility', 3, 2000),
      cat('water', '水道代', 'utility', 4, 3000),
      cat('insurance', '個人保険(パートナー分)', 'fixed', 5, 2000),
      cat('food', '食費(自炊中心)', 'variable', 6, 28000),
      cat('education', '教育費(妊活含む)', 'variable', 7, 5000),
      cat('appliance', '家電積立', 'savings', 8, 5000),
      cat('household', '日用品(消耗品)', 'variable', 9, 3000),
      cat('shared', '二人の共通費用', 'variable', 10, 5000),
    ],
  };
}

export const TYPE_LABELS = {
  fixed: '固定費',
  utility: '光熱費',
  variable: '変動費',
  savings: '積立',
};
