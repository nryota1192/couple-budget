// Firebase設定(couple-budget-a3812)。この設定はWebアプリ用の公開情報で秘密ではない。
// アクセス制御は firestore.rules(匿名認証必須)と、推測困難な世帯ID+PINで行う。
// null に戻すとローカルモード(この端末のみ)になる。
export const firebaseConfig = {
  apiKey: "AIzaSyDCkdTT-YSqjSpwDziqXIjfojRY9_PZIbU",
  authDomain: "couple-budget-a3812.firebaseapp.com",
  projectId: "couple-budget-a3812",
  storageBucket: "couple-budget-a3812.firebasestorage.app",
  messagingSenderId: "367759991646",
  appId: "1:367759991646:web:7a2c5d7d4e51f220fd65cf",
};
