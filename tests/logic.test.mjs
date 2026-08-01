import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  nextMonth,
  prevMonth,
  monthRange,
  effectiveBudget,
  expenseMonth,
  setBudgetFrom,
  computeMonthSummary,
  validateBackup,
} from '../public/js/logic.js';
import { defaultSettings, migrateSettings } from '../public/js/defaults.js';

// month を渡すと計上月を明示指定(省略時は date の月に計上)
const exp = (date, categoryId, amount, month) => ({
  id: `${date}-${categoryId}-${amount}`,
  date,
  ...(month ? { month } : {}),
  categoryId,
  amount,
  memo: '',
  createdAt: 0,
});

const rowOf = (summary, id) => summary.rows.find((r) => r.category.id === id);

test('月ユーティリティ: 年跨ぎを含む前後の月', () => {
  assert.equal(nextMonth('2026-08'), '2026-09');
  assert.equal(nextMonth('2026-12'), '2027-01');
  assert.equal(prevMonth('2027-01'), '2026-12');
  assert.deepEqual(monthRange('2026-11', '2027-02'), [
    '2026-11', '2026-12', '2027-01', '2027-02',
  ]);
});

test('初期予算の合計は100,000円', () => {
  const s = defaultSettings();
  const total = s.categories.reduce((sum, c) => sum + effectiveBudget(c, '2026-08'), 0);
  assert.equal(total, 100000);
});

test('食費: 8月に26,000円使うと9月の使える額は30,000円', () => {
  const s = defaultSettings();
  const expenses = [exp('2026-08-15', 'food', 26000)];
  const aug = rowOf(computeMonthSummary(s, expenses, '2026-08'), 'food');
  assert.equal(aug.available, 28000);
  assert.equal(aug.spent, 26000);
  assert.equal(aug.remaining, 2000);
  const sep = rowOf(computeMonthSummary(s, expenses, '2026-09'), 'food');
  assert.equal(sep.carryIn, 2000);
  assert.equal(sep.available, 30000);
});

test('使いすぎはマイナス繰越として翌月に引き継ぐ', () => {
  const s = defaultSettings();
  const expenses = [exp('2026-08-20', 'household', 4000)]; // 予算3,000
  const aug = rowOf(computeMonthSummary(s, expenses, '2026-08'), 'household');
  assert.equal(aug.remaining, -1000);
  const sep = rowOf(computeMonthSummary(s, expenses, '2026-09'), 'household');
  assert.equal(sep.carryIn, -1000);
  assert.equal(sep.available, 2000);
});

test('固定費(家賃)は自動で全額消化され繰越は常に0', () => {
  const s = defaultSettings();
  for (const m of ['2026-08', '2026-12', '2027-03']) {
    const row = rowOf(computeMonthSummary(s, [], m), 'rent');
    assert.equal(row.spent, 42000);
    assert.equal(row.carryIn, 0);
    assert.equal(row.remaining, 0);
  }
});

test('光熱費: 実額入力で余りが繰越され、未入力はentryCount=0', () => {
  const s = defaultSettings();
  const expenses = [exp('2026-08-25', 'electricity', 4200)];
  const aug = computeMonthSummary(s, expenses, '2026-08');
  assert.equal(rowOf(aug, 'electricity').remaining, 800);
  assert.equal(rowOf(aug, 'electricity').entryCount, 1);
  assert.equal(rowOf(aug, 'gas').entryCount, 0); // 未入力バッジ用
  const sep = rowOf(computeMonthSummary(s, expenses, '2026-09'), 'electricity');
  assert.equal(sep.available, 5800);
});

test('家電積立: 3ヶ月積み上がり、購入すると残高が減る', () => {
  const s = defaultSettings();
  const oct = rowOf(computeMonthSummary(s, [], '2026-10'), 'appliance');
  assert.equal(oct.available, 15000); // 5,000×3ヶ月
  const expenses = [exp('2026-11-03', 'appliance', 12000)];
  const nov = computeMonthSummary(s, expenses, '2026-11');
  assert.equal(rowOf(nov, 'appliance').remaining, 8000); // 20,000 - 12,000
  assert.equal(nov.totals.savingsBalance, 8000);
});

test('予算変更は指定月以降のみ適用され、過去の繰越計算は変わらない', () => {
  const s = defaultSettings();
  const food = s.categories.find((c) => c.id === 'food');
  food.budgets = setBudgetFrom(food, '2026-10', 30000);
  assert.equal(effectiveBudget(food, '2026-09'), 28000);
  assert.equal(effectiveBudget(food, '2026-10'), 30000);
  const expenses = [exp('2026-08-15', 'food', 26000)];
  const oct = rowOf(computeMonthSummary(s, expenses, '2026-10'), 'food');
  // 8月残り2,000 + 9月まるごと28,000 + 10月予算30,000
  assert.equal(oct.available, 2000 + 28000 + 30000);
});

test('計上月: 9月に払った8月分の電気代は8月の予算から引かれる', () => {
  const s = defaultSettings();
  const bill = exp('2026-09-10', 'electricity', 4200, '2026-08');
  assert.equal(expenseMonth(bill), '2026-08');

  const aug = rowOf(computeMonthSummary(s, [bill], '2026-08'), 'electricity');
  assert.equal(aug.spent, 4200);
  assert.equal(aug.remaining, 800);
  assert.equal(aug.entryCount, 1);

  // 9月には計上されず、8月の余り800円が繰り越される
  const sep = rowOf(computeMonthSummary(s, [bill], '2026-09'), 'electricity');
  assert.equal(sep.spent, 0);
  assert.equal(sep.carryIn, 800);
  assert.equal(sep.available, 5800);
});

test('計上月: month がなければ date の月に計上される(既存データ互換)', () => {
  const s = defaultSettings();
  const old = exp('2026-08-15', 'food', 3000);
  assert.equal(expenseMonth(old), '2026-08');
  assert.equal(rowOf(computeMonthSummary(s, [old], '2026-08'), 'food').spent, 3000);
});

test('計上月: 数ヶ月前に遡って入力できる', () => {
  const s = defaultSettings();
  const bill = exp('2026-11-05', 'water', 6000, '2026-08'); // 3ヶ月前の水道代(予算3,000)
  const aug = rowOf(computeMonthSummary(s, [bill], '2026-08'), 'water');
  assert.equal(aug.spent, 6000);
  assert.equal(aug.remaining, -3000);
  // 遡って入力した超過分は、それ以降の月の使える額に正しく反映される
  assert.equal(rowOf(computeMonthSummary(s, [bill], '2026-09'), 'water').available, 0);
  assert.equal(rowOf(computeMonthSummary(s, [bill], '2026-10'), 'water').available, 3000);
});

test('項目名: 短い名称になっている', () => {
  const names = defaultSettings().categories.map((c) => c.name);
  assert.deepEqual(names, [
    '家賃', '電気代', 'ガス代', '水道代', '保険',
    '食費', '教育費', '家電積立', '日用品', '共通費',
  ]);
});

test('移行: 旧名称は新名称に変わり、独自の名前は保持される', () => {
  const s = defaultSettings();
  const food = s.categories.find((c) => c.id === 'food');
  const insurance = s.categories.find((c) => c.id === 'insurance');
  food.name = '食費(自炊中心)';
  insurance.name = 'こころさんの保険'; // 独自に付けた名前

  assert.equal(migrateSettings(s), true);
  assert.equal(food.name, '食費');
  assert.equal(insurance.name, 'こころさんの保険');
  // 2回目は変更なし(保存ループを防ぐ)
  assert.equal(migrateSettings(s), false);
});

test('復元: 正しいバックアップは受け入れられる', () => {
  const backup = { settings: defaultSettings(), expenses: [exp('2026-08-10', 'food', 3000)] };
  const r = validateBackup(backup);
  assert.equal(r.ok, true);
  assert.equal(r.data.expenses.length, 1);
  // 支出0件でも正常(使い始めのバックアップ)
  assert.equal(validateBackup({ settings: defaultSettings(), expenses: [] }).ok, true);
});

test('復元: 壊れたファイルは理由付きで拒否される', () => {
  const cases = [
    [null, 'バックアップファイルの形式ではありません'],
    ['{}', 'バックアップファイルの形式ではありません'],
    [{ expenses: [] }, '設定情報が見つかりません'],
    [{ settings: { categories: [] }, expenses: [] }, '開始月が見つかりません'],
    [{ settings: { startMonth: '2026-08', categories: [] }, expenses: [] }, '項目の情報が見つかりません'],
    [{ settings: defaultSettings() }, '支出の情報が見つかりません'],
  ];
  for (const [input, error] of cases) {
    const r = validateBackup(input);
    assert.equal(r.ok, false);
    assert.equal(r.error, error);
  }
});

test('復元: 金額や日付が壊れた支出、未知の項目は拒否される', () => {
  const s = defaultSettings();
  const bad = (e) => validateBackup({ settings: s, expenses: [e] });
  assert.equal(bad({ id: 'x', date: '2026-08-01', categoryId: 'food', amount: 'ABC' }).ok, false);
  assert.equal(bad({ id: 'x', date: '8/1', categoryId: 'food', amount: 100 }).ok, false);
  assert.equal(bad({ date: '2026-08-01', categoryId: 'food', amount: 100 }).ok, false); // id無し
  const unknown = bad({ id: 'x', date: '2026-08-01', categoryId: 'ゴルフ', amount: 100 });
  assert.equal(unknown.ok, false);
  assert.match(unknown.error, /ゴルフ/);
});

test('合計: 残り合計は光熱費+変動費のみ、固定費・積立は含まない', () => {
  const s = defaultSettings();
  const expenses = [
    exp('2026-08-10', 'food', 20000),
    exp('2026-08-25', 'electricity', 4000),
  ];
  const { totals } = computeMonthSummary(s, expenses, '2026-08');
  assert.equal(totals.budget, 100000);
  // 固定費44,000 + 食費20,000 + 電気4,000
  assert.equal(totals.spent, 44000 + 24000);
  // 光熱費: 電気1,000 + ガス2,000 + 水道3,000 / 変動費: 食費8,000 + 教育5,000 + 日用品3,000 + 共通5,000
  assert.equal(totals.spendableRemaining, 6000 + 21000);
  assert.equal(totals.savingsBalance, 5000);
});
