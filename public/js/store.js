// データ層。firebase-config.js に設定があれば Firestore(共有)、
// なければ localStorage(この端末のみ)で動く。
// どちらのストアも同じインターフェースを持つ:
//   mode, init(), getData() -> {settings, expenses} | null,
//   subscribe(fn), createHousehold(settings), saveSettings(settings),
//   addExpense(e), updateExpense(e), deleteExpense(id)
import { firebaseConfig } from './firebase-config.js';

const LOCAL_KEY = 'coupleBudget.v1';
// 買い物リストは家計簿データと別キーに置く(バックアップの書き出し・復元の対象外にするため)
const SHOPPING_KEY = 'coupleBudget.shopping.v1';

function createLocalStore() {
  let data = null;
  let shopping = [];
  const listeners = new Set();
  const emit = () => listeners.forEach((fn) => fn());
  const persist = () => {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(data));
    emit();
  };
  const persistShopping = () => {
    localStorage.setItem(SHOPPING_KEY, JSON.stringify(shopping));
    emit();
  };
  return {
    mode: 'local',
    async init() {
      const raw = localStorage.getItem(LOCAL_KEY);
      data = raw ? JSON.parse(raw) : null;
      try {
        shopping = JSON.parse(localStorage.getItem(SHOPPING_KEY) ?? '[]');
        if (!Array.isArray(shopping)) shopping = [];
      } catch {
        shopping = []; // 壊れていても家計簿本体は開けるようにする
      }
    },
    getData: () => data,
    getError: () => null,
    getShopping: () => shopping,
    getShoppingError: () => null,
    async addShoppingItem(item) {
      shopping.push(item);
      persistShopping();
    },
    async setShoppingChecked(id, checked) {
      shopping = shopping.map((x) => (x.id === id
        ? { ...x, checked, checkedAt: checked ? Date.now() : null }
        : x));
      persistShopping();
    },
    async deleteShoppingItems(ids) {
      const remove = new Set(ids);
      shopping = shopping.filter((x) => !remove.has(x.id));
      persistShopping();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    async createHousehold(settings) {
      data = { settings, expenses: [] };
      persist();
    },
    async saveSettings(settings) {
      data.settings = settings;
      persist();
    },
    async addExpense(e) {
      data.expenses.push(e);
      persist();
    },
    async updateExpense(e) {
      data.expenses = data.expenses.map((x) => (x.id === e.id ? e : x));
      persist();
    },
    async deleteExpense(id) {
      data.expenses = data.expenses.filter((x) => x.id !== id);
      persist();
    },
    async replaceAll(next) {
      data = { settings: next.settings, expenses: next.expenses };
      persist();
    },
  };
}

// localhost での動作確認が本番データを書き換えないよう、開発時は常にローカル保存にする
const isLocalhost = ['localhost', '127.0.0.1', ''].includes(location.hostname);

export async function createStore() {
  if (firebaseConfig && !isLocalhost) {
    const { createFirestoreStore } = await import('./store-firebase.js');
    return createFirestoreStore(firebaseConfig);
  }
  return createLocalStore();
}
