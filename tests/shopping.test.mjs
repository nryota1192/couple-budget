import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  shoppingCategories,
  groupShoppingItems,
  shoppingMemo,
  computeMonthSummary,
} from '../public/js/logic.js';
import { defaultSettings } from '../public/js/defaults.js';

const item = (id, name, categoryId, { checked = false, createdAt = 0, by = '' } = {}) =>
  ({ id, name, categoryId, checked, createdAt, by, checkedAt: checked ? createdAt : null });

test('選べる項目: 店で買う項目だけ(固定費・光熱費は出さない)', () => {
  const ids = shoppingCategories(defaultSettings().categories).map((c) => c.id);
  assert.deepEqual(ids, ['food', 'education', 'appliance', 'household', 'shared']);
  for (const excluded of ['rent', 'insurance', 'electricity', 'gas', 'water']) {
    assert.ok(!ids.includes(excluded), `${excluded} は買い物リストに出さない`);
  }
});

test('選べる項目: 無効化した項目は出さず、途中で追加した積立は出す', () => {
  const s = defaultSettings();
  s.categories.find((c) => c.id === 'education').active = false;
  s.categories.push({ id: 'moving', name: '引っ越し準備金', type: 'savings',
    sortOrder: 11, active: true, budgets: [{ from: '2026-09', amount: 20000 }] });
  const ids = shoppingCategories(s.categories).map((c) => c.id);
  assert.ok(!ids.includes('education'));
  assert.equal(ids.at(-1), 'moving');
});

test('並べ方: 項目の並び順でまとまり、未チェックが上・チェック済みが下(それぞれ追加順)', () => {
  const s = defaultSettings();
  const groups = groupShoppingItems([
    item('a', '洗剤', 'household', { createdAt: 5 }),
    item('b', '卵', 'food', { createdAt: 3, checked: true }),
    item('c', '牛乳', 'food', { createdAt: 4 }),
    item('d', 'パン', 'food', { createdAt: 1, checked: true }),
    item('e', 'ねぎ', 'food', { createdAt: 2 }),
  ], s.categories);

  assert.deepEqual(groups.map((g) => g.category.id), ['food', 'household']); // 食費が日用品より先
  assert.deepEqual(groups[0].items.map((i) => i.name), ['ねぎ', '牛乳', 'パン', '卵']);
  assert.deepEqual(groups[1].items.map((i) => i.name), ['洗剤']);
});

test('並べ方: 品目の無い項目は出さない / 空のリストは空配列', () => {
  const s = defaultSettings();
  assert.deepEqual(groupShoppingItems([], s.categories), []);
  const groups = groupShoppingItems([item('a', '米', 'food')], s.categories);
  assert.equal(groups.length, 1);
});

test('並べ方: 項目が消えた・無効化された品目は「その他」に回して失わない', () => {
  const s = defaultSettings();
  s.categories.find((c) => c.id === 'shared').active = false;
  const groups = groupShoppingItems([
    item('a', '電池', 'shared', { createdAt: 1 }),
    item('b', '謎の品', 'deleted-category', { createdAt: 2 }),
    item('c', '米', 'food', { createdAt: 3 }),
  ], s.categories);
  assert.equal(groups.at(-1).category, null, '最後がその他');
  assert.deepEqual(groups.at(-1).items.map((i) => i.name), ['電池', '謎の品']);
  const total = groups.reduce((t, g) => t + g.items.length, 0);
  assert.equal(total, 3, '品目が1つも欠けない');
});

test('並べ方: 元の配列を書き換えない(ストアのデータを壊さない)', () => {
  const s = defaultSettings();
  const items = [item('a', 'B', 'food', { createdAt: 2 }), item('b', 'A', 'food', { createdAt: 1 })];
  const snapshot = JSON.stringify(items);
  groupShoppingItems(items, s.categories);
  assert.equal(JSON.stringify(items), snapshot);
});

test('メモ: 品目名を「、」でつなぐ。空白だけの名前は除く', () => {
  assert.equal(shoppingMemo([item('a', '牛乳', 'food'), item('b', ' 卵 ', 'food'), item('c', '  ', 'food')]),
    '牛乳、卵');
  assert.equal(shoppingMemo([]), '');
});

test('メモ: 入力欄の上限60文字に収まるよう末尾を「…」で切る', () => {
  const many = Array.from({ length: 30 }, (_, i) => item(String(i), `品目${i}`, 'food'));
  const memo = shoppingMemo(many);
  assert.equal(memo.length, 60);
  assert.ok(memo.endsWith('…'));
  // ちょうど60文字なら切らない
  const exact = shoppingMemo([item('x', 'あ'.repeat(60), 'food')]);
  assert.equal(exact, 'あ'.repeat(60));
});

test('家計簿の計算に影響しない: 買い物リストは支出ではないので予算は減らない', () => {
  const s = defaultSettings();
  // 買い物リストのデータは computeMonthSummary に渡らない設計。支出だけで計算が決まることを確認
  const before = computeMonthSummary(s, [], '2026-08');
  const food = before.rows.find((r) => r.category.id === 'food');
  assert.equal(food.spent, 0);
  assert.equal(food.remaining, 56000);
});
