// Firestore ストア(二人のスマホで共有)。
// 世帯ID(householdId)は URL の ?h=... で共有する。初回作成時に自動生成され、
// 以降は localStorage にも記憶するので2回目からは素のURLでもよい。
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth,
  signInAnonymously,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  getFirestore,
  doc,
  collection,
  onSnapshot,
  setDoc,
  deleteDoc,
  getDocs,
  writeBatch,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const HH_KEY = 'coupleBudget.householdId';

function resolveHouseholdId() {
  const url = new URL(location.href);
  const fromUrl = url.searchParams.get('h');
  if (fromUrl) {
    localStorage.setItem(HH_KEY, fromUrl);
    return fromUrl;
  }
  return localStorage.getItem(HH_KEY);
}

function putIdInUrl(id) {
  const url = new URL(location.href);
  if (url.searchParams.get('h') !== id) {
    url.searchParams.set('h', id);
    history.replaceState(null, '', url.toString());
  }
}

export function createFirestoreStore(config) {
  const app = initializeApp(config);
  const db = getFirestore(app);
  let householdId = resolveHouseholdId();
  let settings = null;
  let expenses = [];
  let ready = false;
  const listeners = new Set();
  const emit = () => listeners.forEach((fn) => fn());

  const settingsRef = () => doc(db, 'households', householdId);
  const expensesCol = () => collection(db, 'households', householdId, 'expenses');

  function watch() {
    putIdInUrl(householdId);
    localStorage.setItem(HH_KEY, householdId);
    onSnapshot(settingsRef(), (snap) => {
      settings = snap.exists() ? snap.data() : null;
      ready = true;
      emit();
    });
    onSnapshot(expensesCol(), (snap) => {
      expenses = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      emit();
    });
  }

  return {
    mode: 'cloud',
    getHouseholdId: () => householdId,
    shareUrl() {
      const url = new URL(location.href);
      url.hash = '';
      url.searchParams.set('h', householdId);
      return url.toString();
    },
    async init() {
      await signInAnonymously(getAuth(app));
      if (householdId) {
        await new Promise((resolve) => {
          const off = this.subscribe(() => {
            if (ready) { off(); resolve(); }
          });
          watch();
        });
      }
    },
    getData: () => (settings ? { settings, expenses } : null),
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    async createHousehold(newSettings) {
      householdId = householdId || crypto.randomUUID().replaceAll('-', '');
      await setDoc(settingsRef(), newSettings);
      watch();
    },
    async saveSettings(s) {
      await setDoc(settingsRef(), s);
    },
    async addExpense(e) {
      const { id, ...body } = e;
      await setDoc(doc(expensesCol(), id), body);
    },
    async updateExpense(e) {
      const { id, ...body } = e;
      await setDoc(doc(expensesCol(), id), body);
    },
    async deleteExpense(id) {
      await deleteDoc(doc(expensesCol(), id));
    },
    // バックアップからの復元。Firestoreは1バッチ内で同じ文書に2回書けないため、
    // 「バックアップに無いものだけ削除」→「全件上書き」の順に分けて実行する。
    async replaceAll(next) {
      await setDoc(settingsRef(), next.settings);
      const existing = await getDocs(expensesCol());
      const keepIds = new Set(next.expenses.map((e) => e.id));
      const stale = existing.docs.filter((d) => !keepIds.has(d.id)).map((d) => d.id);

      const commitInChunks = async (items, apply) => {
        for (let i = 0; i < items.length; i += 400) {
          const batch = writeBatch(db);
          for (const item of items.slice(i, i + 400)) apply(batch, item);
          await batch.commit();
        }
      };
      await commitInChunks(stale, (batch, id) => batch.delete(doc(expensesCol(), id)));
      await commitInChunks(next.expenses, (batch, e) => {
        const { id, ...body } = e;
        batch.set(doc(expensesCol(), id), body);
      });
    },
  };
}
