// 繰越計算ロジック(純粋関数のみ・DOM/ストレージ非依存)
//
// 月は "YYYY-MM"、日付は "YYYY-MM-DD" の文字列で扱う(辞書順=時系列順)。
// 項目(category):
//   { id, name, type: 'fixed'|'utility'|'variable'|'savings',
//     active: bool, sortOrder: number,
//     budgets: [{ from: "YYYY-MM", amount: number }]  // from昇順。fromの月以降に適用
//   }
// 支出(expense): { id, date: "YYYY-MM-DD", categoryId, amount, memo, createdAt }

export function monthOfDate(dateStr) {
  return dateStr.slice(0, 7);
}

export function nextMonth(month) {
  const [y, m] = month.split('-').map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, '0')}`;
}

export function prevMonth(month) {
  const [y, m] = month.split('-').map(Number);
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  return `${py}-${String(pm).padStart(2, '0')}`;
}

// start〜end(両端含む)の月リスト
export function monthRange(start, end) {
  const months = [];
  for (let m = start; m <= end; m = nextMonth(m)) {
    months.push(m);
    if (months.length > 1200) break; // 暴走ガード(100年)
  }
  return months;
}

// その月に適用される予算額(budgetsはfrom昇順前提)
export function effectiveBudget(category, month) {
  let amount = category.budgets.length ? category.budgets[0].amount : 0;
  for (const b of category.budgets) {
    if (b.from <= month) amount = b.amount;
    else break;
  }
  return amount;
}

// 予算変更: month以降の予算をamountにする(過去月は保持)
export function setBudgetFrom(category, month, amount) {
  const budgets = category.budgets
    .filter((b) => b.from !== month)
    .filter((b) => b.from < month || b.amount !== undefined); // 将来分も一旦残す
  budgets.push({ from: month, amount });
  budgets.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  // monthより後の変更予定は上書きの意図とみなして削除
  return budgets.filter((b) => b.from <= month);
}

// 指定月のサマリを計算する。
// 戻り値: { month, rows, totals }
//   rows: [{ category, budget, carryIn, available, spent, remaining, entryCount }]
//     available = budget + carryIn / remaining = available - spent(翌月への繰越)
//   totals: {
//     budget: 全項目の当月予算合計,
//     spent: 当月支出合計(固定費の自動計上を含む),
//     spendableRemaining: 光熱費+変動費の残り合計,
//     savingsBalance: 積立項目の累計残高,
//   }
export function computeMonthSummary(settings, expenses, month) {
  const start = settings.startMonth;
  const target = month < start ? start : month;
  const months = monthRange(start, target);

  // 月×項目ごとの支出合計・件数を事前集計
  const spentMap = new Map();
  const countMap = new Map();
  for (const e of expenses) {
    const key = `${monthOfDate(e.date)}|${e.categoryId}`;
    spentMap.set(key, (spentMap.get(key) ?? 0) + e.amount);
    countMap.set(key, (countMap.get(key) ?? 0) + 1);
  }

  const categories = [...settings.categories].sort((a, b) => a.sortOrder - b.sortOrder);
  const rows = [];
  for (const cat of categories) {
    let carry = 0;
    let row = null;
    for (const m of months) {
      const budget = effectiveBudget(cat, m);
      const spent = cat.type === 'fixed'
        ? budget
        : (spentMap.get(`${m}|${cat.id}`) ?? 0);
      const available = budget + carry;
      const remaining = available - spent;
      if (m === target) {
        row = {
          category: cat,
          budget,
          carryIn: carry,
          available,
          spent,
          remaining,
          entryCount: countMap.get(`${m}|${cat.id}`) ?? 0,
        };
      }
      carry = remaining;
    }
    rows.push(row);
  }

  const active = rows.filter((r) => r.category.active);
  const totals = {
    budget: active.reduce((s, r) => s + r.budget, 0),
    spent: active.reduce((s, r) => s + r.spent, 0),
    spendableRemaining: active
      .filter((r) => r.category.type === 'utility' || r.category.type === 'variable')
      .reduce((s, r) => s + r.remaining, 0),
    savingsBalance: active
      .filter((r) => r.category.type === 'savings')
      .reduce((s, r) => s + r.remaining, 0),
  };

  return { month: target, rows, totals };
}
