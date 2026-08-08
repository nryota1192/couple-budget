import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  nextMonth,
  prevMonth,
  monthRange,
  effectiveBudget,
  expenseMonth,
  setBudgetFrom,
  setBudgetForMonth,
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
const catOf = (s, id) => s.categories.find((c) => c.id === id);

test('月ユーティリティ: 年跨ぎを含む前後の月', () => {
  assert.equal(nextMonth('2026-08'), '2026-09');
  assert.equal(nextMonth('2026-12'), '2027-01');
  assert.equal(prevMonth('2027-01'), '2026-12');
  assert.deepEqual(monthRange('2026-11', '2027-02'), [
    '2026-11', '2026-12', '2027-01', '2027-02',
  ]);
});

test('初期予算: 世帯総額200,000円で、折半の一人分が預かり金と一致する', () => {
  const s = defaultSettings();
  const total = s.categories.reduce((sum, c) => sum + effectiveBudget(c, '2026-08'), 0);
  assert.equal(total, 200000);
  assert.equal(total / 2, s.monthlyFund); // 折半100,000円 = こころさんから預かる額
});

test('食費(56,000円): 8月に50,000円使うと9月の使える額は62,000円', () => {
  const s = defaultSettings();
  const expenses = [exp('2026-08-15', 'food', 50000)];
  const aug = rowOf(computeMonthSummary(s, expenses, '2026-08'), 'food');
  assert.equal(aug.available, 56000);
  assert.equal(aug.spent, 50000);
  assert.equal(aug.remaining, 6000);
  const sep = rowOf(computeMonthSummary(s, expenses, '2026-09'), 'food');
  assert.equal(sep.carryIn, 6000);
  assert.equal(sep.available, 62000);
});

test('使いすぎはマイナス繰越として翌月に引き継ぐ', () => {
  const s = defaultSettings();
  const expenses = [exp('2026-08-20', 'household', 8000)]; // 予算6,000
  const aug = rowOf(computeMonthSummary(s, expenses, '2026-08'), 'household');
  assert.equal(aug.remaining, -2000);
  const sep = rowOf(computeMonthSummary(s, expenses, '2026-09'), 'household');
  assert.equal(sep.carryIn, -2000);
  assert.equal(sep.available, 4000);
});

test('固定費(家賃84,000円)は自動で全額消化され繰越は常に0', () => {
  const s = defaultSettings();
  for (const m of ['2026-08', '2026-12', '2027-03']) {
    const row = rowOf(computeMonthSummary(s, [], m), 'rent');
    assert.equal(row.spent, 84000);
    assert.equal(row.carryIn, 0);
    assert.equal(row.remaining, 0);
  }
});

test('光熱費: 実額入力で余りが繰越され、未入力はentryCount=0', () => {
  const s = defaultSettings();
  const expenses = [exp('2026-08-25', 'electricity', 8400)]; // 予算10,000
  const aug = computeMonthSummary(s, expenses, '2026-08');
  assert.equal(rowOf(aug, 'electricity').remaining, 1600);
  assert.equal(rowOf(aug, 'electricity').entryCount, 1);
  assert.equal(rowOf(aug, 'gas').entryCount, 0); // 未入力バッジ用
  const sep = rowOf(computeMonthSummary(s, expenses, '2026-09'), 'electricity');
  assert.equal(sep.available, 11600);
});

test('家電積立(10,000円/月): 3ヶ月積み上がり、購入すると残高が減る', () => {
  const s = defaultSettings();
  const oct = rowOf(computeMonthSummary(s, [], '2026-10'), 'appliance');
  assert.equal(oct.available, 30000); // 10,000×3ヶ月
  const expenses = [exp('2026-11-03', 'appliance', 25000)];
  const nov = computeMonthSummary(s, expenses, '2026-11');
  assert.equal(rowOf(nov, 'appliance').remaining, 15000); // 40,000 - 25,000
  assert.equal(nov.totals.savingsBalance, 15000);
});

test('予算変更(ずっと)は指定月以降のみ適用され、過去の繰越計算は変わらない', () => {
  const s = defaultSettings();
  const food = catOf(s, 'food');
  food.budgets = setBudgetFrom(food, '2026-10', 60000);
  assert.equal(effectiveBudget(food, '2026-09'), 56000);
  assert.equal(effectiveBudget(food, '2026-10'), 60000);
  const expenses = [exp('2026-08-15', 'food', 50000)];
  const oct = rowOf(computeMonthSummary(s, expenses, '2026-10'), 'food');
  // 8月残り6,000 + 9月まるごと56,000 + 10月予算60,000
  assert.equal(oct.available, 6000 + 56000 + 60000);
});

test('今月だけの予算変更: その月だけ増え、翌月は自動で元に戻る', () => {
  const s = defaultSettings();
  const shared = catOf(s, 'shared'); // 共通費10,000円
  shared.budgets = setBudgetForMonth(shared, '2026-08', 20000); // 今月だけ+10,000
  assert.equal(effectiveBudget(shared, '2026-08'), 20000);
  assert.equal(effectiveBudget(shared, '2026-09'), 10000);
  assert.equal(effectiveBudget(shared, '2026-10'), 10000);
  // 増額した月に15,000円使っても5,000円余り、翌月は通常予算+繰越になる
  const expenses = [exp('2026-08-20', 'shared', 15000)];
  assert.equal(rowOf(computeMonthSummary(s, expenses, '2026-08'), 'shared').remaining, 5000);
  assert.equal(rowOf(computeMonthSummary(s, expenses, '2026-09'), 'shared').available, 15000);
});

test('今月だけの変更は、すでに予定されている将来の予算額に正しく戻す', () => {
  const s = defaultSettings();
  const edu = catOf(s, 'education'); // 10,000円
  edu.budgets = setBudgetForMonth(edu, '2026-09', 18000); // 9月だけ増額
  assert.equal(effectiveBudget(edu, '2026-08'), 10000);
  assert.equal(effectiveBudget(edu, '2026-09'), 18000);
  assert.equal(effectiveBudget(edu, '2026-10'), 10000);
  // そのあと「ずっと」の変更をすると一時変更は上書きされる
  edu.budgets = setBudgetFrom(edu, '2026-09', 12000);
  assert.equal(effectiveBudget(edu, '2026-09'), 12000);
  assert.equal(effectiveBudget(edu, '2026-10'), 12000);
});

test('計上月: 9月に払った8月分の電気代は8月の予算から引かれる', () => {
  const s = defaultSettings();
  const bill = exp('2026-09-10', 'electricity', 8400, '2026-08');
  assert.equal(expenseMonth(bill), '2026-08');

  const aug = rowOf(computeMonthSummary(s, [bill], '2026-08'), 'electricity');
  assert.equal(aug.spent, 8400);
  assert.equal(aug.remaining, 1600);
  assert.equal(aug.entryCount, 1);

  // 9月には計上されず、8月の余り1,600円が繰り越される
  const sep = rowOf(computeMonthSummary(s, [bill], '2026-09'), 'electricity');
  assert.equal(sep.spent, 0);
  assert.equal(sep.carryIn, 1600);
  assert.equal(sep.available, 11600);
});

test('計上月: month がなければ date の月に計上される(既存データ互換)', () => {
  const s = defaultSettings();
  const old = exp('2026-08-15', 'food', 3000);
  assert.equal(expenseMonth(old), '2026-08');
  assert.equal(rowOf(computeMonthSummary(s, [old], '2026-08'), 'food').spent, 3000);
});

test('計上月: 数ヶ月前に遡って入力できる', () => {
  const s = defaultSettings();
  const bill = exp('2026-11-05', 'water', 15000, '2026-08'); // 3ヶ月前の水道代(予算6,000)
  const aug = rowOf(computeMonthSummary(s, [bill], '2026-08'), 'water');
  assert.equal(aug.spent, 15000);
  assert.equal(aug.remaining, -9000);
  // 遡って入力した超過分は、それ以降の月の使える額に正しく反映される
  assert.equal(rowOf(computeMonthSummary(s, [bill], '2026-09'), 'water').available, -3000);
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
  const food = catOf(s, 'food');
  const insurance = catOf(s, 'insurance');
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
  assert.equal(totals.budget, 200000);
  // 固定費88,000(家賃84,000+保険4,000) + 食費20,000 + 電気4,000
  assert.equal(totals.spent, 88000 + 24000);
  // 光熱費: 電気6,000 + ガス4,000 + 水道6,000 / 変動費: 食費36,000 + 教育10,000 + 日用品6,000 + 共通10,000
  assert.equal(totals.spendableRemaining, 16000 + 62000);
  assert.equal(totals.savingsBalance, 10000);
});
