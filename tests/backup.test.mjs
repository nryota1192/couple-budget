import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromValue, fromFields, fetchBudget } from '../scripts/backup.mjs';
import { validateBackup } from '../public/js/logic.js';

// Firestore REST が返す型付きの値を、アプリが読める素のJSONに戻せること。
// ここが崩れるとバックアップが静かに壊れるので個別に検証する。

test('値の変換: 各型が正しく戻る', () => {
  assert.equal(fromValue({ stringValue: '食費' }), '食費');
  assert.equal(fromValue({ integerValue: '3200' }), 3200); // RESTでは整数も文字列で来る
  assert.equal(fromValue({ doubleValue: 1.5 }), 1.5);
  assert.equal(fromValue({ booleanValue: true }), true);
  assert.equal(fromValue({ nullValue: null }), null);
});

test('値の変換: 配列とネストしたマップ(項目マスタの形)', () => {
  const fields = {
    startMonth: { stringValue: '2026-08' },
    monthlyFund: { integerValue: '100000' },
    categories: {
      arrayValue: {
        values: [{
          mapValue: {
            fields: {
              id: { stringValue: 'food' },
              name: { stringValue: '食費' },
              active: { booleanValue: true },
              sortOrder: { integerValue: '6' },
              type: { stringValue: 'variable' },
              budgets: {
                arrayValue: {
                  values: [{ mapValue: { fields: {
                    from: { stringValue: '2026-08' },
                    amount: { integerValue: '28000' },
                  } } }],
                },
              },
            },
          },
        }],
      },
    },
  };
  assert.deepEqual(fromFields(fields), {
    startMonth: '2026-08',
    monthlyFund: 100000,
    categories: [{
      id: 'food',
      name: '食費',
      active: true,
      sortOrder: 6,
      type: 'variable',
      budgets: [{ from: '2026-08', amount: 28000 }],
    }],
  });
});

test('空の配列は空配列になる(値が1つも無いとvaluesが省略される)', () => {
  assert.deepEqual(fromValue({ arrayValue: {} }), []);
  assert.deepEqual(fromValue({ mapValue: {} }), {});
});

// Firestore は1回のリクエストで返す件数に上限があるためページ送りが必要。
// 支出が1件しかない今は実際にはループしないので、ここで多件数を再現して検証する。
test('取得: 複数ページにまたがる支出をすべて集める', async () => {
  const page = (n, from) => ({
    documents: Array.from({ length: n }, (_, i) => ({
      name: `projects/p/databases/(default)/documents/households/h/expenses/id${from + i}`,
      fields: {
        date: { stringValue: `2026-08-${String((from + i) % 28 + 1).padStart(2, '0')}` },
        categoryId: { stringValue: 'food' },
        amount: { integerValue: String(100 + from + i) },
      },
    })),
  });
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    const body = String(url).includes('identitytoolkit')
      ? { idToken: 'dummy-token' }
      : String(url).includes('/expenses')
        ? (String(url).includes('pageToken=NEXT')
          ? page(50, 300)
          : { ...page(300, 0), nextPageToken: 'NEXT' })
        : { fields: { startMonth: { stringValue: '2026-08' }, categories: { arrayValue: { values: [] } } } };
    return { ok: true, json: async () => body };
  };
  try {
    const { expenses } = await fetchBudget('h');
    assert.equal(expenses.length, 350, 'ページ送りの分が欠けている');
    assert.equal(new Set(expenses.map((e) => e.id)).size, 350, 'IDが重複している');
    // 日付順に並んでいる
    const dates = expenses.map((e) => e.date);
    assert.deepEqual(dates, [...dates].sort());
    // 認証トークンを付けて呼んでいる
    assert.ok(calls.some((u) => u.includes('identitytoolkit')), '匿名ログインしていない');
  } finally {
    globalThis.fetch = original;
  }
});

test('取得: APIがエラーを返したら例外にする(黙って空のバックアップを作らない)', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 403, text: async () => 'Missing permissions' });
  try {
    await assert.rejects(() => fetchBudget('h'), /403/);
  } finally {
    globalThis.fetch = original;
  }
});

test('変換結果がアプリの復元機能をそのまま通る', () => {
  const settings = fromFields({
    startMonth: { stringValue: '2026-08' },
    monthlyFund: { integerValue: '100000' },
    categories: { arrayValue: { values: [{ mapValue: { fields: {
      id: { stringValue: 'food' },
      name: { stringValue: '食費' },
      active: { booleanValue: true },
      sortOrder: { integerValue: '1' },
      type: { stringValue: 'variable' },
      budgets: { arrayValue: { values: [{ mapValue: { fields: {
        from: { stringValue: '2026-08' }, amount: { integerValue: '28000' },
      } } }] } },
    } } }] } },
  });
  const expenses = [{
    id: 'abc',
    ...fromFields({
      date: { stringValue: '2026-08-01' },
      month: { stringValue: '2026-08' },
      categoryId: { stringValue: 'food' },
      amount: { integerValue: '1000' },
      memo: { stringValue: '' },
      by: { stringValue: 'りょうた' },
      createdAt: { integerValue: '1785000000000' },
    }),
  }];
  const result = validateBackup({ settings, expenses });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.data.expenses[0].amount, 1000);
});
