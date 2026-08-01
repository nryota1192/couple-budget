import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  nextMonth,
  prevMonth,
  monthRange,
  effectiveBudget,
  setBudgetFrom,
  computeMonthSummary,
} from '../public/js/logic.js';
import { defaultSettings } from '../public/js/defaults.js';

const exp = (date, categoryId, amount) => ({
  id: `${date}-${categoryId}-${amount}`,
  date,
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
