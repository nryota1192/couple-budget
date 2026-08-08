import { createStore } from './store.js';
import { defaultSettings, migrateSettings, iconFor, TYPE_LABELS } from './defaults.js';
import {
  computeMonthSummary,
  monthRange,
  nextMonth,
  prevMonth,
  monthOfDate,
  expenseMonth,
  setBudgetFrom,
  effectiveBudget,
  validateBackup,
} from './logic.js';

const $app = document.getElementById('app');
const $toast = document.getElementById('toast');
const UNLOCK_KEY = 'coupleBudget.unlockHash';
// 「誰が入力したか」は端末ごとに持つ(二人が同じ買い物を二重入力したときに気づけるように)
const MEMBER_KEY = 'coupleBudget.memberName';
const memberName = () => localStorage.getItem(MEMBER_KEY) ?? '';

let store;
const ui = {
  historyMonth: null,
  reportMonth: null,
  addCat: null,
};

// ---------- ユーティリティ ----------
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

const yen = (n) => `${n.toLocaleString('ja-JP')}円`;

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const currentMonth = () => todayStr().slice(0, 7);

function monthLabel(m) {
  const [y, mo] = m.split('-');
  return `${y}年${Number(mo)}月`;
}

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

let toastTimer;
function toast(msg) {
  $toast.textContent = msg;
  $toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $toast.classList.remove('show'), 1800);
}

const settings = () => store.getData().settings;
const expenses = () => store.getData().expenses;
// 表示上の「今月」(開始月より前なら開始月)
const homeMonth = () => {
  const m = currentMonth();
  return m < settings().startMonth ? settings().startMonth : m;
};

// 計上月として選べる月(開始月〜今月)。新しい月が先頭
const selectableMonths = () =>
  monthRange(settings().startMonth, homeMonth()).reverse();

// ---------- ルーティング ----------
function route() {
  const h = location.hash.replace(/^#\/?/, '');
  const [view, arg] = h.split('/');
  return { view: view || 'home', arg };
}
const go = (path) => { location.hash = path; };

let migrationRan = false;

function render() {
  const data = store.getData();
  if (!data || !data.settings) return renderSetup();
  if (!migrationRan) {
    migrationRan = true;
    const migrated = structuredClone(data.settings);
    if (migrateSettings(migrated)) store.saveSettings(migrated);
  }
  if (localStorage.getItem(UNLOCK_KEY) !== data.settings.pinHash) {
    return renderLock();
  }
  const { view, arg } = route();
  if (view === 'add') renderAdd(null);
  else if (view === 'edit') renderAdd(arg);
  else if (view === 'history') renderHistory();
  else if (view === 'report') renderReport();
  else if (view === 'settings') renderSettings();
  else renderHome();
}

// ---------- 初期設定 ----------
function renderSetup() {
  $app.innerHTML = `
    <div class="gate">
      <h1>ふたり家計簿</h1>
      <p>預かり金10万円の項目別予算・繰越を管理します</p>
      <div class="card">
        <div class="field">
          <label>共通PIN(4〜6桁の数字)を決めてください</label>
          <input id="pin1" type="password" inputmode="numeric" maxlength="6" autocomplete="off" />
        </div>
        <div class="field">
          <label>もう一度入力</label>
          <input id="pin2" type="password" inputmode="numeric" maxlength="6" autocomplete="off" />
        </div>
        <div class="pin-error" id="pin-error"></div>
        <button class="btn primary" id="start-btn">新しくはじめる</button>
        <p class="note" style="margin-top:12px">
          開始月: 2026年8月 / 項目10個・予算合計100,000円で作成します(あとで設定から変更できます)。
          ${store.mode === 'local' ? '現在はこの端末のみに保存されます。二人での共有はFirebase設定後に有効になります。' : ''}
        </p>
      </div>
      ${store.mode === 'cloud' ? `
        <div class="card">
          <div class="field">
            <label>パートナーがもう作成している場合</label>
            <input id="join-url" type="text" inputmode="url" placeholder="共有URLを貼り付け" />
          </div>
          <button class="btn ghost" id="join-btn">共有URLで参加する</button>
          <p class="note" style="margin-top:10px">
            こちらから参加しないと<b>別々の家計簿</b>になってしまいます。
            共有URLはパートナーの設定画面からコピーできます。
          </p>
        </div>` : ''}
    </div>`;

  const joinBtn = document.getElementById('join-btn');
  if (joinBtn) joinBtn.addEventListener('click', () => {
    const input = document.getElementById('join-url').value.trim();
    const id = (input.match(/[?&]h=([0-9a-f]{16,})/i) ?? input.match(/^([0-9a-f]{16,})$/i))?.[1];
    if (!id) { toast('共有URLが正しくありません'); return; }
    location.href = `${location.pathname}?h=${id}`;
  });
  document.getElementById('start-btn').addEventListener('click', async () => {
    const p1 = document.getElementById('pin1').value.trim();
    const p2 = document.getElementById('pin2').value.trim();
    const err = document.getElementById('pin-error');
    if (!/^\d{4,6}$/.test(p1)) { err.textContent = 'PINは4〜6桁の数字にしてください'; return; }
    if (p1 !== p2) { err.textContent = '2回の入力が一致しません'; return; }
    const s = defaultSettings();
    s.pinHash = await sha256(p1);
    await store.createHousehold(s);
    localStorage.setItem(UNLOCK_KEY, s.pinHash);
    go('home');
    render();
  });
}

// ---------- PINロック ----------
function renderLock() {
  $app.innerHTML = `
    <div class="gate">
      <h1>ふたり家計簿</h1>
      <p>PINを入力してください</p>
      <div class="card">
        <div class="field">
          <input id="pin" type="password" inputmode="numeric" maxlength="6" autocomplete="off" autofocus />
        </div>
        <div class="pin-error" id="pin-error"></div>
        <button class="btn primary" id="unlock-btn">開く</button>
      </div>
    </div>`;
  const tryUnlock = async () => {
    const hash = await sha256(document.getElementById('pin').value.trim());
    if (hash === settings().pinHash) {
      localStorage.setItem(UNLOCK_KEY, hash);
      render();
    } else {
      document.getElementById('pin-error').textContent = 'PINが違います';
    }
  };
  document.getElementById('unlock-btn').addEventListener('click', tryUnlock);
  document.getElementById('pin').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') tryUnlock();
  });
}

// ---------- 共通ナビ ----------
const ICONS = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/></svg>',
  history: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
  report: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 20V10M10 20V4M16 20v-7M21 20H3"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7 7 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z"/></svg>',
};

function navHtml(active) {
  const btn = (id, label) => `
    <button class="nav-btn ${active === id ? 'active' : ''}" data-nav="${id}">
      ${ICONS[id]}<span>${label}</span>
    </button>`;
  return `
    <nav class="bottom-nav"><div class="inner">
      ${btn('home', 'ホーム')}
      ${btn('history', '履歴')}
      <button class="nav-btn add-btn" data-nav="add" aria-label="支出を入力">
        <span class="fab">+</span><span class="lbl">入力</span>
      </button>
      ${btn('report', 'レポート')}
      ${btn('settings', '設定')}
    </div></nav>`;
}

function bindNav() {
  $app.querySelectorAll('[data-nav]').forEach((el) =>
    el.addEventListener('click', () => go(el.dataset.nav)));
}

// ---------- ホーム ----------
function catCard(row, isCurrentMonth) {
  const { category: cat } = row;
  const badges = [];
  if (cat.type === 'fixed') badges.push('<span class="badge muted">自動計上</span>');
  if (cat.type === 'savings') badges.push('<span class="badge good">積立</span>');
  if (cat.type === 'utility' && row.entryCount === 0) {
    // 当月分の請求は翌月に届くので「未入力」ではなく「請求待ち」
    badges.push(isCurrentMonth
      ? '<span class="badge muted">請求待ち</span>'
      : '<span class="badge warn">未入力</span>');
  }
  if (row.remaining < 0) badges.push('<span class="badge danger">超過</span>');

  const ratio = row.available > 0 ? Math.min(row.spent / row.available, 1) : (row.spent > 0 ? 1 : 0);
  const over = row.spent > row.available;
  const remainingLabel = cat.type === 'savings' ? '残高 ' : '';
  const carryNote = row.carryIn !== 0
    ? `予算${yen(row.budget)}${row.carryIn > 0 ? '+' : '−'}繰越${yen(Math.abs(row.carryIn))}`
    : `予算${yen(row.budget)}`;

  return `
    <div class="card cat-card">
      <div class="cat-top">
        <span class="cat-icon">${iconFor(cat)}</span>
        <span class="cat-name">${esc(cat.name)}</span>
        ${badges.join('')}
        <span class="cat-remaining num ${row.remaining < 0 ? 'negative' : ''}">${remainingLabel}${yen(row.remaining)}</span>
      </div>
      <div class="cat-meta num">
        <span>使える ${yen(row.available)}(${carryNote})</span>
        <span>使った ${yen(row.spent)}</span>
      </div>
      ${cat.type === 'fixed' ? '' : `<div class="meter"><i class="${over ? 'over' : ''}" style="width:${(ratio * 100).toFixed(1)}%"></i></div>`}
    </div>`;
}

// 過去月で実額が未入力の光熱費(請求待ちのまま忘れられているもの)
function pendingUtilities() {
  const home = homeMonth();
  const out = [];
  for (let m = settings().startMonth; m < home; m = nextMonth(m)) {
    for (const row of computeMonthSummary(settings(), expenses(), m).rows) {
      if (row.category.active && row.category.type === 'utility' && row.entryCount === 0) {
        out.push({ month: m, name: row.category.name });
      }
    }
  }
  return out;
}

function renderHome() {
  const month = homeMonth();
  const summary = computeMonthSummary(settings(), expenses(), month);
  const t = summary.totals;
  const askName = !memberName() && !sessionStorage.getItem('coupleBudget.nameAsked');
  const namePromptHtml = !askName ? '' : `
    <div class="card">
      <div class="field" style="margin-bottom:8px">
        <label>この端末は誰が使いますか?(履歴に表示され、二重入力に気づけます)</label>
        <input id="member-input" type="text" maxlength="10" placeholder="例: りょうた" />
      </div>
      <div class="btn-row">
        <button class="btn primary" id="member-save">保存</button>
        <button class="btn ghost" id="member-skip">あとで</button>
      </div>
    </div>`;
  const pending = pendingUtilities();
  const pendingHtml = pending.length === 0 ? '' : `
    <div class="card notice">
      <div><b>未入力の請求が${pending.length}件</b></div>
      <div class="note">${pending.slice(0, 4).map((p) => `${monthLabel(p.month)}分の${esc(p.name)}`).join('、')}${pending.length > 4 ? ` ほか${pending.length - 4}件` : ''}</div>
      <button class="btn ghost" data-nav="add" style="margin-top:10px">請求を入力する</button>
    </div>`;
  const groups = [
    ['変動費', 'variable'],
    ['光熱費', 'utility'],
    ['積立', 'savings'],
    ['固定費(自動計上)', 'fixed'],
  ];
  $app.innerHTML = `
    <header class="app-header">
      <h1>ふたり家計簿</h1>
      <span class="month">${monthLabel(month)}</span>
    </header>
    <div class="card summary-card">
      <div class="label">今月の残り(変動費+光熱費)</div>
      <div class="big num ${t.spendableRemaining < 0 ? 'negative' : ''}">${yen(t.spendableRemaining)}</div>
      <div class="summary-sub num">
        <div>家電積立残高<b>${yen(t.savingsBalance)}</b></div>
        <div>今月の支出<b>${yen(t.spent)}</b></div>
        <div>預かり金<b>${yen(settings().monthlyFund)}</b></div>
      </div>
    </div>
    ${namePromptHtml}
    ${pendingHtml}
    ${groups.map(([label, type]) => {
      const rows = summary.rows.filter((r) => r.category.active && r.category.type === type);
      if (!rows.length) return '';
      return `<div class="section-title">${label}</div>`
        + rows.map((r) => catCard(r, month === currentMonth())).join('');
    }).join('')}
    ${navHtml('home')}`;

  if (askName) {
    document.getElementById('member-save').addEventListener('click', () => {
      const name = document.getElementById('member-input').value.trim();
      if (!name) { toast('名前を入力してください'); return; }
      localStorage.setItem(MEMBER_KEY, name);
      toast(`この端末を「${name}」として記録します`);
      render();
    });
    document.getElementById('member-skip').addEventListener('click', () => {
      sessionStorage.setItem('coupleBudget.nameAsked', '1');
      render();
    });
  }
  bindNav();
}

// ---------- 支出入力 / 編集 ----------
// 計上月の初期値。光熱費は請求が翌月に届くので前月を既定にする
function defaultMonthFor(catId) {
  const cat = settings().categories.find((c) => c.id === catId);
  const home = homeMonth();
  if (cat?.type === 'utility') {
    const prev = prevMonth(home);
    if (prev >= settings().startMonth) return prev;
  }
  return home;
}

function renderAdd(editId) {
  const editing = editId ? expenses().find((e) => e.id === editId) : null;
  if (editId && !editing) { go('history'); return; }
  const cats = [...settings().categories]
    .filter((c) => c.active && c.type !== 'fixed')
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const months = selectableMonths();

  let currentCat = editing ? editing.categoryId : ui.addCat;
  let currentMonth = editing ? expenseMonth(editing) : defaultMonthFor(currentCat);
  let monthTouched = Boolean(editing);

  $app.innerHTML = `
    <header class="app-header">
      <h1>${editing ? '支出を編集' : '支出を入力'}</h1>
    </header>
    <div class="card">
      <div class="field">
        <label>項目</label>
        ${[
          ['ふだんの買い物', 'variable'],
          ['毎月の請求', 'utility'],
          ['積立', 'savings'],
        ].map(([groupLabel, type]) => {
          const group = cats.filter((c) => c.type === type);
          if (!group.length) return '';
          return `
            <div class="chip-group">
              <div class="chip-group-label">${groupLabel}</div>
              <div class="chips">
                ${group.map((c) => `
                  <button class="chip ${currentCat === c.id ? 'selected' : ''}" data-cat="${c.id}">
                    <span class="chip-icon">${iconFor(c)}</span>
                    <span class="chip-name">${esc(c.name)}</span>
                    <small class="num"></small>
                  </button>`).join('')}
              </div>
            </div>`;
        }).join('')}
      </div>
      <div class="field">
        <label>計上月(どの月の予算から出すか)</label>
        <select id="month">
          ${months.map((m) => `<option value="${m}">${monthLabel(m)}分</option>`).join('')}
        </select>
        <p class="note" id="month-hint" style="margin:6px 0 0"></p>
      </div>
      <div class="field">
        <label>金額(円)</label>
        <input id="amount" class="amount num" type="number" inputmode="numeric" min="1" step="1"
          placeholder="0" value="${editing ? editing.amount : ''}" />
      </div>
      <div class="field">
        <label>日付(支払日・購入日)</label>
        <input id="date" type="date" value="${editing ? editing.date : todayStr()}" />
      </div>
      <div class="field">
        <label>メモ(任意)</label>
        <input id="memo" type="text" maxlength="60" placeholder="例: スーパーで買い出し" value="${editing ? esc(editing.memo) : ''}" />
      </div>
      <button class="btn primary" id="save-btn"></button>
      ${editing ? '<button class="btn danger-ghost" id="delete-btn">この支出を削除</button>' : ''}
    </div>
    ${navHtml('add')}`;

  const $month = document.getElementById('month');
  const $hint = document.getElementById('month-hint');

  const refresh = () => {
    $month.value = currentMonth;
    const summary = computeMonthSummary(settings(), expenses(), currentMonth);
    $app.querySelectorAll('[data-cat]').forEach((el) => {
      el.classList.toggle('selected', el.dataset.cat === currentCat);
      const row = summary.rows.find((r) => r.category.id === el.dataset.cat);
      el.querySelector('small').textContent = `残${(row?.remaining ?? 0).toLocaleString('ja-JP')}`;
    });
    const cat = settings().categories.find((c) => c.id === currentCat);
    $hint.textContent = cat?.type === 'utility'
      ? '請求は翌月に届くので、使った月を選んでください(既定は前月)。'
      : `${monthLabel(currentMonth)}の予算から差し引かれます。`;
    // どの項目に付けるのかをボタンにも出して、押し間違いに気づけるようにする
    const $save = document.getElementById('save-btn');
    $save.textContent = cat
      ? `${iconFor(cat)} ${cat.name}に${editing ? '更新' : '記録'}する`
      : '項目を選んでください';
    $save.disabled = !cat;
  };

  $app.querySelectorAll('[data-cat]').forEach((el) =>
    el.addEventListener('click', () => {
      currentCat = el.dataset.cat;
      ui.addCat = currentCat;
      if (!monthTouched) currentMonth = defaultMonthFor(currentCat);
      refresh();
    }));

  $month.addEventListener('change', () => {
    currentMonth = $month.value;
    monthTouched = true;
    refresh();
  });
  refresh();

  document.getElementById('save-btn').addEventListener('click', async () => {
    const amount = Math.floor(Number(document.getElementById('amount').value));
    const date = document.getElementById('date').value;
    const memo = document.getElementById('memo').value.trim();
    if (!currentCat) { toast('項目を選んでください'); return; }
    if (!Number.isFinite(amount) || amount <= 0) { toast('金額を入力してください'); return; }
    if (!date) { toast('日付を入力してください'); return; }
    const record = {
      id: editing ? editing.id : crypto.randomUUID(),
      date,
      month: currentMonth,
      categoryId: currentCat,
      amount,
      memo,
      // 入力者は最初に記録した人のまま(編集しても書き換えない)
      by: editing ? (editing.by ?? '') : memberName(),
      createdAt: editing ? editing.createdAt : Date.now(),
    };
    if (editing) await store.updateExpense(record);
    else await store.addExpense(record);
    ui.addCat = null;
    ui.historyMonth = record.month;
    ui.reportMonth = record.month;
    toast(editing ? '更新しました' : `${monthLabel(record.month)}分に記録しました`);
    // 今月分ならホームで残額を確認、過去月分はその月の履歴へ
    go(!editing && record.month === homeMonth() ? 'home' : 'history');
  });

  const del = document.getElementById('delete-btn');
  if (del) del.addEventListener('click', async () => {
    if (!confirm('この支出を削除しますか?')) return;
    await store.deleteExpense(editing.id);
    toast('削除しました');
    go('history');
  });
  bindNav();
}

// ---------- 履歴 ----------
function renderHistory() {
  const month = ui.historyMonth ?? homeMonth();
  ui.historyMonth = month;
  const catOf = (id) => settings().categories.find((c) => c.id === id);
  const catName = (id) => catOf(id)?.name ?? '(削除済み項目)';
  const catIcon = (id) => { const c = catOf(id); return c ? iconFor(c) : '•'; };
  const list = expenses()
    .filter((e) => expenseMonth(e) === month)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt - a.createdAt));
  const total = list.reduce((s, e) => s + e.amount, 0);
  const byDate = new Map();
  for (const e of list) {
    if (!byDate.has(e.date)) byDate.set(e.date, []);
    byDate.get(e.date).push(e);
  }
  const canPrev = month > settings().startMonth;
  const canNext = month < currentMonth();

  $app.innerHTML = `
    <header class="app-header"><h1>履歴</h1><span class="month num">入力計 ${yen(total)}</span></header>
    <div class="month-nav">
      <button id="m-prev" ${canPrev ? '' : 'disabled'}>‹</button>
      <b>${monthLabel(month)}</b>
      <button id="m-next" ${canNext ? '' : 'disabled'}>›</button>
    </div>
    ${list.length === 0 ? '<div class="empty">この月の入力はまだありません</div>' : ''}
    ${[...byDate.entries()].map(([date, rows]) => `
      <div class="date-head">
        ${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}(${'日月火水木金土'[new Date(date + 'T00:00').getDay()]})
        ${monthOfDate(date) !== month ? '<span class="badge muted">別月に支払</span>' : ''}
      </div>
      ${rows.map((e) => {
        const sub = [e.by, e.memo].filter(Boolean).map(esc).join(' · ');
        return `
        <div class="exp-row" data-edit="${e.id}">
          <span class="exp-icon">${catIcon(e.categoryId)}</span>
          <div class="info">
            <div class="cat">${esc(catName(e.categoryId))}</div>
            ${sub ? `<div class="memo">${sub}</div>` : ''}
          </div>
          <div class="amt num">${yen(e.amount)}</div>
        </div>`;
      }).join('')}
    `).join('')}
    ${navHtml('history')}`;

  document.getElementById('m-prev').addEventListener('click', () => {
    ui.historyMonth = prevMonth(month); render();
  });
  document.getElementById('m-next').addEventListener('click', () => {
    ui.historyMonth = nextMonth(month); render();
  });
  $app.querySelectorAll('[data-edit]').forEach((el) =>
    el.addEventListener('click', () => go(`edit/${el.dataset.edit}`)));
  bindNav();
}

// ---------- 月次レポート ----------
function renderReport() {
  const month = ui.reportMonth ?? homeMonth();
  ui.reportMonth = month;
  const summary = computeMonthSummary(settings(), expenses(), month);
  const rows = summary.rows.filter((r) => r.category.active);
  const sum = (f) => rows.reduce((s, r) => s + f(r), 0);
  const canPrev = month > settings().startMonth;
  const canNext = month < currentMonth();
  const cell = (v) => `<td class="num ${v < 0 ? 'negative' : ''}">${v.toLocaleString('ja-JP')}</td>`;

  $app.innerHTML = `
    <header class="app-header"><h1>月次レポート</h1></header>
    <div class="month-nav">
      <button id="m-prev" ${canPrev ? '' : 'disabled'}>‹</button>
      <b>${monthLabel(month)}</b>
      <button id="m-next" ${canNext ? '' : 'disabled'}>›</button>
    </div>
    <div class="table-wrap">
      <table class="report">
        <thead><tr>
          <th>項目</th><th>予算</th><th>繰越</th><th>支出</th><th>翌月へ</th>
        </tr></thead>
        <tbody>
          ${rows.map((r) => `
            <tr>
              <td>${esc(r.category.name)}</td>
              ${cell(r.budget)}${cell(r.carryIn)}${cell(r.spent)}${cell(r.remaining)}
            </tr>`).join('')}
        </tbody>
        <tfoot><tr>
          <td>合計</td>
          ${cell(sum((r) => r.budget))}${cell(sum((r) => r.carryIn))}${cell(sum((r) => r.spent))}${cell(sum((r) => r.remaining))}
        </tr></tfoot>
      </table>
    </div>
    <p class="note">単位: 円。「繰越」は前月からの持ち越し、「翌月へ」は翌月に持ち越す額です。マイナスは使いすぎ(翌月の使える額から差し引き)。固定費は毎月自動で全額消化として計算しています。</p>
    ${navHtml('report')}`;

  document.getElementById('m-prev').addEventListener('click', () => {
    ui.reportMonth = prevMonth(month); render();
  });
  document.getElementById('m-next').addEventListener('click', () => {
    ui.reportMonth = nextMonth(month); render();
  });
  bindNav();
}

// ---------- 設定 ----------
function renderSettings() {
  const month = homeMonth();
  const cats = [...settings().categories].sort((a, b) => a.sortOrder - b.sortOrder);
  $app.innerHTML = `
    <header class="app-header"><h1>設定</h1><span class="month">${monthLabel(month)}以降に適用</span></header>
    <div class="section-title">項目別の月予算</div>
    <div class="card">
      ${cats.map((c) => `
        <div class="setting-row">
          <span class="name">${esc(c.name)}<span class="type">${TYPE_LABELS[c.type]}</span></span>
          <input class="num" type="number" inputmode="numeric" min="0" step="500"
            data-budget="${c.id}" value="${effectiveBudget(c, month)}" />
        </div>`).join('')}
      <div class="sum-note" id="sum-note"></div>
      <button class="btn primary" id="save-budgets">予算を保存(${monthLabel(month)}以降)</button>
    </div>
    <div class="section-title">この端末の使用者</div>
    <div class="card">
      <div class="field">
        <label>名前(入力した支出の履歴に表示されます)</label>
        <input id="member-input2" type="text" maxlength="10" placeholder="例: りょうた" value="${esc(memberName())}" />
      </div>
      <button class="btn ghost" id="member-save2">名前を保存</button>
      <p class="note" style="margin-bottom:0">端末ごとの設定です。相手のスマホでは相手の名前を設定してください。</p>
    </div>
    <div class="section-title">PIN変更</div>
    <div class="card">
      <div class="field">
        <label>新しいPIN(4〜6桁)</label>
        <input id="new-pin" type="password" inputmode="numeric" maxlength="6" autocomplete="off" />
      </div>
      <button class="btn ghost" id="save-pin">PINを変更</button>
    </div>
    <div class="section-title">データ</div>
    <div class="card">
      <p class="note" style="margin-top:0">
        ${store.mode === 'cloud'
          ? 'この<b>共有URL</b>をパートナーに送ってください。二人が同じURLを開くことで家計簿が共有されます。<br>' +
            `<span style="word-break:break-all" id="share-url">${esc(store.shareUrl ? store.shareUrl() : '')}</span>`
          : '現在この端末のみに保存されています(ローカルモード)。二人のスマホで共有するにはFirebaseの設定が必要です(READMEの手順参照)。'}
      </p>
      ${store.mode === 'cloud' ? '<button class="btn ghost" id="copy-btn" style="margin-bottom:10px">共有URLをコピー</button>' : ''}
      <button class="btn ghost" id="export-btn" style="margin-bottom:10px">バックアップをダウンロード(JSON)</button>
      <input type="file" id="restore-file" accept="application/json,.json" style="display:none" />
      <button class="btn ghost" id="restore-btn">バックアップから復元</button>
      <p class="note" style="margin-bottom:0">復元すると現在の支出はすべて置き換わります(PINは今のまま変わりません)。</p>
    </div>
    ${navHtml('settings')}`;

  const inputs = [...$app.querySelectorAll('[data-budget]')];
  const note = document.getElementById('sum-note');
  const updateSum = () => {
    const total = inputs.reduce((s, i) => s + (Math.floor(Number(i.value)) || 0), 0);
    const fund = settings().monthlyFund;
    const diff = fund - total;
    note.classList.toggle('bad', diff !== 0);
    note.innerHTML = `予算合計 <b class="num">${yen(total)}</b> / 預かり金 ${yen(fund)}`
      + (diff === 0 ? '(ぴったり)' : diff > 0 ? `(${yen(diff)} 余ります=バッファ)` : `(${yen(-diff)} 超過しています)`);
  };
  inputs.forEach((i) => i.addEventListener('input', updateSum));
  updateSum();

  document.getElementById('save-budgets').addEventListener('click', async () => {
    const s = structuredClone(settings());
    for (const input of inputs) {
      const cat = s.categories.find((c) => c.id === input.dataset.budget);
      const val = Math.floor(Number(input.value));
      if (!Number.isFinite(val) || val < 0) { toast(`${cat.name}の金額が不正です`); return; }
      if (effectiveBudget(cat, month) !== val) {
        cat.budgets = setBudgetFrom(cat, month, val);
      }
    }
    await store.saveSettings(s);
    toast('予算を保存しました');
  });

  document.getElementById('save-pin').addEventListener('click', async () => {
    const pin = document.getElementById('new-pin').value.trim();
    if (!/^\d{4,6}$/.test(pin)) { toast('PINは4〜6桁の数字にしてください'); return; }
    const s = structuredClone(settings());
    s.pinHash = await sha256(pin);
    await store.saveSettings(s);
    localStorage.setItem(UNLOCK_KEY, s.pinHash);
    document.getElementById('new-pin').value = '';
    toast('PINを変更しました(相手の端末は再入力が必要です)');
  });

  document.getElementById('member-save2').addEventListener('click', () => {
    const name = document.getElementById('member-input2').value.trim();
    if (name) localStorage.setItem(MEMBER_KEY, name);
    else localStorage.removeItem(MEMBER_KEY);
    toast(name ? `「${name}」として記録します` : '名前を消しました');
  });

  const restoreFile = document.getElementById('restore-file');
  document.getElementById('restore-btn').addEventListener('click', () => restoreFile.click());
  restoreFile.addEventListener('change', async () => {
    const file = restoreFile.files[0];
    restoreFile.value = ''; // 同じファイルを選び直せるように
    if (!file) return;
    let parsed;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      toast('ファイルを読み取れませんでした');
      return;
    }
    const result = validateBackup(parsed);
    if (!result.ok) { toast(result.error); return; }
    const ok = confirm(
      `現在の支出${expenses().length}件を、バックアップの${result.data.expenses.length}件で置き換えます。\n`
      + '元に戻せません。実行しますか?');
    if (!ok) return;
    const next = structuredClone(result.data);
    next.settings.pinHash = settings().pinHash; // 復元でロックアウトしないよう今のPINを維持
    await store.replaceAll(next);
    toast(`復元しました(支出${next.expenses.length}件)`);
    go('home');
  });

  const copyBtn = document.getElementById('copy-btn');
  if (copyBtn) copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(store.shareUrl());
      toast('共有URLをコピーしました');
    } catch {
      toast('コピーできませんでした。URLを長押しで選択してください');
    }
  });

  document.getElementById('export-btn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(store.getData(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `couple-budget-${todayStr()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
  bindNav();
}

// ---------- 起動 ----------
async function main() {
  store = await createStore();
  await store.init();
  window.addEventListener('hashchange', render);
  store.subscribe(render);
  render();
}
main();
