// データ層。firebase-config.js に設定があれば Firestore(共有)、
// なければ localStorage(この端末のみ)で動く。
// どちらのストアも同じインターフェースを持つ:
//   mode, init(), getData() -> {settings, expenses} | null,
//   subscribe(fn), createHousehold(settings), saveSettings(settings),
//   addExpense(e), updateExpense(e), deleteExpense(id)
import { firebaseConfig } from './firebase-config.js';

const LOCAL_KEY = 'coupleBudget.v1';

function createLocalStore() {
  let data = null;
  const listeners = new Set();
  const emit = () => listeners.forEach((fn) => fn());
  const persist = () => {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(data));
    emit();
  };
  return {
    mode: 'local',
    async init() {
      const raw = localStorage.getItem(LOCAL_KEY);
      data = raw ? JSON.parse(raw) : null;
    },
    getData: () => data,
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
  };
}

export async function createStore() {
  if (firebaseConfig) {
    const { createFirestoreStore } = await import('./store-firebase.js');
    return createFirestoreStore(firebaseConfig);
  }
  return createLocalStore();
}
