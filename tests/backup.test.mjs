import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromValue, fromFields } from '../scripts/backup.mjs';
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
